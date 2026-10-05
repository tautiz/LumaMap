import { PhotoCalibration, Point } from '../types';

// Wall photo calibration.
//
// A phone photo never lines up with the projector's picture, even when taken right at the lens: the
// camera sees a wider area, has a different shape (4:3 against 16:9), looks from a slightly different
// spot and bends straight lines near the edges. So the photo is not just scaled into the projector area.
// Instead the projector shows a test pattern, the wall is photographed with it, and the four corners of
// the projected picture are marked on the photo. From those the photo is warped (perspective plus an
// optional lens correction) so every point of it lands on the projector pixel that lights that spot.

export type Homography = number[]; // 3x3, row by row

// Corners of the projector picture, in the order they are marked: top left, top right, bottom right, bottom left.
export const projectorCorners = (w: number, h: number): Point[] => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];

/** The perspective transform that carries the four `from` points onto the four `to` points. */
export const solveHomography = (from: Point[], to: Point[]): Homography | null => {
  // Eight equations, eight unknowns (the last entry is fixed at 1).
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    a.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    a.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null; // Three points on one line: no answer
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = a.map((row, i) => row[8] / row[i]);
  return [...h, 1];
};

export const applyHomography = (m: Homography, p: Point): Point => {
  const d = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / d, y: (m[3] * p.x + m[4] * p.y + m[5]) / d };
};

export const invertHomography = (m: Homography): Homography | null => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
};

// --- Lens bend ---
//
// Phone lenses bend straight lines into slight curves, most at the edges. `lens` is the usual one-number
// radial model: a point at distance r from the photo centre (r = 1 at a corner) is moved to r * (1 + lens * r²).

interface LensFrame { cx: number; cy: number; radius: number }
const lensFrame = (w: number, h: number): LensFrame => ({ cx: w / 2, cy: h / 2, radius: Math.hypot(w, h) / 2 });

/** From where a point would be with a perfect lens to where it is on the photo. */
export const bendPoint = (p: Point, lens: number, w: number, h: number): Point => {
  if (!lens) return p;
  const { cx, cy, radius } = lensFrame(w, h);
  const dx = (p.x - cx) / radius, dy = (p.y - cy) / radius;
  const f = 1 + lens * (dx * dx + dy * dy);
  return { x: cx + dx * f * radius, y: cy + dy * f * radius };
};

/** The other way: from a point on the photo to where it would be with a perfect lens. */
export const straightenPoint = (p: Point, lens: number, w: number, h: number): Point => {
  if (!lens) return p;
  const { cx, cy, radius } = lensFrame(w, h);
  const bx = (p.x - cx) / radius, by = (p.y - cy) / radius;
  let ux = bx, uy = by;
  for (let i = 0; i < 20; i++) {
    const f = 1 + lens * (ux * ux + uy * uy);
    ux = bx / f;
    uy = by / f;
  }
  return { x: cx + ux * radius, y: cy + uy * radius };
};

/**
 * For a projector pixel, the photo pixel that shows the same spot on the wall.
 * `photo` is the photo's full size, which the corners are measured in.
 */
export const projectorToPhoto = (
  calibration: PhotoCalibration,
  photo: { w: number; h: number },
  projector: { w: number; h: number },
): ((p: Point) => Point) | null => {
  const { corners, lens } = calibration;
  if (corners.length !== 4) return null;
  const straight = corners.map(c => straightenPoint(c, lens, photo.w, photo.h));
  const toPhoto = solveHomography(projectorCorners(projector.w, projector.h), straight);
  if (!toPhoto) return null;
  return p => bendPoint(applyHomography(toPhoto, p), lens, photo.w, photo.h);
};

/** True when the four corners make a usable shape (no three in a line, not twisted). */
export const cornersUsable = (corners: Point[]): boolean => {
  if (corners.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
};

/** Starting corners: a little inside the photo's own corners. */
export const defaultCorners = (w: number, h: number): Point[] => {
  const m = Math.min(w, h) * 0.12;
  return [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }];
};

/**
 * Draws the calibrated photo: `out` is `outW` x `outH` pixels covering the projector picture.
 * `src` is the photo's pixels, possibly smaller than its full size (`photo`).
 */
export const warpPhoto = (
  src: ImageData,
  photo: { w: number; h: number },
  calibration: PhotoCalibration,
  projector: { w: number; h: number },
  out: ImageData,
): boolean => {
  const map = projectorToPhoto(calibration, photo, projector);
  if (!map) return false;
  const sx = src.width / photo.w, sy = src.height / photo.h;
  const px = projector.w / out.width, py = projector.h / out.height;
  const s = src.data, o = out.data;
  const sw = src.width, sh = src.height;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = map({ x: (x + 0.5) * px, y: (y + 0.5) * py });
      const fx = p.x * sx - 0.5, fy = p.y * sy - 0.5;
      const i = (y * out.width + x) * 4;
      if (!(fx >= 0 && fy >= 0 && fx <= sw - 1 && fy <= sh - 1)) { // Also catches NaN
        o[i + 3] = 0;
        continue;
      }
      // Smooth (bilinear) sampling between the four nearest photo pixels.
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
        const bottom = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        o[i + c] = top + (bottom - top) * ay;
      }
      o[i + 3] = 255;
    }
  }
  return true;
};

// --- Test pattern shown by the projector ---

// One colour per corner, the same on the pattern and on the markers placed on the photo.
export const CORNER_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff'];
export const PATTERN_DIVISIONS = 8;

/** The pattern in projector pixels: a grid with a bright edge and a big numbered mark in every corner. */
export const drawCalibrationPattern = (ctx: CanvasRenderingContext2D, w: number, h: number, linesOnly = false) => {
  ctx.save();
  if (!linesOnly) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  const unit = Math.min(w, h) / 100;
  ctx.strokeStyle = linesOnly ? 'rgba(34, 211, 238, 0.9)' : '#ffffff';
  ctx.lineWidth = Math.max(1, unit * (linesOnly ? 0.25 : 0.35));
  // Dashed over the photo, so the photographed lines underneath still show between the dashes.
  if (linesOnly) ctx.setLineDash([unit * 1.5, unit * 1.5]);
  ctx.beginPath();
  for (let i = 1; i < PATTERN_DIVISIONS; i++) {
    const x = (w * i) / PATTERN_DIVISIONS, y = (h * i) / PATTERN_DIVISIONS;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
  // The very edge of the picture.
  ctx.lineWidth = unit * (linesOnly ? 0.5 : 1.2);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  if (linesOnly) {
    ctx.restore();
    return;
  }
  // Coloured corner brackets with a number, so each corner is easy to tell apart on the photo.
  const arm = unit * 14;
  const thick = unit * 2.4;
  projectorCorners(w, h).forEach((c, i) => {
    const dx = c.x === 0 ? 1 : -1, dy = c.y === 0 ? 1 : -1;
    ctx.fillStyle = CORNER_COLORS[i];
    ctx.fillRect(dx > 0 ? 0 : w - arm, dy > 0 ? 0 : h - thick, arm, thick);
    ctx.fillRect(dx > 0 ? 0 : w - thick, dy > 0 ? 0 : h - arm, thick, arm);
    const r = unit * 4.5;
    const bx = c.x + dx * (thick + r * 1.6), by = c.y + dy * (thick + r * 1.6);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), bx, by + r * 0.05);
  });
  // Centre cross.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = unit * 0.6;
  ctx.beginPath();
  ctx.moveTo(w / 2 - arm / 2, h / 2); ctx.lineTo(w / 2 + arm / 2, h / 2);
  ctx.moveTo(w / 2, h / 2 - arm / 2); ctx.lineTo(w / 2, h / 2 + arm / 2);
  ctx.stroke();
  ctx.restore();
};

// --- Photo pixels ---

// Decoded photos, so changing the lens slider or a projector window sync does not decode the photo again.
const decoded = new Map<string, Promise<{ data: ImageData; w: number; h: number }>>();
const MAX_SOURCE = 3000; // Longest side kept; more only costs memory, the result is smaller anyway

export const loadPhotoPixels = (url: string) => {
  let job = decoded.get(url);
  if (!job) {
    job = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(1, MAX_SOURCE / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * s));
        canvas.height = Math.max(1, Math.round(h * s));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ data: ctx.getImageData(0, 0, canvas.width, canvas.height), w, h });
      };
      img.onerror = () => reject(new Error('Photo could not be read'));
      img.src = url;
    });
    job.catch(() => decoded.delete(url));
    if (decoded.size > 3) decoded.delete(decoded.keys().next().value!);
    decoded.set(url, job);
  }
  return job;
};
