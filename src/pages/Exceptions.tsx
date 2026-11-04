import clsx from 'clsx';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ISSUE_TYPE_LABEL, STAGES, stageName } from '../../shared/constants';
import { addDays, fmtShortDate } from '../../shared/dates';
import type { DetectedException, Issue, IssueStatus, IssueType, Severity, StageId } from '../../shared/types';
import { api, ApiError, qs } from '../api';
import { DatePicker } from '../components/DatePicker';
import { ExceptionCard } from '../components/ExceptionCard';
import { Button, Card, Empty, ErrorNote, Field, Input, IssueStatusBadge, Loading, Modal, PageHeader, Select, SeverityBadge, Textarea } from '../components/ui';
import { useApp, useFetch } from '../state';

type Draft = Partial<Issue>;

export default function Exceptions() {
  const { meta, reportDate, setReportDate } = useApp();
  const [params, setParams] = useSearchParams();
  const ex = useFetch<{ date: string; items: DetectedException[] }>(reportDate ? `/api/exceptions${qs({ date: reportDate })}` : null);
  const [statusFilter, setStatusFilter] = useState<'active' | IssueStatus | ''>('active');
  const [search, setSearch] = useState('');
  const issues = useFetch<Issue[]>(`/api/issues${qs({ status: statusFilter, q: search })}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sevFilter, setSevFilter] = useState<Severity | ''>('');

  // Deep link: /exceptions?issue=ISS-0006
  const linkId = params.get('issue');
  useEffect(() => {
    if (!linkId) return;
    api
      .get<Issue[]>(`/api/issues${qs({ q: linkId })}`)
      .then((list) => {
        const found = list.find((i) => i.id === linkId);
        if (found) setDraft(found);
      })
      .catch(() => {});
  }, [linkId]);

  const closeModal = () => {
    setDraft(null);
    if (linkId) setParams({}, { replace: true });
  };

  const fromException = (e: DetectedException): Draft => ({
    title: e.title,
    type: e.type,
    severity: e.severity,
    stage: e.stage,
    orderId: e.orderId,
    detectedDate: e.date,
    description: e.detail,
    correctiveAction: e.suggestedAction,
    dueDate: addDays(e.date, e.severity === 'critical' ? 1 : 2),
    status: 'open',
    exceptionKey: e.key,
  });

  if (!meta || !reportDate) return <Loading />;
  const items = (ex.data?.items ?? []).filter((e) => !sevFilter || e.severity === sevFilter);
  const untracked = (ex.data?.items ?? []).filter((e) => !e.linkedIssueId && e.type !== 'data_gap').length;

  return (
    <div>
      <PageHeader
        title="Exceptions & Actions"
        subtitle="Rule-based detection of shortfalls, quality spikes, downtime, bottlenecks and order risk — each turned into an owned corrective action."
        actions={
          <>
            <DatePicker value={reportDate} onChange={setReportDate} max={meta.today} />
            <Button variant="primary" onClick={() => setDraft({ status: 'open', severity: 'medium', type: 'other', detectedDate: reportDate })}>
              <Plus className="h-4 w-4" /> Log issue
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <Card
            title="Detected exceptions"
            subtitle={ex.data ? `${ex.data.items.length} for ${fmtShortDate(ex.data.date)} · ${untracked} without an owner` : undefined}
            action={
              <Select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as Severity | '')} className="h-8 w-32 shrink-0 text-xs">
                <option value="">All severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </Select>
            }
          >
            <div className="space-y-3 px-5 pb-5">
              {ex.error && <ErrorNote>{ex.error}</ErrorNote>}
              {!ex.data && <Loading />}
              {ex.data && items.length === 0 && <Empty>No exceptions for this date.</Empty>}
              {items.map((e) => (
                <ExceptionCard key={e.key} ex={e} onCreateAction={(x) => setDraft(fromException(x))} />
              ))}
            </div>
          </Card>
        </div>
        <div className="xl:col-span-3">
          <Card
            title="Corrective action tracker"
            subtitle="Resolved actions keep their root cause and fix — they are surfaced automatically when a similar problem recurs."
          >
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {(
                [
                  ['active', 'Open & in progress'],
                  ['resolved', 'Resolved'],
                  ['', 'All'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setStatusFilter(id)}
                  className={clsx('rounded-full px-3 py-1.5 text-xs font-medium', statusFilter === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
                >
                  {label}
                </button>
              ))}
              <div className="relative ml-auto w-full sm:w-56">
                <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
                <Input placeholder="Search actions" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
            </div>
            {!issues.data ? (
              <Loading />
            ) : issues.data.length === 0 ? (
              <Empty>No actions in this view.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Owner</th>
                      <th className="px-3 py-2 font-medium">Due</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {issues.data.map((i) => {
                      const overdue = i.status !== 'resolved' && i.dueDate && i.dueDate < meta.today;
                      return (
                        <tr key={i.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setDraft(i)}>
                          <td className="px-5 py-2.5">
                            <div className="font-medium text-slate-900">
                              <span className="text-slate-400">{i.id}</span> {i.title}
                            </div>
                            <div className="text-xs text-slate-500">
                              {ISSUE_TYPE_LABEL[i.type]}
                              {i.stage && ` · ${stageName(i.stage)}`}
                              {i.orderId && ` · ${i.orderId}`} · detected {fmtShortDate(i.detectedDate)}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <SeverityBadge severity={i.severity} />
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{i.owner ?? <span className="text-slate-400">Unassigned</span>}</td>
                          <td className={clsx('num px-3 py-2.5 whitespace-nowrap', overdue ? 'font-semibold text-red-700' : 'text-slate-600')}>
                            {i.dueDate ? fmtShortDate(i.dueDate) : '—'}
                            {overdue && <div className="text-[10px] font-semibold uppercase">Overdue</div>}
                          </td>
                          <td className="px-5 py-2.5">
                            <IssueStatusBadge status={i.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      {draft && <IssueModal draft={draft} onClose={closeModal} />}
    </div>
  );
}

function IssueModal({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { changed, toast, meta } = useApp();
  const [f, setF] = useState<Draft>(draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const isNew = !draft.id;
  const similar = useFetch<Issue[]>(draft.id ? `/api/issues/${draft.id}/similar` : null);
  const set = <K extends keyof Issue>(k: K, v: Issue[K] | undefined) => setF((s) => ({ ...s, [k]: v }));

  const save = async (override?: Partial<Issue>) => {
    setSaving(true);
    setErrors([]);
    const body = { ...f, ...override };
    try {
      const saved = isNew ? await api.post<Issue>('/api/issues', body) : await api.put<Issue>(`/api/issues/${draft.id}`, body);
      toast(isNew ? `Action ${saved.id} created` : saved.status === 'resolved' && draft.status !== 'resolved' ? `${saved.id} resolved and saved to operational memory` : `${saved.id} updated`);
      changed();
      onClose();
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${draft.id}? Its history will be lost from operational memory.`)) return;
    await api.del(`/api/issues/${draft.id}`);
    toast(`${draft.id} deleted`);
    changed();
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? (draft.exceptionKey ? 'Assign corrective action' : 'Log issue') : `${draft.id} · ${draft.title}`}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!isNew && f.status !== 'resolved' && (
            <Button onClick={() => save({ status: 'resolved' })} loading={saving}>
              Mark resolved
            </Button>
          )}
          <Button variant="primary" onClick={() => save()} loading={saving}>
            {isNew ? 'Create action' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Title" className="col-span-2 md:col-span-4">
          <Input value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as IssueType)}>
            {Object.entries(ISSUE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity">
          <Select value={f.severity} onChange={(e) => set('severity', e.target.value as Severity)}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>
        <Field label="Stage">
          <Select value={f.stage ?? ''} onChange={(e) => set('stage', (e.target.value || undefined) as StageId | undefined)}>
            <option value="">—</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order (optional)">
          <Input value={f.orderId ?? ''} onChange={(e) => set('orderId', e.target.value.toUpperCase())} />
        </Field>
        <Field label="What happened" className="col-span-2 md:col-span-4">
          <Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Root cause" className="col-span-2">
          <Textarea value={f.rootCause ?? ''} onChange={(e) => set('rootCause', e.target.value)} placeholder="Why did it happen?" />
        </Field>
        <Field label="Corrective action" className="col-span-2">
          <Textarea value={f.correctiveAction ?? ''} onChange={(e) => set('correctiveAction', e.target.value)} placeholder="What will be done?" />
        </Field>
        <Field label="Owner" className="col-span-2">
          <Input value={f.owner ?? ''} onChange={(e) => set('owner', e.target.value)} placeholder="Name (department)" list="owners" />
          <datalist id="owners">
            {meta?.supervisors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Due date">
          <Input type="date" value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || undefined)} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as IssueStatus)}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </Select>
        </Field>
        {(f.status === 'resolved' || draft.status === 'resolved' || !isNew) && (
          <Field label="Resolution — what fixed it (required to resolve)" className="col-span-2 md:col-span-4">
            <Textarea value={f.resolution ?? ''} onChange={(e) => set('resolution', e.target.value)} placeholder="Outcome and verification, e.g. “Rejection back below 3% from next shift.”" />
          </Field>
        )}
      </div>
      {draft.inspectionId && (
        <Link to={`/eng/inspections/${draft.inspectionId}`} onClick={onClose} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-sky-700 hover:underline">
          Nonconformance from QC inspection {draft.inspectionId} — open inspection & traceability →
        </Link>
      )}
      {errors.length > 0 && (
        <div className="mt-3">
          <ErrorNote>{errors.join(' ')}</ErrorNote>
        </div>
      )}
      {!isNew && similar.data && similar.data.length > 0 && (
        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-800">
            <BookOpen className="h-3.5 w-3.5" /> Similar resolved incidents
          </div>
          <div className="space-y-2">
            {similar.data.map((m) => (
              <div key={m.id} className="text-xs text-slate-700">
                <span className="font-semibold">
                  {m.id} · {m.title}
                </span>{' '}
                <span className="text-slate-500">({fmtShortDate(m.detectedDate)})</span>
                {m.correctiveAction && <div>Action: {m.correctiveAction}</div>}
                {m.resolution && <div className="text-slate-500">Outcome: {m.resolution}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
