
import React, { useRef, useEffect, useState } from 'react';
import { ControlPoint, ContentType, AppMode, Transform, Layer, GridSettings, PhotoCalibration, CalibrationView } from '../types';
import { DEFAULT_GRID, drawGridTexture, gridKey } from '../utils/grid';
import { triangulate, getBarycentric, pointInTriangle, pointsCentre, rotatePoints, rotationUpdate, normalizeAngle } from '../utils/math';
import Draggable from 'react-draggable';
import { useI18n } from '../i18n';
import { videoLoops } from '../services/mediaLibrary';
import { EffectsEngine, drawGradientTexture, gradientKey, layerNeedsFrames } from '../effects';
import { SceneTextures, drawLayers } from '../utils/scene';
import { drawCalibrationView } from '../utils/calibration';
import CalibratedPhoto from './CalibratedPhoto';
import { ZoomIn, ZoomOut, RefreshCw, Play, Pause, Volume2, VolumeX, RotateCw } from 'lucide-react';

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

  // How the wall photo lines up with the projector picture; without it the photo is just fitted in.
  backgroundCalibration?: PhotoCalibration | null;

  // While the wall photo is being calibrated: what to show instead of the elements.
  calibrationPattern?: CalibrationView | null;
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
  showProjectorFrame = false,
  backgroundCalibration = null,
  calibrationPattern = null
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

  // Turning the active element with the round handle above it. Each move turns the points as they were when
  // the drag started, so small rounding errors never add up.
  const [rotateDrag, setRotateDrag] = useState<{
    layerId: string;
    centre: { x: number; y: number };
    startAngle: number; // Mouse direction from the centre when the drag started (degrees)
    startRotation: number;
    startPoints: ControlPoint[];
  } | null>(null);

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

  const sceneRef = useRef({ layers, activeLayer, mode, k: transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame, calibrationPattern });
  sceneRef.current = { layers, activeLayer, mode, k: transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame, calibrationPattern };
  useEffect(() => { dirtyRef.current = true; }, [layers, activeLayer, mode, transform.k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame, calibrationPattern]);

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
    // Where each element's picture comes from: this canvas's own video and image elements.
    const textures: SceneTextures = {
      video: layer => {
        const vid = videoCache.get(layer.id);
        return vid && vid.readyState >= 2 ? { image: vid, w: vid.videoWidth, h: vid.videoHeight } : null;
      },
      image: url => imageCache.get(url) ?? null,
      grid: grid => {
        const key = gridKey(grid);
        let canvas = gridTexturesRef.current.get(key);
        if (!canvas) {
          // Keep only a handful: while someone types new sizes, old grids are not needed again.
          if (gridTexturesRef.current.size > 16) gridTexturesRef.current.clear();
          canvas = drawGridTexture(grid);
          gridTexturesRef.current.set(key, canvas);
        }
        return canvas;
      },
      gradient: layer => {
        const key = gradientKey(layer.source!);
        let canvas = gradientTexturesRef.current.get(key);
        if (!canvas) {
          if (gradientTexturesRef.current.size > 16) gradientTexturesRef.current.clear();
          canvas = drawGradientTexture(layer.source!);
          gradientTexturesRef.current.set(key, canvas);
        }
        return canvas;
      },
    };

    const render = () => {
      animationFrameId = requestAnimationFrame(render);
      if (!canvas || !ctx) return;

      const { layers, activeLayer, mode, k, isEditingBackground, containerSize, gridDefaults, showProjectorFrame, calibrationPattern } = sceneRef.current;
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

      // While the wall photo is being calibrated the projector shows only the test pattern (or plain white or black).
      if (calibrationPattern) {
          drawCalibrationView(ctx, w, h, calibrationPattern);
          return;
      }

      // Render layers
      drawLayers({ ctx, layers, size: { w, h }, scale: s, now, gridDefaults, fx, textures, staticPatterns });

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

        // Q / E turn the whole element 1° (15° with Shift) left / right.
        const key = e.key.toLowerCase();
        if ((key === 'q' || key === 'e') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const step = (e.shiftKey ? 15 : 1) * (key === 'q' ? -1 : 1);
            onUpdateLayer(activeLayer.id, rotationUpdate(activeLayer, (activeLayer.rotation ?? 0) + step));
            return;
        }

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

  // Mouse position in projector pixels.
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0, top = rect?.top ?? 0;
    return { x: (e.clientX - left - transform.x) / transform.k, y: (e.clientY - top - transform.y) / transform.k };
  };

  const startRotate = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!activeLayer || activeLayer.locked) return;
    const centre = pointsCentre(activeLayer.points);
    const m = toWorld(e);
    setSelectedPointIndex(null);
    setRotateDrag({
        layerId: activeLayer.id,
        centre,
        startAngle: Math.atan2(m.y - centre.y, m.x - centre.x) * 180 / Math.PI,
        startRotation: activeLayer.rotation ?? 0,
        startPoints: activeLayer.points,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (rotateDrag) {
        const m = toWorld(e);
        const angle = Math.atan2(m.y - rotateDrag.centre.y, m.x - rotateDrag.centre.x) * 180 / Math.PI;
        let rotation = rotateDrag.startRotation + angle - rotateDrag.startAngle;
        if (e.shiftKey) rotation = Math.round(rotation / 15) * 15; // Shift: whole steps of 15°
        rotation = normalizeAngle(rotation);
        onUpdateLayer(rotateDrag.layerId, {
            rotation,
            points: rotatePoints(rotateDrag.startPoints, rotation - rotateDrag.startRotation, rotateDrag.centre),
        });
        return;
    }

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
    setRotateDrag(null);
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
                {backgroundCalibration ? (
                    <CalibratedPhoto
                        url={backgroundUrl}
                        calibration={backgroundCalibration}
                        projectorSize={containerSize}
                        className="w-full h-full opacity-50 select-none pointer-events-none"
                    />
                ) : (
                    <img 
                    src={backgroundUrl} 
                    className="w-full h-full object-contain opacity-50 select-none pointer-events-none"
                    alt="reference surface"
                    />
                )}
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
             cursor: rotateDrag ? 'grabbing' : isPanning ? 'grabbing' : (isLayerDragging ? 'move' : 'default'),
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

                {!isEditingBackground && mode === AppMode.MAPPING && activeLayer && !activeLayer.locked && activeLayer.points.length >= 3 && (() => {
                    // The handle sits a little above the element's top edge, on the line through its middle,
                    // and turns together with the element.
                    const rotation = activeLayer.rotation ?? 0;
                    const centre = rotateDrag?.layerId === activeLayer.id ? rotateDrag.centre : pointsCentre(activeLayer.points);
                    const upright = rotatePoints(activeLayer.points, -rotation, centre);
                    const top = centre.y - Math.min(...upright.map(p => p.y));
                    const gap = 48 / transform.k;
                    const r = rotation * Math.PI / 180;
                    const up = { x: Math.sin(r), y: -Math.cos(r) };
                    const edge = { x: centre.x + up.x * top, y: centre.y + up.y * top };
                    const handle = { x: centre.x + up.x * (top + gap), y: centre.y + up.y * (top + gap) };
                    const s = 1 / Math.max(transform.k, 0.5);
                    return (
                        <>
                            <svg className="absolute top-0 left-0 overflow-visible pointer-events-none z-40" width={1} height={1}>
                                <line x1={edge.x} y1={edge.y} x2={handle.x} y2={handle.y} stroke="#22d3ee" strokeWidth={1.5 / transform.k} strokeDasharray={`${4 / transform.k} ${3 / transform.k}`} />
                            </svg>
                            <div
                                className="absolute top-0 left-0 w-7 h-7 -ml-3.5 -mt-3.5 pointer-events-auto z-50"
                                style={{ transform: `translate(${handle.x}px, ${handle.y}px)`, cursor: rotateDrag ? 'grabbing' : 'grab' }}
                                onMouseDown={startRotate}
                                onDoubleClick={(e) => { e.stopPropagation(); onUpdateLayer(activeLayer.id, rotationUpdate(activeLayer, 0)); }}
                                title={t('canvas.rotateHandle')}
                                aria-label={t('canvas.rotateHandle')}
                            >
                                <div
                                    className={`w-full h-full rounded-full border-2 ${rotateDrag ? 'border-yellow-400 bg-yellow-400/30' : 'border-cyan-400 bg-black/60'} hover:bg-cyan-400/80 transition-colors flex items-center justify-center shadow-lg text-white`}
                                    style={{ transform: `scale(${s})` }}
                                >
                                    <RotateCw size={14} />
                                </div>
                                {rotateDrag && (
                                    <div
                                        className="absolute left-1/2 bottom-full mb-1 px-2 py-0.5 rounded bg-slate-900/95 border border-slate-600 text-xs font-mono text-yellow-300 whitespace-nowrap"
                                        style={{ transform: `translateX(-50%) scale(${1 / transform.k})`, transformOrigin: 'bottom center' }}
                                    >
                                        {rotation}°
                                    </div>
                                )}
                            </div>
                        </>
                    );
                })()}

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
