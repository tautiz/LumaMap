import React, { useEffect, useState } from 'react';
import { GridSettings, Layer } from '../types';
import { useI18n } from '../i18n';
import { DEFAULT_GRID, gridAspect, gridLayout, formatNumber, isPlainRectangle, proportionalPoints } from '../utils/grid';
import Collapsible from './Collapsible';
import { Grid3x3, RectangleHorizontal } from 'lucide-react';

interface GridSettingsPanelProps {
  layer: Layer;
  gridDefaults: GridSettings;
  setGridDefaults: (g: GridSettings) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  projectorSize: { w: number; h: number };
}

export const GRID_COLORS = ['#00ff00', '#ffffff', '#00e5ff', '#ff2d55', '#ffcc00', '#ff8800', '#b46bff'];

const parse = (text: string) => parseFloat(text.replace(',', '.').trim());

// A number box that accepts "1,5" as well as "1.5". While it is being typed in it keeps what is typed;
// otherwise it shows the current value, which may have been worked out from another field.
const NumberField: React.FC<{ label: string; value: number; onChange: (n: number) => void; suffix?: string; integer?: boolean; digits?: number }> = ({ label, value, onChange, suffix, integer, digits = 3 }) => {
  const { lang } = useI18n();
  const shown = formatNumber(value, lang, digits);
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
            if (Number.isFinite(n) && n > 0) onChange(integer ? Math.max(1, Math.round(n)) : n);
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

export const ColorPicker: React.FC<{ value: string; onChange: (c: string) => void; colors: string[]; label: string }> = ({ value, onChange, colors, label }) => (
  <div className="space-y-1.5">
    <span className="text-xs text-slate-400">{label}</span>
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={c}
          title={c}
          className={`w-7 h-7 rounded-full border-2 ${value.toLowerCase() === c ? 'border-white scale-110' : 'border-slate-700'}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-9 h-7 rounded cursor-pointer bg-transparent border border-slate-700"
      />
    </div>
  </div>
);

const GridSettingsPanel: React.FC<GridSettingsPanelProps> = ({ layer, gridDefaults, setGridDefaults, onUpdateLayer, projectorSize }) => {
  const { t, lang } = useI18n();
  const own = !!layer.grid;
  const grid = layer.grid ?? gridDefaults;
  const layout = gridLayout(grid);

  const update = (changes: Partial<GridSettings>) => {
    const next = { ...grid, ...changes };
    if (!own) {
      setGridDefaults(next); // also reshapes the elements that use the defaults and are not fitted yet
      return;
    }
    const updates: Partial<Layer> = { grid: next };
    if (gridAspect(next) !== gridAspect(grid) && isPlainRectangle(layer.points, layer.rotation)) {
      updates.points = proportionalPoints(gridAspect(next), projectorSize, layer.points, layer.rotation);
    }
    onUpdateLayer(layer.id, updates);
  };

  // Element sizes are kept in cm and shown in the chosen unit; cells are always in cm.
  const factor = grid.unit === 'm' ? 100 : 1;
  const n = (v: number, digits = 2) => formatNumber(v, lang, digits);
  const whole = (v: number) => Math.abs(v - Math.round(v)) < 0.01;

  // Cell size and cell count are both shown and both editable: changing one works out the other.
  const setCellSize = (changes: { cellWidth?: number; cellHeight?: number }) =>
    update({ mode: 'size', cellWidth: layout.cellWidth, cellHeight: layout.cellHeight, ...changes });
  const setCellCount = (changes: { columns?: number; rows?: number }) =>
    update({ mode: 'count', columns: Math.max(1, Math.round(layout.columns)), rows: Math.max(1, Math.round(layout.rows)), ...changes });

  const segment = (active: boolean) =>
    `flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${active ? 'bg-emerald-500 text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`;

  const summary = `${n(grid.width / factor)} × ${n(grid.height / factor)} ${grid.unit} · ${n(layout.columns, 1)} × ${n(layout.rows, 1)}`;

  return (
    <Collapsible title={t('grid.title')} icon={Grid3x3} summary={summary} className="rounded-lg border border-emerald-700/60 bg-emerald-500/5">
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
        {!isPlainRectangle(layer.points, layer.rotation) && (
          <button
            onClick={() => onUpdateLayer(layer.id, { points: proportionalPoints(gridAspect(grid), projectorSize, layer.points, layer.rotation) })}
            className="w-full mt-1 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700 flex items-center justify-center gap-1.5"
          >
            <RectangleHorizontal size={14} /> {t('grid.reshape')}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-xs font-semibold text-slate-300">{t('grid.cells')}</span>
        <div className="grid grid-cols-2 gap-2">
          <NumberField integer digits={1} label={t('grid.columns')} value={layout.columns} onChange={(v) => setCellCount({ columns: v })} />
          <NumberField integer digits={1} label={t('grid.rows')} value={layout.rows} onChange={(v) => setCellCount({ rows: v })} />
          <NumberField label={t('grid.cellWidth')} suffix="cm" value={layout.cellWidth} onChange={(v) => setCellSize({ cellWidth: v })} />
          <NumberField label={t('grid.cellHeight')} suffix="cm" value={layout.cellHeight} onChange={(v) => setCellSize({ cellHeight: v })} />
        </div>
        <p className="text-xs text-slate-500">{t('grid.cellsHint')}</p>
        {grid.mode === 'size' && (!whole(layout.columns) || !whole(layout.rows)) && (
          <p className="text-xs rounded-md bg-slate-900/70 px-2 py-1.5 text-amber-200">{t('grid.result.partial')}</p>
        )}
      </div>

      <ColorPicker label={t('grid.color')} colors={GRID_COLORS} value={grid.color || DEFAULT_GRID.color!} onChange={(c) => update({ color: c })} />

      <div className="space-y-2">
        <Toggle checked={grid.frame} onChange={(v) => update({ frame: v })}>{t('grid.frame')}</Toggle>
        <Toggle checked={grid.cellsTouch} onChange={(v) => update({ cellsTouch: v })}>
          {t('grid.cellsTouch')}
          <span className="block text-xs text-slate-500">{grid.cellsTouch ? t('grid.cellsTouch.on') : t('grid.cellsTouch.off')}</span>
        </Toggle>
      </div>
    </Collapsible>
  );
};

export default GridSettingsPanel;
