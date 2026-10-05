import { describe, expect, it } from 'vitest';
import {
  applyHomography, bendPoint, cornersUsable, invertHomography, projectorCorners, projectorToPhoto,
  solveHomography, straightenPoint, warpPhoto,
} from '../utils/calibration';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

// A projector picture seen at an angle on the photo (a keystoned four-sided shape).
const photo = { w: 4000, h: 3000 };
const projector = { w: 1920, h: 1080 };
const seen = [{ x: 610, y: 420 }, { x: 3420, y: 530 }, { x: 3300, y: 2480 }, { x: 700, y: 2610 }];

describe('perspective', () => {
  it('carries each corner exactly onto its partner', () => {
    const m = solveHomography(projectorCorners(projector.w, projector.h), seen)!;
    projectorCorners(projector.w, projector.h).forEach((c, i) => close(applyHomography(m, c), seen[i]));
  });

  it('the inverse goes back', () => {
    const m = solveHomography(projectorCorners(projector.w, projector.h), seen)!;
    const back = invertHomography(m)!;
    const p = { x: 812, y: 333 };
    close(applyHomography(back, applyHomography(m, p)), p);
  });

  it('keeps straight lines straight: the middle of the picture is where the diagonals cross', () => {
    const m = solveHomography(projectorCorners(projector.w, projector.h), seen)!;
    const c = applyHomography(m, { x: projector.w / 2, y: projector.h / 2 });
    // Diagonals seen[0]-seen[2] and seen[1]-seen[3] both pass through c.
    const onLine = (a: any, b: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(Math.abs(onLine(seen[0], seen[2]))).toBeLessThan(1e-3);
    expect(Math.abs(onLine(seen[1], seen[3]))).toBeLessThan(1e-3);
  });

  it('refuses corners with three in a line', () => {
    const flat = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }];
    expect(cornersUsable(flat)).toBe(false);
    expect(cornersUsable(seen)).toBe(true);
    // Corners marked in the wrong order make a twisted bow-tie shape.
    expect(cornersUsable([seen[0], seen[2], seen[1], seen[3]])).toBe(false);
  });
});

describe('lens bend', () => {
  it('leaves the centre alone and moves the edges', () => {
    close(bendPoint({ x: 2000, y: 1500 }, 0.1, photo.w, photo.h), { x: 2000, y: 1500 });
    const corner = bendPoint({ x: 4000, y: 3000 }, 0.1, photo.w, photo.h);
    close(corner, { x: 2000 + 2000 * 1.1, y: 1500 + 1500 * 1.1 });
  });

  it('straightening undoes bending', () => {
    for (const lens of [-0.25, -0.05, 0.05, 0.25]) {
      const p = { x: 3500, y: 400 };
      close(straightenPoint(bendPoint(p, lens, photo.w, photo.h), lens, photo.w, photo.h), p, 4);
    }
  });

  it('marked corners still land exactly on the projector corners with a lens correction', () => {
    const map = projectorToPhoto({ corners: seen, lens: 0.12 }, photo, projector)!;
    projectorCorners(projector.w, projector.h).forEach((c, i) => close(map(c), seen[i], 3));
  });
});

describe('warping the photo', () => {
  // ImageData is a browser type; a plain object with the same fields is enough here.
  const image = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData;

  it('fills the projector picture with the marked part of the photo', () => {
    // Photo: left half red, right half blue. The projector covers the middle of it.
    const src = image(100, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      const i = (y * 100 + x) * 4;
      src.data[i] = x < 50 ? 255 : 0;
      src.data[i + 2] = x < 50 ? 0 : 255;
      src.data[i + 3] = 255;
    }
    const out = image(40, 20);
    const ok = warpPhoto(src, { w: 100, h: 100 }, { corners: [{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 50 }, { x: 30, y: 50 }], lens: 0 }, { w: 40, h: 20 }, out);
    expect(ok).toBe(true);
    const at = (x: number, y: number) => Array.from(out.data.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    expect(at(2, 10)).toEqual([255, 0, 0, 255]);
    expect(at(37, 10)).toEqual([0, 0, 255, 255]);
  });

  it('leaves the projector area transparent where the photo does not reach', () => {
    const src = image(10, 10);
    src.data.fill(255);
    const out = image(10, 10);
    warpPhoto(src, { w: 10, h: 10 }, { corners: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }], lens: 0 }, { w: 10, h: 10 }, out);
    expect(out.data[(1 * 10 + 1) * 4 + 3]).toBe(255);
    expect(out.data[(8 * 10 + 8) * 4 + 3]).toBe(0);
  });
});

describe('saving', () => {
  it('the show file keeps the calibration', async () => {
    const { exportShowFile, parseShowFile } = await import('../services/projectStore');
    const calibration = { corners: seen, lens: -0.08 };
    const blob = exportShowFile({
      layers: [], backgroundFile: new Blob(['photo'], { type: 'image/jpeg' }), backgroundTransform: { x: 0, y: 0, k: 1 },
      backgroundCalibration: calibration, showBackgroundInLive: false, projectorSize: projector,
    });
    const back = parseShowFile(await blob.arrayBuffer());
    expect(back.backgroundCalibration).toEqual(calibration);
  });

  it('older show files open without a calibration', async () => {
    const { exportShowFile, parseShowFile } = await import('../services/projectStore');
    const blob = exportShowFile({ layers: [], backgroundFile: null, backgroundTransform: { x: 0, y: 0, k: 1 }, showBackgroundInLive: false, projectorSize: projector });
    expect(parseShowFile(await blob.arrayBuffer()).backgroundCalibration).toBeNull();
  });
});
