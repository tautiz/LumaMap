import React, { useEffect, useState } from 'react';
import { GridSettings, Layer } from '../types';
import { useI18n } from '../i18n';
import { gridLayout, formatNumber } from '../utils/grid';
import { Grid3x3 } from 'lucide-react';

interface GridSettingsPanelProps {
  layer: Layer;
  gridDefaults: GridSettings;
  setGridDefaults: (g: GridSettings) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
}

const parse = (text: string) => parseFloat(text.replace(',', '.').trim());

// A number box that accepts "1,5" as well as "1.5", and keeps what is typed until it is a valid number.
const NumberField: React.FC<{ label: string; value: number; onChange: (n: number) => void; suffix?: string; integer?: boolean }> = ({ label, value, onChange, suffix, integer }) => {
  const { lang } = useI18n();
  const shown = formatNumber(value, lang, integer ? 0 : 3);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(shown); }, [shown, focused]);

  return (
    <label className="block space-y-1 min-w-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center bg-slate-900 border border-slate-700 rounded-lg focus-within:border-emerald-500">
        <input
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            const n = parse(e.target.value);
            if (Number.isFinite(n) && n > 0) onChange(integer ? Math.round(n) : n);
          }}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm text-white focus:outline-none"
        />
        {suffix && <span className="pr-2 text-xs text-slate-500">{suffix}</span>}
      </span>
    </label>
  );
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ checked, onChange, children }) => (
  <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer select-none">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-emerald-500" />
    <span>{children}</span>
  </label>
);

const GridSettingsPanel: React.FC<GridSettingsPanelProps> = ({ layer, gridDefaults, setGridDefaults, onUpdateLayer }) => {
  const { t, lang } = useI18n();
  const own = !!layer.grid;
  const grid = layer.grid ?? gridDefaults;
  const update = (changes: Partial<GridSettings>) => {
    const next = { ...grid, ...changes };
    if (own) onUpdateLayer(layer.id, { grid: next });
    else setGridDefaults(next);
  };

  // Element sizes are kept in cm and shown in the chosen unit; cells are always in cm.
  const factor = grid.unit === 'm' ? 100 : 1;
  const layout = gridLayout(grid);
  const n = (v: number, digits = 2) => formatNumber(v, lang, digits);
  const whole = (v: number) => Math.abs(v - Math.round(v)) < 0.01;

  const segment = (active: boolean) =>
    `flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${active ? 'bg-emerald-500 text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`;

  return (
    <details className="group rounded-lg border border-emerald-700/60 bg-emerald-500/5" open>
      <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3 py-2 text-sm font-semibold text-emerald-200">
        <Grid3x3 size={16} /> {t('grid.title')}
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="flex gap-1 p-1 rounded-lg bg-slate-900 border border-slate-700">
          <button className={segment(!own)} onClick={() => own && onUpdateLayer(layer.id, { grid: null })}>{t('grid.useDefault')}</button>
          <button className={segment(own)} onClick={() => !own && onUpdateLayer(layer.id, { grid: { ...gridDefaults } })}>{t('grid.useOwn')}</button>
        </div>
        <p className="text-xs text-slate-400">{own ? t('grid.ownHint') : t('grid.defaultHint')}</p>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-300">{t('grid.size')}</span>
            <div className="flex gap-1">
              {(['m', 'cm'] as const).map(u => (
                <button key={u} onClick={() => update({ unit: u })} className={`px-2 py-0.5 rounded text-xs ${grid.unit === u ? 'bg-emerald-500 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-300'}`}>
                  {t(u === 'm' ? 'grid.unit.m' : 'grid.unit.cm')}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('grid.width')} suffix={grid.unit} value={grid.width / factor} onChange={(v) => update({ width: v * factor })} />
            <NumberField label={t('grid.height')} suffix={grid.unit} value={grid.height / factor} onChange={(v) => update({ height: v * factor })} />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-300">{t('grid.cells')}</span>
          <div className="flex gap-1 p-1 rounded-lg bg-slate-900 border border-slate-700">
            <button className={segment(grid.mode === 'size')} onClick={() => update({ mode: 'size' })}>{t('grid.mode.size')}</button>
            <button className={segment(grid.mode === 'count')} onClick={() => update({ mode: 'count' })}>{t('grid.mode.count')}</button>
          </div>
          {grid.mode === 'size' ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('grid.cellWidth')} suffix="cm" value={grid.cellWidth} onChange={(v) => update({ cellWidth: v })} />
              <NumberField label={t('grid.cellHeight')} suffix="cm" value={grid.cellHeight} onChange={(v) => update({ cellHeight: v })} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <NumberField integer label={t('grid.columns')} value={grid.columns} onChange={(v) => update({ columns: v })} />
              <NumberField integer label={t('grid.rows')} value={grid.rows} onChange={(v) => update({ rows: v })} />
            </div>
          )}
          <p className="text-xs rounded-md bg-slate-900/70 px-2 py-1.5 text-emerald-200">
            {grid.mode === 'size'
              ? t('grid.result.count', { columns: n(layout.columns, 1), rows: n(layout.rows, 1) })
              : t('grid.result.size', { width: n(layout.cellWidth), height: n(layout.cellHeight) })}
            {grid.mode === 'size' && (!whole(layout.columns) || !whole(layout.rows)) && (
              <span className="block text-slate-400">{t('grid.result.partial')}</span>
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Toggle checked={grid.frame} onChange={(v) => update({ frame: v })}>{t('grid.frame')}</Toggle>
          <Toggle checked={grid.cellsTouch} onChange={(v) => update({ cellsTouch: v })}>
            {t('grid.cellsTouch')}
            <span className="block text-xs text-slate-500">{grid.cellsTouch ? t('grid.cellsTouch.on') : t('grid.cellsTouch.off')}</span>
          </Toggle>
        </div>
      </div>
    </details>
  );
};

export default GridSettingsPanel;
