import clsx from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DayKpis, SeriesPoint } from '../../shared/calc';
import { stageName } from '../../shared/constants';
import { fmtShortDate } from '../../shared/dates';
import type { DetectedException, OrderProgress, StageDay, StageId } from '../../shared/types';
import { qs } from '../api';
import { OutputChart } from '../components/charts';
import { DatePicker } from '../components/DatePicker';
import { ExceptionCard } from '../components/ExceptionCard';
import { StageFlow } from '../components/StageFlow';
import { ViewSwitcher, type OverviewView } from '../components/ViewSwitcher';
import { FactoryView } from '../factory/FactoryView';
import { Card, Empty, ErrorNote, fmtN, Loading, OrderStatusBadge, PageHeader, ProgressBar } from '../components/ui';
import { useApp, useFetch } from '../state';

interface OverviewData {
  date: string;
  kpis: DayKpis;
  previous: DayKpis | null;
  stages: StageDay[];
  bottleneck: { stage: StageId; queue: number; daysOfWork: number } | null;
  trend: SeriesPoint[];
  exceptions: DetectedException[];
  orderCounts: Record<string, number>;
  attentionOrders: OrderProgress[];
  openIssues: number;
  overdueIssues: number;
}

function Delta({ now, prev, invert, unit = '' }: { now: number; prev?: number; invert?: boolean; unit?: string }) {
  if (prev === undefined) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <span className="text-xs text-slate-400">no change vs prev. day</span>;
  const good = invert ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={clsx('num inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-green-700' : 'text-red-700')}>
      <Icon className="h-3.5 w-3.5" />
      {d > 0 ? '+' : ''}
      {unit === '' ? fmtN(d) : d}
      {unit} <span className="font-normal text-slate-400">vs prev. day</span>
    </span>
  );
}

function Kpi({ label, value, sub, children, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; tone?: 'red' | 'amber' }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={clsx('num mt-1.5 text-[26px] leading-none font-semibold', tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      <div className="mt-2">{children}</div>
    </Card>
  );
}

export default function Overview() {
  const { meta, reportDate, setReportDate } = useApp();
  const { data, error, loading } = useFetch<OverviewData>(reportDate ? `/api/overview${qs({ date: reportDate })}` : null);
  // The view lives in the URL (?view=factory) so it survives refresh and never touches the shared date.
  const [params, setParams] = useSearchParams();
  const view: OverviewView = params.get('view') === 'factory' ? 'factory' : 'analytics';
  const setView = (v: OverviewView) => setParams(v === 'factory' ? { view: 'factory' } : {}, { replace: true });

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !meta) return <Loading />;
  const k = data.kpis;
  const p = data.previous ?? undefined;
  const sevCount = (s: string) => data.exceptions.filter((e) => e.severity === s).length;
  const atRisk = (data.orderCounts.at_risk ?? 0) + (data.orderCounts.delayed ?? 0);
  const activeOrders = Object.entries(data.orderCounts).filter(([s]) => s !== 'completed').reduce((a, [, n]) => a + n, 0);

  return (
    <div className={clsx(loading && 'opacity-70 transition-opacity')}>
      <PageHeader
        title="Production Overview"
        subtitle="Daily output against plan, stage flow, and what needs attention."
        actions={
          <>
            <ViewSwitcher value={view} onChange={setView} />
            <DatePicker value={data.date} onChange={setReportDate} max={meta.today} />
          </>
        }
      />

      {view === 'factory' ? (
        <div key="factory" className="view-in">
          <FactoryView data={data} shortfallPct={meta.settings.shortfallPct} />
        </div>
      ) : (
      <div key="analytics" className="view-in">

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Card className="col-span-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            Finished output (Packing)
            <span title="Factory output counts only units completing the final stage. Stage figures below are throughput and are never added together.">
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="num text-4xl leading-none font-semibold text-slate-900">{fmtN(k.finishedOutput)}</span>
            <span className="num text-sm text-slate-500">/ {fmtN(k.finishedTarget)} pcs planned</span>
          </div>
          <ProgressBar value={k.attainmentPct} tone={k.attainmentPct < meta.settings.shortfallPct ? 'red' : k.attainmentPct < 95 ? 'amber' : 'green'} className="mt-3 h-2" />
          <div className="mt-2 flex items-center justify-between">
            <Delta now={k.finishedOutput} prev={p?.finishedOutput} />
            <span className="num text-xs text-slate-500">{fmtN(Math.max(0, k.finishedTarget - k.finishedOutput))} short</span>
          </div>
        </Card>
        <Kpi label="Plan attainment" value={`${k.attainmentPct}%`} tone={k.attainmentPct < meta.settings.shortfallPct ? 'red' : undefined}>
          <Delta now={k.attainmentPct} prev={p?.attainmentPct} unit="pp" />
        </Kpi>
        <Kpi label="Rejection rate" value={`${k.rejectRatePct}%`} sub={`${fmtN(k.rejectQty)} units, all stages`}>
          <Delta now={k.rejectRatePct} prev={p?.rejectRatePct} invert unit="pp" />
        </Kpi>
        <Kpi label="Downtime" value={`${fmtN(k.downtimeMin)} min`} sub="across all stages">
          <Delta now={k.downtimeMin} prev={p?.downtimeMin} invert />
        </Kpi>
        <Kpi label="Orders needing attention" value={atRisk} tone={atRisk ? 'amber' : undefined} sub={`of ${activeOrders} open orders`}>
          <Link to="/orders" className="text-xs font-medium text-sky-700 hover:underline">
            View orders →
          </Link>
        </Kpi>
      </div>

      <Card
        className="mt-4"
        title="Stage flow"
        subtitle={
          data.bottleneck
            ? `${stageName(data.bottleneck.stage)} is constraining flow — ${fmtN(data.bottleneck.queue)} units waiting (${data.bottleneck.daysOfWork} days of capacity).`
            : 'Good output per stage vs daily plan; chips show WIP waiting in front of each stage.'
        }
        action={<span className="hidden text-[11px] text-slate-400 md:block">Stage figures are throughput, not additive</span>}
      >
        <div className="px-5 pb-5">
          {k.entryCount === 0 ? (
            <Empty>
              No production recorded for this date.{' '}
              <Link to="/production" className="font-medium text-sky-700 hover:underline">
                Record or import shift reports →
              </Link>
            </Empty>
          ) : (
            <StageFlow stages={data.stages} bottleneck={data.bottleneck?.stage} shortfallPct={meta.settings.shortfallPct} />
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Finished output — last 14 working days" subtitle="Bars: packed good units · Dashed line: daily plan · Click a bar to open that day">
          <div className="px-3 pb-4">
            <OutputChart data={data.trend} onSelect={setReportDate} selected={data.date} />
          </div>
        </Card>
        <Card
          className="xl:col-span-2"
          title="Exceptions today"
          subtitle={`${data.exceptions.length} detected · ${sevCount('critical')} critical · ${sevCount('high')} high · ${data.openIssues} open actions${data.overdueIssues ? ` (${data.overdueIssues} overdue)` : ''}`}
          action={
            <Link to="/exceptions" className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          <div className="max-h-[300px] space-y-2 overflow-y-auto px-5 pb-5">
            {data.exceptions.length === 0 && <Empty>No exceptions — all stages within limits.</Empty>}
            {data.exceptions.slice(0, 6).map((e) => (
              <ExceptionCard key={e.key} ex={e} compact />
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Orders needing attention" subtitle="Delayed or projected to miss their due date at the current packing rate.">
        {data.attentionOrders.length === 0 ? (
          <Empty>All open orders are on track.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Product / customer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Packed</th>
                  <th className="px-3 py-2 font-medium">Now at</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-5 py-2 font-medium">Projected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.attentionOrders.map((o) => (
                  <tr key={o.order.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-2.5 font-medium">
                      <Link to={`/orders/${o.order.id}`} className="text-sky-700 hover:underline">
                        {o.order.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-slate-800">{o.productName}</div>
                      <div className="text-xs text-slate-500">{o.order.customer}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap">
                      {fmtN(o.completedQty)} / {fmtN(o.order.quantity)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{o.currentStage ? stageName(o.currentStage) : '—'}</td>
                    <td className="num px-3 py-2.5 whitespace-nowrap">{fmtShortDate(o.order.dueDate)}</td>
                    <td className={clsx('num px-5 py-2.5 whitespace-nowrap', o.projectedFinish && o.projectedFinish > o.order.dueDate && 'font-medium text-red-700')}>
                      {o.projectedFinish ? fmtShortDate(o.projectedFinish) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
      )}
    </div>
  );
}
