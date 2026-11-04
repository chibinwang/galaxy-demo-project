import clsx from 'clsx';
import { Download, FileSpreadsheet, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { stageName } from '../../shared/constants';
import { fmtDate, fmtShortDate } from '../../shared/dates';
import type { ImportPreview } from '../../shared/importer';
import type { ProductionEntry } from '../../shared/types';
import { api, ApiError, qs } from '../api';
import { EntryForm } from '../components/EntryForm';
import { Button, Card, Empty, ErrorNote, Field, fmtN, Input, Loading, Modal, PageHeader, Select, SourceTag, Tabs } from '../components/ui';
import { useApp, useFetch } from '../state';

type Tab = 'entry' | 'import' | 'log';

export default function ProductionUpdates() {
  const [tab, setTab] = useState<Tab>('entry');
  return (
    <div>
      <PageHeader title="Production Updates" subtitle="Supervisors record shift output per stage — manually or by importing the plant's Excel/CSV sheets." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'entry', label: 'Record shift output' },
          { id: 'import', label: 'Import Excel / CSV' },
          { id: 'log', label: 'Entry log' },
        ]}
      />
      {tab === 'entry' && <EntryTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'log' && <LogTab />}
    </div>
  );
}

function EntryTab() {
  const { meta } = useApp();
  const [picked, setDate] = useState<string | null>(null);
  if (!meta) return <Loading />;
  const date = picked ?? meta.today;
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-2" title="New shift entry" subtitle="One record per order, stage and shift. Quantities are checked against what the previous stage has delivered.">
        <div className="px-5 pb-5">
          <EntryForm defaultDate={meta.today} onSaved={(e) => setDate(e.date)} />
        </div>
      </Card>
      <div className="xl:col-span-3">
        <DayEntries date={date} onDateChange={setDate} />
      </div>
    </div>
  );
}

function EntriesTable({ items, onEdit, onDelete, showDate }: { items: ProductionEntry[]; onEdit: (e: ProductionEntry) => void; onDelete: (e: ProductionEntry) => void; showDate?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
          <tr>
            {showDate && <th className="px-4 py-2 font-medium">Date</th>}
            <th className="px-4 py-2 font-medium">Shift</th>
            <th className="px-3 py-2 font-medium">Stage</th>
            <th className="px-3 py-2 font-medium">Order</th>
            <th className="px-3 py-2 text-right font-medium">Good</th>
            <th className="px-3 py-2 text-right font-medium">Reject</th>
            <th className="px-3 py-2 text-right font-medium">Down (min)</th>
            <th className="px-3 py-2 font-medium">Supervisor</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((e) => (
            <tr key={e.id} className="group hover:bg-slate-50/60">
              {showDate && <td className="num px-4 py-2 whitespace-nowrap">{fmtShortDate(e.date)}</td>}
              <td className="px-4 py-2">{e.shift}</td>
              <td className="px-3 py-2 whitespace-nowrap">{stageName(e.stage)}</td>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{e.orderId}</td>
              <td className="num px-3 py-2 text-right">{fmtN(e.goodQty)}</td>
              <td className={clsx('num px-3 py-2 text-right', e.rejectQty > 0 && 'text-red-700')}>{fmtN(e.rejectQty)}</td>
              <td className="num px-3 py-2 text-right" title={e.downtimeReason}>
                {e.downtimeMin || '—'}
              </td>
              <td className="max-w-[140px] truncate px-3 py-2 text-slate-600" title={e.notes}>
                {e.supervisor}
              </td>
              <td className="px-3 py-2">
                <SourceTag source={e.source} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100">
                  <button className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => onEdit(e)} aria-label={`Edit ${e.id}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => onDelete(e)} aria-label={`Delete ${e.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useEntryActions() {
  const { changed, toast } = useApp();
  const [editing, setEditing] = useState<ProductionEntry | null>(null);
  const remove = async (e: ProductionEntry) => {
    if (!confirm(`Delete ${e.id} (${e.orderId}, ${stageName(e.stage)}, Shift ${e.shift}, ${fmtN(e.goodQty)} good)?`)) return;
    try {
      await api.del(`/api/entries/${e.id}`);
      toast(`Deleted ${e.id}`);
      changed();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const modal = (
    <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.id}`} wide>
      {editing && <EntryForm key={editing.id} initial={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
    </Modal>
  );
  return { setEditing, remove, modal };
}

function DayEntries({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const { meta } = useApp();
  const { data, loading } = useFetch<{ total: number; items: ProductionEntry[] }>(`/api/entries${qs({ from: date, to: date, limit: 500 })}`);
  const { setEditing, remove, modal } = useEntryActions();
  const items = data?.items ?? [];
  const byStage = meta!.stages.map((s) => ({ ...s, good: items.filter((e) => e.stage === s.id).reduce((a, e) => a + e.goodQty, 0), n: items.filter((e) => e.stage === s.id).length }));
  return (
    <Card
      title={`Entries for ${fmtDate(date, true)}`}
      subtitle={`${items.length} shift records`}
      action={<Input type="date" value={date} max={meta!.today} onChange={(e) => e.target.value && onDateChange(e.target.value)} className="w-40" />}
    >
      <div className="grid grid-cols-3 gap-2 px-5 pb-4 sm:grid-cols-6">
        {byStage.map((s) => (
          <div key={s.id} className={clsx('rounded-lg border px-2.5 py-2', s.n ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50')}>
            <div className="truncate text-[11px] text-slate-500">{s.name}</div>
            <div className="num text-sm font-semibold">{s.n ? fmtN(s.good) : '—'}</div>
          </div>
        ))}
      </div>
      {loading && !data ? <Loading /> : items.length === 0 ? <Empty>No entries yet for this date.</Empty> : <EntriesTable items={items} onEdit={setEditing} onDelete={remove} />}
      {modal}
    </Card>
  );
}

function LogTab() {
  const { meta } = useApp();
  const [filters, setFilters] = useState({ from: '', to: '', stage: '', shift: '', orderId: '', q: '', source: '' });
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const { data, loading } = useFetch<{ total: number; items: ProductionEntry[] }>(`/api/entries${qs({ ...filters, limit: pageSize, offset: page * pageSize })}`);
  const { setEditing, remove, modal } = useEntryActions();
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };
  const pages = data ? Math.ceil(data.total / pageSize) : 0;
  return (
    <Card
      title="All production entries"
      subtitle={data ? `${fmtN(data.total)} records match` : undefined}
      action={
        <a href={`/api/export/entries.csv${qs({ from: filters.from, to: filters.to })}`}>
          <Button size="sm">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-2 px-5 pb-4 md:grid-cols-4 xl:grid-cols-7">
        <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
        <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        <Select value={filters.stage} onChange={(e) => set('stage', e.target.value)} aria-label="Stage">
          <option value="">All stages</option>
          {meta!.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={filters.shift} onChange={(e) => set('shift', e.target.value)} aria-label="Shift">
          <option value="">All shifts</option>
          {meta!.shifts.map((s) => (
            <option key={s} value={s}>
              Shift {s}
            </option>
          ))}
        </Select>
        <Select value={filters.source} onChange={(e) => set('source', e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          <option value="manual">Manual</option>
          <option value="import">Import</option>
          <option value="demo">Demo</option>
        </Select>
        <Input placeholder="Order (e.g. WO-1014)" value={filters.orderId} onChange={(e) => set('orderId', e.target.value.toUpperCase())} />
        <Input placeholder="Search supervisor, remarks…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
      </div>
      {loading && !data ? <Loading /> : !data?.items.length ? <Empty>No entries match these filters.</Empty> : <EntriesTable items={data.items} onEdit={setEditing} onDelete={remove} showDate />}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>
            Page {page + 1} of {pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      {modal}
    </Card>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-700',
  duplicate: 'bg-slate-100 text-slate-600',
  replace: 'bg-sky-50 text-sky-700',
};
const STATUS_LABEL: Record<string, string> = { ok: 'Ready', error: 'Error', duplicate: 'Skip', replace: 'Replace' };

function ImportTab() {
  const { changed, toast } = useApp();
  const [kind, setKind] = useState<'production' | 'orders'>('production');
  const [mode, setMode] = useState<'skip' | 'replace'>('skip');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<(ImportPreview & { filename: string; sheetName?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const runPreview = async (f: File, k = kind, m = mode) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.upload(`/api/import/preview${qs({ kind: k, mode: m })}`, f));
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    runPreview(f);
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.upload<{ added: number; replaced: number; skipped: number; errors: number }>(`/api/import/commit${qs({ kind, mode })}`, file);
      toast(`Imported ${r.added} new${r.replaced ? `, replaced ${r.replaced}` : ''}${r.skipped ? `, skipped ${r.skipped} duplicates` : ''}${r.errors ? `, ${r.errors} row${r.errors === 1 ? '' : 's'} with errors not imported` : ''}.`);
      changed();
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importable = preview ? preview.summary.ok + preview.summary.replacing : 0;
  const rows = preview?.rows.filter((r) => filter === 'all' || r.status === 'error') ?? [];
  const cols = kind === 'production' ? ['date', 'shift', 'orderId', 'stage', 'goodQty', 'rejectQty', 'downtimeMin', 'supervisor'] : ['id', 'productCode', 'productName', 'customer', 'quantity', 'releaseDate', 'dueDate', 'priority'];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Upload file" subtitle="Excel (.xlsx) or CSV. Column names are matched flexibly (e.g. “OK Qty”, “Rejection”, “WO No”, “Process”).">
        <div className="space-y-4 px-5 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data type">
              <Select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as typeof kind;
                  setKind(k);
                  if (file) runPreview(file, k, mode);
                }}
              >
                <option value="production">Production</option>
                <option value="orders">Work orders</option>
              </Select>
            </Field>
            <Field label="If a record already exists">
              <Select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as typeof mode;
                  setMode(m);
                  if (file) runPreview(file, kind, m);
                }}
              >
                <option value="skip">Skip it</option>
                <option value="replace">Replace it</option>
              </Select>
            </Field>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              choose(e.dataTransfer.files[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={clsx('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', drag ? 'border-amber-400 bg-amber-50' : 'border-slate-300 hover:bg-slate-50')}
          >
            <Upload className="mb-2 h-6 w-6 text-slate-400" />
            <div className="text-sm font-medium text-slate-700">{file ? file.name : 'Drop a file here or click to browse'}</div>
            <div className="mt-1 text-xs text-slate-500">.xlsx or .csv · up to 20,000 rows</div>
            <input ref={inputRef} type="file" accept=".xlsx,.csv,.xlsm" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="mb-2 font-medium text-slate-700">Templates</div>
            <div className="flex flex-wrap gap-2">
              {(['xlsx', 'csv'] as const).map((fmt) => (
                <a key={fmt} href={`/api/import/template${qs({ kind, format: fmt })}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {kind === 'production' ? 'Production' : 'Orders'} .{fmt}
                </a>
              ))}
            </div>
            {kind === 'production' && (
              <a href="/api/import/sample" className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Demo: sample Shift C sheet (.xlsx)
              </a>
            )}
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {kind === 'production' ? (
                <>
                  <li>Required: Date, Shift, Work Order, Stage, Good Qty.</li>
                  <li>Dates as 21-10-2026, 21/10/2026, 2026-10-21 or Excel dates.</li>
                  <li>Stage names like CNC, Buffing, Chrome plating, Packaging are recognised.</li>
                  <li>Rows are checked in process order so a stage never exceeds what the previous stage delivered.</li>
                </>
              ) : (
                <>
                  <li>Required: Work Order, Product Code, Quantity, Due Date.</li>
                  <li>New product codes need a Product Name column.</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </Card>

      <Card
        className="xl:col-span-2"
        title="Preview & validation"
        subtitle={preview ? `${preview.filename}${preview.sheetName ? ` · sheet “${preview.sheetName}”` : ''}` : 'Nothing is saved until you confirm.'}
        action={
          preview && (
            <Button variant="primary" onClick={commit} loading={busy} disabled={importable === 0 || preview.missingRequired.length > 0}>
              Import {importable} row{importable === 1 ? '' : 's'}
            </Button>
          )
        }
      >
        <div className="px-5 pb-5">
          {error && <ErrorNote>{error}</ErrorNote>}
          {busy && !preview && <Loading />}
          {!preview && !busy && !error && <Empty icon={<FileSpreadsheet className="h-8 w-8 text-slate-300" />}>Upload a file to see how each row will be imported.</Empty>}
          {preview && (
            <>
              {preview.missingRequired.length > 0 && (
                <ErrorNote>
                  Missing required column{preview.missingRequired.length > 1 ? 's' : ''}: <b>{preview.missingRequired.join(', ')}</b>. Found: {preview.columns.map((c) => c.source).join(', ')}.
                </ErrorNote>
              )}
              <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                {preview.columns.map((c) => (
                  <span key={c.source} className={clsx('rounded-md px-2 py-1', c.field ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400 line-through')} title={c.field ? `→ ${c.field}` : 'Ignored'}>
                    {c.source}
                    {c.field && <span className="text-slate-400"> → {c.field}</span>}
                  </span>
                ))}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Ready', preview.summary.ok, 'text-green-700'],
                  ['Replace', preview.summary.replacing, 'text-sky-700'],
                  ['Skip (duplicate)', preview.summary.duplicates, 'text-slate-600'],
                  ['Errors', preview.summary.errors, 'text-red-700'],
                ].map(([l, n, c]) => (
                  <div key={l as string} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="text-[11px] text-slate-500">{l}</div>
                    <div className={clsx('num text-lg font-semibold', c as string)}>{n}</div>
                  </div>
                ))}
              </div>
              {preview.summary.errors > 0 && (
                <div className="mb-2 flex gap-2 text-xs">
                  <button className={clsx('rounded-md px-2 py-1', filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100')} onClick={() => setFilter('all')}>
                    All rows
                  </button>
                  <button className={clsx('rounded-md px-2 py-1', filter === 'error' ? 'bg-slate-900 text-white' : 'bg-slate-100')} onClick={() => setFilter('error')}>
                    Errors only
                  </button>
                </div>
              )}
              <div className="max-h-[480px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Row</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      {cols.map((c) => (
                        <th key={c} className="px-2 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                      <th className="px-2 py-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 500).map((r) => (
                      <tr key={r.row} className={r.status === 'error' ? 'bg-red-50/30' : undefined}>
                        <td className="num px-2 py-1.5 text-slate-500">{r.row}</td>
                        <td className="px-2 py-1.5">
                          <span className={clsx('rounded px-1.5 py-0.5 font-semibold', STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                        </td>
                        {cols.map((c) => (
                          <td key={c} className="num px-2 py-1.5 whitespace-nowrap">
                            {String(r.data[c] ?? '')}
                          </td>
                        ))}
                        <td className="min-w-[260px] px-2 py-1.5 text-slate-600">{r.errors.join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 500 && <div className="p-2 text-center text-xs text-slate-500">Showing first 500 of {rows.length} rows.</div>}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
