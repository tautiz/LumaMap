import React, { useEffect, useRef, useState } from 'react';
import { PhotoCalibration } from '../types';
import { loadPhotoPixels, warpPhoto } from '../utils/calibration';

// The wall photo straightened onto the projector picture (see utils/calibration.ts).
// Worked out once per photo and calibration, then shown as a still picture.
const CalibratedPhoto: React.FC<{
  url: string;
  calibration: PhotoCalibration;
  projectorSize: { w: number; h: number };
  maxSide?: number; // Longest side worked out, in pixels; the photo is only a guide, so it need not be sharp
  className?: string;
}> = ({ url, calibration, projectorSize, maxSide = 1600, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify([calibration.corners, calibration.lens, projectorSize.w, projectorSize.h, maxSide]);

  useEffect(() => {
    let cancelled = false;
    // Wait a moment, so dragging the lens slider does not redo the work on every step.
    const timer = window.setTimeout(async () => {
      try {
        const photo = await loadPhotoPixels(url);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const s = Math.min(1, maxSide / Math.max(projectorSize.w, projectorSize.h));
        const w = Math.max(1, Math.round(projectorSize.w * s));
        const h = Math.max(1, Math.round(projectorSize.h * s));
        const ctx = canvas.getContext('2d')!;
        const out = ctx.createImageData(w, h);
        const ok = warpPhoto(photo.data, photo, calibration, projectorSize, out);
        setFailed(!ok);
        canvas.width = w;
        canvas.height = h;
        if (ok) ctx.putImageData(out, 0, 0);
      } catch (e) {
        console.warn('Calibrated photo failed', e);
        if (!cancelled) setFailed(true);
      }
    }, 60);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);

  // If the corners make no usable shape, show the photo as it is rather than nothing.
  return (
    <>
      <canvas ref={canvasRef} className={className} style={failed ? { display: 'none' } : undefined} />
      {failed && <img src={url} className={`${className} object-contain`} alt="" />}
    </>
  );
};

export default CalibratedPhoto;
