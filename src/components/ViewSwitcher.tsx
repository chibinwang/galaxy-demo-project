import clsx from 'clsx';
import { Factory, LayoutDashboard } from 'lucide-react';

export type OverviewView = 'analytics' | 'factory';

const OPTIONS: { id: OverviewView; label: string; icon: typeof Factory }[] = [
  { id: 'analytics', label: 'Analytics', icon: LayoutDashboard },
  { id: 'factory', label: 'Factory View', icon: Factory },
];

/** Compact segmented control matching the date picker's height and styling. */
export function ViewSwitcher({ value, onChange }: { value: OverviewView; onChange: (v: OverviewView) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Overview view">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
            value === o.id ? 'bg-amber-50 text-slate-900 ring-1 ring-amber-200/70' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
          )}
        >
          <o.icon className="h-4 w-4" />
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
