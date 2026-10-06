import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ExternalLink, Maximize, Upload, X, Crosshair } from 'lucide-react';
import { CalibrationView, PhotoCalibration, Point } from '../types';
import { useI18n } from '../i18n';
import CalibratedPhoto from './CalibratedPhoto';
import { CORNER_COLORS, cornersUsable, defaultCorners, drawCalibrationPattern, drawCalibrationView } from '../utils/calibration';
import PhoneCalibrationPanel, { PhoneResult } from './PhoneCalibrationPanel';
import { DetectResult } from '../utils/autoCalibrate';

// Step by step: the projector shows a test pattern, the wall is photographed with it,
// the pattern's four corners are marked on the photo, and the result is checked against the pattern.

type Step = 'pattern' | 'corners' | 'check';

const LOUPE = 170; // Magnifier size, px
const LOUPE_ZOOM = 4;

const PatternCanvas: React.FC<{ w: number; h: number; linesOnly?: boolean; view?: CalibrationView; className?: string }> = ({ w, h, linesOnly, view = 'pattern', className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const s = Math.min(1, 1600 / Math.max(w, h));
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(s, s);
    if (linesOnly) drawCalibrationPattern(ctx, w, h, true);
    else drawCalibrationView(ctx, w, h, view);
  }, [w, h, linesOnly, view]);
  return <canvas ref={ref} className={className} />;
};

const CalibrationDialog: React.FC<{
  photoUrl: string | null;
  calibration: PhotoCalibration | null;
  projectorSize: { w: number; h: number };
  onUploadPhoto: (file: File) => void;
  onOpenLive: () => void;
  onApply: (calibration: PhotoCalibration) => void;
  onClose: () => void;
  projectorView: CalibrationView; // What the projector shows now
  onProjectorView: (view: CalibrationView) => void;
}> = ({ photoUrl, calibration, projectorSize, onUploadPhoto, onOpenLive, onApply, onClose, projectorView, onProjectorView }) => {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('pattern');
  const [fullPattern, setFullPattern] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [corners, setCorners] = useState<Point[] | null>(calibration?.corners ?? null);
  const [lens, setLens] = useState(calibration?.lens ?? 0);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const uploadedRef = useRef(false);
  // Corners found on the phone's photos, waiting for that photo to arrive as the wall photo.
  const foundRef = useRef<DetectResult | null>(null);
  // The phone panel lives in its own element, moved into its place on the first step and kept aside
  // (hidden) on the others, so it is never remounted and the phone stays connected.
  const phoneSlotRef = useRef<HTMLDivElement>(null);
  const [phoneHome] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    const slot = phoneSlotRef.current;
    if (slot) slot.appendChild(phoneHome);
    else phoneHome.remove();
  }, [step, phoneHome]);
  const [autoNote, setAutoNote] = useState<DetectResult | null>(null);
  // The phone's picture lit by the projector: corners are marked and checked on it, because the kept
  // wall photo (taken with the projector dark) does not show where the light ends. Same size as the photo.
  const [litUrl, setLitUrl] = useState<string | null>(null);
  useEffect(() => () => { if (litUrl) URL.revokeObjectURL(litUrl); }, [litUrl]);
  const markUrl = litUrl ?? photoUrl;

  // A new photo starts from fresh corners, or from the ones found on it.
  useEffect(() => {
    if (uploadedRef.current) {
      uploadedRef.current = false;
      const found = foundRef.current;
      foundRef.current = null;
      setCorners(found?.ok ? found.calibration.corners : null);
      setLens(found?.ok ? found.calibration.lens : 0);
    }
    setNatural(null);
  }, [markUrl]);

  const onPhoneResult = useCallback((result: PhoneResult) => {
    foundRef.current = result.detection;
    uploadedRef.current = true;
    setAutoNote(result.detection);
    setLitUrl(URL.createObjectURL(result.lit));
    setFullPattern(false);
    onUploadPhoto(result.photo);
    setStep('corners');
  }, [onUploadPhoto]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  // Where the photo sits in the marking area (fitted, centred).
  const fit = natural && area.w > 0
    ? (() => {
        const scale = Math.min(area.w / natural.w, area.h / natural.h);
        return { scale, x: (area.w - natural.w * scale) / 2, y: (area.h - natural.h * scale) / 2 };
      })()
    : null;

  const onPhotoLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    setNatural(size);
    setCorners(prev => prev ?? defaultCorners(size.w, size.h));
  };

  const moveCorner = useCallback((index: number, p: Point) => {
    if (!natural) return;
    // A corner may lie a little outside the photo when the photo did not catch the whole picture.
    const x = Math.max(-natural.w * 0.25, Math.min(natural.w * 1.25, p.x));
    const y = Math.max(-natural.h * 0.25, Math.min(natural.h * 1.25, p.y));
    setCorners(prev => prev && prev.map((c, i) => (i === index ? { x, y } : c)));
  }, [natural]);

  const toPhoto = (e: React.PointerEvent): Point | null => {
    if (!fit || !areaRef.current) return null;
    const r = areaRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - fit.x) / fit.scale, y: (e.clientY - r.top - fit.y) / fit.scale };
  };

  // Arrow keys move the chosen corner one photo pixel (ten with Shift) for the last bit of precision.
  useEffect(() => {
    if (step !== 'corners') return;
    const onKey = (e: KeyboardEvent) => {
      if (!corners) return;
      const d = e.shiftKey ? 10 : 1;
      const delta: Record<string, Point> = { ArrowLeft: { x: -d, y: 0 }, ArrowRight: { x: d, y: 0 }, ArrowUp: { x: 0, y: -d }, ArrowDown: { x: 0, y: d } };
      if (delta[e.key]) {
        e.preventDefault();
        const c = corners[active];
        moveCorner(active, { x: c.x + delta[e.key].x, y: c.y + delta[e.key].y });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, corners, active, moveCorner]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fullPattern) setFullPattern(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullPattern, onClose]);

  const usable = !!corners && cornersUsable(corners);
  const cornerNames = [t('calib.corner.tl'), t('calib.corner.tr'), t('calib.corner.br'), t('calib.corner.bl')];

  const stepButton = (s: Step, n: number, label: string) => (
    <span className={`flex items-center gap-2 text-sm ${step === s ? 'text-white font-bold' : 'text-slate-400'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? 'bg-cyan-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>{n}</span>
      {label}
    </span>
  );

  // This screen is the projector: show only the pattern (or white, black for the phone), as large as the
  // projector picture would be. The dialog stays open underneath, so the phone link keeps going.
  const phonePanel = (
    <PhoneCalibrationPanel onView={onProjectorView} onResult={onPhoneResult} />
  );

  const fullScreenPattern = fullPattern && (
    <div
      className="fixed inset-0 z-[400] bg-black flex items-center justify-center cursor-pointer"
      onClick={() => { setFullPattern(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }}
    >
      <PatternCanvas w={projectorSize.w} h={projectorSize.h} view={projectorView} className="max-w-full max-h-full" />
    </div>
  );

  const active2 = corners?.[active];

  return (
    <>
    {fullScreenPattern}
    {createPortal(phonePanel, phoneHome)}
    <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('calib.title')}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col text-white">
        <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-800">
          <Crosshair size={20} className="text-cyan-400" />
          <h2 className="text-lg font-bold flex-1">{t('calib.title')}</h2>
          <nav className="hidden md:flex items-center gap-4">
            {stepButton('pattern', 1, t('calib.step.pattern'))}
            {stepButton('corners', 2, t('calib.step.corners'))}
            {stepButton('check', 3, t('calib.step.check'))}
          </nav>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"><X size={20} /></button>
        </header>

        {step === 'pattern' && (
          <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <p className="text-slate-200 leading-relaxed">{t('calib.pattern.why')}</p>
              <div ref={phoneSlotRef} />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('calib.pattern.manual')}</p>
              <ol className="space-y-3 text-sm text-slate-200">
                <li className="flex gap-3"><b className="text-cyan-400">1.</b><span>{t('calib.pattern.s1')}</span></li>
                <li className="flex gap-3"><b className="text-cyan-400">2.</b><span>{t('calib.pattern.s2')}</span></li>
                <li className="flex gap-3"><b className="text-cyan-400">3.</b><span>{t('calib.pattern.s3')}</span></li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <button onClick={onOpenLive} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-2">
                  <ExternalLink size={16} /> {t('setup.projector.open')}
                </button>
                <button onClick={() => { setFullPattern(true); document.documentElement.requestFullscreen?.().catch(() => {}); }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-2">
                  <Maximize size={16} /> {t('calib.pattern.here')}
                </button>
              </div>
              <p className="text-xs text-slate-400">{t('calib.pattern.tip')}</p>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-slate-700 bg-black">
                <PatternCanvas w={projectorSize.w} h={projectorSize.h} className="w-full h-auto block" />
              </div>
              <label className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold flex items-center justify-center gap-2 cursor-pointer">
                <Upload size={18} /> {t('calib.pattern.upload')}
                <input
                  type="file" accept="image/*" className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    uploadedRef.current = true;
                    setAutoNote(null);
                    setLitUrl(null);
                    onUploadPhoto(file);
                    setStep('corners');
                  }}
                />
              </label>
              {photoUrl && (
                <button onClick={() => setStep('corners')} className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold">
                  {t('calib.pattern.useCurrent')}
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'corners' && (
          <>
            <div className="px-5 py-3 text-sm text-slate-200 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800">
              <span className="flex-1 min-w-[16rem]">
                {autoNote && (
                  <b className={`block mb-1 ${autoNote.ok ? 'text-emerald-300' : 'text-amber-300'}`} role="status">
                    {t(autoNote.ok === false ? (`calib.auto.${autoNote.reason}` as const) : 'calib.auto.found')}
                  </b>
                )}
                {t('calib.corners.hint')}
              </span>
              <span className="flex gap-1.5">
                {cornerNames.map((name, i) => (
                  <button
                    key={i} onClick={() => setActive(i)} title={name}
                    className={`w-8 h-8 rounded-full text-sm font-bold text-slate-900 border-2 ${active === i ? 'border-white scale-110' : 'border-transparent opacity-70'}`}
                    style={{ background: CORNER_COLORS[i] }}
                  >{i + 1}</button>
                ))}
              </span>
            </div>
            <div
              ref={areaRef}
              className="relative flex-1 overflow-hidden bg-black touch-none select-none"
              onPointerMove={(e) => {
                if (!dragging) return;
                const p = toPhoto(e);
                if (p) moveCorner(active, p);
              }}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              onPointerDown={(e) => {
                // A click on the photo puts the chosen corner there.
                const p = toPhoto(e);
                if (!p) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                moveCorner(active, p);
                setDragging(true);
              }}
            >
              {markUrl && (
                <img
                  src={markUrl} alt="" draggable={false} onLoad={onPhotoLoaded}
                  className="absolute max-w-none pointer-events-none"
                  style={fit && natural
                    ? { left: fit.x, top: fit.y, width: natural.w * fit.scale, height: natural.h * fit.scale }
                    : { opacity: 0 }}
                />
              )}
              {fit && corners && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                  <polygon
                    points={corners.map(c => `${fit.x + c.x * fit.scale},${fit.y + c.y * fit.scale}`).join(' ')}
                    fill={usable ? 'rgba(34,211,238,0.08)' : 'rgba(255,59,48,0.15)'}
                    stroke={usable ? '#22d3ee' : '#ff3b30'} strokeWidth={2} strokeDasharray="6 4"
                  />
                  {corners.map((c, i) => {
                    const x = fit.x + c.x * fit.scale, y = fit.y + c.y * fit.scale;
                    return (
                      <g key={i} style={{ pointerEvents: 'auto', cursor: 'grab' }}
                        onPointerDown={(e) => { e.stopPropagation(); setActive(i); setDragging(true); areaRef.current?.setPointerCapture(e.pointerId); }}>
                        <circle cx={x} cy={y} r={18} fill="transparent" />
                        <circle cx={x} cy={y} r={active === i ? 15 : 12} fill="none" stroke={CORNER_COLORS[i]} strokeWidth={active === i ? 4 : 3} />
                        <circle cx={x} cy={y} r={1.5} fill="#fff" />
                        <text x={x + 18} y={y - 14} fill={CORNER_COLORS[i]} fontSize={16} fontWeight="bold" stroke="#000" strokeWidth={3} paintOrder="stroke">{i + 1}</text>
                      </g>
                    );
                  })}
                </svg>
              )}
              {/* Magnifier around the chosen corner, in the corner of the view away from it. */}
              {fit && natural && active2 && markUrl && (() => {
                const ax = fit.x + active2.x * fit.scale, ay = fit.y + active2.y * fit.scale;
                const left = ax < area.w / 2 ? area.w - LOUPE - 12 : 12;
                const z = fit.scale * LOUPE_ZOOM;
                return (
                  <div
                    className="absolute top-3 rounded-full border-4 shadow-2xl pointer-events-none bg-black"
                    style={{
                      left, width: LOUPE, height: LOUPE, borderColor: CORNER_COLORS[active],
                      backgroundImage: `url(${markUrl})`, backgroundRepeat: 'no-repeat',
                      backgroundSize: `${natural.w * z}px ${natural.h * z}px`,
                      backgroundPosition: `${LOUPE / 2 - 4 - active2.x * z}px ${LOUPE / 2 - 4 - active2.y * z}px`,
                    }}
                  >
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/80 -translate-x-1/2" />
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-white/80 -translate-y-1/2" />
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold px-1.5 rounded bg-black/70" style={{ color: CORNER_COLORS[active] }}>
                      {cornerNames[active]}
                    </span>
                  </div>
                );
              })()}
            </div>
            <footer className="flex items-center gap-3 px-5 py-3 border-t border-slate-800">
              <button onClick={() => setStep('pattern')} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-1"><ChevronLeft size={16} /> {t('calib.back')}</button>
              <span className={`flex-1 text-xs ${usable ? 'text-slate-400' : 'text-red-400'}`}>{usable ? t('calib.corners.keys') : t('calib.corners.bad')}</span>
              <button disabled={!usable} onClick={() => setStep('check')} className="px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-900 font-bold text-sm">{t('calib.next')}</button>
            </footer>
          </>
        )}

        {step === 'check' && corners && markUrl && (
          <>
            <div className="px-5 py-3 text-sm text-slate-200 border-b border-slate-800">{t('calib.check.hint')}</div>
            <div ref={areaRef} className="relative flex-1 overflow-hidden bg-black flex items-center justify-center p-3">
              {(() => {
                const scale = Math.min(area.w / projectorSize.w, area.h / projectorSize.h) || 0;
                const style = { width: projectorSize.w * scale, height: projectorSize.h * scale };
                return (
                  <div className="relative ring-1 ring-white/20" style={style}>
                    <CalibratedPhoto url={markUrl} calibration={{ corners, lens }} projectorSize={projectorSize} maxSide={1200} className="absolute inset-0 w-full h-full" />
                    <PatternCanvas w={projectorSize.w} h={projectorSize.h} linesOnly className="absolute inset-0 w-full h-full pointer-events-none" />
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 space-y-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="shrink-0 text-slate-300">{t('calib.lens')}</span>
                <input
                  type="range" min={-0.3} max={0.3} step={0.005} value={lens}
                  onChange={(e) => setLens(parseFloat(e.target.value))}
                  className="flex-1 accent-cyan-500" aria-label={t('calib.lens')}
                />
                <span className="w-12 text-right tabular-nums text-slate-400">{Math.round(lens * 100)}</span>
                <button onClick={() => setLens(0)} disabled={lens === 0} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-40">0</button>
              </div>
              <p className="text-xs text-slate-400">{t('calib.lens.hint')}</p>
            </div>
            <footer className="flex items-center gap-3 px-5 py-3 border-t border-slate-800">
              <button onClick={() => setStep('corners')} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-1"><ChevronLeft size={16} /> {t('calib.back')}</button>
              <span className="flex-1" />
              <button onClick={() => onApply({ corners, lens })} className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold text-sm flex items-center gap-2">
                <Check size={16} /> {t('calib.apply')}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
    </>
  );
};

export default CalibrationDialog;
