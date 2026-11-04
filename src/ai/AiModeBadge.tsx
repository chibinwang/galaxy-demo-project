import clsx from 'clsx';
import { ShieldCheck, XCircle, Zap } from 'lucide-react';
import type { AiMode } from '../../shared/ai';

const MODE: Record<AiMode, { label: string; cls: string; icon: typeof Zap }> = {
  autonomous: { label: 'Autonomous', cls: 'bg-violet-50 text-violet-700 ring-violet-200', icon: Zap },
  approved: { label: 'Approved by user', cls: 'bg-sky-50 text-sky-700 ring-sky-200', icon: ShieldCheck },
  rejected: { label: 'Declined', cls: 'bg-slate-50 text-slate-500 ring-slate-200', icon: XCircle },
};

export function AiModeBadge({ mode }: { mode: AiMode }) {
  const m = MODE[mode];
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ring-1 ring-inset', m.cls)}>
      <m.icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
