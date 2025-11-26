import React, { useState } from 'react';
import { AppMode, ProjectionSource, ContentType } from '../types';
import { generateTexture } from '../services/gemini';
import { Upload, Monitor, Square, Layers, Sparkles, Move, Maximize, Image as ImageIcon, Save, FolderOpen, ExternalLink } from 'lucide-react';

interface ControlPanelProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  setSource: (source: ProjectionSource) => void;
  toggleFullscreen: () => void;
  backgroundUrl: string | null;
  onUploadBackground: (file: File) => void;
  opacity: number;
  setOpacity: (val: number) => void;
  onSave: () => void;
  onLoad: () => void;
  onOpenLive: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  mode,
  setMode,
  setSource,
  toggleFullscreen,
  backgroundUrl,
  onUploadBackground,
  opacity,
  setOpacity,
  onSave,
  onLoad,
  onOpenLive
}) => {
  const [texturePrompt, setTexturePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'BACKGROUND' | 'CONTENT') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'BACKGROUND') {
      onUploadBackground(file);
    } else {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video');
      setSource({
        type: isVideo ? ContentType.VIDEO : ContentType.IMAGE,
        url,
        name: file.name,
        file: file // Store the file for syncing
      });
    }
  };

  const handleGenerateTexture = async () => {
    if (!texturePrompt) return;
    setIsGenerating(true);
    try {
      const base64Image = await generateTexture(texturePrompt);
      setSource({
        type: ContentType.IMAGE,
        url: base64Image,
        name: `AI: ${texturePrompt}`
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

      {/* Live Window Trigger */}
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
            <Monitor size={16} /> Surface Setup
          </h2>
          <p className="text-xs text-slate-400">
            Upload a photo of your projection surface (wall/object) to use as a reference guide.
          </p>
          
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
             <button onClick={toggleFullscreen} className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-cyan-400 font-medium">
                Enter Fullscreen Projection
             </button>
          )}
        </div>
      )}

      {/* Mapping Section */}
      {mode === AppMode.MAPPING && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Layers size={16} /> Projection Source
          </h2>

          <div className="bg-cyan-900/30 border border-cyan-800 p-3 rounded text-xs text-cyan-200">
             <strong>Advanced Warping:</strong><br/>
             • Double-click to add point<br/>
             • Right-click point to remove<br/>
             • Drag points to warp
          </div>

          {/* Opacity Slider */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Mapping Opacity</label>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.05" 
              value={opacity} 
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Content Uploader */}
           <div className="grid grid-cols-2 gap-2">
              <div className="relative border border-slate-700 bg-slate-800 rounded p-3 flex flex-col items-center hover:bg-slate-700 cursor-pointer">
                 <input type="file" accept="image/*,video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'CONTENT')} />
                 <ImageIcon size={20} className="mb-1 text-purple-400" />
                 <span className="text-xs">Media</span>
              </div>
              <button 
                onClick={() => setSource({ type: ContentType.SOLID_COLOR, url: '', name: 'Grid Pattern' })}
                className="border border-slate-700 bg-slate-800 rounded p-3 flex flex-col items-center hover:bg-slate-700"
              >
                 <Square size={20} className="mb-1 text-green-400" />
                 <span className="text-xs">Grid</span>
              </button>
           </div>

           {/* Gemini GenAI Section */}
           <div className="pt-2 border-t border-slate-800">
             <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-yellow-400" />
                <span className="text-xs font-semibold text-yellow-400">AI Texture Gen</span>
             </div>
             <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={texturePrompt}
                  onChange={(e) => setTexturePrompt(e.target.value)}
                  placeholder="e.g. Neon cyber circuit..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-yellow-500"
                />
             </div>
             <button 
                onClick={handleGenerateTexture}
                disabled={isGenerating || !texturePrompt}
                className="w-full py-2 bg-gradient-to-r from-yellow-600 to-orange-600 rounded text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
             >
                {isGenerating ? 'Dreaming...' : 'Generate Texture'}
             </button>
           </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-auto border-t border-slate-800 pt-4 text-xs text-slate-500">
        <p className="font-semibold mb-1">Quick Guide:</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Start in <strong>Setup</strong> to upload a photo of the target object.</li>
          <li>Switch to <strong>Map</strong> to drag the 4 corners to align projection.</li>
          <li>Use <strong>AI Texture</strong> to create custom mapping skins.</li>
          <li>Go <strong>Live</strong> and maximize window on projector.</li>
        </ul>
      </div>
    </div>
  );
};

export default ControlPanel;