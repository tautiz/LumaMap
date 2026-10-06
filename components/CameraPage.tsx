import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import { ComputerMessage, PhoneLink, openPhoneLink } from '../services/phoneLink';

// The phone page (?camera=<id>, opened from the QR code in the calibration dialog). It shows what the
// camera sees, and when the computer asks, sends it a full-size picture of that moment.

type Status = 'connecting' | 'ready' | 'running' | 'done' | 'failed' | 'lost' | 'noCamera' | 'noLink';

// Waits for a camera frame newer than now, so the picture is not one taken before the projector changed.
const freshFrame = (video: HTMLVideoElement) => new Promise<void>(resolve => {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => v.requestVideoFrameCallback!(() => resolve()));
  else setTimeout(resolve, 100);
});

// Keep the camera from changing brightness between the white and black pictures, where the phone allows it.
const holdExposure = async (track: MediaStreamTrack | undefined, hold: boolean) => {
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as Record<string, unknown>;
  const modes = (caps.exposureMode as string[] | undefined) ?? [];
  const wb = (caps.whiteBalanceMode as string[] | undefined) ?? [];
  const want = hold ? 'manual' : 'continuous';
  const settings: Record<string, string> = {};
  if (modes.includes(want)) settings.exposureMode = want;
  if (wb.includes(want)) settings.whiteBalanceMode = want;
  if (!Object.keys(settings).length) return;
  try {
    await track.applyConstraints({ advanced: [settings as MediaTrackConstraintSet] });
  } catch (e) {
    console.warn('Could not hold the camera exposure', e);
  }
};

const CameraPage: React.FC<{ computerId: string }> = ({ computerId }) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const linkRef = useRef<PhoneLink | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let link: PhoneLink | null = null;
    let lock: WakeLockSentinel | null = null;

    const capture = async (shot: 'white' | 'black') => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      const track = stream?.getVideoTracks()[0];
      await freshFrame(video);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) return;
      // Measured on the white picture; the black one then shows the room as it really is around it.
      if (shot === 'white') await holdExposure(track, true);
      else await holdExposure(track, false);
      link?.send({ type: 'frame', shot, data: await blob.arrayBuffer(), mime: blob.type });
    };

    const onMessage = (msg: ComputerMessage) => {
      if (msg.type === 'capture') capture(msg.shot);
      else if (msg.type === 'state') setStatus(msg.state === 'running' ? 'running' : msg.state);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch (e) {
        console.warn('Camera unavailable', e);
        if (!cancelled) setStatus('noCamera');
        return;
      }
      try {
        link = await openPhoneLink(computerId, {
          onOpen: () => { link?.send({ type: 'hello' }); setStatus('ready'); },
          onMessage,
          onClose: () => { if (!cancelled) setStatus('lost'); },
          onError: e => console.warn('Phone link', e),
        });
        if (cancelled) { link.close(); return; }
        linkRef.current = link;
      } catch (e) {
        console.warn('Could not reach the computer', e);
        if (!cancelled) setStatus('noLink');
      }
      // Keep the screen on while aiming.
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
    })();

    return () => {
      cancelled = true;
      link?.close();
      linkRef.current = null;
      stream?.getTracks().forEach(tr => tr.stop());
      lock?.release();
    };
  }, [computerId]);

  const start = () => {
    linkRef.current?.send({ type: 'start' });
    setStatus('running');
  };

  const message: Record<Status, string> = {
    connecting: t('camera.connecting'),
    ready: t('camera.ready'),
    running: t('camera.running'),
    done: t('camera.done'),
    failed: t('camera.failed'),
    lost: t('camera.lost'),
    noCamera: t('camera.noCamera'),
    noLink: t('camera.noLink'),
  };
  const bad = status === 'failed' || status === 'lost' || status === 'noCamera' || status === 'noLink';

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <video ref={videoRef} playsInline muted className="flex-1 min-h-0 w-full object-contain bg-black" />
      <div className="absolute top-3 right-3"><LanguageSwitcher /></div>
      <div className="p-4 space-y-3 bg-slate-900/95 border-t border-slate-700">
        <p className={`flex items-start gap-2 text-base ${bad ? 'text-amber-300' : status === 'done' ? 'text-emerald-300' : 'text-slate-100'}`} role="status">
          {(status === 'connecting' || status === 'running') && <Loader2 size={20} className="shrink-0 animate-spin mt-0.5" />}
          {status === 'done' && <CheckCircle2 size={20} className="shrink-0 mt-0.5" />}
          {bad && <TriangleAlert size={20} className="shrink-0 mt-0.5" />}
          <span>{message[status]}</span>
        </p>
        {(status === 'ready' || status === 'done' || status === 'failed') && (
          <button onClick={start} className="w-full py-4 rounded-2xl bg-cyan-500 active:bg-cyan-400 text-slate-900 text-xl font-bold flex items-center justify-center gap-2">
            {status === 'ready' ? <Camera size={24} /> : <RefreshCw size={22} />}
            {status === 'ready' ? t('camera.button') : t('camera.again')}
          </button>
        )}
        {status === 'ready' && <p className="text-xs text-slate-400">{t('camera.hint')}</p>}
      </div>
    </div>
  );
};

export default CameraPage;
