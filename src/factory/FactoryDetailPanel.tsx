import clsx from 'clsx';
import { ArrowRight, Info, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ISSUE_TYPE_LABEL, stageIndex } from '../../shared/constants';
import { fmtShortDate } from '../../shared/dates';
import type { Issue, OrderProgress, ProductionEntry } from '../../shared/types';
import { qs } from '../api';
import { Empty, fmtN, Loading, OrderStatusBadge, ProgressBar, SeverityBadge } from '../components/ui';
import { useFetch } from '../state';
import { zoneColor } from './FactoryZone';
import type { FactoryModel, IllustrativeZone, StageZone, Zone } from './model';

type Tab = 'overview' | 'orders' | 'exceptions';

export function FactoryDetailPanel({ zone, model, shortfallPct, onClose }: { zone: Zone; model: FactoryModel; shortfallPct: number; onClose: () => void }) {
  const color = zoneColor(zone);
  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]" aria-label={`${zone.name} details`}>
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{zone.kind === 'stage' ? `Stage ${stageIndex(zone.id) + 1} of 6` : 'Illustrative zone'}</div>
          <h3 className="text-lg font-semibold text-slate-900">{zone.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: color === '#fab219' ? '#b45309' : color }}>
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {zone.kind === 'stage' ? zone.statusLabel : 'Not tracked in v0.1'}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close details">
          <X className="h-5 w-5" />
        </button>
      </div>
      {zone.kind === 'stage' ? <StageDetails zone={zone} model={model} shortfallPct={shortfallPct} /> : <IllustrativeDetails zone={zone} model={model} />}
    </aside>
  );
}

function StageDetails({ zone, model, shortfallPct }: { zone: StageZone; model: FactoryModel; shortfallPct: number }) {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <div className="flex gap-4 border-b border-slate-100 px-5">
        {(
          [
            ['overview', 'Overview'],
            ['orders', 'Work orders'],
            ['exceptions', `Exceptions${zone.exceptions.length ? ` (${zone.exceptions.length})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx('-mb-px border-b-2 py-2.5 text-[13px] font-medium', tab === id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === 'overview' && <OverviewTab zone={zone} model={model} shortfallPct={shortfallPct} />}
        {tab === 'orders' && <OrdersTab zone={zone} date={model.date} />}
        {tab === 'exceptions' && <ExceptionsTab zone={zone} />}
      </div>
    </>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={clsx('num text-lg font-semibold', tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function OverviewTab({ zone, model, shortfallPct }: { zone: StageZone; model: FactoryModel; shortfallPct: number }) {
  const d = zone.day;
  const entries = useFetch<{ items: ProductionEntry[] }>(`/api/entries${qs({ from: model.date, to: model.date, stage: zone.id, limit: 500 })}`);
  const items = entries.data?.items ?? [];
  const byShift = ['A', 'B', 'C'].map((s) => ({ s, good: items.filter((e) => e.shift === s).reduce((a, e) => a + e.goodQty, 0), n: items.filter((e) => e.shift === s).length })).filter((x) => x.n > 0);
  const reasons = new Map<string, number>();
  for (const e of items) if (e.downtimeMin > 0) reasons.set(e.downtimeReason ?? 'Unspecified', (reasons.get(e.downtimeReason ?? 'Unspecified') ?? 0) + e.downtimeMin);
  const notes = [...new Map(items.filter((e) => e.notes).map((e) => [e.notes!, e])).values()];
  const noData = zone.condition === 'no_data';
  const bn = model.bottleneck;

  return (
    <div className="space-y-4">
      {zone.isBottleneck && bn && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-950">
          <div className="font-semibold">Constraining flow</div>
          {fmtN(bn.queue)} units are waiting in front of {zone.name} — {bn.daysOfWork} days of its daily plan. Downstream stages are limited by what it releases.
        </div>
      )}
      {noData ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-600">No shift report has been recorded for this stage on {fmtShortDate(model.date)}. Figures will appear once it is entered or imported.</div>
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">Good output vs plan</span>
              <span className="num text-xs text-slate-500">{d.attainmentPct}%</span>
            </div>
            <div className="num mt-0.5 text-2xl font-semibold text-slate-900">
              {fmtN(d.goodQty)} <span className="text-sm font-normal text-slate-400">/ {fmtN(d.target)} pcs</span>
            </div>
            <ProgressBar value={d.attainmentPct} tone={d.attainmentPct < shortfallPct ? 'red' : d.attainmentPct < 95 ? 'amber' : 'green'} className="mt-2 h-2" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Rejection rate" value={`${d.rejectRatePct}%`} sub={`limit ${d.rejectThresholdPct}% · ${fmtN(d.rejectQty)} units`} tone={d.processedQty >= 50 && d.rejectRatePct > d.rejectThresholdPct ? 'red' : undefined} />
            <Metric label="Downtime" value={`${d.downtimeMin} min`} sub={[...reasons.entries()].map(([r, m]) => `${r} ${m}m`).join(', ') || 'none recorded'} tone={d.downtimeMin > 60 ? 'amber' : undefined} />
            <Metric label="WIP waiting in front" value={stageIndex(zone.id) === 0 ? '—' : fmtN(d.queueBefore)} sub={stageIndex(zone.id) === 0 ? 'raw material not tracked' : 'good units from previous stage, not yet processed'} tone={zone.isBottleneck ? 'amber' : undefined} />
            <Metric label="Shift reports" value={d.entryCount} sub={byShift.map((x) => `Shift ${x.s}: ${fmtN(x.good)}`).join(' · ') || '—'} />
          </div>
          {notes.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">Supervisor remarks</div>
              <ul className="space-y-1.5">
                {notes.slice(0, 4).map((e) => (
                  <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    “{e.notes}” <span className="text-slate-400">— {e.supervisor}, Shift {e.shift}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="flex gap-1.5 text-[11px] text-slate-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0" /> Stage-level figures from daily shift reports. Machine-level telemetry (temperature, utilisation, live status) is not captured in v0.1. Equipment drawn in the scene is schematic.
      </p>
      <Link to="/production" className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline">
        Record or correct shift output <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function OrdersTab({ zone, date }: { zone: StageZone; date: string }) {
  const orders = useFetch<{ items: OrderProgress[] }>(`/api/orders${qs({ date })}`);
  const entries = useFetch<{ items: ProductionEntry[] }>(`/api/entries${qs({ from: date, to: date, stage: zone.id, limit: 500 })}`);
  if (!orders.data || !entries.data) return <Loading />;
  const i = stageIndex(zone.id);
  const today = new Map<string, number>();
  for (const e of entries.data.items) today.set(e.orderId, (today.get(e.orderId) ?? 0) + e.goodQty);
  const rows = orders.data.items
    .filter((o) => o.status !== 'completed' || today.has(o.order.id))
    .filter((o) => o.stages[i].waiting > 0 || today.has(o.order.id))
    .sort((a, b) => b.stages[i].waiting - a.stages[i].waiting || (today.get(b.order.id) ?? 0) - (today.get(a.order.id) ?? 0));
  if (!rows.length) return <Empty>No orders worked or waiting at {zone.name} on this date.</Empty>;
  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-slate-500">Orders processed here on {fmtShortDate(date)} or with units waiting for this stage.</p>
      {rows.map((o) => {
        const st = o.stages[i];
        return (
          <Link key={o.order.id} to={`/orders/${o.order.id}`} className="block rounded-xl border border-slate-200 px-3.5 py-3 hover:border-slate-300 hover:bg-slate-50/60">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-sky-700">{o.order.id}</span>
              <OrderStatusBadge status={o.status} />
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {o.productName} · due {fmtShortDate(o.order.dueDate)}
            </div>
            <ProgressBar value={(st.goodQty / o.order.quantity) * 100} className="mt-2" />
            <div className="num mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-600">
              <span>
                Cleared here {fmtN(st.goodQty)} / {fmtN(o.order.quantity)}
              </span>
              <span>Today {fmtN(today.get(o.order.id) ?? 0)}</span>
              {st.waiting > 0 && <span className="font-medium text-amber-800">{fmtN(st.waiting)} waiting</span>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ExceptionsTab({ zone }: { zone: StageZone }) {
  const issues = useFetch<Issue[]>(`/api/issues${qs({ status: 'active' })}`);
  const stageIssues = (issues.data ?? []).filter((i) => i.stage === zone.id);
  const linkedIds = new Set(zone.exceptions.map((e) => e.linkedIssueId).filter(Boolean));
  const otherOpen = stageIssues.filter((i) => !linkedIds.has(i.id));
  return (
    <div className="space-y-3">
      {zone.exceptions.length === 0 && <Empty>No exceptions detected at this stage for this date.</Empty>}
      {zone.exceptions.map((e) => {
        const issue = (issues.data ?? []).find((i) => i.id === e.linkedIssueId);
        return (
          <div key={e.key} className="rounded-xl border border-slate-200 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={e.severity} />
              <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{ISSUE_TYPE_LABEL[e.type]}</span>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold text-slate-900">{e.title}</div>
            <div className="mt-0.5 text-xs text-slate-600">{e.detail}</div>
            {issue ? (
              <div className="mt-2 rounded-lg bg-green-50 px-2.5 py-2 text-xs text-slate-700">
                <span className="font-semibold">{issue.id}</span> · {issue.owner ?? 'Unassigned'}
                {issue.dueDate && ` · due ${fmtShortDate(issue.dueDate)}`}
                {issue.correctiveAction && <div className="mt-0.5 text-slate-600">{issue.correctiveAction}</div>}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                <span className="font-medium">Suggested:</span> {e.suggestedAction}
                {e.similarIncidents[0] && e.similarIncidents[0].type === e.type && (
                  <div className="mt-0.5 text-violet-700">
                    Past fix ({e.similarIncidents[0].id}): {e.similarIncidents[0].correctiveAction}
                  </div>
                )}
              </div>
            )}
            <Link to={issue ? `/exceptions?issue=${issue.id}` : '/exceptions'} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline">
              {issue ? 'Open action' : 'Assign corrective action'} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        );
      })}
      {otherOpen.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Other open actions at this stage</div>
          {otherOpen.map((i) => (
            <Link key={i.id} to={`/exceptions?issue=${i.id}`} className="mb-1.5 block rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50">
              <span className="font-semibold">{i.id}</span> {i.title} <span className="text-slate-500">· {i.owner ?? 'Unassigned'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function IllustrativeDetails({ zone, model }: { zone: IllustrativeZone; model: FactoryModel }) {
  return (
    <div className="space-y-4 px-5 py-4 text-[13px] text-slate-700">
      <p>{zone.note}</p>
      {zone.id === 'finished' && model.hasData && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Packed today" value={fmtN(model.finishedOutput)} sub={`plan ${fmtN(model.finishedTarget)}`} />
          <Metric label="Plan attainment" value={`${model.attainmentPct}%`} />
        </div>
      )}
      <p className="text-[11px] text-slate-400">This area is included to show the full material journey. Its position, equipment and stock are illustrative, not Galaxy Taps data.</p>
      {zone.id === 'finished' && (
        <Link to="/orders" className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline">
          View order completion <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
