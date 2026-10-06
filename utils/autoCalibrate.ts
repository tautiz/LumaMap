import { PhotoCalibration, Point } from '../types';
import { bendPoint, cornersUsable, straightenPoint } from './calibration';

// Finds the projector picture on two phone camera frames: one taken while the projector shows plain
// white, one while it shows black. What got brighter between them is the projected picture, whatever
// else lights the room. Its outline gives the four corners; how much its straight edges are bent gives
// the lens correction (see utils/calibration.ts for both).

export type DetectFailure = 'noLight' | 'edge' | 'shape';
export type DetectResult = { ok: true; calibration: PhotoCalibration } | { ok: false; reason: DetectFailure };

interface Gray { w: number; h: number; data: Float32Array }

const WORK_SIZE = 1000; // Longest side looked at; enough for corners to a fraction of a percent

/** Brightness (0-255) of an image, made smaller to `WORK_SIZE` by averaging. */
export const toGray = (img: ImageData, maxSide = WORK_SIZE): Gray => {
  const f = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const data = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < f; yy++) {
        let i = ((y * f + yy) * img.width + x * f) * 4;
        for (let xx = 0; xx < f; xx++, i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      data[y * w + x] = sum / (f * f);
    }
  }
  return { w, h, data };
};

// Threshold that best splits the values into two groups (Otsu's method).
const otsu = (values: Float32Array): number => {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return bestT + 0.5;
};

// Best straight line through points: returns how far off they are (sum of squared distances) and the line.
interface Line { cx: number; cy: number; dx: number; dy: number }
const fitLine = (pts: Point[]): { line: Line; error: number } => {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const x = p.x - cx, y = p.y - cy;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let error = 0;
  for (const p of pts) {
    const off = (p.x - cx) * -dy + (p.y - cy) * dx;
    error += off * off;
  }
  return { line: { cx, cy, dx, dy }, error };
};

const intersect = (a: Line, b: Line): Point | null => {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / det;
  return { x: a.cx + a.dx * t, y: a.cy + a.dy * t };
};

const segmentDistance = (p: Point, a: Point, b: Point) => {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return { d: Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t), t };
};

/**
 * The calibration, in the pixels of the full-size frames (`fullW` x `fullH`).
 * `white` and `black` are the two frames' brightness, already made smaller with `toGray`.
 */
export const detectProjection = (white: Gray, black: Gray, fullW: number, fullH: number): DetectResult => {
  const { w, h } = white;
  const n = w * h;
  const diff = new Float32Array(n);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    diff[i] = Math.max(0, white.data[i] - black.data[i]);
    if (diff[i] > maxDiff) maxDiff = diff[i];
  }
  if (maxDiff < 30) return { ok: false, reason: 'noLight' };
  const threshold = Math.max(15, otsu(diff));

  // The largest lit patch is the projector picture (small reflections and screens are left out).
  const label = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || diff[start] <= threshold) continue;
    label[start] = start;
    stack.push(start);
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of near) {
        if (j >= 0 && label[j] === -1 && diff[j] > threshold) { label[j] = start; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = start; }
  }
  if (bestSize < n * 0.02) return { ok: false, reason: 'noLight' };

  // Its outline. If it runs into the frame's edge, part of the picture was not photographed.
  const outline: Point[] = [];
  let touchesEdge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (label[i] !== best) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { touchesEdge++; continue; }
      if (label[i - 1] !== best || label[i + 1] !== best || label[i - w] !== best || label[i + w] !== best) {
        outline.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  if (touchesEdge > (w + h) * 0.01) return { ok: false, reason: 'edge' };

  // Rough corners: the outline points furthest out along the diagonals.
  const rough = [
    (p: Point) => -(p.x + p.y), (p: Point) => p.x - p.y, (p: Point) => p.x + p.y, (p: Point) => p.y - p.x,
  ].map(score => outline.reduce((a, b) => (score(b) > score(a) ? b : a)));
  if (!cornersUsable(rough)) return { ok: false, reason: 'shape' };

  // Outline points along each edge, leaving out the blurred ends next to the corners.
  const edges: Point[][] = [[], [], [], []];
  for (const p of outline) {
    let bestEdge = -1, bestD = Infinity, bestT = 0;
    for (let e = 0; e < 4; e++) {
      const { d, t } = segmentDistance(p, rough[e], rough[(e + 1) % 4]);
      if (d < bestD) { bestD = d; bestEdge = e; bestT = t; }
    }
    if (bestT > 0.06 && bestT < 0.94) edges[bestEdge].push(p);
  }
  if (edges.some(e => e.length < 10)) return { ok: false, reason: 'shape' };

  // The lens correction that makes the four edges straightest.
  const straightness = (lens: number) => edges.reduce(
    (sum, pts) => sum + fitLine(pts.map(p => straightenPoint(p, lens, w, h))).error / pts.length, 0);
  let lens = 0, bestErr = straightness(0);
  const noLensErr = bestErr;
  for (let k = -0.3; k <= 0.3001; k += 0.01) {
    const e = straightness(k);
    if (e < bestErr) { bestErr = e; lens = k; }
  }
  for (let k = lens - 0.01; k <= lens + 0.01; k += 0.001) {
    const e = straightness(k);
    if (e < bestErr) { bestErr = e; lens = k; }
  }
  // A tiny gain is noise, not a bent lens.
  if (bestErr > noLensErr * 0.8) lens = 0;
  lens = Math.round(lens * 1000) / 1000;

  // Exact corners: where the straightened edges cross, put back onto the photo.
  const lines = edges.map(pts => fitLine(pts.map(p => straightenPoint(p, lens, w, h))).line);
  const corners: Point[] = [];
  for (let c = 0; c < 4; c++) {
    const p = intersect(lines[(c + 3) % 4], lines[c]);
    if (!p) return { ok: false, reason: 'shape' };
    const bent = bendPoint(p, lens, w, h);
    corners.push({ x: (bent.x * fullW) / w, y: (bent.y * fullH) / h });
  }
  if (!cornersUsable(corners)) return { ok: false, reason: 'shape' };
  return { ok: true, calibration: { corners, lens } };
};

/** Average brightness (0-255), to tell whether a photo is too dark to be useful. */
export const meanBrightness = (g: Gray) => {
  let s = 0;
  for (const v of g.data) s += v;
  return s / g.data.length;
};
