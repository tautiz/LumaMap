import { registerEffect } from '../registry';
import { ParamValue, TextureFxArgs } from '../types';
import { bool, fitRate, num, rand, str, wrap } from '../util';

// Modifiers change the picture they get (input) and draw the changed picture. Without input they draw nothing.

const COLS_SPEED = 1.13;
const waveLoop = { kind: 'loop' as const, rates: (p: Record<string, ParamValue>) => [num(p, 'speed'), num(p, 'speed') * COLS_SPEED] };

// Water ripple and slow wave: the picture is cut into thin strips that are pushed sideways along a sine wave.
const displace = (a: TextureFxArgs, amp: number, wavelength: number, speed: number, direction: string) => {
  const { ctx, input, w, h, m, time, progress, scratch, loop } = a;
  if (!input) return;
  const env = progress !== null ? Math.sin(Math.PI * progress) : 1;
  const ampPx = amp * m * 0.04 * env;
  const k = (Math.PI * 2) / Math.max(0.02, wavelength * m * 0.2);
  // Rows and columns move at slightly different speeds (x 1.13), so the wave does not look mechanical.
  const phRows = time * fitRate(speed, loop) * Math.PI * 2;
  const phCols = time * fitRate(speed * COLS_SPEED, loop) * Math.PI * 2;
  const strip = Math.max(2, Math.round(m / 180));

  // Each strip is stretched by the wave's height on both ends, so pushing it never opens a gap at the edges.
  const rows = (src: CanvasImageSource, dst: CanvasRenderingContext2D) => {
    for (let y = 0; y < h; y += strip) {
      const dx = Math.sin(y * k + phRows) * ampPx;
      dst.drawImage(src, 0, y, w, strip, dx - ampPx, y, w + ampPx * 2, strip);
    }
  };
  const cols = (src: CanvasImageSource, dst: CanvasRenderingContext2D) => {
    for (let x = 0; x < w; x += strip) {
      const dy = Math.sin(x * k + phCols) * ampPx;
      dst.drawImage(src, x, 0, strip, h, x, dy - ampPx, strip, h + ampPx * 2);
    }
  };
  if (direction === 'vertical') cols(input, ctx);
  else if (direction === 'both') {
    const s = scratch(0);
    rows(input, s);
    cols(s.canvas, ctx);
  } else rows(input, ctx);
};

registerEffect({
  id: 'ripple', role: 'modifier', inputMode: 'required', space: 'texture', animated: true,
  params: [
    { key: 'amount', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5 },
    { key: 'wavelength', type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.9 },
    { key: 'speed', type: 'number', min: 0, max: 3, step: 0.05, default: 0.8 },
    { key: 'direction', type: 'select', options: ['horizontal', 'vertical', 'both'], default: 'both' },
  ],
  loop: waveLoop,
  renderTexture: a => displace(a, num(a.params, 'amount') * a.intensity * 1.4, num(a.params, 'wavelength', 0.9), num(a.params, 'speed'), str(a.params, 'direction')),
});

registerEffect({
  id: 'wave', role: 'modifier', inputMode: 'required', space: 'texture', animated: true,
  params: [
    { key: 'amount', type: 'number', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'wavelength', type: 'number', min: 0.5, max: 8, step: 0.1, default: 3 },
    { key: 'speed', type: 'number', min: 0, max: 2, step: 0.05, default: 0.2 },
    { key: 'direction', type: 'select', options: ['horizontal', 'vertical', 'both'], default: 'vertical' },
  ],
  loop: waveLoop,
  renderTexture: a => displace(a, num(a.params, 'amount') * a.intensity * 1.4, num(a.params, 'wavelength', 3), num(a.params, 'speed'), str(a.params, 'direction')),
});

// Glitch: random horizontal slices jump sideways a few times a second.
registerEffect({
  id: 'glitch', role: 'modifier', inputMode: 'required', space: 'texture', animated: true,
  params: [
    { key: 'amount', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'rate', type: 'number', min: 1, max: 30, step: 1, default: 8 },
    { key: 'slices', type: 'number', min: 1, max: 30, step: 1, default: 8 },
  ],
  loop: { kind: 'random', rates: p => [num(p, 'rate', 8)] },
  renderTexture: ({ ctx, input, w, h, time, progress, params, intensity, seed, loop }) => {
    if (!input) return;
    ctx.drawImage(input, 0, 0);
    const bucket = Math.floor(time * fitRate(num(params, 'rate', 8), loop));
    const s = seed + bucket * 7919;
    const amount = num(params, 'amount', 0.5) * intensity * (progress !== null ? 1 - progress : 1);
    if (progress === null && rand(s, 0) > 0.3 + amount * 0.7) return; // Quiet moments in between
    const n = num(params, 'slices', 8);
    for (let i = 0; i < n; i++) {
      const y = rand(s, i * 3 + 1) * h;
      const sh = Math.max(2, rand(s, i * 3 + 2) * h * 0.08);
      const dx = (rand(s, i * 3 + 3) - 0.5) * w * 0.2 * amount;
      ctx.clearRect(0, y, w, sh);
      ctx.drawImage(input, 0, y, w, sh, dx, y, w, sh);
    }
  },
});

// RGB split: the red, green and blue parts of the picture drift apart.
const JITTER_RATE = 12; // Jumps per second
registerEffect({
  id: 'rgbSplit', role: 'modifier', inputMode: 'required', space: 'texture',
  animated: p => p.jitter === true,
  params: [
    { key: 'amount', type: 'number', min: 0, max: 1, step: 0.02, default: 0.3 },
    { key: 'angle', type: 'number', min: 0, max: 360, step: 5, default: 0 },
    { key: 'jitter', type: 'bool', default: true },
  ],
  loop: { kind: 'random', rates: () => [JITTER_RATE] },
  renderTexture: ({ ctx, input, w, h, m, time, params, intensity, seed, scratch, loop }) => {
    if (!input) return;
    let amount = num(params, 'amount', 0.3) * intensity * m * 0.03;
    let ang = (num(params, 'angle') * Math.PI) / 180;
    if (bool(params, 'jitter')) {
      const b = Math.floor(time * fitRate(JITTER_RATE, loop));
      amount *= 0.5 + rand(seed, b);
      ang += (rand(seed, b + 1) - 0.5) * 0.6;
    }
    const channels: [string, number][] = [['#ff0000', -1], ['#00ff00', 0], ['#0000ff', 1]];
    for (const [c, dir] of channels) {
      const s = scratch(0);
      s.drawImage(input, 0, 0);
      s.globalCompositeOperation = 'multiply';
      s.fillStyle = c;
      s.fillRect(0, 0, w, h);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(input, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(s.canvas, Math.cos(ang) * amount * dir, Math.sin(ang) * amount * dir);
    }
  },
});

registerEffect({
  id: 'pixelate', role: 'modifier', inputMode: 'required', space: 'texture', animated: false,
  params: [{ key: 'size', type: 'number', min: 0.002, max: 0.1, step: 0.002, default: 0.02 }],
  renderTexture: ({ ctx, input, w, h, m, params, intensity, scratch }) => {
    if (!input) return;
    const cell = Math.max(1, num(params, 'size', 0.02) * m * (0.3 + intensity));
    const sw = Math.max(1, Math.round(w / cell));
    const sh = Math.max(1, Math.round(h / cell));
    const s = scratch(0);
    s.drawImage(input, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.canvas, 0, 0, sw, sh, 0, 0, w, h);
  },
});

registerEffect({
  id: 'blur', role: 'modifier', inputMode: 'required', space: 'texture', animated: false,
  params: [{ key: 'amount', type: 'number', min: 0, max: 1, step: 0.02, default: 0.3 }],
  renderTexture: ({ ctx, input, m, params, intensity }) => {
    if (!input) return;
    ctx.filter = `blur(${(num(params, 'amount', 0.3) * intensity * m * 0.04).toFixed(2)}px)`;
    ctx.drawImage(input, 0, 0);
    ctx.filter = 'none';
  },
});

// Colour shift: turn the hue, change saturation and brightness, and optionally wash the picture in the effect colour.
registerEffect({
  id: 'colorShift', role: 'modifier', inputMode: 'required', space: 'texture',
  animated: p => typeof p.cycle === 'number' && p.cycle > 0,
  params: [
    { key: 'hue', type: 'number', min: -180, max: 180, step: 5, default: 0 },
    { key: 'cycle', type: 'number', min: 0, max: 1, step: 0.02, default: 0 },
    { key: 'saturation', type: 'number', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'brightness', type: 'number', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'tint', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  loop: { kind: 'loop', rates: p => [num(p, 'cycle')] },
  defaults: { color: { mode: 'custom', color: '#2d6bff' } },
  renderTexture: ({ ctx, input, w, h, time, params, intensity, color, scratch, loop }) => {
    if (!input) return;
    const hue = wrap(num(params, 'hue') + time * fitRate(num(params, 'cycle'), loop) * 360, 360);
    ctx.filter = `hue-rotate(${hue.toFixed(1)}deg) saturate(${num(params, 'saturation', 1)}) brightness(${num(params, 'brightness', 1)})`;
    ctx.drawImage(input, 0, 0);
    ctx.filter = 'none';
    const tint = num(params, 'tint') * intensity;
    if (tint <= 0) return;
    const s = scratch(0);
    s.drawImage(ctx.canvas, 0, 0);
    s.globalCompositeOperation = 'color';
    s.fillStyle = color;
    s.fillRect(0, 0, w, h);
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(ctx.canvas, 0, 0);
    ctx.globalAlpha = tint;
    ctx.drawImage(s.canvas, 0, 0);
  },
});

// Pulse: the picture breathes, fading or brightening in a rhythm. As a signal it pulses once.
registerEffect({
  id: 'pulse', role: 'modifier', inputMode: 'required', space: 'texture', animated: true,
  params: [
    { key: 'speed', type: 'number', min: 0.05, max: 5, step: 0.05, default: 0.8 },
    { key: 'depth', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'style', type: 'select', options: ['fade', 'brighten'], default: 'fade' },
  ],
  loop: { kind: 'loop', rates: p => [num(p, 'speed', 0.8)] },
  renderTexture: ({ ctx, input, time, progress, params, intensity, loop }) => {
    if (!input) return;
    const v = progress !== null ? Math.sin(Math.PI * progress) : 0.5 + 0.5 * Math.sin(time * fitRate(num(params, 'speed', 0.8), loop) * Math.PI * 2);
    const depth = num(params, 'depth', 0.5) * intensity;
    if (str(params, 'style') === 'brighten') {
      ctx.drawImage(input, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = depth * v;
      ctx.drawImage(input, 0, 0);
    } else {
      ctx.globalAlpha = 1 - depth * v;
      ctx.drawImage(input, 0, 0);
    }
  },
});
