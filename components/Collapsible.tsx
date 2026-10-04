import React from 'react';
import { ChevronRight } from 'lucide-react';

// A panel section that folds away behind its title, so the side panel stays short.
const Collapsible: React.FC<{
  title: React.ReactNode;
  icon?: React.ElementType;
  summary?: React.ReactNode; // Shown next to the title, e.g. the current value, so it can stay folded
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon: Icon, summary, defaultOpen = false, className = 'rounded-xl border border-slate-700 bg-slate-800/40', children }) => (
  <details className={`group ${className}`} open={defaultOpen}>
    <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-800/60 rounded-xl [&::-webkit-details-marker]:hidden">
      <ChevronRight size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
      {Icon && <Icon size={16} className="shrink-0 text-slate-400" />}
      <span className="flex-1 min-w-0">{title}</span>
      {summary && <span className="text-xs font-normal text-slate-400 truncate max-w-[45%]">{summary}</span>}
    </summary>
    <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>
  </details>
);

export default Collapsible;
