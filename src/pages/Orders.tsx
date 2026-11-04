import clsx from 'clsx';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { STAGES, stageName } from '../../shared/constants';
import { addDays, fmtShortDate } from '../../shared/dates';
import type { Order, OrderProgress, OrderStatus } from '../../shared/types';
import { api, ApiError, qs } from '../api';
import { Button, Card, Empty, ErrorNote, Field, fmtN, Input, Loading, Modal, OrderStatusBadge, PageHeader, Select } from '../components/ui';
import { useApp, useFetch } from '../state';

const FILTERS: { id: 'open' | OrderStatus | 'all'; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'delayed', label: 'Delayed' },
  { id: 'at_risk', label: 'At risk' },
  { id: 'on_track', label: 'On track' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
];

/** Mini stage chain: each segment shows the share of the order that has cleared that stage. */
export function StageChain({ p }: { p: OrderProgress }) {
  return (
    <div className="flex gap-0.5" aria-label="Stage progress">
      {p.stages.map((s) => {
        const pctDone = Math.min(100, (s.goodQty / p.order.quantity) * 100);
        const isCurrent = p.currentStage === s.stage;
        return (
          <div key={s.stage} className="group relative w-full min-w-[22px]" title={`${stageName(s.stage)}: ${fmtN(s.goodQty)} / ${fmtN(p.order.quantity)} good${s.waiting ? ` · ${fmtN(s.waiting)} waiting` : ''}`}>
            <div className={clsx('h-2 overflow-hidden rounded-sm bg-slate-100', isCurrent && 'ring-1 ring-amber-400')}>
              <div className="h-full bg-series-1" style={{ width: `${pctDone}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Orders() {
  const { meta } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, loading, error } = useFetch<{ date: string; items: OrderProgress[]; upcoming: Order[] }>(meta ? `/api/orders${qs({ date: meta.today })}` : null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !meta) return <Loading />;

  const counts = (id: string) => (id === 'all' ? data.items.length : id === 'open' ? data.items.filter((o) => o.status !== 'completed').length : data.items.filter((o) => o.status === id).length);
  const s = search.trim().toLowerCase();
  const rows = data.items
    .filter((o) => (filter === 'all' ? true : filter === 'open' ? o.status !== 'completed' : o.status === filter))
    .filter((o) => !s || [o.order.id, o.productName, o.order.customer, o.order.productCode].some((v) => v.toLowerCase().includes(s)))
    .sort((a, b) => (filter === 'completed' ? b.order.dueDate.localeCompare(a.order.dueDate) : 0));

  return (
    <div className={clsx(loading && 'opacity-70')}>
      <PageHeader
        title="Orders & Stages"
        subtitle="Every work order's position across the six manufacturing stages, with projected completion at the current packing rate."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New work order
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx('rounded-full px-3 py-1.5 text-xs font-medium', filter === f.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
          >
            {f.label} <span className="num opacity-60">{counts(f.id)}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder="Search order, product, customer" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>No orders in this view.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Order</th>
                  <th className="px-3 py-2.5 font-medium">Product / customer</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="min-w-[200px] px-3 py-2.5 font-medium">
                    <div className="flex justify-between gap-0.5 text-[10px] tracking-wide uppercase">
                      {STAGES.map((st) => (
                        <span key={st.id} className="w-full text-center" title={st.name}>
                          {st.name.slice(0, 3)}
                        </span>
                      ))}
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">Packed</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="px-5 py-2.5 font-medium">Projected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((o) => (
                  <tr key={o.order.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium whitespace-nowrap">
                      <Link to={`/orders/${o.order.id}`} className="text-sky-700 hover:underline">
                        {o.order.id}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-slate-800">{o.productName}</div>
                      <div className="text-xs text-slate-500">{o.order.customer}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">{o.order.priority === 'High' ? <span className="font-semibold text-orange-700">High</span> : <span className="text-slate-500">{o.order.priority}</span>}</td>
                    <td className="px-3 py-3">
                      <StageChain p={o} />
                      <div className="mt-1 text-[11px] text-slate-500">{o.status === 'completed' ? 'Packed' : o.currentStage ? `At ${stageName(o.currentStage)}` : 'Not released to floor'}</div>
                    </td>
                    <td className="num px-3 py-3 text-right whitespace-nowrap">
                      {fmtN(o.completedQty)} <span className="text-slate-400">/ {fmtN(o.order.quantity)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="num px-3 py-3 whitespace-nowrap">{fmtShortDate(o.order.dueDate)}</td>
                    <td className={clsx('num px-5 py-3 whitespace-nowrap', o.projectedFinish && o.projectedFinish > o.order.dueDate ? 'font-medium text-red-700' : 'text-slate-600')}>
                      {o.projectedFinish ? fmtShortDate(o.projectedFinish) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.upcoming.length > 0 && <p className="mt-3 text-xs text-slate-500">{data.upcoming.length} order(s) have a future release date and are not shown yet.</p>}
      <OrderFormModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function OrderFormModal({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: Order }) {
  const { meta, changed, toast } = useApp();
  const navigate = useNavigate();
  const init = () => ({
    id: existing?.id ?? '',
    productCode: existing?.productCode ?? meta?.products[0]?.code ?? '',
    newProductCode: '',
    productName: '',
    customer: existing?.customer ?? '',
    quantity: existing ? String(existing.quantity) : '',
    releaseDate: existing?.releaseDate ?? meta?.today ?? '',
    dueDate: existing?.dueDate ?? (meta ? addDays(meta.today, 21) : ''),
    priority: existing?.priority ?? 'Normal',
    notes: existing?.notes ?? '',
  });
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const isNewProduct = f.productCode === '__new__';

  const save = async () => {
    setSaving(true);
    setErrors([]);
    const body = {
      ...f,
      productCode: isNewProduct ? f.newProductCode : f.productCode,
      productName: isNewProduct ? f.productName : undefined,
      quantity: Number(f.quantity),
    };
    try {
      const o = existing ? await api.put<Order>(`/api/orders/${existing.id}`, body) : await api.post<Order>('/api/orders', body);
      toast(existing ? `Order ${o.id} updated` : `Order ${o.id} created`);
      changed();
      onClose();
      if (!existing) navigate(`/orders/${o.id}`);
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  if (!meta) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? `Edit ${existing.id}` : 'New work order'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {existing ? 'Save changes' : 'Create order'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order number">
          <Input value={f.id} onChange={(e) => set('id', e.target.value.toUpperCase())} placeholder="e.g. WO-2001" disabled={!!existing} />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            <option>High</option>
            <option>Normal</option>
            <option>Low</option>
          </Select>
        </Field>
        <Field label="Product" className="col-span-2">
          <Select value={f.productCode} onChange={(e) => set('productCode', e.target.value)}>
            {meta.products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
                {p.source === 'demo' ? ' (demo)' : ''}
              </option>
            ))}
            <option value="__new__">+ Add a new product…</option>
          </Select>
        </Field>
        {isNewProduct && (
          <>
            <Field label="New product code">
              <Input value={f.newProductCode} onChange={(e) => set('newProductCode', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Product name">
              <Input value={f.productName} onChange={(e) => set('productName', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Customer" className="col-span-2">
          <Input value={f.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Dealer / distributor / project" />
        </Field>
        <Field label="Quantity (pcs)">
          <Input type="number" min={1} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <div />
        <Field label="Release date">
          <Input type="date" value={f.releaseDate} onChange={(e) => set('releaseDate', e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {errors.length > 0 && (
        <div className="mt-3">
          <ErrorNote>{errors.join(' ')}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
