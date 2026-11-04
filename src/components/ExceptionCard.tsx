import { BookOpen, ClipboardCheck, Lightbulb, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ISSUE_TYPE_LABEL, stageName } from '../../shared/constants';
import { fmtShortDate } from '../../shared/dates';
import type { DetectedException } from '../../shared/types';
import { Button, SeverityBadge } from './ui';

export function ExceptionCard({ ex, onCreateAction, compact }: { ex: DetectedException; onCreateAction?: (ex: DetectedException) => void; compact?: boolean }) {
  const [showMemory, setShowMemory] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={ex.severity} />
        <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{ISSUE_TYPE_LABEL[ex.type]}</span>
        {ex.stage && <span className="text-[11px] text-slate-400">· {stageName(ex.stage)}</span>}
        {ex.orderId && (
          <Link to={`/orders/${ex.orderId}`} className="text-[11px] font-medium text-sky-700 hover:underline">
            · {ex.orderId}
          </Link>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold text-slate-900">{ex.title}</h3>
      <p className="mt-1 text-[13px] text-slate-600">{ex.detail}</p>
      {!compact && (
        <>
          <div className="mt-3 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{ex.suggestedAction}</span>
          </div>
          {ex.similarIncidents.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowMemory((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:underline">
                <BookOpen className="h-3.5 w-3.5" />
                {showMemory ? 'Hide' : 'Show'} {ex.similarIncidents.length} similar past incident{ex.similarIncidents.length > 1 ? 's' : ''}
              </button>
              {showMemory && (
                <div className="mt-2 space-y-2">
                  {ex.similarIncidents.map((m) => (
                    <div key={m.id} className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {m.id} · {m.title} <span className="font-normal text-slate-500">({fmtShortDate(m.detectedDate)})</span>
                      </div>
                      {m.rootCause && (
                        <div className="mt-1">
                          <span className="font-medium">Root cause:</span> {m.rootCause}
                        </div>
                      )}
                      {m.correctiveAction && (
                        <div className="mt-0.5">
                          <span className="font-medium">Action taken:</span> {m.correctiveAction}
                        </div>
                      )}
                      {m.resolution && (
                        <div className="mt-0.5">
                          <span className="font-medium">Outcome:</span> {m.resolution}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {onCreateAction && (
        <div className="mt-3 flex justify-end">
          {ex.linkedIssueId ? (
            <Link to={`/exceptions?issue=${ex.linkedIssueId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:underline">
              <ClipboardCheck className="h-4 w-4" /> Action {ex.linkedIssueId} assigned
            </Link>
          ) : (
            <Button size="sm" variant="primary" onClick={() => onCreateAction(ex)}>
              <Plus className="h-3.5 w-3.5" /> Assign corrective action
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
