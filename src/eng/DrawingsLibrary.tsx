import clsx from 'clsx';
import { ArrowDownUp, Cloud, FolderInput, Plug, Search, Upload, UploadCloud } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtShortDate } from '../../shared/dates';
import type { DrawingRevision } from '../../shared/eng';
import { api, ApiError, qs } from '../api';
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, Select } from '../components/ui';
import { useApp } from '../state';
import { fmtBytes, latestRevision, revisionsOf, useEng, type EngPayload } from './data';
import { EngPage } from './DemoGuide';
import { FormatChip, RevisionBadge, SourceChip } from './ui';

const CONNECTOR_ICON = { manual: Upload, portal: Cloud, folder: FolderInput, pdm: Plug } as const;

function ConnectedSources({ data, onUpload }: { data: EngPayload; onUpload: () => void }) {
  const { changed, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const receive = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.post<DrawingRevision>(`/api/eng/connectors/${id}/receive`);
      toast(`Received ${r.id} (${r.fileName}) via ${id === 'portal' ? 'Designer Portal' : 'Shared Folder'} — demo connector`);
      changed();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Connected sources" subtitle="How engineering drawings reach Everyse. Demo connectors simulate inbound files with synthetic data — no external system is connected.">
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
        {data.connectors.map((c) => {
          const Icon = CONNECTOR_ICON[c.id as keyof typeof CONNECTOR_ICON] ?? Plug;
          return (
            <div key={c.id} className={clsx('flex flex-col rounded-xl border p-3.5', c.status === 'planned' ? 'border-dashed border-slate-300 bg-slate-50/60' : 'border-slate-200 bg-white')}>
              <div className="flex items-center gap-2">
                <span className={clsx('flex h-8 w-8 items-center justify-center rounded-lg', c.status === 'available' ? 'bg-green-50 text-green-700' : c.status === 'demo' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-400')}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{c.name}</div>
                  <div className={clsx('text-[11px] font-semibold', c.status === 'available' ? 'text-green-700' : c.status === 'demo' ? 'text-violet-700' : 'text-slate-400')}>
                    {c.status === 'available' ? '● Available' : c.status === 'demo' ? '● Demo connector' : '○ Planned'}
                  </div>
                </div>
              </div>
              <p className="mt-2 flex-1 text-xs text-slate-500">{c.description}</p>
              {c.id === 'manual' && (
                <Button size="sm" className="mt-3" onClick={onUpload}>
                  <Upload className="h-3.5 w-3.5" /> Upload drawing
                </Button>
              )}
              {c.status === 'demo' && (
                <Button size="sm" className="mt-3" onClick={() => receive(c.id)} loading={busy === c.id}>
                  Simulate inbound drawing
                </Button>
              )}
              {c.status === 'planned' && <div className="mt-3 text-[11px] text-slate-400">Webhook / API ingestion endpoint reserved for a future phase.</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function UploadModal({ file, data, onClose }: { file: File; data: EngPayload; onClose: () => void }) {
  const { changed, toast } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'new' | 'revision'>('new');
  const [f, setF] = useState({ drawingId: data.drawings[0]?.id ?? '', partSku: '', partName: '', customer: '', material: '', rev: '', workOrderId: '', notes: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();

  const submit = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const params = mode === 'revision' ? { drawingId: f.drawingId, rev: f.rev, workOrderId: f.workOrderId, notes: f.notes } : { partSku: f.partSku, partName: f.partName, customer: f.customer, material: f.material, rev: f.rev || 'A', workOrderId: f.workOrderId, notes: f.notes };
      const r = await api.upload<DrawingRevision>(`/api/eng/upload${qs(params)}`, file);
      toast(`Uploaded ${r.id} — ${r.fileName}`);
      changed();
      onClose();
      navigate(`/eng/drawings/${r.id}`);
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Register uploaded drawing"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Upload
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <FormatChip format={ext} />
        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
        <span className="text-xs text-slate-500">{fmtBytes(file.size)}</span>
      </div>
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
        {(
          [
            ['new', 'New drawing'],
            ['revision', 'New revision of existing'],
          ] as const
        ).map(([id, l]) => (
          <button key={id} onClick={() => setMode(id)} className={clsx('rounded-md px-3 py-1.5 font-medium', mode === id ? 'bg-white shadow-sm' : 'text-slate-500')}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {mode === 'revision' ? (
          <Field label="Drawing" className="col-span-2" hint="Previous revisions are preserved; approved requirements stay in force until this revision is approved.">
            <Select value={f.drawingId} onChange={(e) => set('drawingId', e.target.value)}>
              {data.drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.partSku} · {d.partName}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Part / SKU">
              <Input value={f.partSku} onChange={(e) => set('partSku', e.target.value.toUpperCase())} placeholder="OEM-XX-00" />
            </Field>
            <Field label="Part name">
              <Input value={f.partName} onChange={(e) => set('partName', e.target.value)} />
            </Field>
            <Field label="Customer / OEM">
              <Input value={f.customer} onChange={(e) => set('customer', e.target.value)} />
            </Field>
            <Field label="Material">
              <Input value={f.material} onChange={(e) => set('material', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Revision" hint={mode === 'revision' ? 'Leave blank for the next letter' : 'Default A'}>
          <Input value={f.rev} onChange={(e) => set('rev', e.target.value.toUpperCase())} maxLength={6} />
        </Field>
        <Field label="Work order (optional)">
          <Select value={f.workOrderId} onChange={(e) => set('workOrderId', e.target.value)}>
            <option value="">—</option>
            {data.workOrders.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. customer ECN reference" />
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

type SortKey = 'id' | 'partSku' | 'uploadedAt' | 'status' | 'customer';

export default function DrawingsLibrary() {
  const { data, error } = useEng();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'uploadedAt', dir: -1 });
  const [pending, setPending] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const rows = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.drawings
      .map((d) => ({ d, r: latestRevision(data, d.id)!, revCount: revisionsOf(data, d.id).length }))
      .filter((x) => x.r)
      .filter(({ d, r }) => !s || [d.id, d.partSku, d.partName, d.customer, d.material, r.fileName, r.rev, r.workOrderId ?? ''].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => {
        const v = (x: typeof a) => (sort.key === 'id' ? x.d.id : sort.key === 'partSku' ? x.d.partSku : sort.key === 'customer' ? x.d.customer : sort.key === 'status' ? x.r.status : x.r.uploadedAt);
        return v(a).localeCompare(v(b)) * sort.dir;
      });
  }, [data, search, sort]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-3 py-2.5 font-medium">
      <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))}>
        {children}
        <ArrowDownUp className={clsx('h-3 w-3', sort.key === k ? 'text-slate-700' : 'text-slate-300')} />
      </button>
    </th>
  );

  return (
    <EngPage title="Drawings Library" subtitle="Engineering drawings received from OEM customers, with revision history and review status.">
      <ConnectedSources data={data} onUpload={() => input.current?.click()} />
      <input ref={input} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.svg,.webp,.dwg,.dxf,.step,.stp,.igs,.iges" onChange={(e) => e.target.files?.[0] && setPending(e.target.files[0])} />

      <Card className="mt-4" title="Drawings" subtitle={`${data.drawings.length} drawings · ${data.revisions.length} revisions`} action={
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder="Search ID, SKU, part, customer…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      }>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) setPending(f);
          }}
          onClick={() => input.current?.click()}
          className={clsx('mx-5 mb-4 flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-colors', drag ? 'border-amber-400 bg-amber-50' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
        >
          <UploadCloud className="h-5 w-5 text-slate-400" />
          <span>
            <b className="text-slate-700">Drop a drawing here</b> or click to browse — PDF and images preview in the browser; DWG / DXF / STEP / IGES are stored with metadata.
          </span>
        </div>
        {rows.length === 0 ? (
          <Empty>No drawings match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <Th k="id">Drawing</Th>
                  <Th k="partSku">Part / SKU</Th>
                  <Th k="customer">Customer / OEM</Th>
                  <th className="px-3 py-2.5 font-medium">File</th>
                  <th className="px-3 py-2.5 font-medium">Rev</th>
                  <th className="px-3 py-2.5 font-medium">Material</th>
                  <Th k="uploadedAt">Received</Th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <Th k="status">Review status</Th>
                  <th className="px-3 py-2.5 font-medium">WO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ d, r, revCount }) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => navigate(`/eng/drawings/${r.id}`)}>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap text-sky-700">
                      <Link to={`/eng/drawings/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        {d.id}
                      </Link>
                      {d.synthetic && <div className="text-[10px] font-semibold tracking-wide text-amber-700 uppercase">demo</div>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs text-slate-700">{d.partSku}</div>
                      <div className="text-slate-800">{d.partName}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{d.customer}</td>
                    <td className="max-w-[220px] px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <FormatChip format={r.format} />
                        <span className="truncate text-xs text-slate-700" title={r.fileName}>
                          {r.fileName}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">{fmtBytes(r.size)}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-semibold">{r.rev}</span>
                      {revCount > 1 && <span className="text-xs text-slate-400"> · {revCount} revs</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{d.material}</td>
                    <td className="num px-3 py-3 whitespace-nowrap text-slate-600">{fmtShortDate(r.uploadedAt.slice(0, 10))}</td>
                    <td className="px-3 py-3">
                      <SourceChip source={r.source} />
                    </td>
                    <td className="px-3 py-3">
                      <RevisionBadge status={r.status} />
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600">{r.workOrderId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pending && <UploadModal file={pending} data={data} onClose={() => {
        setPending(null);
        if (input.current) input.current.value = '';
      }} />}
    </EngPage>
  );
}
