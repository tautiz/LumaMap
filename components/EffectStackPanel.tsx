import React, { useMemo, useState } from 'react';
import { ContentType, GridSettings, Layer } from '../types';
import { TranslationKey, useI18n } from '../i18n';
import Collapsible from './Collapsible';
import { ColorPicker } from './GridSettingsPanel';
import {
  BLEND_MODES, ChainPreset, ColorSourceMode, EffectDefinition, EffectInstance, EffectRole, ParamDef,
  builtInPresets, createEffect, effectsMissingInput, elementColor, getEffect, instantiatePreset, listEffects,
  loadUserPresets, makesLayer, presetFromStack, resolveParams, saveUserPresets,
} from '../effects';
import {
  Wand2, Plus, Eye, EyeOff, ChevronUp, ChevronDown, Trash2, ChevronRight, AlertTriangle, Zap, Save, Layers3, X,
} from 'lucide-react';

interface EffectStackPanelProps {
  layer: Layer;
  layers: Layer[];
  contentLabel: string;
  gridDefaults: GridSettings;
  triggerKey: string;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
}

const COLORS = ['#ffffff', '#ff2d55', '#ff8800', '#ffcc00', '#00ff00', '#00e5ff', '#2d6bff', '#b46bff'];
const ROLE_ORDER: EffectRole[] = ['generator', 'modifier', 'overlay', 'underlay', 'mask', 'spatial'];
const ROLE_COLOR: Record<EffectRole, string> = {
  generator: 'bg-amber-400',
  modifier: 'bg-sky-400',
  overlay: 'bg-pink-400',
  underlay: 'bg-violet-400',
  mask: 'bg-slate-300',
  spatial: 'bg-emerald-400',
};
const COLOR_SOURCES: ColorSourceMode[] = ['custom', 'element', 'input', 'content', 'palette'];

const fxName = (t: (k: TranslationKey) => string, type: string) => t(`fx.${type}.name` as TranslationKey);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }> = ({ label, value, min, max, step, onChange, format }) => (
  <label className="block space-y-0.5">
    <span className="flex justify-between text-xs text-slate-400">
      <span>{label}</span>
      <span className="font-mono">{format ? format(value) : Math.round(value * 100) / 100}</span>
    </span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-fuchsia-500" />
  </label>
);

const Select: React.FC<{ label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <label className="block space-y-0.5">
    <span className="text-xs text-slate-400">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

const percent = (v: number) => `${Math.round(v * 100)}%`;

// One effect's settings: the shared ones (mixing, strength, colour, when it runs) and its own parameters.
const EffectSettings: React.FC<{ fx: EffectInstance; def: EffectDefinition; layer: Layer; layers: Layer[]; onChange: (patch: Partial<EffectInstance>) => void; onFire: () => void }> = ({ fx, def, layer, layers, onChange, onFire }) => {
  const { t } = useI18n();
  const params = resolveParams(fx, def);
  const setParam = (key: string, value: number | string | boolean) => onChange({ params: { ...fx.params, [key]: value } });
  // Masks and most modifiers only reshape the picture; they have no colour of their own.
  const usesColor = def.id === 'colorShift' || (def.role !== 'modifier' && def.role !== 'mask');
  const canPlace = makesLayer(def) || def.space === 'screen';

  const paramControl = (p: ParamDef) => {
    const label = t(`fx.param.${p.key}` as TranslationKey);
    if (p.type === 'number') {
      return <Slider key={p.key} label={label} value={params[p.key] as number} min={p.min} max={p.max} step={p.step} onChange={(v) => setParam(p.key, v)} />;
    }
    if (p.type === 'bool') {
      return (
        <label key={p.key} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none">
          <input type="checkbox" checked={params[p.key] === true} onChange={(e) => setParam(p.key, e.target.checked)} className="accent-fuchsia-500" />
          {label}
        </label>
      );
    }
    if (p.type === 'select') {
      return <Select key={p.key} label={label} value={params[p.key] as string} onChange={(v) => setParam(p.key, v)}
        options={p.options.map(o => ({ value: o, label: t(`fx.opt.${o}` as TranslationKey) }))} />;
    }
    return <Select key={p.key} label={label} value={params[p.key] as string} onChange={(v) => setParam(p.key, v)}
      options={[{ value: '', label: t('fx.target.point') }, ...layers.filter(l => l.id !== layer.id).map(l => ({ value: l.id, label: l.name }))]} />;
  };

  // A chosen target element replaces the X/Y point, so those sliders are hidden then.
  const hidden = (p: ParamDef) => (p.key === 'targetX' || p.key === 'targetY') && !!params.target;

  return (
    <div className="space-y-2.5 pt-2">
      <p className="text-xs text-slate-400">{t(`fx.${def.id}.desc` as TranslationKey)}</p>
      {def.params.filter(p => !hidden(p)).map(paramControl)}

      <div className="grid grid-cols-2 gap-2">
        <Slider label={t('fx.intensity')} value={fx.intensity} min={0} max={1} step={0.05} format={percent} onChange={(v) => onChange({ intensity: v })} />
        <Slider label={t('fx.opacity')} value={fx.opacity} min={0} max={1} step={0.05} format={percent} onChange={(v) => onChange({ opacity: v })} />
      </div>

      {def.role !== 'mask' && (
        <Select label={t('fx.blend')} value={fx.blend} onChange={(v) => onChange({ blend: v as EffectInstance['blend'] })}
          options={BLEND_MODES.map(b => ({ value: b, label: t(`fx.blend.${b}` as TranslationKey) }))} />
      )}

      {canPlace && (
        <Select label={t('fx.placement')} value={fx.placement ?? (def.role === 'underlay' ? 'under' : 'over')} onChange={(v) => onChange({ placement: v as 'over' | 'under' })}
          options={[{ value: 'over', label: t('fx.placement.over') }, { value: 'under', label: t('fx.placement.under') }]} />
      )}

      {usesColor && (
        <div className="space-y-1.5">
          <Select label={t('fx.color')} value={fx.color.mode} onChange={(v) => onChange({ color: { ...fx.color, mode: v as ColorSourceMode } })}
            options={COLOR_SOURCES.map(c => ({ value: c, label: t(`fx.colorSource.${c}` as TranslationKey) }))} />
          {fx.color.mode === 'custom' && (
            <ColorPicker label="" colors={COLORS} value={fx.color.color} onChange={(c) => onChange({ color: { ...fx.color, color: c } })} />
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-700 p-2 space-y-2">
        <Select label={t('fx.trigger')} value={fx.trigger.mode} onChange={(v) => onChange({ trigger: { ...fx.trigger, mode: v as 'always' | 'signal' } })}
          options={[{ value: 'always', label: t('fx.trigger.always') }, { value: 'signal', label: t('fx.trigger.signal') }]} />
        {fx.trigger.mode === 'signal' && (
          <>
            <Slider label={t('fx.trigger.duration')} value={fx.trigger.duration} min={0.2} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`}
              onChange={(v) => onChange({ trigger: { ...fx.trigger, duration: v } })} />
            <button onClick={onFire} className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold flex items-center justify-center gap-1.5">
              <Zap size={14} /> {t('fx.trigger.fire')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const EffectStackPanel: React.FC<EffectStackPanelProps> = ({ layer, layers, contentLabel, gridDefaults, triggerKey, onUpdateLayer }) => {
  const { t } = useI18n();
  const effects = layer.effects ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [userPresets, setUserPresets] = useState<ChainPreset[]>(loadUserPresets);
  const [presetName, setPresetName] = useState('');
  const missing = effectsMissingInput(layer);
  const presets = useMemo(builtInPresets, []);

  const setEffects = (next: EffectInstance[]) => onUpdateLayer(layer.id, { effects: next });
  const patch = (id: string, p: Partial<EffectInstance>) => setEffects(effects.map(e => (e.id === id ? { ...e, ...p } : e)));
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= effects.length) return;
    const next = [...effects];
    [next[index], next[j]] = [next[j], next[index]];
    setEffects(next);
  };
  const add = (type: string) => {
    const fx = createEffect(type);
    setEffects([...effects, fx]);
    setOpenId(fx.id);
    setPicking(false);
  };
  const fire = (only?: string) => {
    const now = Date.now();
    setEffects(effects.map(e => (e.enabled && e.trigger.mode === 'signal' && (!only || e.id === only) ? { ...e, trigger: { ...e.trigger, firedAt: now } } : e)));
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || effects.length === 0) return;
    const next = [...userPresets, presetFromStack(name, effects)];
    setUserPresets(next);
    saveUserPresets(next);
    setPresetName('');
  };
  const deletePreset = (id: string) => {
    const next = userPresets.filter(p => p.id !== id);
    setUserPresets(next);
    saveUserPresets(next);
  };

  // A plain colour or gradient content is the element colour; otherwise the element keeps its own.
  const ownColor = layer.source?.type === ContentType.COLOR || layer.source?.type === ContentType.GRADIENT;
  const setElementColor = (c: string) =>
    onUpdateLayer(layer.id, ownColor ? { source: { ...layer.source!, color: c } } : { color: c });

  const hasSignals = effects.some(e => e.enabled && e.trigger.mode === 'signal');
  const byRole = ROLE_ORDER.map(role => ({ role, defs: listEffects().filter(d => d.role === role) }));

  return (
    <Collapsible title={t('fx.title')} icon={Wand2} summary={effects.length ? String(effects.length) : undefined} defaultOpen>
      <p className="text-xs text-slate-400">{t('fx.hint')}</p>

      {/* The stack, top to bottom in the order it is drawn: content first, then each effect. */}
      <ol className="space-y-1.5">
        <li className="flex items-center gap-2 rounded-lg bg-slate-900/80 border border-slate-700 px-2.5 py-2 text-sm">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t('fx.content')}</span>
          <span className="truncate text-slate-200">{contentLabel}</span>
        </li>
        {effects.length === 0 && <li className="text-xs text-slate-500 px-1">{t('fx.empty')}</li>}
        {effects.map((fx, i) => {
          const def = getEffect(fx.type);
          if (!def) return null;
          const open = openId === fx.id;
          return (
            <li key={fx.id} className={`rounded-lg border ${open ? 'border-fuchsia-500/60 bg-slate-900' : 'border-slate-700 bg-slate-900/60'}`}>
              <div className="flex items-center gap-1 px-1.5 py-1.5">
                <button onClick={() => patch(fx.id, { enabled: !fx.enabled })} title={fx.enabled ? t('fx.off') : t('fx.on')} aria-label={fx.enabled ? t('fx.off') : t('fx.on')}
                  className={`p-1 rounded hover:bg-slate-700 ${fx.enabled ? 'text-white' : 'text-slate-600'}`}>
                  {fx.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={() => setOpenId(open ? null : fx.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left" title={t('fx.edit')}>
                  <span className="text-xs text-slate-500 w-4 text-right">{i + 1}.</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ROLE_COLOR[def.role]}`} title={t(`fx.role.${def.role}` as TranslationKey)} />
                  <span className={`truncate text-sm ${fx.enabled ? 'text-slate-100' : 'text-slate-500 line-through'}`}>{fxName(t, fx.type)}</span>
                  {fx.trigger.mode === 'signal' && <Zap size={12} className="shrink-0 text-amber-400" />}
                  {missing.has(fx.id) && <AlertTriangle size={14} className="shrink-0 text-yellow-400" />}
                </button>
                <button onClick={() => move(i, -1)} title={t('fx.up')} aria-label={t('fx.up')} className="p-1 rounded text-slate-400 hover:bg-slate-700 hover:text-white"><ChevronUp size={14} /></button>
                <button onClick={() => move(i, 1)} title={t('fx.down')} aria-label={t('fx.down')} className="p-1 rounded text-slate-400 hover:bg-slate-700 hover:text-white"><ChevronDown size={14} /></button>
                <button onClick={() => setEffects(effects.filter(e => e.id !== fx.id))} title={t('fx.remove')} aria-label={t('fx.remove')} className="p-1 rounded text-slate-400 hover:bg-slate-700 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              {missing.has(fx.id) && <p className="px-2.5 pb-1.5 text-xs text-yellow-300">{t('fx.needsInput')}</p>}
              {open && (
                <div className="px-2.5 pb-2.5">
                  <EffectSettings fx={fx} def={def} layer={layer} layers={layers} onChange={(p) => patch(fx.id, p)} onFire={() => fire(fx.id)} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {picking ? (
        <div className="rounded-xl border border-fuchsia-500/50 bg-slate-900 p-2.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">{t('fx.addTitle')}</span>
            <button onClick={() => setPicking(false)} title={t('common.close')} aria-label={t('common.close')} className="p-1 rounded text-slate-400 hover:bg-slate-700"><X size={16} /></button>
          </div>
          {byRole.map(({ role, defs }) => (
            <div key={role} className="space-y-1">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span className={`w-2 h-2 rounded-full ${ROLE_COLOR[role]}`} /> {t(`fx.role.${role}` as TranslationKey)}
              </span>
              <div className="flex flex-wrap gap-1">
                {defs.map(d => (
                  <button key={d.id} onClick={() => add(d.id)} title={t(`fx.${d.id}.desc` as TranslationKey)}
                    className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-fuchsia-500 hover:text-white">
                    {fxName(t, d.id)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <button onClick={() => setPicking(true)} className="w-full py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-semibold flex items-center justify-center gap-1.5">
          <Plus size={16} /> {t('fx.add')}
        </button>
      )}

      {hasSignals && (
        <div className="space-y-1">
          <button onClick={() => fire()} className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold flex items-center justify-center gap-1.5">
            <Zap size={16} /> {t('fx.trigger.fireAll')}
          </button>
          <p className="text-[11px] text-slate-500">{t('fx.trigger.hint', { key: triggerKey })}</p>
        </div>
      )}

      <div className="space-y-1">
        <ColorPicker label={t('fx.elementColor')} colors={COLORS} value={elementColor(layer, gridDefaults)} onChange={setElementColor} />
        <p className="text-[11px] text-slate-500">{t('fx.elementColorHint')}</p>
      </div>

      <Collapsible title={t('fx.presets')} icon={Layers3} className="rounded-lg border border-slate-700">
        <p className="text-xs text-slate-400">{t('fx.presets.hint')}</p>
        <div className="flex flex-wrap gap-1">
          {presets.map(p => (
            <button key={p.id} onClick={() => setEffects(instantiatePreset(p))}
              className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-fuchsia-500 hover:text-white">
              {t(p.name as TranslationKey)}
            </button>
          ))}
        </div>
        <span className="block text-xs font-semibold text-slate-300">{t('fx.presets.mine')}</span>
        {userPresets.length === 0 && <p className="text-xs text-slate-500">{t('fx.presets.none')}</p>}
        <div className="space-y-1">
          {userPresets.map(p => (
            <div key={p.id} className="flex items-center gap-1">
              <button onClick={() => setEffects(instantiatePreset(p))} className="flex-1 min-w-0 truncate text-left px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:border-fuchsia-500">
                {p.name}
              </button>
              <button onClick={() => deletePreset(p.id)} title={t('fx.presets.delete')} aria-label={t('fx.presets.delete')} className="p-1 rounded text-slate-400 hover:bg-slate-700 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {effects.length > 0 && (
          <div className="flex gap-1">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t('fx.presets.name')}
              onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white" />
            <button onClick={savePreset} disabled={!presetName.trim()} title={t('fx.presets.save')} aria-label={t('fx.presets.save')}
              className="px-2.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white"><Save size={16} /></button>
          </div>
        )}
      </Collapsible>
    </Collapsible>
  );
};

export default EffectStackPanel;
