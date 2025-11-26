
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

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  source: ProjectionSource | null;
  points: ControlPoint[];
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
