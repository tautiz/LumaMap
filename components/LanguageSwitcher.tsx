import React from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, Language, useI18n } from '../i18n';

const LanguageSwitcher: React.FC = () => {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="flex items-center gap-1 bg-slate-800 rounded-full p-1" role="group" aria-label={t('lang.label')}>
      <Languages size={16} className="text-slate-400 ml-1.5 mr-0.5" aria-hidden />
      {(Object.keys(LANGUAGES) as Language[]).map(code => (
        <button
          key={code}
          onClick={() => setLang(code)}
          title={LANGUAGES[code].label}
          aria-pressed={lang === code}
          className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
            lang === code ? 'bg-cyan-500 text-slate-900' : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
        >
          {LANGUAGES[code].short}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitcher;
