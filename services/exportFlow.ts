import { LoopCheck } from '../effects/loop';
import { Rational, parseFrameRate, ratEq } from './loopTiming';

// The export dialog's steps. Effects that cannot loop are a warning, never an error: the user can turn
// them off (or change them), ignore the warning and export anyway, or cancel.
//
//   review --export--> exporting                (no warnings)
//   review --export--> warning                  (some effects cannot loop)
//   warning --ignore--> exporting               ("Ignore and export")
//   warning --edit--> review                    (an effect was turned off; checked again)
//   warning|review --cancel--> closed
//   exporting --cancel--> review                (stops; nothing is saved)
//   exporting --finished--> done

export type ExportPhase = 'review' | 'warning' | 'exporting' | 'done' | 'closed';
export type ExportAction = 'export' | 'ignore' | 'edit' | 'cancel' | 'finished' | 'failed';

export const nextPhase = (phase: ExportPhase, action: ExportAction, check: Pick<LoopCheck, 'issues'> | null): ExportPhase => {
  switch (phase) {
    case 'review':
      if (action === 'export') return check && check.issues.length > 0 ? 'warning' : 'exporting';
      if (action === 'cancel') return 'closed';
      return phase;
    case 'warning':
      if (action === 'ignore') return 'exporting';
      if (action === 'edit') return check && check.issues.length > 0 ? 'warning' : 'review';
      if (action === 'cancel') return 'closed';
      return phase;
    case 'exporting':
      if (action === 'finished') return 'done';
      if (action === 'cancel' || action === 'failed') return 'review';
      return phase;
    case 'done':
      if (action === 'cancel') return 'closed';
      if (action === 'export') return nextPhase('review', 'export', check);
      return phase;
    default:
      return phase;
  }
};

/** Frame rates offered in the dialog. NTSC rates are exact fractions (29.97 = 30000/1001). */
export const FPS_CHOICES = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'];

/**
 * The frame rate the export uses when left on "automatic": the videos' own rate when they all share
 * one (so no frame is ever shown twice or skipped), otherwise 30.
 */
export const autoFrameRate = (rates: (Rational | null)[]): Rational => {
  const known = rates.filter((r): r is Rational => !!r);
  if (known.length > 0 && known.length === rates.length && known.every(r => ratEq(r, known[0]))) return known[0];
  return parseFrameRate(30);
};
