import type { CanvasSink, Input, InputVideoTrack, WrappedCanvas } from 'mediabunny';
import { ContentType, GridSettings, Layer, ProjectionSource } from '../types';
import { EffectsEngine, LoopCheck, checkEffectsForLoop, drawGradientTexture } from '../effects';
import { DEFAULT_GRID, drawGridTexture } from '../utils/grid';
import { SceneTextures, drawLayers } from '../utils/scene';
import {
  ClipTiming, LayerTiming, LoopPlan, LoopPlanError, Rational, computeLoopPlan, frameTime, locateClip, rat, ratToNumber,
  secondsToTicks, sourceQuerySeconds,
} from './loopTiming';

// Exports the projection (what LIVE and show mode show) as a video made to play on repeat.
//
// 1. Every visible video is opened with mediabunny, which reads the container's own whole-number
//    timestamps: the length is (end of the last frame - first PTS) on the file's timescale (loopTiming.ts).
// 2. The loop plan finds the shortest length in which every video plays a whole number of times.
// 3. The effects are checked (effects/loop.ts); the dialog warns about any that cannot loop.
// 4. Frame i is drawn at exactly i / fps: each video shows the decoded frame for its own position in its
//    cycle, effects get the loop length so they come back to where they started, and the frame is encoded
//    with an exact timestamp. Frame N would be frame 0 again, so it is not written: the file loops cleanly.
//
// mediabunny (WebCodecs) is loaded only when someone exports, so the projector page stays small.

/** The frame the projector shows: LIVE draws the show at 0.8x from (20, 20) on a 1920 x 1080 screen. */
export const LIVE_FRAME = { width: 1920, height: 1080, scale: 0.8, offset: 20 };

export interface ClipInfo {
  name: string;
  timing: ClipTiming;
  fps: Rational | null; // From the first frame's duration; null when unknown
  frames: number | null;
  constantRate: boolean;
  error?: string;
}

export interface VideoLayerInfo {
  layer: Layer;
  clips: ClipInfo[];
}

export interface ExportSettings {
  fps: Rational;
  width: number;
  height: number;
  emptySeconds: Rational; // Length when there is no video
  maxSeconds?: number;
}

export interface Analysis {
  videoLayers: VideoLayerInfo[];
  plan: LoopPlan | LoopPlanError;
  check: LoopCheck | null; // null when there is no plan
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  frameCount: number;
  codec: string;
}

type Mediabunny = typeof import('mediabunny');
let mbPromise: Promise<Mediabunny> | null = null;
const mediabunny = () => (mbPromise ??= import('mediabunny'));

/** Elements that show up in the export, as the projector draws them. */
const drawn = (l: Layer) => l.visible && l.points.length >= 3 && l.opacity * (l.transitionOpacity ?? 1) > 0.01;

/** The videos an element plays in one cycle: its playlist in order, or its one video. */
export const clipsOf = (layer: Layer): ProjectionSource[] => {
  if (layer.source?.type !== ContentType.VIDEO) return [];
  const list = layer.playlist?.items?.filter(s => s.type === ContentType.VIDEO && s.url);
  return list && list.length > 0 ? list : [layer.source];
};

export const videoLayersOf = (layers: Layer[]) => layers.filter(l => drawn(l) && clipsOf(l).length > 0);

interface OpenClip {
  input: Input;
  track: InputVideoTrack;
  info: ClipInfo;
}

/**
 * Opens the videos once and keeps them open while the export dialog is up: reading the lengths and
 * decoding the frames use the same files. Call dispose() when done.
 */
export class MediaProbe {
  private open = new Map<string, Promise<OpenClip | ClipInfo>>();

  clip(source: ProjectionSource): Promise<OpenClip | ClipInfo> {
    const key = source.url;
    let p = this.open.get(key);
    if (!p) {
      p = openClip(source).catch((e): ClipInfo => ({
        name: source.name,
        timing: { duration: null },
        fps: null,
        frames: null,
        constantRate: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      this.open.set(key, p);
    }
    return p;
  }

  async info(source: ProjectionSource): Promise<ClipInfo> {
    const c = await this.clip(source);
    return 'info' in c ? c.info : c;
  }

  dispose() {
    for (const p of this.open.values()) p.then(c => { if ('input' in c) c.input.dispose(); }).catch(() => {});
    this.open.clear();
  }
}

const openClip = async (source: ProjectionSource): Promise<OpenClip> => {
  const mb = await mediabunny();
  const blob = source.file ?? await fetch(source.url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  });
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track');
  // Every timestamp in the file is a whole multiple of 1/resolution (the MP4 timescale, or 1000 for WebM).
  const resolution = Math.round(await track.getTimeResolution());
  const first = secondsToTicks(await track.getFirstTimestamp(), resolution);
  const end = secondsToTicks(await track.computeDuration(), resolution); // End of the last frame
  if (end <= first) throw new Error('Empty video');
  const firstPacket = await new mb.EncodedPacketSink(track).getFirstPacket();
  const frameTicks = firstPacket ? secondsToTicks(firstPacket.duration, resolution) : 0n;
  const stats = await track.computePacketStats();
  const frames = stats.packetCount;
  return {
    input,
    track,
    info: {
      name: source.name,
      timing: { duration: rat(end - first, BigInt(resolution)), resolution, startTicks: first },
      fps: frameTicks > 0n ? rat(BigInt(resolution), frameTicks) : null,
      frames,
      constantRate: frameTicks > 0n && BigInt(frames) * frameTicks === end - first,
    },
  };
};

/** Reads the videos, works out the loop and checks the effects. */
export const analyze = async (layers: Layer[], settings: ExportSettings, probe: MediaProbe): Promise<Analysis> => {
  const videoLayers: VideoLayerInfo[] = await Promise.all(videoLayersOf(layers).map(async layer => ({
    layer,
    clips: await Promise.all(clipsOf(layer).map(s => probe.info(s))),
  })));
  return planFor(layers, videoLayers, settings);
};

/** The plan and effect check for already-read videos (cheap: run again when a setting changes). */
export const planFor = (layers: Layer[], videoLayers: VideoLayerInfo[], settings: ExportSettings): Analysis => {
  const timings: LayerTiming[] = videoLayers.map(v => ({ id: v.layer.id, clips: v.clips.map(c => c.timing) }));
  const plan = computeLoopPlan(timings, { fps: settings.fps, maxSeconds: settings.maxSeconds, emptySeconds: settings.emptySeconds });
  const check = plan.ok === true ? checkEffectsForLoop(layers.filter(drawn), ratToNumber((plan as LoopPlan).duration)) : null;
  return { videoLayers, plan, check };
};

/** Video codecs to try, best for a Raspberry Pi first. All go into MP4, whose timescale keeps NTSC rates exact. */
const CODECS = ['avc', 'vp9', 'av1', 'vp8'] as const;

export interface ExportOptions {
  layers: Layer[];
  gridDefaults?: GridSettings;
  projectorSize: { w: number; h: number }; // The show's logical size (what LIVE fits on the screen)
  settings: ExportSettings;
  analysis: Analysis;
  probe: MediaProbe;
  onProgress?: (frame: number, total: number) => void;
  signal?: AbortSignal;
}

/** Everything needed to draw export frame i; also used by the tests to compare frames across the seam. */
export class LoopRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fx = new EffectsEngine();
  private staticPatterns = new WeakMap<CanvasImageSource, CanvasPattern | null>();
  private grids = new Map<string, HTMLCanvasElement>();
  private gradients = new Map<string, HTMLCanvasElement>();
  private images = new Map<string, HTMLImageElement>();
  private current = new Map<string, WrappedCanvas | null>();
  private sinks: CanvasSink[][] = [];
  private loopSkip: Set<string>;

  constructor(private opts: Omit<ExportOptions, 'onProgress' | 'signal'>, private plan: LoopPlan) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = opts.settings.width;
    this.canvas.height = opts.settings.height;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.loopSkip = opts.analysis.check?.skip ?? new Set();
  }

  async load() {
    const mb = await mediabunny();
    // Pictures are decoded up front, so frame 0 never draws an element that is still loading.
    for (const l of this.opts.layers) {
      if (l.source?.type !== ContentType.IMAGE || !l.source.url || this.images.has(l.source.url)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = l.source.url;
      await img.decode().catch(() => {});
      this.images.set(l.source.url, img);
    }
    this.sinks = await Promise.all(this.opts.analysis.videoLayers.map(v => Promise.all(clipsOf(v.layer).map(async s => {
      const c = await this.opts.probe.clip(s);
      if (!('track' in c)) throw new Error(c.error ?? 'Cannot read video');
      return new mb.CanvasSink(c.track, { poolSize: 2 });
    }))));
  }

  /** Decodes every video's frame for export frame i. */
  async seek(frame: number) {
    const { videoLayers } = this.opts.analysis;
    await Promise.all(videoLayers.map(async (v, li) => {
      const { clip, offsetTicks } = locateClip(this.plan, li, frame);
      const timing = v.clips[clip].timing;
      const t = sourceQuerySeconds(this.plan, timing, offsetTicks);
      this.current.set(v.layer.id, await this.sinks[li][clip].getCanvas(t));
    }));
  }

  /** Draws export frame i (after seek(i)). */
  draw(frame: number) {
    const { ctx, canvas, opts } = this;
    const k = canvas.width / LIVE_FRAME.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const textures: SceneTextures = {
      video: layer => {
        const c = this.current.get(layer.id);
        return c ? { image: c.canvas as CanvasImageSource, w: c.canvas.width, h: c.canvas.height } : null;
      },
      image: url => this.images.get(url) ?? null,
      grid: grid => cached(this.grids, JSON.stringify(grid ?? DEFAULT_GRID), () => drawGridTexture(grid ?? DEFAULT_GRID)),
      gradient: layer => cached(this.gradients, JSON.stringify([layer.source?.color, layer.source?.color2, layer.source?.angle]), () => drawGradientTexture(layer.source!)),
    };
    const seconds = ratToNumber(this.plan.duration);
    drawLayers({
      ctx,
      layers: opts.layers.filter(drawn),
      size: opts.projectorSize,
      scale: LIVE_FRAME.scale * k,
      offset: { x: LIVE_FRAME.offset * k, y: LIVE_FRAME.offset * k },
      now: frameTime(this.plan, frame) * 1000,
      gridDefaults: opts.gridDefaults,
      fx: this.fx,
      textures,
      staticPatterns: this.staticPatterns,
      loop: { seconds, skip: this.loopSkip },
    });
  }
}

const cached = <T>(map: Map<string, T>, key: string, make: () => T): T => {
  let v = map.get(key);
  if (!v) { v = make(); map.set(key, v); }
  return v;
};

export class ExportCancelled extends Error {
  constructor() { super('Export cancelled'); this.name = 'ExportCancelled'; }
}

/** Draws and encodes every frame of the loop. Throws ExportCancelled when the signal aborts. */
export const exportLoopVideo = async (opts: ExportOptions): Promise<ExportResult> => {
  const { settings, analysis, signal, onProgress } = opts;
  if (analysis.plan.ok !== true) throw new Error('No loop plan');
  const plan = analysis.plan as LoopPlan;
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video (WebCodecs is missing).');
  const mb = await mediabunny();

  const format = new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
  const supported = format.getSupportedVideoCodecs();
  const codec = await mb.getFirstEncodableVideoCodec(CODECS.filter(c => supported.includes(c)), { width: settings.width, height: settings.height });
  if (!codec) throw new Error('This browser cannot encode H.264, VP9, AV1 or VP8 video.');

  const renderer = new LoopRenderer(opts, plan);
  await renderer.load();

  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });
  const source = new mb.CanvasSource(renderer.canvas, { codec, bitrate: mb.QUALITY_HIGH });
  // The track's timescale is the frame rate's denominator (30000 for 29.97), so every timestamp is exact.
  output.addVideoTrack(source, { frameRate: ratToNumber(settings.fps) });
  await output.start();

  const total = Number(plan.frameCount);
  const frameSeconds = ratToNumber(rat(plan.frameTicks, plan.timescale));
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new ExportCancelled();
      await renderer.seek(i);
      renderer.draw(i);
      await source.add(Number(BigInt(i) * plan.frameTicks) / Number(plan.timescale), frameSeconds);
      onProgress?.(i + 1, total);
    }
    if (signal?.aborted) throw new ExportCancelled();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const blob = new Blob([target.buffer!], { type: format.mimeType });
  const fps = ratToNumber(settings.fps);
  return {
    blob,
    fileName: `lumamap-loop-${Math.round(ratToNumber(plan.duration) * 100) / 100}s-${Math.round(fps * 1000) / 1000}fps${format.fileExtension}`,
    frameCount: total,
    codec,
  };
};
