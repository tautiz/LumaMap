
import React, { useRef, useEffect, useState } from 'react';
import { ControlPoint, ContentType, AppMode, Transform, Layer } from '../types';
import { triangulate, solveAffine, getBarycentric, pointInTriangle } from '../utils/math';
import Draggable from 'react-draggable';
import { useI18n } from '../i18n';
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
  projectorSize
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 2363, h: 1320 });
  
  // Resource Cache
  const [imageCache] = useState<Map<string, HTMLImageElement>>(new Map());
  const [videoCache] = useState<Map<string, HTMLVideoElement>>(new Map());
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  useEffect(() => {
    layers.forEach(layer => {
        if (layer.source?.type === ContentType.IMAGE && layer.source.url) {
            if (!imageCache.has(layer.source.url)) {
                const img = new Image();
                img.src = layer.source.url;
                img.onload = () => imageCache.set(layer.source.url, img);
            }
        }

        if (layer.source?.type === ContentType.VIDEO && layer.source.url) {
            let video = videoCache.get(layer.id);
            if (!video) {
                video = document.createElement('video');
                video.crossOrigin = "anonymous";
                video.loop = true;
                video.playsInline = true;
                video.preload = "auto";
                videoCache.set(layer.id, video);
                
                video.onloadedmetadata = () => {
                   if (Math.abs(video!.duration - layer.playback.duration) > 0.5) {
                       onUpdateLayer(layer.id, { playback: { ...layer.playback, duration: video!.duration } });
                   }
                };
            }
            
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

            const timeDiff = Math.abs(video.currentTime - layer.playback.currentTime);
            // Allow a larger drift during transitions (video restart) to avoid fighting
            if (timeDiff > 1.0) {
                 video.currentTime = layer.playback.currentTime;
            }
        }
    });
  }, [layers, videoCache, imageCache, onUpdateLayer]);

  useEffect(() => {
      if (!gridCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = 512;
          c.height = 512;
          const ctx = c.getContext('2d');
          if (ctx) {
              ctx.fillStyle = '#002200';
              ctx.fillRect(0,0,512,512);
              ctx.strokeStyle = '#00ff00';
              ctx.lineWidth = 2;
              ctx.beginPath();
              for(let i=0; i<=512; i+=50) {
                  ctx.moveTo(i, 0); ctx.lineTo(i, 512);
                  ctx.moveTo(0, i); ctx.lineTo(512, i);
              }
              ctx.stroke();
          }
          gridCanvasRef.current = c;
      }
  }, []);

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

  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false }); // Optimize for no transparency on bg if possible, but we need it for layers

    const render = () => {
      if (!canvas || !ctx) return;

      // Ensure canvas DOM size matches logical size
      if (canvas.width !== containerSize.w || canvas.height !== containerSize.h) {
        canvas.width = containerSize.w;
        canvas.height = containerSize.h;
      }

      // Clear
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render layers
      layers.forEach(layer => {
          if (!layer.visible) return;
          if (!layer.source) return;
          if (layer.points.length < 3) return;

          // Calculate final opacity: User setting * System transition
          // Default transitionOpacity to 1 if undefined
          const transitionOpacity = layer.transitionOpacity !== undefined ? layer.transitionOpacity : 1;
          const finalOpacity = layer.opacity * transitionOpacity;

          if (finalOpacity <= 0.01) return; // Skip if basically invisible

          const triangles = triangulate(layer.points);
          if (triangles.length === 0) return;

          ctx.globalAlpha = finalOpacity;

          let texture: CanvasImageSource | null = null;
          let texW = 1000;
          let texH = 1000;

          if (layer.source.type === ContentType.VIDEO) {
              const vid = videoCache.get(layer.id);
              if (vid && vid.readyState >= 2) {
                  texture = vid;
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
          } else if (layer.source.type === ContentType.SOLID_COLOR && gridCanvasRef.current) {
              texture = gridCanvasRef.current;
              texW = 512;
              texH = 512;
          }

          if (texture) {
             let pattern: CanvasPattern | null = null;
             try {
                 pattern = ctx.createPattern(texture, 'repeat');
             } catch (e) {}

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
                 
                 // Reset transform to draw the texture
                 ctx.setTransform(a, b, c, d, e, f);

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
      });

      // --- Draw Scene Bounds & Wireframe (Overlay) ---
      
      // Bounds (Visible in SETUP and MAPPING)
      // Only draw if we are NOT in Live (or if we are editing background in non-live)
      // The prompt asks for visibility in SETUP mode too.
      if ((mode === AppMode.MAPPING || mode === AppMode.SETUP) && !isEditingBackground) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform just in case
          
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          // Draw rect
          ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
          
          // Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = '12px monospace';
          ctx.fillText(`BOUNDS: ${canvas.width}x${canvas.height}`, 10, 20);
          ctx.restore();
      }

      // Wireframe (Only Active Layer in MAPPING)
      if (mode === AppMode.MAPPING && activeLayer && !activeLayer.locked) {
          const triangles = triangulate(activeLayer.points);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1 / transform.k;
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

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [containerSize, layers, activeLayerId, mode, transform.k, videoCache, imageCache, isEditingBackground]);

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

  // Start the editor with everything in view (the live projector keeps its own framing).
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (hasFittedRef.current || mode === AppMode.LIVE) return;
    hasFittedRef.current = true;
    resetView();
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
      if (action === 'seek' && value !== undefined) newPlayback.currentTime = value;
      
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
       
       <div 
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            transformOrigin: '0 0'
        }}
      >
        {backgroundUrl && (
            <div
                style={{
                    transform: `translate(${backgroundTransform.x}px, ${backgroundTransform.y}px) scale(${backgroundTransform.k})`,
                    transformOrigin: '0 0',
                    width: '100%',
                    height: '100%'
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
