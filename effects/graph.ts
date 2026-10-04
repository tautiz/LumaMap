import { Layer } from '../types';
import { getEffect, isAnimated, makesLayer, triggerProgress } from './registry';
import { EffectDefinition, EffectInstance } from './types';

// The renderer does not walk the stack directly: the stack is compiled into a small graph of render
// passes first. Today every graph is a chain (content -> effect -> effect ...), but the executor
// (effects/pipeline.ts) runs any graph whose nodes are in dependency order, so a future node editor
// can feed one effect from several sources (Video -> Ripple and Particles -> Glow -> Composite) without
// touching how effects are drawn.

export type GraphNode =
  | { id: string; kind: 'content' }
  | {
      id: string;
      kind: 'effect';
      fx: EffectInstance;
      def: EffectDefinition;
      inputs: string[]; // inputs[0] is the picture the effect works on
      progress: number | null;
    };

export interface ScreenPass {
  fx: EffectInstance;
  def: EffectDefinition;
  progress: number | null;
}

export interface RenderGraph {
  nodes: GraphNode[]; // In dependency order
  output: string;
  under: ScreenPass[]; // Projector-space passes drawn before the element
  over: ScreenPass[]; // ...and after it
  textureEffects: number; // 0 means the element can be drawn the plain, fastest way
  animated: boolean; // Something moves: redraw every frame
}

/** Only the passes this element needs right now: switched-off and idle signal effects cost nothing. */
export const compileStack = (layer: Layer, now: number): RenderGraph => {
  const graph: RenderGraph = { nodes: [{ id: 'content', kind: 'content' }], output: 'content', under: [], over: [], textureEffects: 0, animated: false };
  for (const fx of layer.effects ?? []) {
    if (!fx.enabled) continue;
    const def = getEffect(fx.type);
    if (!def) continue;
    const progress = triggerProgress(fx, now);
    if (progress === -1) continue;
    if (progress !== null || isAnimated(fx, def)) graph.animated = true;

    if (def.space === 'screen') {
      const under = (fx.placement ?? (def.role === 'underlay' ? 'under' : 'over')) === 'under';
      (under ? graph.under : graph.over).push({ fx, def, progress });
      continue;
    }
    graph.nodes.push({ id: fx.id, kind: 'effect', fx, def, inputs: [graph.output], progress });
    graph.output = fx.id;
    graph.textureEffects++;
  }
  return graph;
};

/** Would anything on this element move right now? (Signals count while they run.) */
export const layerNeedsFrames = (layer: Layer, now: number) => {
  for (const fx of layer.effects ?? []) {
    if (!fx.enabled) continue;
    const def = getEffect(fx.type);
    if (!def) continue;
    const progress = triggerProgress(fx, now);
    if (progress === -1) continue;
    if (progress !== null || isAnimated(fx, def)) return true;
  }
  return false;
};

/** Effects that need a picture but have nothing before them in the stack: they would draw nothing. */
export const effectsMissingInput = (layer: Layer): Set<string> => {
  const missing = new Set<string>();
  let hasPicture = !!layer.source;
  for (const fx of layer.effects ?? []) {
    const def = getEffect(fx.type);
    if (!def || !fx.enabled) continue;
    if (def.space === 'texture' && def.inputMode === 'required' && !hasPicture) missing.add(fx.id);
    if (def.space === 'texture' && makesLayer(def)) hasPicture = true;
  }
  return missing;
};
