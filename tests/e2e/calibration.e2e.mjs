// End-to-end test of the wall photo calibration, in a real browser (Chromium via Playwright):
//
//   npm run test:e2e:calibration        (SHOTS=<folder> also saves screenshots of every step)
//
// A fake phone photo is made of the test pattern seen at an angle through a bending lens. The test goes
// through the dialog like a person would (upload, mark the four corners, straighten the lines) and checks
// that the projector window shows the pattern meanwhile and that afterwards the calibrated photo puts the
// pattern's coloured corners exactly in the projector picture's corners, in the editor and the projector window.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = process.env.SHOTS;
const shot = (p, name) => (out ? p.screenshot({ path: `${out}/${name}.png` }) : Promise.resolve());
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};
// Colour of a projector pixel (x, y) on a canvas that covers the projector picture.
const pixel = (p, selector, x, y) => p.evaluate(({ selector, x, y }) => {
  const c = document.querySelector(selector);
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(Math.floor(x * c.width / 2363), Math.floor(y * c.height / 1320), 1, 1).data;
  return [d[0], d[1], d[2]];
}, { selector, x, y });
const isRed = c => !!c && c[0] > 150 && c[1] < 110 && c[2] < 110;
const isGreen = c => !!c && c[1] > 120 && c[0] < 120 && c[2] < 140;
const PORT = 3124;
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => server.kill());
await new Promise((res) => server.stdout.on('data', d => { if (String(d).includes('Local')) res(); }));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0);
// Close welcome
await page.getByRole('button', { name: /Pradėk|Pradėti|Start/ }).first().click().catch(() => {});
const live = await ctx.newPage();
await live.goto(`http://localhost:${PORT}/?live=true`);

// Synthetic phone photo: the pattern seen at an angle with lens bend, on a grey wall.
const SEEN = [{ x: 420, y: 330 }, { x: 1610, y: 400 }, { x: 1560, y: 1150 }, { x: 470, y: 1230 }];
const LENS = -0.08;
const b64 = await page.evaluate(async ({ SEEN, LENS }) => {
  const C = await import('/utils/calibration.ts');
  const PW = 2363, PH = 1320, W = 2000, H = 1500;
  const pat = document.createElement('canvas'); pat.width = PW; pat.height = PH;
  C.drawCalibrationPattern(pat.getContext('2d'), PW, PH);
  const pd = pat.getContext('2d').getImageData(0, 0, PW, PH).data;
  const toProj = C.solveHomography(SEEN.map(p => C.straightenPoint(p, LENS, W, H)), C.projectorCorners(PW, PH));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); const img = cx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = C.applyHomography(toProj, C.straightenPoint({ x, y }, LENS, W, H));
    const i = (y * W + x) * 4;
    const wall = 60 + ((x >> 6) + (y >> 6)) % 2 * 15;
    if (q.x >= 0 && q.y >= 0 && q.x < PW && q.y < PH) {
      const j = ((q.y | 0) * PW + (q.x | 0)) * 4;
      img.data[i] = Math.max(wall + 20, pd[j]); img.data[i+1] = Math.max(wall + 20, pd[j+1]); img.data[i+2] = Math.max(wall + 20, pd[j+2]);
    } else { img.data[i] = wall; img.data[i+1] = wall; img.data[i+2] = wall - 5; }
    img.data[i+3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}, { SEEN, LENS });
const photo = Buffer.from(b64, 'base64');

await page.getByRole('button', { name: 'Nufotografuoti su kalibravimo šablonu' }).click();
await page.waitForTimeout(500);
await shot(page, '1-pattern-step');
await live.waitForTimeout(500);
await shot(live, '1-live-pattern');
check(isRed(await pixel(live, 'main canvas', 15, 90)), 'the projector window shows the test pattern while calibrating');
await page.locator('[role=dialog] input[type=file]').setInputFiles({ name: 'wall.jpg', mimeType: 'image/jpeg', buffer: photo });
await page.waitForTimeout(800);
await shot(page, '2-corners-default');
// Place corners by choosing a number and clicking where the corner is.
const area = page.locator('[role=dialog] .touch-none');
const box = await area.boundingBox();
const scale = Math.min(box.width / 2000, box.height / 1500);
const ox = (box.width - 2000 * scale) / 2, oy = (box.height - 1500 * scale) / 2;
for (let i = 0; i < 4; i++) {
  await page.locator(`[role=dialog] button[title]`).nth(i).click();
  await page.mouse.click(box.x + ox + SEEN[i].x * scale, box.y + oy + SEEN[i].y * scale);
}
await page.mouse.move(box.x + ox + SEEN[2].x * scale, box.y + oy + SEEN[2].y * scale);
await shot(page, '3-corners-placed');
await page.getByRole('button', { name: 'Toliau', exact: true }).click();
await page.waitForTimeout(1500);
await shot(page, '4-check-lens0');
await page.locator('[role=dialog] input[type=range]').fill(String(LENS));
await page.waitForTimeout(1500);
await shot(page, '5-check-lens');
await page.getByRole('button', { name: 'Baigti kalibravimą' }).click();
await page.waitForTimeout(1500);
await shot(page, '6-editor-calibrated');
const photoCanvas = 'main canvas.opacity-50';
check(isRed(await pixel(page, photoCanvas, 15, 90)), 'editor: the photo\'s red corner lands in the top left corner');
check(isGreen(await pixel(page, photoCanvas, 2363 - 15, 1320 - 90)), 'editor: the photo\'s green corner lands in the bottom right corner');
check(!isRed(await pixel(page, 'main canvas:not(.opacity-50)', 15, 90)), 'editor: the test pattern is gone after calibrating');
await page.getByRole('button', { name: 'Rodyti nuotrauką pasirodyme' }).click();
await live.waitForTimeout(1500);
await shot(live, '7-live-calibrated');
check(isRed(await pixel(live, photoCanvas, 15, 90)) && isGreen(await pixel(live, photoCanvas, 2363 - 15, 1320 - 90)), 'projector window: the calibrated photo is the same');
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
