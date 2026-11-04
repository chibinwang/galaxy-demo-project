import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { stageName } from '../../shared/constants';
import { fmtDate, fmtShortDate } from '../../shared/dates';
import type { Issue, OrderProgress, ProductionEntry } from '../../shared/types';
import { api, qs } from '../api';
import { Button, Card, Empty, ErrorNote, fmtN, IssueStatusBadge, Loading, OrderStatusBadge, PageHeader, ProgressBar, SourceTag } from '../components/ui';
import { useApp, useFetch } from '../state';
import { OrderFormModal } from './Orders';

interface Detail {
  progress: OrderProgress;
  entries: ProductionEntry[];
  issues: Issue[];
}

export default function OrderDetail() {
  const { id } = useParams();
  const { meta, changed, toast } = useApp();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const { data, error } = useFetch<Detail>(meta ? `/api/orders/${id}${qs({ date: meta.today })}` : null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const p = data.progress;
  const o = p.order;

  const remove = async () => {
    if (!confirm(`Delete order ${o.id}?`)) return;
    try {
      await api.del(`/api/orders/${o.id}`);
      toast(`Order ${o.id} deleted`);
      changed();
      navigate('/orders');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <Link to="/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Link>
      <PageHeader
        title={`${o.id} · ${p.productName}`}
        subtitle={`${o.customer} · ${fmtN(o.quantity)} pcs · released ${fmtShortDate(o.releaseDate)} · due ${fmtDate(o.dueDate)}${o.notes ? ` · ${o.notes}` : ''}`}
        actions={
          <>
            <OrderStatusBadge status={p.status} />
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {data.entries.length === 0 && (
              <Button size="sm" variant="danger" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Progress by stage" subtitle="Cumulative good units cleared at each stage, and units waiting to be processed.">
          <div className="space-y-3 px-5 pb-5">
            {p.stages.map((s) => {
              const v = (s.goodQty / o.quantity) * 100;
              return (
                <div key={s.stage} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 text-sm">
                  <div className="font-medium text-slate-700">
                    {stageName(s.stage)}
                    {p.currentStage === s.stage && <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-900 uppercase">Now</span>}
                  </div>
                  <ProgressBar value={v} tone={v >= 100 ? 'green' : 'blue'} className="h-2.5" />
                  <div className="num w-56 text-right text-xs text-slate-600">
                    {fmtN(s.goodQty)} good
                    {s.rejectQty > 0 && <span className="text-red-700"> · {fmtN(s.rejectQty)} rej</span>}
                    {s.waiting > 0 && <span className="font-medium text-amber-800"> · {fmtN(s.waiting)} waiting</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Delivery outlook">
          <div className="space-y-3 px-5 pb-5 text-sm">
            <Row label="Packed (finished)" value={`${fmtN(p.completedQty)} / ${fmtN(o.quantity)} (${p.completionPct}%)`} />
            <Row label="Remaining" value={fmtN(Math.max(0, o.quantity - p.completedQty))} />
            <Row label="Due date" value={fmtDate(o.dueDate, true)} />
            <Row label="Projected finish" value={p.projectedFinish ? fmtDate(p.projectedFinish, true) : 'Completed'} strong={p.status === 'at_risk' || p.status === 'delayed'} />
            {p.daysLate > 0 && <Row label={p.status === 'delayed' ? 'Overdue by' : 'Projected late by'} value={`${p.daysLate} day${p.daysLate > 1 ? 's' : ''}`} strong />}
            <Row label="Priority" value={o.priority} />
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              Projection: packing work on higher-priority/earlier orders plus this order's remainder, at the recent plant packing rate, plus transit through stages not yet reached.
            </p>
          </div>
        </Card>
      </div>

      {data.issues.length > 0 && (
        <Card className="mt-4" title="Linked actions">
          <div className="divide-y divide-slate-100">
            {data.issues.map((i) => (
              <Link key={i.id} to={`/exceptions?issue=${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                <span>
                  <span className="font-medium">{i.id}</span> · {i.title}
                </span>
                <IssueStatusBadge status={i.status} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4" title="Production records" subtitle={`${data.entries.length} shift entries`}>
        {data.entries.length === 0 ? (
          <Empty>
            No production recorded yet.{' '}
            <Link to="/production" className="font-medium text-sky-700 hover:underline">
              Record an entry →
            </Link>
          </Empty>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-y border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Shift</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Good</th>
                  <th className="px-3 py-2 text-right font-medium">Reject</th>
                  <th className="px-3 py-2 text-right font-medium">Down (min)</th>
                  <th className="px-3 py-2 font-medium">Supervisor</th>
                  <th className="px-5 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num px-5 py-2 whitespace-nowrap">{fmtShortDate(e.date)}</td>
                    <td className="px-3 py-2">{e.shift}</td>
                    <td className="px-3 py-2">{stageName(e.stage)}</td>
                    <td className="num px-3 py-2 text-right">{fmtN(e.goodQty)}</td>
                    <td className="num px-3 py-2 text-right">{fmtN(e.rejectQty)}</td>
                    <td className="num px-3 py-2 text-right">{e.downtimeMin || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{e.supervisor}</td>
                    <td className="px-5 py-2">
                      <SourceTag source={e.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <OrderFormModal open onClose={() => setEditing(false)} existing={o} />}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'num font-semibold text-red-700' : 'num font-medium text-slate-800'}>{value}</span>
    </div>
  );
}
