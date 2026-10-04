import React, { useState, useEffect } from 'react';
import { AppMode, ContentType, Layer, Transform, KeyMap, ShortcutAction } from '../types';
import { generateTexture } from '../services/gemini';
import { TranslationKey, formatKey, useI18n } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import MediaLibraryDialog from './MediaLibraryDialog';
import { playVideos, playlistStep } from '../services/mediaLibrary';
import {
  Upload, Monitor, Square, Layers, Sparkles, Move, Play, Image as ImageIcon, Save, FolderOpen, ExternalLink,
  Eye, EyeOff, Move3d, Plus, Trash2, ChevronUp, ChevronDown, Lock, Unlock, Settings, Copy, Keyboard,
  HelpCircle, Lightbulb, ArrowRight, Maximize, MousePointer2, ChevronRight, Download, Power, Link,
  Film, SkipBack, SkipForward, Repeat
} from 'lucide-react';

interface ControlPanelProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  // Layer Management
  layers: Layer[];
  activeLayerId: string | null;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onMoveLayer: (id: string, dir: 'up' | 'down') => void;

  toggleFullscreen: () => void;
  backgroundUrl: string | null;
  onUploadBackground: (file: File) => void;

  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  showLink: string;
  onOpenLive: () => void;
  onOpenHelp: () => void;

  showBackgroundInLive: boolean;
  setShowBackgroundInLive: (val: boolean) => void;
  isEditingBackground: boolean;
  setIsEditingBackground: (val: boolean) => void;

  backgroundTransform: Transform;
  setBackgroundTransform: (t: Transform) => void;

  projectorSize: { w: number, h: number };
  setProjectorSize: (size: { w: number, h: number }) => void;

  keyMappings: KeyMap;
  setKeyMappings: (map: KeyMap) => void;
}

const STEPS: { mode: AppMode; n: number; title: TranslationKey; desc: TranslationKey; icon: React.ElementType; active: string; ring: string }[] = [
  { mode: AppMode.SETUP, n: 1, title: 'step.setup.title', desc: 'step.setup.desc', icon: Monitor, active: 'bg-cyan-500 text-slate-900', ring: 'border-cyan-500' },
  { mode: AppMode.MAPPING, n: 2, title: 'step.map.title', desc: 'step.map.desc', icon: Move, active: 'bg-purple-500 text-white', ring: 'border-purple-500' },
  { mode: AppMode.LIVE, n: 3, title: 'step.live.title', desc: 'step.live.desc', icon: Play, active: 'bg-emerald-500 text-slate-900', ring: 'border-emerald-500' },
];

const SHORTCUTS: { id: ShortcutAction; label: TranslationKey }[] = [
  { id: 'NEXT_LAYER', label: 'setup.keys.next' },
  { id: 'PREV_LAYER', label: 'setup.keys.prev' },
  { id: 'BLACKOUT', label: 'setup.keys.blackout' },
  { id: 'TOGGLE_UI', label: 'setup.keys.toggleUi' },
];

const SectionTitle: React.FC<{ icon: React.ElementType; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <h2 className="text-base font-bold text-white flex items-center gap-2">
    <Icon size={18} className="text-slate-400" /> {children}
  </h2>
);

const Hint: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div className={`flex gap-3 items-start rounded-xl p-3 text-sm leading-snug ${color}`}>
    <Lightbulb size={20} className="shrink-0 mt-0.5" />
    <p>{children}</p>
  </div>
);

const IconButton: React.FC<{ onClick: (e: React.MouseEvent) => void; label: string; className?: string; children: React.ReactNode }> = ({ onClick, label, className = '', children }) => (
  <button onClick={onClick} title={label} aria-label={label} className={`p-1.5 rounded-md hover:bg-slate-700 transition-colors ${className}`}>
    {children}
  </button>
);

const ControlPanel: React.FC<ControlPanelProps> = ({
  mode,
  setMode,
  layers,
  activeLayerId,
  onAddLayer,
  onRemoveLayer,
  onDuplicateLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  toggleFullscreen,
  backgroundUrl,
  onUploadBackground,
  onSave,
  onLoad,
  onExport,
  onImport,
  showLink,
  onOpenLive,
  onOpenHelp,
  showBackgroundInLive,
  setShowBackgroundInLive,
  isEditingBackground,
  setIsEditingBackground,
  backgroundTransform,
  setBackgroundTransform,
  projectorSize,
  setProjectorSize,
  keyMappings,
  setKeyMappings
}) => {
  const { t } = useI18n();
  const [texturePrompt, setTexturePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const activeLayer = layers.find(l => l.id === activeLayerId);

  // Keyboard Recorder
  useEffect(() => {
    if (!recordingAction) return;

    const handleRecordKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Ignore modifiers on their own
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

        setKeyMappings({
            ...keyMappings,
            [recordingAction]: e.key
        });
        setRecordingAction(null);
    };

    window.addEventListener('keydown', handleRecordKey);
    return () => window.removeEventListener('keydown', handleRecordKey);
  }, [recordingAction, keyMappings, setKeyMappings]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'BACKGROUND' | 'CONTENT') => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    if (type === 'BACKGROUND') {
      onUploadBackground(file);
    } else {
      if (!activeLayer) return;
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video');
      onUpdateLayer(activeLayer.id, {
          source: {
            type: isVideo ? ContentType.VIDEO : ContentType.IMAGE,
            url,
            name: file.name,
            file: file
          },
          playlist: null
      });
    }
  };

  const handleGenerateTexture = async () => {
    if (!texturePrompt || !activeLayer) return;
    setIsGenerating(true);
    try {
      const base64Image = await generateTexture(texturePrompt);
      onUpdateLayer(activeLayer.id, {
          source: {
            type: ContentType.IMAGE,
            url: base64Image,
            name: `AI: ${texturePrompt}`
          }
      });
    } catch (error) {
      alert(t('map.ai.failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const sourceLabel = (layer: Layer) => {
    if (!layer.source) return t('map.selected.none');
    if (layer.source.type === ContentType.SOLID_COLOR) return t('source.grid');
    return layer.source.name;
  };

  return (
    <div className="absolute top-0 left-0 h-full w-96 bg-slate-900/95 backdrop-blur-md border-r border-slate-700 flex flex-col shadow-2xl z-50">
      {libraryOpen && activeLayer && (
        <MediaLibraryDialog
          onClose={() => setLibraryOpen(false)}
          onPick={(sources, loop) => onUpdateLayer(activeLayer.id, playVideos(activeLayer, sources, loop))}
        />
      )}
      {/* HEADER */}
      <div className="p-5 pb-4 space-y-4 border-b border-slate-800">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
              LumaMap
            </h1>
            <p className="text-sm text-slate-400">{t('app.tagline')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={onOpenHelp} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-yellow-400 text-slate-900 font-semibold text-sm hover:bg-yellow-300 transition-colors">
            <HelpCircle size={16} /> {t('common.help')}
          </button>
          <button onClick={onSave} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors">
            <Save size={16} /> {t('common.save')}
          </button>
          <button onClick={onLoad} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors">
            <FolderOpen size={16} /> {t('common.load')}
          </button>
        </div>

        {/* STEPS */}
        <nav className="grid grid-cols-3 gap-2">
          {STEPS.map(step => {
            const isActive = mode === step.mode;
            const Icon = step.icon;
            return (
              <button
                key={step.mode}
                onClick={() => setMode(step.mode)}
                aria-current={isActive ? 'step' : undefined}
                className={`flex flex-col items-center gap-1 rounded-xl py-2.5 px-1 border-2 transition-all ${
                  isActive ? `${step.ring} bg-slate-800 shadow-lg` : 'border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                }`}
              >
                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${isActive ? step.active : 'bg-slate-700 text-slate-300'}`}>
                  {isActive ? <Icon size={16} /> : step.n}
                </span>
                <span className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-300'}`}>{t(step.title)}</span>
                <span className="text-[11px] leading-tight text-slate-400 text-center">{t(step.desc)}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
      {/* STEP 1: SETUP */}
      {mode === AppMode.SETUP && (
        <>
          <Hint color="bg-cyan-500/15 text-cyan-100">{t('setup.hint')}</Hint>

          <section className="space-y-3">
            <SectionTitle icon={ImageIcon}>{t('setup.photo.title')}</SectionTitle>
            <label className={`relative border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors overflow-hidden ${
              backgroundUrl ? 'border-slate-700 hover:border-cyan-500 h-28' : 'border-cyan-600/60 hover:border-cyan-400 hover:bg-cyan-500/5 p-6'
            }`}>
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => handleFileUpload(e, 'BACKGROUND')} />
              {backgroundUrl ? (
                <>
                  <img src={backgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                  <span className="relative flex items-center gap-2 bg-slate-900/80 rounded-full px-3 py-1.5 text-sm text-white">
                    <Upload size={16} /> {t('setup.photo.change')}
                  </span>
                </>
              ) : (
                <>
                  <Upload className="text-cyan-400 mb-2" size={32} />
                  <span className="text-base font-semibold text-white">{t('setup.photo.upload')}</span>
                  <span className="text-xs text-slate-400 mt-1">{t('setup.photo.optional')}</span>
                </>
              )}
            </label>

            {backgroundUrl && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setIsEditingBackground(!isEditingBackground)}
                  className={`py-2.5 px-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                    isEditingBackground ? 'bg-yellow-500 text-slate-900' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <Move3d size={16} />
                  {isEditingBackground ? t('setup.photo.moveStop') : t('setup.photo.move')}
                </button>
                <button
                  onClick={() => setShowBackgroundInLive(!showBackgroundInLive)}
                  aria-pressed={showBackgroundInLive}
                  className={`py-2.5 px-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                    showBackgroundInLive ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {showBackgroundInLive ? <Eye size={16} /> : <EyeOff size={16} />}
                  {t('setup.photo.showInLive')}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle icon={Monitor}>{t('setup.projector.title')}</SectionTitle>
            <button
              onClick={onOpenLive}
              className="w-full py-3 rounded-xl bg-slate-800 border border-slate-600 text-white font-semibold hover:bg-slate-700 hover:border-cyan-500 flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink size={18} /> {t('setup.projector.open')}
            </button>
            <p className="text-xs text-slate-400">{t('setup.projector.openHint')}</p>
            <button onClick={toggleFullscreen} className="w-full py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 flex items-center justify-center gap-2">
              <Maximize size={16} /> {t('setup.fullscreen')}
            </button>
          </section>

          <details className="group rounded-xl border border-slate-800 bg-slate-800/30">
            <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-300 hover:text-white">
              <ChevronRight size={16} className="transition-transform group-open:rotate-90" />
              <Settings size={16} /> {t('common.more')}
            </summary>
            <div className="px-4 pb-4 space-y-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400 space-y-1">
                  <span>{t('setup.projector.width')}</span>
                  <input
                    type="number"
                    value={projectorSize.w}
                    onChange={(e) => setProjectorSize({ ...projectorSize, w: parseInt(e.target.value) || 1920 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400 space-y-1">
                  <span>{t('setup.projector.height')}</span>
                  <input
                    type="number"
                    value={projectorSize.h}
                    onChange={(e) => setProjectorSize({ ...projectorSize, h: parseInt(e.target.value) || 1080 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </label>
              </div>

              {backgroundUrl && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>{t('setup.photo.posX')}</span>
                    <input
                      type="number" className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white"
                      value={Math.round(backgroundTransform.x)}
                      onChange={e => setBackgroundTransform({...backgroundTransform, x: Number(e.target.value)})}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>{t('setup.photo.posY')}</span>
                    <input
                      type="number" className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white"
                      value={Math.round(backgroundTransform.y)}
                      onChange={e => setBackgroundTransform({...backgroundTransform, y: Number(e.target.value)})}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>{t('setup.photo.size')}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min="0.1" max="5" step="0.01"
                        className="w-24 accent-cyan-500"
                        value={backgroundTransform.k}
                        onChange={e => setBackgroundTransform({...backgroundTransform, k: Number(e.target.value)})}
                      />
                      <span className="w-8 text-right">{backgroundTransform.k.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><Keyboard size={16} /> {t('setup.keys.title')}</h3>
                <p className="text-xs text-slate-500">{t('setup.keys.hint')}</p>
                {SHORTCUTS.map((action) => (
                  <div key={action.id} className="flex justify-between items-center text-sm gap-2">
                    <span className="text-slate-300">{t(action.label)}</span>
                    <button
                      onClick={() => setRecordingAction(action.id)}
                      className={`min-w-[72px] px-2 py-1 rounded-md text-center font-mono border ${recordingAction === action.id ? 'bg-cyan-900 border-cyan-500 text-white animate-pulse' : 'bg-slate-800 border-slate-600 text-cyan-300 hover:border-cyan-500'}`}
                    >
                      {recordingAction === action.id ? t('setup.keys.press') : formatKey(keyMappings[action.id], t)}
                    </button>
                  </div>
                ))}
                <p className="text-xs text-slate-500">{t('setup.keys.numbers')}</p>
              </div>
            </div>
          </details>

          <button onClick={() => setMode(AppMode.MAPPING)} className="w-full py-3 rounded-xl bg-purple-500 hover:bg-purple-400 text-white font-bold flex items-center justify-center gap-2 transition-colors">
            {t('setup.next')} <ArrowRight size={18} />
          </button>
        </>
      )}

      {/* STEP 2: MAPPING */}
      {mode === AppMode.MAPPING && (
        <>
          <Hint color="bg-purple-500/15 text-purple-100">{t('map.hint')}</Hint>

          <section className="space-y-2">
            <div className="flex justify-between items-center">
              <SectionTitle icon={Layers}>{t('map.layers.title')}</SectionTitle>
              <button onClick={onAddLayer} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-sm font-semibold transition-colors">
                <Plus size={16} /> {t('map.layers.add')}
              </button>
            </div>

            {layers.length === 0 && <p className="text-sm text-slate-400">{t('map.layers.empty')}</p>}

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {layers.slice().reverse().map((layer) => {
                const isActive = activeLayerId === layer.id;
                return (
                  <div
                    key={layer.id}
                    onClick={() => onSelectLayer(layer.id)}
                    className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer border-2 transition-colors ${isActive ? 'border-purple-500 bg-purple-500/10' : 'border-slate-800 bg-slate-800/40 hover:border-slate-600'}`}
                  >
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { visible: !layer.visible }); }}
                      label={layer.visible ? t('map.layers.hide') : t('map.layers.show')}
                      className={layer.visible ? 'text-white' : 'text-slate-600'}
                    >
                      {layer.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                    </IconButton>
                    <span className={`flex-1 truncate font-medium ${layer.visible ? 'text-slate-100' : 'text-slate-500'}`}>{layer.name}</span>
                    {layer.locked && <Lock size={14} className="text-yellow-400" />}
                    <div className={`flex ${isActive ? 'opacity-100' : 'opacity-60'} text-slate-300`}>
                      <IconButton onClick={(e) => { e.stopPropagation(); onMoveLayer(layer.id, 'up'); }} label={t('map.layers.up')}><ChevronUp size={16} /></IconButton>
                      <IconButton onClick={(e) => { e.stopPropagation(); onMoveLayer(layer.id, 'down'); }} label={t('map.layers.down')}><ChevronDown size={16} /></IconButton>
                      <IconButton onClick={(e) => { e.stopPropagation(); onDuplicateLayer(layer.id); }} label={t('map.layers.copy')} className="hover:text-cyan-400"><Copy size={16} /></IconButton>
                      <IconButton onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }} label={t('map.layers.delete')} className="hover:text-red-400"><Trash2 size={16} /></IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {activeLayer && (
            <section className="bg-slate-800/40 p-4 rounded-xl border border-slate-700 space-y-4">
              <h3 className="text-base font-bold text-white">{t('map.selected.title')}</h3>

              <div className="grid grid-cols-2 gap-2">
                <label className="relative border-2 border-slate-700 bg-slate-900 rounded-xl p-3 flex flex-col items-center gap-1.5 text-center hover:border-purple-500 cursor-pointer transition-colors">
                  <input type="file" accept="image/*,video/*" className="sr-only" onChange={(e) => handleFileUpload(e, 'CONTENT')} />
                  <ImageIcon size={24} className="text-purple-400" />
                  <span className="text-xs font-medium text-slate-200">{t('map.selected.upload')}</span>
                </label>
                <button
                  onClick={() => onUpdateLayer(activeLayer.id, { source: { type: ContentType.SOLID_COLOR, url: '', name: 'Grid Pattern' }, playlist: null })}
                  className="border-2 border-slate-700 bg-slate-900 rounded-xl p-3 flex flex-col items-center gap-1.5 hover:border-emerald-500 transition-colors"
                >
                  <Square size={24} className="text-emerald-400" />
                  <span className="text-xs font-medium text-slate-200">{t('map.selected.grid')}</span>
                </button>
              </div>

              <button
                onClick={() => setLibraryOpen(true)}
                className="w-full border-2 border-slate-700 bg-slate-900 rounded-xl p-2.5 flex items-center justify-center gap-2 hover:border-orange-500 transition-colors"
              >
                <Film size={20} className="text-orange-400" />
                <span className="text-sm font-medium text-slate-200">🎃 {t('map.selected.library')}</span>
              </button>

              <p className="text-xs text-slate-400 truncate">{t('map.selected.current', { name: sourceLabel(activeLayer) })}</p>

              {activeLayer.playlist && activeLayer.playlist.items.length > 1 && (() => {
                const playlist = activeLayer.playlist;
                const step = (dir: 1 | -1) => {
                  const updates = playlistStep(activeLayer, dir);
                  if (updates) onUpdateLayer(activeLayer.id, updates);
                };
                const ended = !playlist.loop && !activeLayer.playback.isPlaying && playlist.index === playlist.items.length - 1;
                return (
                  <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-2.5 space-y-2">
                    <div className="flex items-center gap-1">
                      <span className="flex-1 text-xs font-semibold text-orange-200">
                        {ended ? t('map.playlist.stopped') : t('map.playlist.title', { n: playlist.index + 1, total: playlist.items.length })}
                      </span>
                      <IconButton onClick={() => step(-1)} label={t('map.playlist.prev')} className="text-slate-200"><SkipBack size={16} /></IconButton>
                      <IconButton onClick={() => step(1)} label={t('map.playlist.next')} className="text-slate-200"><SkipForward size={16} /></IconButton>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={playlist.loop}
                        onChange={(e) => onUpdateLayer(activeLayer.id, { playlist: { ...playlist, loop: e.target.checked } })}
                        className="accent-orange-500"
                      />
                      <Repeat size={14} /> {t('map.playlist.loop')}
                    </label>
                  </div>
                );
              })()}

              <label className="block space-y-1">
                <span className="text-xs text-slate-400">{t('map.selected.name')}</span>
                <input
                  type="text"
                  value={activeLayer.name}
                  onChange={(e) => onUpdateLayer(activeLayer.id, { name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="flex justify-between text-xs text-slate-400">
                  <span>{t('map.selected.opacity')}</span>
                  <span>{Math.round(activeLayer.opacity * 100)}%</span>
                </span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={activeLayer.opacity}
                  onChange={(e) => onUpdateLayer(activeLayer.id, { opacity: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </label>

              <button
                onClick={() => onUpdateLayer(activeLayer.id, { locked: !activeLayer.locked })}
                aria-pressed={activeLayer.locked}
                className={`w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  activeLayer.locked ? 'bg-yellow-500 text-slate-900' : 'bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {activeLayer.locked ? <><Unlock size={16} /> {t('map.selected.unlock')}</> : <><Lock size={16} /> {t('map.selected.lock')}</>}
              </button>

              <details className="group rounded-lg border border-slate-700">
                <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white">
                  <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                  <Sparkles size={14} className="text-yellow-400" /> {t('map.ai.title')}
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  <input
                    type="text"
                    value={texturePrompt}
                    onChange={(e) => setTexturePrompt(e.target.value)}
                    placeholder={t('map.ai.placeholder')}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
                  />
                  <button
                    onClick={handleGenerateTexture}
                    disabled={isGenerating || !texturePrompt}
                    className="w-full py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900 rounded-lg text-sm font-semibold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Sparkles size={14} /> {isGenerating ? t('map.ai.generating') : t('map.ai.generate')}
                  </button>
                </div>
              </details>
            </section>
          )}

          <ul className="space-y-1.5 text-xs text-slate-400">
            {(['map.tip.drag', 'map.tip.move', 'map.tip.add', 'map.tip.remove', 'map.tip.zoom'] as TranslationKey[]).map(k => (
              <li key={k} className="flex items-center gap-2"><MousePointer2 size={12} className="shrink-0 text-purple-400" /> {t(k)}</li>
            ))}
          </ul>

          <button onClick={() => setMode(AppMode.LIVE)} className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold flex items-center justify-center gap-2 transition-colors">
            {t('map.next')} <Play size={18} />
          </button>
        </>
      )}

      {/* STEP 3: LIVE (panel only shows if the user brings controls back) */}
      {mode === AppMode.LIVE && (
        <>
          <Hint color="bg-emerald-500/15 text-emerald-100">{t('live.hint')}</Hint>
          <p className="text-sm text-slate-400">{t('live.keysHint', {
            prev: formatKey(keyMappings.PREV_LAYER, t),
            next: formatKey(keyMappings.NEXT_LAYER, t),
            blackout: formatKey(keyMappings.BLACKOUT, t),
            ui: formatKey(keyMappings.TOGGLE_UI, t),
          })}</p>
          <button onClick={onOpenLive} className="w-full py-3 rounded-xl bg-slate-800 border border-slate-600 text-white font-semibold hover:bg-slate-700 flex items-center justify-center gap-2">
            <ExternalLink size={18} /> {t('setup.projector.open')}
          </button>

          <section className="space-y-3">
            <SectionTitle icon={Power}>{t('show.title')}</SectionTitle>
            <p className="text-xs text-slate-400">{t('show.hint')}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onExport} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors">
                <Download size={16} /> {t('show.export')}
              </button>
              <label className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors cursor-pointer">
                <input
                  type="file" accept=".lumamap" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }}
                />
                <Upload size={16} /> {t('show.import')}
              </label>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-slate-400 flex items-center gap-1.5"><Link size={12} /> {t('show.link')}</span>
              <input
                readOnly value={showLink} onFocus={(e) => e.target.select()}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-cyan-300"
              />
            </div>
          </section>
        </>
      )}
      </div>
    </div>
  );
};

export default ControlPanel;
