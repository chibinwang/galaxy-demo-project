import clsx from 'clsx';
import { BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { capability, type AiAction, type AiMode } from '../../shared/ai';
import { AiModeBadge } from '../ai/AiModeBadge';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SeriesPoint } from '../../shared/calc';
import { ISSUE_TYPE_LABEL, stageName } from '../../shared/constants';
import { addDays, fmtDate, fmtShortDate } from '../../shared/dates';
import type { Issue, SavedBrief, StageId } from '../../shared/types';
import { api, qs } from '../api';
import { MetricBars, MetricLine, OutputChart } from '../components/charts';
import { Card, Empty, ErrorNote, fmtN, Input, Loading, Modal, PageHeader, SeverityBadge, SourceTag, Tabs } from '../components/ui';
import { useApp, useFetch } from '../state';

interface HistoryData {
  from: string;
  to: string;
  series: SeriesPoint[];
  stageTotals: { stage: StageId; name: string; good: number; reject: number; downtime: number; target: number; attainmentPct: number; rejectRatePct: number }[];
  summary: {
    finished: number;
    target: number;
    attainmentPct: number;
    workingDays: number;
    bestDay: SeriesPoint | null;
    worstDay: SeriesPoint | null;
    issuesRaised: number;
    issuesResolved: number;
  };
  downtimeReasons: { reason: string; minutes: number }[];
}

type Tab = 'performance' | 'ai' | 'memory' | 'briefs';

export default function History() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'performance';
  const setTab = (t: Tab) => setParams(t === 'performance' ? {} : { tab: t }, { replace: true });
  return (
    <div>
      <PageHeader title="History" subtitle="Past performance, everything the AI copilot did, the plant's incident memory, and archived daily briefs." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'performance', label: 'Performance' },
          { id: 'ai', label: 'AI action log' },
          { id: 'memory', label: 'Incident memory' },
          { id: 'briefs', label: 'Saved briefs' },
        ]}
      />
      {tab === 'performance' && <Performance />}
      {tab === 'ai' && <AiLog />}
      {tab === 'memory' && <Memory />}
      {tab === 'briefs' && <Briefs />}
    </div>
  );
}

function Performance() {
  const { meta, setReportDate } = useApp();
  const end = meta?.latestDate ?? meta?.today ?? '';
  const [picked, setRange] = useState<{ from: string; to: string } | null>(null);
  const range = picked ?? (end ? { from: addDays(end, -29), to: end } : null);
  const { data, error, loading } = useFetch<HistoryData>(range ? `/api/history${qs(range)}` : null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !range) return <Loading />;
  const s = data.summary;
  const preset = (days: number) => setRange({ from: addDays(end, -(days - 1)), to: end });
  const maxReason = Math.max(1, ...data.downtimeReasons.map((r) => r.minutes));

  return (
    <div className={clsx(loading && 'opacity-70')}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[7, 14, 30].map((d) => (
          <button key={d} onClick={() => preset(d)} className={clsx('rounded-full px-3 py-1.5 text-xs font-medium', range.from === addDays(end, -(d - 1)) && range.to === end ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>
            Last {d} days
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className="w-40" aria-label="From" />
          to
          <Input type="date" value={range.to} min={range.from} max={meta?.today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className="w-40" aria-label="To" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Finished output', fmtN(s.finished), `plan ${fmtN(s.target)}`],
          ['Plan attainment', `${s.attainmentPct}%`, `${s.workingDays} working days`],
          ['Best day', s.bestDay ? fmtN(s.bestDay.finished) : '—', s.bestDay ? fmtDate(s.bestDay.date, true) : ''],
          ['Worst day', s.worstDay ? fmtN(s.worstDay.finished) : '—', s.worstDay ? fmtDate(s.worstDay.date, true) : ''],
          ['Issues raised / resolved', `${s.issuesRaised} / ${s.issuesResolved}`, 'in this period'],
        ].map(([l, v, sub]) => (
          <Card key={l} className="p-4">
            <div className="text-xs font-medium text-slate-500">{l}</div>
            <div className="num mt-1 text-2xl font-semibold">{v}</div>
            <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
          </Card>
        ))}
      </div>
      <Card className="mt-4" title="Finished output vs plan" subtitle="Click a bar to open that day on the Overview">
        <div className="px-3 pb-4">
          <OutputChart data={data.series} height={260} onSelect={(d) => setReportDate(d)} />
        </div>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Rejection rate (all stages)" subtitle="Weighted by units processed">
          <div className="px-3 pb-4">
            <MetricLine data={data.series} dataKey="rejectRatePct" unit="%" label="Rejection" />
          </div>
        </Card>
        <Card title="Downtime (minutes per day)">
          <div className="px-3 pb-4">
            <MetricBars data={data.series} dataKey="downtimeMin" unit=" min" label="Downtime" />
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Stage performance in period" subtitle="Throughput per stage — not additive. Factory output is the Packing row.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Good</th>
                  <th className="px-3 py-2 text-right font-medium">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Attainment</th>
                  <th className="px-3 py-2 text-right font-medium">Rejected</th>
                  <th className="px-3 py-2 text-right font-medium">Reject %</th>
                  <th className="px-5 py-2 text-right font-medium">Downtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.stageTotals.map((r) => (
                  <tr key={r.stage} className={r.stage === 'packing' ? 'bg-slate-50 font-medium' : undefined}>
                    <td className="px-5 py-2">{r.name}</td>
                    <td className="num px-3 py-2 text-right">{fmtN(r.good)}</td>
                    <td className="num px-3 py-2 text-right text-slate-500">{fmtN(r.target)}</td>
                    <td className="num px-3 py-2 text-right">{r.attainmentPct}%</td>
                    <td className="num px-3 py-2 text-right">{fmtN(r.reject)}</td>
                    <td className="num px-3 py-2 text-right">{r.rejectRatePct}%</td>
                    <td className="num px-5 py-2 text-right">{fmtN(r.downtime)} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Downtime by reason">
          <div className="space-y-2.5 px-5 pb-5">
            {data.downtimeReasons.length === 0 && <Empty>No downtime recorded.</Empty>}
            {data.downtimeReasons.map((r) => (
              <div key={r.reason} className="text-sm">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700">{r.reason}</span>
                  <span className="num text-slate-500">{fmtN(r.minutes)} min</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-series-1" style={{ width: `${(r.minutes / maxReason) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Need the raw shift records?{' '}
        <Link to="/production" className="font-medium text-sky-700 hover:underline">
          Production Updates → Entry log
        </Link>{' '}
        has filters and CSV export.
      </p>
    </div>
  );
}

function Memory() {
  const [q, setQ] = useState('');
  const { data } = useFetch<Issue[]>(`/api/issues${qs({ status: 'resolved', q })}`);
  return (
    <Card
      title="Incident memory"
      subtitle="Every resolved problem with its root cause and fix. These are matched automatically to new exceptions at the same stage."
      action={
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder="Search e.g. rectifier, plating, insert" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      }
    >
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty icon={<BookOpen className="h-8 w-8 text-slate-300" />}>No resolved incidents match.</Empty>
      ) : (
        <div className="grid gap-3 px-5 pb-5 lg:grid-cols-2">
          {data.map((i) => (
            <div key={i.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <SeverityBadge severity={i.severity} />
                <span className="font-medium text-slate-500">{ISSUE_TYPE_LABEL[i.type]}</span>
                {i.stage && <span className="text-slate-400">· {stageName(i.stage)}</span>}
                <span className="ml-auto text-slate-400">
                  {fmtShortDate(i.detectedDate)} → {i.resolvedDate ? fmtShortDate(i.resolvedDate) : ''}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold">
                <span className="text-slate-400">{i.id}</span> {i.title}
              </h3>
              <dl className="mt-2 space-y-1 text-[13px] text-slate-700">
                {i.rootCause && (
                  <div>
                    <dt className="inline font-medium">Root cause: </dt>
                    <dd className="inline">{i.rootCause}</dd>
                  </div>
                )}
                {i.correctiveAction && (
                  <div>
                    <dt className="inline font-medium">Action: </dt>
                    <dd className="inline">{i.correctiveAction}</dd>
                  </div>
                )}
                {i.resolution && (
                  <div>
                    <dt className="inline font-medium">Outcome: </dt>
                    <dd className="inline">{i.resolution}</dd>
                  </div>
                )}
                {i.owner && <div className="text-xs text-slate-500">Owner: {i.owner}</div>}
              </dl>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Briefs() {
  const { data } = useFetch<Omit<SavedBrief, 'markdown' | 'whatsapp'>[]>('/api/briefs');
  const [viewing, setViewing] = useState<SavedBrief | null>(null);
  return (
    <Card title="Saved briefs">
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>No briefs saved yet. Generate one on the Daily Brief page and click “Save to history”.</Empty>
      ) : (
        <div className="divide-y divide-slate-100">
          {data.map((b) => (
            <button key={b.id} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-slate-50" onClick={async () => setViewing(await api.get<SavedBrief>(`/api/briefs/${b.id}`))}>
              <span className="num w-28 shrink-0 text-sm font-medium">{fmtDate(b.date)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{b.headline}</span>
              <SourceTag source={b.source} />
              <span className="text-xs text-slate-400">{b.id}</span>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.id} · ${fmtDate(viewing.date)}` : ''} wide>
        {viewing && <pre className="max-h-[65vh] overflow-auto rounded-lg bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap">{viewing.markdown}</pre>}
      </Modal>
    </Card>
  );
}

function AiLog() {
  const [mode, setMode] = useState<AiMode | ''>('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data } = useFetch<{ actions: AiAction[] }>(`/api/ai${qs({ mode, q })}`);
  const all = useFetch<{ actions: AiAction[] }>('/api/ai');
  const count = (m: AiMode) => all.data?.actions.filter((a) => a.mode === m).length ?? 0;
  return (
    <Card
      title="AI action log"
      subtitle="Every action the copilot planned or executed — autonomous runs, user-approved runs, and declined plans. External effects are simulated in this demo."
      action={
        <div className="relative w-56">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder="Search actions" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      }
    >
      <div className="flex flex-wrap gap-2 px-5 pb-3">
        {(
          [
            ['', `All ${all.data?.actions.length ?? ''}`],
            ['autonomous', `Autonomous ${count('autonomous')}`],
            ['approved', `Approved by user ${count('approved')}`],
            ['rejected', `Declined ${count('rejected')}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={clsx('rounded-full px-3 py-1.5 text-xs font-medium', mode === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
          >
            {label}
          </button>
        ))}
      </div>
      {!data ? (
        <Loading />
      ) : data.actions.length === 0 ? (
        <Empty>
          No AI actions yet.{' '}
          <Link to="/assistant" className="font-medium text-sky-700 hover:underline">
            Ask the copilot to do something →
          </Link>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Requested as</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.actions.map((a) => {
                const open = expanded === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr className="cursor-pointer align-top hover:bg-slate-50/60" onClick={() => setExpanded(open ? null : a.id)}>
                      <td className="px-3 py-3 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="num px-2 py-3 text-xs whitespace-nowrap text-slate-600">
                        {new Date(a.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        <div className="text-slate-400">{a.id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">{a.title}</div>
                        <div className="text-xs text-slate-500">
                          {capability(a.intent).label} · {a.steps.length} step{a.steps.length === 1 ? '' : 's'}
                          {a.source === 'demo' && <span className="ml-1.5"><SourceTag source="demo" /></span>}
                        </div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-xs text-slate-600 italic">“{a.prompt}”</td>
                      <td className="px-3 py-3">
                        <AiModeBadge mode={a.mode} />
                      </td>
                      <td className="max-w-[320px] px-5 py-3 text-xs text-slate-700">{a.result}</td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={5} className="px-2 pt-1 pb-4">
                          {a.steps.length === 0 ? (
                            <div className="text-xs text-slate-500">Plan was declined before any step ran.</div>
                          ) : (
                            <ol className="space-y-1.5 border-l-2 border-slate-200 pl-4">
                              {a.steps.map((s, i) => (
                                <li key={i} className="text-xs">
                                  <span className="font-medium text-slate-800">{i + 1}. {s.label}</span>
                                  <span className="ml-1.5 rounded bg-white px-1.5 py-px text-[10px] text-slate-500 ring-1 ring-slate-200">{s.tool}</span>
                                  {s.detail && <div className="text-slate-500">{s.detail}</div>}
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
                            {a.link && (
                              <Link to={a.link} className="font-medium text-sky-700 hover:underline">
                                Open related page →
                              </Link>
                            )}
                            <span>Simulated execution</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
