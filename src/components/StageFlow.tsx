import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import type { StageDay, StageId } from '../../shared/types';
import { fmtN, ProgressBar } from './ui';

/**
 * Stage-by-stage view of one day. Each card is that stage's throughput; the chip between cards is WIP waiting.
 * Stage figures are never summed — only Packing is factory output.
 */
export function StageFlow({ stages, bottleneck, shortfallPct }: { stages: StageDay[]; bottleneck?: StageId | null; shortfallPct: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {stages.map((s, i) => {
        const isBn = s.stage === bottleneck;
        const last = i === stages.length - 1;
        const noData = s.entryCount === 0 && s.target > 0;
        const tone = noData ? 'slate' : s.attainmentPct < shortfallPct ? 'red' : s.attainmentPct < 95 ? 'amber' : 'green';
        const rejHigh = s.processedQty >= 50 && s.rejectRatePct > s.rejectThresholdPct;
        return (
          <div
            key={s.stage}
            className={clsx(
              'relative flex flex-col rounded-xl border bg-white p-3.5',
              isBn ? 'border-amber-300 ring-2 ring-amber-200' : last ? 'border-slate-300 bg-slate-50/60' : 'border-slate-200',
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-slate-800">{s.name}</span>
              {isBn ? (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-900 uppercase">Bottleneck</span>
              ) : last ? (
                <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">Output</span>
              ) : null}
            </div>
            {i > 0 && (
              <div className={clsx('mb-2 flex items-center gap-1 text-[11px]', isBn ? 'font-semibold text-amber-800' : 'text-slate-500')}>
                <ArrowRight className="h-3 w-3" /> {fmtN(s.queueBefore)} waiting
              </div>
            )}
            {i === 0 && <div className="mb-2 text-[11px] text-slate-400">Raw brass in</div>}
            <div className="num text-xl font-semibold text-slate-900">
              {noData ? '—' : fmtN(s.goodQty)}
              <span className="text-xs font-normal text-slate-400"> / {fmtN(s.target)}</span>
            </div>
            <ProgressBar value={s.attainmentPct} tone={tone} className="mt-2" />
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span className="num">{noData ? 'No report' : `${s.attainmentPct}% of plan`}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px]">
              <span className={clsx('num inline-flex items-center gap-1', rejHigh ? 'font-semibold text-red-700' : 'text-slate-500')}>
                {rejHigh && <AlertTriangle className="h-3 w-3" />}Rej {s.rejectRatePct}%
              </span>
              <span className={clsx('num inline-flex items-center gap-1', s.downtimeMin > 60 ? 'font-semibold text-orange-700' : 'text-slate-500')}>
                <Clock className="h-3 w-3" />
                {s.downtimeMin}m
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
