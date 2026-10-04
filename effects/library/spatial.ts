import { registerEffect } from '../registry';
import { ParamDef, ScreenFxArgs } from '../types';
import { boltPath, glowStroke, num, str } from '../util';

// Effects drawn in the projector's space rather than inside the element: they can reach past its edges,
// or run between two elements. Sizes are in projector pixels; shadow blur is in device pixels, hence `scale`.

// Aura: a glow around the element's outline, drawn behind it.
let auraCanvas: HTMLCanvasElement | null = null;

registerEffect({
  id: 'aura', role: 'underlay', inputMode: 'none', space: 'screen', animated: p => typeof p.pulse === 'number' && p.pulse > 0,
  params: [
    { key: 'size', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'pulse', type: 'number', min: 0, max: 3, step: 0.05, default: 0.5 },
    { key: 'inside', type: 'bool', default: false },
  ],
  defaults: { color: { mode: 'element' } },
  renderScreen: ({ ctx, scale, outline, area, time, progress, params, intensity, color }) => {
    if (outline.length < 3) return;
    const margin = Math.min(area.w, area.h) * 0.05 * num(params, 'size', 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outline) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    minX -= margin * 2; minY -= margin * 2; maxX += margin * 2; maxY += margin * 2;
    const pw = Math.max(1, Math.ceil((maxX - minX) * scale));
    const ph = Math.max(1, Math.ceil((maxY - minY) * scale));

    if (!auraCanvas) auraCanvas = document.createElement('canvas');
    if (auraCanvas.width !== pw || auraCanvas.height !== ph) { auraCanvas.width = pw; auraCanvas.height = ph; }
    const g = auraCanvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    g.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    const path = () => {
      g.beginPath();
      outline.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
    };
    // Draw the shape far off to the side and only its shadow back in place: just the glow, no hard edge.
    const off = 100000;
    g.save();
    g.translate(-off, 0);
    g.shadowColor = color;
    g.shadowBlur = margin * scale;
    g.shadowOffsetX = off * scale;
    g.fillStyle = '#000';
    path();
    g.fill();
    g.fill();
    g.restore();
    if (params.inside !== true) {
      g.globalCompositeOperation = 'destination-out';
      path();
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }

    const pulse = num(params, 'pulse', 0.5);
    const breath = progress !== null ? Math.sin(Math.PI * progress) : pulse > 0 ? 0.65 + 0.35 * Math.sin(time * pulse * Math.PI * 2) : 1;
    ctx.globalAlpha *= (0.4 + 0.6 * intensity) * breath;
    ctx.drawImage(auraCanvas, minX, minY, maxX - minX, maxY - minY);
  },
});

const targetParams: ParamDef[] = [
  { key: 'target', type: 'layer', default: '' },
  { key: 'targetX', type: 'number', min: 0, max: 100, step: 1, default: 50 },
  { key: 'targetY', type: 'number', min: 0, max: 100, step: 1, default: 0 },
];

// From the element's centre to the chosen element's centre, or to a point given in % of the projector.
const endpoints = ({ center, centerOf, area, params }: ScreenFxArgs) => {
  const target = str(params, 'target');
  const to = (target && centerOf(target)) || { x: (num(params, 'targetX', 50) / 100) * area.w, y: (num(params, 'targetY') / 100) * area.h };
  return { from: center, to };
};

registerEffect({
  id: 'laser', role: 'spatial', inputMode: 'none', space: 'screen', animated: true,
  params: [
    ...targetParams,
    { key: 'width', type: 'number', min: 0.2, max: 5, step: 0.1, default: 1 },
    { key: 'flicker', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3 },
  ],
  defaults: { blend: 'add', color: { mode: 'custom', color: '#ff2d55' } },
  renderScreen: (a) => {
    const { ctx, scale, area, time, progress, params, intensity, color } = a;
    const { from, to } = endpoints(a);
    const m = Math.min(area.w, area.h);
    const flick = 1 - num(params, 'flicker', 0.3) * (0.5 + 0.5 * Math.sin(time * 47)) * 0.6;
    // As a signal the beam shoots out to the target, then fades.
    const reach = progress !== null ? Math.min(1, progress * 4) : 1;
    const end = { x: from.x + (to.x - from.x) * reach, y: from.y + (to.y - from.y) * reach };
    const alpha = (progress !== null ? Math.min(1, (1 - progress) * 3) : 1) * (0.5 + 0.5 * intensity);
    glowStroke(ctx, [from, end], color, m * 0.003 * num(params, 'width', 1) * flick, m * 0.02 * scale, alpha);
  },
});

registerEffect({
  id: 'arc', role: 'spatial', inputMode: 'none', space: 'screen', animated: true,
  params: [
    ...targetParams,
    { key: 'flicker', type: 'number', min: 1, max: 30, step: 1, default: 12 },
    { key: 'roughness', type: 'number', min: 0.1, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'thickness', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
  ],
  defaults: { blend: 'add', color: { mode: 'custom', color: '#9fd8ff' } },
  renderScreen: (a) => {
    const { ctx, scale, area, time, progress, params, intensity, color, seed } = a;
    const { from, to } = endpoints(a);
    const m = Math.min(area.w, area.h);
    const bucket = Math.floor(time * num(params, 'flicker', 12));
    const alpha = (progress !== null ? 1 - progress : 1) * (0.5 + 0.5 * intensity);
    for (let i = 0; i < 2; i++) {
      const pts = boltPath(from.x, from.y, to.x, to.y, seed + bucket * 7919 + i * 13, num(params, 'roughness', 0.6), 7);
      glowStroke(ctx, pts, color, m * 0.002 * num(params, 'thickness', 1) * (i ? 0.6 : 1), m * 0.02 * scale, alpha * (i ? 0.6 : 1));
    }
  },
});
