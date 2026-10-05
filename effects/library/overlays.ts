import { registerEffect } from '../registry';
import { TextureFxArgs } from '../types';
import { fitPeriod, wrap, fitRate, glowStroke, num, rand, rgba, str } from '../util';

// Overlays draw an extra layer that is laid over (or, with placement "under", behind) the picture.

// Electric border: crackling lines running round the element's edge.
registerEffect({
  id: 'electricBorder', role: 'overlay', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'inset', type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { key: 'roughness', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'flicker', type: 'number', min: 1, max: 30, step: 1, default: 12 },
    { key: 'thickness', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'lines', type: 'number', min: 1, max: 4, step: 1, default: 2 },
  ],
  loop: { kind: 'random', rates: p => [num(p, 'flicker', 12)] },
  defaults: { blend: 'add', color: { mode: 'element' } },
  renderTexture: ({ ctx, w, h, m, time, progress, params, intensity, color, seed, loop }) => {
    const inset = num(params, 'inset', 0.03) * m;
    const rough = num(params, 'roughness', 0.5) * m * 0.025;
    const bucket = Math.floor(time * fitRate(num(params, 'flicker', 12), loop));
    const lines = num(params, 'lines', 2);
    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
    const per = 2 * ((x1 - x0) + (y1 - y0));
    const n = Math.max(24, Math.round(per / (m * 0.015)));
    const at = (d: number) => {
      d = ((d % per) + per) % per;
      const top = x1 - x0, right = y1 - y0;
      if (d < top) return { x: x0 + d, y: y0, nx: 0, ny: -1 };
      d -= top;
      if (d < right) return { x: x1, y: y0 + d, nx: 1, ny: 0 };
      d -= right;
      if (d < top) return { x: x1 - d, y: y1, nx: 0, ny: 1 };
      d -= top;
      return { x: x0, y: y1 - d, nx: -1, ny: 0 };
    };
    ctx.globalCompositeOperation = 'lighter';
    const alpha = (progress !== null ? 1 - progress : 1) * (0.5 + 0.5 * intensity);
    for (let l = 0; l < lines; l++) {
      const s = seed + bucket * 7919 + l * 31;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = at((i / n) * per);
        const o = (rand(s, i % n) - 0.5) * 2 * rough;
        pts.push({ x: p.x + p.nx * o, y: p.y + p.ny * o });
      }
      glowStroke(ctx, pts, color, m * 0.003 * num(params, 'thickness', 1), m * 0.025, alpha);
    }
  },
});

// Edge glow: soft light along the inside of the element's edge.
const edgeGlow = ({ ctx, w, h, m, progress, params, intensity, color }: TextureFxArgs) => {
  const size = num(params, 'size', 1);
  ctx.save();
  ctx.globalAlpha = (progress !== null ? 1 - progress : 1) * (0.4 + 0.6 * intensity);
  ctx.shadowColor = color;
  ctx.shadowBlur = m * 0.06 * size;
  ctx.strokeStyle = color;
  ctx.lineWidth = m * 0.015 * size;
  for (let i = 0; i < 2; i++) ctx.strokeRect(0, 0, w, h);
  ctx.restore();
};

registerEffect({
  id: 'edgeGlow', role: 'overlay', inputMode: 'none', space: 'texture', animated: false,
  params: [{ key: 'size', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 }],
  defaults: { blend: 'add', color: { mode: 'element' } },
  renderTexture: edgeGlow,
});

// Glow (bloom): a blurred, brightened copy of everything before it. With nothing before it, it lights the edges.
registerEffect({
  id: 'glow', role: 'overlay', inputMode: 'optional', space: 'texture', animated: false,
  params: [
    { key: 'size', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'strength', type: 'number', min: 0.2, max: 3, step: 0.1, default: 0.8 },
  ],
  defaults: { blend: 'add', color: { mode: 'input' } },
  renderTexture: (a) => {
    const { ctx, input, w, h, m, params, intensity, color, colorMode, scratch } = a;
    if (!input) return edgeGlow(a);
    // Blurring a quarter-size copy is ~16x cheaper and looks the same for a glow.
    const sw = Math.max(1, Math.round(w / 4));
    const sh = Math.max(1, Math.round(h / 4));
    const s = scratch(0);
    s.filter = `blur(${(m * 0.012 * num(params, 'size', 1)).toFixed(2)}px)`;
    s.drawImage(input, 0, 0, sw, sh);
    s.filter = 'none';
    // "Input colour" keeps the picture's own colours; any other colour source tints the glow.
    if (colorMode !== 'input') {
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = color;
      s.fillRect(0, 0, sw, sh);
    }
    let strength = num(params, 'strength', 0.8) * intensity;
    ctx.globalCompositeOperation = 'lighter';
    while (strength > 0) {
      ctx.globalAlpha = Math.min(1, strength);
      ctx.drawImage(s.canvas, 0, 0, sw, sh, 0, 0, w, h);
      strength -= 1;
    }
  },
});

// Light sweep: a bright band that passes over the element every few seconds.
registerEffect({
  id: 'lightSweep', role: 'overlay', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'period', type: 'number', min: 0.5, max: 20, step: 0.5, default: 4 },
    { key: 'width', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.25 },
    { key: 'angle', type: 'number', min: 0, max: 180, step: 5, default: 30 },
  ],
  loop: { kind: 'loop', rates: p => [1 / num(p, 'period', 4)] },
  defaults: { blend: 'add', color: { mode: 'custom', color: '#ffffff' } },
  renderTexture: ({ ctx, w, h, m, time, progress, params, intensity, color, loop }) => {
    const p = progress ?? wrap(time / fitPeriod(num(params, 'period', 4), loop), 1);
    const half = Math.hypot(w, h) / 2;
    const bw = num(params, 'width', 0.25) * m;
    const x = -half - bw + p * (2 * half + 2 * bw);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((num(params, 'angle', 30) * Math.PI) / 180);
    const g = ctx.createLinearGradient(x - bw, 0, x + bw, 0);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.5, rgba(color, 0.4 + 0.6 * intensity));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - bw, -half, bw * 2, half * 2);
  },
});

registerEffect({
  id: 'scanlines', role: 'overlay', inputMode: 'none', space: 'texture',
  animated: p => typeof p.speed === 'number' && p.speed > 0,
  params: [
    { key: 'spacing', type: 'number', min: 0.003, max: 0.05, step: 0.001, default: 0.01 },
    { key: 'speed', type: 'number', min: 0, max: 2, step: 0.05, default: 0.2 },
  ],
  // The lines move speed x 0.1 x the element's size per second, and look the same again after one gap.
  loop: { kind: 'loop', rates: p => [(num(p, 'speed') * 0.1) / Math.max(0.001, num(p, 'spacing', 0.01))] },
  defaults: { blend: 'normal', opacity: 0.5, color: { mode: 'custom', color: '#000000' } },
  renderTexture: ({ ctx, w, h, m, time, params, intensity, color, loop }) => {
    const gap = Math.max(2, num(params, 'spacing', 0.01) * m);
    const off = wrap(time * fitRate((num(params, 'speed') * m * 0.1) / gap, loop) * gap, gap);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3 + 0.7 * intensity;
    for (let y = off - gap; y < h; y += gap) ctx.fillRect(0, y, w, gap / 2);
  },
});

// Flash: the whole element lights up. As a signal it flashes once; running all the time it flashes at random.
registerEffect({
  id: 'flash', role: 'overlay', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'rate', type: 'number', min: 0.2, max: 10, step: 0.1, default: 2 },
    { key: 'chance', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2 },
  ],
  loop: { kind: 'random', rates: p => [num(p, 'rate', 2)] },
  defaults: { blend: 'add', color: { mode: 'custom', color: '#ffffff' }, trigger: { mode: 'signal', duration: 0.6 } },
  renderTexture: ({ ctx, w, h, time, progress, params, intensity, color, seed, loop }) => {
    let a: number;
    if (progress !== null) a = (1 - progress) ** 2;
    else {
      const t = time * fitRate(num(params, 'rate', 2), loop);
      const b = Math.floor(t);
      a = rand(seed, b) < num(params, 'chance', 0.2) ? (1 - (t - b)) ** 3 : 0;
    }
    if (a <= 0.003) return;
    ctx.globalAlpha = a * intensity;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  },
});

// Shockwave: a ring racing out from the middle.
registerEffect({
  id: 'shockwave', role: 'overlay', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'period', type: 'number', min: 0.3, max: 10, step: 0.1, default: 2 },
    { key: 'thickness', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'origin', type: 'select', options: ['center', 'bottom', 'top'], default: 'center' },
  ],
  loop: { kind: 'loop', rates: p => [1 / num(p, 'period', 2)] },
  defaults: { blend: 'add', color: { mode: 'element' }, trigger: { mode: 'signal', duration: 1.2 } },
  renderTexture: ({ ctx, w, h, m, time, progress, params, intensity, color, loop }) => {
    const p = progress ?? wrap(time / fitPeriod(num(params, 'period', 2), loop), 1);
    const origin = str(params, 'origin', 'center');
    const cy = origin === 'bottom' ? h : origin === 'top' ? 0 : h / 2;
    const r = p * Math.hypot(w, h) * (origin === 'center' ? 0.6 : 1);
    ctx.globalAlpha = (1 - p) * (0.4 + 0.6 * intensity);
    ctx.shadowColor = color;
    ctx.shadowBlur = m * 0.04;
    ctx.strokeStyle = color;
    ctx.lineWidth = m * 0.03 * num(params, 'thickness', 1) * (1 - p * 0.7);
    ctx.beginPath();
    ctx.arc(w / 2, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  },
});
