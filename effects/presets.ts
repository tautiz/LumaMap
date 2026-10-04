import { createEffect, newId } from './registry';
import { ChainPreset, EffectInstance } from './types';

// Chain presets ("looks"): whole effect stacks saved under a name and applied to any element.
// Built-in presets are made from the effect library; the user's own are kept in this browser.

const fx = (type: string, overrides: Parameters<typeof createEffect>[1] = {}) => {
  const { id: _id, ...rest } = createEffect(type, overrides);
  return rest;
};

export const builtInPresets = (): ChainPreset[] => [
  {
    id: 'electricSurface', name: 'fx.preset.electricSurface', builtIn: true,
    effects: [
      fx('electricBorder', { color: { mode: 'element', color: '#00e5ff' } }),
      fx('sparks', { color: { mode: 'element', color: '#00e5ff' }, params: { amount: 40, emitter: 'everywhere' } }),
      fx('glow', { color: { mode: 'custom', color: '#2d6bff' } }),
      fx('pulse', { params: { speed: 0.6, depth: 0.3 } }),
    ],
  },
  {
    id: 'underwater', name: 'fx.preset.underwater', builtIn: true,
    effects: [
      fx('ripple', { params: { amount: 0.4 } }),
      fx('colorShift', { color: { mode: 'custom', color: '#1e7bff' }, params: { tint: 0.5 } }),
      fx('caustics'),
      fx('wave'),
    ],
  },
  {
    id: 'magicEnergy', name: 'fx.preset.magicEnergy', builtIn: true,
    effects: [
      fx('particles', { params: { turbulence: 0.9 } }),
      fx('noise', { blend: 'screen', opacity: 0.5, color: { mode: 'custom', color: '#8a3dff' } }),
      fx('glow', { color: { mode: 'custom', color: '#b46bff' } }),
      fx('aura', { color: { mode: 'custom', color: '#b46bff' } }),
    ],
  },
  {
    id: 'damagedScreen', name: 'fx.preset.damagedScreen', builtIn: true,
    effects: [
      fx('glitch'),
      fx('rgbSplit'),
      fx('scanlines'),
      fx('flash', { trigger: { mode: 'always' }, params: { chance: 0.15 }, opacity: 0.6 }),
    ],
  },
  {
    id: 'fire', name: 'fx.preset.fire', builtIn: true,
    effects: [fx('fire'), fx('smoke', { opacity: 0.6 }), fx('glow', { color: { mode: 'custom', color: '#ff6a00' } })],
  },
  {
    id: 'storm', name: 'fx.preset.storm', builtIn: true,
    effects: [fx('smoke'), fx('lightning'), fx('flash', { trigger: { mode: 'always' }, params: { chance: 0.1 }, opacity: 0.5 }), fx('glow')],
  },
  {
    id: 'explosion', name: 'fx.preset.explosion', builtIn: true,
    effects: [
      fx('flash', { trigger: { mode: 'signal', duration: 0.5 } }),
      fx('shockwave', { color: { mode: 'custom', color: '#ffcc00' }, trigger: { mode: 'signal', duration: 1.2 } }),
      fx('sparks', { params: { amount: 160 }, trigger: { mode: 'signal', duration: 1.8 } }),
    ],
  },
];

/** Fresh copies with new ids, so the same preset can go on many elements and each is edited on its own. */
export const instantiatePreset = (preset: ChainPreset): EffectInstance[] =>
  preset.effects.map(e => ({
    ...e,
    id: newId(),
    color: { ...e.color },
    trigger: { ...e.trigger, firedAt: undefined },
    params: { ...e.params },
  }));

export const presetFromStack = (name: string, effects: EffectInstance[]): ChainPreset => ({
  id: newId(),
  name,
  effects: effects.map(({ id: _id, ...e }) => ({ ...e, trigger: { ...e.trigger, firedAt: undefined } })),
});

const STORAGE_KEY = 'lumamap.effectPresets';

export const loadUserPresets = (): ChainPreset[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const saveUserPresets = (presets: ChainPreset[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage blocked (private mode): presets only last this session.
  }
};
