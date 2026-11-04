import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, PlayCircle, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEMO_APPROVER, DEMO_BATCH, DEMO_INSPECTOR, DEMO_MEASUREMENTS } from '../../shared/engSeed';
import type { Characteristic, QcPlan } from '../../shared/eng';
import { api } from '../api';
import { Button, PageHeader } from '../components/ui';
import { useApp } from '../state';
import { useEng, type EngPayload } from './data';
import { PersonaPicker } from './ui';

const REV = 'DRW-0001-B';
const QA_MANAGER = 'Arjun Mehta (QA Manager, demo)';
const VISIT_KEY = 'everyse.eng.guide.visited';

function visited(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(VISIT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function markVisited(k: string) {
  try {
    sessionStorage.setItem(VISIT_KEY, JSON.stringify([...new Set([...visited(), k])]));
  } catch {
    /* ignore */
  }
}

interface Step {
  key: string;
  title: string;
  detail: string;
  route: string;
  done: boolean;
  action?: { label: string; run: () => Promise<string | void> };
}

function buildSteps(s: EngPayload): Step[] {
  const rev = s.revisions.find((r) => r.id === REV);
  const chars = s.characteristics.filter((c) => c.revisionId === REV);
  const plan: QcPlan | undefined = s.plans.find((p) => p.revisionId === REV && p.status !== 'superseded');
  const ins = plan && s.inspections.find((i) => i.planId === plan.id);
  const seen = visited();
  const reviewRoute = `/eng/review?rev=${REV}`;
  return [
    {
      key: 'receive',
      title: 'Revised drawing arrives',
      detail: 'AquaLine (demo OEM) submits SP-220 Rev B through the Designer Portal demo connector.',
      route: '/eng/drawings',
      done: !!rev,
      action: { label: 'Receive from Designer Portal', run: async () => void (await api.post('/api/eng/connectors/portal/receive')) },
    },
    { key: 'open', title: 'Open the drawing', detail: 'Inspect the real PDF and the annotated schematic side by side.', route: `/eng/drawings/${REV}`, done: !!rev && (seen.includes('open') || chars.length > 0) },
    {
      key: 'extract',
      title: 'Run simulated AI review',
      detail: 'Load the seeded (simulated) characteristic extraction for Rev B.',
      route: `/eng/drawings/${REV}`,
      done: chars.length > 0,
      action: { label: 'Run simulated AI review', run: async () => void (await api.post(`/api/eng/revisions/${REV}/extract`)) },
    },
    {
      key: 'confirm',
      title: 'Human review of characteristics',
      detail: 'Correct the ambiguous Ra value (C08), then confirm each characteristic.',
      route: reviewRoute,
      done: chars.length > 0 && chars.every((c) => c.status === 'confirmed'),
      action: {
        label: 'Fix C08 and confirm all',
        run: async () => {
          const c08 = chars.find((c) => c.code === 'C08');
          if (c08 && c08.upperTol == null) await api.put(`/api/eng/characteristics/${c08.id}`, { nominal: 0, upperTol: 0.4, lowerTol: 0, description: 'Ra, visible chrome surfaces (max)', reviewerNote: 'Customer notes confirm Ra 0.4 is a maximum.' });
          for (const c of chars.filter((x: Characteristic) => x.status !== 'confirmed')) await api.put(`/api/eng/characteristics/${c.id}`, { status: 'confirmed', reviewer: DEMO_APPROVER });
        },
      },
    },
    {
      key: 'approve',
      title: 'Approve drawing revision',
      detail: 'Quality engineering signs off Rev B. Rev A and its QC plan become superseded — kept for traceability.',
      route: reviewRoute,
      done: rev?.status === 'approved',
      action: { label: 'Approve Rev B as Neha Gupta', run: async () => void (await api.post(`/api/eng/revisions/${REV}/approve`, { approver: DEMO_APPROVER })) },
    },
    {
      key: 'plan',
      title: 'Generate draft QC plan',
      detail: 'Methods and sample sizes are suggested from the approved characteristics.',
      route: reviewRoute,
      done: !!plan,
      action: { label: 'Generate draft plan', run: async () => `/eng/plans/${(await api.post<QcPlan>(`/api/eng/revisions/${REV}/plans`, { createdBy: DEMO_APPROVER })).id}` },
    },
    {
      key: 'planApprove',
      title: 'Approve the QC plan',
      detail: 'Four-eyes rule: the QA manager — not the author — approves the plan.',
      route: plan ? `/eng/plans/${plan.id}` : '/eng/plans',
      done: plan?.status === 'approved',
      action: plan && { label: 'Approve as QA manager', run: async () => void (await api.post(`/api/eng/plans/${plan.id}/approve`, { approver: QA_MANAGER })) },
    },
    {
      key: 'inspect',
      title: 'Open an inspection run',
      detail: `Sample batch ${DEMO_BATCH} is inspected against plan ${plan?.id ?? '—'}.`,
      route: '/eng/inspections',
      done: !!ins,
      action: plan && {
        label: `Start inspection for ${DEMO_BATCH}`,
        run: async () => `/eng/inspections/${(await api.post<{ id: string }>('/api/eng/inspections', { planId: plan.id, batch: DEMO_BATCH, inspector: DEMO_INSPECTOR })).id}`,
      },
    },
    {
      key: 'measure',
      title: 'Enter measurements',
      detail: 'Most values pass; one C01 sample (120.34 mm) exceeds the 120.20 mm upper limit.',
      route: ins ? `/eng/inspections/${ins.id}` : '/eng/inspections',
      done: !!ins && ins.measurements.some((m) => m.value !== undefined),
      action: ins && {
        label: 'Enter demo measurements',
        run: async () => {
          const values: Record<string, number | string> = {};
          for (const [code, vs] of Object.entries(DEMO_MEASUREMENTS)) vs.forEach((v, i) => (values[`${code}:${i + 1}`] = v));
          await api.put(`/api/eng/inspections/${ins.id}`, { values, comments: 'Demo run — first-off batch after Rev B change.' });
        },
      },
    },
    {
      key: 'complete',
      title: 'Complete inspection → nonconformance',
      detail: 'The failed characteristic raises an NCR in Exceptions & Actions. Batch disposition stays with QA.',
      route: ins ? `/eng/inspections/${ins.id}` : '/eng/inspections',
      done: ins?.status === 'completed',
      action: ins && { label: 'Complete inspection', run: async () => void (await api.post(`/api/eng/inspections/${ins.id}/complete`)) },
    },
    {
      key: 'trace',
      title: 'Trace the problem',
      detail: 'Follow the chain from OEM and drawing revision to batch, measurement and corrective action.',
      route: ins ? `/eng/inspections/${ins.id}` : '/eng/inspections',
      done: ins?.status === 'completed' && seen.includes('trace'),
      action: { label: 'Show traceability', run: async () => markVisited('trace') },
    },
  ];
}

export function DemoGuide() {
  const { data } = useEng();
  const { changed, toast } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (loc.pathname === `/eng/drawings/${REV}`) {
      markVisited('open');
      force((x) => x + 1);
    }
  }, [loc.pathname]);

  if (!data) return null;
  const steps = buildSteps(data);
  const idx = steps.findIndex((s) => !s.done);
  const current = idx === -1 ? null : steps[idx];
  const here = current && loc.pathname + loc.search === current.route;

  const next = async () => {
    if (!current) return;
    if (!here) {
      navigate(current.route);
      if (current.key === 'trace') document.getElementById('trace')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!current.action) return;
    setBusy(true);
    try {
      const to = await current.action.run();
      changed();
      if (typeof to === 'string') navigate(to);
      if (current.key === 'trace') {
        force((x) => x + 1);
        document.getElementById('trace')?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset the Engineering & QC demo scenario? Production data is not affected.')) return;
    await api.post('/api/eng/reset');
    try {
      sessionStorage.removeItem(VISIT_KEY);
    } catch {
      /* ignore */
    }
    changed();
    navigate('/eng/drawings');
    toast('Engineering demo scenario reset');
  };

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50/80 to-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <PlayCircle className="h-5 w-5 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">
            Guided demo · revised bath-spout drawing <span className="font-normal text-slate-500">({current ? `step ${idx + 1} of ${steps.length}` : 'complete'})</span>
          </div>
          <div className="truncate text-xs text-slate-600">{current ? `${current.title} — ${current.detail}` : 'Scenario complete. Reset to present it again.'}</div>
        </div>
        {current && (
          <Button variant="primary" size="sm" onClick={next} loading={busy}>
            {here ? (current.action ? current.action.label : 'Done') : 'Next step →'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={reset} title="Reset only the Engineering & QC scenario">
          <RotateCcw className="h-3.5 w-3.5" /> Reset scenario
        </Button>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md p-1 text-slate-400 hover:bg-white" aria-label={open ? 'Hide steps' : 'Show steps'}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <ol className="flex gap-1 overflow-x-auto border-t border-amber-100 px-4 py-2.5">
          {steps.map((s, i) => (
            <li key={s.key} className="shrink-0">
              <button
                onClick={() => navigate(s.route)}
                title={s.detail}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
                  s.done ? 'bg-green-50 text-green-700' : i === idx ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200',
                )}
              >
                {s.done ? <Check className="h-3 w-3" /> : <span className="num">{i + 1}</span>}
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Common frame for Engineering & QC pages: header, acting identity, guided demo. */
export function EngPage({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            <PersonaPicker />
          </>
        }
      />
      <DemoGuide />
      {children}
    </div>
  );
}
