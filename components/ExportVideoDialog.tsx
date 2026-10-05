import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Film, AlertTriangle, Download, EyeOff, Crosshair, Repeat } from 'lucide-react';
import { GridSettings, Layer } from '../types';
import { TranslationKey, useI18n } from '../i18n';
import { Analysis, ExportCancelled, ExportResult, ExportSettings, MediaProbe, analyze, exportLoopVideo } from '../services/videoExport';
import { ExportPhase, FPS_CHOICES, autoFrameRate, nextPhase } from '../services/exportFlow';
import { DEFAULT_MAX_SECONDS, LoopPlan, LoopPlanError, Rational, approxSeconds, parseDecimal, parseFrameRate, ratToNumber } from '../services/loopTiming';
import { LoopIssueReason } from '../effects';

interface ExportVideoDialogProps {
  layers: Layer[];
  gridDefaults: GridSettings;
  projectorSize: { w: number; h: number };
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onShowLayer: (id: string) => void; // Select the element so its effects can be changed
  onClose: () => void;
}

const SIZES = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }];

const fmtFps = (r: Rational | null) => (r ? String(Math.round(ratToNumber(r) * 1000) / 1000) : '?');
const fmtSeconds = (s: number) => String(Math.round(s * 1000) / 1000);
const fmtLength = (s: number) => {
  if (s < 120) return `${fmtSeconds(s)} s`;
  if (s < 7200) return `${Math.round(s / 6) / 10} min`;
  return `${Math.round(s / 360) / 10} h`;
};

const ISSUE_TEXT: Record<LoopIssueReason, TranslationKey> = {
  cannotLoop: 'export.warn.cannotLoop',
  tooSlow: 'export.warn.tooSlow',
  signal: 'export.warn.signal',
};

const ExportVideoDialog: React.FC<ExportVideoDialogProps> = ({ layers, gridDefaults, projectorSize, onUpdateLayer, onShowLayer, onClose }) => {
  const { t } = useI18n();
  const probe = useMemo(() => new MediaProbe(), []);
  useEffect(() => () => probe.dispose(), [probe]);

  const [fpsChoice, setFpsChoice] = useState('auto');
  const [sizeIndex, setSizeIndex] = useState(0);
  const [emptySeconds, setEmptySeconds] = useState('10');
  const [autoFps, setAutoFps] = useState<Rational>(() => parseFrameRate(30));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [phase, setPhase] = useState<ExportPhase>('review');
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadUrl = useRef<string | null>(null);
  useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);

  const emptyLength = useMemo<Rational>(() => {
    try {
      const r = parseDecimal(emptySeconds);
      return r.num > 0n ? r : parseDecimal('10');
    } catch {
      return parseDecimal('10');
    }
  }, [emptySeconds]);

  const settings: ExportSettings = useMemo(() => ({
    fps: fpsChoice === 'auto' ? autoFps : parseFrameRate(fpsChoice),
    width: SIZES[sizeIndex].w,
    height: SIZES[sizeIndex].h,
    emptySeconds: emptyLength,
    maxSeconds: DEFAULT_MAX_SECONDS,
  }), [fpsChoice, autoFps, sizeIndex, emptyLength]);

  // Read the videos (once; the probe keeps them) and work out the loop whenever something changes.
  useEffect(() => {
    let live = true;
    analyze(layers, settings, probe).then(a => {
      if (!live) return;
      const auto = autoFrameRate(a.videoLayers.flatMap(v => v.clips.map(c => c.fps)));
      if (fpsChoice === 'auto' && (auto.num !== autoFps.num || auto.den !== autoFps.den)) {
        setAutoFps(auto); // Runs again with the videos' own rate
        return;
      }
      setAnalysis(a);
      setPhase(p => (p === 'warning' ? nextPhase(p, 'edit', a.check) : p));
    }).catch(e => { if (live) setMessage(t('export.error.failed', { message: String(e?.message ?? e) })); });
    return () => { live = false; };
  }, [layers, settings, probe, fpsChoice, autoFps, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'exporting') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const plan = analysis?.plan.ok === true ? analysis.plan as LoopPlan : null;
  const planError = analysis && analysis.plan.ok !== true ? analysis.plan as LoopPlanError : null;
  const check = analysis?.check ?? null;
  const nameOf = (id: string) => layers.find(l => l.id === id)?.name ?? id;

  const go = (action: Parameters<typeof nextPhase>[1]) => {
    const next = nextPhase(phase, action, check);
    if (next === 'closed') {
      abortRef.current?.abort();
      onClose();
      return;
    }
    if (phase === 'exporting' && action === 'cancel') {
      abortRef.current?.abort();
      return; // The running export finishes with ExportCancelled and moves on itself
    }
    setPhase(next);
    if (next === 'exporting') run();
  };

  const run = async () => {
    if (!analysis || !plan) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setMessage(null);
    setResult(null);
    setProgress({ frame: 0, total: Number(plan.frameCount) });
    try {
      const res = await exportLoopVideo({
        layers, gridDefaults, projectorSize, settings, analysis, probe, signal: abort.signal,
        onProgress: (frame, total) => setProgress({ frame, total }),
      });
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = URL.createObjectURL(res.blob);
      save(res);
      setResult(res);
      setPhase(p => nextPhase(p, 'finished', check));
    } catch (e) {
      if (e instanceof ExportCancelled) setMessage(t('export.cancelled'));
      else {
        console.error('Video export failed', e);
        setMessage(t('export.error.failed', { message: String((e as Error)?.message ?? e) }));
      }
      setPhase(p => nextPhase(p, e instanceof ExportCancelled ? 'cancel' : 'failed', check));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const save = (res: ExportResult) => {
    if (!downloadUrl.current) return;
    const a = document.createElement('a');
    a.href = downloadUrl.current;
    a.download = res.fileName;
    a.click();
  };

  const turnOff = (layerId: string, effectId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer?.effects) return;
    onUpdateLayer(layerId, { effects: layer.effects.map(e => (e.id === effectId ? { ...e, enabled: false } : e)) });
  };

  const fxName = (type: string) => {
    const key = `fx.${type}.name` as TranslationKey;
    const name = t(key);
    return name === key ? type : name;
  };

  const planErrorText = (e: LoopPlanError): string => {
    switch (e.reason) {
      case 'unknownDuration': return t('export.error.unknownDuration', { names: e.layerIds.map(nameOf).join(', ') });
      case 'invalidDuration': return t('export.error.invalidDuration', { names: e.layerIds.map(nameOf).join(', ') });
      case 'tooLong': return t('export.error.tooLong', { length: fmtLength(approxSeconds(e.duration)), max: Math.round(e.maxSeconds / 60) });
      default: return t('export.error.invalidFps');
    }
  };

  const exporting = phase === 'exporting';
  const canExport = !!plan && !exporting;
  const fpsSelect = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-50';

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" onClick={() => !exporting && onClose()}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto text-white" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 id="export-title" className="text-lg font-bold flex items-center gap-2"><Film size={20} className="text-emerald-400" /> {t('export.title')}</h2>
          <button onClick={() => go('cancel')} disabled={exporting} className="p-1.5 rounded-md hover:bg-slate-800 disabled:opacity-30" aria-label={t('export.close')}><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-300">{t('export.hint')}</p>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-slate-400">
              <span>{t('export.fps')}</span>
              <select value={fpsChoice} onChange={e => setFpsChoice(e.target.value)} disabled={exporting} className={fpsSelect}>
                <option value="auto">{t('export.fps.auto', { fps: fmtFps(autoFps) })}</option>
                {FPS_CHOICES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              <span>{t('export.size')}</span>
              <select value={sizeIndex} onChange={e => setSizeIndex(Number(e.target.value))} disabled={exporting} className={fpsSelect}>
                {SIZES.map((s, i) => <option key={i} value={i}>{s.w} × {s.h}</option>)}
              </select>
            </label>
          </div>

          {!analysis && !message && <p className="text-sm text-slate-400">{t('export.reading')}</p>}

          {analysis && analysis.videoLayers.length === 0 && (
            <label className="block space-y-1 text-xs text-slate-400">
              <span>{t('export.emptyLength')}</span>
              <input type="number" min="0.1" step="0.1" value={emptySeconds} onChange={e => setEmptySeconds(e.target.value)} disabled={exporting}
                className="w-32 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white" />
              <span className="block">{t('export.emptyHint')}</span>
            </label>
          )}

          {analysis && analysis.videoLayers.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('export.videos')}</h3>
              <ul className="space-y-1">
                {analysis.videoLayers.map((v, i) => {
                  const lp = plan?.layers[i];
                  const seconds = v.clips.reduce((s, c) => s + (c.timing.duration ? ratToNumber(c.timing.duration) : 0), 0);
                  const unknown = v.clips.some(c => !c.timing.duration);
                  return (
                    <li key={v.layer.id} className="flex items-center justify-between gap-2 text-sm bg-slate-800/60 rounded-lg px-3 py-1.5">
                      <span className="truncate">{v.layer.name}</span>
                      <span className="shrink-0 text-slate-300 font-mono text-xs">
                        {unknown ? '?' : `${fmtSeconds(seconds)} s`} · {v.clips.map(c => fmtFps(c.fps)).join(' + ')} fps
                        {lp && <span className="ml-2 inline-flex items-center gap-1 text-emerald-300"><Repeat size={12} /> × {String(lp.loops)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {plan && (
            <p className="text-sm font-semibold text-emerald-300">
              {t('export.total', { length: fmtLength(ratToNumber(plan.duration)), frames: String(plan.frameCount) })}
            </p>
          )}
          {planError && <p className="text-sm text-red-300 bg-red-950/40 border border-red-800 rounded-lg p-3">{planErrorText(planError)}</p>}

          {check && check.issues.length === 0 && check.effects.length > 0 && (
            <p className="text-xs text-slate-400">{t('export.effectsOk', { count: check.effects.length })}</p>
          )}

          {check && check.issues.length > 0 && (
            <div className={`rounded-xl border p-3 space-y-2 ${phase === 'warning' ? 'border-amber-400 bg-amber-950/50' : 'border-amber-700/60 bg-amber-950/20'}`}>
              <p className="text-sm font-semibold text-amber-300 flex items-center gap-2"><AlertTriangle size={16} /> {t('export.warn.title')}</p>
              <p className="text-xs text-amber-100/80">{t('export.warn.text')}</p>
              <ul className="space-y-1">
                {check.issues.map(issue => (
                  <li key={issue.effectId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-semibold">{issue.layerName}</span> · {fxName(issue.effectType)}
                      <span className="block text-xs text-amber-200/70">{t(ISSUE_TEXT[issue.issue!], { factor: (1 + issue.speedChange).toFixed(1) })}</span>
                    </span>
                    <span className="shrink-0 flex gap-1">
                      <button onClick={() => { turnOff(issue.layerId, issue.effectId); }} disabled={exporting}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"><EyeOff size={12} /> {t('export.warn.turnOff')}</button>
                      <button onClick={() => { onShowLayer(issue.layerId); onClose(); }} disabled={exporting}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"><Crosshair size={12} /> {t('export.warn.show')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {progress && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${(progress.frame / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <p className="text-xs text-slate-400">{t('export.progress', { frame: progress.frame, total: progress.total })} {t('export.wait')}</p>
            </div>
          )}

          {phase === 'done' && result && (
            <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded-lg p-3">{t('export.done', { name: result.fileName })}</p>
          )}
          {message && <p className="text-sm text-slate-200 bg-slate-800 rounded-lg p-3">{message}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-slate-800">
          {phase === 'exporting' ? (
            <button onClick={() => go('cancel')} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-semibold">{t('export.stop')}</button>
          ) : (
            <>
              <button onClick={() => go('cancel')} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">{phase === 'done' ? t('export.close') : t('export.cancel')}</button>
              {phase === 'done' && result && (
                <button onClick={() => save(result)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm flex items-center gap-1.5"><Download size={16} /> {t('export.download')}</button>
              )}
              {phase === 'warning' ? (
                <button onClick={() => go('ignore')} disabled={!canExport} className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-bold disabled:opacity-40">{t('export.warn.ignore')}</button>
              ) : (
                <button onClick={() => go('export')} disabled={!canExport} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-bold disabled:opacity-40 flex items-center gap-1.5"><Film size={16} /> {t('export.start')}</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ExportVideoDialog;
