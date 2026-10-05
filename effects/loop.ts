import { Layer } from '../types';
import { DEFAULT_PALETTE, PALETTE_SECONDS } from './pipeline';
import { getEffect, isAnimated, resolveParams } from './registry';
import { fitRate } from './util';

// Which effects can take part in a looping video export, checked before the export starts.
//
// An effect that does not move loops by itself. One that moves declares how (EffectDefinition.loop):
// 'loop' effects fit each of their speeds to a whole number of cycles per loop; 'random' effects keep their
// seed and start their random sequence over each loop. Fitting changes a speed a little; when it would
// change it a lot (an effect much slower than the loop), the effect is left as it is and reported instead,
// since forcing it would change what it looks like. Problems are warnings: the export can still go ahead.

export type EffectLoopStatus = 'still' | 'loop' | 'random';
export type LoopIssueReason =
  | 'cannotLoop' // Moves, but has no way to fit a loop
  | 'tooSlow' // Would have to run much faster or slower to fit this loop length
  | 'signal'; // Only runs when a signal is given, so it is not in the video

export interface EffectLoopReport {
  layerId: string;
  layerName: string;
  effectId: string;
  effectType: string;
  status: EffectLoopStatus | null; // null when there is an issue
  issue?: LoopIssueReason;
  speedChange: number; // Largest change of one of its speeds to fit the loop: 0.1 = 10 % faster or slower
}

export interface LoopCheck {
  effects: EffectLoopReport[];
  issues: EffectLoopReport[];
  skip: Set<string>; // Effects drawn as they are, without fitting (see FrameEnv.loop)
}

/**
 * Fitting may make a speed up to this much faster or slower (0.5 = 1.5 times); beyond it the effect is
 * reported instead. Small changes are not noticeable; an effect forced to run twice as fast would look different.
 */
export const MAX_SPEED_CHANGE = 0.5;

/** How much fitting changes the speeds: the largest factor, faster or slower, minus one (0 = unchanged). */
export const speedChange = (rates: number[], loopSeconds: number): number =>
  rates.reduce((worst, r) => {
    if (!(r > 0) || !Number.isFinite(r)) return worst;
    const f = fitRate(r, loopSeconds);
    return Math.max(worst, Math.max(f / r, r / f) - 1);
  }, 0);

export const checkEffectsForLoop = (layers: Layer[], loopSeconds: number, maxChange = MAX_SPEED_CHANGE): LoopCheck => {
  const effects: EffectLoopReport[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const fx of layer.effects ?? []) {
      if (!fx.enabled) continue;
      const def = getEffect(fx.type);
      if (!def) continue; // Unknown effects are not drawn at all
      const base = { layerId: layer.id, layerName: layer.name, effectId: fx.id, effectType: fx.type, speedChange: 0 };
      if (fx.trigger.mode === 'signal') {
        effects.push({ ...base, status: null, issue: 'signal' });
        continue;
      }
      if (!isAnimated(fx, def)) {
        effects.push({ ...base, status: 'still' });
        continue;
      }
      if (!def.loop) {
        effects.push({ ...base, status: null, issue: 'cannotLoop' });
        continue;
      }
      const rates = def.loop.rates(resolveParams(fx, def));
      if (fx.color.mode === 'palette') {
        const n = fx.color.palette?.length || DEFAULT_PALETTE.length;
        rates.push(1 / (PALETTE_SECONDS * n));
      }
      const change = speedChange(rates, loopSeconds);
      effects.push(change > maxChange
        ? { ...base, status: null, issue: 'tooSlow', speedChange: change }
        : { ...base, status: def.loop.kind, speedChange: change });
    }
  }
  const issues = effects.filter(e => e.issue);
  // Signal effects are idle in the export anyway; the others are drawn without fitting.
  const skip = new Set(issues.filter(e => e.issue !== 'signal').map(e => e.effectId));
  return { effects, issues, skip };
};

/** Turns off the given effects (the warning's "turn off" choice); the content and other effects stay. */
export const disableEffects = (layers: Layer[], effectIds: Set<string>): Layer[] =>
  layers.map(l => (l.effects?.some(e => effectIds.has(e.id))
    ? { ...l, effects: l.effects.map(e => (effectIds.has(e.id) ? { ...e, enabled: false } : e)) }
    : l));
