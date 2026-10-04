
import React, { useRef, useEffect, useState } from 'react';
import { ControlPoint, ContentType, AppMode, Transform, Layer, GridSettings } from '../types';
import { DEFAULT_GRID, drawGridTexture, gridKey } from '../utils/grid';
import { triangulate, solveAffine, getBarycentric, pointInTriangle } from '../utils/math';
import Draggable from 'react-draggable';
import { useI18n } from '../i18n';
import { videoLoops } from '../services/mediaLibrary';
import { ContentDraw, EffectsEngine, FrameEnv, compileStack, drawGradientTexture, elementColor, gradientKey, layerNeedsFrames, textureSize } from '../effects';
import { ZoomIn, ZoomOut, RefreshCw, Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface SurfaceCanvasProps {
  mode: AppMode;
  backgroundUrl: string | null;
  
  // Layer System
  layers: Layer[];
  activeLayerId: string | null;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onSelectLayer: (id: string) => void;

  onDimensionsChange?: (width: number, height: number) => void;

  // Background specific props
  backgroundTransform?: Transform;
  onBackgroundTransformChange?: (t: Transform) => void;
  isEditingBackground?: boolean;

  // Projector Resolution
  projectorSize?: { w: number, h: number };

  // Optional shared map of layer id -> video element, so the app can read and correct playback positions.
  videoRegistry?: Map<string, HTMLVideoElement>;

  // Called when a layer's video reaches its end (only videos that do not loop by themselves, see videoLoops).
  onVideoEnded?: (layerId: string) => void;

  // Grid used by elements that have no grid of their own.
  gridDefaults?: GridSettings;

  // LIVE: draw a frame around the whole picture, to see where the projector's picture ends.
  showProjectorFrame?: boolean;
}

const SurfaceCanvas: React.FC<SurfaceCanvasProps> = ({
  mode,
  backgroundUrl,
  layers,
  activeLayerId,
  onUpdateLayer,
  onSelectLayer,
  onDimensionsChange,
  backgroundTransform = { x: 0, y: 0, k: 1 },
  onBackgroundTransformChange,
  isEditingBackground = false,
  projectorSize,
  videoRegistry,
  onVideoEnded,
  gridDefaults = DEFAULT_GRID,
  showProjectorFrame = false
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 2363, h: 1320 });
  
  // Resource Cache
  const [imageCache] = useState<Map<string, HTMLImageElement>>(new Map());
  const [ownVideoCache] = useState<Map<string, HTMLVideoElement>>(new Map());
  const videoCache = videoRegistry ?? ownVideoCache;
  // Last seek applied per layer, so a video only jumps when someone actually seeks or restarts it.
  const lastSeekRef = useRef<Map<string, string>>(new Map());
  // Set when the picture must be redrawn (see the render loop).
  const dirtyRef = useRef(true);
  // Grid textures by settings, so each grid is drawn once and not on every frame.
  const gridTexturesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Gradient textures by colours and angle, made once like the grid.
  const gradientTexturesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Draws the elements' effects (see effects/).
  const fxRef = useRef<EffectsEngine | null>(null);
  if (!fxRef.current) fxRef.current = new EffectsEngine();

  // Global Pan and Zoom State (Camera)
  const [transform, setTransform] = useState({ x: 20, y: 20, k: 0.8 }); // Start slightly zoomed out and padded
  
  // Interactivity State
  const [isPanning, setIsPanning] = useState(false);
  const [isLayerDragging, setIsLayerDragging] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  
  const lastPanRef = useRef({ x: 0, y: 0 });

  // Selection and Editing State
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [editingUV, setEditingUV] = useState<{ index: number, field: 'u'|'v', value: string } | null>(null);

  const activeLayer = layers.find(l => l.id === activeLayerId);

  // Manage stable refs for draggable elements
  const pointRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map());

  // Clean up unused refs
  useEffect(() => {
    if (!activeLayer) return;
    const currentIds = new Set(activeLayer.points.map(p => p.id));
    for (const id of pointRefs.current.keys()) {
      if (!currentIds.has(id)) {
        pointRefs.current.delete(id);
      }
    }
  }, [activeLayer]);

  const getPointRef = (id: string): React.RefObject<HTMLDivElement> => {
    const existing = pointRefs.current.get(id);
    if (existing) {
      return existing;
    }
    const newRef = React.createRef<HTMLDivElement>();
    pointRefs.current.set(id, newRef);
    return newRef;
  };

  // --- Resource Management & Video Sync ---

  // Video element events outlive the render that created them, so they read the latest props from here.
  const latestRef = useRef({ layers, onUpdateLayer, onVideoEnded });
  latestRef.current = { layers, onUpdateLayer, onVideoEnded };

  useEffect(() => {
    layers.forEach(layer => {
        if (layer.source?.type === ContentType.IMAGE && layer.source.url) {
            if (!imageCache.has(layer.source.url)) {
                const img = new Image();
                img.src = layer.source.url;
                img.onload = () => { imageCache.set(layer.source.url, img); dirtyRef.current = true; };
            }
        }

        if (layer.source?.type === ContentType.VIDEO && layer.source.url) {
            let video = videoCache.get(layer.id);
            if (!video) {
                video = document.createElement('video');
                video.crossOrigin = "anonymous";
                video.playsInline = true;
                video.preload = "auto";
                videoCache.set(layer.id, video);
                
                const v = video;
                const layerId = layer.id;
                v.onloadedmetadata = () => {
                   const current = latestRef.current.layers.find(l => l.id === layerId);
                   if (current && Math.abs(v.duration - current.playback.duration) > 0.5) {
                       latestRef.current.onUpdateLayer(layerId, { playback: { ...current.playback, duration: v.duration } });
                   }
                };
                v.onended = () => latestRef.current.onVideoEnded?.(layerId);
            }

            const loop = videoLoops(layer);
            if (video.loop !== loop) video.loop = loop;
            
            if (video.src !== layer.source.url) {
                video.src = layer.source.url;
            }

            // Mute before play(): browsers only autoplay muted video without a click or key press.
            if (video.muted !== layer.playback.isMuted) video.muted = layer.playback.isMuted;
            if (Math.abs(video.volume - layer.playback.volume) > 0.05) video.volume = layer.playback.volume;

            if (layer.playback.isPlaying && video.paused) {
                const v = video;
                v.play().catch(() => {
                    // Video with sound is blocked until the viewer interacts: play muted now, unmute on first input.
                    if (v.muted) return;
                    v.muted = true;
                    v.play().catch(() => { });
                    const unmute = () => { v.muted = false; v.play().catch(() => { }); };
                    window.addEventListener('pointerdown', unmute, { once: true });
                    window.addEventListener('keydown', unmute, { once: true });
                });
            } else if (!layer.playback.isPlaying && !video.paused) {
                video.pause();
            }

            // Seek only when the requested position changed. Comparing with the playing position instead
            // would throw every playing video back to the start on each edit (and on each projector sync).
            const seekKey = `${layer.playback.currentTime}|${layer.playback.seekAt ?? 0}`;
            if (lastSeekRef.current.get(layer.id) !== seekKey) {
                lastSeekRef.current.set(layer.id, seekKey);
                if (Math.abs(video.currentTime - layer.playback.currentTime) > 0.05) {
                    video.currentTime = layer.playback.currentTime;
                }
            }
        }
    });
  }, [layers, videoCache, imageCache, onUpdateLayer]);

  // Handle Resize and Resolution
  useEffect(() => {
    const updateSize = () => {
      // If explicit resolution is provided (via props), use it as the logical size
      if (projectorSize) {
          setContainerSize(projectorSize);
          if (onDimensionsChange) onDimensionsChange(projectorSize.w, projectorSize.h);
      } else if (containerRef.current) {
          // Otherwise adapt to container
          const w = containerRef.current.clientWidth;
          const h = containerRef.current.clientHeight;
          setContainerSize({ w, h });
          if (onDimensionsChange) onDimensionsChange(w, h);
      }
    };
    
    window.addEventListener('resize', updateSize);
    updateSize(); // Initial
    return () => window.removeEventListener('resize', updateSize);
  }, [onDimensionsChange, projectorSize]);

  // --- Render Loop ---
  //
  // One loop for the component's whole life. It reads the latest props from a ref instead of being
  // torn down and restarted on every state change, and it only redraws when something changed or a
  // video is on screen. Both matter on a Raspberry Pi: a still picture costs no GPU time at all.

  const sceneRef = useRef({ layers, activeLayer, mode, k: transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame });
  sceneRef.current = { layers, activeLayer, mode, k: transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame };
  useEffect(() => { dirtyRef.current = true; }, [layers, activeLayer, mode, transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame]);

  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    // Transparent where nothing is drawn, so the wall photo underneath shows through.
    const ctx = canvas?.getContext('2d');
    // Patterns of still textures (pictures, the grid) are made once; a video needs a new one every frame.
    const staticPatterns = new WeakMap<CanvasImageSource, CanvasPattern | null>();
    const fx = fxRef.current!;
    // Draw one more frame after the last moving effect stops, so a finished signal effect is cleared away.
    let wasMoving = false;

    const render = () => {
      animationFrameId = requestAnimationFrame(render);
      if (!canvas || !ctx) return;

      const { layers, activeLayer, mode, k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame } = sceneRef.current;
      const now = Date.now();
      const hasVideo = layers.some(l => l.visible && l.source?.type === ContentType.VIDEO);
      const moving = layers.some(l => l.visible && layerNeedsFrames(l, now));
      if (!dirtyRef.current && !hasVideo && !moving && !wasMoving) return;
      dirtyRef.current = false;
      wasMoving = moving;

      // Draw at the size the canvas is actually shown (zoom x screen density), never above the logical size.
      // The projector window shows the scene at 0.8, so this skips about a third of the pixels there.
      const dpr = window.devicePixelRatio || 1;
      const s = Math.min(1, Math.ceil(k * dpr * 20) / 20);
      const w = containerSize.w;
      const h = containerSize.h;
      const pixelW = Math.max(1, Math.round(w * s));
      const pixelH = Math.max(1, Math.round(h * s));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      // Everything below is in logical (projector) pixels.
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      fx.prune(new Set(layers.map(l => l.id)));

      // Render layers
      layers.forEach(layer => {
          if (!layer.visible) return;
          if (layer.points.length < 3) return;
          // Only the passes this element needs: none at all for an element without effects.
          const graph = compileStack(layer, now);
          if (!layer.source && graph.textureEffects === 0 && graph.under.length === 0 && graph.over.length === 0) return;

          // Calculate final opacity: User setting * System transition
          // Default transitionOpacity to 1 if undefined
          const transitionOpacity = layer.transitionOpacity !== undefined ? layer.transitionOpacity : 1;
          const finalOpacity = layer.opacity * transitionOpacity;

          if (finalOpacity <= 0.01) return; // Skip if basically invisible

          const triangles = triangulate(layer.points);
          if (triangles.length === 0) return;

          ctx.globalAlpha = finalOpacity;

          const env: FrameEnv = { now, scale: s, area: { w, h }, layers, elementColor: elementColor(layer, gridDefaults) };
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
              const vid = videoCache.get(layer.id);
              if (vid && vid.readyState >= 2) {
                  texture = vid;
                  isStatic = false;
                  texW = vid.videoWidth;
                  texH = vid.videoHeight;
              }
          } else if (layer.source.type === ContentType.IMAGE && layer.source.url) {
              const img = imageCache.get(layer.source.url);
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
              const grid = layer.grid ?? gridDefaults;
              const key = gridKey(grid);
              let canvas = gridTexturesRef.current.get(key);
              if (!canvas) {
                  // Keep only a handful: while someone types new sizes, old grids are not needed again.
                  if (gridTexturesRef.current.size > 16) gridTexturesRef.current.clear();
                  canvas = drawGridTexture(grid);
                  gridTexturesRef.current.set(key, canvas);
              }
              texture = canvas;
              texW = canvas.width;
              texH = canvas.height;
          } else if (layer.source.type === ContentType.GRADIENT) {
              const key = gradientKey(layer.source);
              let canvas = gradientTexturesRef.current.get(key);
              if (!canvas) {
                  if (gradientTexturesRef.current.size > 16) gradientTexturesRef.current.clear();
                  canvas = drawGradientTexture(layer.source);
                  gradientTexturesRef.current.set(key, canvas);
              }
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
                  return;
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

                 const [a, b, c, d, e, f] = solveAffine(
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
                     const len = Math.sqrt(dx*dx + dy*dy);
                     if (len === 0) return { x, y };
                     return { 
                         x: x + (dx / len) * expansion, 
                         y: y + (dy / len) * expansion 
                     };
                 }
                 
                 const ep0 = expand(p0.x, p0.y);
                 const ep1 = expand(p1.x, p1.y);
                 const ep2 = expand(p2.x, p2.y);

                 ctx.moveTo(ep0.x, ep0.y);
                 ctx.lineTo(ep1.x, ep1.y);
                 ctx.lineTo(ep2.x, ep2.y);
                 ctx.closePath();
                 
                 ctx.clip();
                 
                 // Map texture space onto the triangle (on top of the drawing scale)
                 ctx.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);

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
      });

      // --- Draw Scene Bounds & Wireframe (Overlay) ---
      
      // Bounds (Visible in SETUP and MAPPING)
      if ((mode === AppMode.MAPPING || mode === AppMode.SETUP) && !isEditingBackground) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.strokeRect(1, 1, w - 2, h - 2);
          
          // Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = '12px monospace';
          ctx.fillText(`BOUNDS: ${w}x${h}`, 10, 20);
          ctx.restore();
      }

      // Projector edges (LIVE, when switched on): a bright frame along the very edge of the picture.
      if (mode === AppMode.LIVE && showProjectorFrame) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 6;
          ctx.strokeRect(3, 3, w - 6, h - 6);
          ctx.strokeStyle = '#ff2d55';
          ctx.lineWidth = 2;
          ctx.strokeRect(9, 9, w - 18, h - 18);
          ctx.restore();
      }

      // Wireframe (Only Active Layer in MAPPING)
      if (mode === AppMode.MAPPING && activeLayer && !activeLayer.locked) {
          const triangles = triangulate(activeLayer.points);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1 / k;
          ctx.beginPath();
          for (let i = 0; i < triangles.length; i += 3) {
             const p0 = activeLayer.points[triangles[i]];
             const p1 = activeLayer.points[triangles[i+1]];
             const p2 = activeLayer.points[triangles[i+2]];
             if (p0 && p1 && p2) {
                 ctx.moveTo(p0.x, p0.y);
                 ctx.lineTo(p1.x, p1.y);
                 ctx.lineTo(p2.x, p2.y);
                 ctx.lineTo(p0.x, p0.y);
             }
          }
          ctx.stroke();
      }
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [videoCache, imageCache]);

  // --- Keyboard Control (Nudge) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Only valid in Mapping mode, with an active unlocked layer
        if (mode !== AppMode.MAPPING || !activeLayer || activeLayer.locked) return;
        
        // Don't trigger if user is typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        let dx = 0;
        let dy = 0;
        const step = e.shiftKey ? 10 : 1; // 1px normal, 10px with Shift

        switch (e.key) {
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowRight': dx = step; break;
            case 'ArrowUp': dy = -step; break;
            case 'ArrowDown': dy = step; break;
            default: return; // Not an arrow key
        }

        e.preventDefault(); // Prevent scrolling

        if (selectedPointIndex !== null) {
            // Move selected point
            const newPoints = [...activeLayer.points];
            const p = newPoints[selectedPointIndex];
            if (p) {
                newPoints[selectedPointIndex] = { ...p, x: p.x + dx, y: p.y + dy };
                onUpdateLayer(activeLayer.id, { points: newPoints });
            }
        } else {
            // Move entire layer (all points)
            const newPoints = activeLayer.points.map(p => ({
                ...p,
                x: p.x + dx,
                y: p.y + dy
            }));
            onUpdateLayer(activeLayer.id, { points: newPoints });
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, activeLayer, selectedPointIndex, onUpdateLayer]);

  // --- Interactions ---

  const handleWheel = (e: React.WheelEvent) => {
    if (mode === AppMode.LIVE) return;
    
    if (isEditingBackground && onBackgroundTransformChange) {
        const scaleFactor = 1.05;
        const newK = e.deltaY < 0 
          ? backgroundTransform.k * scaleFactor 
          : backgroundTransform.k / scaleFactor;
        
        onBackgroundTransformChange({
            ...backgroundTransform,
            k: Math.max(0.1, Math.min(10, newK))
        });
        return;
    }

    const scaleFactor = 1.1;
    const newK = e.deltaY < 0 
      ? Math.min(transform.k * scaleFactor, 10) 
      : Math.max(transform.k / scaleFactor, 0.1);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const newX = mouseX - (mouseX - transform.x) * (newK / transform.k);
    const newY = mouseY - (mouseY - transform.y) * (newK / transform.k);

    setTransform({ x: newX, y: newY, k: newK });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode === AppMode.LIVE) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const worldX = (rawX - transform.x) / transform.k;
    const worldY = (rawY - transform.y) / transform.k;

    if (!isEditingBackground && mode === AppMode.MAPPING) {
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            if (!layer.visible || layer.locked) continue;
            
            const triangles = triangulate(layer.points);
            let hit = false;
            for (let t = 0; t < triangles.length; t += 3) {
                const p0 = layer.points[triangles[t]];
                const p1 = layer.points[triangles[t+1]];
                const p2 = layer.points[triangles[t+2]];
                if (pointInTriangle(worldX, worldY, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                if (activeLayerId !== layer.id) {
                    onSelectLayer(layer.id);
                }
                setDraggedLayerId(layer.id);
                setIsLayerDragging(true);
                lastPanRef.current = { x: e.clientX, y: e.clientY };
                setSelectedPointIndex(null);
                e.stopPropagation();
                return; 
            }
        }
    }

    if (selectedPointIndex !== null) setSelectedPointIndex(null);

    setIsPanning(true);
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const dx = e.clientX - lastPanRef.current.x;
    const dy = e.clientY - lastPanRef.current.y;
    lastPanRef.current = { x: e.clientX, y: e.clientY };

    if (isLayerDragging && draggedLayerId) {
        const layer = layers.find(l => l.id === draggedLayerId);
        if (layer) {
            const worldDx = dx / transform.k;
            const worldDy = dy / transform.k;
            const newPoints = layer.points.map(p => ({
                ...p,
                x: p.x + worldDx,
                y: p.y + worldDy
            }));
            onUpdateLayer(layer.id, { points: newPoints });
        }
        return;
    }

    if (isPanning) {
        if (isEditingBackground && onBackgroundTransformChange) {
            onBackgroundTransformChange({
                ...backgroundTransform,
                x: backgroundTransform.x + dx / transform.k,
                y: backgroundTransform.y + dy / transform.k
            });
        } else {
            setTransform(prev => ({
                ...prev,
                x: prev.x + dx,
                y: prev.y + dy
            }));
        }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsLayerDragging(false);
    setDraggedLayerId(null);
  };

  // Fit the whole projector area into the visible editor area.
  const resetView = () => {
    const el = containerRef.current;
    if (!el || !el.clientWidth || !el.clientHeight) {
        setTransform({ x: 20, y: 20, k: 0.8 });
        return;
    }
    const pad = 40;
    const k = Math.min((el.clientWidth - pad * 2) / containerSize.w, (el.clientHeight - pad * 2) / containerSize.h, 1);
    setTransform({
        x: (el.clientWidth - containerSize.w * k) / 2,
        y: (el.clientHeight - containerSize.h * k) / 2,
        k
    });
  };

  // Start the editor with everything in view.
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (hasFittedRef.current || mode === AppMode.LIVE) return;
    hasFittedRef.current = true;
    resetView();
  }, [mode, containerSize]);

  // LIVE: the projector area fills the window exactly (centred, no margins), so the editor's LIVE view and
  // the projector window show the same picture whatever their size. Leaving LIVE fits the editor view again.
  const wasLiveRef = useRef(false);
  useEffect(() => {
    if (mode !== AppMode.LIVE) {
        if (!wasLiveRef.current) return;
        wasLiveRef.current = false;
        const timer = window.setTimeout(resetView, 350); // after the panel has slid back in
        return () => window.clearTimeout(timer);
    }
    wasLiveRef.current = true;
    const fit = () => {
        const el = containerRef.current;
        if (!el || !el.clientWidth || !el.clientHeight) return;
        const k = Math.min(el.clientWidth / containerSize.w, el.clientHeight / containerSize.h);
        setTransform({ x: (el.clientWidth - containerSize.w * k) / 2, y: (el.clientHeight - containerSize.h * k) / 2, k });
    };
    fit();
    // The panel slides away on entering LIVE, so measure again once the layout has settled.
    const timer = window.setTimeout(fit, 350);
    const observer = new ResizeObserver(fit);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [mode, containerSize]);
  const zoomIn = () => setTransform(prev => ({ ...prev, k: Math.min(prev.k * 1.2, 10) }));
  const zoomOut = () => setTransform(prev => ({ ...prev, k: Math.max(prev.k / 1.2, 0.1) }));

  // --- Point Mesh Logic ---

  const handleDoubleClick = (e: React.MouseEvent) => {
      if (mode !== AppMode.MAPPING || isEditingBackground || !activeLayer || activeLayer.locked) return;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      const x = (rawX - transform.x) / transform.k;
      const y = (rawY - transform.y) / transform.k;

      let u = x / containerSize.w;
      let v = y / containerSize.h;
      
      const triangles = triangulate(activeLayer.points);
      for (let i = 0; i < triangles.length; i += 3) {
          const i0 = triangles[i]; const i1 = triangles[i+1]; const i2 = triangles[i+2];
          const p0 = activeLayer.points[i0]; const p1 = activeLayer.points[i1]; const p2 = activeLayer.points[i2];
          if (pointInTriangle(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
              const [w0, w1, w2] = getBarycentric(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y,);
              u = w0 * p0.u + w1 * p1.u + w2 * p2.u;
              v = w0 * p0.v + w1 * p1.v + w2 * p2.v;
              break;
          }
      }

      const newPoint: ControlPoint = {
          id: Math.random().toString(36).substr(2, 9),
          x, y, u, v
      };

      onUpdateLayer(activeLayer.id, { points: [...activeLayer.points, newPoint] });
      setSelectedPointIndex(activeLayer.points.length);
  };

  const handleDrag = (index: number, e: any, data: { x: number, y: number }) => {
     if (!activeLayer) return;
     const newPoints = [...activeLayer.points];
     if (newPoints[index]) {
         newPoints[index] = { ...newPoints[index], x: data.x, y: data.y };
         onUpdateLayer(activeLayer.id, { points: newPoints });
     }
  };

  const handleRemovePoint = (e: React.MouseEvent, index: number) => {
      e.preventDefault(); e.stopPropagation();
      if (mode !== AppMode.MAPPING || isEditingBackground || !activeLayer || activeLayer.locked) return;
      if (activeLayer.points.length <= 3) return;

      const newPoints = activeLayer.points.filter((_, i) => i !== index);
      onUpdateLayer(activeLayer.id, { points: newPoints });
      setSelectedPointIndex(null);
  };

  const handleVideoAction = (action: 'play' | 'pause' | 'volume' | 'seek' | 'mute', value?: number) => {
      if (!activeLayer) return;
      const newPlayback = { ...activeLayer.playback };

      if (action === 'play') newPlayback.isPlaying = true;
      if (action === 'pause') newPlayback.isPlaying = false;
      if (action === 'mute') newPlayback.isMuted = !newPlayback.isMuted;
      if (action === 'volume' && value !== undefined) {
          newPlayback.volume = value;
          if (value > 0) newPlayback.isMuted = false;
      }
      if (action === 'seek' && value !== undefined) {
          newPlayback.currentTime = value;
          newPlayback.seekAt = Date.now();
      }
      
      onUpdateLayer(activeLayer.id, { playback: newPlayback });
  };

  const handleUVChange = (index: number, field: 'u' | 'v', rawValue: string) => {
      setEditingUV({ index, field, value: rawValue });
      const val = parseFloat(rawValue);
      if (!isNaN(val) && activeLayer) {
          const clamped = Math.max(0, Math.min(1, val));
          const newPoints = [...activeLayer.points];
          newPoints[index] = { ...newPoints[index], [field]: clamped };
          onUpdateLayer(activeLayer.id, { points: newPoints });
      }
  };

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden select-none ${isEditingBackground ? 'cursor-move' : ''}`}>
       
       {/* The wall photo lies under the projector area (same size and zoom), behind the transparent canvas. */}
       <div 
        className="absolute top-0 left-0 pointer-events-none"
        style={{
            width: containerSize.w,
            height: containerSize.h,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            transformOrigin: '0 0'
        }}
      >
        {backgroundUrl && (
            <div
                style={{
                    transform: `translate(${backgroundTransform.x}px, ${backgroundTransform.y}px) scale(${backgroundTransform.k})`,
                    transformOrigin: '0 0',
                    width: containerSize.w,
                    height: containerSize.h
                }}
            >
                <img 
                src={backgroundUrl} 
                className="w-full h-full object-contain opacity-50 select-none pointer-events-none"
                alt="reference surface"
                />
            </div>
        )}
      </div>

       <div 
        ref={containerRef}
        className={`relative w-full h-full max-w-none mx-auto z-10 overflow-hidden ring-1 ring-white/10 ${isEditingBackground ? 'ring-yellow-500/50' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        style={{
             cursor: isPanning ? 'grabbing' : (isLayerDragging ? 'move' : 'default'),
             display: 'block' // Removed flex centering which caused offset issues
        }}
       >
          <div
            className="will-change-transform origin-top-left absolute top-0 left-0"
            style={{
                width: containerSize.w,
                height: containerSize.h,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
                transformOrigin: '0 0'
            }}
            >
                <canvas 
                    ref={canvasRef}
                    className="block pointer-events-none"
                    style={{ width: '100%', height: '100%' }}
                />

                {!isEditingBackground && mode === AppMode.MAPPING && activeLayer && !activeLayer.locked && activeLayer.points.map((p, idx) => {
                    const nodeRef = getPointRef(p.id);
                    return (
                        <Draggable
                            key={p.id}
                            nodeRef={nodeRef}
                            position={{ x: p.x, y: p.y }}
                            scale={transform.k}
                            onDrag={(e, data) => handleDrag(idx, e, data)}
                            onStart={() => setSelectedPointIndex(idx)}
                            onMouseDown={(e) => { e.stopPropagation(); setSelectedPointIndex(idx); }}
                        >
                             <div 
                                ref={nodeRef}
                                onContextMenu={(e) => handleRemovePoint(e, idx)}
                                className={`absolute top-0 left-0 w-6 h-6 -ml-3 -mt-3 cursor-crosshair pointer-events-auto group z-50 ${selectedPointIndex === idx ? 'z-[60]' : ''}`}
                            >
                                <div 
                                    className={`w-full h-full rounded-full border-2 ${selectedPointIndex === idx ? 'border-yellow-400 bg-yellow-400/20' : 'border-cyan-400 bg-black/50'} backdrop-blur hover:bg-cyan-400/80 transition-colors flex items-center justify-center shadow-lg`}
                                    style={{ transform: `scale(${1 / Math.max(transform.k, 0.5)})` }}
                                >
                                    <div className={`w-1 h-1 ${selectedPointIndex === idx ? 'bg-yellow-400' : 'bg-white'} rounded-full`} />
                                </div>
                                {selectedPointIndex === idx && (
                                    <div 
                                        className="absolute top-5 left-5 bg-slate-900/95 border border-slate-600 rounded p-2 flex flex-col gap-1 shadow-2xl min-w-[80px]"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        style={{ transform: `scale(${1/transform.k})`, transformOrigin: 'top left', cursor: 'default' }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 font-mono w-3">U</span>
                                            <input type="number" step="0.01" min="0" max="1"
                                                className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] px-1 py-0.5 text-cyan-400 focus:outline-none"
                                                value={editingUV?.index === idx && editingUV?.field === 'u' ? editingUV.value : Math.round(p.u * 100)/100}
                                                onChange={(e) => handleUVChange(idx, 'u', e.target.value)}
                                                onBlur={() => setEditingUV(null)}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 font-mono w-3">V</span>
                                            <input type="number" step="0.01" min="0" max="1"
                                                className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] px-1 py-0.5 text-cyan-400 focus:outline-none"
                                                value={editingUV?.index === idx && editingUV?.field === 'v' ? editingUV.value : Math.round(p.v * 100)/100}
                                                onChange={(e) => handleUVChange(idx, 'v', e.target.value)}
                                                onBlur={() => setEditingUV(null)}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Draggable>
                    )
                })}
            </div>

            {!isEditingBackground && mode === AppMode.MAPPING && (
                <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-[100]" onMouseDown={e => e.stopPropagation()}>
                    <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg p-1 flex flex-col gap-1 shadow-xl">
                        <button onClick={zoomIn} title={t('zoom.in')} aria-label={t('zoom.in')} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><ZoomIn size={18} /></button>
                        <button onClick={resetView} title={t('zoom.reset')} aria-label={t('zoom.reset')} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><RefreshCw size={18} /></button>
                        <button onClick={zoomOut} title={t('zoom.out')} aria-label={t('zoom.out')} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><ZoomOut size={18} /></button>
                    </div>
                </div>
            )}
            
            {!isEditingBackground && mode === AppMode.MAPPING && activeLayer && activeLayer.source?.type === ContentType.VIDEO && (
                 <div 
                 className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-2 flex items-center gap-3 shadow-2xl z-[100] min-w-[300px]"
                 onMouseDown={(e) => e.stopPropagation()}
                >
                 <button onClick={() => handleVideoAction(activeLayer.playback.isPlaying ? 'pause' : 'play')} title={activeLayer.playback.isPlaying ? t('video.pause') : t('video.play')} className="p-1.5 text-cyan-400 hover:bg-slate-800 rounded-full transition-colors">
                     {activeLayer.playback.isPlaying ? <Pause size={18} /> : <Play size={18} />}
                 </button>
 
                 <div className="flex-1 flex flex-col gap-1">
                     <input 
                         type="range" min={0} max={activeLayer.playback.duration || 100} step={0.1}
                         value={activeLayer.playback.currentTime} 
                         onChange={(e) => handleVideoAction('seek', parseFloat(e.target.value))}
                         className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                     />
                 </div>
 
                 <div className="flex items-center gap-1 group">
                     <button onClick={() => handleVideoAction('mute')} title={t('video.mute')} className="text-slate-400 hover:text-white">
                         {activeLayer.playback.isMuted || activeLayer.playback.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                     </button>
                     <div className="w-0 overflow-hidden group-hover:w-16 transition-all duration-300">
                         <input 
                             type="range" min={0} max={1} step={0.05}
                             value={activeLayer.playback.isMuted ? 0 : activeLayer.playback.volume}
                             onChange={(e) => handleVideoAction('volume', parseFloat(e.target.value))}
                             className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                         />
                     </div>
                 </div>
             </div>
            )}

            {isEditingBackground && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-600/90 text-white px-4 py-1 rounded-full text-xs font-bold pointer-events-none shadow-lg z-[100]">
                    {t('canvas.editingBackground')}
                </div>
            )}
       </div>
    </div>
  );
};

export default SurfaceCanvas;
