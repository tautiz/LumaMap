import { ParamValue } from './types';

// Small helpers shared by the effects. Randomness is a hash of (seed, index), never Math.random(), so the
// editor and the projector window draw exactly the same sparks at the same moment.

export const rand = (seed: number, i: number): number => {
  let x = (seed ^ Math.imul(i + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
};

export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const num = (p: Record<string, ParamValue>, key: string, fallback = 0): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export const str = (p: Record<string, ParamValue>, key: string, fallback = ''): string => {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
};

export const bool = (p: Record<string, ParamValue>, key: string): boolean => p[key] === true;

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export const mixColor = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};

export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/** A soft round blob of one colour, drawn once and reused for fire, smoke, snow and glowing dots. */
const sprites = new Map<string, HTMLCanvasElement>();
export const softSprite = (color: string): HTMLCanvasElement => {
  let c = sprites.get(color);
  if (c) return c;
  if (sprites.size > 32) sprites.clear();
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.4, rgba(color, 0.5));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
};

/** A jagged lightning line from a to b (midpoint displacement). */
export const boltPath = (
  ax: number, ay: number, bx: number, by: number, seed: number, roughness: number, depth = 6,
): { x: number; y: number }[] => {
  let pts = [{ x: ax, y: ay }, { x: bx, y: by }];
  let offset = Math.hypot(bx - ax, by - ay) * 0.25 * roughness;
  let k = 0;
  for (let d = 0; d < depth; d++) {
    const next: { x: number; y: number }[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const o = (rand(seed, k++) - 0.5) * 2 * offset;
      next.push({ x: (p.x + q.x) / 2 - (dy / len) * o, y: (p.y + q.y) / 2 + (dx / len) * o }, q);
    }
    pts = next;
    offset /= 2;
  }
  return pts;
};

/** Strokes a path twice: a wide coloured glow, then a thin bright core. Sizes in the context's units. */
export const glowStroke = (
  ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string, width: number, glow: number, alpha: number,
) => {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 2.2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = mixColor(color, '#ffffff', 0.75);
  ctx.lineWidth = width * 0.8;
  ctx.stroke();
  ctx.restore();
};

/** Convex hull (monotone chain) of an element's points: its outline for halos and anchors. */
export const convexHull = (points: { x: number; y: number }[]) => {
  const pts = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
};
