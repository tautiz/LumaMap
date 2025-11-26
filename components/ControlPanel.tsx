
import React, { useState } from 'react';
import { AppMode, ProjectionSource, ContentType, Layer, Transform } from '../types';
import { generateTexture } from '../services/gemini';
import { Upload, Monitor, Square, Layers, Sparkles, Move, Maximize, Image as ImageIcon, Save, FolderOpen, ExternalLink, Eye, EyeOff, Move3d, Plus, Trash2, ChevronUp, ChevronDown, Lock, Unlock } from 'lucide-react';

interface ControlPanelProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  
  // Layer Management
  layers: Layer[];
  activeLayerId: string | null;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onMoveLayer: (id: string, dir: 'up' | 'down') => void;

  toggleFullscreen: () => void;
  backgroundUrl: string | null;
  onUploadBackground: (file: File) => void;

  onSave: () => void;
  onLoad: () => void;
  onOpenLive: () => void;

  showBackgroundInLive: boolean;
  setShowBackgroundInLive: (val: boolean) => void;
  isEditingBackground: boolean;
  setIsEditingBackground: (val: boolean) => void;

  backgroundTransform: Transform;
  setBackgroundTransform: (t: Transform) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  mode,
  setMode,
  layers,
  activeLayerId,
  onAddLayer,
  onRemoveLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  toggleFullscreen,
  backgroundUrl,
  onUploadBackground,
  onSave,
  onLoad,
  onOpenLive,
  showBackgroundInLive,
  setShowBackgroundInLive,
  isEditingBackground,
  setIsEditingBackground,
  backgroundTransform,
  setBackgroundTransform
}) => {
  const [texturePrompt, setTexturePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const activeLayer = layers.find(l => l.id === activeLayerId);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'BACKGROUND' | 'CONTENT') => {
    const file = e.target.files?.[0];
    if (!file) return;

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
          }
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
      alert("Failed to generate texture. Check console.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="absolute top-0 left-0 h-full w-80 bg-slate-900/95 backdrop-blur-md border-r border-slate-700 p-6 flex flex-col gap-6 shadow-2xl z-50 overflow-y-auto transition-transform">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent mb-1">
            LumaMap
          </h1>
          <p className="text-xs text-slate-400">Projection Mapping Suite</p>
        </div>
        <div className="flex gap-1">
          <button onClick={onSave} className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors" title="Save Project">
            <Save size={16} />
          </button>
          <button onClick={onLoad} className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors" title="Load Project">
            <FolderOpen size={16} />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex bg-slate-800 p-1 rounded-lg">
        <button
          onClick={() => setMode(AppMode.SETUP)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${mode === AppMode.SETUP ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
        >
          <Monitor size={14} /> Setup
        </button>
        <button
          onClick={() => setMode(AppMode.MAPPING)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${mode === AppMode.MAPPING ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
        >
          <Move size={14} /> Map
        </button>
        <button
          onClick={() => setMode(AppMode.LIVE)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md transition-colors ${mode === AppMode.LIVE ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
        >
          <Maximize size={14} /> Live
        </button>
      </div>

      <button 
        onClick={onOpenLive}
        className="w-full py-2 border border-slate-600 rounded text-slate-300 hover:bg-slate-800 flex items-center justify-center gap-2 text-sm"
      >
        <ExternalLink size={14} /> Open Projector Window
      </button>

      {/* Setup Section */}
      {mode === AppMode.SETUP && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Monitor size={16} /> Reference Setup
          </h2>
          
          <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:border-cyan-500 hover:bg-slate-800/50 transition-colors cursor-pointer relative">
            <input 
              type="file" 
              accept="image/*" 
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => handleFileUpload(e, 'BACKGROUND')}
            />
            <Upload className="text-slate-500 mb-2" size={24} />
            <span className="text-sm text-slate-400">Upload Surface Photo</span>
          </div>

          {backgroundUrl && (
             <div className="space-y-3 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Position X</span>
                    <input 
                        type="number" className="w-16 bg-slate-900 border border-slate-700 rounded px-1"
                        value={Math.round(backgroundTransform.x)}
                        onChange={e => setBackgroundTransform({...backgroundTransform, x: Number(e.target.value)})}
                    />
                </div>
                <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Position Y</span>
                    <input 
                        type="number" className="w-16 bg-slate-900 border border-slate-700 rounded px-1"
                        value={Math.round(backgroundTransform.y)}
                        onChange={e => setBackgroundTransform({...backgroundTransform, y: Number(e.target.value)})}
                    />
                </div>
                <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Scale</span>
                    <div className="flex items-center gap-2">
                         <input 
                            type="range" min="0.1" max="5" step="0.01" 
                            className="w-20"
                            value={backgroundTransform.k}
                            onChange={e => setBackgroundTransform({...backgroundTransform, k: Number(e.target.value)})}
                        />
                        <span className="w-8 text-right">{backgroundTransform.k.toFixed(2)}</span>
                    </div>
                </div>

                <div className="h-px bg-slate-700 my-2"></div>

                <button
                    onClick={() => setIsEditingBackground(!isEditingBackground)}
                    className={`w-full py-2 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                        isEditingBackground ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Move3d size={14} />
                    {isEditingBackground ? 'Stop Visual Adjust' : 'Visually Adjust'}
                </button>
             </div>
          )}

          {backgroundUrl && (
             <div className="flex gap-2">
                 <button
                    onClick={() => setShowBackgroundInLive(!showBackgroundInLive)}
                    className={`flex-1 py-2 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                        showBackgroundInLive ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    {showBackgroundInLive ? <Eye size={14} /> : <EyeOff size={14} />}
                    {showBackgroundInLive ? 'Live: Visible' : 'Live: Hidden'}
                </button>
                 <button onClick={toggleFullscreen} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-cyan-400 font-medium">
                    Fullscreen
                 </button>
             </div>
          )}
        </div>
      )}

      {/* Mapping Section - Layers */}
      {mode === AppMode.MAPPING && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <div className="flex justify-between items-center">
             <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Layers size={16} /> Scene Layers
             </h2>
             <button onClick={onAddLayer} className="p-1 text-cyan-400 hover:bg-slate-800 rounded">
                 <Plus size={16} />
             </button>
          </div>

          {/* Layer List */}
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
             {layers.slice().reverse().map((layer) => (
                 <div 
                    key={layer.id}
                    onClick={() => onSelectLayer(layer.id)}
                    className={`flex items-center gap-2 p-2 rounded text-xs cursor-pointer border ${activeLayerId === layer.id ? 'border-cyan-500 bg-cyan-900/20' : 'border-transparent hover:bg-slate-800'}`}
                 >
                     <button 
                        onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { visible: !layer.visible }); }}
                        className={layer.visible ? 'text-slate-300' : 'text-slate-600'}
                     >
                         {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                     </button>
                     <span className="flex-1 truncate font-medium text-slate-200">{layer.name}</span>
                     
                     <div className="flex gap-1 opacity-50 hover:opacity-100">
                        <button onClick={(e) => { e.stopPropagation(); onMoveLayer(layer.id, 'up'); }}><ChevronUp size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); onMoveLayer(layer.id, 'down'); }}><ChevronDown size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }} className="hover:text-red-400"><Trash2 size={12} /></button>
                     </div>
                 </div>
             ))}
          </div>

          {activeLayer && (
            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 space-y-3">
               <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-cyan-400">Selected Layer Properties</span>
                  <button onClick={() => onUpdateLayer(activeLayer.id, { locked: !activeLayer.locked })} className="text-slate-400 hover:text-white">
                      {activeLayer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
               </div>
               
               {/* Name Edit */}
               <input 
                  type="text" 
                  value={activeLayer.name} 
                  onChange={(e) => onUpdateLayer(activeLayer.id, { name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 mb-2"
               />

               {/* Opacity */}
               <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Opacity</label>
                    <input 
                    type="range" min="0" max="1" step="0.05" 
                    value={activeLayer.opacity} 
                    onChange={(e) => onUpdateLayer(activeLayer.id, { opacity: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-slate-700 rounded appearance-none"
                    />
               </div>

                {/* Content Uploader */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="relative border border-slate-700 bg-slate-900 rounded p-2 flex flex-col items-center hover:bg-slate-700 cursor-pointer">
                        <input type="file" accept="image/*,video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'CONTENT')} />
                        <ImageIcon size={16} className="mb-1 text-purple-400" />
                        <span className="text-[10px]">Upload Media</span>
                    </div>
                    <button 
                        onClick={() => onUpdateLayer(activeLayer.id, { source: { type: ContentType.SOLID_COLOR, url: '', name: 'Grid Pattern' } })}
                        className="border border-slate-700 bg-slate-900 rounded p-2 flex flex-col items-center hover:bg-slate-700"
                    >
                        <Square size={16} className="mb-1 text-green-400" />
                        <span className="text-[10px]">Reset to Grid</span>
                    </button>
                </div>

                {/* Gemini */}
                <div className="pt-2 border-t border-slate-700">
                    <div className="flex gap-2 mb-2">
                        <input 
                        type="text" 
                        value={texturePrompt}
                        onChange={(e) => setTexturePrompt(e.target.value)}
                        placeholder="AI Texture Prompt..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none"
                        />
                    </div>
                    <button 
                        onClick={handleGenerateTexture}
                        disabled={isGenerating || !texturePrompt}
                        className="w-full py-1.5 bg-gradient-to-r from-yellow-600 to-orange-600 rounded text-xs font-medium hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isGenerating ? 'Generating...' : 'Generate AI Texture'}
                    </button>
                </div>

                <div className="text-[10px] text-slate-500 pt-1">
                   {activeLayer.source ? `Source: ${activeLayer.source.name}` : 'No source selected'}
                </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default ControlPanel;
