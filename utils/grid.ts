import { GridSettings } from '../types';

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
  [g.width, g.height, g.mode, g.cellWidth, g.cellHeight, g.columns, g.rows, g.frame, g.cellsTouch].join('|');

const TEXTURE_SIZE = 1024; // Longer side, in pixels
const BACKGROUND = '#002200';
const LINE = '#00ff00';
const FRAME = '#b6ffb6';

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

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
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
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = frame;
    ctx.strokeRect(frame / 2, frame / 2, W - frame, H - frame);
  }
  return canvas;
};

/** A number as people write it: up to two decimals, Lithuanian decimal comma when asked. */
export const formatNumber = (n: number, lang: string, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString(lang, { maximumFractionDigits: digits, useGrouping: false }) : '–';
