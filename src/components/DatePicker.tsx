import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, fmtDate, isWorkingDay } from '../../shared/dates';

/** Date input with previous/next working-day steppers. */
export function DatePicker({ value, onChange, max }: { value: string; onChange: (d: string) => void; max?: string }) {
  const step = (dir: 1 | -1) => {
    let d = addDays(value, dir);
    while (!isWorkingDay(d)) d = addDays(d, dir);
    if (max && d > max) return;
    onChange(d);
  };
  return (
    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => step(-1)} aria-label="Previous working day">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <label className="relative cursor-pointer px-1 text-sm font-medium text-slate-800">
        {fmtDate(value, true)}
        <input
          type="date"
          value={value}
          max={max}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Select date"
        />
      </label>
      <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" onClick={() => step(1)} disabled={!!max && value >= max} aria-label="Next working day">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
