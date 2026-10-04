import { ContentType, GridSettings, Layer, ProjectionSource } from '../types';

// Content helpers shared by the renderer and the panel.

export const DEFAULT_ELEMENT_COLOR = '#00e5ff';

/**
 * The element's colour, which effects with the "element colour" source follow. For a plain colour or a
 * gradient it is the content's own colour, so changing that colour recolours the effects too.
 */
export const elementColor = (layer: Layer, gridDefaults?: GridSettings): string => {
  const s = layer.source;
  if (s && (s.type === ContentType.COLOR || s.type === ContentType.GRADIENT) && s.color) return s.color;
  if (layer.color) return layer.color;
  if (s?.type === ContentType.SOLID_COLOR) return (layer.grid ?? gridDefaults)?.color || '#00ff00';
  return DEFAULT_ELEMENT_COLOR;
};

export const gradientKey = (s: ProjectionSource) => `${s.color}|${s.color2}|${s.angle ?? 0}`;

/** A gradient drawn once into a small texture; it is stretched over the element like any picture. */
export const drawGradientTexture = (s: ProjectionSource): HTMLCanvasElement => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const a = ((s.angle ?? 0) * Math.PI) / 180;
  const dx = (Math.cos(a) * size) / 2;
  const dy = (Math.sin(a) * size) / 2;
  const grad = g.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
  grad.addColorStop(0, s.color || '#000000');
  grad.addColorStop(1, s.color2 || '#ffffff');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
};
