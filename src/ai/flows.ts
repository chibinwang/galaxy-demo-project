import type { AiIntent, AiStep } from '../../shared/ai';
import type { DailyBrief } from '../../shared/brief';
import { stageName } from '../../shared/constants';
import { fmtShortDate } from '../../shared/dates';
import type { DetectedException, OrderProgress, StageDay, StageId } from '../../shared/types';
import { api, qs } from '../api';

/*
 * Mock agent. Plans are built from REAL plant data (read-only API calls) so the narration is credible,
 * but every external effect — messages, assignments, re-sequencing — is simulated.
 */

export interface Plan {
  intent: AiIntent;
  title: string;
  /** One line describing what the assistant intends to do, shown before approval. */
  intro: string;
  steps: AiStep[];
  result: string;
  link?: { to: string; label: string };
}

const fmt = (n: number) => n.toLocaleString('en-IN');

/** Demo owners per stage (synthetic names, matching the demo data). */
const STAGE_OWNER: Record<StageId, string> = {
  forging: 'Ramesh Yadav (Forging)',
  machining: 'Anil Sharma (Machining)',
  polishing: 'Mukesh Kumar (Polishing)',
  plating: 'Pooja Meena (Plating)',
  assembly: 'Sunita Devi (Assembly)',
  packing: 'Imran Khan (Packing)',
};

const RULES: [AiIntent, RegExp][] = [
  ['schedule', /\b(every|daily at|each day|routine|schedule|automatically|at \d)/i],
  ['brief', /\b(brief|report|whatsapp|send.*(management|summary)|share)/i],
  ['datagap', /\b(missing|remind|chase|not (submitted|reported)|reports? (pending|due))/i],
  ['expedite', /\b(expedite|re-?sequence|prioriti[sz]e|late|at risk|overdue|delay|move .* ahead|push)/i],
  ['assign', /\b(assign|owner|corrective|fix|action|handle|resolve|exception|problem|issue)/i],
  ['summary', /\b(how|what|status|summary|summari[sz]e|today|yesterday|output|production|bottleneck|why|kpi|performance)/i],
];

export function matchIntent(text: string): AiIntent | null {
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return null;
}

export const SUGGESTIONS = [
  'How did production go today?',
  "Send today's brief to management on WhatsApp",
  'Assign an owner to the top exception',
  'Expedite the orders at risk',
  'Remind supervisors about missing reports',
  'Every day at 6 pm, send the brief automatically',
];

interface Overview {
  date: string;
  kpis: { finishedOutput: number; finishedTarget: number; attainmentPct: number; rejectRatePct: number; downtimeMin: number; entryCount: number };
  stages: StageDay[];
  bottleneck: { stage: StageId; queue: number; daysOfWork: number } | null;
  exceptions: DetectedException[];
  attentionOrders: OrderProgress[];
}

export async function buildPlan(intent: AiIntent, prompt: string, date: string): Promise<Plan> {
  const ov = await api.get<Overview>(`/api/overview${qs({ date })}`);
  const d = fmtShortDate(ov.date);
  const k = ov.kpis;

  switch (intent) {
    case 'summary': {
      const top = ov.exceptions.slice(0, 3).map((e) => e.title);
      return {
        intent,
        title: `Production summary for ${d}`,
        intro: 'Reading the shift reports and computing the day’s figures.',
        steps: [
          { tool: 'Production data', label: 'Read shift reports', detail: `${fmt(k.entryCount)} entries across 6 stages` },
          { tool: 'Calculations', label: 'Computed KPIs', detail: `Packing ${fmt(k.finishedOutput)} / ${fmt(k.finishedTarget)} (${k.attainmentPct}%)` },
          { tool: 'Stage flow', label: 'Checked WIP and bottleneck', detail: ov.bottleneck ? `${stageName(ov.bottleneck.stage)} — ${fmt(ov.bottleneck.queue)} waiting` : 'Flow balanced' },
          { tool: 'Exceptions', label: 'Reviewed exceptions', detail: `${ov.exceptions.length} detected` },
        ],
        result:
          `On ${d} the plant packed **${fmt(k.finishedOutput)}** of ${fmt(k.finishedTarget)} planned (${k.attainmentPct}%). ` +
          (ov.bottleneck ? `**${stageName(ov.bottleneck.stage)}** is the bottleneck with ${fmt(ov.bottleneck.queue)} units waiting (${ov.bottleneck.daysOfWork} days of work). ` : 'No stage is constraining flow. ') +
          `Rejection ${k.rejectRatePct}%, downtime ${fmt(k.downtimeMin)} min. ` +
          (top.length ? `Top issues: ${top.join('; ')}.` : 'No exceptions.') +
          (ov.attentionOrders.length ? ` ${ov.attentionOrders.length} order(s) need attention.` : ''),
        link: { to: '/', label: 'Open Overview' },
      };
    }

    case 'brief': {
      const b = await api.get<DailyBrief>(`/api/brief${qs({ date })}`);
      return {
        intent,
        title: `Send daily brief for ${d}`,
        intro: 'I’ll generate the daily brief and share it with the Plant Management WhatsApp group.',
        steps: [
          { tool: 'Production data', label: 'Collected shift reports', detail: `${fmt(b.basedOnEntries)} entries for ${d}` },
          { tool: 'Exceptions', label: 'Ranked priorities', detail: `${b.priorities.length} priorities for today` },
          { tool: 'Brief engine', label: 'Generated daily brief', detail: b.headline },
          { tool: 'Formatter', label: 'Formatted for WhatsApp', detail: `${b.whatsapp.split('\n').length} lines` },
          { tool: 'WhatsApp', label: 'Sent to “Plant Management” group', detail: '4 recipients (simulated)' },
        ],
        result: `Brief for ${d} shared with Plant Management. Headline: “${b.headline}”.`,
        link: { to: '/brief', label: 'Open Daily Brief' },
      };
    }

    case 'assign': {
      // Prefer concrete, fixable problems over symptoms (a bottleneck or late order usually follows from one of these).
      const order: DetectedException['type'][] = ['quality', 'downtime', 'shortfall', 'bottleneck', 'order_risk'];
      const unowned = ov.exceptions.filter((e) => !e.linkedIssueId && e.type !== 'data_gap');
      const ex = [...unowned].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
      if (!ex)
        return {
          intent,
          title: 'Assign corrective actions',
          intro: 'Checking for exceptions without an owner.',
          steps: [{ tool: 'Exceptions', label: 'Scanned exceptions', detail: `${ov.exceptions.length} detected, all already have owners` }],
          result: 'Every exception already has an owner — nothing to assign.',
          link: { to: '/exceptions', label: 'Open Exceptions' },
        };
      const mem = ex.similarIncidents.find((m) => m.type === ex.type);
      const owner = ex.stage ? STAGE_OWNER[ex.stage] : 'Production Manager';
      const action = mem?.correctiveAction ?? ex.suggestedAction;
      return {
        intent,
        title: `Assign corrective action: ${ex.title}`,
        intro: `I’ll create a corrective action for “${ex.title}”, assign it to ${owner}, and notify them.`,
        steps: [
          { tool: 'Exceptions', label: 'Picked the top unowned exception', detail: `${ex.title} (${ex.severity})` },
          { tool: 'Incident memory', label: 'Searched past incidents', detail: mem ? `${mem.id} — ${mem.title}` : 'No similar incident found; using standard playbook' },
          { tool: 'Action tracker', label: 'Drafted corrective action', detail: action },
          { tool: 'Action tracker', label: 'Assigned owner', detail: `${owner}, due in ${ex.severity === 'critical' ? 1 : 2} day(s)` },
          { tool: 'WhatsApp', label: 'Notified owner', detail: `Message sent to ${owner.split(' (')[0]} (simulated)` },
        ],
        result: `Corrective action for “${ex.title}” assigned to **${owner}**${mem ? `, based on the fix from ${mem.id}` : ''}.`,
        link: { to: '/exceptions', label: 'Open Exceptions' },
      };
    }

    case 'expedite': {
      const orders = ov.attentionOrders;
      if (!orders.length)
        return {
          intent,
          title: 'Re-sequence at-risk orders',
          intro: 'Checking order delivery risk.',
          steps: [{ tool: 'Orders', label: 'Checked projected finish dates', detail: 'All open orders on track' }],
          result: 'No orders are delayed or at risk — sequence unchanged.',
          link: { to: '/orders', label: 'Open Orders' },
        };
      const list = orders.slice(0, 3);
      return {
        intent,
        title: `Re-sequence ${list.map((o) => o.order.id).join(', ')}`,
        intro: `I’ll move ${list.length} late or at-risk order(s) to the front of their current stage queue and tell sales the revised dates.`,
        steps: [
          { tool: 'Orders', label: 'Found orders needing attention', detail: list.map((o) => `${o.order.id} (${o.status === 'delayed' ? `${o.daysLate}d overdue` : `due ${fmtShortDate(o.order.dueDate)}`})`).join(', ') },
          { tool: 'Stage flow', label: 'Located their WIP', detail: list.map((o) => `${o.order.id} at ${o.currentStage ? stageName(o.currentStage) : '—'}`).join(', ') },
          { tool: 'Planner', label: 'Moved them to the front of each stage queue', detail: 'Lower-priority orders shifted back (simulated)' },
          { tool: 'Planner', label: 'Recalculated projected finish', detail: list.map((o) => `${o.order.id} → ${o.projectedFinish && o.projectedFinish > o.order.dueDate ? fmtShortDate(o.order.dueDate) : fmtShortDate(o.projectedFinish ?? o.order.dueDate)}`).join(', ') },
          { tool: 'WhatsApp', label: 'Informed sales coordinator', detail: 'Revised dates shared (simulated)' },
        ],
        result: `Re-sequenced ${list.map((o) => `**${o.order.id}**`).join(', ')} and shared revised dates with sales.`,
        link: { to: '/orders', label: 'Open Orders' },
      };
    }

    case 'datagap': {
      const gaps = ov.exceptions.filter((e) => e.type === 'data_gap');
      const quiet = ov.stages.filter((s) => s.target > 0 && s.entryCount < 4).map((s) => s.name);
      const missing = gaps.length ? gaps.map((g) => (g.stage ? stageName(g.stage) : 'All stages')) : quiet;
      return {
        intent,
        title: `Chase missing reports for ${d}`,
        intro: 'I’ll check which stages haven’t reported and remind their supervisors.',
        steps: [
          { tool: 'Production data', label: 'Checked reports per stage and shift', detail: `${fmt(k.entryCount)} entries for ${d}` },
          { tool: 'Production data', label: 'Identified missing reports', detail: missing.length ? missing.join(', ') : 'None — every stage reported' },
          ...(missing.length ? [{ tool: 'WhatsApp', label: 'Sent reminders to supervisors', detail: `${missing.length} reminder(s) (simulated)` }] : []),
        ],
        result: missing.length ? `Reminders sent for: ${missing.join(', ')}.` : `All stages reported for ${d} — no reminders needed.`,
        link: { to: '/production', label: 'Open Production Updates' },
      };
    }

    case 'schedule': {
      const m = prompt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      let hh = m ? Number(m[1]) : 18;
      if (m?.[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12;
      if (m?.[3]?.toLowerCase() === 'am' && hh === 12) hh = 0;
      const time = `${String(hh).padStart(2, '0')}:${m?.[2] ?? '00'}`;
      const what = /remind|missing/i.test(prompt) ? 'chase missing reports' : /exception|assign/i.test(prompt) ? 'assign owners to new exceptions' : 'send the daily brief to Plant Management';
      return {
        intent,
        title: `Create routine: ${what} at ${time}`,
        intro: `I’ll set up a recurring routine to ${what} every working day at ${time}, running autonomously.`,
        steps: [
          { tool: 'Scheduler', label: 'Parsed schedule', detail: `Mon–Sat at ${time} IST` },
          { tool: 'Scheduler', label: 'Created routine', detail: what },
          { tool: 'Autonomy', label: 'Set routine to run without approval', detail: 'Each run will be logged in History → AI action log' },
        ],
        result: `Routine created: **${what}** every working day at ${time}.`,
        link: { to: '/history?tab=ai', label: 'Open action log' },
      };
    }
  }
}
