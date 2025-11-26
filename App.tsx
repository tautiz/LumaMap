import React, { useState, useEffect, useCallback, useRef } from 'react';
import ControlPanel from './components/ControlPanel';
import SurfaceCanvas from './components/SurfaceCanvas';
import { AppMode, ControlPoint, ProjectionSource, ContentType, Transform } from './types';

// Constants
const CHANNEL_NAME = 'lumamap_sync_v1';

const App: React.FC = () => {
  // Check if we are in "Receiver/Live" mode
  const isReceiver = new URLSearchParams(window.location.search).get('live') === 'true';

  const [mode, setMode] = useState<AppMode>(isReceiver ? AppMode.LIVE : AppMode.SETUP);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [showBackgroundInLive, setShowBackgroundInLive] = useState(false);
  
  // Independent transform for the background image
  const [backgroundTransform, setBackgroundTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  // UI state to toggle between moving the camera or moving the background image
  const [isEditingBackground, setIsEditingBackground] = useState(false);

  const [source, setSource] = useState<ProjectionSource>({
    type: ContentType.SOLID_COLOR,
    url: '',
    name: 'Calibration Grid'
  });
  
  const [points, setPoints] = useState<ControlPoint[]>([
    { id: 'tl', x: 100, y: 100, u: 0, v: 0 },
    { id: 'tr', x: 500, y: 100, u: 1, v: 0 },
    { id: 'br', x: 500, y: 400, u: 1, v: 1 },
    { id: 'bl', x: 100, y: 400, u: 0, v: 1 }
  ]);
  
  const [opacity, setOpacity] = useState(0.8);
  const [uiVisible, setUiVisible] = useState(true);
  
  // Track canvas dimensions for normalization
  const canvasDims = useRef({ w: 800, h: 600 });
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Initialize BroadcastChannel
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, payload } = event.data;

      if (isReceiver) {
        // RECEIVER LOGIC
        if (type === 'SYNC') {
            const { points: normPoints, source: newSource, opacity: newOpacity, refSize, bgUrl, bgTransform, showBg } = payload;
            
            // Restore Source
            if (newSource && newSource.file && newSource.file instanceof File) {
               const newUrl = URL.createObjectURL(newSource.file);
               setSource({ ...newSource, url: newUrl });
            } else if (newSource) {
               setSource(newSource);
            }

            // Restore Opacity
            if (newOpacity !== undefined) setOpacity(newOpacity);

            // Restore Background
            if (bgUrl !== undefined) setBackgroundUrl(bgUrl);
            if (bgTransform !== undefined) setBackgroundTransform(bgTransform);
            if (showBg !== undefined) setShowBackgroundInLive(showBg);

            // Restore Points (Denormalize)
            if (normPoints && refSize) {
               // We need to convert 0-1 normalized points back to current screen pixels
               const currentW = canvasDims.current.w;
               const currentH = canvasDims.current.h;
               
               const denormalized = normPoints.map((p: any) => ({
                   ...p,
                   x: p.nx * currentW,
                   y: p.ny * currentH
               }));
               setPoints(denormalized);
            }
        }
      } else {
        // CONTROLLER LOGIC
        if (type === 'REQUEST_SYNC') {
           broadcastState();
        }
      }
    };

    if (isReceiver) {
        // Ask for initial state
        channel.postMessage({ type: 'REQUEST_SYNC' });
    }

    return () => {
        channel.close();
    };
  }, [isReceiver]);

  // Sync function for Controller
  const broadcastState = useCallback(() => {
     if (isReceiver || !channelRef.current) return;

     // Normalize points (0-1) based on current canvas size
     const w = canvasDims.current.w;
     const h = canvasDims.current.h;
     const normPoints = points.map(p => ({
         ...p,
         nx: p.x / w,
         ny: p.y / h
     }));

     channelRef.current.postMessage({
         type: 'SYNC',
         payload: {
             points: normPoints,
             source,
             opacity,
             refSize: { w, h },
             bgUrl: backgroundUrl,
             bgTransform: backgroundTransform,
             showBg: showBackgroundInLive
         }
     });
  }, [points, source, opacity, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive]);

  // Trigger sync on state changes
  useEffect(() => {
      if (!isReceiver) {
          broadcastState();
      }
  }, [points, source, opacity, broadcastState, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive]);

  // Re-scale points on receiver when window resizes
  useEffect(() => {
     if (!isReceiver) return;
     const handleResize = () => {
         channelRef.current?.postMessage({ type: 'REQUEST_SYNC' });
     };
     window.addEventListener('resize', handleResize);
     return () => window.removeEventListener('resize', handleResize);
  }, [isReceiver]);


  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' && !isReceiver) {
        setUiVisible(prev => !prev);
      }
      if (e.key === 'Escape') {
         if (!isReceiver) {
             setMode(AppMode.SETUP);
             setUiVisible(true);
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReceiver]);

  // UI Visibility
  useEffect(() => {
    if (mode === AppMode.LIVE || isReceiver) {
      setUiVisible(false);
    } else {
      setUiVisible(true);
    }
  }, [mode, isReceiver]);

  const handleUploadBackground = (file: File) => {
    const url = URL.createObjectURL(file);
    setBackgroundUrl(url);
    // Reset background transform when new image loads
    setBackgroundTransform({ x: 0, y: 0, k: 1 });
  };

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleOpenLive = () => {
      window.open(window.location.href.split('?')[0] + '?live=true', 'LumaMapLive', 'width=800,height=600');
  };

  const handleSave = () => {
    const safeSource = source && source.file ? { ...source, file: undefined, url: '' } : source;
    
    const data = {
      version: 1,
      points,
      opacity,
      source: safeSource && safeSource.url.startsWith('blob:') ? null : safeSource,
      mode,
      backgroundTransform
    };

    try {
      localStorage.setItem('lumaMapProject', JSON.stringify(data));
      alert("Project saved!\n\nNote: Geometry, background position, and AI textures are saved. Local uploaded video/image files cannot be saved and must be re-selected.");
    } catch (e) {
      console.error("Save failed", e);
      alert("Failed to save project. Storage might be full.");
    }
  };

  const handleLoad = () => {
    const json = localStorage.getItem('lumaMapProject');
    if (!json) {
      alert("No saved project found.");
      return;
    }

    try {
      const data = JSON.parse(json);
      if (data.points && Array.isArray(data.points)) {
        setPoints(data.points);
      }
      if (typeof data.opacity === 'number') {
        setOpacity(data.opacity);
      }
      if (data.backgroundTransform) {
        setBackgroundTransform(data.backgroundTransform);
      }
      if (data.source) {
        setSource(data.source);
      } else {
        setSource({
          type: ContentType.SOLID_COLOR,
          url: '',
          name: 'Calibration Grid'
        });
      }
      if (data.mode) {
        setMode(data.mode);
      }
      alert("Project loaded successfully.");
    } catch (e) {
      console.error("Load failed", e);
      alert("Failed to load project data.");
    }
  };

  // Determine if background should be visible
  // In SETUP/MAPPING: Always show if URL exists
  // In LIVE (or Receiver): Only show if showBackgroundInLive is true
  const shouldShowBackground = !!backgroundUrl && ((!isReceiver && mode !== AppMode.LIVE) || showBackgroundInLive);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex">
      {!isReceiver && uiVisible && (
        <ControlPanel
          mode={mode}
          setMode={setMode}
          setSource={setSource}
          toggleFullscreen={toggleFullscreen}
          backgroundUrl={backgroundUrl}
          onUploadBackground={handleUploadBackground}
          opacity={opacity}
          setOpacity={setOpacity}
          onSave={handleSave}
          onLoad={handleLoad}
          onOpenLive={handleOpenLive}
          
          showBackgroundInLive={showBackgroundInLive}
          setShowBackgroundInLive={setShowBackgroundInLive}
          isEditingBackground={isEditingBackground}
          setIsEditingBackground={setIsEditingBackground}
        />
      )}

      <main className={`flex-1 relative transition-all duration-300 ${(uiVisible && !isReceiver) ? 'ml-80' : 'ml-0'}`}>
        <SurfaceCanvas
          mode={mode}
          backgroundUrl={shouldShowBackground ? backgroundUrl : null}
          points={points}
          setPoints={setPoints}
          source={source}
          opacity={opacity}
          onDimensionsChange={(w, h) => { canvasDims.current = { w, h }; }}
          
          backgroundTransform={backgroundTransform}
          onBackgroundTransformChange={!isReceiver ? setBackgroundTransform : undefined}
          isEditingBackground={!isReceiver && isEditingBackground}
        />
        
        {/* Welcome Screen for Controller */}
        {!isReceiver && mode === AppMode.SETUP && !backgroundUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur text-white p-8 rounded-xl border border-slate-700 max-w-md text-center">
              <h2 className="text-2xl font-bold mb-4 text-cyan-400">Welcome to LumaMap</h2>
              <p className="text-slate-300 mb-4">
                This tool allows you to map digital content onto physical objects.
              </p>
              <div className="text-sm text-slate-400 space-y-2">
                <p>1. Connect a projector and extend your display.</p>
                <p>2. Upload a photo of the surface (taken from the projector's viewpoint) or use the camera.</p>
                <p>3. Use the sidebar to calibrate corners and generate textures.</p>
              </div>
            </div>
          </div>
        )}

        {/* Receiver Overlay hint */}
        {isReceiver && (
            <div className="absolute top-4 left-4 text-white/20 text-xs pointer-events-none z-[200]">
                Receiver Mode • Waiting for Controller...
            </div>
        )}
      </main>
    </div>
  );
};

export default App;