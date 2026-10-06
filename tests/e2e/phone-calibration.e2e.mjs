// End-to-end test of calibrating the wall photo with a phone camera, in a real browser (Chromium via Playwright):
//
//   npm run test:e2e:phone        (SHOTS=<folder> also saves screenshots)
//
// Three pages: the editor, the projector window (?live) and the phone page (?camera, from the QR code).
// They meet through a PeerJS server started here. The phone's camera is faked: it "films" the wall as a
// real phone would, seen at an angle through a bending lens, lit by whatever the projector window is
// showing at that moment (white, black or the pattern). The wall has a red sticker exactly where the
// projector picture's top left corner falls and a green one at the bottom right. The phone presses
// "Calibrate"; afterwards the stickers on the calibrated wall photo must sit in the projector picture's corners.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PeerServer } from 'peer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = process.env.SHOTS;
const shot = (p, name) => (out ? p.screenshot({ path: `${out}/${name}.png` }) : Promise.resolve());
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

const PEER_PORT = 9124;
const peerServer = PeerServer({ host: '127.0.0.1', port: PEER_PORT, path: '/' });
const PORT = 3125;
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => server.kill());
await new Promise((res, rej) => {
  server.stdout.on('data', d => { if (String(d).includes('Local')) res(); });
  setTimeout(() => rej(new Error('vite did not start')), 30000);
});

// Where the projector picture falls on the fake phone frames, and how the fake lens bends.
const CAM = { w: 1280, h: 960 };
const SEEN = [{ x: 205, y: 170 }, { x: 1080, y: 215 }, { x: 1050, y: 790 }, { x: 235, y: 845 }];
const LENS = -0.07;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const base = `http://localhost:${PORT}/`;
const peer = `peer=127.0.0.1:${PEER_PORT}`;
try {
  const editor = await ctx.newPage();
  editor.on('pageerror', e => console.error('editor error:', e));
  await editor.goto(`${base}?${peer}`);
  await editor.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0);
  await editor.getByRole('button', { name: /Pradėk|Pradėti|Start/ }).first().click().catch(() => {});
  const live = await ctx.newPage();
  await live.goto(`${base}?live=true`);

  await editor.getByRole('button', { name: 'Nufotografuoti su kalibravimo šablonu' }).click();
  const qr = editor.locator('[data-camera-url]');
  await qr.waitFor({ timeout: 20000 });
  const cameraUrl = await qr.getAttribute('data-camera-url');
  check(cameraUrl.startsWith(base) && cameraUrl.includes('camera=') && cameraUrl.includes(peer.replace(':', '%3A')), `QR code opens the camera page (${cameraUrl})`);
  await shot(editor, 'phone-1-qr');

  // --- The phone, with a fake camera ---
  const phone = await ctx.newPage();
  phone.on('pageerror', e => console.error('phone error:', e));
  await phone.addInitScript(({ CAM, SEEN, LENS }) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const C = await import('/utils/calibration.ts');
      const PW = 2363, PH = 1320;
      const pat = document.createElement('canvas');
      pat.width = PW; pat.height = PH;
      C.drawCalibrationPattern(pat.getContext('2d'), PW, PH);
      const pd = pat.getContext('2d').getImageData(0, 0, PW, PH).data;
      const toProj = C.solveHomography(SEEN.map(p => C.straightenPoint(p, LENS, CAM.w, CAM.h)), C.projectorCorners(PW, PH));
      const views = {};
      for (const view of ['black', 'white', 'pattern']) {
        const c = document.createElement('canvas');
        c.width = CAM.w; c.height = CAM.h;
        const cx = c.getContext('2d');
        const img = cx.createImageData(CAM.w, CAM.h);
        for (let y = 0; y < CAM.h; y++) for (let x = 0; x < CAM.w; x++) {
          const i = (y * CAM.w + x) * 4;
          let r = 95 + ((x >> 5) + (y >> 5)) % 2 * 25, g = r, b = r - 10; // Lit room, patterned wall
          // Stickers on the wall at the projector picture's top left and bottom right corners.
          if (Math.hypot(x - SEEN[0].x, y - SEEN[0].y) < 14) { r = 230; g = 30; b = 30; }
          if (Math.hypot(x - SEEN[2].x, y - SEEN[2].y) < 14) { r = 30; g = 200; b = 60; }
          const q = C.applyHomography(toProj, C.straightenPoint({ x: x + 0.5, y: y + 0.5 }, LENS, CAM.w, CAM.h));
          if (view !== 'black' && q.x >= 0 && q.y >= 0 && q.x < PW && q.y < PH) {
            const j = ((q.y | 0) * PW + (q.x | 0)) * 4;
            const add = view === 'white' ? [150, 150, 150] : [pd[j] * 0.6, pd[j + 1] * 0.6, pd[j + 2] * 0.6];
            r += add[0]; g += add[1]; b += add[2];
          }
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
        views[view] = c;
      }
      // The camera sees what the projector window shows.
      let showing = 'black';
      new BroadcastChannel('lumamap_sync_v2').onmessage = e => {
        if (e.data?.type === 'SYNC') showing = e.data.payload.calibrationPattern || 'black';
      };
      const out = document.createElement('canvas');
      out.width = CAM.w; out.height = CAM.h;
      const octx = out.getContext('2d');
      const draw = () => { octx.drawImage(views[showing], 0, 0); requestAnimationFrame(draw); };
      draw();
      return out.captureStream(30);
    };
  }, { CAM, SEEN, LENS });
  await phone.setViewportSize({ width: 400, height: 800 });
  await phone.goto(cameraUrl);
  await phone.getByRole('button', { name: 'Kalibruoti' }).waitFor({ timeout: 30000 });
  check(await editor.getByText('Telefonas prisijungė').isVisible(), 'the computer sees the phone connect');
  await shot(phone, 'phone-2-ready');
  await phone.getByRole('button', { name: 'Kalibruoti' }).click();

  // --- The computer takes it from there ---
  const found = editor.getByText('Kampai rasti automatiškai');
  await found.waitFor({ timeout: 30000 });
  check(true, 'corners were found automatically');
  await phone.getByText('Baigta!').waitFor({ timeout: 10000 });
  check(true, 'the phone says it is done');
  await shot(phone, 'phone-3-done');
  await shot(editor, 'phone-4-corners');
  await editor.getByRole('button', { name: 'Toliau', exact: true }).click();
  await editor.waitForTimeout(1500);
  const lens = Number(await editor.locator('[role=dialog] input[type=range]').inputValue());
  check(Math.abs(lens - LENS) < 0.02, `the lens bend was worked out (${lens}, made with ${LENS})`);
  await shot(editor, 'phone-5-check');
  await editor.getByRole('button', { name: 'Baigti kalibravimą' }).click();
  await editor.waitForTimeout(1500);
  await shot(editor, 'phone-6-editor');

  // The wall photo (taken with the projector dark) put onto the projector picture: stickers in its corners.
  const pixel = (x, y) => editor.evaluate(({ x, y }) => {
    const c = document.querySelector('main canvas.opacity-50');
    if (!c || !c.width) return null;
    const d = c.getContext('2d').getImageData(Math.floor(x * c.width / 2363), Math.floor(y * c.height / 1320), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { x, y });
  const tl = await pixel(6, 6), br = await pixel(2363 - 6, 1320 - 6);
  check(!!tl && tl[0] > 150 && tl[1] < 100, `red sticker in the top left corner of the projector picture (${tl})`);
  check(!!br && br[1] > 130 && br[0] < 100, `green sticker in the bottom right corner (${br})`);
  const projector = await live.evaluate(() => {
    const c = document.querySelector('main canvas:not(.opacity-50)');
    // Where the pattern's red corner mark would be.
    const d = c.getContext('2d').getImageData(Math.floor(15 * c.width / 2363), Math.floor(90 * c.height / 1320), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  check(projector[3] === 0, `the projector window is back to the show (no pattern) after calibrating (${projector})`);
} finally {
  await browser.close();
  peerServer.close?.();
  server.kill();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
