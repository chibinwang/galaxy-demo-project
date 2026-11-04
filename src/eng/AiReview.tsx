import clsx from 'clsx';
import { Check, ClipboardList, Flag, HelpCircle, Lock, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { revisionApprovalBlockers, type Characteristic, type QcPlan } from '../../shared/eng';
import { api, ApiError } from '../api';
import { Button, Card, Empty, ErrorNote, Input, Loading, Select } from '../components/ui';
import { useApp } from '../state';
import { drawingOf, usePersona, useEng, type EngPayload } from './data';
import { EngPage } from './DemoGuide';
import { SpoutSchematic } from './SpoutSchematic';
import { CharBadge, RevisionBadge, SimulatedNote } from './ui';

export default function AiReview() {
  const { data, error } = useEng();
  const [params, setParams] = useSearchParams();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const queue = [...data.revisions].sort((a, b) => {
    const rank = (s: string) => (s === 'in_review' ? 0 : s === 'awaiting_review' ? 1 : s === 'approved' ? 2 : 3);
    return rank(a.status) - rank(b.status) || b.uploadedAt.localeCompare(a.uploadedAt);
  });
  const revId = params.get('rev') ?? queue[0]?.id;
  const rev = data.revisions.find((r) => r.id === revId);

  return (
    <EngPage title="AI Drawing Review" subtitle="Human review of characteristics extracted from drawings. Nothing becomes a requirement until a person confirms it and approves the revision.">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card title="Review queue" className="h-fit">
          <div className="space-y-1 px-3 pb-3">
            {queue.map((r) => {
              const d = drawingOf(data, r)!;
              const n = data.characteristics.filter((c) => c.revisionId === r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => setParams({ rev: r.id }, { replace: true })}
                  className={clsx('w-full rounded-xl px-3 py-2 text-left transition-colors', r.id === revId ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-slate-50')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">
                      {d.id} · Rev {r.rev}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{d.partName}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <RevisionBadge status={r.status} />
                    {n.length > 0 && <span className="text-[10px] text-slate-500">{n.filter((c) => c.status === 'confirmed').length}/{n.length}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
        {rev ? <ReviewPanel key={rev.id} data={data} revId={rev.id} /> : <Empty>No drawings to review.</Empty>}
      </div>
    </EngPage>
  );
}

type Draft = Pick<Characteristic, 'type' | 'description' | 'kind' | 'unit' | 'page'> & { nominal: string; upperTol: string; lowerTol: string; gdt: string; spec: string; reviewerNote: string };
const toDraft = (c: Characteristic): Draft => ({
  type: c.type,
  description: c.description,
  kind: c.kind,
  unit: c.unit,
  page: c.page,
  nominal: c.nominal?.toString() ?? '',
  upperTol: c.upperTol?.toString() ?? '',
  lowerTol: c.lowerTol?.toString() ?? '',
  gdt: c.gdt ?? '',
  spec: c.spec ?? '',
  reviewerNote: c.reviewerNote ?? '',
});

function ReviewPanel({ data, revId }: { data: EngPayload; revId: string }) {
  const rev = data.revisions.find((r) => r.id === revId)!;
  const drawing = drawingOf(data, rev)!;
  const chars = data.characteristics.filter((c) => c.revisionId === rev.id);
  const locked = rev.status === 'approved' || rev.status === 'superseded';
  const blockers = revisionApprovalBlockers(chars);
  const plan = data.plans.find((p) => p.revisionId === rev.id && p.status !== 'superseded');
  const { changed, toast } = useApp();
  const [persona] = usePersona();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const sel = chars.find((c) => c.id === selected);
  useEffect(() => {
    setDraft(sel ? toDraft(sel) : null);
    setErrors([]);
  }, [selected, sel?.status, sel?.nominal, sel?.upperTol, sel?.lowerTol]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setErrors([]);
    try {
      await fn();
      if (ok) toast(ok);
      changed();
      return true;
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const valuesPayload = (d: Draft) => ({
    type: d.type,
    description: d.description,
    kind: d.kind,
    unit: d.unit,
    page: d.page,
    nominal: d.nominal,
    upperTol: d.upperTol,
    lowerTol: d.lowerTol,
    gdt: d.gdt,
    spec: d.spec,
    reviewerNote: d.reviewerNote,
  });

  const act = async (status: Characteristic['status']) => {
    if (!sel || !draft) return;
    const dirty = JSON.stringify(valuesPayload(draft)) !== JSON.stringify(valuesPayload(toDraft(sel)));
    await run(async () => {
      if (dirty) await api.put(`/api/eng/characteristics/${sel.id}`, valuesPayload(draft));
      await api.put(`/api/eng/characteristics/${sel.id}`, { status, reviewer: persona, reviewerNote: draft.reviewerNote });
    }, `${sel.code} ${status === 'confirmed' ? 'confirmed' : status === 'flagged' ? 'flagged' : status === 'clarification' ? 'marked for clarification' : 'updated'} by ${persona.split(' (')[0]}`);
  };

  const sym = (v?: number) => (v == null ? <span className="text-slate-300">—</span> : v > 0 ? `+${v}` : `${v}`);

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Card
          title={`${drawing.id} Rev ${rev.rev} — ${drawing.partName}`}
          subtitle={`${drawing.customer} · ${rev.fileName}`}
          action={
            <Link to={`/eng/drawings/${rev.id}`} className="text-xs font-medium text-sky-700 hover:underline">
              Open in viewer →
            </Link>
          }
        >
          <div className="space-y-3 px-5 pb-5">
            {chars.some((c) => c.source === 'simulated_ai') && (
              <SimulatedNote>
                <b>Simulated AI extraction.</b> These values were seeded for the demo drawing to illustrate the workflow; no OCR or geometry parsing was performed. Low-confidence items are pre-flagged by the simulation. A reviewer must confirm every value.
              </SimulatedNote>
            )}
            {locked && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                <Lock className="h-4 w-4" /> Revision {rev.status === 'approved' ? `approved by ${rev.approvedBy}` : 'superseded'} — requirements are locked. Changes require a new drawing revision.
              </div>
            )}
            {chars.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 py-6">
                {rev.schematic ? (
                  <Button variant="primary" onClick={() => run(() => api.post(`/api/eng/revisions/${rev.id}/extract`), 'Simulated extraction loaded')} loading={busy}>
                    <Sparkles className="h-4 w-4" /> Run simulated AI review
                  </Button>
                ) : (
                  <p className="text-sm text-slate-600">No simulated extraction is available for this document (it is not one of the seeded demo drawings). Enter characteristics from the drawing manually.</p>
                )}
                {!locked && (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> Add characteristic manually
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-50 text-left text-[11px] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">ID</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Characteristic</th>
                      <th className="px-3 py-2 text-right font-medium">Nominal</th>
                      <th className="px-3 py-2 text-right font-medium">Upper</th>
                      <th className="px-3 py-2 text-right font-medium">Lower</th>
                      <th className="px-3 py-2 font-medium">Unit</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Confidence</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {chars.map((c) => (
                      <tr key={c.id} onClick={() => setSelected(c.id === selected ? null : c.id)} className={clsx('cursor-pointer align-top', c.id === selected ? 'bg-amber-50/70' : 'hover:bg-slate-50')}>
                        <td className="px-3 py-2.5 font-mono font-semibold">{c.code}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{c.type}</td>
                        <td className="max-w-[300px] min-w-[200px] px-3 py-2.5">
                          <div className="text-slate-800">{c.description}</div>
                          {(c.gdt || c.spec) && <div className="font-mono text-[11px] text-slate-500">{c.gdt ?? c.spec}</div>}
                          {c.reviewerNote && <div className="mt-0.5 text-[11px] text-violet-700">{c.reviewerNote}</div>}
                        </td>
                        <td className="num px-3 py-2.5 text-right font-mono">{c.nominal ?? <span className="text-slate-300">—</span>}</td>
                        <td className="num px-3 py-2.5 text-right font-mono">{sym(c.upperTol)}</td>
                        <td className="num px-3 py-2.5 text-right font-mono">{sym(c.lowerTol)}</td>
                        <td className="px-3 py-2.5 text-xs">{c.unit || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-[11px] whitespace-nowrap text-slate-500">
                          p.{c.page} · {c.source === 'simulated_ai' ? 'Simulated AI' : 'Manual'}
                          {c.editedAfterExtraction && <div className="text-amber-700">edited by reviewer</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          {c.confidence != null ? (
                            <span className={clsx('num font-mono text-xs font-semibold', c.confidence < 0.7 ? 'text-orange-700' : c.confidence < 0.9 ? 'text-amber-700' : 'text-green-700')}>{Math.round(c.confidence * 100)}%</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <CharBadge status={c.status} />
                          {c.reviewedBy && <div className="mt-0.5 text-[10px] whitespace-nowrap text-slate-400">{c.reviewedBy.split(' (')[0]}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {chars.length > 0 && !locked && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" /> Add characteristic
              </Button>
            )}
            {adding && <AddCharacteristic revId={rev.id} onDone={() => setAdding(false)} />}
          </div>
        </Card>

        {sel && draft && (
          <Card title={`Review ${sel.code} — ${sel.description}`} subtitle={locked ? 'Locked (approved revision)' : 'Edit values if the extraction is wrong, then confirm, flag, or ask for clarification.'}>
            <div className="space-y-3 px-5 pb-5">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <LabeledInput label="Type" value={draft.type} disabled={locked} onChange={(v) => setDraft({ ...draft, type: v })} />
                <label className="block text-[11px] text-slate-500">
                  Kind
                  <Select value={draft.kind} disabled={locked} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })} className="mt-0.5 h-8 text-xs">
                    <option value="variable">Variable (measured)</option>
                    <option value="attribute">Attribute (Go / No-Go)</option>
                  </Select>
                </label>
                <LabeledInput label="Description" value={draft.description} disabled={locked} onChange={(v) => setDraft({ ...draft, description: v })} className="col-span-2" />
                {draft.kind === 'variable' ? (
                  <>
                    <LabeledInput label="Nominal" value={draft.nominal} disabled={locked} onChange={(v) => setDraft({ ...draft, nominal: v })} mono />
                    <LabeledInput label="Upper tol (+)" value={draft.upperTol} disabled={locked} onChange={(v) => setDraft({ ...draft, upperTol: v })} mono />
                    <LabeledInput label="Lower tol (−)" value={draft.lowerTol} disabled={locked} onChange={(v) => setDraft({ ...draft, lowerTol: v })} mono />
                    <label className="block text-[11px] text-slate-500">
                      Unit
                      <Select value={draft.unit} disabled={locked} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="mt-0.5 h-8 text-xs">
                        {['mm', 'µm', 'deg', ''].map((u) => (
                          <option key={u} value={u}>
                            {u || '(none)'}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <LabeledInput label="GD&T frame (if any)" value={draft.gdt} disabled={locked} onChange={(v) => setDraft({ ...draft, gdt: v })} mono className="col-span-2" />
                  </>
                ) : (
                  <LabeledInput label="Specification" value={draft.spec} disabled={locked} onChange={(v) => setDraft({ ...draft, spec: v })} className="col-span-2" />
                )}
                <LabeledInput label="Page" value={String(draft.page)} disabled={locked} onChange={(v) => setDraft({ ...draft, page: Number(v) || 1 })} mono />
              </div>
              <LabeledInput label="Reviewer note (required to flag or request clarification)" value={draft.reviewerNote} disabled={locked} onChange={(v) => setDraft({ ...draft, reviewerNote: v })} />
              {draft.gdt && <p className="text-[11px] text-amber-700">GD&T is never evaluated automatically — inspections will show this characteristic as Needs Review for manual assessment.</p>}
              {draft.kind === 'variable' && !draft.gdt && (draft.upperTol === '' || draft.lowerTol === '') && <p className="text-[11px] text-amber-700">No complete tolerance — inspections cannot pass this characteristic automatically.</p>}
              {errors.length > 0 && <ErrorNote>{errors.join(' ')}</ErrorNote>}
              {!locked && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => act('confirmed')} loading={busy}>
                    <Check className="h-3.5 w-3.5" /> Confirm as {persona.split(' (')[0]}
                  </Button>
                  <Button size="sm" onClick={() => act('flagged')} disabled={busy}>
                    <Flag className="h-3.5 w-3.5" /> Flag uncertain
                  </Button>
                  <Button size="sm" onClick={() => act('clarification')} disabled={busy}>
                    <HelpCircle className="h-3.5 w-3.5" /> Needs clarification
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => api.put(`/api/eng/characteristics/${sel.id}`, valuesPayload(draft)), `${sel.code} saved — confirm again`)} disabled={busy}>
                    Save edits only
                  </Button>
                  {sel.source === 'manual' && (
                    <Button size="sm" variant="danger" className="ml-auto" onClick={() => confirm(`Delete ${sel.code}?`) && run(() => api.del(`/api/eng/characteristics/${sel.id}`), `${sel.code} deleted`).then(() => setSelected(null))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        {rev.schematic && chars.length > 0 && (
          <Card title="Drawing reference" subtitle="Illustrative schematic — click a callout">
            <div className="px-3 pb-3">
              <SpoutSchematic chars={chars} rev={rev.rev} selected={sel ? (sel.callout ?? sel.code) : null} onSelect={(code) => setSelected(chars.find((c) => c.callout === code)?.id ?? null)} />
            </div>
          </Card>
        )}
        <Card title="Approval gate" subtitle="A person must approve the revision before it can drive QC.">
          <div className="space-y-3 px-5 pb-5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Revision status</span>
              <RevisionBadge status={rev.status} />
            </div>
            {rev.status === 'approved' ? (
              <>
                <div className="rounded-xl bg-green-50 px-3 py-2.5 text-xs text-green-900">
                  <ShieldCheck className="mr-1 inline h-4 w-4" />
                  Approved by <b>{rev.approvedBy}</b>
                </div>
                {plan ? (
                  <Link to={`/eng/plans/${plan.id}`} className="block rounded-xl border border-slate-200 px-3 py-2.5 text-xs hover:bg-slate-50">
                    <ClipboardList className="mr-1 inline h-4 w-4 text-slate-400" /> QC plan <b>{plan.id}</b> ({plan.status}) →
                  </Link>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full"
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const p = await api.post<QcPlan>(`/api/eng/revisions/${rev.id}/plans`, { createdBy: persona });
                        toast(`Draft plan ${p.id} created — it needs separate approval`);
                        changed();
                        navigate(`/eng/plans/${p.id}`);
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <ClipboardList className="h-4 w-4" /> Generate draft QC plan
                  </Button>
                )}
              </>
            ) : rev.status === 'superseded' ? (
              <p className="text-xs text-slate-500">Superseded by {rev.supersededBy}. Kept read-only for traceability of past inspections.</p>
            ) : (
              <>
                {blockers.length > 0 ? (
                  <ul className="space-y-1 text-xs text-amber-800">
                    {blockers.map((b) => (
                      <li key={b}>• {b}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-green-700">All characteristics confirmed — ready for approval.</p>
                )}
                {data.revisions.some((r) => r.drawingId === rev.drawingId && r.status === 'approved') && (
                  <p className="text-[11px] text-slate-500">Approving supersedes the currently approved revision and its QC plan; history is preserved.</p>
                )}
                <Button variant="primary" className="w-full" disabled={blockers.length > 0} loading={busy} onClick={() => run(() => api.post(`/api/eng/revisions/${rev.id}/approve`, { approver: persona }), `Rev ${rev.rev} approved by ${persona.split(' (')[0]}`)}>
                  <ShieldCheck className="h-4 w-4" /> Approve Rev {rev.rev} as {persona.split(' (')[0]}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, disabled, mono, className }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; mono?: boolean; className?: string }) {
  return (
    <label className={clsx('block text-[11px] text-slate-500', className)}>
      {label}
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx('mt-0.5 h-8 text-xs', mono && 'font-mono')} />
    </label>
  );
}

function AddCharacteristic({ revId, onDone }: { revId: string; onDone: () => void }) {
  const { changed, toast } = useApp();
  const [f, setF] = useState({ type: 'Length', description: '', kind: 'variable', nominal: '', upperTol: '', lowerTol: '', unit: 'mm', page: '1', spec: '' });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.post(`/api/eng/revisions/${revId}/characteristics`, f);
      toast('Characteristic added — it still needs confirmation');
      changed();
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <label className="block text-[11px] text-slate-500">
          Type
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="mt-0.5 h-8 text-xs">
            {['Length', 'Diameter', 'Height', 'Angle', 'Thread', 'Coating thickness', 'Surface roughness', 'Other'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </label>
        <LabeledInput label="Description" value={f.description} onChange={(v) => setF({ ...f, description: v })} className="col-span-2" />
        <label className="block text-[11px] text-slate-500">
          Kind
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="mt-0.5 h-8 text-xs">
            <option value="variable">Variable</option>
            <option value="attribute">Attribute</option>
          </Select>
        </label>
        <LabeledInput label="Page" value={f.page} onChange={(v) => setF({ ...f, page: v })} mono />
        {f.kind === 'variable' ? (
          <>
            <LabeledInput label="Nominal" value={f.nominal} onChange={(v) => setF({ ...f, nominal: v })} mono />
            <LabeledInput label="Upper tol" value={f.upperTol} onChange={(v) => setF({ ...f, upperTol: v })} mono />
            <LabeledInput label="Lower tol" value={f.lowerTol} onChange={(v) => setF({ ...f, lowerTol: v })} mono />
            <label className="block text-[11px] text-slate-500">
              Unit
              <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className="mt-0.5 h-8 text-xs">
                {['mm', 'µm', 'deg'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </label>
          </>
        ) : (
          <LabeledInput label="Specification" value={f.spec} onChange={(v) => setF({ ...f, spec: v })} className="col-span-3" />
        )}
      </div>
      {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Add
        </Button>
      </div>
    </div>
  );
}
