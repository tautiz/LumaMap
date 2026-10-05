import { describe, expect, it } from 'vitest';
import { autoFrameRate, nextPhase } from '../services/exportFlow';
import { parseFrameRate, rat } from '../services/loopTiming';

const warn = { issues: [{}] as any[] };
const clean = { issues: [] as any[] };

describe('export dialog steps', () => {
  it('with no warnings, export starts straight away', () => {
    expect(nextPhase('review', 'export', clean)).toBe('exporting');
  });

  it('effects that cannot loop show the warning first', () => {
    expect(nextPhase('review', 'export', warn)).toBe('warning');
  });

  it('"Ignore and export" carries on with the export', () => {
    expect(nextPhase('warning', 'ignore', warn)).toBe('exporting');
  });

  it('cancel from the warning closes the dialog without exporting', () => {
    expect(nextPhase('warning', 'cancel', warn)).toBe('closed');
    expect(nextPhase('review', 'cancel', clean)).toBe('closed');
  });

  it('turning the effects off clears the warning; leaving one keeps it', () => {
    expect(nextPhase('warning', 'edit', clean)).toBe('review');
    expect(nextPhase('warning', 'edit', warn)).toBe('warning');
  });

  it('stopping a running export goes back, nothing is saved', () => {
    expect(nextPhase('exporting', 'cancel', clean)).toBe('review');
    expect(nextPhase('exporting', 'failed', clean)).toBe('review');
    expect(nextPhase('exporting', 'finished', clean)).toBe('done');
    expect(nextPhase('exporting', 'export', clean)).toBe('exporting'); // No second export while one runs
  });

  it('a warning never blocks: every path from it can reach an export', () => {
    expect(nextPhase(nextPhase('review', 'export', warn), 'ignore', warn)).toBe('exporting');
  });
});

describe('automatic frame rate', () => {
  it("uses the videos' own rate when they share one", () => {
    expect(autoFrameRate([parseFrameRate('29.97'), parseFrameRate('29.97')])).toEqual(rat(30000n, 1001n));
    expect(autoFrameRate([parseFrameRate(24)])).toEqual(rat(24n));
  });

  it('falls back to 30 for mixed, unknown or no videos', () => {
    expect(autoFrameRate([parseFrameRate(24), parseFrameRate(30)])).toEqual(rat(30n));
    expect(autoFrameRate([parseFrameRate(24), null])).toEqual(rat(30n));
    expect(autoFrameRate([])).toEqual(rat(30n));
  });
});
