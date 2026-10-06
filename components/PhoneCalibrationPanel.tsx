import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { CalibrationView } from '../types';
import { useI18n } from '../i18n';
import { ComputerLink, PhoneMessage, Shot, cameraPageUrl, openComputerLink } from '../services/phoneLink';
import { DetectResult, detectProjection, meanBrightness, toGray } from '../utils/autoCalibrate';

// Calibration with the phone as a camera: scan the QR code, aim the phone at the wall, press one button.
// The projector shows white, then black; the phone photographs both; the projector picture is found
// on them by itself (utils/autoCalibrate.ts).

export interface PhoneResult {
  photo: File; // The wall photo to keep
  lit: Blob; // The same view lit by the projector, to check the corners on
  detection: DetectResult;
}

const SETTLE_MS = 900; // Projector and window delay plus the camera adjusting to the new brightness
const FRAME_TIMEOUT_MS = 20000;

const decode = async (data: ArrayBuffer, mime: string): Promise<ImageData> => {
  const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

type Status = 'starting' | 'waiting' | 'connected' | 'running' | 'error' | 'timeout';

const PhoneCalibrationPanel: React.FC<{
  onView: (view: CalibrationView) => void;
  onResult: (result: PhoneResult) => void;
}> = ({ onView, onResult }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('starting');
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const linkRef = useRef<ComputerLink | null>(null);
  const waitingRef = useRef(new Map<Shot, (frame: { data: ArrayBuffer; mime: string }) => void>());
  const runningRef = useRef(false);
  const runRef = useRef<() => void>(() => {});
  // Latest callbacks, so the link (made once) always reaches the current ones.
  const propsRef = useRef({ onView, onResult });
  propsRef.current = { onView, onResult };

  useEffect(() => {
    let cancelled = false;
    let link: ComputerLink | null = null;
    setStatus('starting');
    openComputerLink({
      onPhone: connected => { if (!runningRef.current) setStatus(connected ? 'connected' : 'waiting'); },
      onMessage: (msg: PhoneMessage) => {
        if (msg.type === 'start') runRef.current();
        else if (msg.type === 'frame') {
          const resolve = waitingRef.current.get(msg.shot);
          waitingRef.current.delete(msg.shot);
          resolve?.({ data: msg.data, mime: msg.mime });
        }
      },
      onError: e => console.warn('Phone link', e),
    }).then(async l => {
      if (cancelled) { l.close(); return; }
      link = l;
      linkRef.current = l;
      const pageUrl = cameraPageUrl(l.id);
      setUrl(pageUrl);
      const QRCode = await import('qrcode');
      setQr(await QRCode.toDataURL(pageUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }));
      if (!cancelled) setStatus(s => (s === 'starting' ? 'waiting' : s));
    }).catch(e => {
      console.warn('Phone link could not start', e);
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
      link?.close();
      linkRef.current = null;
      runningRef.current = false;
      propsRef.current.onView('pattern');
    };
  }, [attempt]);

  const waitFor = (shot: Shot) => new Promise<{ data: ArrayBuffer; mime: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => { waitingRef.current.delete(shot); reject(new Error('timeout')); }, FRAME_TIMEOUT_MS);
    waitingRef.current.set(shot, frame => { window.clearTimeout(timer); resolve(frame); });
  });

  const run = useCallback(async () => {
    const link = linkRef.current;
    if (!link || runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    link.send({ type: 'state', state: 'running' });
    try {
      const frames: Partial<Record<Shot, { data: ArrayBuffer; mime: string }>> = {};
      for (const shot of ['white', 'black'] as Shot[]) {
        propsRef.current.onView(shot);
        await new Promise(r => setTimeout(r, SETTLE_MS));
        const frame = waitFor(shot);
        link.send({ type: 'capture', shot });
        frames[shot] = await frame;
      }
      propsRef.current.onView('pattern');
      const white = await decode(frames.white!.data, frames.white!.mime);
      const black = await decode(frames.black!.data, frames.black!.mime);
      const whiteGray = toGray(white), blackGray = toGray(black);
      const detection = detectProjection(whiteGray, blackGray, white.width, white.height);
      // In a dark room the photo without the projector shows nothing; the one lit by it is better then.
      const keep = meanBrightness(blackGray) < 35 ? frames.white! : frames.black!;
      link.send({ type: 'state', state: detection.ok ? 'done' : 'failed' });
      runningRef.current = false;
      setStatus('connected');
      propsRef.current.onResult({
        photo: new File([keep.data], 'wall.jpg', { type: keep.mime }),
        lit: new Blob([frames.white!.data], { type: frames.white!.mime }),
        detection,
      });
    } catch (e) {
      console.warn('Phone calibration failed', e);
      propsRef.current.onView('pattern');
      link.send({ type: 'state', state: 'failed' });
      runningRef.current = false;
      setStatus('timeout');
    }
  }, []);
  runRef.current = run;

  return (
    <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-4 space-y-3" data-testid="phone-calibration">
      <h3 className="flex items-center gap-2 font-bold text-cyan-200"><Smartphone size={18} /> {t('calib.phone.title')}</h3>
      <div className="flex gap-4 items-start">
        <div className="shrink-0 w-36 h-36 rounded-lg bg-white flex items-center justify-center overflow-hidden">
          {qr ? <img src={qr} alt={t('calib.phone.qr')} className="w-full h-full" data-camera-url={url ?? undefined} />
              : status === 'error' ? null : <Loader2 className="animate-spin text-slate-400" />}
        </div>
        <div className="space-y-2 text-sm text-slate-200 min-w-0">
          <p>{t('calib.phone.scan')}</p>
          <p className={`font-semibold ${status === 'error' || status === 'timeout' ? 'text-red-300' : 'text-cyan-200'}`} role="status">
            {status === 'running' && <Loader2 size={14} className="inline animate-spin mr-1" />}
            {t(`calib.phone.${status}` as const)}
          </p>
          {status === 'connected' && (
            <button onClick={run} className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold">{t('calib.phone.start')}</button>
          )}
          {status === 'timeout' && (
            <button onClick={run} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 font-semibold flex items-center gap-2"><RefreshCw size={14} /> {t('calib.phone.retry')}</button>
          )}
          {status === 'error' && (
            <button onClick={() => setAttempt(a => a + 1)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 font-semibold flex items-center gap-2"><RefreshCw size={14} /> {t('calib.phone.retry')}</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhoneCalibrationPanel;
