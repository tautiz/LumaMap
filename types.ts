
export interface Point {
  x: number;
  y: number;
}

export interface ControlPoint {
  id: string;
  x: number; // Screen X (pixels)
  y: number; // Screen Y (pixels)
  u: number; // Texture U (0-1)
  v: number; // Texture V (0-1)
}

export enum ContentType {
  VIDEO = 'VIDEO',
  IMAGE = 'IMAGE',
  SOLID_COLOR = 'SOLID_COLOR',
}

export interface ProjectionSource {
  type: ContentType;
  url: string; // Blob URL or remote URL
  name: string;
  file?: File; // Raw file object for syncing across tabs
}

// Several videos played one after another on the same layer. The layer's `source` is always items[index].
export interface Playlist {
  items: ProjectionSource[];
  index: number;
  loop: boolean; // After the last video start again from the first; otherwise stop on the last one
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  currentTime: number; // Position to seek to (applied only when it or seekAt changes)
  seekAt?: number; // Bumped on every seek or restart, so seeking to the same time again still applies
  duration: number;
}

// How the green grid is drawn on an element. Sizes are kept in centimetres; `unit` only changes how they are shown.
export interface GridSettings {
  unit: 'm' | 'cm';
  width: number; // Element width (cm)
  height: number; // Element height (cm)
  mode: 'size' | 'count'; // Pick the cell size and count the cells, or pick the cell count and work out the size
  cellWidth: number; // cm, used in 'size' mode
  cellHeight: number; // cm, used in 'size' mode
  columns: number; // used in 'count' mode
  rows: number; // used in 'count' mode
  frame: boolean; // Draw a frame around the whole element
  cellsTouch: boolean; // true: neighbouring cells share one line; false: every cell has its own frame with a gap
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // User defined master opacity
  transitionOpacity?: number; // System defined fade multiplier (0-1)
  source: ProjectionSource | null;
  playlist?: Playlist | null;
  points: ControlPoint[];
  playback: PlaybackState;
  grid?: GridSettings | null; // This element's own grid; when empty the project's default grid is used
}

export interface ProjectorState {
  layers: Layer[];
  activeLayerId: string | null;
  isActive: boolean;
  // Background Ref is separate from layers
  backgroundUrl: string | null;
  backgroundTransform: Transform;
}

export enum AppMode {
  SETUP = 'SETUP', // Taking photo of the wall / uploading background
  MAPPING = 'MAPPING', // Dragging corners
  LIVE = 'LIVE', // Fullscreen projection
}

// Shortcuts
export type ShortcutAction = 'NEXT_LAYER' | 'PREV_LAYER' | 'BLACKOUT' | 'TOGGLE_UI' | 'TOGGLE_FRAME';

export type KeyMap = {
  [action in ShortcutAction]: string;
};

// Global API Interface for external control (Console, Bluetooth Scripts, etc.)
export interface LumaAPI {
  /**
   * Toggles visibility of a layer by its index (0-based, from bottom to top)
   */
  toggleLayerVisibility: (index: number) => void;
  
  /**
   * Sets the opacity of a layer by index
   * @param index Layer index
   * @param opacity 0.0 to 1.0
   */
  setLayerOpacity: (index: number, opacity: number) => void;

  /**
   * Hides all layers immediately
   */
  blackout: () => void;

  /**
   * Restores visibility of all layers
   */
  restoreAll: () => void;
  
  /**
   * Returns current layer status
   */
  getStatus: () => Layer[];
}

declare global {
  interface Window {
    LumaAPI: LumaAPI;
  }
}
