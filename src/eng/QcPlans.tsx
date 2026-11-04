import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtLimits, METHOD_OPTIONS, type PlanItem } from '../../shared/eng';
import { api, ApiError } from '../api';
import { Button, Card, Empty, ErrorNote, Input, Loading, Select } from '../components/ui';
import { useApp } from '../state';
import { fmtDateTime, inspectionsOfPlan, usePersona, useEng, type EngPayload } from './data';
import { EngPage } from './DemoGuide';
import { PlanBadge, RevisionBadge } from './ui';

export default function QcPlans() {
  const { id } = useParams();
  const { data, error } = useEng();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  if (id) {
    const plan = data.plans.find((p) => p.id === id);
    return plan ? <PlanDetail key={plan.id} data={data} planId={plan.id} /> : <ErrorNote>Plan {id} not found.</ErrorNote>;
  }
  return <PlanList data={data} />;
}

function PlanList({ data }: { data: EngPayload }) {
  const navigate = useNavigate();
  const plans = [...data.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <EngPage title="QC Inspection Plans" subtitle="Inspection plans generated from approved drawing revisions. Methods are suggested; a second person approves the plan.">
      <Card>
        {plans.length === 0 ? (
          <Empty>No plans yet. Approve a drawing revision on the AI Drawing Review screen, then generate a draft plan.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Drawing / revision</th>
                  <th className="px-3 py-2.5 font-medium">Part / SKU</th>
                  <th className="px-3 py-2.5 font-medium">Characteristics</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Approver</th>
                  <th className="px-5 py-2.5 font-medium">Inspections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => {
                  const rev = data.revisions.find((r) => r.id === p.revisionId)!;
                  return (
                    <tr key={p.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => navigate(`/eng/plans/${p.id}`)}>
                      <td className="px-5 py-3 font-semibold text-sky-700">{p.id}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          {p.drawingId} · Rev {p.rev}
                        </div>
                        <RevisionBadge status={rev.status} />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{p.partSku}</td>
                      <td className="num px-3 py-3">{p.items.length}</td>
                      <td className="px-3 py-3">
                        <PlanBadge status={p.status} />
                        {p.reapprovalPending && p.status !== 'superseded' && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> {p.reapprovalPending} received — may need re-approval
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{p.approvedBy ?? '—'}</td>
                      <td className="num px-5 py-3">{inspectionsOfPlan(data, p.id).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </EngPage>
  );
}

function PlanDetail({ data, planId }: { data: EngPayload; planId: string }) {
  const plan = data.plans.find((p) => p.id === planId)!;
  const rev = data.revisions.find((r) => r.id === plan.revisionId)!;
  const drawing = data.drawings.find((d) => d.id === plan.drawingId)!;
  const { changed, toast } = useApp();
  const [persona] = usePersona();
  const [items, setItems] = useState<PlanItem[]>(plan.items);
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const draft = plan.status === 'draft';
  const dirty = JSON.stringify(items) !== JSON.stringify(plan.items) || notes !== (plan.notes ?? '');
  useEffect(() => setItems(plan.items), [plan.items]);

  const setItem = (id: string, patch: Partial<PlanItem>) => setItems((xs) => xs.map((x) => (x.characteristicId === id ? { ...x, ...patch } : x)));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErrors([]);
    try {
      await fn();
      toast(ok);
      changed();
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };
  const save = () => api.put(`/api/eng/plans/${plan.id}`, { items: items.map((i) => ({ characteristicId: i.characteristicId, method: i.method, sampleSize: i.sampleSize })), notes });

  return (
    <EngPage
      title={`${plan.id} · QC inspection plan`}
      subtitle={`${drawing.partName} · ${plan.partSku} · ${drawing.customer}`}
      actions={
        <Link to="/eng/plans" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> All plans
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title="Inspection characteristics"
          subtitle={draft ? 'Suggested methods and sample sizes can be changed before approval.' : 'Approved plans are fixed. A new drawing revision requires a new plan.'}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Characteristic</th>
                  <th className="px-3 py-2 font-medium">Specification limits</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 font-medium">Inspection method</th>
                  <th className="px-5 py-2 font-medium">Sample / batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.characteristicId} className="align-top">
                    <td className="px-5 py-3 font-mono font-semibold">{it.code}</td>
                    <td className="px-3 py-3">
                      <div className="text-slate-800">{it.description}</div>
                      <div className="text-[11px] text-slate-500">{it.type}</div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                      {fmtLimits(it)}
                      {it.gdt && <div className="font-sans text-[10px] text-amber-700">manual evaluation</div>}
                    </td>
                    <td className="px-3 py-3 text-xs">{it.unit || '—'}</td>
                    <td className="min-w-[220px] px-3 py-3">
                      {draft ? (
                        <Select value={it.method} onChange={(e) => setItem(it.characteristicId, { method: e.target.value })} className="h-8 text-xs">
                          {[...new Set([it.method, ...METHOD_OPTIONS])].map((m) => (
                            <option key={m} value={m}>
                              {m}
                              {m === it.methodSuggested ? '  (suggested)' : ''}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs">{it.method}</span>
                      )}
                      {it.method === it.methodSuggested ? (
                        <div className="mt-0.5 text-[10px] text-violet-700">System suggestion{draft ? ' — pending approval' : ''}</div>
                      ) : (
                        <div className="mt-0.5 text-[10px] text-slate-500">Changed from suggestion ({it.methodSuggested})</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {draft ? (
                        <Input type="number" min={1} max={50} value={it.sampleSize} onChange={(e) => setItem(it.characteristicId, { sampleSize: Number(e.target.value) })} className="h-8 w-20 text-xs" />
                      ) : (
                        <span className="num">{it.sampleSize} pcs</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3">
              <Input placeholder="Plan notes (sampling basis, disposition rule…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button disabled={!dirty || busy} onClick={() => run(save, 'Plan saved')}>
                Save draft
              </Button>
            </div>
          )}
          {!draft && plan.notes && <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">Notes: {plan.notes}</p>}
        </Card>

        <div className="space-y-4">
          <Card title="Plan status">
            <div className="space-y-2.5 px-5 pb-5 text-[13px]">
              <Row label="Status">
                <PlanBadge status={plan.status} />
              </Row>
              <Row label="Drawing revision">
                <Link to={`/eng/drawings/${rev.id}`} className="font-semibold text-sky-700 hover:underline">
                  {rev.id}
                </Link>{' '}
                <RevisionBadge status={rev.status} />
              </Row>
              <Row label="Author">{plan.createdBy}</Row>
              <Row label="Created">{fmtDateTime(plan.createdAt)}</Row>
              {plan.approvedBy && (
                <>
                  <Row label="Approved by">{plan.approvedBy}</Row>
                  <Row label="Approved">{fmtDateTime(plan.approvedAt!)}</Row>
                </>
              )}
              {plan.reapprovalPending && plan.status !== 'superseded' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Newer revision <b>{plan.reapprovalPending}</b> received. This plan stays valid for Rev {plan.rev} until the new revision is approved, then a new plan must be approved.
                </div>
              )}
              {plan.status === 'superseded' && <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">Superseded — its drawing revision was replaced. Kept unchanged so past inspections remain traceable.</div>}
              {errors.length > 0 && <ErrorNote>{errors.join(' ')}</ErrorNote>}
              {draft && (
                <>
                  <p className="text-[11px] text-slate-500">Approval is a deliberate human decision. The approver must differ from the author ({plan.createdBy.split(' (')[0]}).</p>
                  <Button
                    variant="primary"
                    className="w-full"
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        if (dirty) await save();
                        await api.post(`/api/eng/plans/${plan.id}/approve`, { approver: persona });
                      }, `${plan.id} approved by ${persona.split(' (')[0]}`)
                    }
                  >
                    <ShieldCheck className="h-4 w-4" /> Approve plan as {persona.split(' (')[0]}
                  </Button>
                </>
              )}
              {plan.status === 'approved' && (
                <Link to="/eng/inspections" className="block rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-slate-50">
                  Use this plan for an inspection →
                </Link>
              )}
            </div>
          </Card>
          <Card title="Inspections using this plan">
            <div className="space-y-1.5 px-5 pb-5">
              {inspectionsOfPlan(data, plan.id).length === 0 && <p className="text-xs text-slate-500">None yet.</p>}
              {inspectionsOfPlan(data, plan.id).map((i) => (
                <Link key={i.id} to={`/eng/inspections/${i.id}`} className={clsx('flex justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50')}>
                  <span>
                    <b>{i.id}</b> · {i.batch}
                  </span>
                  <span className={i.overall === 'fail' ? 'font-semibold text-red-700' : i.overall === 'pass' ? 'text-green-700' : 'text-amber-700'}>{i.overall.toUpperCase()}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </EngPage>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
