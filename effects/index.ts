import './library';

export * from './types';
export * from './registry';
export * from './graph';
export * from './pipeline';
export * from './presets';
export * from './content';

import { Layer } from '../types';

/** Starts every signal-triggered effect on the given elements now (key T, the panel button, LumaAPI). */
export const fireSignals = (layers: Layer[], shouldFire: (layer: Layer) => boolean, now = Date.now()): Layer[] =>
  layers.map(l => {
    if (!shouldFire(l) || !l.effects?.some(e => e.enabled && e.trigger.mode === 'signal')) return l;
    return {
      ...l,
      effects: l.effects.map(e => (e.enabled && e.trigger.mode === 'signal' ? { ...e, trigger: { ...e.trigger, firedAt: now } } : e)),
    };
  });
