import { BlendMode, ColorSource, EffectDefinition, EffectInstance, EffectTrigger, ParamValue } from './types';

// Every effect registers itself here; the renderer, the stack UI and presets only know effects by id.
const definitions = new Map<string, EffectDefinition>();

export const registerEffect = (def: EffectDefinition) => {
  definitions.set(def.id, def);
};

export const getEffect = (id: string): EffectDefinition | undefined => definitions.get(id);

export const listEffects = (): EffectDefinition[] => [...definitions.values()];

export const newId = () => Math.random().toString(36).slice(2, 11);

export type EffectOverrides = Partial<Omit<EffectInstance, 'id' | 'type' | 'color' | 'trigger'>> & {
  color?: Partial<ColorSource>;
  trigger?: Partial<EffectTrigger>;
};

export const createEffect = (type: string, overrides: EffectOverrides = {}): EffectInstance => {
  const def = getEffect(type);
  const d = def?.defaults ?? {};
  const params: Record<string, ParamValue> = {};
  for (const p of def?.params ?? []) params[p.key] = p.default;
  return {
    id: newId(),
    type,
    enabled: true,
    blend: d.blend ?? 'normal',
    opacity: d.opacity ?? 1,
    intensity: d.intensity ?? 0.7,
    placement: d.placement,
    ...overrides,
    color: { mode: 'element', color: '#00e5ff', ...d.color, ...overrides.color },
    trigger: { mode: 'always', duration: 1.5, ...d.trigger, ...overrides.trigger },
    params: { ...params, ...overrides.params },
  };
};

/** The effect's parameters with defaults filled in for any added after the show was saved. */
export const resolveParams = (fx: EffectInstance, def: EffectDefinition): Record<string, ParamValue> => {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) out[p.key] = fx.params[p.key] ?? p.default;
  return out;
};

export const isAnimated = (fx: EffectInstance, def: EffectDefinition) =>
  typeof def.animated === 'function' ? def.animated(resolveParams(fx, def)) : def.animated;

/** 0..1 while a signal-triggered effect runs, null for effects that run all the time, -1 when it is idle. */
export const triggerProgress = (fx: EffectInstance, now: number): number | null => {
  if (fx.trigger.mode !== 'signal') return null;
  if (!fx.trigger.firedAt) return -1;
  const p = (now - fx.trigger.firedAt) / (Math.max(0.05, fx.trigger.duration) * 1000);
  return p >= 0 && p < 1 ? p : -1;
};

export const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'difference',
};

/** Effects that make their own layer, as opposed to changing or masking the picture they get. */
export const makesLayer = (def: EffectDefinition) =>
  def.role === 'generator' || def.role === 'overlay' || def.role === 'underlay';
