import { describe, expect, it } from 'vitest';
import {
  LayerTiming, LoopPlan, LoopPlanError, computeLoopPlan, durationFromFrames, durationFromPts, frameStartTicks, frameTime, gcd, lcm, lcmAll,
  locateClip, parseDecimal, parseFrameRate, rat, ratEq, secondsToTicks, sourceFrameAt, sourceQuerySeconds,
} from '../services/loopTiming';

const fps = parseFrameRate;
const sec = (s: string) => parseDecimal(s);
const layer = (id: string, ...durations: (ReturnType<typeof rat> | null)[]): LayerTiming => ({ id, clips: durations.map(duration => ({ duration })) });
const plan = (layers: LayerTiming[], f: string | number, extra = {}) => {
  const p = computeLoopPlan(layers, { fps: fps(f), ...extra });
  if (p.ok !== true) throw new Error(`plan failed: ${(p as LoopPlanError).reason}`);
  return p as LoopPlan;
};
// Plain casts: the project does not use strict null checks, so `ok` does not narrow the union by itself.
const tooLong = (p: LoopPlan | LoopPlanError) => {
  if (p.ok === true || (p as LoopPlanError).reason !== 'tooLong') throw new Error('expected tooLong');
  return p as Extract<LoopPlanError, { reason: 'tooLong' }>;
};
const framesOf = (p: LoopPlan) => p.layers.map(l => l.frames);

describe('whole-number helpers', () => {
  it('gcd and lcm', () => {
    expect(gcd(300n, 150n)).toBe(150n);
    expect(lcm(300n, 150n)).toBe(300n);
    expect(lcmAll([300n, 150n, 450n])).toBe(900n);
    expect(lcm(0n, 5n)).toBe(0n);
  });

  it('fractions are kept reduced', () => {
    expect(rat(150n, 60n)).toEqual({ num: 5n, den: 2n });
    expect(rat(3, -6)).toEqual({ num: -1n, den: 2n });
    expect(() => rat(1, 0)).toThrow();
  });
});

describe('frame rates', () => {
  it('reads NTSC rates as k*1000/1001, not rounded and not literal', () => {
    expect(fps('23.976')).toEqual(rat(24000n, 1001n));
    expect(fps('23.98')).toEqual(rat(24000n, 1001n));
    expect(fps('29.97')).toEqual(rat(30000n, 1001n));
    expect(fps(29.97)).toEqual(rat(30000n, 1001n));
    expect(fps('59.94')).toEqual(rat(60000n, 1001n));
    expect(fps(30000 / 1001)).toEqual(rat(30000n, 1001n));
  });

  it('reads plain and fractional rates exactly', () => {
    expect(fps('30')).toEqual(rat(30n));
    expect(fps(24)).toEqual(rat(24n));
    expect(fps('12.5')).toEqual(rat(25n, 2n));
    expect(fps('30000/1001')).toEqual(rat(30000n, 1001n));
    expect(() => fps('0')).toThrow();
  });
});

describe('durations', () => {
  it('2.5 s is 75 frames at 30 fps', () => {
    const p = plan([layer('a', sec('2.5'))], 30);
    expect(p.layers[0].frames).toEqual(rat(75n));
    expect(p.frameCount).toBe(75n);
  });

  it('frame count and duration: N frames last N / fps, the last frame is not extra time', () => {
    expect(durationFromFrames(240, fps(24))).toEqual(rat(10n));
    expect(durationFromFrames(150, fps(30))).toEqual(rat(5n));
    expect(durationFromFrames(240, fps('23.976'))).toEqual(rat(1001n, 100n)); // 10.01 s
  });

  it('PTS: last PTS + last frame duration - first PTS, never last PTS alone', () => {
    // 30 frames at 30 fps on a 90 kHz timescale: PTS 0, 3000, ... 87000, each 3000 long
    expect(durationFromPts({ firstPts: 0, lastPts: 87000, lastDuration: 3000, timescale: 90000 })).toEqual(rat(1n));
    // The same video starting at a non-zero PTS (e.g. after an edit list) has the same length
    expect(durationFromPts({ firstPts: 6000, lastPts: 93000, lastDuration: 3000, timescale: 90000 })).toEqual(rat(1n));
    // 29.97 fps on its usual 30000 timescale: 300 frames of 1001 ticks
    expect(durationFromPts({ firstPts: 0, lastPts: 299 * 1001, lastDuration: 1001, timescale: 30000 })).toEqual(rat(1001n, 100n));
  });

  it('turns decoder float seconds back into whole ticks', () => {
    expect(secondsToTicks(299 * 1001 / 30000, 30000)).toBe(299n * 1001n);
    expect(secondsToTicks(0.1 + 0.2, 10)).toBe(3n);
  });

  it('non-whole lengths are exact fractions', () => {
    expect(sec('7.5')).toEqual(rat(15n, 2n));
    expect(sec('12.5')).toEqual(rat(25n, 2n));
    expect(sec('1.25')).toEqual(rat(5n, 4n));
    expect(sec('3.333')).toEqual(rat(3333n, 1000n));
    expect(sec('2,5')).toEqual(rat(5n, 2n));
  });
});

describe('loop length (LCM)', () => {
  it('LCM(300, 150) = 300 frames at 30 fps', () => {
    const p = plan([layer('a', rat(10n)), layer('b', rat(5n))], 30);
    expect(framesOf(p)).toEqual([rat(300n), rat(150n)]);
    expect(p.frameCount).toBe(300n);
    expect(p.layers.map(l => l.loops)).toEqual([1n, 2n]);
  });

  it('LCM(300, 150, 450) = 900 frames = 30 s, loops 3, 6, 2', () => {
    const p = plan([layer('a', rat(10n)), layer('b', rat(5n)), layer('c', rat(15n))], 30);
    expect(p.frameCount).toBe(900n);
    expect(p.duration).toEqual(rat(30n));
    expect(p.layers.map(l => l.loops)).toEqual([3n, 6n, 2n]);
  });

  it('one element, and several with the same length', () => {
    expect(plan([layer('a', rat(4n))], 30).frameCount).toBe(120n);
    const same = plan([layer('a', rat(4n)), layer('b', rat(4n)), layer('c', rat(4n))], 30);
    expect(same.frameCount).toBe(120n);
    expect(same.layers.every(l => l.loops === 1n)).toBe(true);
  });

  it('different source rates are converted to the export timebase before the LCM', () => {
    // A: 240 frames at 24 fps = 10 s; B: 150 frames at 30 fps = 5 s; export 30 fps
    const p = plan([layer('a', durationFromFrames(240, fps(24))), layer('b', durationFromFrames(150, fps(30)))], 30);
    expect(framesOf(p)).toEqual([rat(300n), rat(150n)]);
    expect(p.frameCount).toBe(300n);
    expect(p.duration).toEqual(rat(10n));
  });

  it('24 fps source into a 30 fps export', () => {
    // 36 frames at 24 fps = 1.5 s = 45 export frames
    const p = plan([layer('a', durationFromFrames(36, fps(24)))], 30);
    expect(p.frameCount).toBe(45n);
  });

  it('23.976 fps source: 240 frames are 10.01 s, not 10 s', () => {
    const d = durationFromFrames(240, fps('23.976'));
    const ntsc = plan([layer('a', d)], '29.97');
    expect(ntsc.frameCount).toBe(300n); // 10.01 s at 29.97 is exactly 300 frames
    expect(ntsc.duration).toEqual(rat(1001n, 100n));
    // At a plain 30 fps a 10.01 s cycle ends between two frames: the smallest whole loop is 10 cycles.
    const plain = plan([layer('a', d)], 30);
    expect(plain.layers[0].frames).toEqual(rat(3003n, 10n));
    expect(plain.frameCount).toBe(3003n);
    expect(plain.layers[0].loops).toBe(10n);
  });

  it('29.97 fps sources', () => {
    const p = plan([layer('a', durationFromFrames(300, fps('29.97'))), layer('b', durationFromFrames(150, fps('29.97')))], '29.97');
    expect(framesOf(p)).toEqual([rat(300n), rat(150n)]);
    expect(p.frameCount).toBe(300n);
    expect(p.timescale % 30000n).toBe(0n);
  });

  it('59.94 fps sources', () => {
    const p = plan([layer('a', durationFromFrames(120, fps('59.94'))), layer('b', durationFromFrames(180, fps('59.94')))], '59.94');
    expect(p.frameCount).toBe(360n);
    expect(p.layers.map(l => l.loops)).toEqual([3n, 2n]);
  });

  it('mixed NTSC and whole rates stay exact', () => {
    // 1.001 s (24 frames at 23.976) and 2.002 s (48 frames), exported at 29.97: frame = 1001/30000 s
    const p = plan([layer('a', durationFromFrames(24, fps('23.976'))), layer('b', durationFromFrames(48, fps('23.976')))], '29.97');
    // LCM(1.001, 2.002) = 2.002 s = 60 frames at 29.97
    expect(p.duration).toEqual(rat(1001n, 500n));
    expect(p.frameCount).toBe(60n);
    expect(p.layers.map(l => l.loops)).toEqual([2n, 1n]);
  });

  it('non-whole lengths: 2.5, 7.5, 12.5, 1.25 s', () => {
    const p = plan(['2.5', '7.5', '12.5', '1.25'].map((s, i) => layer(`l${i}`, sec(s))), 30);
    // LCM(2.5, 7.5, 12.5, 1.25) = 37.5 s
    expect(p.duration).toEqual(rat(75n, 2n));
    expect(p.frameCount).toBe(1125n);
    expect(p.layers.map(l => l.loops)).toEqual([15n, 5n, 3n, 30n]);
  });

  it('3.333 s is 3333/1000 s, not 10/3', () => {
    const p = plan([layer('a', sec('3.333'))], 30);
    // 3.333 s = 99.99 frames: the loop is 100 cycles = 333.3 s = 9999 frames
    expect(p.frameCount).toBe(9999n);
    expect(p.layers[0].loops).toBe(100n);
    expect(p.duration).toEqual(rat(3333n, 10n));
  });

  it('very short elements still play only whole cycles', () => {
    const p = plan([layer('a', durationFromFrames(1, fps(24))), layer('b', durationFromFrames(2, fps(30)))], 30);
    // 1/24 s and 1/15 s: LCM = 1/3 s = 10 frames; 8 and 5 cycles
    expect(p.frameCount).toBe(10n);
    expect(p.layers.map(l => l.loops)).toEqual([8n, 5n]);
  });

  it('a playlist is one cycle of all its videos one after another', () => {
    const p = plan([{ id: 'pl', clips: [{ duration: rat(2n) }, { duration: sec('1.5') }] }, layer('b', rat(1n))], 30);
    expect(p.layers[0].ticks).toBe(p.layers[0].clipTicks[0] + p.layers[0].clipTicks[1]);
    // One cycle is 3.5 s; LCM(3.5, 1) = 7 s
    expect(p.duration).toEqual(rat(7n));
    expect(p.layers.map(l => l.loops)).toEqual([2n, 7n]);
  });

  it('every loop count is whole and every element fills the export exactly', () => {
    const lengths = ['1', '2.5', '3.2', '0.4', '6'];
    for (const f of ['24', '25', '30', '29.97', '59.94', '23.976']) {
      const p = plan(lengths.map((s, i) => layer(`l${i}`, sec(s))), f, { maxSeconds: 1e9 });
      for (const l of p.layers) {
        expect(p.totalTicks % l.ticks).toBe(0n);
        expect(l.loops * l.ticks).toBe(p.totalTicks);
      }
      expect(p.totalTicks % p.frameTicks).toBe(0n);
      expect(p.frameCount * p.frameTicks).toBe(p.totalTicks);
    }
  });
});

describe('limits and errors', () => {
  it('no video: the chosen length in whole frames', () => {
    const p = plan([], 30, { emptySeconds: rat(10n) });
    expect(p.frameCount).toBe(300n);
    expect(p.layers).toEqual([]);
    expect(plan([], '29.97', { emptySeconds: rat(10n) }).frameCount).toBe(300n); // 299.7 rounds to 300
    expect(plan([], 30, { emptySeconds: rat(0n) }).frameCount).toBe(1n);
  });

  it('a video whose length could not be read is reported, not guessed', () => {
    const p = computeLoopPlan([layer('a', rat(5n)), layer('b', null)], { fps: fps(30) });
    expect(p).toEqual({ ok: false, reason: 'unknownDuration', layerIds: ['b'] });
  });

  it('zero or negative lengths are refused', () => {
    const p = computeLoopPlan([layer('a', rat(0n))], { fps: fps(30) });
    expect(p).toMatchObject({ ok: false, reason: 'invalidDuration', layerIds: ['a'] });
  });

  it('an impractically long loop is refused with its length', () => {
    // 10 s and 10.01 s: LCM = 10010 s (almost 3 hours), over the 10 minute limit
    const p = tooLong(computeLoopPlan([layer('a', rat(10n)), layer('b', sec('10.01'))], { fps: fps(30) }));
    expect(p.duration).toEqual(rat(10010n));
    expect(p.frameCount).toBe(300300n);
  });

  it('a huge LCM stays exact (no overflow) and is refused', () => {
    // Lengths with large co-prime denominators: the LCM is far beyond 2^53 and 2^64
    const primes = [1000003n, 1000033n, 1000037n, 1000039n, 1000081n, 1000099n];
    const p = tooLong(computeLoopPlan(primes.map((q, i) => layer(`p${i}`, rat(q, 1000n))), { fps: fps(30) }));
    expect(p.frameCount > 2n ** 64n).toBe(true);
    const product = primes.reduce((a, b) => a * b, 1n);
    // LCM(q1/1000, ..., 1/30) = q1*...*q6 / gcd(1000, 30)
    expect(p.duration).toEqual(rat(product, 10n));
  });

  it('the limit is configurable', () => {
    expect(computeLoopPlan([layer('a', rat(10n)), layer('b', sec('10.01'))], { fps: fps(30), maxSeconds: 10010 }).ok).toBe(true);
    expect(computeLoopPlan([layer('a', rat(700n))], { fps: fps(30) }).ok).toBe(false);
  });
});

describe('frame boundaries', () => {
  const p = plan([layer('a', durationFromFrames(36, fps(24))), layer('b', durationFromFrames(20, fps(30)))], 30);

  it('frame N is frame 0 of the next loop: no extra and no missing frame', () => {
    expect(p.frameCount).toBe(180n);
    expect(frameStartTicks(p, p.frameCount)).toBe(0n);
    expect(frameTime(p, 0)).toBe(0);
    expect(frameTime(p, p.frameCount - 1n)).toBeLessThan(Number(p.duration.num) / Number(p.duration.den));
    for (let i = 0; i < p.layers.length; i++) {
      const first = locateClip(p, i, 0);
      const next = locateClip(p, i, p.frameCount);
      expect(next.offsetTicks).toBe(first.offsetTicks);
      expect(next.cycle).toBe(p.layers[i].loops); // Exactly `loops` cycles were completed
    }
  });

  it('every source frame of every cycle is shown in order, and cycles restart at frame 0', () => {
    const sources = [fps(24), fps(30)];
    const sourceFrames = [36n, 20n];
    for (let li = 0; li < 2; li++) {
      let prevFrame = -1n;
      let restarts = 0;
      for (let i = 0n; i < p.frameCount; i++) {
        const { offsetTicks } = locateClip(p, li, i);
        const f = sourceFrameAt(p, offsetTicks, sources[li]);
        expect(f >= 0n && f < sourceFrames[li]).toBe(true);
        if (f < prevFrame) restarts++;
        prevFrame = f;
      }
      // The seam (last frame -> first frame) is the last restart
      const lastShown = sourceFrameAt(p, locateClip(p, li, p.frameCount - 1n).offsetTicks, sources[li]);
      expect(sourceFrameAt(p, locateClip(p, li, 0).offsetTicks, sources[li])).toBe(0n);
      expect(lastShown).toBeGreaterThan(sourceFrameAt(p, locateClip(p, li, p.frameCount - 2n).offsetTicks, sources[li]) - 1n);
      expect(restarts + 1).toBe(Number(p.layers[li].loops));
    }
  });

  it('the same-rate export shows each source frame exactly once per cycle', () => {
    const q = plan([layer('a', durationFromFrames(30, fps(30)))], 30);
    const seen = [...Array(Number(q.frameCount)).keys()].map(i => sourceFrameAt(q, locateClip(q, 0, i).offsetTicks, fps(30)));
    expect(seen).toEqual([...Array(30).keys()].map(BigInt));
  });

  it('decoder requests sit half a tick past the frame boundary, so float error cannot pick a neighbour', () => {
    const q = plan([layer('a', durationFromFrames(300, fps('29.97')))], '29.97');
    const clip = { duration: q.layers[0].frames, resolution: 30000, startTicks: 0n };
    for (const i of [0n, 1n, 2n, 150n, 299n]) {
      const t = sourceQuerySeconds(q, clip, locateClip(q, 0, i).offsetTicks);
      const framePts = (Number(i) * 1001) / 30000;
      expect(t).toBeGreaterThan(framePts);
      expect(t).toBeLessThan(framePts + 1 / 30000);
    }
    // A clip whose first PTS is not 0 is asked from that PTS on
    const shifted = sourceQuerySeconds(q, { ...clip, startTicks: 2002n }, 0n);
    expect(shifted).toBeCloseTo(2002.5 / 30000, 12);
  });

  it('playlists switch clips at the exact boundary', () => {
    const q = plan([{ id: 'pl', clips: [{ duration: rat(1n) }, { duration: rat(1n, 2n) }] }], 30);
    expect(locateClip(q, 0, 29)).toMatchObject({ clip: 0 });
    expect(locateClip(q, 0, 30)).toMatchObject({ clip: 1, offsetTicks: 0n });
    expect(locateClip(q, 0, 44)).toMatchObject({ clip: 1 });
    expect(locateClip(q, 0, 45)).toMatchObject({ clip: 0, offsetTicks: 0n, cycle: 1n });
  });

  it('lengths that are not exact in binary floats are exact here', () => {
    // 0.1 s and 0.3 s are 3 and 9 frames at 30 fps; as floats 0.1 + 0.2 is not even 0.3
    const q = plan([layer('a', sec('0.1')), layer('b', sec('0.3'))], 30);
    expect(framesOf(q)).toEqual([rat(3n), rat(9n)]);
    expect(q.frameCount).toBe(9n);
    expect(q.layers.map(l => l.loops)).toEqual([3n, 1n]);
  });
});
