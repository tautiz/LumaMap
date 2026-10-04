import { ContentType, Layer, Playlist, ProjectionSource } from '../types';
import { LIBRARY_STORE, openDb } from './projectStore';

// The media library: videos to pick from without looking for files every time. Two places feed it:
//
// - This browser (IndexedDB). Videos added with "Add videos" stay in the browser that added them and
//   work without internet, on the GitHub Pages site as well as on a copy served from the Raspberry Pi.
// - A media folder next to the app: media/library.json lists files in media/<category>/. It is
//   written by scripts/download-media.sh (or scripts/build-media-library.py for your own files) and
//   works wherever the app is served together with that folder (npm run dev, a local copy, or the
//   site itself if the videos are committed).

export interface LibraryItem {
  id: string;
  category: string;
  title: string;
  origin: 'browser' | 'folder';
  duration?: number; // seconds
  size?: number; // bytes
  url?: string; // folder items
  file?: File; // browser items
}

interface StoredItem {
  id: string;
  category: string;
  title: string;
  file: File;
  duration?: number;
  addedAt: number;
}

export const DEFAULT_CATEGORY = 'halloween';

// --- This browser ---

const listBrowserItems = async (): Promise<LibraryItem[]> => {
  const db = await openDb();
  const stored = await new Promise<StoredItem[]>((resolve, reject) => {
    const req = db.transaction(LIBRARY_STORE, 'readonly').objectStore(LIBRARY_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return stored
    .sort((a, b) => a.addedAt - b.addedAt)
    .map(s => ({
      id: s.id,
      category: s.category,
      title: s.title,
      origin: 'browser' as const,
      duration: s.duration,
      size: s.file.size,
      file: s.file,
    }));
};

// Reads the length of a video file, or undefined if the browser cannot open it within a few seconds.
const probeDuration = (file: Blob): Promise<number | undefined> =>
  new Promise(resolve => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (d?: number) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(d !== undefined && Number.isFinite(d) ? d : undefined);
    };
    const timer = window.setTimeout(() => done(), 5000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done();
    video.src = url;
  });

const titleOf = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName;

export const addToBrowserLibrary = async (files: File[], category: string): Promise<void> => {
  // Ask the browser not to clear these files when the disk gets full (granted silently in Chromium
  // for sites used often or installed; harmless when refused).
  navigator.storage?.persist?.().catch(() => {});

  const now = Date.now();
  const items: StoredItem[] = [];
  for (const [i, file] of files.entries()) {
    items.push({
      id: `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      title: titleOf(file.name),
      file,
      duration: await probeDuration(file),
      addedAt: now + i,
    });
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    const store = tx.objectStore(LIBRARY_STORE);
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

export const removeFromBrowserLibrary = async (id: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

// --- Media folder next to the app ---

const mediaBase = () => new URL(`${import.meta.env.BASE_URL}media/`, window.location.href);

interface Manifest {
  items?: { category?: string; title?: string; file: string; duration?: number; size?: number }[];
}

const listFolderItems = async (): Promise<LibraryItem[]> => {
  const base = mediaBase();
  let manifest: Manifest;
  try {
    const res = await fetch(new URL('library.json', base), { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = await res.json();
  } catch {
    return []; // No media folder here (e.g. the public site), or offline
  }
  return (manifest.items ?? [])
    .filter(item => typeof item.file === 'string')
    .map(item => ({
      id: `folder:${item.file}`,
      category: item.category || item.file.split('/')[0] || DEFAULT_CATEGORY,
      title: item.title || titleOf(item.file.split('/').pop() || item.file),
      origin: 'folder' as const,
      duration: item.duration,
      size: item.size,
      url: new URL(item.file, base).toString(),
    }));
};

export const loadLibrary = async (): Promise<LibraryItem[]> => {
  const [folder, browser] = await Promise.all([
    listFolderItems(),
    listBrowserItems().catch(e => {
      console.error('Media library load failed', e);
      return [];
    }),
  ]);
  return [...folder, ...browser];
};

// --- Using library videos on a layer ---

// Folder videos are downloaded into memory, so the show can be saved with them and keeps working offline.
export const toSource = async (item: LibraryItem): Promise<ProjectionSource> => {
  let file = item.file;
  if (!file) {
    const res = await fetch(item.url!);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    file = new File([blob], item.title, { type: blob.type || 'video/mp4' });
  }
  return { type: ContentType.VIDEO, url: URL.createObjectURL(file), name: item.title, file };
};

// Layer changes that put these videos on a layer: one video loops; several play one after another.
export const playVideos = (layer: Layer, sources: ProjectionSource[], loop: boolean): Partial<Layer> => ({
  source: sources[0],
  playlist: sources.length > 1 ? { items: sources, index: 0, loop } : null,
  playback: { ...layer.playback, isPlaying: true, currentTime: 0, seekAt: Date.now(), duration: 0 },
});

// Layer changes for the next (step 1) or previous (step -1) playlist video, or null if there is no playlist.
// `auto` is set when a video just ended: without looping, the playlist then stops on its last video.
export const playlistStep = (layer: Layer, step: 1 | -1, auto = false): Partial<Layer> | null => {
  const playlist = layer.playlist;
  if (!playlist || playlist.items.length === 0) return null;
  const n = playlist.items.length;
  let index = playlist.index + step;
  if (index >= n) {
    if (auto && !playlist.loop) return { playback: { ...layer.playback, isPlaying: false } };
    index = 0;
  } else if (index < 0) {
    index = n - 1;
  }
  return {
    source: playlist.items[index],
    playlist: { ...playlist, index } as Playlist,
    playback: { ...layer.playback, isPlaying: true, currentTime: 0, seekAt: Date.now(), duration: 0 },
  };
};

// A video element loops by itself unless a playlist of several videos decides what comes next.
export const videoLoops = (layer: Layer) =>
  !layer.playlist || (layer.playlist.items.length === 1 && layer.playlist.loop);

export const formatDuration = (seconds?: number) => {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
