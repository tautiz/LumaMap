import { GridSettings, KeyMap, Layer, ProjectionSource, Transform } from '../types';

// A project with its media files kept as Blobs, so nothing has to be uploaded again after opening.
export interface SavedProject {
  layers: Layer[];
  backgroundFile: Blob | null;
  backgroundTransform: Transform;
  showBackgroundInLive: boolean;
  projectorSize: { w: number; h: number };
  keyMappings?: KeyMap;
  gridDefaults?: GridSettings;
}

const DB_NAME = 'lumamap';
const STORE = 'projects';
export const LIBRARY_STORE = 'library';
const CURRENT_KEY = 'current';
const LEGACY_KEY = 'lumaMapProject';

// --- Browser storage (IndexedDB holds Blobs; localStorage could not) ---

// Version 2 added the media library store (services/mediaLibrary.ts).
export const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Blob URLs die with the page; the file itself is kept and a new URL is made on load.
const stripUrl = (source: ProjectionSource): ProjectionSource =>
  ({ ...source, url: source.url.startsWith('blob:') ? '' : source.url });

const strip = (project: SavedProject): SavedProject => ({
  ...project,
  layers: project.layers.map(l => ({
    ...l,
    transitionOpacity: 1,
    source: l.source ? stripUrl(l.source) : null,
    playlist: l.playlist ? { ...l.playlist, items: l.playlist.items.map(stripUrl) } : l.playlist,
  })),
});

export const saveToBrowser = async (project: SavedProject): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(strip(project), CURRENT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

export const loadFromBrowser = async (): Promise<SavedProject | null> => {
  const db = await openDb();
  const stored = await new Promise<SavedProject | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(CURRENT_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (stored) return withUrls(stored);

  // Projects saved before media was kept: settings only.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;
  const data = JSON.parse(legacy);
  return {
    layers: data.layers || [],
    backgroundFile: null,
    backgroundTransform: data.backgroundTransform || { x: 0, y: 0, k: 1 },
    showBackgroundInLive: false,
    projectorSize: data.projectorSize || { w: 2363, h: 1320 },
    keyMappings: data.keyMappings,
  };
};

const withUrls = (project: SavedProject): SavedProject => {
  // One URL per file: a playlist's current video is the same file as the layer's source.
  const urls = new Map<Blob, string>();
  const withUrl = (source: ProjectionSource): ProjectionSource => {
    if (!source.file) return source;
    let url = urls.get(source.file);
    if (!url) {
      url = URL.createObjectURL(source.file);
      urls.set(source.file, url);
    }
    return { ...source, url };
  };
  return {
    ...project,
    layers: project.layers.map(l => ({
      ...l,
      source: l.source ? withUrl(l.source) : l.source,
      playlist: l.playlist ? { ...l.playlist, items: l.playlist.items.map(withUrl) } : l.playlist,
    })),
  };
};

// --- Show file (.lumamap): settings and media in one file, to move a show between devices ---
//
// Layout: "LUMAMAP1" | uint32 LE header length | header JSON (UTF-8) | media bytes back to back.

const MAGIC = 'LUMAMAP1';

interface FileEntry { name: string; type: string; size: number }

export const exportShowFile = (project: SavedProject): Blob => {
  const files: FileEntry[] = [];
  const blobs: Blob[] = [];
  const indexOf = new Map<Blob, number>();
  const addFile = (blob: Blob, name: string) => {
    const known = indexOf.get(blob);
    if (known !== undefined) return known;
    files.push({ name, type: blob.type, size: blob.size });
    blobs.push(blob);
    indexOf.set(blob, files.length - 1);
    return files.length - 1;
  };
  const pack = (s: ProjectionSource) => {
    if (!s.file) return s;
    const { file, ...source } = s;
    return { ...source, fileIndex: addFile(file, source.name) };
  };

  const layers = strip(project).layers.map(l => ({
    ...l,
    source: l.source ? pack(l.source) : l.source,
    playlist: l.playlist ? { ...l.playlist, items: l.playlist.items.map(pack) } : l.playlist,
  }));
  const background = project.backgroundFile ? addFile(project.backgroundFile, 'background') : null;

  const header = new TextEncoder().encode(JSON.stringify({
    version: 3,
    layers,
    background,
    backgroundTransform: project.backgroundTransform,
    showBackgroundInLive: project.showBackgroundInLive,
    projectorSize: project.projectorSize,
    keyMappings: project.keyMappings,
    gridDefaults: project.gridDefaults,
    files,
  }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length, true);
  return new Blob([MAGIC, length, header, ...blobs], { type: 'application/octet-stream' });
};

export const parseShowFile = (buffer: ArrayBuffer): SavedProject => {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new Error('Not a LumaMap show file');
  }
  const headerLength = new DataView(buffer).getUint32(8, true);
  const data = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));

  let offset = 12 + headerLength;
  const files: File[] = (data.files as FileEntry[]).map(entry => {
    const file = new File([bytes.subarray(offset, offset + entry.size)], entry.name, { type: entry.type });
    offset += entry.size;
    return file;
  });

  const unpack = (s: any) => {
    if (s?.fileIndex === undefined) return s;
    const { fileIndex, ...source } = s;
    return { ...source, file: files[fileIndex] };
  };
  const layers: Layer[] = data.layers.map((l: any) => ({
    ...l,
    source: unpack(l.source),
    playlist: l.playlist ? { ...l.playlist, items: l.playlist.items.map(unpack) } : l.playlist,
  }));

  return withUrls({
    layers,
    backgroundFile: data.background !== null ? files[data.background] : null,
    backgroundTransform: data.backgroundTransform,
    showBackgroundInLive: !!data.showBackgroundInLive,
    projectorSize: data.projectorSize,
    keyMappings: data.keyMappings,
    gridDefaults: data.gridDefaults,
  });
};

// Relative paths resolve against the app, so a show file placed next to the app can be named by file name.
export const fetchShowFile = async (url: string): Promise<SavedProject> => {
  const res = await fetch(new URL(url, window.location.href).toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseShowFile(await res.arrayBuffer());
};
