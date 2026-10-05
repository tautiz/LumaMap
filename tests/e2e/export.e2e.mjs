// End-to-end test of the looping video export: real videos, a real browser (Chromium via Playwright),
// a real encoded file, checked with ffprobe/ffmpeg.
//
//   npm run test:e2e
//
// Needs: ffmpeg + ffprobe (with libvpx) and Playwright's Chromium. It starts the Vite dev server itself.
// What it checks, for each scenario:
//   1. the file has exactly the planned number of frames and length;
//   2. every exported frame shows the source frame the plan says (so every element plays whole cycles,
//      in order, and restarts exactly at the loop's end: no extra, missing or doubled frame at the seam);
//   3. effects that loop come back to where they started (the last -> first frame step is like any other);
//   4. an effect that cannot loop is reported, and "ignore and export" still produces the video.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = mkdtempSync(path.join(tmpdir(), 'lumamap-e2e-'));
const fixtures = path.join(work, 'fixtures');
execFileSync(path.join(here, 'make-fixtures.sh'), [fixtures], { stdio: 'inherit' });

const PORT = 3123;
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes('Local')) resolve(); });
  server.on('exit', code => reject(new Error(`vite exited ${code}`)));
  setTimeout(() => reject(new Error('vite did not start')), 30000);
});

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e));
  await page.route('**/__fixtures/**', route => {
    const file = path.join(fixtures, path.basename(new URL(route.request().url()).pathname));
    route.fulfill({ body: readFileSync(file), contentType: 'video/mp4' });
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0);

  // --- Runs inside the page -------------------------------------------------------------------------
  const runInPage = (scenario) => page.evaluate(async (scenario) => {
    const ex = await import('/services/videoExport.ts');
    const T = await import('/services/loopTiming.ts');
    const fx = await import('/effects/index.ts');

    const rect = (x0, y0, x1, y1) => [
      { id: 'p0', x: x0, y: y0, u: 0, v: 0 }, { id: 'p1', x: x1, y: y0, u: 1, v: 0 },
      { id: 'p2', x: x1, y: y1, u: 1, v: 1 }, { id: 'p3', x: x0, y: y1, u: 0, v: 1 },
    ];
    const playback = { isPlaying: true, volume: 1, isMuted: true, currentTime: 0, duration: 0 };
    const layer = (id, points, source, effects = []) => ({ id, name: id, visible: true, locked: false, opacity: 1, source, points, playback, effects });
    const video = name => ({ type: 'VIDEO', url: `/__fixtures/${name}.mp4`, name });

    if (scenario.registerUnloopable) {
      // An effect that moves but declares no loop support, like a future or third-party effect.
      fx.registerEffect({
        id: 'testDrift', role: 'overlay', inputMode: 'none', space: 'texture', animated: true, params: [],
        renderTexture: ({ ctx, w, h, time }) => { ctx.fillStyle = '#fff'; ctx.fillRect(((time * 0.37) % 1) * w, 0, w * 0.1, h); },
      });
    }

    const layers = scenario.layers.map(l => layer(l.id, rect(...l.rect),
      l.video ? video(l.video) : l.color ? { type: 'COLOR', url: '', name: 'c', color: l.color } : null,
      (l.effects ?? []).map(([type, overrides]) => fx.createEffect(type, overrides ?? {}))));

    const settings = { fps: T.parseFrameRate(scenario.fps), width: 1920, height: 1080, emptySeconds: T.rat(scenario.emptySeconds ?? 4) };
    const probe = new ex.MediaProbe();
    const analysis = await ex.analyze(layers, settings, probe);
    if (analysis.plan.ok !== true) return { error: analysis.plan.reason };
    const plan = analysis.plan;
    const summary = {
      frameCount: Number(plan.frameCount),
      seconds: T.ratToNumber(plan.duration),
      loops: plan.layers.map(l => Number(l.loops)),
      clips: analysis.videoLayers.map(v => v.clips.map(c => ({ fps: c.fps && T.ratToString(c.fps), frames: c.frames, duration: c.timing.duration && T.ratToString(c.timing.duration), constant: c.constantRate }))),
      issues: analysis.check.issues.map(i => `${i.layerName}:${i.effectType}:${i.issue}`),
      effects: analysis.check.effects.map(e => `${e.effectType}:${e.status ?? e.issue}`),
    };

    // Seam check: draw every frame straight from the renderer and compare neighbours inside one element.
    if (scenario.seam) {
      const r = new ex.LoopRenderer({ layers, projectorSize: { w: 2363, h: 1320 }, settings, analysis, probe }, plan);
      await r.load();
      const [x0, y0, x1, y1] = scenario.seam.map(v => Math.round(20 + 0.8 * v));
      const grab = async i => { await r.seek(i); r.draw(i); return r.canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data; };
      const diff = (a, b) => { let s = 0; for (let k = 0; k < a.length; k += 4) s += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); return s / (a.length / 4); };
      const n = Number(plan.frameCount);
      const frames = [];
      for (let i = 0; i <= n; i++) frames.push(await grab(i));
      const steps = frames.slice(0, n - 1).map((f, i) => diff(f, frames[i + 1])); // 0->1 ... (n-2)->(n-1)
      summary.seam = { seamStep: diff(frames[n - 1], frames[0]), typicalMax: Math.max(...steps), typicalMean: steps.reduce((a, b) => a + b, 0) / steps.length, wrapEqualsFirst: diff(frames[n], frames[0]) };
    }

    let bytes = null;
    if (scenario.export) {
      const res = await ex.exportLoopVideo({ layers, projectorSize: { w: 2363, h: 1320 }, settings, analysis, probe });
      bytes = Array.from(new Uint8Array(await res.blob.arrayBuffer()));
      summary.codec = res.codec;
      summary.fileName = res.fileName;
    }
    probe.dispose();
    return { summary, bytes };
  }, scenario);

  // The frame number each element shows in every frame of the file: its 8 stripes read as bits.
  const shownFrames = (file, rect) => {
    const W = 1920, H = 2; // One even-aligned 2-pixel row through the element's middle
    const y = Math.round(20 + 0.8 * (rect[1] + rect[3]) / 2) & ~1;
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', `crop=${W}:${H}:0:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
    const xs = [...Array(8).keys()].map(k => Math.round(20 + 0.8 * (rect[0] + ((k + 0.5) / 8) * (rect[2] - rect[0]))));
    const out = [];
    for (let f = 0; (f + 1) * W * H <= raw.length; f++) {
      out.push(xs.reduce((n, x, k) => n + (raw[f * W * H + x] > 128 ? 1 << k : 0), 0));
    }
    return out;
  };
  const probeFile = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v',
    '-show_entries', 'stream=nb_read_frames,r_frame_rate,time_base,duration,codec_name:format=duration', '-of', 'json', file]));

  const scenarios = [
    {
      name: '24 fps (1.5 s) + 30 fps (0.667 s) exported at 30 fps',
      fps: '30', export: true,
      layers: [{ id: 'A', video: 'a24', rect: [100, 100, 900, 900], src: { fps: 24, frames: 36 } },
               { id: 'B', video: 'b30', rect: [1300, 100, 2100, 900], src: { fps: 30, frames: 20 } }],
      expect: { frames: 180, seconds: 6, loops: [4, 9] },
    },
    {
      name: '29.97 fps (1.001 s) + 23.976 fps (2.002 s) exported at 29.97 fps',
      fps: '29.97', export: true,
      layers: [{ id: 'C', video: 'c2997', rect: [100, 100, 900, 900], src: { fps: 30000 / 1001, frames: 30 } },
               { id: 'D', video: 'd23976', rect: [1300, 100, 2100, 900], src: { fps: 24000 / 1001, frames: 48 } }],
      expect: { frames: 60, seconds: 2.002, loops: [2, 1] },
    },
    {
      name: 'loopable and random effects next to a video, seam check',
      fps: '30', export: true, seam: [1300, 100, 2100, 900],
      layers: [{ id: 'E', video: 'a24', rect: [100, 100, 900, 900], src: { fps: 24, frames: 36 } },
               { id: 'E2', color: '#203040', rect: [1300, 100, 2100, 900], effects: [['pulse'], ['lightSweep', { params: { period: 1.4 } }], ['sparks', { params: { turbulence: 0 } }], ['shockwave', { trigger: { mode: 'always' } }]] }],
      expect: { frames: 45, seconds: 1.5, loops: [1], issues: [] },
    },
    {
      name: 'no video: colour + effects only, 4 s',
      fps: '25', seam: [200, 200, 2100, 1100], export: true, emptySeconds: 4,
      layers: [{ id: 'F', color: '#203040', rect: [200, 200, 2100, 1100], effects: [['noise'], ['ripple'], ['colorShift', { params: { cycle: 0.3 } }], ['electricBorder']] }],
      expect: { frames: 100, loops: [], issues: [] },
    },
    {
      name: 'effects that cannot loop: warning, then "ignore and export"',
      fps: '30', seam: [1300, 100, 2100, 900], export: true, registerUnloopable: true,
      layers: [{ id: 'G', video: 'b30', rect: [100, 100, 900, 900], src: { fps: 30, frames: 20 } },
               { id: 'G2', color: '#000000', rect: [1300, 100, 2100, 900],
                 effects: [['testDrift'], ['caustics'], ['flash', { trigger: { mode: 'signal' } }], ['glitch']] }],
      expect: { frames: 20, seconds: 2 / 3, loops: [1], issues: ['G2:testDrift:cannotLoop', 'G2:caustics:tooSlow', 'G2:flash:signal'] },
    },
  ];

  for (const sc of scenarios) {
    console.log(`\n# ${sc.name}`);
    const t0 = Date.now();
    const { summary, bytes, error } = await runInPage(sc);
    if (error) { check(false, `plan: ${error}`); continue; }
    console.log(`  plan: ${summary.frameCount} frames, ${summary.seconds} s, loops ${JSON.stringify(summary.loops)}, clips ${JSON.stringify(summary.clips)}`);
    check(summary.frameCount === sc.expect.frames, `frame count ${summary.frameCount} = ${sc.expect.frames}`);
    if (sc.expect.seconds) check(Math.abs(summary.seconds - sc.expect.seconds) < 1e-9, `length ${summary.seconds} s = ${sc.expect.seconds} s`);
    check(JSON.stringify(summary.loops) === JSON.stringify(sc.expect.loops), `whole loops per element ${JSON.stringify(summary.loops)}`);
    if (sc.expect.issues) check(JSON.stringify(summary.issues) === JSON.stringify(sc.expect.issues), `effect warnings ${JSON.stringify(summary.issues)} (effects: ${summary.effects.join(', ')})`);

    if (summary.seam) {
      const s = summary.seam;
      console.log(`  seam: last->first step ${s.seamStep.toFixed(2)}, other steps: mean ${s.typicalMean.toFixed(2)}, largest ${s.typicalMax.toFixed(2)}; frame N vs frame 0 ${s.wrapEqualsFirst.toFixed(2)}`);
      check(s.wrapEqualsFirst === 0, 'frame N draws exactly frame 0 (the loop is N frames, frame 0 is not repeated)');
      if (sc.registerUnloopable) check(s.seamStep > s.typicalMax * 1.5, 'the effects that cannot loop jump at the seam (that is what the warning is for)');
      else check(s.seamStep <= s.typicalMax * 1.1 + 0.5, 'last -> first frame changes no more than the other frame steps');
    }

    if (bytes) {
      const file = path.join(work, `${sc.layers[0].id}.mp4`);
      writeFileSync(file, Buffer.from(bytes));
      const info = probeFile(file);
      const st = info.streams[0];
      console.log(`  file: ${summary.fileName}, ${summary.codec}, ${st.nb_read_frames} frames, ${st.r_frame_rate}, time base ${st.time_base}, ${st.duration} s (${((Date.now() - t0) / 1000).toFixed(1)} s to make)`);
      check(Number(st.nb_read_frames) === sc.expect.frames, `encoded frames ${st.nb_read_frames} = ${sc.expect.frames}`);
      const expectSeconds = sc.expect.seconds ?? sc.expect.frames / Number(eval(sc.fps));
      check(Math.abs(Number(st.duration) - expectSeconds) < 1e-3, `file length ${st.duration} s = ${expectSeconds} s`);
      // Which source frame every exported frame shows
      for (const l of sc.layers.filter(l => l.src)) {
        const shown = shownFrames(file, l.rect);
        const cycleFrames = summary.frameCount / summary.loops[sc.layers.indexOf(l)];
        const want = shown.map((_, i) => {
          // Export frame i starts at i / fps; the element is (i mod cycle) into its cycle
          const intoCycle = (i % cycleFrames) / Number(eval(sc.fps));
          return Math.floor(intoCycle * l.src.fps + 1e-9) % l.src.frames;
        });
        const wrong = shown.map((v, i) => [i, v, want[i]]).filter(([, v, w]) => v !== w);
        check(wrong.length === 0, `${l.id}: every frame shows the planned source frame${wrong.length ? ` (first wrong: ${JSON.stringify(wrong.slice(0, 5))})` : ''}`);
        const restarts = shown.filter((v, i) => i > 0 && v < shown[i - 1]).length;
        check(restarts + 1 === summary.loops[sc.layers.indexOf(l)] && shown[0] === 0 && shown.at(-1) === want.at(-1),
          `${l.id}: ${restarts + 1} whole cycles, the file starts on source frame 0 and ends on frame ${shown.at(-1)} of ${l.src.frames}`);
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
