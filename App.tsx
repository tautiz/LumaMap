
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ControlPanel from './components/ControlPanel';
import SurfaceCanvas from './components/SurfaceCanvas';
import HelpDialog from './components/HelpDialog';
import { useI18n } from './i18n';
import { HelpCircle, Monitor, Move, Play, SlidersHorizontal } from 'lucide-react';
import { AppMode, Layer, ControlPoint, ProjectionSource, ContentType, Transform, KeyMap, ShortcutAction } from './types';
import { SavedProject, saveToBrowser, loadFromBrowser, exportShowFile, parseShowFile, fetchShowFile } from './services/projectStore';

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
  const { t } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const isReceiver = params.get('live') === 'true';
  // Show mode (?show or ?show=<file.lumamap>): open a saved show and project it straight away, no controls.
  const isShow = !isReceiver && params.has('show');
  const showSource = params.get('show') || '';

  const [mode, setMode] = useState<AppMode>(isReceiver || isShow ? AppMode.LIVE : AppMode.SETUP);
  const [showStatus, setShowStatus] = useState<'loading' | 'ready' | 'missing' | 'retrying'>('loading');
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<Blob | null>(null);
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
    if (layers.length === 0 && !isReceiver && !isShow) {
        const initialLayer = createLayer(t('map.layers.defaultName', { n: 1 }), projectorSize.w, projectorSize.h, {
            type: ContentType.SOLID_COLOR,
            url: '',
            name: 'Grid Pattern'
        });
        setLayers([initialLayer]);
        setActiveLayerId(initialLayer.id);
    }
  }, []);
  
  const [uiVisible, setUiVisible] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  // When the panel is hidden (e.g. during the show), reveal a "show controls" button on mouse move.
  const [showRevealButton, setShowRevealButton] = useState(false);
  useEffect(() => {
    if (isReceiver || isShow || uiVisible) return;
    let timer: number | undefined;
    const onMove = () => {
      setShowRevealButton(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowRevealButton(false), 2500);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.clearTimeout(timer);
      setShowRevealButton(false);
    };
  }, [uiVisible, isReceiver]);
  
  const canvasDims = useRef({ w: 2363, h: 1320 });
  const channelRef = useRef<BroadcastChannel | null>(null);

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const addLayer = () => {
    const newLayer = createLayer(
        t('map.layers.defaultName', { n: layers.length + 1 }),
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
        name: `${original.name} ${t('map.layers.copySuffix')}`,
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
                 if (!isReceiver && !isShow) setUiVisible(prev => !prev);
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
    setBackgroundFile(file);
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

  const currentProject = (): SavedProject => ({
    layers,
    backgroundFile,
    backgroundTransform,
    showBackgroundInLive,
    projectorSize,
    keyMappings,
  });

  const applyProject = (project: SavedProject) => {
    setProjectorSize(project.projectorSize);
    setLayers(project.layers);
    setActiveLayerId(project.layers[0]?.id ?? null);
    setBackgroundTransform(project.backgroundTransform);
    setShowBackgroundInLive(project.showBackgroundInLive);
    setBackgroundFile(project.backgroundFile);
    setBackgroundUrl(project.backgroundFile ? URL.createObjectURL(project.backgroundFile) : null);
    if (project.keyMappings) setKeyMappings(project.keyMappings);
  };

  const handleSave = async () => {
    try {
      await saveToBrowser(currentProject());
      alert(t('alert.saved'));
    } catch (e) {
      console.error("Save failed", e);
      alert(t('alert.saveFailed'));
    }
  };

  const handleLoad = async () => {
    try {
      const project = await loadFromBrowser();
      if (!project) {
        alert(t('alert.noSaved'));
        return;
      }
      applyProject(project);
      alert(t('alert.loaded'));
    } catch (e) {
      console.error("Load failed", e);
      alert(t('alert.loadFailed'));
    }
  };

  const handleExport = () => {
    const url = URL.createObjectURL(exportShowFile(currentProject()));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumamap-show.lumamap';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImport = async (file: File) => {
    try {
      applyProject(parseShowFile(await file.arrayBuffer()));
      alert(t('alert.loaded'));
    } catch (e) {
      console.error("Import failed", e);
      alert(t('alert.loadFailed'));
    }
  };

  const showLink = window.location.href.split('?')[0] + '?show';

  // Show mode: load the show on start. A show file from the network is retried until it arrives,
  // because right after power-on the Wi-Fi may not be up yet.
  useEffect(() => {
    if (!isShow) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = async () => {
      try {
        const project = showSource ? await fetchShowFile(showSource) : await loadFromBrowser();
        if (cancelled) return;
        if (project) {
          applyProject(project);
          setShowStatus('ready');
        } else {
          setShowStatus('missing');
        }
      } catch (e) {
        console.error("Show load failed, retrying", e);
        if (cancelled) return;
        setShowStatus('retrying');
        timer = window.setTimeout(attempt, 5000);
      }
    };
    attempt();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isShow, showSource]);

  // Keep the screen from sleeping during an unattended show.
  useEffect(() => {
    if (!isShow || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () => navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release(); };
  }, [isShow]);

  const shouldShowBackground = !!backgroundUrl && ((!isReceiver && mode !== AppMode.LIVE) || showBackgroundInLive);

  return (
    <div className={`w-screen h-screen bg-black overflow-hidden flex items-center justify-center ${isShow ? 'cursor-none' : ''}`}>
      {!isReceiver && !isShow && uiVisible && (
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
          onExport={handleExport}
          onImport={handleImport}
          showLink={showLink}
          onOpenLive={handleOpenLive}
          onOpenHelp={() => setHelpOpen(true)}
          
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

      <main className={`relative transition-all duration-300 h-full bg-slate-900 ${(uiVisible && !isReceiver && !isShow) ? 'ml-96 w-[calc(100%-24rem)]' : 'ml-0 w-full'}`}>
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
        
        {!isReceiver && mode === AppMode.SETUP && !backgroundUrl && !welcomeDismissed && (
          <div className="absolute inset-0 z-[150] flex items-center justify-center p-6 bg-black/40">
            <div className="bg-slate-900/95 backdrop-blur text-white p-8 rounded-2xl border border-slate-700 shadow-2xl max-w-lg w-full">
              <h2 className="text-3xl font-extrabold mb-3 bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">{t('welcome.title')}</h2>
              <p className="text-slate-300 mb-6 leading-relaxed">{t('welcome.intro')}</p>
              <ol className="space-y-4 mb-8">
                {[
                  { icon: Monitor, color: 'bg-cyan-500', text: t('welcome.step1') },
                  { icon: Move, color: 'bg-purple-500', text: t('welcome.step2') },
                  { icon: Play, color: 'bg-emerald-500', text: t('welcome.step3') },
                ].map(({ icon: Icon, color, text }, i) => (
                  <li key={i} className="flex items-center gap-4">
                    <span className={`shrink-0 w-12 h-12 rounded-2xl ${color} text-slate-900 flex items-center justify-center relative`}>
                      <Icon size={24} />
                      <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white text-slate-900 text-sm font-bold flex items-center justify-center">{i + 1}</span>
                    </span>
                    <span className="text-base text-slate-100">{text}</span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-3">
                <button onClick={() => setWelcomeDismissed(true)} className="flex-1 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold text-lg transition-colors">
                  {t('welcome.start')}
                </button>
                <button onClick={() => setHelpOpen(true)} className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-2 transition-colors">
                  <HelpCircle size={18} /> {t('common.help')}
                </button>
              </div>
            </div>
          </div>
        )}

        {!isReceiver && !isShow && !uiVisible && (
          <button
            onClick={() => setUiVisible(true)}
            className={`absolute top-4 left-4 z-[200] flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 border border-slate-600 text-white text-sm font-semibold shadow-xl transition-opacity duration-300 ${showRevealButton ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <SlidersHorizontal size={16} /> {t('live.showControls')}
          </button>
        )}

        {isShow && showStatus !== 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none z-[200]">
                <p className="text-white/60 text-2xl text-center max-w-2xl">
                    {t(showStatus === 'loading' ? 'show.loading' : showStatus === 'retrying' ? 'show.retrying' : 'show.missing')}
                </p>
            </div>
        )}

        {isReceiver && (
            <div className="absolute top-4 left-4 text-white/20 text-xs pointer-events-none z-[200]">
                {t('receiver.waiting')}
            </div>
        )}
      </main>

      {helpOpen && <HelpDialog keyMappings={keyMappings} onClose={() => setHelpOpen(false)} />}
    </div>
  );
};

export default App;
