
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ControlPoint, ProjectionSource, ContentType, AppMode, Transform, Layer } from '../types';
import { triangulate, solveAffine, getBarycentric, pointInTriangle } from '../utils/math';
import Draggable from 'react-draggable';
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
  isEditingBackground = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  
  // Resource Cache
  const [imageCache] = useState<Map<string, HTMLImageElement>>(new Map());
  const [videoCache] = useState<Map<string, HTMLVideoElement>>(new Map());
  
  // Grid canvas cache
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Global Pan and Zoom State (Camera)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });

  // Selection and Editing State
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [editingUV, setEditingUV] = useState<{ index: number, field: 'u'|'v', value: string } | null>(null);

  // Video Player State (for active layer)
  const [videoState, setVideoState] = useState({
      isPlaying: false,
      isMuted: true,
      volume: 1,
      currentTime: 0,
      duration: 0
  });

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

  // --- Resource Management ---

  useEffect(() => {
    // Manage Video Elements for each layer
    layers.forEach(layer => {
        if (layer.source?.type === ContentType.VIDEO && layer.source.url) {
            if (!videoCache.has(layer.source.url)) {
                const video = document.createElement('video');
                video.crossOrigin = "anonymous";
                video.loop = true;
                video.playsInline = true;
                video.autoplay = true;
                video.muted = true; // Start muted
                video.src = layer.source.url;
                video.play().catch(() => {});
                videoCache.set(layer.source.url, video);
            }
        }
        if (layer.source?.type === ContentType.IMAGE && layer.source.url) {
            if (!imageCache.has(layer.source.url)) {
                const img = new Image();
                img.src = layer.source.url;
                img.onload = () => imageCache.set(layer.source.url, img);
            }
        }
    });
  }, [layers, videoCache, imageCache]);

  // Sync Video Controls with Active Layer's video
  useEffect(() => {
     if (!activeLayer || activeLayer.source?.type !== ContentType.VIDEO || !activeLayer.source.url) {
         return;
     }
     const video = videoCache.get(activeLayer.source.url);
     if (!video) return;

     const updateState = () => {
         setVideoState({
             isPlaying: !video.paused,
             isMuted: video.muted,
             volume: video.volume,
             currentTime: video.currentTime,
             duration: video.duration
         });
     };

     video.addEventListener('timeupdate', updateState);
     video.addEventListener('play', updateState);
     video.addEventListener('pause', updateState);
     video.addEventListener('volumechange', updateState);
     // Initial sync
     updateState();

     return () => {
         video.removeEventListener('timeupdate', updateState);
         video.removeEventListener('play', updateState);
         video.removeEventListener('pause', updateState);
         video.removeEventListener('volumechange', updateState);
     };
  }, [activeLayerId, layers, videoCache]);

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

  // --- Render Loop ---

  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');

    const render = () => {
      if (!canvas || !ctx) return;

      if (canvas.width !== containerSize.w || canvas.height !== containerSize.h) {
        canvas.width = containerSize.w;
        canvas.height = containerSize.h;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Render each visible layer
      layers.forEach(layer => {
          if (!layer.visible) return;
          if (!layer.source) return;
          if (layer.points.length < 3) return;

          // Triangulate on fly (fast enough)
          const triangles = triangulate(layer.points);
          if (triangles.length === 0) return;

          ctx.globalAlpha = mode === AppMode.MAPPING ? layer.opacity : 1;

          let texture: CanvasImageSource | null = null;
          let texW = 1000;
          let texH = 1000;

          if (layer.source.type === ContentType.VIDEO && layer.source.url) {
              const vid = videoCache.get(layer.source.url);
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

             // Draw Triangles
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
                 ctx.moveTo(p0.x, p0.y);
                 ctx.lineTo(p1.x, p1.y);
                 ctx.lineTo(p2.x, p2.y);
                 ctx.closePath();
                 ctx.clip();
                 ctx.setTransform(a, b, c, d, e, f);

                 if (pattern) {
                     ctx.fillStyle = pattern;
                     // Fill rect covering the triangle in texture space
                     const uCoords = [p0.u, p1.u, p2.u];
                     const vCoords = [p0.v, p1.v, p2.v];
                     const minU = Math.min(...uCoords) * texW;
                     const maxU = Math.max(...uCoords) * texW;
                     const minV = Math.min(...vCoords) * texH;
                     const maxV = Math.max(...vCoords) * texH;
                     ctx.fillRect(minU - 1, minV - 1, (maxU - minU) + 2, (maxV - minV) + 2);
                 } else {
                     ctx.drawImage(texture, 0, 0, texW, texH);
                 }
                 ctx.restore();
             }
          }
      });

      // Draw Wireframe for Active Layer
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
  }, [containerSize, layers, activeLayerId, mode, transform.k, videoCache, imageCache]);

  // --- Interactions ---

  const handleWheel = (e: React.WheelEvent) => {
    if (mode === AppMode.LIVE) return;
    
    // Background Zoom
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

    // Camera Zoom
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
    
    // Deselect if clicking background
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

  // --- Point Mesh Logic ---

  const handleDoubleClick = (e: React.MouseEvent) => {
      if (mode !== AppMode.MAPPING || isEditingBackground || !activeLayer || activeLayer.locked) return;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      const x = (rawX - transform.x) / transform.k;
      const y = (rawY - transform.y) / transform.k;

      // Calculate UV based on barycentric or simple projection
      let u = x / containerSize.w;
      let v = y / containerSize.h;
      
      // Try to find if inside existing triangle to get better UV
      const triangles = triangulate(activeLayer.points);
      for (let i = 0; i < triangles.length; i += 3) {
          const i0 = triangles[i]; const i1 = triangles[i+1]; const i2 = triangles[i+2];
          const p0 = activeLayer.points[i0]; const p1 = activeLayer.points[i1]; const p2 = activeLayer.points[i2];
          if (pointInTriangle(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
              const [w0, w1, w2] = getBarycentric(x, y, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
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
      setSelectedPointIndex(activeLayer.points.length); // Index of newly added point
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

  // --- Video HUD Handlers ---
  const handleVideoAction = (action: 'play' | 'pause' | 'volume' | 'seek' | 'mute', value?: number) => {
      if (!activeLayer || !activeLayer.source?.url) return;
      const video = videoCache.get(activeLayer.source.url);
      if (!video) return;

      if (action === 'play') video.play();
      if (action === 'pause') video.pause();
      if (action === 'mute') video.muted = !video.muted;
      if (action === 'volume' && value !== undefined) {
          video.volume = value;
          if (value > 0) video.muted = false;
      }
      if (action === 'seek' && value !== undefined) {
          video.currentTime = value;
      }
  };

  // --- UV Handlers ---
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
       
       {/* Background Reference Image */}
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

       {/* Canvas Container */}
       <div 
        ref={containerRef}
        className={`relative w-full h-full max-w-5xl max-h-[80vh] mx-auto z-10 overflow-hidden ring-1 ring-white/10 ${isEditingBackground ? 'ring-yellow-500/50' : ''}`}
        onWheel={handleWheel}
        onMouseDown={startPan}
        onMouseMove={updatePan}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onDoubleClick={handleDoubleClick}
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

                {/* Draggable Points (Only for Active Layer) */}
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
                                {/* UV Editor */}
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

            {/* HUD Elements */}
            {!isEditingBackground && mode === AppMode.MAPPING && (
                <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-[100]" onMouseDown={e => e.stopPropagation()}>
                    <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg p-1 flex flex-col gap-1 shadow-xl">
                        <button onClick={zoomIn} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><ZoomIn size={18} /></button>
                        <button onClick={resetView} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><RefreshCw size={18} /></button>
                        <button onClick={zoomOut} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded"><ZoomOut size={18} /></button>
                    </div>
                </div>
            )}
            
            {/* Video Controls for Active Layer */}
            {!isEditingBackground && mode === AppMode.MAPPING && activeLayer && activeLayer.source?.type === ContentType.VIDEO && (
                 <div 
                 className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-2 flex items-center gap-3 shadow-2xl z-[100] min-w-[300px]"
                 onMouseDown={(e) => e.stopPropagation()}
                >
                 <button onClick={() => handleVideoAction(videoState.isPlaying ? 'pause' : 'play')} className="p-1.5 text-cyan-400 hover:bg-slate-800 rounded-full transition-colors">
                     {videoState.isPlaying ? <Pause size={18} /> : <Play size={18} />}
                 </button>
 
                 <div className="flex-1 flex flex-col gap-1">
                     <input 
                         type="range" min={0} max={videoState.duration || 100} step={0.1}
                         value={videoState.currentTime} 
                         onChange={(e) => handleVideoAction('seek', parseFloat(e.target.value))}
                         className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                     />
                 </div>
 
                 <div className="flex items-center gap-1 group">
                     <button onClick={() => handleVideoAction('mute')} className="text-slate-400 hover:text-white">
                         {videoState.isMuted || videoState.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                     </button>
                     <div className="w-0 overflow-hidden group-hover:w-16 transition-all duration-300">
                         <input 
                             type="range" min={0} max={1} step={0.05}
                             value={videoState.isMuted ? 0 : videoState.volume}
                             onChange={(e) => handleVideoAction('volume', parseFloat(e.target.value))}
                             className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                         />
                     </div>
                 </div>
             </div>
            )}

            {isEditingBackground && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-600/90 text-white px-4 py-1 rounded-full text-xs font-bold pointer-events-none shadow-lg z-[100]">
                    EDITING BACKGROUND POSITION
                </div>
            )}
       </div>
    </div>
  );
};

export default SurfaceCanvas;
