import React, { useEffect, useState } from 'react';
import { X, Rocket, MousePointer2, Keyboard, Lightbulb } from 'lucide-react';
import { KeyMap } from '../types';
import { TranslationKey, formatKey, useI18n } from '../i18n';

interface HelpDialogProps {
  keyMappings: KeyMap;
  onClose: () => void;
}

type Tab = 'start' | 'mouse' | 'keys' | 'tips';

const TABS: { id: Tab; label: TranslationKey; icon: React.ElementType }[] = [
  { id: 'start', label: 'help.tab.start', icon: Rocket },
  { id: 'mouse', label: 'help.tab.mouse', icon: MousePointer2 },
  { id: 'keys', label: 'help.tab.keys', icon: Keyboard },
  { id: 'tips', label: 'help.tab.tips', icon: Lightbulb },
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-block min-w-[2rem] text-center px-2 py-1 rounded-md bg-slate-800 border border-slate-600 border-b-4 font-mono text-sm text-cyan-300">
    {children}
  </kbd>
);

const Row: React.FC<{ what: React.ReactNode; does: string }> = ({ what, does }) => (
  <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-800 last:border-0">
    <div className="text-slate-200 font-medium flex items-center gap-1.5 flex-wrap">{what}</div>
    <div className="text-slate-400 text-right text-sm">{does}</div>
  </div>
);

const HelpDialog: React.FC<HelpDialogProps> = ({ keyMappings, onClose }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('start');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps: { n: number; text: TranslationKey; color: string }[] = [
    { n: 1, text: 'help.start.s1', color: 'bg-cyan-500' },
    { n: 2, text: 'help.start.s2', color: 'bg-purple-500' },
    { n: 3, text: 'help.start.s3', color: 'bg-emerald-500' },
  ];

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 id="help-title" className="text-2xl font-bold text-white">{t('help.title')}</h2>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800" title={t('common.close')} aria-label={t('common.close')}>
            <X size={22} />
          </button>
        </div>

        <div className="flex gap-2 px-6 pb-3 border-b border-slate-800 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === id ? 'bg-cyan-500 text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Icon size={16} /> {t(label)}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 overflow-y-auto text-base leading-relaxed">
          {tab === 'start' && (
            <div className="space-y-4">
              <p className="text-slate-300">{t('help.start.what')}</p>
              {steps.map(s => (
                <div key={s.n} className="flex gap-3 items-start">
                  <span className={`shrink-0 w-8 h-8 rounded-full ${s.color} text-slate-900 font-bold flex items-center justify-center`}>{s.n}</span>
                  <p className="text-slate-200 pt-1">{t(s.text)}</p>
                </div>
              ))}
              <p className="text-slate-400 text-sm">💾 {t('help.start.s4')}</p>
            </div>
          )}

          {tab === 'mouse' && (
            <div>
              <Row what={t('help.mouse.dragDot')} does={t('help.mouse.dragDotDo')} />
              <Row what={t('help.mouse.dragPic')} does={t('help.mouse.dragPicDo')} />
              <Row what={t('help.mouse.rotate')} does={t('help.mouse.rotateDo')} />
              <Row what={t('help.mouse.dragEmpty')} does={t('help.mouse.dragEmptyDo')} />
              <Row what={t('help.mouse.wheel')} does={t('help.mouse.wheelDo')} />
              <Row what={t('help.mouse.click')} does={t('help.mouse.clickDo')} />
              <Row what={t('help.mouse.dbl')} does={t('help.mouse.dblDo')} />
              <Row what={t('help.mouse.right')} does={t('help.mouse.rightDo')} />
            </div>
          )}

          {tab === 'keys' && (
            <div>
              <Row what={<Kbd>{formatKey(keyMappings.NEXT_LAYER, t)}</Kbd>} does={t('setup.keys.next')} />
              <Row what={<Kbd>{formatKey(keyMappings.PREV_LAYER, t)}</Kbd>} does={t('setup.keys.prev')} />
              <Row what={<Kbd>{formatKey(keyMappings.BLACKOUT, t)}</Kbd>} does={t('setup.keys.blackout')} />
              <Row what={<Kbd>{formatKey(keyMappings.TOGGLE_UI, t)}</Kbd>} does={t('setup.keys.toggleUi')} />
              <Row what={<Kbd>{formatKey(keyMappings.TOGGLE_FRAME, t)}</Kbd>} does={t('setup.keys.toggleFrame')} />
              <Row what={<Kbd>{formatKey(keyMappings.TRIGGER_FX, t)}</Kbd>} does={t('setup.keys.trigger')} />
              <Row what={<><Kbd>1</Kbd>…<Kbd>9</Kbd></>} does={t('help.keys.numbersDo')} />
              <Row what={<><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd></>} does={t('help.keys.nudgeDo')} />
              <Row what={<><Kbd>Shift</Kbd>+<Kbd>←↑↓→</Kbd></>} does={t('help.keys.shiftDo')} />
              <Row what={<><Kbd>Q</Kbd><Kbd>E</Kbd></>} does={t('help.keys.rotateDo')} />
              <Row what={<Kbd>Esc</Kbd>} does={t('help.keys.escDo')} />
              <p className="text-slate-400 text-sm mt-4">{t('help.keys.changeHint')}</p>
              <p className="text-slate-500 text-sm mt-1">{t('help.keys.note')}</p>
            </div>
          )}

          {tab === 'tips' && (
            <ul className="space-y-3">
              {(['help.tips.t1', 'help.tips.t2', 'help.tips.t3', 'help.tips.t4', 'help.tips.t5'] as TranslationKey[]).map(k => (
                <li key={k} className="flex gap-3 text-slate-200">
                  <Lightbulb size={20} className="shrink-0 text-yellow-400 mt-0.5" />
                  <span>{t(k, { ui: formatKey(keyMappings.TOGGLE_UI, t) })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default HelpDialog;
