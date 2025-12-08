
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ControlPanel from './components/ControlPanel';
import SurfaceCanvas from './components/SurfaceCanvas';
import { AppMode, Layer, ControlPoint, ProjectionSource, ContentType, Transform, KeyMap, ShortcutAction } from './types';

const CHANNEL_NAME = 'lumamap_sync_v2';

const createDefaultPoints = (w: number, h: number): ControlPoint[] => {
  const padding = Math.min(w, h) * 0.15; // 15% padding
  return [
    { id: 'tl', x: padding, y: padding, u: 0, v: 0 },
    { id: 'tr', x: w - padding, y: padding, u: 1, v: 0 },
    { id: 'br', x: w - padding, y: h - padding, u: 1, v: 1 },
    { id: 'bl', x: padding, y: h - padding, u: 0, v: 1 }
  ];
};

const createLayer = (name: string, w: number, h: number, source: ProjectionSource | null = null): Layer => ({
  id: Math.random().toString(36).substr(2, 9),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  transitionOpacity: 1, // Default fully visible
  source,
  points: createDefaultPoints(w, h),
  playback: {
    isPlaying: true,
    volume: 1,
    isMuted: true,
    currentTime: 0,
    duration: 0
  }
});

const DEFAULT_KEY_MAP: KeyMap = {
  'NEXT_LAYER': 'ArrowRight',
  'PREV_LAYER': 'ArrowLeft',
  'BLACKOUT': '0',
  'TOGGLE_UI': 'h'
};

const App: React.FC = () => {
  const isReceiver = new URLSearchParams(window.location.search).get('live') === 'true';

  const [mode, setMode] = useState<AppMode>(isReceiver ? AppMode.LIVE : AppMode.SETUP);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [showBackgroundInLive, setShowBackgroundInLive] = useState(false);
  
  const [backgroundTransform, setBackgroundTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [isEditingBackground, setIsEditingBackground] = useState(false);

  // Default Resolution set to 2363x1320
  const [projectorSize, setProjectorSize] = useState<{ w: number, h: number }>({ w: 2363, h: 1320 });

  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  
  const [keyMappings, setKeyMappings] = useState<KeyMap>(DEFAULT_KEY_MAP);

  // Animation Refs
  const transitionRef = useRef<number | null>(null);

  // Initial Layer Creation
  useEffect(() => {
    if (layers.length === 0 && !isReceiver) {
        const initialLayer = createLayer('Layer 1', projectorSize.w, projectorSize.h, {
            type: ContentType.SOLID_COLOR,
            url: '',
            name: 'Grid Pattern'
        });
        setLayers([initialLayer]);
        setActiveLayerId(initialLayer.id);
    }
  }, []);
  
  const [uiVisible, setUiVisible] = useState(true);
  
  const canvasDims = useRef({ w: 2363, h: 1320 });
  const channelRef = useRef<BroadcastChannel | null>(null);

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const addLayer = () => {
    const newLayer = createLayer(
        `Layer ${layers.length + 1}`, 
        projectorSize.w, 
        projectorSize.h,
        {
            type: ContentType.SOLID_COLOR,
            url: '',
            name: 'New Grid'
        }
    );
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const duplicateLayer = (id: string) => {
    const original = layers.find(l => l.id === id);
    if (!original) return;

    const newLayer: Layer = {
        ...original,
        id: Math.random().toString(36).substr(2, 9),
        name: `${original.name} (Copy)`,
        // CRITICAL: Generate new IDs for points so they are independent
        points: original.points.map(p => ({
            ...p,
            id: Math.random().toString(36).substr(2, 9)
        })),
        // Shallow copy source is fine, but if it's an object make sure it's new ref
        source: original.source ? { ...original.source } : null,
        playback: { ...original.playback }
    };

    setLayers(prev => {
        const idx = prev.findIndex(l => l.id === id);
        const newLayers = [...prev];
        // Insert right after the original
        newLayers.splice(idx + 1, 0, newLayer);
        return newLayers;
    });
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

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, payload } = event.data;

      if (isReceiver) {
        if (type === 'SYNC') {
            const { layers: normLayers, refSize, bgUrl, bgTransform, showBg, projSize } = payload;
            
            if (projSize) setProjectorSize(projSize);

            if (normLayers && refSize) {
                // Use the broadcasted resolution to de-normalize
                const w = projSize ? projSize.w : canvasDims.current.w;
                const h = projSize ? projSize.h : canvasDims.current.h;

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

            if (bgUrl !== undefined) setBackgroundUrl(bgUrl);
            if (bgTransform !== undefined) setBackgroundTransform(bgTransform);
            if (showBg !== undefined) setShowBackgroundInLive(showBg);
        }
      } else {
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

  const broadcastState = useCallback(() => {
     if (isReceiver || !channelRef.current) return;

     // If using explicit projector size, normalize against that, otherwise current canvas dims
     const w = projectorSize.w;
     const h = projectorSize.h;

     const normLayers = layers.map(l => ({
         ...l,
         normPoints: l.points.map(p => ({ ...p, nx: p.x / w, ny: p.y / h })),
         points: undefined
     }));

     channelRef.current.postMessage({
         type: 'SYNC',
         payload: {
             layers: normLayers,
             refSize: { w, h },
             bgUrl: backgroundUrl,
             bgTransform: backgroundTransform,
             showBg: showBackgroundInLive,
             projSize: projectorSize
         }
     });
  }, [layers, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive, projectorSize]);

  useEffect(() => {
      if (!isReceiver) {
          broadcastState();
      }
  }, [layers, broadcastState, isReceiver, backgroundUrl, backgroundTransform, showBackgroundInLive, projectorSize]);

  useEffect(() => {
     if (!isReceiver) return;
     const handleResize = () => {
         channelRef.current?.postMessage({ type: 'REQUEST_SYNC' });
     };
     window.addEventListener('resize', handleResize);
     return () => window.removeEventListener('resize', handleResize);
  }, [isReceiver]);

  // --- External Control API & Shortcuts ---

  useEffect(() => {
    // 1. Expose API
    window.LumaAPI = {
      toggleLayerVisibility: (index: number) => {
        setLayers(prev => {
          const newLayers = [...prev];
          if (newLayers[index]) {
            newLayers[index] = { ...newLayers[index], visible: !newLayers[index].visible };
          }
          return newLayers;
        });
      },
      setLayerOpacity: (index: number, opacity: number) => {
        setLayers(prev => {
          const newLayers = [...prev];
          if (newLayers[index]) {
            newLayers[index] = { ...newLayers[index], opacity: Math.max(0, Math.min(1, opacity)) };
          }
          return newLayers;
        });
      },
      blackout: () => {
        setLayers(prev => prev.map(l => ({ ...l, visible: false })));
      },
      restoreAll: () => {
        setLayers(prev => prev.map(l => ({ ...l, visible: true })));
      },
      getStatus: () => layers
    };

    // 2. Cycle Logic with Smooth Transition
    const cycleLayerSolo = (dir: 'next' | 'prev') => {
        // Cancel any pending transitions
        if (transitionRef.current) cancelAnimationFrame(transitionRef.current);

        setLayers(prev => {
            if (prev.length === 0) return prev;
            
            // Find currently visible layer
            const currentIdx = prev.findIndex(l => l.visible && (l.transitionOpacity === undefined || l.transitionOpacity > 0.1));
            
            let nextIdx = 0;
            if (currentIdx === -1) {
                nextIdx = 0;
            } else {
                if (dir === 'next') {
                    nextIdx = (currentIdx + 1) % prev.length;
                } else {
                    nextIdx = (currentIdx - 1 + prev.length) % prev.length;
                }
            }
            
            // If already on the target (e.g. only 1 layer), do nothing or just ensure it's visible
            if (currentIdx === nextIdx) return prev;

            const outgoingId = currentIdx !== -1 ? prev[currentIdx].id : null;
            const incomingId = prev[nextIdx].id;

            // Start Transition Animation Loop
            let startTime = performance.now();
            const DURATION = 500; // ms per phase (fade out then fade in)

            const animate = (time: number) => {
                const elapsed = time - startTime;
                
                // Phase 1: Fade Out
                if (elapsed <= DURATION) {
                    const progress = Math.min(1, elapsed / DURATION);
                    // Linear fade out: 1 -> 0
                    const fadeVal = 1 - progress;

                    setLayers(currentLayers => {
                        return currentLayers.map(l => {
                            if (l.id === outgoingId) return { ...l, transitionOpacity: fadeVal };
                            if (l.id === incomingId) return { ...l, visible: false, transitionOpacity: 0 }; // Keep incoming hidden
                            return l;
                        });
                    });
                    transitionRef.current = requestAnimationFrame(animate);
                } 
                // Phase 2: Switch & Fade In
                else {
                    const fadeSeconds = (elapsed - DURATION) / DURATION;
                    const progress = Math.min(1, fadeSeconds);
                    
                    // Linear fade in: 0 -> 1
                    const fadeVal = progress;

                    setLayers(currentLayers => {
                         // One-time Trigger: When we just passed DURATION, ensure video restart
                         // We detect this by checking if incoming is still not visible
                         // Note: This block runs every frame of phase 2, so we need to be idempotent or just set properties
                         
                         return currentLayers.map(l => {
                            if (l.id === outgoingId) {
                                return { ...l, visible: false, transitionOpacity: 1 }; // Reset hidden layer to full op for next time
                            }
                            if (l.id === incomingId) {
                                // Restart video if it's the start of Phase 2
                                let newPlayback = { ...l.playback };
                                if (!l.visible && l.source?.type === ContentType.VIDEO) {
                                    newPlayback.currentTime = 0;
                                    newPlayback.isPlaying = true;
                                }
                                return { 
                                    ...l, 
                                    visible: true, 
                                    transitionOpacity: fadeVal,
                                    playback: newPlayback
                                };
                            }
                            return l;
                        });
                    });

                    if (progress < 1) {
                        transitionRef.current = requestAnimationFrame(animate);
                    } else {
                        transitionRef.current = null; // Done
                    }
                }
            };

            transitionRef.current = requestAnimationFrame(animate);

            // Return state as-is for now, the animation loop handles the updates
            return prev;
        });
    };

    // 3. Main Keyboard Handler
    const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        // Number keys always directly toggle layers 1-9
        if (e.key >= '1' && e.key <= '9') {
            const index = parseInt(e.key) - 1;
            window.LumaAPI.toggleLayerVisibility(index);
            return;
        }

        // Map key to Action
        let action: ShortcutAction | null = null;
        for (const [act, key] of Object.entries(keyMappings)) {
            if (key === e.key) {
                action = act as ShortcutAction;
                break;
            }
        }

        if (!action) return;

        // If in Mapping mode, prevent navigational/solo shortcuts from interfering with arrow movement
        // UNLESS the mapped key is NOT an arrow key (e.g. Spacebar).
        if (mode === AppMode.MAPPING && e.key.startsWith('Arrow')) {
            // Let the Canvas handle fine-tuning coordinates
            return;
        }
        
        // Execute Action
        switch (action) {
            case 'NEXT_LAYER':
                cycleLayerSolo('next');
                break;
            case 'PREV_LAYER':
                cycleLayerSolo('prev');
                break;
            case 'BLACKOUT':
                 // Toggle Blackout: If any are visible, hide all. If none visible, show first or restore.
                setLayers(prev => {
                    const anyVisible = prev.some(l => l.visible);
                    if (anyVisible) {
                        return prev.map(l => ({ ...l, visible: false }));
                    } else {
                        // Restore first layer
                        return prev.map((l, i) => ({ ...l, visible: i === 0 }));
                    }
                });
                break;
            case 'TOGGLE_UI':
                 if (!isReceiver) setUiVisible(prev => !prev);
                 break;
        }

        if (mode === AppMode.SETUP && e.key === 'Escape') {
            setUiVisible(true);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layers, mode, isReceiver, keyMappings]);

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
      // Open with specific size if possible, though browsers restrict this
      const features = `width=${projectorSize.w},height=${projectorSize.h}`;
      window.open(window.location.href.split('?')[0] + '?live=true', 'LumaMapLive', features);
  };

  const handleSave = () => {
    const safeLayers = layers.map(l => ({
        ...l,
        source: l.source && l.source.url.startsWith('blob:') 
            ? { ...l.source, url: '', file: undefined }
            : l.source
    }));
    
    const data = {
      version: 2,
      layers: safeLayers,
      backgroundTransform,
      projectorSize,
      keyMappings
    };

    try {
      localStorage.setItem('lumaMapProject', JSON.stringify(data));
      alert("Project saved!");
    } catch (e) {
      console.error("Save failed", e);
      alert("Failed to save project.");
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
      if (data.projectorSize) {
        setProjectorSize(data.projectorSize);
      }
      if (data.layers) {
        setLayers(data.layers);
        if (data.layers.length > 0) setActiveLayerId(data.layers[0].id);
      }
      if (data.backgroundTransform) {
        setBackgroundTransform(data.backgroundTransform);
      }
      if (data.keyMappings) {
        setKeyMappings(data.keyMappings);
      }
      alert("Project loaded successfully.");
    } catch (e) {
      console.error("Load failed", e);
      alert("Failed to load project data.");
    }
  };

  const shouldShowBackground = !!backgroundUrl && ((!isReceiver && mode !== AppMode.LIVE) || showBackgroundInLive);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex items-center justify-center">
      {!isReceiver && uiVisible && (
        <ControlPanel
          mode={mode}
          setMode={setMode}
          
          layers={layers}
          activeLayerId={activeLayerId}
          onAddLayer={addLayer}
          onRemoveLayer={removeLayer}
          onDuplicateLayer={duplicateLayer}
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

          backgroundTransform={backgroundTransform}
          setBackgroundTransform={setBackgroundTransform}

          projectorSize={projectorSize}
          setProjectorSize={setProjectorSize}

          keyMappings={keyMappings}
          setKeyMappings={setKeyMappings}
        />
      )}

      <main className={`relative transition-all duration-300 h-full w-full bg-slate-900 ${(uiVisible && !isReceiver) ? 'ml-80' : 'ml-0'}`}>
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

          projectorSize={projectorSize}
        />
        
        {!isReceiver && mode === AppMode.SETUP && !backgroundUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur text-white p-8 rounded-xl border border-slate-700 max-w-md text-center">
              <h2 className="text-2xl font-bold mb-4 text-cyan-400">Welcome to LumaMap</h2>
              <div className="text-sm text-slate-400 space-y-2">
                <p>1. Set Projector Resolution in Setup (Default 2363x1320).</p>
                <p>2. Configure Keyboard Shortcuts in Setup.</p>
                <p>3. Use <strong>Map</strong> mode to add and warp layers.</p>
                <p>4. <strong>Remote Control:</strong> Use configured keys or 1-9.</p>
              </div>
            </div>
          </div>
        )}

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
