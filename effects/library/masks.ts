import { registerEffect } from '../registry';
import { ParamDef, ParamValue, TextureFxArgs } from '../types';
import { fitPeriod, wrap, num, rand, str } from '../util';

// Masks draw where the picture stays visible (opaque) and where it disappears (transparent).
// The amount comes from the signal while one runs, from a loop when "animate" is on, and from the slider otherwise.

const maskParams = (extra: ParamDef[] = []): ParamDef[] => [
  { key: 'amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'animate', type: 'bool', default: false },
  { key: 'period', type: 'number', min: 0.5, max: 20, step: 0.5, default: 4 },
  { key: 'softness', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3 },
  ...extra,
];

const maskLoop = { kind: 'loop' as const, rates: (p: Record<string, ParamValue>) => [1 / num(p, 'period', 4)] };

const amountOf = ({ time, progress, params, loop }: TextureFxArgs) => {
  if (progress !== null) return progress;
  if (params.animate === true) {
    const p = wrap(time / fitPeriod(num(params, 'period', 4), loop), 1);
    return p < 0.5 ? p * 2 : 2 - p * 2; // Reveal, then hide again
  }
  return num(params, 'amount', 0.6);
};

registerEffect({
  id: 'radialReveal', role: 'mask', inputMode: 'required', space: 'texture',
  animated: p => p.animate === true,
  params: maskParams(),
  loop: maskLoop,
  defaults: { trigger: { duration: 2 } },
  renderTexture: (a) => {
    const { ctx, w, h, params } = a;
    const amount = amountOf(a);
    const maxR = Math.hypot(w, h) / 2;
    const soft = num(params, 'softness', 0.3);
    const r = amount * maxR * (1 + soft);
    if (r <= 0) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.max(0, r * (1 - soft)), w / 2, h / 2, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
});

registerEffect({
  id: 'wipe', role: 'mask', inputMode: 'required', space: 'texture',
  animated: p => p.animate === true,
  params: maskParams([{ key: 'direction', type: 'select', options: ['right', 'left', 'down', 'up'], default: 'right' }]),
  loop: maskLoop,
  defaults: { trigger: { duration: 2 } },
  renderTexture: (a) => {
    const { ctx, w, h, params } = a;
    const amount = amountOf(a);
    const dir = str(params, 'direction', 'right');
    const len = dir === 'right' || dir === 'left' ? w : h;
    const soft = num(params, 'softness', 0.3) * len * 0.5;
    const edge = amount * (len + soft);
    const flip = dir === 'left' || dir === 'up';
    const [x0, y0, x1, y1] = dir === 'right' || dir === 'left' ? [edge - soft, 0, edge, 0] : [0, edge - soft, 0, edge];
    const g = ctx.createLinearGradient(x0, y0, x1 + 0.01, y1 + 0.01);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    if (flip) {
      // Mirror, so "left" and "up" reveal from the other side.
      if (dir === 'left') { ctx.translate(w, 0); ctx.scale(-1, 1); } else { ctx.translate(0, h); ctx.scale(1, -1); }
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  },
});

// Noise reveal (dissolve): the picture appears block by block in a random order.
registerEffect({
  id: 'noiseReveal', role: 'mask', inputMode: 'required', space: 'texture',
  animated: p => p.animate === true,
  params: maskParams([{ key: 'blocks', type: 'number', min: 4, max: 80, step: 1, default: 24 }]).filter(p => p.key !== 'softness'),
  loop: maskLoop,
  defaults: { trigger: { duration: 2 } },
  renderTexture: (a) => {
    const { ctx, w, h, params, seed } = a;
    const amount = amountOf(a);
    const cols = Math.round(num(params, 'blocks', 24));
    const rows = Math.max(1, Math.round((cols * h) / w));
    const cw = w / cols;
    const ch = h / rows;
    ctx.fillStyle = '#fff';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rand(seed, y * cols + x) < amount) ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
  },
});
