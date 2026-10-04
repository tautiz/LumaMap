import { ControlPoint, Layer } from '../types';
import { GraphNode, RenderGraph, ScreenPass } from './graph';
import { COMPOSITE, makesLayer, resolveParams } from './registry';
import { EffectInstance, TextureFxArgs } from './types';
import { convexHull, hashString, mixColor, rgbToHex } from './util';

// Runs an element's render graph and returns its finished picture, which the canvas then maps onto the
// element's mesh like any other texture. Effects draw at about the size the element appears on screen,
// capped, so a small element on a Raspberry Pi costs little. Buffers are reused between frames, and a
// picture with nothing moving in it is kept and not drawn again until something changes.

/** What the element shows underneath its effects. */
export type ContentDraw =
  | { kind: 'image'; image: CanvasImageSource; isStatic: boolean; key: string }
  | { kind: 'color'; color: string }
  | { kind: 'none' };

const MAX_TEXTURE = 1024;
const DEFAULT_PALETTE = ['#ff2d55', '#ffcc00', '#00ff88', '#00e5ff', '#b46bff'];

/** The shared clock, in seconds: Date.now() is the same in the editor and the projector window on one device. */
export const fxTime = (now: number) => (now % 86_400_000) / 1000;

/** Working size for an element's effects: its size on screen (logical size x canvas scale), capped. */
export const textureSize = (points: ControlPoint[], scale: number) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  let w = Math.max(16, (maxX - minX) * scale);
  let h = Math.max(16, (maxY - minY) * scale);
  const k = Math.min(1, MAX_TEXTURE / Math.max(w, h));
  // Rounded, so dragging a corner a little does not reallocate every buffer on each frame.
  w = Math.max(16, Math.round((w * k) / 16) * 16);
  h = Math.max(16, Math.round((h * k) / 16) * 16);
  return { w, h };
};

interface Buffer { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

const makeBuffer = (w: number, h: number): Buffer => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
};

const reset = (b: Buffer) => {
  const c = b.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  c.shadowOffsetX = c.shadowOffsetY = 0;
  c.imageSmoothingEnabled = true;
  c.clearRect(0, 0, b.canvas.width, b.canvas.height);
};

// Average colour of a picture, for the "input colour" and "content colour" sources. Reading pixels back
// is slow on a Pi, so it is done on a 4x4 copy, a few times a second at most.
let sampler: CanvasRenderingContext2D | null = null;
const averageColor = (src: CanvasImageSource): string | null => {
  if (!sampler) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    sampler = c.getContext('2d', { willReadFrequently: true });
    if (!sampler) return null;
  }
  try {
    sampler.clearRect(0, 0, 4, 4);
    sampler.drawImage(src, 0, 0, 4, 4);
    const d = sampler.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) {
      const w = d[i + 3];
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w;
    }
    return a > 0 ? rgbToHex(r / a, g / a, b / a) : null;
  } catch {
    return null; // A picture from another site without CORS cannot be read
  }
};

class LayerState {
  w = 0;
  h = 0;
  free: Buffer[] = [];
  scratch: Buffer[] = [];
  cache: Buffer | null = null;
  cacheKey = '';
  lastOut: Buffer | null = null; // Last frame's picture, handed back to the pool on the next frame
  samples = new Map<string, { color: string; at: number }>();

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.free = [];
    this.scratch = [];
    this.cache = null;
    this.cacheKey = '';
    this.lastOut = null;
  }
  acquire(): Buffer {
    const b = this.free.pop() ?? makeBuffer(this.w, this.h);
    reset(b);
    return b;
  }
  release(b: Buffer | null) {
    if (b && b !== this.cache && !this.free.includes(b)) this.free.push(b);
  }
  scratchCtx = (i: number) => {
    while (this.scratch.length <= i) this.scratch.push(makeBuffer(this.w, this.h));
    reset(this.scratch[i]);
    return this.scratch[i].ctx;
  };
  sample(key: string, src: CanvasImageSource | null, now: number): string | null {
    const known = this.samples.get(key);
    if (known && now - known.at < 300) return known.color;
    if (!src) return known?.color ?? null;
    const color = averageColor(src);
    if (color) this.samples.set(key, { color, at: now });
    return color ?? known?.color ?? null;
  }
}

export interface FrameEnv {
  now: number;
  scale: number; // Device pixels per projector pixel
  area: { w: number; h: number };
  layers: Layer[];
  elementColor: string;
}

export class EffectsEngine {
  private states = new Map<string, LayerState>();

  private state(id: string) {
    let s = this.states.get(id);
    if (!s) { s = new LayerState(); this.states.set(id, s); }
    return s;
  }

  /** Forget elements that no longer exist. */
  prune(ids: Set<string>) {
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);
  }

  // `input` is null for projector-space effects: there "input colour" means the element's content colour.
  private resolveColor(fx: EffectInstance, st: LayerState, env: FrameEnv, input: CanvasImageSource | null): string {
    const c = fx.color;
    switch (c.mode) {
      case 'element': return env.elementColor;
      case 'palette': {
        const list = c.palette?.length ? c.palette : DEFAULT_PALETTE;
        const t = fxTime(env.now) / 2;
        const i = Math.floor(t);
        return mixColor(list[i % list.length], list[(i + 1) % list.length], t - i);
      }
      case 'input': return (input ? st.sample(fx.id, input, env.now) : st.sample('content', null, env.now)) ?? c.color;
      case 'content': return st.sample('content', null, env.now) ?? c.color;
      default: return c.color;
    }
  }

  /** The element's finished picture with all texture-space effects, or null when it has nothing to show. */
  renderTexture(layer: Layer, graph: RenderGraph, content: ContentDraw, size: { w: number; h: number }, env: FrameEnv): HTMLCanvasElement | null {
    const st = this.state(layer.id);
    st.resize(size.w, size.h);
    st.release(st.lastOut);
    st.lastOut = null;

    const cacheable = !graph.animated && (content.kind !== 'image' || content.isStatic);
    let key = '';
    if (cacheable) {
      const contentKey = content.kind === 'image' ? content.key : content.kind === 'color' ? content.color : '';
      key = JSON.stringify([contentKey, env.elementColor, graph.nodes.map(n => (n.kind === 'effect' ? { ...n.fx, trigger: n.fx.trigger.mode } : n.id))]);
      if (st.cache && st.cacheKey === key) return st.cache.canvas;
    }

    const sampleContent = graph.nodes.some(n => n.kind === 'effect' && n.fx.color.mode === 'content')
      || [...graph.under, ...graph.over].some(p => p.fx.color.mode === 'content' || p.fx.color.mode === 'input');
    const time = fxTime(env.now);
    const results = new Map<string, Buffer | null>();
    const uses = new Map<string, number>([[graph.output, 1]]);
    for (const n of graph.nodes) if (n.kind === 'effect') for (const i of n.inputs) uses.set(i, (uses.get(i) ?? 0) + 1);
    const done = (id: string) => {
      const left = (uses.get(id) ?? 0) - 1;
      uses.set(id, left);
      if (left <= 0) st.release(results.get(id) ?? null);
    };

    for (const node of graph.nodes) {
      results.set(node.id, node.kind === 'content' ? this.drawContent(st, content, env.now, sampleContent) : this.runEffect(st, node, results.get(node.inputs[0]) ?? null, time, env));
      if (node.kind === 'effect') node.inputs.forEach(done);
    }

    const out = results.get(graph.output) ?? null;
    if (!out) return null;
    if (!cacheable) {
      st.lastOut = out;
      return out.canvas;
    }
    // Keep a copy of a still picture, so it is not drawn again until something changes.
    if (!st.cache) st.cache = makeBuffer(st.w, st.h);
    reset(st.cache);
    st.cache.ctx.drawImage(out.canvas, 0, 0);
    st.cacheKey = key;
    st.release(out);
    return st.cache.canvas;
  }

  private drawContent(st: LayerState, content: ContentDraw, now: number, sample: boolean): Buffer | null {
    if (content.kind === 'none') return null;
    const b = st.acquire();
    if (content.kind === 'color') {
      b.ctx.fillStyle = content.color;
      b.ctx.fillRect(0, 0, st.w, st.h);
    } else {
      b.ctx.drawImage(content.image, 0, 0, st.w, st.h);
    }
    if (sample) st.sample('content', b.canvas, now);
    return b;
  }

  private runEffect(st: LayerState, node: Extract<GraphNode, { kind: 'effect' }>, input: Buffer | null, time: number, env: FrameEnv): Buffer | null {
    const { fx, def } = node;
    if (def.inputMode === 'required' && !input) return null;
    const layer = st.acquire();
    const args: TextureFxArgs = {
      ctx: layer.ctx,
      input: input?.canvas ?? null,
      w: st.w,
      h: st.h,
      m: Math.min(st.w, st.h),
      time,
      progress: node.progress,
      params: resolveParams(fx, def),
      intensity: fx.intensity,
      color: this.resolveColor(fx, st, env, input?.canvas ?? null),
      colorMode: fx.color.mode,
      seed: hashString(fx.id),
      scratch: st.scratchCtx,
    };
    try {
      def.renderTexture?.(args);
    } catch (e) {
      console.warn(`Effect ${fx.type} failed`, e);
    }
    reset2d(layer.ctx);

    const opacity = Math.max(0, Math.min(1, fx.opacity));
    const blend = COMPOSITE[fx.blend] ?? 'source-over';

    if (def.role === 'mask') {
      // Visible where the mask is opaque; at lower opacity the mask only partly hides the picture.
      const out = st.acquire();
      out.ctx.drawImage(input!.canvas, 0, 0);
      if (opacity < 1) {
        layer.ctx.globalCompositeOperation = 'destination-in';
        layer.ctx.fillStyle = `rgba(0,0,0,${opacity})`;
        layer.ctx.fillRect(0, 0, st.w, st.h);
        layer.ctx.globalCompositeOperation = 'lighter';
        layer.ctx.fillStyle = `rgba(255,255,255,${1 - opacity})`;
        layer.ctx.fillRect(0, 0, st.w, st.h);
      }
      out.ctx.globalCompositeOperation = 'destination-in';
      out.ctx.drawImage(layer.canvas, 0, 0);
      st.release(layer);
      return out;
    }

    if (makesLayer(def)) {
      const under = (fx.placement ?? (def.role === 'underlay' ? 'under' : 'over')) === 'under';
      if (!input && opacity >= 1) return layer;
      const out = st.acquire();
      if (under) {
        out.ctx.globalAlpha = opacity;
        out.ctx.drawImage(layer.canvas, 0, 0);
        out.ctx.globalAlpha = 1;
        if (input) out.ctx.drawImage(input.canvas, 0, 0);
      } else {
        if (input) out.ctx.drawImage(input.canvas, 0, 0);
        out.ctx.globalAlpha = opacity;
        out.ctx.globalCompositeOperation = blend;
        out.ctx.drawImage(layer.canvas, 0, 0);
      }
      st.release(layer);
      return out;
    }

    // Modifier: the changed picture replaces the input, or is mixed over it by blend mode and opacity.
    if (!input) { st.release(layer); return null; }
    if (opacity >= 1 && fx.blend === 'normal') return layer;
    const out = st.acquire();
    out.ctx.drawImage(input.canvas, 0, 0);
    out.ctx.globalAlpha = opacity;
    out.ctx.globalCompositeOperation = blend;
    out.ctx.drawImage(layer.canvas, 0, 0);
    st.release(layer);
    return out;
  }

  /** Projector-space effects of an element (aura, laser, arc). `ctx` is in projector pixels. */
  drawScreen(ctx: CanvasRenderingContext2D, layer: Layer, passes: ScreenPass[], opacity: number, env: FrameEnv) {
    if (passes.length === 0 || layer.points.length < 3) return;
    const st = this.state(layer.id);
    const outline = convexHull(layer.points);
    const center = centerOf(layer.points);
    const time = fxTime(env.now);
    for (const { fx, def, progress } of passes) {
      ctx.save();
      ctx.globalAlpha = opacity * Math.max(0, Math.min(1, fx.opacity));
      ctx.globalCompositeOperation = COMPOSITE[fx.blend] ?? 'source-over';
      try {
        def.renderScreen?.({
          ctx,
          scale: env.scale,
          layerId: layer.id,
          outline,
          center,
          centerOf: (id) => {
            const other = env.layers.find(l => l.id === id);
            return other && other.points.length ? centerOf(other.points) : null;
          },
          area: env.area,
          time,
          progress,
          params: resolveParams(fx, def),
          intensity: fx.intensity,
          color: this.resolveColor(fx, st, env, null),
          colorMode: fx.color.mode,
          seed: hashString(fx.id),
        });
      } catch (e) {
        console.warn(`Effect ${fx.type} failed`, e);
      }
      ctx.restore();
    }
  }
}

const reset2d = (c: CanvasRenderingContext2D) => {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.shadowBlur = 0;
  c.imageSmoothingEnabled = true;
};

const centerOf = (points: { x: number; y: number }[]) => {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
};
