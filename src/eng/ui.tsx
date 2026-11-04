import clsx from 'clsx';
import { AlertOctagon, CheckCircle2, CircleDashed, Cloud, FolderInput, HelpCircle, Sparkles, Upload, UserCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { CHAR_STATUS_LABEL, REVISION_STATUS_LABEL, SOURCE_LABEL, type CharStatus, type DrawingSource, type MeasureResult, type PlanStatus, type RevisionStatus } from '../../shared/eng';
import { PERSONAS, usePersona } from './data';

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset';

const REV_STYLE: Record<RevisionStatus, string> = {
  awaiting_review: 'bg-amber-50 text-amber-800 ring-amber-200',
  in_review: 'bg-sky-50 text-sky-700 ring-sky-200',
  approved: 'bg-green-50 text-green-700 ring-green-200',
  superseded: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export function RevisionBadge({ status }: { status: RevisionStatus }) {
  return <span className={clsx(pill, REV_STYLE[status])}>{status === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}{REVISION_STATUS_LABEL[status]}</span>;
}

const CHAR_STYLE: Record<CharStatus, string> = {
  extracted: 'bg-slate-50 text-slate-600 ring-slate-200',
  confirmed: 'bg-green-50 text-green-700 ring-green-200',
  flagged: 'bg-orange-50 text-orange-700 ring-orange-200',
  clarification: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function CharBadge({ status }: { status: CharStatus }) {
  return <span className={clsx(pill, CHAR_STYLE[status])}>{CHAR_STATUS_LABEL[status]}</span>;
}

const PLAN_STYLE: Record<PlanStatus, string> = { draft: 'bg-amber-50 text-amber-800 ring-amber-200', approved: 'bg-green-50 text-green-700 ring-green-200', superseded: 'bg-slate-100 text-slate-500 ring-slate-200' };
export function PlanBadge({ status }: { status: PlanStatus }) {
  return <span className={clsx(pill, PLAN_STYLE[status])}>{status === 'draft' ? 'Draft — not approved' : status === 'approved' ? 'Approved' : 'Superseded'}</span>;
}

const RESULT: Record<MeasureResult, { cls: string; label: string; icon: typeof CheckCircle2 }> = {
  pass: { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'Pass', icon: CheckCircle2 },
  fail: { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'Fail', icon: AlertOctagon },
  review: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'Needs review', icon: HelpCircle },
};
export function ResultBadge({ result, label }: { result: MeasureResult; label?: string }) {
  const r = RESULT[result];
  return (
    <span className={clsx(pill, r.cls)}>
      <r.icon className="h-3 w-3" />
      {label ?? r.label}
    </span>
  );
}

const SOURCE_ICON: Record<DrawingSource, typeof Upload> = { manual: Upload, portal: Cloud, folder: FolderInput };
export function SourceChip({ source }: { source: DrawingSource }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-slate-600">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function FormatChip({ format }: { format: string }) {
  const color = format === 'pdf' ? 'bg-red-50 text-red-700' : ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(format) ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700';
  return <span className={clsx('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase', color)}>{format}</span>;
}

export function SimulatedNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3.5 py-2.5 text-xs text-violet-900">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
      <div>{children}</div>
    </div>
  );
}

/** Demo identity switcher — used as reviewer / approver / inspector (no authentication in v0.1). */
export function PersonaPicker() {
  const [p, setP] = usePersona();
  return (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pr-1 pl-2.5 text-xs shadow-sm" title="Demo identity used for reviews, approvals and inspections (no login in v0.1)">
      <UserCircle2 className="h-4 w-4 text-slate-400" />
      <span className="hidden text-slate-500 sm:inline">Acting as</span>
      <select value={p} onChange={(e) => setP(e.target.value)} className="h-7 rounded-lg bg-slate-50 px-2 text-xs font-medium text-slate-800 outline-none">
        {PERSONAS.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
