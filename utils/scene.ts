import { ContentType, GridSettings, Layer } from '../types';
import { ContentDraw, EffectsEngine, FrameEnv, compileStack, elementColor, gradientKey, textureSize } from '../effects';
import { DEFAULT_GRID, gridKey } from './grid';
import { solveAffine, triangulate } from './math';

// Draws the elements of a show: each one's content and effects, mapped onto its mesh. The editor, the
// projector window, show mode and the video export all draw through here, so an exported video looks
// exactly like the projection.

/** Where the pictures come from. The canvas uses its video and image elements; the export decodes frames. */
export interface SceneTextures {
  video: (layer: Layer) => { image: CanvasImageSource; w: number; h: number } | null;
  image: (url: string) => HTMLImageElement | null;
  grid: (grid: GridSettings) => HTMLCanvasElement;
  gradient: (layer: Layer) => HTMLCanvasElement;
}

export interface SceneFrame {
  ctx: CanvasRenderingContext2D;
  layers: Layer[];
  size: { w: number; h: number }; // Logical (projector) size
  scale: number; // Device pixels per logical pixel
  offset?: { x: number; y: number }; // Device pixels from the canvas corner to logical (0, 0)
  now: number; // ms on the effects' clock
  gridDefaults?: GridSettings;
  fx: EffectsEngine;
  textures: SceneTextures;
  staticPatterns: WeakMap<CanvasImageSource, CanvasPattern | null>; // Patterns of still textures, made once
  loop?: FrameEnv['loop'];
}

/** Sets the logical drawing transform (scale, then offset) on the context. */
export const setSceneTransform = (f: Pick<SceneFrame, 'ctx' | 'scale' | 'offset'>) =>
  f.ctx.setTransform(f.scale, 0, 0, f.scale, f.offset?.x ?? 0, f.offset?.y ?? 0);

export const drawLayers = (f: SceneFrame) => {
  const { ctx, layers, size, scale: s, now, fx, textures, staticPatterns } = f;
  const gridDefaults = f.gridDefaults ?? DEFAULT_GRID;
  const ox = f.offset?.x ?? 0;
  const oy = f.offset?.y ?? 0;
  const { w, h } = size;
  setSceneTransform(f);
  fx.prune(new Set(layers.map(l => l.id)));

  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layer.points.length < 3) continue;
    // Only the passes this element needs: none at all for an element without effects.
    const graph = compileStack(layer, now);
    if (!layer.source && graph.textureEffects === 0 && graph.under.length === 0 && graph.over.length === 0) continue;

    // Calculate final opacity: User setting * System transition
    // Default transitionOpacity to 1 if undefined
    const transitionOpacity = layer.transitionOpacity !== undefined ? layer.transitionOpacity : 1;
    const finalOpacity = layer.opacity * transitionOpacity;

    if (finalOpacity <= 0.01) continue; // Skip if basically invisible

    const triangles = triangulate(layer.points);
    if (triangles.length === 0) continue;

    ctx.globalAlpha = finalOpacity;

    const env: FrameEnv = { now, scale: s, area: { w, h }, layers, elementColor: elementColor(layer, gridDefaults), loop: f.loop };
    fx.drawScreen(ctx, layer, graph.under, finalOpacity, env);
    ctx.globalAlpha = finalOpacity;

    let texture: CanvasImageSource | null = null;
    let isStatic = true;
    let texW = 1000;
    let texH = 1000;
    const withEffects = graph.textureEffects > 0;

    if (!layer.source) {
      // No content: only the effects make the picture.
    } else if (layer.source.type === ContentType.VIDEO) {
      const vid = textures.video(layer);
      if (vid) {
        texture = vid.image;
        isStatic = false;
        texW = vid.w;
        texH = vid.h;
      }
    } else if (layer.source.type === ContentType.IMAGE && layer.source.url) {
      const img = textures.image(layer.source.url);
      if (img && img.complete) {
        texture = img;
        texW = img.naturalWidth;
        texH = img.naturalHeight;
      }
    } else if (layer.source.type === ContentType.COLOR && withEffects) {
      // Drawn by the effects pipeline below, as the bottom of the stack.
    } else if (layer.source.type === ContentType.COLOR) {
      // A plain colour needs no texture: fill all triangles as one shape, so there are no seams between them.
      ctx.fillStyle = layer.source.color || '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < triangles.length; i += 3) {
        const p0 = layer.points[triangles[i]];
        const p1 = layer.points[triangles[i + 1]];
        const p2 = layer.points[triangles[i + 2]];
        if (!p0 || !p1 || !p2) continue;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.closePath();
      }
      ctx.fill('nonzero');
    } else if (layer.source.type === ContentType.SOLID_COLOR) {
      const canvas = textures.grid(layer.grid ?? gridDefaults);
      texture = canvas;
      texW = canvas.width;
      texH = canvas.height;
    } else if (layer.source.type === ContentType.GRADIENT) {
      const canvas = textures.gradient(layer);
      texture = canvas;
      texW = canvas.width;
      texH = canvas.height;
    }

    if (withEffects) {
      // Content + effects become one picture, which is then mapped onto the mesh like any texture.
      let content: ContentDraw = { kind: 'none' };
      if (layer.source?.type === ContentType.COLOR) content = { kind: 'color', color: layer.source.color || '#ffffff' };
      else if (texture) content = { kind: 'image', image: texture, isStatic, key: layer.source?.type === ContentType.IMAGE ? layer.source.url : `${layer.source?.type}|${texW}x${texH}|${layer.source?.type === ContentType.GRADIENT ? gradientKey(layer.source) : gridKey(layer.grid ?? gridDefaults)}` };
      else if (layer.source?.type === ContentType.VIDEO || layer.source?.type === ContentType.IMAGE) {
        // The video or picture is still loading: show nothing yet rather than the effects alone.
        fx.drawScreen(ctx, layer, graph.over, finalOpacity, env);
        continue;
      }
      const result = fx.renderTexture(layer, graph, content, textureSize(layer.points, s), env);
      texture = result;
      isStatic = false; // Its pixels change while the canvas object stays the same
      if (result) {
        texW = result.width;
        texH = result.height;
      }
      ctx.globalAlpha = finalOpacity;
    }

    if (texture) {
      let pattern: CanvasPattern | null = null;
      if (isStatic && staticPatterns.has(texture)) {
        pattern = staticPatterns.get(texture) ?? null;
      } else {
        try {
          pattern = ctx.createPattern(texture, 'repeat');
        } catch (e) {}
        if (isStatic) staticPatterns.set(texture, pattern);
      }

      // Optimization: Use imageSmoothing for smoother video, but sometimes 'false' reduces blur at edges.
      ctx.imageSmoothingEnabled = true;

      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i];
        const i1 = triangles[i + 1];
        const i2 = triangles[i + 2];
        const p0 = layer.points[i0];
        const p1 = layer.points[i1];
        const p2 = layer.points[i2];
        if (!p0 || !p1 || !p2) continue;

        const [a, b, c, d, e, g] = solveAffine(
          p0.x, p0.y, p1.x, p1.y, p2.x, p2.y,
          p0.u * texW, p0.v * texH,
          p1.u * texW, p1.v * texH,
          p2.u * texW, p2.v * texH
        );

        ctx.save();
        ctx.beginPath();

        // SEAM FIX: Expand the clipping triangle slightly (0.5px) outwards from centroid
        // This overlaps adjacent triangles to hide the sub-pixel gap/lines in Live mode
        const cx = (p0.x + p1.x + p2.x) / 3;
        const cy = (p0.y + p1.y + p2.y) / 3;

        // Small expansion factor. 0.5px is usually enough.
        // We add a tiny vector from centroid to vertex.
        // Note: This distorts the texture map slightly at edges but eliminates the seam.
        const expansion = 0.6; // pixels roughly

        const expand = (x: number, y: number) => {
          const dx = x - cx;
          const dy = y - cy;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return { x, y };
          return {
            x: x + (dx / len) * expansion,
            y: y + (dy / len) * expansion
          };
        };

        const ep0 = expand(p0.x, p0.y);
        const ep1 = expand(p1.x, p1.y);
        const ep2 = expand(p2.x, p2.y);

        ctx.moveTo(ep0.x, ep0.y);
        ctx.lineTo(ep1.x, ep1.y);
        ctx.lineTo(ep2.x, ep2.y);
        ctx.closePath();

        ctx.clip();

        // Map texture space onto the triangle (on top of the drawing scale and offset)
        ctx.setTransform(a * s, b * s, c * s, d * s, e * s + ox, g * s + oy);

        if (pattern) {
          ctx.fillStyle = pattern;
          // Fill large rect in texture space
          const uCoords = [p0.u, p1.u, p2.u];
          const vCoords = [p0.v, p1.v, p2.v];
          const minU = Math.min(...uCoords) * texW;
          const maxU = Math.max(...uCoords) * texW;
          const minV = Math.min(...vCoords) * texH;
          const maxV = Math.max(...vCoords) * texH;
          // Draw slightly larger to cover dilation
          ctx.fillRect(minU - 2, minV - 2, (maxU - minU) + 4, (maxV - minV) + 4);
        } else {
          ctx.drawImage(texture, 0, 0, texW, texH);
        }
        ctx.restore();
      }
    }

    fx.drawScreen(ctx, layer, graph.over, finalOpacity, env);
  }
};
