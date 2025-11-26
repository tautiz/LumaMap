
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ControlPanel from './components/ControlPanel';
import SurfaceCanvas from './components/SurfaceCanvas';
import { AppMode, Layer, ControlPoint, ProjectionSource, ContentType, Transform } from './types';

// Constants
const CHANNEL_NAME = 'lumamap_sync_v2';

const createDefaultPoints = (w: number, h: number): ControlPoint[] => [
  { id: 'tl', x: 100, y: 100, u: 0, v: 0 },
  { id: 'tr', x: w - 100, y: 100, u: 1, v: 0 },
  { id: 'br', x: w - 100, y: h - 100, u: 1, v: 1 },
  { id: 'bl', x: 100, y: h - 100, u: 0, v: 1 }
];

const createLayer = (name: string, source: ProjectionSource | null = null): Layer => ({
  id: Math.random().toString(36).substr(2, 9),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  source,
  points: createDefaultPoints(600, 500), // Default size, will be adjusted
  playback: {
    isPlaying: true, // Auto-play by default
    volume: 1,
    isMuted: true,
    currentTime: 0,
    duration: 0
  }
});

const App: React.FC = () => {
  // Check if we are in "Receiver/Live" mode
  const isReceiver = new URLSearchParams(window.location.search).get('live') === 'true';

  const [mode, setMode] = useState<AppMode>(isReceiver ? AppMode.LIVE : AppMode.SETUP);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [showBackgroundInLive, setShowBackgroundInLive] = useState(false);
  
  // Independent transform for the background image
  const [backgroundTransform, setBackgroundTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [isEditingBackground, setIsEditingBackground] = useState(false);

  // Layer State
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  // Initialize default layer
  useEffect(() => {
    if (layers.length === 0 && !isReceiver) {
        const initialLayer = createLayer('Layer 1', {
            type: ContentType.SOLID_COLOR,
            url: '',
            name: 'Grid Pattern'
        });
        setLayers([initialLayer]);
        setActiveLayerId(initialLayer.id);
    }
  }, []); // Run once
  
  const [uiVisible, setUiVisible] = useState(true);
  
  // Track canvas dimensions for normalization
  const canvasDims = useRef({ w: 800, h: 600 });
  const channelRef = useRef<BroadcastChannel | null>(null);

  // --- Layer Management Helpers ---

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const addLayer = () => {
    const newLayer = createLayer(`Layer ${layers.length + 1}`, {
        type: ContentType.SOLID_COLOR,
        url: '',
        name: 'New Grid'
    });
    // Adjust points to center of current view if possible? (Simulated by default points)
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const removeLayer = (id: string) => {
    setLayers(prev => {
        const filtered = prev.filter(l => l.id !== id);
        if (activeLayerId === id && filtered.length > 0) {
            setActiveLayerId(filtered[0].id);
        } else if (filtered.length === 0) {
            setActiveLayerId(null);
        }
        return filtered;
    });
  };

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
        const idx = prev.findIndex(l => l.id === id);
        if (idx === -1) return prev;
        const newLayers = [...prev];
        if (direction === 'up' && idx < newLayers.length - 1) {
            [newLayers[idx], newLayers[idx + 1]] = [newLayers[idx + 1], newLayers[idx]];
        } else if (direction === 'down' && idx > 0) {
            [newLayers[idx], newLayers[idx - 1]] = [newLayers[idx - 1], newLayers[idx]];
        }
        return newLayers;
    });
  };

  // --- Synchronization ---

  // Initialize BroadcastChannel
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, payload } = event.data;

      if (isReceiver) {
        // RECEIVER LOGIC
        if (type === 'SYNC') {
            const { layers: normLayers, refSize, bgUrl, bgTransform, showBg } = payload;
            
            // Restore Layers
            if (normLayers && refSize) {
                const w = canvasDims.current.w;
                const h = canvasDims.current.h;

                const restoredLayers: Layer[] = normLayers.map((nl: any) => ({
                    ...nl,
                    source: nl.source && nl.source.file && nl.source.file instanceof File 
                        ? { ...nl.source, url: URL.createObjectURL(nl.source.file) } 
                        : nl.source,
                    points: nl.normPoints.map((p: any) => ({
                        ...p,
                        x: p.nx * w,
                        y: p.ny * h
                    }))
                }));
                setLayers(restoredLayers);
            }

            // Restore Background
            if (bgUrl !== undefined) setBackgroundUrl(bgUrl);
            if (bgTransform !== undefined) setBackgroundTransform(bgTransform);
            if (showBg !== undefined) setShowBackgroundInLive(showBg);
        }
      } else {
        // CONTROLLER LOGIC
        if (type === 'REQUEST_SYNC') {
           broadcastState();
        }
      }
    };

    if (isReceiver) {
        channel.postMessage({ type: 'REQUEST_SYNC' });
    }

    return () => {
        channel.close();
    };
  }, [isReceiver]);

  // Sync function for Controller
  const broadcastState = useCallback(() => {
     if (isReceiver || !channelRef.current) return;

     const w = canvasDims.current.w;
     const h = canvasDims.current.h;

     // Normalize all layers
     const normLayers = layers.map(l => ({
         ...l,
         normPoints: l.points.map(p => ({ ...p, nx: p.x / w, ny: p.y / h })),
         points: undefined // Remove raw points from payload
     }));

     channelRef.current.postMessage({
         type: 'SYNC',
         payload: {
             layers: normLayers,
             refSize: { w, h },
             bgUrl: backgroundUrl,
             bgTransform: backgroundTransform,
             showBg: showBackgroundInLive
         }
     });
  }, [layers, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive]);

  // Trigger sync on state changes
  useEffect(() => {
      if (!isReceiver) {
          broadcastState();
      }
  }, [layers, broadcastState, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive]);

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
    // Strip blobs before saving
    const safeLayers = layers.map(l => ({
        ...l,
        source: l.source && l.source.url.startsWith('blob:') 
            ? { ...l.source, url: '', file: undefined } // Cannot save blobs
            : l.source
    }));
    
    const data = {
      version: 2,
      layers: safeLayers,
      backgroundTransform
    };

    try {
      localStorage.setItem('lumaMapProject', JSON.stringify(data));
      alert("Project saved! (Note: Local video/image files are not saved, only geometry)");
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
      if (data.layers) {
        // v2
        setLayers(data.layers);
        if (data.layers.length > 0) setActiveLayerId(data.layers[0].id);
      } else if (data.points) {
         // Migration from v1
         const legacyLayer = createLayer('Legacy Layer');
         legacyLayer.points = data.points;
         legacyLayer.source = data.source;
         legacyLayer.opacity = data.opacity || 1;
         setLayers([legacyLayer]);
         setActiveLayerId(legacyLayer.id);
      }

      if (data.backgroundTransform) {
        setBackgroundTransform(data.backgroundTransform);
      }
      alert("Project loaded successfully.");
    } catch (e) {
      console.error("Load failed", e);
      alert("Failed to load project data.");
    }
  };

  const shouldShowBackground = !!backgroundUrl && ((!isReceiver && mode !== AppMode.LIVE) || showBackgroundInLive);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex">
      {!isReceiver && uiVisible && (
        <ControlPanel
          mode={mode}
          setMode={setMode}
          
          // Layer Props
          layers={layers}
          activeLayerId={activeLayerId}
          onAddLayer={addLayer}
          onRemoveLayer={removeLayer}
          onSelectLayer={setActiveLayerId}
          onUpdateLayer={updateLayer}
          onMoveLayer={moveLayer}

          toggleFullscreen={toggleFullscreen}
          backgroundUrl={backgroundUrl}
          onUploadBackground={handleUploadBackground}
          onSave={handleSave}
          onLoad={handleLoad}
          onOpenLive={handleOpenLive}
          
          showBackgroundInLive={showBackgroundInLive}
          setShowBackgroundInLive={setShowBackgroundInLive}
          isEditingBackground={isEditingBackground}
          setIsEditingBackground={setIsEditingBackground}

          // Background Transform Control
          backgroundTransform={backgroundTransform}
          setBackgroundTransform={setBackgroundTransform}
        />
      )}

      <main className={`flex-1 relative transition-all duration-300 ${(uiVisible && !isReceiver) ? 'ml-80' : 'ml-0'}`}>
        <SurfaceCanvas
          mode={mode}
          backgroundUrl={shouldShowBackground ? backgroundUrl : null}
          
          layers={layers}
          activeLayerId={activeLayerId}
          onUpdateLayer={updateLayer}
          onSelectLayer={setActiveLayerId}

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
              <div className="text-sm text-slate-400 space-y-2">
                <p>1. Connect a projector and extend your display.</p>
                <p>2. Upload a photo of the surface (Reference).</p>
                <p>3. Use <strong>Map</strong> mode to add Layers and warp them.</p>
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
