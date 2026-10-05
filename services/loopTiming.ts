// Exact timing for the looping video export. Every length here is a fraction of whole numbers (BigInt),
// never floating-point seconds, so the loop length, the number of frames and how many times each video
// plays can not be off by one frame because of rounding, and big numbers can not overflow.
//
// The time model, used the same way everywhere:
// - A frame starts at its presentation timestamp (PTS) and lasts until the next one. A video with N frames
//   at r frames per second therefore lasts N / r: the last frame counts with its own duration, and
//   nothing is added after it.
// - A video's length is the end of its last frame minus the start of its first:
//   (last PTS + last frame's duration - first PTS) / timescale.
// - Export frame i starts at i / fps. Frame N (one past the end) is frame 0 of the next loop, so the
//   loop is exactly N frames long and the first frame is never repeated at the end.
//
// The pipeline: video length -> shared timebase -> each length in whole ticks -> LCM -> total ticks ->
// whole frames. The shared timebase is the LCM of every length's denominator and the frame duration's,
// so every number in it is a whole number of ticks.

export interface Rational {
  num: bigint;
  den: bigint; // Always > 0, and the fraction is reduced
}

const abs = (a: bigint) => (a < 0n ? -a : a);

export const gcd = (a: bigint, b: bigint): bigint => {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

export const lcm = (a: bigint, b: bigint): bigint => (a === 0n || b === 0n ? 0n : abs((a / gcd(a, b)) * b));

export const lcmAll = (values: bigint[]): bigint => values.reduce((acc, v) => lcm(acc, v), 1n);

export const rat = (num: bigint | number, den: bigint | number = 1n): Rational => {
  let n = BigInt(num);
  let d = BigInt(den);
  if (d === 0n) throw new RangeError('Division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { num: n / g, den: d / g };
};

export const ratAdd = (a: Rational, b: Rational) => rat(a.num * b.den + b.num * a.den, a.den * b.den);
export const ratMul = (a: Rational, b: Rational) => rat(a.num * b.num, a.den * b.den);
export const ratDiv = (a: Rational, b: Rational) => rat(a.num * b.den, a.den * b.num);
export const ratEq = (a: Rational, b: Rational) => a.num === b.num && a.den === b.den;
export const ratToNumber = (a: Rational) => Number(a.num) / Number(a.den);
export const ratToString = (a: Rational) => (a.den === 1n ? `${a.num}` : `${a.num}/${a.den}`);

/** A decimal written as text ("2.5", "12.5", "3.333") as an exact fraction: 3.333 is 3333/1000, not 10/3. */
export const parseDecimal = (text: string): Rational => {
  const m = /^\s*(-?)(\d*)(?:[.,](\d*))?\s*$/.exec(text);
  if (!m || (!m[2] && !m[3])) throw new RangeError(`Not a number: ${text}`);
  const frac = m[3] ?? '';
  const n = BigInt((m[2] || '0') + frac) * (m[1] ? -1n : 1n);
  return rat(n, 10n ** BigInt(frac.length));
};

// Rates of the NTSC family are really k * 1000 / 1001, and are written rounded (23.976, 29.97, 59.94).
const NTSC_TOLERANCE = 0.01;

/**
 * A frame rate as an exact fraction. Accepts "30000/1001", "29.97", 29.97, "25" or 12.5.
 * Rates written as the rounded NTSC rates (23.976, 23.98, 29.97, 47.952, 59.94, 119.88) mean k*1000/1001,
 * so they are not rounded to 24, 30 or 60 and not taken literally either (29.97 is not 2997/100).
 */
export const parseFrameRate = (input: string | number): Rational => {
  const text = String(input).trim();
  let r: Rational;
  if (text.includes('/')) {
    const [a, b] = text.split('/');
    r = ratDiv(parseDecimal(a), parseDecimal(b));
  } else {
    r = typeof input === 'number' ? decimalOfNumber(input) : parseDecimal(text);
    if (r.den !== 1n) {
      const x = ratToNumber(r);
      const k = Math.round(x * 1.001);
      if (k > 0 && Math.abs(x * 1.001 - k) < NTSC_TOLERANCE && Math.abs(x - k) > NTSC_TOLERANCE) r = rat(BigInt(k) * 1000n, 1001n);
    }
  }
  if (r.num <= 0n) throw new RangeError(`Frame rate must be above 0: ${text}`);
  return r;
};

// The shortest decimal that prints as this number (29.97 -> 2997/100), so float input is read as written.
const decimalOfNumber = (x: number): Rational => {
  if (!Number.isFinite(x)) throw new RangeError(`Not a number: ${x}`);
  const s = x.toString();
  if (/e/i.test(s)) {
    const [m, e] = s.split(/e/i);
    const base = parseDecimal(m);
    const exp = BigInt(Math.abs(Number(e)));
    return Number(e) >= 0 ? ratMul(base, rat(10n ** exp)) : ratDiv(base, rat(10n ** exp));
  }
  return parseDecimal(s);
};

/** Length of `frames` frames at a constant rate: frames / fps (the last frame lasts one frame, like all others). */
export const durationFromFrames = (frames: bigint | number, fps: Rational): Rational => rat(BigInt(frames) * fps.den, fps.num);

/** Length from integer timestamps on a timescale: (last PTS + last frame's duration - first PTS) / timescale. */
export const durationFromPts = (p: { firstPts: bigint | number; lastPts: bigint | number; lastDuration: bigint | number; timescale: bigint | number }): Rational => {
  const ticks = BigInt(p.lastPts) + BigInt(p.lastDuration) - BigInt(p.firstPts);
  return rat(ticks, BigInt(p.timescale));
};

/**
 * A time in seconds that a decoder reported as a float, back as whole ticks of its time resolution.
 * The decoder made it as ticks / resolution, so rounding gives the exact whole number back.
 */
export const secondsToTicks = (seconds: number, resolution: number): bigint => BigInt(Math.round(seconds * resolution));

// --- The loop plan -------------------------------------------------------------------------------------

/** One video of an element. An element with a playlist plays several, one after another. */
export interface ClipTiming {
  duration: Rational | null; // null: the length could not be read
  resolution?: number; // Ticks per second of the video's own timestamps (time resolution / timescale)
  startTicks?: bigint; // First frame's PTS in those ticks (usually 0)
}

export interface LayerTiming {
  id: string;
  clips: ClipTiming[];
}

export interface LayerPlan {
  id: string;
  ticks: bigint; // One full cycle (all its clips) in shared ticks
  clipTicks: bigint[]; // Each clip in shared ticks
  loops: bigint; // Whole cycles in the export
  frames: Rational; // One cycle in export frames (whole unless a cycle ends between two frames)
}

export interface LoopPlan {
  ok: true;
  fps: Rational;
  timescale: bigint; // Shared ticks per second
  frameTicks: bigint; // One export frame in shared ticks
  totalTicks: bigint;
  frameCount: bigint;
  duration: Rational; // Seconds
  layers: LayerPlan[];
}

export type LoopPlanError =
  | { ok: false; reason: 'unknownDuration'; layerIds: string[] }
  | { ok: false; reason: 'invalidDuration'; layerIds: string[] }
  | { ok: false; reason: 'invalidFps' }
  | { ok: false; reason: 'tooLong'; frameCount: bigint; duration: Rational; maxSeconds: number };

export const DEFAULT_MAX_SECONDS = 600;

export interface LoopPlanOptions {
  fps: Rational;
  maxSeconds?: number;
  /** Length when no element has a video, rounded to whole frames. */
  emptySeconds?: Rational;
}

export const computeLoopPlan = (layers: LayerTiming[], opts: LoopPlanOptions): LoopPlan | LoopPlanError => {
  const { fps } = opts;
  const maxSeconds = opts.maxSeconds ?? DEFAULT_MAX_SECONDS;
  if (fps.num <= 0n || fps.den <= 0n) return { ok: false, reason: 'invalidFps' };

  const unknown = layers.filter(l => l.clips.length === 0 || l.clips.some(c => c.duration === null)).map(l => l.id);
  if (unknown.length) return { ok: false, reason: 'unknownDuration', layerIds: unknown };
  const invalid = layers.filter(l => l.clips.some(c => c.duration!.num <= 0n)).map(l => l.id);
  if (invalid.length) return { ok: false, reason: 'invalidDuration', layerIds: invalid };

  const frameDuration = rat(fps.den, fps.num);
  const durations = layers.map(l => l.clips.map(c => c.duration!));
  const timescale = lcmAll([frameDuration.den, ...durations.flat().map(d => d.den)]);
  const toTicks = (d: Rational) => (d.num * timescale) / d.den; // Exact: timescale is a multiple of d.den
  const frameTicks = toTicks(frameDuration);

  const plans = layers.map((l, i) => {
    const clipTicks = durations[i].map(toTicks);
    return { id: l.id, clipTicks, ticks: clipTicks.reduce((a, b) => a + b, 0n) };
  });

  let totalTicks: bigint;
  if (plans.length === 0) {
    // Nothing to fit: the chosen length, rounded to whole frames (at least one).
    const seconds = opts.emptySeconds ?? rat(10n);
    const exact = ratMul(seconds, fps);
    const frames = (exact.num * 2n + exact.den) / (exact.den * 2n);
    totalTicks = (frames < 1n ? 1n : frames) * frameTicks;
  } else {
    // Including the frame makes the total a whole number of frames as well as of every element's cycle.
    totalTicks = lcmAll([frameTicks, ...plans.map(p => p.ticks)]);
  }

  const frameCount = totalTicks / frameTicks;
  const duration = rat(totalTicks, timescale);
  // Compared as whole numbers, so a huge LCM never turns into Infinity or loses digits on the way.
  if (duration.num > BigInt(Math.floor(maxSeconds)) * duration.den) {
    return { ok: false, reason: 'tooLong', frameCount, duration, maxSeconds };
  }

  return {
    ok: true,
    fps,
    timescale,
    frameTicks,
    totalTicks,
    frameCount,
    duration,
    layers: plans.map(p => ({ ...p, loops: totalTicks / p.ticks, frames: rat(p.ticks, frameTicks) })),
  };
};

/** Shared ticks from the start of the loop to the start of export frame i (frame N wraps round to 0). */
export const frameStartTicks = (plan: LoopPlan, frame: bigint | number): bigint => (BigInt(frame) * plan.frameTicks) % plan.totalTicks;

/** Seconds into the loop at the start of export frame i, for effects (always in [0, loop length)). */
export const frameTime = (plan: LoopPlan, frame: bigint | number): number => Number(frameStartTicks(plan, frame)) / Number(plan.timescale);

/**
 * Which clip of an element shows at export frame i, and where in it, in shared ticks from the clip's start.
 * Every element restarts its cycle exactly when the previous one ends, so it only ever plays whole cycles.
 */
export const locateClip = (plan: LoopPlan, layerIndex: number, frame: bigint | number): { clip: number; offsetTicks: bigint; cycle: bigint } => {
  const lp = plan.layers[layerIndex];
  const at = BigInt(frame) * plan.frameTicks;
  const cycle = at / lp.ticks;
  let offset = at % lp.ticks;
  for (let c = 0; c < lp.clipTicks.length; c++) {
    if (offset < lp.clipTicks[c]) return { clip: c, offsetTicks: offset, cycle };
    offset -= lp.clipTicks[c];
  }
  return { clip: lp.clipTicks.length - 1, offsetTicks: offset, cycle }; // Unreachable: offset < sum of clips
};

/**
 * The time to ask the decoder for: the clip's first PTS plus the offset, floored to the clip's own ticks,
 * plus half a tick. Every PTS is a whole tick, so a float rounding error can never land the request on the
 * wrong side of a frame boundary. The decoder then shows the last frame whose PTS is at or before it.
 */
export const sourceQuerySeconds = (plan: LoopPlan, clip: ClipTiming, offsetTicks: bigint): number => {
  const resolution = clip.resolution && clip.resolution > 0 ? BigInt(Math.round(clip.resolution)) : plan.timescale;
  const own = (offsetTicks * resolution) / plan.timescale; // Floored
  const start = clip.startTicks ?? 0n;
  return (Number(start + own) + 0.5) / Number(resolution);
};

/** Index of the source frame shown at an offset, for a constant-rate clip (used by tests and the summary). */
export const sourceFrameAt = (plan: LoopPlan, offsetTicks: bigint, sourceFps: Rational): bigint =>
  (offsetTicks * sourceFps.num) / (plan.timescale * sourceFps.den);

/** A rough number of seconds for messages, without losing a huge value to Infinity. */
export const approxSeconds = (d: Rational): number => {
  const whole = d.num / d.den;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return Number(whole);
  return Number(whole) + Number(d.num % d.den) / Number(d.den);
};
