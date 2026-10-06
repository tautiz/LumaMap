import { describe, expect, it } from 'vitest';
import { detectProjection, toGray } from '../utils/autoCalibrate';
import { applyHomography, projectorCorners, solveHomography, straightenPoint } from '../utils/calibration';

// A fake phone frame: the room (with a bright lamp spot that is lit in both frames), and, when `lit`,
// the projector picture seen at an angle through a lens that bends lines by `lens`.
const W = 1600, H = 1200;
const frame = (seen: { x: number; y: number }[], lens: number, lit: boolean) => {
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) } as ImageData;
  const toProj = solveHomography(seen.map(p => straightenPoint(p, lens, W, H)), projectorCorners(1, 1))!;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v = 70 + ((x >> 5) + (y >> 5)) % 2 * 20; // Patterned wall
      if (Math.hypot(x - 1450, y - 150) < 60) v = 250; // A lamp, bright in both frames
      if (lit) {
        const q = applyHomography(toProj, straightenPoint({ x: x + 0.5, y: y + 0.5 }, lens, W, H));
        if (q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1) v = Math.min(255, v + 120);
      }
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return img;
};

const run = (seen: { x: number; y: number }[], lens: number) =>
  detectProjection(toGray(frame(seen, lens, true)), toGray(frame(seen, lens, false)), W, H);

describe('finding the projector picture on camera frames', () => {
  const seen = [{ x: 260, y: 210 }, { x: 1330, y: 280 }, { x: 1290, y: 990 }, { x: 300, y: 1060 }];

  it('finds the four corners of a keystoned picture', () => {
    const r = run(seen, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.calibration.corners.forEach((c, i) => {
      expect(Math.abs(c.x - seen[i].x)).toBeLessThan(4);
      expect(Math.abs(c.y - seen[i].y)).toBeLessThan(4);
    });
    expect(Math.abs(r.calibration.lens)).toBeLessThan(0.02);
  });

  it('works out the lens bend and still finds the corners', () => {
    for (const lens of [-0.1, 0.08]) {
      const r = run(seen, lens);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.calibration.lens).toBeCloseTo(lens, 1);
      r.calibration.corners.forEach((c, i) => {
        expect(Math.abs(c.x - seen[i].x)).toBeLessThan(5);
        expect(Math.abs(c.y - seen[i].y)).toBeLessThan(5);
      });
    }
  });

  it('says so when the projector light is not in the frames', () => {
    const dark = toGray(frame(seen, 0, false));
    expect(detectProjection(dark, dark, W, H)).toEqual({ ok: false, reason: 'noLight' });
  });

  it('says so when the picture runs off the frame', () => {
    const cut = [{ x: -100, y: 210 }, { x: 1330, y: 280 }, { x: 1290, y: 990 }, { x: -60, y: 1060 }];
    expect(run(cut, 0)).toEqual({ ok: false, reason: 'edge' });
  });
});
