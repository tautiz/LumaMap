import { registerEffect } from '../registry';
import { ParamDef, ParamValue, TextureFxArgs } from '../types';
import { TAU, boltPath, wrap, fitAngular, fitRate, glowStroke, mixColor, num, rand, softSprite, str } from '../util';

// Generators make their own picture and need no content: an element can be just sparks or lightning.

type ParticleStyle = 'spark' | 'dot' | 'flame' | 'smoke' | 'snow';

const particleParams = (amount: number, speed: number, size: number, turbulence: number, emitter: string): ParamDef[] => [
  { key: 'amount', type: 'number', min: 5, max: 300, step: 1, default: amount },
  { key: 'speed', type: 'number', min: 0.1, max: 3, step: 0.05, default: speed },
  { key: 'size', type: 'number', min: 0.2, max: 4, step: 0.05, default: size },
  { key: 'turbulence', type: 'number', min: 0, max: 1, step: 0.05, default: turbulence },
  { key: 'emitter', type: 'select', options: ['bottom', 'top', 'everywhere', 'center'], default: emitter },
];

const BASE_LIFE: Record<ParticleStyle, number> = { spark: 1.6, dot: 5, flame: 1.4, smoke: 4, snow: 6 };
const TURBULENCE_W = 1.3; // Angle speed of the turbulence wobble (radians per second)
const TWINKLE_W = 3; // ...and of the floating dots' twinkle

// In a looping export every particle's life is fitted to the loop and its places repeat every loop, so the
// random positions stay random but the sequence starts over seamlessly. The shortest-lived particle sets the
// fastest speed and the longest-lived the slowest: those two are what the loop check looks at.
const particleLoop = (style: ParticleStyle) => ({
  kind: 'random' as const,
  rates: (p: Record<string, ParamValue>) => {
    const speed = num(p, 'speed', 1);
    const rates = [speed / (BASE_LIFE[style] * 1.4), speed / (BASE_LIFE[style] * 0.6)];
    if (num(p, 'turbulence') > 0) rates.push(TURBULENCE_W / TAU, (TURBULENCE_W * 0.8) / TAU);
    if (style === 'dot') rates.push(TWINKLE_W / TAU);
    return rates;
  },
});

// One particle system behind sparks, floating dots, fire, smoke and snow. Particle i is reborn every
// `life` seconds at a new place picked from (seed, i, cycle), so nothing has to be remembered between frames.
const drawParticles = (a: TextureFxArgs, style: ParticleStyle) => {
  const { ctx, w, h, m, time, progress, params, intensity, color, seed, loop } = a;
  const count = Math.round(num(params, 'amount', 60) * (0.3 + 0.7 * intensity));
  const speed = num(params, 'speed', 1);
  const size = num(params, 'size', 1);
  const turb = num(params, 'turbulence', 0);
  const emitter = progress !== null ? 'center' : str(params, 'emitter', 'bottom');
  const baseLife = BASE_LIFE[style];
  const turbW = fitAngular(TURBULENCE_W, loop);
  const turbWy = fitAngular(TURBULENCE_W * 0.8, loop); // Up and down a little slower than sideways
  const twinkleW = fitAngular(TWINKLE_W, loop);
  const sprite = style === 'spark' ? null : softSprite(color);
  const hot = style === 'flame' ? softSprite(mixColor(color, '#fff3a0', 0.75)) : null;

  ctx.globalCompositeOperation = style === 'smoke' ? 'source-over' : 'lighter';
  ctx.lineCap = 'round';

  for (let i = 0; i < count; i++) {
    const r1 = rand(seed, i * 7 + 1);
    let life = (baseLife * (0.6 + 0.8 * r1)) / speed;
    const lives = loop ? Math.max(1, Math.round(loop / life)) : 0; // Lives per loop
    if (loop) life = loop / lives;
    let u: number;
    let cycle = 0;
    if (progress !== null) {
      // A signal: everything bursts out of the middle at once (an explosion), then fades.
      u = progress / (0.45 + 0.55 * r1);
      if (u >= 1) continue;
    } else {
      const age = time + rand(seed, i * 7 + 2) * life * 10;
      cycle = Math.floor(age / life);
      u = age / life - cycle;
      if (lives) cycle %= lives; // The same places again in every loop
    }
    const rx = rand(seed, i * 7 + 3 + cycle * 131);
    const ry = rand(seed, i * 7 + 4 + cycle * 131);
    const rz = rand(seed, i * 7 + 5 + cycle * 131);

    const pos = (t: number) => {
      let x: number, y: number;
      switch (emitter) {
        case 'top': x = rx; y = -0.05 + t * (0.9 + 0.4 * ry); break;
        case 'everywhere': x = rx + (rz - 0.5) * 0.15 * t; y = ry - 0.1 * t; break;
        case 'center': {
          const ang = rx * Math.PI * 2;
          const dist = t * (0.25 + 0.4 * ry) * (style === 'spark' ? 1.4 : 1);
          x = 0.5 + Math.cos(ang) * dist * (m / w);
          y = 0.5 + Math.sin(ang) * dist * (m / h) + (style === 'spark' ? 0.15 * t * t : 0);
          break;
        }
        default: x = rx + (rz - 0.5) * 0.1 * t; y = 1.05 - t * (style === 'flame' ? 0.35 + 0.35 * ry : 0.6 + 0.6 * ry);
      }
      if (turb > 0) {
        const ph = rz * 6.283;
        x += turb * 0.06 * Math.sin(ph + time * turbW + t * 7) * (m / w);
        y += turb * 0.04 * Math.cos(ph * 0.8 + time * turbWy + t * 5) * (m / h);
      }
      return { x: x * w, y: y * h };
    };

    const p = pos(u);
    if (style === 'spark') {
      const q = pos(Math.max(0, u - 0.04));
      ctx.globalAlpha = (1 - u) * (0.6 + 0.4 * rz);
      ctx.strokeStyle = color;
      ctx.lineWidth = m * 0.004 * size;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(p.x - ctx.lineWidth / 2, p.y - ctx.lineWidth / 2, ctx.lineWidth, ctx.lineWidth);
      continue;
    }

    let r: number;
    let alpha: number;
    if (style === 'flame') {
      r = m * 0.06 * size * (1 - u * 0.75) * (0.6 + 0.6 * rz);
      alpha = Math.min(1, (1 - u) * 1.5) * 0.8;
    } else if (style === 'smoke') {
      r = m * 0.08 * size * (0.4 + u) * (0.7 + 0.5 * rz);
      alpha = Math.sin(Math.PI * u) * 0.35;
    } else if (style === 'snow') {
      r = m * 0.008 * size * (0.5 + rz);
      alpha = Math.min(1, Math.sin(Math.PI * u) * 3) * 0.9;
    } else {
      r = m * 0.012 * size * (0.5 + rz);
      alpha = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(time * twinkleW + rz * 20));
    }
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.drawImage(sprite!, p.x - r, p.y - r, r * 2, r * 2);
    if (hot && u < 0.5) {
      ctx.globalAlpha = (0.5 - u) * 1.6;
      ctx.drawImage(hot, p.x - r * 0.6, p.y - r * 0.6, r * 1.2, r * 1.2);
    }
  }
};

registerEffect({
  id: 'sparks', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: particleParams(80, 1, 1, 0.2, 'bottom'),
  defaults: { blend: 'add', color: { mode: 'custom', color: '#ffb340' } },
  loop: particleLoop('spark'),
  renderTexture: a => drawParticles(a, 'spark'),
});

registerEffect({
  id: 'particles', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: particleParams(70, 0.6, 1, 0.6, 'everywhere'),
  defaults: { blend: 'add', color: { mode: 'custom', color: '#b46bff' } },
  loop: particleLoop('dot'),
  renderTexture: a => drawParticles(a, 'dot'),
});

registerEffect({
  id: 'fire', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: particleParams(140, 1, 1.2, 0.3, 'bottom'),
  defaults: { blend: 'add', color: { mode: 'custom', color: '#ff4a1c' } },
  loop: particleLoop('flame'),
  renderTexture: a => drawParticles(a, 'flame'),
});

registerEffect({
  id: 'smoke', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: particleParams(40, 0.5, 1.4, 0.5, 'bottom'),
  defaults: { blend: 'normal', color: { mode: 'custom', color: '#9aa0aa' } },
  loop: particleLoop('smoke'),
  renderTexture: a => drawParticles(a, 'smoke'),
});

registerEffect({
  id: 'snow', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: particleParams(120, 0.6, 1, 0.4, 'top'),
  defaults: { blend: 'normal', color: { mode: 'custom', color: '#ffffff' } },
  loop: particleLoop('snow'),
  renderTexture: a => drawParticles(a, 'snow'),
});

// Lightning bolts across the element. They change shape `flicker` times a second.
registerEffect({
  id: 'lightning', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'bolts', type: 'number', min: 1, max: 8, step: 1, default: 2 },
    { key: 'flicker', type: 'number', min: 1, max: 30, step: 1, default: 10 },
    { key: 'roughness', type: 'number', min: 0.1, max: 1.5, step: 0.05, default: 0.8 },
    { key: 'thickness', type: 'number', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'direction', type: 'select', options: ['across', 'down', 'random'], default: 'across' },
  ],
  loop: { kind: 'random', rates: p => [num(p, 'flicker', 10)] },
  defaults: { blend: 'add', color: { mode: 'custom', color: '#9fd8ff' } },
  renderTexture: ({ ctx, w, h, m, time, progress, params, intensity, color, seed, loop }) => {
    const bucket = Math.floor(time * fitRate(num(params, 'flicker', 10), loop));
    const bolts = num(params, 'bolts', 2);
    const dir = str(params, 'direction', 'across');
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < bolts; b++) {
      const s = seed + bucket * 7919 + b * 104729;
      if (progress === null && rand(s, 99) > 0.75) continue; // Bolts blink on and off
      let ax: number, ay: number, bx: number, by: number;
      if (dir === 'down') { ax = rand(s, 1) * w; ay = 0; bx = rand(s, 2) * w; by = h; }
      else if (dir === 'random') { ax = rand(s, 1) * w; ay = rand(s, 2) * h; bx = rand(s, 3) * w; by = rand(s, 4) * h; }
      else { ax = 0; ay = rand(s, 1) * h; bx = w; by = rand(s, 2) * h; }
      const pts = boltPath(ax, ay, bx, by, s, num(params, 'roughness', 0.8));
      const alpha = (progress !== null ? 1 - progress : 1) * (0.6 + 0.4 * intensity);
      glowStroke(ctx, pts, color, m * 0.004 * num(params, 'thickness', 1), m * 0.03, alpha);
      // One short branch per bolt
      const from = pts[Math.floor(pts.length * (0.3 + 0.4 * rand(s, 5)))];
      const ang = rand(s, 6) * Math.PI * 2;
      const len = m * 0.2 * rand(s, 7);
      glowStroke(ctx, boltPath(from.x, from.y, from.x + Math.cos(ang) * len, from.y + Math.sin(ang) * len, s + 1, 1, 4),
        color, m * 0.002 * num(params, 'thickness', 1), m * 0.02, alpha * 0.7);
    }
  },
});

// Moving cloudy or grainy noise. The noise tile is made once; frames only move and scale it.
const GRAIN_RATE = 24; // New grain this many times a second
const NOISE_DRIFT: [number, number][] = [[1, 0.6], [-0.7, -0.42]]; // Each cloud layer's drift, in tiles per second per speed
let noiseTile: HTMLCanvasElement | null = null;
const getNoiseTile = () => {
  if (noiseTile) return noiseTile;
  noiseTile = document.createElement('canvas');
  noiseTile.width = noiseTile.height = 64;
  const g = noiseTile.getContext('2d')!;
  const img = g.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.floor(rand(1234, i) * 255);
  }
  g.putImageData(img, 0, 0);
  return noiseTile;
};

registerEffect({
  id: 'noise', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'scale', type: 'number', min: 0.2, max: 5, step: 0.05, default: 1.5 },
    { key: 'speed', type: 'number', min: 0, max: 3, step: 0.05, default: 0.5 },
    { key: 'style', type: 'select', options: ['clouds', 'grain'], default: 'clouds' },
  ],
  // Clouds slide the tile; it repeats every 64 tile pixels, so each direction loops on its own speed.
  loop: {
    kind: 'loop',
    rates: p => {
      if (str(p, 'style') === 'grain') return [GRAIN_RATE];
      const sp = num(p, 'speed', 0.5);
      return sp > 0 ? NOISE_DRIFT.flatMap(([x, y]) => [sp * Math.abs(x), sp * Math.abs(y)]) : [];
    },
  },
  defaults: { blend: 'screen', color: { mode: 'element' } },
  renderTexture: ({ ctx, w, h, m, time, params, intensity, color, seed, loop }) => {
    const tile = getNoiseTile();
    const grain = str(params, 'style') === 'grain';
    const cell = grain ? Math.max(1, m * 0.004 * num(params, 'scale', 1)) : m * 0.05 * num(params, 'scale', 1);
    const speed = num(params, 'speed', 0.5);
    ctx.imageSmoothingEnabled = !grain;
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.fillStyle = pattern;
    const layers = grain ? 1 : 2;
    for (let l = 0; l < layers; l++) {
      // Tile pixels moved so far, sideways and down
      let offX: number, offY: number;
      if (grain) {
        offX = offY = Math.floor(time * fitRate(GRAIN_RATE, loop)) * 37.3;
        offY *= 0.6;
      } else {
        const [dx, dy] = NOISE_DRIFT[l];
        offX = time * Math.sign(dx) * fitRate(speed * Math.abs(dx), loop) * 64;
        offY = time * Math.sign(dy) * fitRate(speed * Math.abs(dy), loop) * 64;
      }
      ctx.save();
      ctx.globalAlpha = grain ? 1 : 0.7;
      ctx.scale(cell * (l ? 1.7 : 1), cell * (l ? 1.7 : 1));
      ctx.translate(wrap(offX + rand(seed, l) * 64, 64), wrap(offY, 64)); // The tile repeats every 64 pixels
      ctx.fillRect(-64, -64, w / cell + 128, h / cell + 128);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.globalAlpha = 0.4 + 0.6 * intensity;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  },
});

// Wobbling patches of light, like sunlight through water.
registerEffect({
  id: 'caustics', role: 'generator', inputMode: 'none', space: 'texture', animated: true,
  params: [
    { key: 'amount', type: 'number', min: 3, max: 40, step: 1, default: 14 },
    { key: 'speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.3 },
    { key: 'size', type: 'number', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  // Each patch wobbles at 0.3..1 x speed (radians per second) and pulses at 2 x speed.
  loop: { kind: 'loop', rates: p => [0.3, 1, 2].map(k => (num(p, 'speed', 0.3) * k) / TAU) },
  defaults: { blend: 'add', opacity: 0.6, color: { mode: 'custom', color: '#7fe9ff' } },
  renderTexture: ({ ctx, w, h, m, time, params, intensity, color, seed, loop }) => {
    const sprite = softSprite(color);
    const n = num(params, 'amount', 14);
    const sp = num(params, 'speed', 0.3);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const fx = 0.3 + rand(seed, i * 4) * 0.7;
      const fy = 0.3 + rand(seed, i * 4 + 1) * 0.7;
      const x = (0.5 + 0.45 * Math.sin(time * fitAngular(sp * fx, loop) + i * 1.7)) * w;
      const y = (0.5 + 0.45 * Math.cos(time * fitAngular(sp * fy, loop) + i * 2.3)) * h;
      const r = m * 0.18 * num(params, 'size', 1) * (0.6 + 0.6 * rand(seed, i * 4 + 2));
      ctx.globalAlpha = (0.25 + 0.35 * intensity) * (0.6 + 0.4 * Math.sin(time * fitAngular(2 * sp, loop) + i));
      ctx.drawImage(sprite, x - r, y - r * 0.6, r * 2, r * 1.2);
    }
  },
});
