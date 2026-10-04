import { ControlPoint, GridSettings } from '../types';
import { rotatePoints } from './math';

export const DEFAULT_GRID: GridSettings = {
  unit: 'm',
  width: 100,
  height: 100,
  mode: 'size',
  cellWidth: 10,
  cellHeight: 10,
  columns: 10,
  rows: 10,
  frame: true,
  cellsTouch: true,
  color: '#00ff00',
};

// More cells than this would be a blur on any projector, and would only slow a Raspberry Pi down.
const MAX_CELLS_PER_SIDE = 400;

export interface GridLayout {
  columns: number; // May be fractional in 'size' mode: the last cell is cut off by the element's edge
  rows: number;
  cellWidth: number; // cm
  cellHeight: number; // cm
}

const positive = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);

/** The cell count and cell size, whichever of the two the user picked. */
export const gridLayout = (g: GridSettings): GridLayout => {
  const width = positive(g.width, DEFAULT_GRID.width);
  const height = positive(g.height, DEFAULT_GRID.height);
  if (g.mode === 'count') {
    const columns = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.round(positive(g.columns, 1))));
    const rows = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.round(positive(g.rows, 1))));
    return { columns, rows, cellWidth: width / columns, cellHeight: height / rows };
  }
  const cellWidth = Math.max(width / MAX_CELLS_PER_SIDE, positive(g.cellWidth, DEFAULT_GRID.cellWidth));
  const cellHeight = Math.max(height / MAX_CELLS_PER_SIDE, positive(g.cellHeight, DEFAULT_GRID.cellHeight));
  return { columns: width / cellWidth, rows: height / cellHeight, cellWidth, cellHeight };
};

export const gridKey = (g: GridSettings) =>
  [g.width, g.height, g.mode, g.cellWidth, g.cellHeight, g.columns, g.rows, g.frame, g.cellsTouch, g.color].join('|');

const TEXTURE_SIZE = 1024; // Longer side, in pixels

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x00ff00;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb = (c: number[]) => `rgb(${c.map(v => Math.round(v)).join(',')})`;

/**
 * Draws the grid as a texture covering the element exactly once (texture coordinates 0..1),
 * with the element's real proportions so the cells come out square when they are square in real life.
 */
export const drawGridTexture = (g: GridSettings): HTMLCanvasElement => {
  const width = positive(g.width, DEFAULT_GRID.width);
  const height = positive(g.height, DEFAULT_GRID.height);
  const scale = TEXTURE_SIZE / Math.max(width, height); // pixels per cm
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const W = canvas.width;
  const H = canvas.height;
  const { columns, rows, cellWidth, cellHeight } = gridLayout(g);
  const cw = cellWidth * scale;
  const ch = cellHeight * scale;
  const line = Math.max(2, Math.min(4, Math.min(cw, ch) / 6));
  const frame = line * 2.5;

  // Lines in the chosen colour, a dark shade of it behind them and a light tint for the element's frame.
  const lineColor = hexToRgb(g.color || DEFAULT_GRID.color!);
  ctx.fillStyle = rgb(lineColor.map(v => v * 0.13));
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = rgb(lineColor);
  ctx.lineWidth = line;
  ctx.beginPath();

  if (g.cellsTouch) {
    // One line between two cells, so the borders of neighbouring cells meet and cross.
    for (let i = 0; i <= Math.ceil(columns); i++) {
      const x = Math.min(i * cw, W);
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let j = 0; j <= Math.ceil(rows); j++) {
      const y = Math.min(j * ch, H);
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
  } else {
    // Every cell has its own frame, with a gap to its neighbours (and to the element's frame).
    const gap = Math.max(line * 2, Math.min(cw, ch) * 0.12);
    const inset = gap / 2;
    const edge = g.frame ? frame + gap / 2 : inset; // Keep clear of the element's frame as well
    for (let i = 0; i < columns; i++) {
      for (let j = 0; j < rows; j++) {
        const x0 = Math.max(i * cw + inset, edge);
        const y0 = Math.max(j * ch + inset, edge);
        const x1 = Math.min((i + 1) * cw - inset, W - edge);
        const y1 = Math.min((j + 1) * ch - inset, H - edge);
        if (x1 - x0 > line && y1 - y0 > line) ctx.rect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
  ctx.stroke();

  if (g.frame) {
    ctx.strokeStyle = rgb(lineColor.map(v => v + (255 - v) * 0.7));
    ctx.lineWidth = frame;
    ctx.strokeRect(frame / 2, frame / 2, W - frame, H - frame);
  }
  return canvas;
};

/** A number as people write it: up to two decimals, Lithuanian decimal comma when asked. */
export const formatNumber = (n: number, lang: string, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString(lang, { maximumFractionDigits: digits, useGrouping: false }) : '–';

// --- Element shape ---
//
// An element whose four corners still form an upright rectangle has not been fitted to anything yet, so it can
// safely take the real proportions of its grid. Once someone has dragged a corner, its shape is left alone.

const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

const cornerIndex = (points: ControlPoint[]) =>
  CORNERS.map(([u, v]) => points.findIndex(p => p.u === u && p.v === v));

export const isPlainRectangle = (points: ControlPoint[], rotation = 0): boolean => {
  if (points.length !== 4) return false;
  // A turned element counts as plain when its corners make an upright rectangle once turned back.
  if (rotation) points = rotatePoints(points, -rotation);
  const [tl, tr, br, bl] = cornerIndex(points).map(i => points[i]);
  if (!tl || !tr || !br || !bl) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return near(tl.y, tr.y) && near(bl.y, br.y) && near(tl.x, bl.x) && near(tr.x, br.x) && tr.x > tl.x && bl.y > tl.y;
};

/**
 * Four corners of an upright rectangle with the given width/height proportion. It keeps the centre and the
 * area of the current corners (or sits in the middle of the projector area), and always fits inside it.
 * With `rotation` the rectangle is worked out as if the element were not turned, then turned again.
 */
export const proportionalPoints = (aspect: number, area: { w: number; h: number }, current?: ControlPoint[], rotation = 0): ControlPoint[] => {
  if (rotation) {
    const upright = proportionalPoints(aspect, area, current && rotatePoints(current, -rotation));
    return rotatePoints(upright, rotation);
  }
  let cx = area.w / 2;
  let cy = area.h / 2;
  let size = area.w * area.h * 0.35; // about a third of the picture
  if (current && current.length >= 3) {
    const xs = current.map(p => p.x);
    const ys = current.map(p => p.y);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    size = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let w = Math.sqrt(size * a);
  let h = w / a;
  const fit = Math.min(1, (area.w * 0.95) / w, (area.h * 0.95) / h);
  w *= fit;
  h *= fit;
  cx = Math.min(Math.max(cx, w / 2), area.w - w / 2);
  cy = Math.min(Math.max(cy, h / 2), area.h - h / 2);
  const ids = current && current.length === 4 ? cornerIndex(current).map(i => current[i]?.id) : [];
  return CORNERS.map(([u, v], i) => ({
    id: ids[i] || Math.random().toString(36).slice(2, 11),
    x: cx + (u - 0.5) * w,
    y: cy + (v - 0.5) * h,
    u,
    v,
  }));
};

export const gridAspect = (g: GridSettings) =>
  positive(g.width, DEFAULT_GRID.width) / positive(g.height, DEFAULT_GRID.height);
