import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Paperclip, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { evaluate, fmtLimits, overallResult, type Inspection, type MeasureResult, type Measurement } from '../../shared/eng';
import { DEMO_BATCH } from '../../shared/engSeed';
import type { Issue } from '../../shared/types';
import { api, ApiError } from '../api';
import { Button, Card, Empty, ErrorNote, Field, Input, IssueStatusBadge, Loading, Modal, Select, Textarea } from '../components/ui';
import { useApp, useFetch } from '../state';
import { fileUrl, fmtDateTime, usePersona, useEng, type EngPayload } from './data';
import { EngPage } from './DemoGuide';
import { ResultBadge } from './ui';

export default function Inspections() {
  const { id } = useParams();
  const { data, error } = useEng();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  if (id) {
    const ins = data.inspections.find((i) => i.id === id);
    return ins ? <InspectionDetail key={ins.id + ins.status} data={data} ins={ins} /> : <ErrorNote>Inspection {id} not found.</ErrorNote>;
  }
  return <InspectionList data={data} />;
}

function InspectionList({ data }: { data: EngPayload }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = [...data.inspections].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <EngPage
      title="Inspection Results"
      subtitle="Measurements recorded against approved QC plans, with deterministic pass / fail and linked nonconformances."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New inspection
        </Button>
      }
    >
      <Card>
        {list.length === 0 ? (
          <Empty>No inspections yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Inspection</th>
                  <th className="px-3 py-2.5 font-medium">Batch / WO</th>
                  <th className="px-3 py-2.5 font-medium">Drawing rev · plan</th>
                  <th className="px-3 py-2.5 font-medium">Inspector</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">NCR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => navigate(`/eng/inspections/${i.id}`)}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-sky-700">{i.id}</div>
                      <div className="text-[11px] text-slate-500">{fmtDateTime(i.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs">{i.batch}</div>
                      <div className="text-[11px] text-slate-500">{i.workOrderId ?? 'no WO'}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {i.drawingId} Rev {i.rev} · {i.planId}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{i.inspector}</td>
                    <td className="px-3 py-3">
                      <ResultBadge result={i.overall} />
                    </td>
                    <td className="px-3 py-3 text-xs">{i.status === 'completed' ? 'Completed' : 'Open'}</td>
                    <td className="px-5 py-3 text-xs">{i.issueIds.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewInspection data={data} onClose={() => setCreating(false)} />}
    </EngPage>
  );
}

function NewInspection({ data, onClose }: { data: EngPayload; onClose: () => void }) {
  const { changed, toast } = useApp();
  const [persona] = usePersona();
  const navigate = useNavigate();
  const usable = data.plans.filter((p) => p.status === 'approved' && data.revisions.find((r) => r.id === p.revisionId)?.status === 'approved');
  const [f, setF] = useState({ planId: usable[0]?.id ?? '', batch: usable.some((p) => p.drawingId === 'DRW-0001') ? DEMO_BATCH : '', workOrderId: '', inspector: persona });
  const [err, setErr] = useState<string | null>(null);
  const plan = usable.find((p) => p.id === f.planId);
  const create = async () => {
    try {
      const ins = await api.post<Inspection>('/api/eng/inspections', f);
      toast(`Inspection ${ins.id} opened`);
      changed();
      onClose();
      navigate(`/eng/inspections/${ins.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <Modal open onClose={onClose} title="New inspection" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} disabled={!usable.length}>Open inspection</Button></>}>
      {usable.length === 0 ? (
        <p className="text-sm text-slate-600">No approved QC plan on a current approved drawing revision. Approve a plan first — inspections cannot run against draft or superseded plans.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Approved QC plan" className="col-span-2">
            <Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.drawingId} Rev {p.rev} · {p.partSku}
                </option>
              ))}
            </Select>
          </Field>
          {plan && <p className="col-span-2 -mt-1 text-xs text-slate-500">{plan.items.length} characteristics · {plan.items.reduce((a, i) => a + i.sampleSize, 0)} measurements · approved by {plan.approvedBy}</p>}
          <Field label="Batch">
            <Input value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value.toUpperCase() })} placeholder="e.g. SP220-B2610-01" />
          </Field>
          <Field label="Work order (optional)">
            <Select value={f.workOrderId} onChange={(e) => setF({ ...f, workOrderId: e.target.value })}>
              <option value="">—</option>
              {data.workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inspector" className="col-span-2">
            <Input value={f.inspector} onChange={(e) => setF({ ...f, inspector: e.target.value })} />
          </Field>
        </div>
      )}
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
    </Modal>
  );
}

const CELL: Record<MeasureResult | 'empty', string> = {
  pass: 'border-green-300 bg-green-50 text-green-900',
  fail: 'border-red-400 bg-red-50 text-red-900 font-semibold',
  review: 'border-amber-300 bg-amber-50 text-amber-900',
  empty: 'border-slate-200 bg-white',
};

function InspectionDetail({ data, ins }: { data: EngPayload; ins: Inspection }) {
  const plan = data.plans.find((p) => p.id === ins.planId)!;
  const rev = data.revisions.find((r) => r.id === ins.revisionId)!;
  const drawing = data.drawings.find((d) => d.id === ins.drawingId)!;
  const { changed, toast } = useApp();
  const open = ins.status === 'open';
  const key = (m: Pick<Measurement, 'code' | 'sample'>) => `${m.code}:${m.sample}`;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ins.measurements.map((m) => [key(m), m.value === undefined ? '' : String(m.value)])));
  const [comments, setComments] = useState(ins.comments ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Live preview uses the same deterministic function as the server.
  const ctx = open ? { planApproved: plan.status === 'approved', revisionApproved: rev.status === 'approved' } : { planApproved: true, revisionApproved: true };
  const evaluated = useMemo(
    () =>
      ins.measurements.map((m) => {
        if (!open) return m;
        const raw = values[key(m)];
        const v: Measurement['value'] = raw === '' || raw === undefined ? undefined : raw === 'ok' || raw === 'nok' ? raw : Number(raw);
        const item = plan.items.find((i) => i.characteristicId === m.characteristicId)!;
        return { ...m, value: v, ...evaluate(item, v, ctx) };
      }),
    [values, ins, plan, open], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const overall = overallResult(evaluated);
  const dirty = open && (ins.measurements.some((m) => (m.value === undefined ? '' : String(m.value)) !== values[key(m)]) || comments !== (ins.comments ?? ''));
  const byChar = plan.items.map((it) => {
    const ms = evaluated.filter((m) => m.characteristicId === it.characteristicId);
    return { it, ms, result: overallResult(ms) };
  });
  const counts = { pass: byChar.filter((c) => c.result === 'pass').length, fail: byChar.filter((c) => c.result === 'fail').length, review: byChar.filter((c) => c.result === 'review').length };

  const save = async () => {
    const payload: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) payload[k] = v === '' ? null : v;
    await api.put(`/api/eng/inspections/${ins.id}`, { values: payload, comments });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(ok);
      changed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const attach = async (file: File) => run(() => api.upload(`/api/eng/inspections/${ins.id}/attachments`, file), `Attached ${file.name}`);

  return (
    <EngPage
      title={`${ins.id} · ${drawing.partName}`}
      subtitle={`Batch ${ins.batch}${ins.workOrderId ? ` · ${ins.workOrderId}` : ''} · ${ins.drawingId} Rev ${ins.rev} · plan ${plan.id} · inspector ${ins.inspector}`}
      actions={
        <Link to="/eng/inspections" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> All inspections
        </Link>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="col-span-2 p-4 md:col-span-1">
          <div className="text-xs text-slate-500">Overall</div>
          <div className="mt-1.5">
            <ResultBadge result={overall} label={overall === 'fail' ? 'Nonconforming' : overall === 'pass' ? 'All characteristics pass' : 'Needs review'} />
          </div>
        </Card>
        {(
          [
            ['Pass', counts.pass, 'text-green-700'],
            ['Fail', counts.fail, 'text-red-700'],
            ['Needs review', counts.review, 'text-amber-700'],
          ] as const
        ).map(([l, n, c]) => (
          <Card key={l} className="p-4">
            <div className="text-xs text-slate-500">{l}</div>
            <div className={clsx('num mt-1 text-2xl font-semibold', c)}>{n}</div>
            <div className="text-[11px] text-slate-400">characteristics</div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="text-xs text-slate-500">Batch disposition</div>
          <div className="mt-1 text-[13px] font-medium text-slate-800">Pending QA decision</div>
          <div className="text-[11px] text-slate-400">No automatic rejection — plan has no approved disposition rule.</div>
        </Card>
      </div>

      <Card
        title="Measurements"
        subtitle={open ? 'Enter values; results update instantly using the approved specification limits. Boundaries are inclusive.' : `Completed ${fmtDateTime(ins.completedAt!)} — locked for traceability.`}
        action={
          open && (
            <div className="flex gap-2">
              <Button size="sm" disabled={!dirty || busy} onClick={() => run(save, 'Measurements saved')}>
                Save
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                onClick={() =>
                  confirm(`Complete ${ins.id}? Measurements will be locked${counts.fail ? ` and ${counts.fail} nonconformance(s) raised in Exceptions & Actions` : ''}.`) &&
                  run(async () => {
                    if (dirty) await save();
                    await api.post(`/api/eng/inspections/${ins.id}/complete`);
                  }, counts.fail ? `${ins.id} completed — nonconformance raised` : `${ins.id} completed`)
                }
              >
                Complete inspection
              </Button>
            </div>
          )
        }
      >
        {err && <div className="px-5 pb-3"><ErrorNote>{err}</ErrorNote></div>}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Characteristic</th>
                <th className="px-3 py-2 font-medium">Spec limits</th>
                <th className="px-3 py-2 font-medium">Samples</th>
                <th className="px-5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byChar.map(({ it, ms, result }) => {
                const firstIssue = ms.find((m) => m.result === 'fail') ?? ms.find((m) => m.result === 'review' && m.value !== undefined) ?? ms.find((m) => m.result === 'review');
                return (
                  <tr key={it.characteristicId} className={clsx('align-top', result === 'fail' && 'bg-red-50/40')}>
                    <td className="px-5 py-3 font-mono font-semibold">{it.code}</td>
                    <td className="max-w-[220px] px-3 py-3">
                      <div className="text-slate-800">{it.description}</div>
                      <div className="text-[11px] text-slate-500">{it.method}</div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{fmtLimits(it)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {ms.map((m) => {
                          const tone = m.value === undefined ? 'empty' : m.result;
                          return (
                            <label key={m.sample} className="flex flex-col items-center" title={m.reason}>
                              <span className="text-[9px] text-slate-400">#{m.sample}</span>
                              {it.kind === 'attribute' ? (
                                <select
                                  disabled={!open}
                                  value={values[key(m)] ?? ''}
                                  onChange={(e) => setValues({ ...values, [key(m)]: e.target.value })}
                                  className={clsx('h-8 w-[68px] rounded-md border px-1 text-xs outline-none', CELL[tone])}
                                  aria-label={`${it.code} sample ${m.sample}`}
                                >
                                  <option value="">—</option>
                                  <option value="ok">OK</option>
                                  <option value="nok">NOK</option>
                                </select>
                              ) : (
                                <input
                                  disabled={!open}
                                  inputMode="decimal"
                                  value={values[key(m)] ?? ''}
                                  onChange={(e) => setValues({ ...values, [key(m)]: e.target.value.replace(',', '.') })}
                                  className={clsx('num h-8 w-[76px] rounded-md border px-1.5 text-right font-mono text-xs outline-none focus:ring-2 focus:ring-slate-200', CELL[tone])}
                                  aria-label={`${it.code} sample ${m.sample}`}
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                      {firstIssue && (result !== 'review' || firstIssue.value !== undefined) && <div className={clsx('mt-1 text-[11px]', result === 'fail' ? 'text-red-700' : 'text-amber-700')}>{firstIssue.reason}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <ResultBadge result={result} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 border-t border-slate-100 px-5 py-4 md:grid-cols-2">
          <Field label="Inspector comments">
            <Textarea value={comments} disabled={!open} onChange={(e) => setComments(e.target.value)} placeholder="Observations, gauge IDs, deviations…" />
          </Field>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Attachments</div>
            <div className="space-y-1">
              {ins.attachmentIds.length === 0 && <p className="text-xs text-slate-400">No attachments.</p>}
              {ins.attachmentIds.map((id) => {
                const f = data.files.find((x) => x.id === id);
                return (
                  <a key={id} href={fileUrl(id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-sky-700 hover:underline">
                    <Paperclip className="h-3.5 w-3.5" /> {f?.name ?? id}
                  </a>
                );
              })}
            </div>
            <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            <Button size="sm" className="mt-2" onClick={() => fileInput.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" /> Attach photo / report
            </Button>
          </div>
        </div>
      </Card>

      <TraceChain data={data} ins={ins} />
    </EngPage>
  );
}

function TraceChain({ data, ins }: { data: EngPayload; ins: Inspection }) {
  const issues = useFetch<Issue[]>('/api/issues');
  const plan = data.plans.find((p) => p.id === ins.planId)!;
  const rev = data.revisions.find((r) => r.id === ins.revisionId)!;
  const drawing = data.drawings.find((d) => d.id === ins.drawingId)!;
  const ncrs = (issues.data ?? []).filter((i) => i.inspectionId === ins.id);
  const failed = ins.measurements.filter((m) => m.result === 'fail');

  const nodes: { label: string; value: string; sub?: string; to?: string; tone?: 'red' | 'green' | 'amber' }[] = [
    { label: 'Customer / OEM', value: drawing.customer },
    { label: 'Part / SKU', value: drawing.partSku, sub: drawing.partName },
    { label: 'Drawing', value: drawing.id, to: `/eng/drawings/${rev.id}` },
    { label: 'Revision used', value: `Rev ${rev.rev}`, sub: rev.status === 'superseded' ? `superseded by ${rev.supersededBy}` : `approved · ${rev.approvedBy?.split(' (')[0] ?? '—'}`, to: `/eng/drawings/${rev.id}`, tone: rev.status === 'superseded' ? 'amber' : 'green' },
    { label: 'Approved QC plan', value: plan.id, sub: `approved · ${plan.approvedBy?.split(' (')[0] ?? '—'}`, to: `/eng/plans/${plan.id}` },
    { label: 'Batch / work order', value: ins.batch, sub: ins.workOrderId ?? 'no work order linked', to: ins.workOrderId ? `/orders/${ins.workOrderId}` : undefined },
    { label: 'Inspection', value: ins.id, sub: `${ins.overall.toUpperCase()} · ${ins.inspector.split(' (')[0]}`, tone: ins.overall === 'fail' ? 'red' : ins.overall === 'pass' ? 'green' : 'amber' },
    ...(failed.length ? [{ label: 'Failed measurement', value: `${failed[0].code} #${failed[0].sample} = ${failed[0].value}`, sub: failed[0].reason, tone: 'red' as const }] : []),
  ];

  return (
    <Card className="mt-4" title="Traceability" subtitle="From the OEM requirement to the recorded measurement and the corrective action — each link opens the record.">
      <div id="trace" className="scroll-mt-24 px-5 pb-5">
        <ol className="flex flex-wrap items-stretch gap-2">
          {nodes.map((n, i) => (
            <li key={n.label} className="flex items-center gap-2">
              {(() => {
                const body = (
                  <div
                    className={clsx(
                      'min-w-[150px] rounded-xl border px-3 py-2',
                      n.tone === 'red' ? 'border-red-200 bg-red-50' : n.tone === 'green' ? 'border-green-200 bg-green-50/60' : n.tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white',
                      n.to && 'hover:border-slate-400',
                    )}
                  >
                    <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{n.label}</div>
                    <div className="text-[13px] font-semibold text-slate-900">{n.value}</div>
                    {n.sub && <div className="max-w-[220px] text-[11px] text-slate-500">{n.sub}</div>}
                  </div>
                );
                return n.to ? <Link to={n.to}>{body}</Link> : body;
              })()}
              {i < nodes.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
            </li>
          ))}
          {ncrs.map((n) => (
            <li key={n.id} className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-slate-300" />
              <Link to={`/exceptions?issue=${n.id}`} className="min-w-[170px] rounded-xl border border-red-300 bg-white px-3 py-2 hover:bg-red-50">
                <div className="text-[10px] font-semibold tracking-wide text-red-500 uppercase">Nonconformance</div>
                <div className="text-[13px] font-semibold text-slate-900">{n.id}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <IssueStatusBadge status={n.status} /> {n.owner ?? 'unassigned'}
                </div>
              </Link>
            </li>
          ))}
        </ol>
        {ins.status === 'open' && failed.length === 0 && ins.overall === 'fail' && <p className="mt-2 text-xs text-slate-500">Save to record failed values.</p>}
        {ins.status === 'open' && <p className="mt-3 text-xs text-slate-500">Nonconformances are raised when the inspection is completed.</p>}
      </div>
    </Card>
  );
}
