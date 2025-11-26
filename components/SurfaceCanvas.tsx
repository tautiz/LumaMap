import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ControlPoint, ProjectionSource, ContentType, AppMode, Transform } from '../types';
import { triangulate, solveAffine, getBarycentric, pointInTriangle } from '../utils/math';
import Draggable from 'react-draggable';
import { ZoomIn, ZoomOut, RefreshCw, Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface SurfaceCanvasProps {
  mode: AppMode;
  backgroundUrl: string | null;
  points: ControlPoint[];
  setPoints: (points: ControlPoint[]) => void;
  source: ProjectionSource | null;
  opacity: number;
  onDimensionsChange?: (width: number, height: number) => void;

  // Background specific props
  backgroundTransform?: Transform;
  onBackgroundTransformChange?: (t: Transform) => void;
  isEditingBackground?: boolean;
}

const SurfaceCanvas: React.FC<SurfaceCanvasProps> = ({
  mode,
  backgroundUrl,
  points,
  setPoints,
  source,
  opacity,
  onDimensionsChange,
  backgroundTransform = { x: 0, y: 0, k: 1 },
  onBackgroundTransformChange,
  isEditingBackground = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(document.createElement('video'));
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  
  // Image cache
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  // Grid canvas cache
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Global Pan and Zoom State (Camera)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });

  // Selection and Editing State
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [editingUV, setEditingUV] = useState<{ index: number, field: 'u'|'v', value: string } | null>(null);

  // Video State
  const [videoState, setVideoState] = useState({
      isPlaying: false,
      isMuted: true,
      volume: 1,
      currentTime: 0,
      duration: 0
  });

  // Use useMemo for triangulation
  const triangles = useMemo(() => {
    if (points.length < 3) return [];
    return triangulate(points);
  }, [points]);
  
  // Manage stable refs for draggable elements
  const pointRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map());

  const getPointRef = (id: string): React.RefObject<HTMLDivElement> => {
    const existing = pointRefs.current.get(id);
    if (existing) {
      return existing;
    }
    const newRef = React.createRef<HTMLDivElement>();
    pointRefs.current.set(id, newRef);
    return newRef;
  };

  useEffect(() => {
    const currentIds = new Set(points.map(p => p.id));
    for (const id of pointRefs.current.keys()) {
      if (!currentIds.has(id)) {
        pointRefs.current.delete(id);
      }
    }
  }, [points]);

  // Initialize Video
  useEffect(() => {
    const video = videoRef.current;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.muted = true; 

    const onPlay = () => setVideoState(prev => ({ ...prev, isPlaying: true }));
    const onPause = () => setVideoState(prev => ({ ...prev, isPlaying: false }));
    const onTimeUpdate = () => setVideoState(prev => ({ ...prev, currentTime: video.currentTime }));
    const onLoadedMetadata = () => setVideoState(prev => ({ ...prev, duration: video.duration }));
    const onVolumeChange = () => setVideoState(prev => ({ ...prev, volume: video.volume, isMuted: video.muted }));

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('volumechange', onVolumeChange);

    if (source?.type === ContentType.VIDEO && source.url) {
      video.src = source.url;
      video.play().catch(e => {
          console.warn("Autoplay prevented, video requires interaction", e);
          setVideoState(prev => ({ ...prev, isPlaying: false }));
      });
    } else {
      video.pause();
      video.removeAttribute('src');
      setVideoState(prev => ({ ...prev, isPlaying: false, currentTime: 0, duration: 0 }));
    }

    return () => {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('volumechange', onVolumeChange);
    };
  }, [source]);

  // Load Image
  useEffect(() => {
    if (source?.type === ContentType.IMAGE && source.url) {
        const img = new Image();
        img.src = source.url;
        img.onload = () => setLoadedImage(img);
        img.onerror = () => setLoadedImage(null);
    } else {
        setLoadedImage(null);
    }
  }, [source]);

  // Initialize Grid Canvas
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

  // Handle Resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        setContainerSize({ w, h });
        if (onDimensionsChange) {
            onDimensionsChange(w, h);
        }
      }
    };
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, [onDimensionsChange]);

  // Main Render Loop
  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = videoRef.current;

    const render = () => {
      if (!canvas || !ctx) return;

      if (canvas.width !== containerSize.w || canvas.height !== containerSize.h) {
        canvas.width = containerSize.w;
        canvas.height = containerSize.h;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = mode === AppMode.MAPPING ? opacity : 1;

      if (!source) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#333333";
          ctx.font = "30px Arial";
          ctx.textAlign = "center";
          ctx.fillText("NO SIGNAL", canvas.width/2, canvas.height/2);
      } else if (points.length >= 3 && triangles.length > 0) {
        
        let texture: CanvasImageSource | null = null;
        let texW = 1000;
        let texH = 1000;

        if (source.type === ContentType.VIDEO) {
            texture = video;
            if (video.videoWidth) {
                texW = video.videoWidth;
                texH = video.videoHeight;
            }
        } else if (source.type === ContentType.IMAGE && loadedImage) {
            texture = loadedImage;
            texW = loadedImage.naturalWidth;
            texH = loadedImage.naturalHeight;
        } else if (source.type === ContentType.SOLID_COLOR && gridCanvasRef.current) {
            texture = gridCanvasRef.current;
            texW = 512;
            texH = 512;
        }

        if (texture) {
            let pattern: CanvasPattern | null = null;
            try {
                pattern = ctx.createPattern(texture, 'repeat');
            } catch (e) {
                // Texture might not be ready
            }

            for (let i = 0; i < triangles.length; i += 3) {
                const i0 = triangles[i];
                const i1 = triangles[i + 1];
                const i2 = triangles[i + 2];

                const p0 = points[i0];
                const p1 = points[i1];
                const p2 = points[i2];

                if (!p0 || !p1 || !p2) continue;

                const [a, b, c, d, e, f] = solveAffine(
                    p0.x, p0.y,
                    p1.x, p1.y,
                    p2.x, p2.y,
                    p0.u * texW, p0.v * texH,
                    p1.u * texW, p1.v * texH,
                    p2.u * texW, p2.v * texH
                );

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
                ctx.clip();
                
                ctx.setTransform(a, b, c, d, e, f);

                if (pattern) {
                    ctx.fillStyle = pattern;
                    const uCoords = [p0.u, p1.u, p2.u];
                    const vCoords = [p0.v, p1.v, p2.v];
                    const minU = Math.min(...uCoords) * texW;
                    const maxU = Math.max(...uCoords) * texW;
                    const minV = Math.min(...vCoords) * texH;
                    const maxV = Math.max(...vCoords) * texH;

                    ctx.fillRect(
                        minU - 1, 
                        minV - 1, 
                        (maxU - minU) + 2, 
                        (maxV - minV) + 2
                    );
                } else {
                    ctx.drawImage(texture, 0, 0, texW, texH);
                }
                
                ctx.restore();
            }
        }
      }

      // Draw Wireframe in MAPPING mode
      if (mode === AppMode.MAPPING && points.length >= 3) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1 / transform.k;
          ctx.beginPath();
          for (let i = 0; i < triangles.length; i += 3) {
             const p0 = points[triangles[i]];
             const p1 = points[triangles[i+1]];
             const p2 = points[triangles[i+2]];
             
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
  }, [containerSize, points, triangles, source, mode, opacity, transform.k, loadedImage]);

  // --- Zoom, Pan & Background Interaction ---

  const handleWheel = (e: React.WheelEvent) => {
    if (mode === AppMode.LIVE) return;
    
    // Check if we are scaling the background image
    if (isEditingBackground && onBackgroundTransformChange) {
        // Scaling Background
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

    // Scaling View (Camera)
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

  const startPan = (e: React.MouseEvent) => {
    if (mode === AppMode.LIVE) return;
    
    if (selectedPointIndex !== null) {
        setSelectedPointIndex(null);
    }

    setIsPanning(true);
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  };

  const updatePan = (e: React.MouseEvent) => {
    if (!isPanning) return;
    
    const dx = e.clientX - lastPanRef.current.x;
    const dy = e.clientY - lastPanRef.current.y;
    
    // If editing background, move the background (scaled inversely by view zoom)
    if (isEditingBackground && onBackgroundTransformChange) {
        onBackgroundTransformChange({
            ...backgroundTransform,
            x: backgroundTransform.x + dx / transform.k,
            y: backgroundTransform.y + dy / transform.k
        });
    } else {
        // Otherwise, move the view
        setTransform(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy
        }));
    }
    
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  };

  const endPan = () => {
    setIsPanning(false);
  };

  const resetView = () => {
    setTransform({ x: 0, y: 0, k: 1 });
  };

  const zoomIn = () => setTransform(prev => ({ ...prev, k: Math.min(prev.k * 1.2, 10) }));
  const zoomOut = () => setTransform(prev => ({ ...prev, k: Math.max(prev.k / 1.2, 0.1) }));


  // --- Point Interaction ---

  const handleDoubleClick = (e: React.MouseEvent) => {
      if (mode !== AppMode.MAPPING || isEditingBackground) return;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;

      const x = (rawX - transform.x) / transform.k;
      const y = (rawY - transform.y) / transform.k;

      let u = 0.5, v = 0.5;
      let found = false;

      for (let i = 0; i < triangles.length; i += 3) {
          const i0 = triangles[i];
          const i1 = triangles[i + 1];
          const i2 = triangles[i + 2];
          
          const p0 = points[i0];
          const p1 = points[i1];
          const p2 = points[i2];

          if (p0 && p1 && p2 && pointInTriangle(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
              const [w0, w1, w2] = getBarycentric(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
              u = w0 * p0.u + w1 * p1.u + w2 * p2.u;
              v = w0 * p0.v + w1 * p1.v + w2 * p2.v;
              found = true;
              break;
          }
      }

      if (!found) {
          u = x / containerSize.w;
          v = y / containerSize.h;
      }

      u = Math.max(0, Math.min(1, u));
      v = Math.max(0, Math.min(1, v));

      const newPoint: ControlPoint = {
          id: Math.random().toString(36).substr(2, 9),
          x, y, u, v
      };

      setPoints([...points, newPoint]);
      setSelectedPointIndex(points.length); 
  };

  const handleRemovePoint = (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (mode !== AppMode.MAPPING || isEditingBackground) return;
      if (points.length <= 3) return;
      
      const newPoints = points.filter((_, i) => i !== index);
      setPoints(newPoints);

      if (selectedPointIndex === index) {
          setSelectedPointIndex(null);
      } else if (selectedPointIndex !== null && selectedPointIndex > index) {
          setSelectedPointIndex(selectedPointIndex - 1);
      }
  };

  const handleDrag = (index: number, e: any, data: { x: number, y: number }) => {
     const newPoints = [...points];
     if (newPoints[index]) {
         newPoints[index] = { ...newPoints[index], x: data.x, y: data.y };
         setPoints(newPoints);
     }
  };

  // --- UV Editing ---
  
  const getInputValue = (index: number, field: 'u'|'v') => {
    if (editingUV && editingUV.index === index && editingUV.field === field) {
        return editingUV.value;
    }
    return Math.round(points[index][field] * 1000) / 1000;
  };

  const handleUVChange = (index: number, field: 'u' | 'v', rawValue: string) => {
    setEditingUV({ index, field, value: rawValue });
    const val = parseFloat(rawValue);
    if (!isNaN(val)) {
        const clamped = Math.max(0, Math.min(1, val));
        const newPoints = [...points];
        if (newPoints[index][field] !== clamped) {
             newPoints[index] = { ...newPoints[index], [field]: clamped };
             setPoints(newPoints);
        }
    }
  };

  const handleUVBlur = () => {
    setEditingUV(null);
  };

  // --- Video Controls ---
  const togglePlay = () => {
    const video = videoRef.current;
    if (video.paused) video.play().catch(console.error);
    else video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    video.muted = !video.muted;
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    const video = videoRef.current;
    video.volume = v;
    if (v > 0) video.muted = false;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    const video = videoRef.current;
    if (Number.isFinite(t)) {
        video.currentTime = t;
    }
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div 
        className={`relative w-full h-full bg-black overflow-hidden flex items-center justify-center select-none ${isEditingBackground ? 'cursor-move' : ''}`}
    >
      {/* Background Reference */}
      {/* 
         Logic:
         1. Container wraps Image to provide Global Pan/Zoom (Camera View).
         2. Image has independent transform (Local Position).
      */}
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

      {/* Main Container */}
      <div 
        ref={containerRef}
        className={`relative w-full h-full max-w-5xl max-h-[80vh] mx-auto z-10 overflow-hidden ring-1 ring-white/10 ${isEditingBackground ? 'ring-yellow-500/50' : ''}`}
        onWheel={handleWheel}
        onMouseDown={startPan}
        onMouseMove={updatePan}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isEditingBackground ? 'move' : 'default' }}
      >
        <div
          className="absolute top-0 left-0 w-full h-full origin-top-left will-change-transform"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`
          }}
        >
          <canvas 
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full block pointer-events-none"
          />

          {/* Draggable Handles */}
          {!isEditingBackground && mode === AppMode.MAPPING && points.map((p, idx) => {
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
                      {/* Point Visual */}
                      <div 
                        className={`w-full h-full rounded-full border-2 ${selectedPointIndex === idx ? 'border-yellow-400 bg-yellow-400/20' : 'border-cyan-400 bg-black/50'} backdrop-blur hover:bg-cyan-400/80 transition-colors flex items-center justify-center shadow-lg`}
                        style={{ transform: `scale(${1 / Math.max(transform.k, 0.5)})` }}
                      >
                          <div className={`w-1 h-1 ${selectedPointIndex === idx ? 'bg-yellow-400' : 'bg-white'} rounded-full`} />
                      </div>

                      {/* UV Editor */}
                      {selectedPointIndex === idx && (
                          <div 
                            className="absolute top-5 left-5 bg-slate-900/95 border border-slate-600 rounded p-2 flex flex-col gap-1 shadow-2xl min-w-[80px]"
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ 
                                transform: `scale(${1/transform.k})`, 
                                transformOrigin: 'top left',
                                cursor: 'default'
                            }}
                          >
                             <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 font-mono w-3">U</span>
                                <input 
                                    type="number" step="0.01" min="0" max="1"
                                    className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] px-1 py-0.5 text-cyan-400 focus:outline-none focus:border-cyan-500"
                                    value={getInputValue(idx, 'u')}
                                    onChange={(e) => handleUVChange(idx, 'u', e.target.value)}
                                    onBlur={handleUVBlur}
                                />
                             </div>
                             <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 font-mono w-3">V</span>
                                <input 
                                    type="number" step="0.01" min="0" max="1"
                                    className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] px-1 py-0.5 text-cyan-400 focus:outline-none focus:border-cyan-500"
                                    value={getInputValue(idx, 'v')}
                                    onChange={(e) => handleUVChange(idx, 'v', e.target.value)}
                                    onBlur={handleUVBlur}
                                />
                             </div>
                          </div>
                      )}
                  </div>
              </Draggable>
              );
          })}
        </div>

        {/* HUD: Editing Background Indicator */}
        {isEditingBackground && (
             <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-600/90 text-white px-4 py-1 rounded-full text-xs font-bold pointer-events-none shadow-lg z-[100]">
                EDITING BACKGROUND POSITION
             </div>
        )}

        {/* HUD: Zoom Controls */}
        {mode === AppMode.MAPPING && !isEditingBackground && (
          <div 
             className="absolute bottom-4 left-4 flex flex-col gap-2 z-[100]"
             onMouseDown={(e) => e.stopPropagation()} 
             onDoubleClick={(e) => e.stopPropagation()}
          >
             <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg p-1 flex flex-col gap-1 shadow-xl">
                <button onClick={zoomIn} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded" title="Zoom In">
                   <ZoomIn size={18} />
                </button>
                <button onClick={resetView} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded" title="Reset View">
                   <RefreshCw size={18} />
                </button>
                <button onClick={zoomOut} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded" title="Zoom Out">
                   <ZoomOut size={18} />
                </button>
             </div>
             <div className="bg-black/50 px-2 py-1 rounded text-[10px] text-center text-slate-300 pointer-events-none">
                {Math.round(transform.k * 100)}%
             </div>
          </div>
        )}

        {/* HUD: Video Controls */}
        {mode === AppMode.MAPPING && source?.type === ContentType.VIDEO && !isEditingBackground && (
            <div 
                className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-2 flex items-center gap-3 shadow-2xl z-[100] min-w-[300px]"
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
            >
                <button 
                    onClick={togglePlay}
                    className="p-1.5 text-cyan-400 hover:bg-slate-800 rounded-full transition-colors"
                >
                    {videoState.isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <div className="flex-1 flex flex-col gap-1">
                    <input 
                        type="range" 
                        min={0} 
                        max={videoState.duration || 100} 
                        step={0.1}
                        value={videoState.currentTime} 
                        onChange={handleSeek}
                        className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{formatTime(videoState.currentTime)}</span>
                        <span>{formatTime(videoState.duration)}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1 group">
                    <button onClick={toggleMute} className="text-slate-400 hover:text-white">
                        {videoState.isMuted || videoState.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <div className="w-0 overflow-hidden group-hover:w-16 transition-all duration-300">
                        <input 
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={videoState.isMuted ? 0 : videoState.volume}
                            onChange={handleVolume}
                            className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>
                </div>
            </div>
        )}

      </div>
      
      {mode === AppMode.LIVE && (
         <div className="absolute bottom-4 right-4 text-white/10 pointer-events-none text-xs">
            LIVE MODE
         </div>
      )}
    </div>
  );
};

export default SurfaceCanvas;