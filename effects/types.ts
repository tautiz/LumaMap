// The Visual Effects Engine: an element is Content (optional) + an Effect Stack, composited into one picture.
//
// Everything here is plain JSON, so it is saved in shows and sent to the projector window as it is.
// The stack is the editing model; the renderer compiles it into a RenderGraph (effects/graph.ts), so a
// node editor can later build graphs directly without changing how effects are written or drawn.

/** What an effect does to the picture, which decides how its result is combined. */
export type EffectRole =
  | 'generator' // Makes its own picture (sparks, lightning, fire); needs no input
  | 'modifier' // Changes the picture it gets (ripple, blur, colour shift)
  | 'overlay' // Draws an extra layer on top of the picture (electric border, light sweep)
  | 'underlay' // Draws behind the picture (aura, halo)
  | 'mask' // Decides which part of the picture is visible (reveal, wipe)
  | 'spatial'; // Lives in the projector's space, between points or elements (laser, arc)

/** Whether the effect needs a picture to work on. */
export type InputMode = 'required' | 'optional' | 'none';

/** Where the effect is drawn: in the element's own picture (mapped onto its mesh), or in projector space. */
export type EffectSpace = 'texture' | 'screen';

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken' | 'difference';

export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'difference'];

/** Where the effect's colour comes from. */
export type ColorSourceMode =
  | 'custom' // Its own colour
  | 'element' // The element's colour: changes when the element's colour changes
  | 'input' // The average colour of the picture the effect gets
  | 'content' // The average colour of the element's content (video, picture...)
  | 'palette'; // Slowly cycles through a list of colours

export interface ColorSource {
  mode: ColorSourceMode;
  color: string; // '#rrggbb', used by 'custom' (and as the fallback for the others)
  palette?: string[]; // Used by 'palette'
}

/** 'always' runs all the time; 'signal' runs once for `duration` seconds after a trigger (key T, button, LumaAPI). */
export interface EffectTrigger {
  mode: 'always' | 'signal';
  duration: number; // seconds
  firedAt?: number; // Date.now() of the last signal; the same clock in the editor and the projector window
}

export type ParamValue = number | string | boolean;

/** One effect in an element's stack. Turning it off, editing or removing it never changes the content. */
export interface EffectInstance {
  id: string;
  type: string; // EffectDefinition.id
  enabled: boolean;
  blend: BlendMode;
  opacity: number; // 0..1
  intensity: number; // 0..1, the effect's overall strength
  placement?: 'over' | 'under'; // For effects that make their own layer: on top of or behind the picture
  color: ColorSource;
  trigger: EffectTrigger;
  params: Record<string, ParamValue>;
}

export type ParamDef =
  | { key: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { key: string; type: 'select'; options: string[]; default: string }
  | { key: string; type: 'bool'; default: boolean }
  | { key: string; type: 'layer'; default: string }; // Another element (spatial effects)

/** What an effect gets when it draws in the element's own picture (texture space). */
export interface TextureFxArgs {
  ctx: CanvasRenderingContext2D; // Cleared target, w x h
  input: HTMLCanvasElement | null; // The picture so far; null when there is nothing yet
  w: number;
  h: number;
  m: number; // min(w, h): sizes are given relative to it, so every resolution looks the same
  time: number; // seconds on the shared clock
  progress: number | null; // 0..1 while a signal runs; null when running all the time
  params: Record<string, ParamValue>;
  intensity: number;
  color: string;
  colorMode: ColorSourceMode;
  seed: number; // Stable per effect, so two copies of an effect do not move in step
  loop: number | null; // Looping video export: the loop length in seconds (fit speeds with fitRate); null otherwise
  scratch: (index: number) => CanvasRenderingContext2D; // Extra w x h canvases, cleared
}

/** What an effect gets when it draws in projector space. The context is already in projector pixels. */
export interface ScreenFxArgs {
  ctx: CanvasRenderingContext2D;
  scale: number; // Device pixels per projector pixel (shadow and blur sizes ignore the transform)
  layerId: string;
  outline: { x: number; y: number }[]; // The element's outline (convex hull of its points)
  center: { x: number; y: number };
  centerOf: (layerId: string) => { x: number; y: number } | null;
  area: { w: number; h: number }; // Projector size
  time: number;
  progress: number | null;
  params: Record<string, ParamValue>;
  intensity: number;
  color: string;
  colorMode: ColorSourceMode;
  seed: number;
  loop: number | null;
}

/**
 * How an effect takes part in a looping video export (see effects/loop.ts).
 * - 'loop': it moves in cycles; each speed is nudged so a whole number of cycles fits the loop.
 * - 'random': it changes at random moments; the changes keep their seed, and the random sequence starts
 *   over with every loop, so the end joins the start like any other random change.
 * An effect that moves and declares neither cannot be made to loop.
 */
export interface LoopSupport {
  kind: 'loop' | 'random';
  /** Every speed the effect uses with these settings, in cycles (or random changes) per second. */
  rates: (params: Record<string, ParamValue>) => number[];
}

export interface EffectDefinition {
  id: string;
  role: EffectRole;
  inputMode: InputMode;
  space: EffectSpace;
  /** Moves by itself, so the picture must be redrawn every frame while it is on. */
  animated: boolean | ((params: Record<string, ParamValue>) => boolean);
  params: ParamDef[];
  loop?: LoopSupport;
  defaults?: Partial<Pick<EffectInstance, 'blend' | 'opacity' | 'intensity' | 'placement'>> & {
    color?: Partial<ColorSource>;
    trigger?: Partial<EffectTrigger>;
  };
  renderTexture?: (args: TextureFxArgs) => void;
  renderScreen?: (args: ScreenFxArgs) => void;
}

/** A saved combination of effects ("look"), applied to any element. */
export interface ChainPreset {
  id: string;
  name: string; // For built-in presets this is a translation key
  builtIn?: boolean;
  effects: Omit<EffectInstance, 'id'>[];
}
