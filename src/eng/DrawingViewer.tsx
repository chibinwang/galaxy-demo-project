import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize, Minus, Pencil, Plus, ScanSearch, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SOURCE_LABEL, type Characteristic } from '../../shared/eng';
import { api, ApiError } from '../api';
import { Button, Card, ErrorNote, Field, Input, Loading, Modal, Select } from '../components/ui';
import { useApp } from '../state';
import { drawingOf, fileUrl, fmtBytes, fmtDateTime, plansOf, revisionsOf, useEng, type EngPayload } from './data';
import { EngPage } from './DemoGuide';
import { DocumentPreview, type Zoom } from './DocumentPreview';
import { formatSpec, SpoutSchematic } from './SpoutSchematic';
import { CharBadge, FormatChip, PlanBadge, RevisionBadge, SimulatedNote, SourceChip } from './ui';

export default function DrawingViewer() {
  const { revId = '' } = useParams();
  const { data, error } = useEng();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const rev = data.revisions.find((r) => r.id === revId);
  if (!rev) return <ErrorNote>Drawing revision {revId} not found.</ErrorNote>;
  return <Viewer key={rev.id} data={data} revId={rev.id} />;
}

function Viewer({ data, revId }: { data: EngPayload; revId: string }) {
  const rev = data.revisions.find((r) => r.id === revId)!;
  const drawing = drawingOf(data, rev)!;
  const chars = data.characteristics.filter((c) => c.revisionId === rev.id);
  const { changed, toast } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'document' | 'schematic'>('document');
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvasBox = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = canvasBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (f: number) => setZoom((z) => Math.min(4, Math.max(0.25, (z === 'fit' ? (width - 32) / 842 : z) * f)));

  const selectChar = (c: Characteristic) => {
    setSelected(c.callout ?? c.code);
    if (rev.schematic && c.callout) setTab('schematic');
    else {
      setTab('document');
      setPage(Math.min(c.page, pages));
    }
  };

  const extract = async () => {
    setBusy(true);
    try {
      await api.post(`/api/eng/revisions/${rev.id}/extract`);
      toast('Simulated AI extraction loaded — review each value before approval');
      changed();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revs = revisionsOf(data, drawing.id);
  const plans = plansOf(data, rev.id);
  const inspections = data.inspections.filter((i) => i.revisionId === rev.id);
  const isImageOrPdf = rev.format === 'pdf' || ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(rev.format);

  return (
    <EngPage
      title={`${drawing.id} · Rev ${rev.rev}`}
      subtitle={`${drawing.partName} · ${drawing.partSku} · ${drawing.customer}`}
      actions={
        <Link to="/eng/drawings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Library
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------- left: drawing canvas ---------- */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
            <div className="inline-flex rounded-lg bg-slate-200/60 p-0.5 text-xs font-medium">
              <button onClick={() => setTab('document')} className={clsx('rounded-md px-2.5 py-1', tab === 'document' ? 'bg-white shadow-sm' : 'text-slate-600')}>
                Document · {rev.fileName}
              </button>
              {rev.schematic && (
                <button onClick={() => setTab('schematic')} className={clsx('rounded-md px-2.5 py-1', tab === 'schematic' ? 'bg-white shadow-sm' : 'text-slate-600')}>
                  Annotated schematic <span className="text-amber-700">(illustrative)</span>
                </button>
              )}
            </div>
            {tab === 'document' && isImageOrPdf && (
              <div className="ml-auto flex items-center gap-1">
                {rev.format === 'pdf' && (
                  <>
                    <button className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="num text-xs text-slate-600">
                      Page {page} / {pages}
                    </span>
                    <button className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="mx-1 h-4 w-px bg-slate-300" />
                  </>
                )}
                <button className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="num w-12 text-center text-xs text-slate-600">{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
                <button className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                  <Plus className="h-4 w-4" />
                </button>
                <button className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => setZoom('fit')} aria-label="Fit to page" title="Fit to page">
                  <Maximize className="h-4 w-4" />
                </button>
                {rev.fileId && (
                  <a href={fileUrl(rev.fileId, true)} className="rounded p-1 text-slate-500 hover:bg-white" aria-label="Download original" title="Download original">
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
          </div>
          <div ref={canvasBox} className="h-[calc(100vh-330px)] min-h-[440px] overflow-auto bg-[repeating-linear-gradient(0deg,#f1f4f8,#f1f4f8_23px,#e8ecf2_24px),repeating-linear-gradient(90deg,#f1f4f8,#f1f4f8_23px,#e8ecf2_24px)] bg-blend-multiply p-4">
            {tab === 'document' ? (
              <DocumentPreview rev={rev} page={page} zoom={zoom} width={width} onPages={setPages} />
            ) : (
              <div className="mx-auto max-w-[1000px] overflow-hidden rounded-lg bg-white shadow-[0_2px_12px_rgba(15,23,42,0.12)]">
                <SpoutSchematic chars={chars} selected={selected} onSelect={(code) => setSelected((s) => (s === code ? null : code))} rev={rev.rev} />
                <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
                  Illustrative schematic drawn for the demo — not the customer file and not parsed geometry. Click a callout or a characteristic to highlight it.
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ---------- right: metadata, characteristics, actions ---------- */}
        <div className="space-y-4">
          <Card
            title="Drawing metadata"
            action={
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            }
          >
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 px-5 pb-4 text-[13px]">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <RevisionBadge status={rev.status} />
              </dd>
              <dt className="text-slate-500">Part / SKU</dt>
              <dd className="font-mono text-xs">{drawing.partSku}</dd>
              <dt className="text-slate-500">Material</dt>
              <dd>{drawing.material}</dd>
              <dt className="text-slate-500">File</dt>
              <dd className="flex items-center gap-1.5">
                <FormatChip format={rev.format} /> <span className="text-xs text-slate-600">{fmtBytes(rev.size)}</span>
              </dd>
              <dt className="text-slate-500">Source</dt>
              <dd>
                <SourceChip source={rev.source} />
                {rev.sourceMeta && (
                  <div className="text-[11px] text-slate-500">
                    {rev.sourceMeta.sender}
                    {rev.sourceMeta.reference && ` · ${rev.sourceMeta.reference}`}
                  </div>
                )}
              </dd>
              <dt className="text-slate-500">Received</dt>
              <dd className="text-xs">{fmtDateTime(rev.uploadedAt)}</dd>
              <dt className="text-slate-500">Work order</dt>
              <dd>{rev.workOrderId ?? '—'}</dd>
              {rev.approvedBy && (
                <>
                  <dt className="text-slate-500">Approved</dt>
                  <dd className="text-xs">
                    {rev.approvedBy}
                    <div className="text-slate-500">{fmtDateTime(rev.approvedAt!)}</div>
                  </dd>
                </>
              )}
              {rev.notes && (
                <>
                  <dt className="text-slate-500">Notes</dt>
                  <dd className="text-xs">{rev.notes}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card
            title="Characteristics"
            subtitle={chars.length ? `${chars.filter((c) => c.status === 'confirmed').length} of ${chars.length} confirmed` : 'None recorded yet'}
            action={
              chars.length > 0 && (
                <Button size="sm" onClick={() => navigate(`/eng/review?rev=${rev.id}`)}>
                  <ScanSearch className="h-3.5 w-3.5" /> Review
                </Button>
              )
            }
          >
            <div className="px-5 pb-4">
              {chars.length === 0 ? (
                <div className="space-y-3">
                  {rev.schematic ? (
                    <Button variant="primary" className="w-full" onClick={extract} loading={busy}>
                      <Sparkles className="h-4 w-4" /> Run simulated AI review
                    </Button>
                  ) : (
                    <p className="text-xs text-slate-500">Simulated AI extraction is only available for the seeded demo drawings. Add characteristics manually on the review screen.</p>
                  )}
                  {!rev.schematic && (
                    <Button className="w-full" onClick={() => navigate(`/eng/review?rev=${rev.id}`)}>
                      Enter characteristics manually
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {chars.some((c) => c.source === 'simulated_ai') && <SimulatedNote>Values below are simulated AI results seeded for this demo drawing — confirm each one before approval.</SimulatedNote>}
                  <ul className="mt-2 max-h-[300px] space-y-1 overflow-y-auto">
                    {chars.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => selectChar(c)}
                          className={clsx('flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors', selected === (c.callout ?? c.code) ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:bg-slate-50')}
                        >
                          <span className="w-8 font-mono font-semibold text-slate-500">{c.code}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-800">{c.description}</span>
                            <span className="font-mono text-[11px] text-slate-500">
                              {formatSpec(c)} {c.kind === 'variable' && !c.gdt ? c.unit : ''} · p.{c.page}
                            </span>
                          </span>
                          <CharBadge status={c.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>

          <Card title="Revision history & downstream">
            <div className="space-y-3 px-5 pb-4 text-xs">
              <ol className="space-y-1.5">
                {revs.map((r) => (
                  <li key={r.id} className={clsx('flex items-center gap-2 rounded-lg px-2 py-1.5', r.id === rev.id && 'bg-slate-50')}>
                    <Link to={`/eng/drawings/${r.id}`} className="w-14 font-semibold text-sky-700 hover:underline">
                      Rev {r.rev}
                    </Link>
                    <span className="flex-1 text-slate-500">
                      {SOURCE_LABEL[r.source]} · {fmtDateTime(r.uploadedAt)}
                    </span>
                    <RevisionBadge status={r.status} />
                  </li>
                ))}
              </ol>
              {plans.map((p) => (
                <Link key={p.id} to={`/eng/plans/${p.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
                  <span>
                    <b>{p.id}</b> QC plan · {p.items.length} items
                  </span>
                  <PlanBadge status={p.status} />
                </Link>
              ))}
              {inspections.length > 0 && <div className="text-slate-500">{inspections.length} inspection(s) recorded against this revision — <Link to="/eng/inspections" className="text-sky-700 hover:underline">view</Link></div>}
            </div>
          </Card>
        </div>
      </div>
      {editing && <EditMeta data={data} revId={rev.id} onClose={() => setEditing(false)} />}
    </EngPage>
  );
}

function EditMeta({ data, revId, onClose }: { data: EngPayload; revId: string; onClose: () => void }) {
  const rev = data.revisions.find((r) => r.id === revId)!;
  const d = drawingOf(data, rev)!;
  const { changed, toast } = useApp();
  const [f, setF] = useState({ partName: d.partName, customer: d.customer, material: d.material, workOrderId: rev.workOrderId ?? '', notes: rev.notes ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.put(`/api/eng/revisions/${rev.id}`, f);
      toast('Metadata saved');
      changed();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <Modal open onClose={onClose} title={`Edit metadata · ${rev.id}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Part name" className="col-span-2">
          <Input value={f.partName} onChange={(e) => setF({ ...f, partName: e.target.value })} />
        </Field>
        <Field label="Customer / OEM">
          <Input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} />
        </Field>
        <Field label="Material">
          <Input value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} />
        </Field>
        <Field label="Work order">
          <Select value={f.workOrderId} onChange={(e) => setF({ ...f, workOrderId: e.target.value })}>
            <option value="">—</option>
            {data.workOrders.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Part / SKU and revision letter are fixed for traceability; technical requirements change only through a new revision.</p>
      {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
    </Modal>
  );
}
