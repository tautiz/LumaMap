import { KeyMap, Layer, Transform } from '../types';

// A project with its media files kept as Blobs, so nothing has to be uploaded again after opening.
export interface SavedProject {
  layers: Layer[];
  backgroundFile: Blob | null;
  backgroundTransform: Transform;
  showBackgroundInLive: boolean;
  projectorSize: { w: number; h: number };
  keyMappings?: KeyMap;
}

const DB_NAME = 'lumamap';
const STORE = 'projects';
const CURRENT_KEY = 'current';
const LEGACY_KEY = 'lumaMapProject';

// --- Browser storage (IndexedDB holds Blobs; localStorage could not) ---

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const strip = (project: SavedProject): SavedProject => ({
  ...project,
  // Blob URLs die with the page; the file itself is kept and a new URL is made on load.
  layers: project.layers.map(l => ({
    ...l,
    transitionOpacity: 1,
    source: l.source
      ? { ...l.source, url: l.source.url.startsWith('blob:') ? '' : l.source.url }
      : null,
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

const withUrls = (project: SavedProject): SavedProject => ({
  ...project,
  layers: project.layers.map(l =>
    l.source?.file ? { ...l, source: { ...l.source, url: URL.createObjectURL(l.source.file) } } : l
  ),
});

// --- Show file (.lumamap): settings and media in one file, to move a show between devices ---
//
// Layout: "LUMAMAP1" | uint32 LE header length | header JSON (UTF-8) | media bytes back to back.

const MAGIC = 'LUMAMAP1';

interface FileEntry { name: string; type: string; size: number }

export const exportShowFile = (project: SavedProject): Blob => {
  const files: FileEntry[] = [];
  const blobs: Blob[] = [];
  const addFile = (blob: Blob, name: string) => {
    files.push({ name, type: blob.type, size: blob.size });
    blobs.push(blob);
    return files.length - 1;
  };

  const layers = strip(project).layers.map(l => {
    if (!l.source?.file) return l;
    const { file, ...source } = l.source;
    return { ...l, source: { ...source, fileIndex: addFile(file, source.name) } };
  });
  const background = project.backgroundFile ? addFile(project.backgroundFile, 'background') : null;

  const header = new TextEncoder().encode(JSON.stringify({
    version: 3,
    layers,
    background,
    backgroundTransform: project.backgroundTransform,
    showBackgroundInLive: project.showBackgroundInLive,
    projectorSize: project.projectorSize,
    keyMappings: project.keyMappings,
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

  const layers: Layer[] = data.layers.map((l: any) => {
    if (l.source?.fileIndex === undefined) return l;
    const { fileIndex, ...source } = l.source;
    return { ...l, source: { ...source, file: files[fileIndex] } };
  });

  return withUrls({
    layers,
    backgroundFile: data.background !== null ? files[data.background] : null,
    backgroundTransform: data.backgroundTransform,
    showBackgroundInLive: !!data.showBackgroundInLive,
    projectorSize: data.projectorSize,
    keyMappings: data.keyMappings,
  });
};

// Relative paths resolve against the app, so a show file placed next to the app can be named by file name.
export const fetchShowFile = async (url: string): Promise<SavedProject> => {
  const res = await fetch(new URL(url, window.location.href).toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseShowFile(await res.arrayBuffer());
};
