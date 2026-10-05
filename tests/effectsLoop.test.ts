import { beforeAll, describe, expect, it } from 'vitest';
import type { Layer } from '../types';

// The effects draw on a canvas. Here they draw on a recording stand-in instead, so the test can compare
// exactly what an effect draws at the start of a loop and one loop later.

type Rec = string[];
const fmt = (v: unknown): string =>
  typeof v === 'number' ? (Math.abs(v) < 1e-6 ? '0' : v.toFixed(4)) : typeof v === 'object' && v !== null ? 'obj' : String(v);

const recordingCanvas = (log: Rec, w = 320, h = 200): any => {
  const canvas: any = { width: w, height: h };
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({ canvas } as any, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in props) return props[key as string];
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(64) });
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'createPattern' || key === 'createLinearGradient' || key === 'createRadialGradient') {
        return (...args: unknown[]) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); return { addColorStop: (...a: unknown[]) => log.push(`stop(${a.map(fmt).join(',')})`) }; };
      }
      return (...args: unknown[]) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); };
    },
    set(target, key, value) {
      if (key === 'canvas') target.canvas = value;
      else { props[key as string] = value; log.push(`${String(key)}=${fmt(value)}`); }
      return true;
    },
  });
  canvas.getContext = () => ctx;
  return canvas;
};

let fx: typeof import('../effects');
let util: typeof import('../effects/util');

beforeAll(async () => {
  // Sprites and noise tiles are made with document.createElement('canvas').
  (globalThis as any).document = { createElement: () => recordingCanvas([]) };
  fx = await import('../effects');
  util = await import('../effects/util');
});

/** Everything the effect draws at `time`, with the export loop set to `loop` seconds. */
const draw = (type: string, time: number, loop: number | null, params: Record<string, unknown> = {}): Rec => {
  const def = fx.getEffect(type)!;
  const inst = fx.createEffect(type, { params: params as any });
  const log: Rec = [];
  const scratchLog: Rec = [];
  const common = {
    time, progress: null, params: fx.resolveParams(inst, def), intensity: 0.7, color: '#00e5ff', colorMode: 'custom' as const,
    seed: util.hashString('fixed-id'), loop,
  };
  if (def.space === 'texture') {
    const target = recordingCanvas(log);
    def.renderTexture!({
      ...common, ctx: target.getContext('2d'), input: recordingCanvas([]), w: 320, h: 200, m: 200,
      scratch: () => recordingCanvas(scratchLog).getContext('2d'),
    });
  } else {
    const target = recordingCanvas(log);
    def.renderScreen!({
      ...common, ctx: target.getContext('2d'), scale: 1, layerId: 'a',
      outline: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 80 }, { x: 10, y: 80 }], center: { x: 60, y: 45 },
      centerOf: () => ({ x: 300, y: 300 }), area: { w: 2363, h: 1320 },
    });
  }
  return [...log, '--scratch--', ...scratchLog];
};

// Settings that make every effect move (some only move with a setting switched on).
const MOVING: Record<string, Record<string, unknown>> = {
  rgbSplit: { jitter: true }, colorShift: { cycle: 0.3 }, radialReveal: { animate: true }, wipe: { animate: true },
  noiseReveal: { animate: true }, scanlines: { speed: 0.4 }, aura: { pulse: 0.5 },
};

describe('fitting speeds to a loop', () => {
  it('fits a whole number of cycles, at least one, and leaves speeds alone outside an export', () => {
    expect(util.fitRate(0.8, 10)).toBeCloseTo(0.8);
    expect(util.fitRate(0.3, 10) * 10).toBe(3);
    expect(util.fitRate(0.04, 10) * 10).toBe(1); // Slower than one cycle per loop: one cycle
    expect(util.fitRate(0.77, null)).toBe(0.77);
    expect(util.fitRate(0, 10)).toBe(0);
    expect(util.fitPeriod(4, 10)).toBeCloseTo(10 / 3); // 2.5 cycles -> 3 (rounding half up)
    expect((util.fitAngular(1.3, 4) * 4) / (2 * Math.PI)).toBeCloseTo(1);
  });
});

describe('effects in a looping export', () => {
  const periodicKinds = new Set(['loop']);
  const particleIds = ['sparks', 'particles', 'fire', 'smoke', 'snow'];

  it('every effect that moves says how it loops', () => {
    for (const def of fx.listEffects()) {
      const params = { ...fx.resolveParams(fx.createEffect(def.id), def), ...MOVING[def.id] } as any;
      const moves = typeof def.animated === 'function' ? def.animated(params) : def.animated;
      if (moves) expect(def.loop, def.id).toBeDefined();
    }
  });

  for (const loop of [4, 3.7, 10, 1.5]) {
    it(`'loop' effects and particles come back to exactly where they started (${loop} s loop)`, () => {
      for (const def of fx.listEffects()) {
        if (!def.loop || !(periodicKinds.has(def.loop.kind) || particleIds.includes(def.id))) continue;
        const params = MOVING[def.id] ?? {};
        expect(draw(def.id, loop, loop, params), def.id).toEqual(draw(def.id, 0, loop, params));
        // ...and from any moment, one loop later
        expect(draw(def.id, 1.234 + loop, loop, params), def.id).toEqual(draw(def.id, 1.234, loop, params));
      }
    });
  }

  it('without fitting, the same effects generally do not come back after an arbitrary length', () => {
    const changed = ['pulse', 'caustics', 'ripple', 'lightSweep', 'fire'].filter(id => JSON.stringify(draw(id, 3.7, null)) !== JSON.stringify(draw(id, 0, null)));
    expect(changed.length).toBeGreaterThanOrEqual(4);
  });

  it("'random' effects change a whole number of times per loop, so the loop's end is just one more change", () => {
    for (const def of fx.listEffects()) {
      if (def.loop?.kind !== 'random') continue;
      const params = { ...fx.resolveParams(fx.createEffect(def.id), def), ...MOVING[def.id] } as any;
      for (const r of def.loop.rates(params)) {
        const n = util.fitRate(r, 3.7) * 3.7;
        expect(Math.abs(n - Math.round(n)), `${def.id} ${r}`).toBeLessThan(1e-9);
      }
    }
  });

  it('random effects keep their seed: the same moment always draws the same', () => {
    for (const id of ['glitch', 'lightning', 'electricBorder', 'arc', 'sparks']) {
      expect(draw(id, 2.2, 6)).toEqual(draw(id, 2.2, 6));
    }
  });
});

describe('checking effects before an export', () => {
  const layer = (id: string, effects: ReturnType<typeof fx.createEffect>[], extra: Partial<Layer> = {}): Layer => ({
    id, name: `El ${id}`, visible: true, locked: false, opacity: 1, source: null, points: [],
    playback: { isPlaying: true, volume: 1, isMuted: true, currentTime: 0, duration: 0 }, effects, ...extra,
  });

  it('a layer without effects, and still effects, raise nothing', () => {
    const c = fx.checkEffectsForLoop([layer('a', []), layer('b', [fx.createEffect('blur'), fx.createEffect('edgeGlow')])], 10);
    expect(c.issues).toEqual([]);
    expect(c.effects.map(e => e.status)).toEqual(['still', 'still']);
  });

  it('loop and random effects are recognised', () => {
    const c = fx.checkEffectsForLoop([layer('a', [fx.createEffect('pulse'), fx.createEffect('glitch'), fx.createEffect('sparks')])], 10);
    expect(c.effects.map(e => e.status)).toEqual(['loop', 'random', 'random']);
    expect(c.issues).toEqual([]);
    expect(c.skip.size).toBe(0);
  });

  it('an effect with no way to loop is a warning and is drawn without fitting', () => {
    fx.registerEffect({ id: 'testNoLoop', role: 'overlay', inputMode: 'none', space: 'texture', animated: true, params: [], renderTexture: () => {} });
    const e = fx.createEffect('testNoLoop');
    const c = fx.checkEffectsForLoop([layer('a', [e])], 10);
    expect(c.issues).toMatchObject([{ effectId: e.id, layerName: 'El a', issue: 'cannotLoop' }]);
    expect(c.skip.has(e.id)).toBe(true);
  });

  it('an effect far slower than the loop is reported instead of being forced', () => {
    const slow = fx.createEffect('lightSweep', { params: { period: 20 } });
    const c = fx.checkEffectsForLoop([layer('a', [slow])], 2);
    expect(c.issues).toMatchObject([{ issue: 'tooSlow' }]);
    expect(c.issues[0].speedChange).toBeCloseTo(9); // 10 times faster
    expect(fx.checkEffectsForLoop([layer('a', [slow])], 40).issues).toEqual([]); // Fits a 40 s loop twice
  });

  it('signal effects are reported (they are not in the video), but nothing is skipped for them', () => {
    const flash = fx.createEffect('flash'); // Defaults to running on a signal
    const c = fx.checkEffectsForLoop([layer('a', [flash])], 10);
    expect(c.issues).toMatchObject([{ issue: 'signal' }]);
    expect(c.skip.size).toBe(0);
  });

  it('several problems on several elements are all listed; turned off and hidden ones are not', () => {
    const a = fx.createEffect('testNoLoop');
    const b = fx.createEffect('caustics');
    const off = fx.createEffect('testNoLoop', { enabled: false });
    const hidden = fx.createEffect('testNoLoop');
    const c = fx.checkEffectsForLoop([layer('a', [a, off]), layer('b', [b]), layer('c', [hidden], { visible: false })], 3);
    expect(c.issues.map(i => [i.layerId, i.issue])).toEqual([['a', 'cannotLoop'], ['b', 'tooSlow']]);
  });

  it('palette colours count as movement', () => {
    const glow = fx.createEffect('pulse', { color: { mode: 'palette', palette: ['#ff0000', '#00ff00'] } });
    // Two colours, 2 s each: a 4 s cycle. In a 1 s loop it would have to go 4 times faster.
    expect(fx.checkEffectsForLoop([layer('a', [glow])], 1).issues).toMatchObject([{ issue: 'tooSlow' }]);
    expect(fx.checkEffectsForLoop([layer('a', [glow])], 8).issues).toEqual([]);
  });

  it('"turn off" disables just that effect', () => {
    const a = fx.createEffect('testNoLoop');
    const b = fx.createEffect('pulse');
    const [l] = fx.disableEffects([layer('a', [a, b])], new Set([a.id]));
    expect(l.effects!.map(e => e.enabled)).toEqual([false, true]);
    expect(fx.checkEffectsForLoop([l], 10).issues).toEqual([]);
  });
});
