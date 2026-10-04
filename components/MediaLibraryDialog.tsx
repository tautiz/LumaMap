import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Film, Plus, Trash2, Play, ListVideo, Repeat, HardDrive, Folder } from 'lucide-react';
import { ProjectionSource } from '../types';
import { useI18n } from '../i18n';
import {
  DEFAULT_CATEGORY, LibraryItem, addToBrowserLibrary, formatDuration, loadLibrary, removeFromBrowserLibrary, toSource,
} from '../services/mediaLibrary';

interface MediaLibraryDialogProps {
  onClose: () => void;
  // One video, or several to play one after another.
  onPick: (sources: ProjectionSource[], loop: boolean) => void;
}

const MediaLibraryDialog: React.FC<MediaLibraryDialogProps> = ({ onClose, onPick }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [selected, setSelected] = useState<string[]>([]); // In the order picked: that is the playlist order
  const [loop, setLoop] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => loadLibrary().then(setItems), []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const categories = useMemo(() => {
    const ids = new Set([DEFAULT_CATEGORY, ...(items ?? []).map(i => i.category)]);
    return [...ids];
  }, [items]);
  const categoryLabel = (id: string) =>
    id === 'halloween' ? t('library.cat.halloween') : id === 'other' ? t('library.cat.other') : id.charAt(0).toUpperCase() + id.slice(1);

  const shown = (items ?? []).filter(i => i.category === category);
  const byId = new Map((items ?? []).map(i => [i.id, i]));

  const switchCategory = (id: string) => {
    setCategory(id);
    setSelected([]);
  };

  const toggle = (id: string) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('video') || /\.(mp4|webm|m4v|mov)$/i.test(f.name));
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(t('library.adding'));
    try {
      await addToBrowserLibrary(files, category);
      await refresh();
    } catch (err) {
      console.error('Adding to the library failed', err);
      alert(t('library.addFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!confirm(t('library.deleteConfirm', { name: item.title }))) return;
    await removeFromBrowserLibrary(item.id);
    setSelected(prev => prev.filter(x => x !== item.id));
    await refresh();
  };

  const handlePlay = async (ids: string[]) => {
    const chosen = ids.map(id => byId.get(id)).filter((i): i is LibraryItem => !!i);
    if (chosen.length === 0) return;
    try {
      const sources: ProjectionSource[] = [];
      for (const [n, item] of chosen.entries()) {
        setBusy(t('library.preparing', { n: n + 1, total: chosen.length }));
        sources.push(await toSource(item));
      }
      onPick(sources, loop);
      onClose();
    } catch (err) {
      console.error('Opening library video failed', err);
      alert(t('library.failed'));
    } finally {
      setBusy(null);
    }
  };

  const allSelected = shown.length > 0 && shown.every(i => selected.includes(i.id));

  // Rendered into <body>: the control panel's backdrop blur would otherwise trap this full-screen overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 id="library-title" className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Film className="text-orange-400" /> {t('library.title')}
          </h2>
          <button onClick={onClose} disabled={!!busy} aria-label={t('common.close')} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40">
            <X size={22} />
          </button>
        </div>

        <div className="px-6 flex gap-2 flex-wrap">
          {categories.map(id => (
            <button
              key={id}
              onClick={() => switchCategory(id)}
              aria-pressed={category === id}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${category === id ? 'bg-orange-500 text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {id === 'halloween' && '🎃 '}{categoryLabel(id)}
            </button>
          ))}
        </div>

        <div className="px-6 pt-4 pb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">{t('library.selectHint')}</p>
          {shown.length > 1 && (
            <button
              onClick={() => setSelected(allSelected ? [] : shown.map(i => i.id))}
              className="shrink-0 text-xs font-semibold text-orange-300 hover:text-orange-200"
            >
              {allSelected ? t('library.selectNone') : t('library.selectAll')}
            </button>
          )}
        </div>

        <div className="px-6 overflow-y-auto flex-1 min-h-[8rem] space-y-1.5">
          {items === null && <p className="text-slate-400 py-6 text-center">{t('library.loading')}</p>}
          {items !== null && shown.length === 0 && <p className="text-slate-300 py-6 text-center leading-relaxed">{t('library.empty')}</p>}
          {shown.map(item => {
            const order = selected.indexOf(item.id);
            const isSelected = order !== -1;
            return (
              <div
                key={item.id}
                onClick={() => toggle(item.id)}
                className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer border-2 transition-colors ${isSelected ? 'border-orange-500 bg-orange-500/10' : 'border-slate-800 bg-slate-800/40 hover:border-slate-600'}`}
              >
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${isSelected ? 'bg-orange-500 text-slate-900' : 'bg-slate-700 text-slate-400'}`}>
                  {isSelected ? order + 1 : ''}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-slate-100 font-medium">{item.title}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    {formatDuration(item.duration)}
                    <span className="flex items-center gap-1">
                      {item.origin === 'browser' ? <HardDrive size={12} /> : <Folder size={12} />}
                      {item.origin === 'browser' ? t('library.onDevice') : t('library.inFolder')}
                    </span>
                  </span>
                </span>
                <button
                  onClick={e => { e.stopPropagation(); handlePlay([item.id]); }}
                  disabled={!!busy}
                  title={t('library.playOne')}
                  aria-label={t('library.playOne')}
                  className="p-2 rounded-md text-emerald-400 hover:bg-slate-700 disabled:opacity-40"
                >
                  <Play size={18} />
                </button>
                {item.origin === 'browser' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(item); }}
                    disabled={!!busy}
                    title={t('library.delete')}
                    aria-label={t('library.delete')}
                    className="p-2 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-700 disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 space-y-3">
          <label className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-600 text-slate-200 text-sm font-semibold transition-colors ${busy ? 'opacity-40' : 'hover:border-orange-400 cursor-pointer'}`}>
            <input type="file" accept="video/*,.mp4,.webm,.m4v,.mov" multiple className="sr-only" disabled={!!busy} onChange={handleAdd} />
            <Plus size={18} /> {t('library.add')}
          </label>
          <p className="text-xs text-slate-500 text-center">{t('library.addHint')}</p>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} className="w-4 h-4 accent-orange-500" />
              <Repeat size={16} /> {t('library.loop')}
            </label>
            <button
              onClick={() => handlePlay(selected)}
              disabled={selected.length === 0 || !!busy}
              className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-900 font-bold disabled:opacity-40 disabled:hover:bg-orange-500 transition-colors"
            >
              {busy ?? (
                <>
                  {selected.length > 1 ? <ListVideo size={18} /> : <Play size={18} />}
                  {selected.length > 1 ? t('library.playMany', { n: selected.length }) : t('library.playOne')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MediaLibraryDialog;
