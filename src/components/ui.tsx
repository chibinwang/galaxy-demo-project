import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, Info, Loader2, X } from 'lucide-react';
import { Fragment, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { IssueStatus, OrderStatus, Severity } from '../../shared/types';

export const fmtN = (n: number) => n.toLocaleString('en-IN');

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={clsx('rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-slate-900 text-white hover:bg-slate-800',
        variant === 'brand' && 'bg-amber-500 text-slate-950 hover:bg-amber-400',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls = 'field rounded-lg border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(inputCls, 'num', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(inputCls, 'pr-8', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={clsx(inputCls, 'h-auto min-h-[72px] py-2', p.className)} />
);

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div className={clsx('w-full rounded-2xl bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// Status colours are reserved and always paired with an icon + label.
const SEV: Record<Severity, { cls: string; icon: typeof Info; label: string }> = {
  critical: { cls: 'bg-red-50 text-red-700 ring-red-200', icon: AlertOctagon, label: 'Critical' },
  high: { cls: 'bg-orange-50 text-orange-700 ring-orange-200', icon: AlertTriangle, label: 'High' },
  medium: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', icon: AlertTriangle, label: 'Medium' },
  low: { cls: 'bg-slate-50 text-slate-600 ring-slate-200', icon: Info, label: 'Low' },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEV[severity];
  const Icon = s.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', s.cls)}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

const ORDER_ST: Record<OrderStatus, { cls: string; label: string; icon: typeof Info }> = {
  completed: { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'Completed', icon: CheckCircle2 },
  on_track: { cls: 'bg-sky-50 text-sky-700 ring-sky-200', label: 'On track', icon: CircleDot },
  not_started: { cls: 'bg-slate-50 text-slate-600 ring-slate-200', label: 'Not started', icon: CircleDot },
  at_risk: { cls: 'bg-orange-50 text-orange-700 ring-orange-200', label: 'At risk', icon: AlertTriangle },
  delayed: { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'Delayed', icon: AlertOctagon },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_ST[status];
  const Icon = s.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset', s.cls)}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

const ISSUE_ST: Record<IssueStatus, { cls: string; label: string }> = {
  open: { cls: 'bg-slate-100 text-slate-700', label: 'Open' },
  in_progress: { cls: 'bg-sky-50 text-sky-700', label: 'In progress' },
  resolved: { cls: 'bg-green-50 text-green-700', label: 'Resolved' },
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const s = ISSUE_ST[status];
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', s.cls)}>{s.label}</span>;
}

export function SourceTag({ source }: { source: string }) {
  return (
    <span
      className={clsx(
        'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        source === 'demo' ? 'bg-amber-100 text-amber-800' : source === 'import' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600',
      )}
    >
      {source}
    </span>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-slate-500">
      {icon}
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 inline-flex rounded-xl bg-slate-200/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx('rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors', value === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'amber' | 'red' | 'green' | 'slate'; className?: string }) {
  const c = { blue: 'bg-series-1', amber: 'bg-warning', red: 'bg-critical', green: 'bg-good', slate: 'bg-slate-400' }[tone];
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={clsx('h-full rounded-full', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Render the small subset of markdown the brief uses: **bold**. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('**') ? <strong key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
