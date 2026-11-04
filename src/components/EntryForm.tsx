import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OrderProgress, ProductionEntry, Shift, StageId } from '../../shared/types';
import { api, ApiError, qs } from '../api';
import { useApp, useFetch } from '../state';
import { Button, ErrorNote, Field, fmtN, Input, Select } from './ui';

interface FormState {
  date: string;
  shift: Shift;
  stage: StageId;
  orderId: string;
  goodQty: string;
  rejectQty: string;
  downtimeMin: string;
  downtimeReason: string;
  supervisor: string;
  notes: string;
}

const STORAGE_KEY = 'everyse.entry.defaults';

function loadDefaults(): Partial<FormState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Manual production entry. Used for new entries and for editing an existing one. */
export function EntryForm({ initial, onSaved, onCancel, defaultDate }: { initial?: ProductionEntry; onSaved?: (e: ProductionEntry) => void; onCancel?: () => void; defaultDate?: string }) {
  const { meta, changed, toast } = useApp();
  const remembered = useMemo(loadDefaults, []);
  const blank = (): FormState => ({
    date: initial?.date ?? defaultDate ?? meta!.today,
    shift: initial?.shift ?? (remembered.shift as Shift) ?? 'A',
    stage: initial?.stage ?? (remembered.stage as StageId) ?? 'forging',
    orderId: initial?.orderId ?? '',
    goodQty: initial ? String(initial.goodQty) : '',
    rejectQty: initial ? String(initial.rejectQty) : '0',
    downtimeMin: initial ? String(initial.downtimeMin) : '0',
    downtimeReason: initial?.downtimeReason ?? '',
    supervisor: initial?.supervisor ?? remembered.supervisor ?? '',
    notes: initial?.notes ?? '',
  });
  const [f, setF] = useState<FormState>(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const orders = useFetch<{ items: OrderProgress[] }>(f.date ? `/api/orders${qs({ date: f.date })}` : null);
  const openOrders = (orders.data?.items ?? []).filter((o) => o.status !== 'completed' || o.order.id === f.orderId);

  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    setAvailable(null);
    if (!f.orderId || !f.stage || !f.date) return;
    let cancelled = false;
    api
      .get<{ available: number | null }>(`/api/entries/available${qs({ orderId: f.orderId, stage: f.stage, date: f.date, ignoreId: initial?.id })}`)
      .then((r) => !cancelled && setAvailable(r.available))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [f.orderId, f.stage, f.date, initial?.id]);

  const good = Number(f.goodQty || 0);
  const rej = Number(f.rejectQty || 0);
  const over = available !== null && good + rej > available;
  const stageIdx = meta!.stages.findIndex((s) => s.id === f.stage);
  const prevStage = stageIdx > 0 ? meta!.stages[stageIdx - 1].name : null;

  const submit = async () => {
    setSaving(true);
    setErrors([]);
    const body = {
      ...f,
      goodQty: f.goodQty === '' ? NaN : Number(f.goodQty),
      rejectQty: Number(f.rejectQty || 0),
      downtimeMin: Number(f.downtimeMin || 0),
      downtimeReason: Number(f.downtimeMin || 0) > 0 ? f.downtimeReason : '',
    };
    try {
      const saved = initial ? await api.put<ProductionEntry>(`/api/entries/${initial.id}`, body) : await api.post<ProductionEntry>('/api/entries', body);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ shift: f.shift, stage: f.stage, supervisor: f.supervisor }));
      } catch {
        /* storage unavailable */
      }
      toast(initial ? `Entry ${saved.id} updated` : `Saved ${saved.id}: ${fmtN(saved.goodQty)} good at ${meta!.stages[stageIdx].name} for ${saved.orderId}`);
      changed();
      onSaved?.(saved);
      // Keep date, shift, stage and supervisor — supervisors usually enter several orders for the same shift.
      if (!initial) setF((s) => ({ ...s, orderId: '', goodQty: '', rejectQty: '0', downtimeMin: '0', downtimeReason: '', notes: '' }));
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={f.date} max={meta!.today} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Shift">
          <Select value={f.shift} onChange={(e) => set('shift', e.target.value as Shift)}>
            {meta!.shifts.map((s) => (
              <option key={s} value={s}>
                Shift {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stage" className="col-span-2">
          <Select value={f.stage} onChange={(e) => set('stage', e.target.value as StageId)}>
            {meta!.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.description}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Work order"
        hint={
          f.orderId && available !== null ? (
            <span className={clsx('inline-flex items-center gap-1', over ? 'font-medium text-red-700' : 'text-slate-600')}>
              {over ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
              {prevStage ? `${fmtN(available)} units available from ${prevStage}` : `Up to ${fmtN(available)} more units can be forged for this order`}
              {over && ` — this entry would process ${fmtN(good + rej)}`}
            </span>
          ) : (
            'Only orders released by this date are listed.'
          )
        }
      >
        <Select value={f.orderId} onChange={(e) => set('orderId', e.target.value)} required>
          <option value="">{orders.loading ? 'Loading orders…' : 'Select order…'}</option>
          {openOrders.map((o) => (
            <option key={o.order.id} value={o.order.id}>
              {o.order.id} · {o.productName} · {fmtN(o.completedQty)}/{fmtN(o.order.quantity)} packed
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Good qty">
          <Input type="number" min={0} step={1} inputMode="numeric" value={f.goodQty} onChange={(e) => set('goodQty', e.target.value)} placeholder="0" required autoFocus={!initial} />
        </Field>
        <Field label="Reject qty">
          <Input type="number" min={0} step={1} inputMode="numeric" value={f.rejectQty} onChange={(e) => set('rejectQty', e.target.value)} />
        </Field>
        <Field label="Downtime (min)">
          <Input type="number" min={0} max={720} step={1} inputMode="numeric" value={f.downtimeMin} onChange={(e) => set('downtimeMin', e.target.value)} />
        </Field>
      </div>

      {Number(f.downtimeMin) > 0 && (
        <Field label="Downtime reason">
          <Select value={f.downtimeReason} onChange={(e) => set('downtimeReason', e.target.value)} required>
            <option value="">Select reason…</option>
            {meta!.downtimeReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supervisor">
          <Input list="supervisors" value={f.supervisor} onChange={(e) => set('supervisor', e.target.value)} placeholder="Name" required />
          <datalist id="supervisors">
            {meta!.supervisors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Remarks (optional)">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. die change, material late" />
        </Field>
      </div>

      {errors.length > 0 && (
        <ErrorNote>
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </ErrorNote>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {!initial && <span className="mr-auto self-center text-xs text-slate-500">Date, shift, stage and supervisor stay filled for the next entry.</span>}
        <Button type="submit" variant="primary" loading={saving}>
          {initial ? 'Save changes' : 'Save entry'}
        </Button>
      </div>
    </form>
  );
}
