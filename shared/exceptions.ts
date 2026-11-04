import { allOrderProgress, findBottleneck, stageDaySummary, stageSettings } from './calc';
import { SEVERITY_RANK, stageName } from './constants';
import { daysBetween, fmtShortDate, isWorkingDay } from './dates';
import type { DB, DetectedException, Issue, IssueType, Severity, StageId } from './types';

const fmt = (n: number) => n.toLocaleString('en-IN');

/** Standard first response for each exception type, per stage where it matters. Deterministic — no LLM required. */
const PLAYBOOK: Record<IssueType, (stage?: StageId) => string> = {
  shortfall: (s) =>
    s === 'plating'
      ? 'Check rectifier load and bath availability; confirm jig loading plan for next shift.'
      : s === 'polishing'
        ? 'Check operator attendance and buffing-wheel stock; rebalance operators from upstream stages if WIP is low.'
        : s === 'machining'
          ? 'Review machine-wise output; check tool availability and set-up delays on CNC/VMC.'
          : 'Review shift-wise output with the stage supervisor and confirm manpower and material for the next shift.',
  quality: (s) =>
    s === 'plating'
      ? 'Hold suspect lots; test bath chemistry (nickel, brightener, contamination) and check rack contact.'
      : s === 'machining'
        ? 'Quarantine the lot; check tool wear and first-piece inspection records; verify drawing revision.'
        : s === 'assembly'
          ? 'Segregate leak-test failures by cause (cartridge, O-ring, body porosity) and inform upstream stages.'
          : 'Segregate rejects by defect type, inform the stage in-charge and review first-piece approval.',
  downtime: () => 'Log root cause with maintenance, confirm spare availability and recovery plan for lost output.',
  bottleneck: (s) =>
    `Prioritise ${s ? stageName(s) : 'the bottleneck stage'}: extend shift or add a third shift, avoid starving it of manpower, and slow release upstream until WIP clears.`,
  order_risk: () => 'Re-sequence the order ahead of lower-priority work at its current stage and confirm a revised date with sales.',
  data_gap: () => 'Ask the stage supervisor to submit the missing shift report (manual entry or Excel import).',
  other: () => 'Review with the production manager.',
};

export function suggestedActionFor(type: IssueType, stage?: StageId) {
  return PLAYBOOK[type](stage);
}

/** Resolved incidents with the same type (and stage when given) — the plant's operational memory. */
export function similarIncidents(issues: Issue[], type: IssueType, stage?: StageId, asOf?: string, limit = 3) {
  const resolved = issues
    .filter((i) => i.status === 'resolved' && (!asOf || (i.resolvedDate ?? i.detectedDate) <= asOf))
    .sort((a, b) => (b.resolvedDate ?? b.detectedDate).localeCompare(a.resolvedDate ?? a.detectedDate));
  // Best match: same type at the same stage; then other problems at the same stage.
  const exact = resolved.filter((i) => i.type === type && (!stage || i.stage === stage));
  const sameStage = stage ? resolved.filter((i) => i.stage === stage && i.type !== type) : [];
  return [...exact, ...sameStage]
    .slice(0, limit)
    .map(({ id, title, type, detectedDate, rootCause, correctiveAction, resolution }) => ({ id, title, type, detectedDate, rootCause, correctiveAction, resolution }));
}

export function detectExceptions(db: DB, date: string): DetectedException[] {
  const out: Omit<DetectedException, 'linkedIssueId' | 'similarIncidents' | 'suggestedAction'>[] = [];
  const stages = stageDaySummary(db, date);
  const s = db.settings;
  const working = isWorkingDay(date);
  const totalEntries = stages.reduce((a, x) => a + x.entryCount, 0);

  if (working && totalEntries === 0) {
    out.push({
      key: `data_gap:${date}:all`,
      date,
      type: 'data_gap',
      severity: 'high',
      title: `No production recorded for ${fmtShortDate(date)}`,
      detail: 'No stage has submitted a shift report for this working day.',
    });
  }

  for (const st of stages) {
    if (totalEntries > 0 && st.entryCount === 0 && working) {
      out.push({
        key: `data_gap:${date}:${st.stage}`,
        date,
        type: 'data_gap',
        severity: 'medium',
        stage: st.stage,
        title: `${st.name}: no production report`,
        detail: `Other stages reported for ${fmtShortDate(date)} but ${st.name} has no entries. Figures for this stage show as zero until it is recorded.`,
      });
      continue;
    }
    if (st.entryCount === 0) continue;

    if (st.target > 0 && st.attainmentPct < s.shortfallPct) {
      const severity: Severity = st.attainmentPct < 60 ? 'critical' : st.attainmentPct < 75 ? 'high' : 'medium';
      out.push({
        key: `shortfall:${date}:${st.stage}`,
        date,
        type: 'shortfall',
        severity,
        stage: st.stage,
        title: `${st.name} at ${st.attainmentPct}% of target`,
        detail: `${fmt(st.goodQty)} good units against a target of ${fmt(st.target)} (shortfall ${fmt(st.target - st.goodQty)}).`,
      });
    }

    if (st.processedQty >= 50 && st.rejectRatePct > st.rejectThresholdPct) {
      out.push({
        key: `quality:${date}:${st.stage}`,
        date,
        type: 'quality',
        severity: st.rejectRatePct > st.rejectThresholdPct * 2 ? 'high' : 'medium',
        stage: st.stage,
        title: `${st.name} rejection ${st.rejectRatePct}% (limit ${st.rejectThresholdPct}%)`,
        detail: `${fmt(st.rejectQty)} rejected out of ${fmt(st.processedQty)} processed.`,
      });
    }

    if (st.downtimeMin > s.downtimeAlertMin) {
      const reasons = new Map<string, number>();
      for (const e of db.entries)
        if (e.date === date && e.stage === st.stage && e.downtimeMin > 0)
          reasons.set(e.downtimeReason || 'Unspecified', (reasons.get(e.downtimeReason || 'Unspecified') ?? 0) + e.downtimeMin);
      const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, m]) => `${r} (${m} min)`).join(', ');
      out.push({
        key: `downtime:${date}:${st.stage}`,
        date,
        type: 'downtime',
        severity: st.downtimeMin > 180 ? 'high' : 'medium',
        stage: st.stage,
        title: `${st.name} lost ${st.downtimeMin} min to downtime`,
        detail: top ? `Reasons: ${top}.` : 'No reason recorded.',
      });
    }
  }

  const bn = findBottleneck(stages, s);
  if (bn) {
    const prev = stages[stages.findIndex((x) => x.stage === bn.stage) - 1];
    out.push({
      key: `bottleneck:${date}:${bn.stage}`,
      date,
      type: 'bottleneck',
      severity: bn.daysOfWork >= 2 ? 'high' : 'medium',
      stage: bn.stage,
      title: `${stageName(bn.stage)} is the bottleneck — ${fmt(bn.queue)} units waiting`,
      detail: `WIP waiting after ${prev.name} equals ${bn.daysOfWork} days of ${stageName(bn.stage)} capacity (${fmt(stageSettings(s, bn.stage).dailyTarget)}/day).`,
    });
  }

  for (const p of allOrderProgress(db, date)) {
    if (p.status !== 'delayed' && p.status !== 'at_risk') continue;
    const o = p.order;
    const remaining = o.quantity - p.completedQty;
    if (p.status === 'delayed') {
      out.push({
        key: `order_risk:${o.id}`,
        date,
        type: 'order_risk',
        severity: 'critical',
        orderId: o.id,
        stage: p.currentStage ?? undefined,
        title: `${o.id} is ${p.daysLate} day${p.daysLate === 1 ? '' : 's'} overdue`,
        detail: `${p.productName} for ${o.customer}: ${fmt(p.completedQty)}/${fmt(o.quantity)} packed, ${fmt(remaining)} remaining. Due ${fmtShortDate(o.dueDate)}${p.projectedFinish ? `, projected ${fmtShortDate(p.projectedFinish)}` : ''}.`,
      });
    } else {
      const dueIn = daysBetween(date, o.dueDate);
      out.push({
        key: `order_risk:${o.id}`,
        date,
        type: 'order_risk',
        severity: dueIn <= 3 ? 'high' : 'medium',
        orderId: o.id,
        stage: p.currentStage ?? undefined,
        title: `${o.id} projected ${p.daysLate} day${p.daysLate === 1 ? '' : 's'} late`,
        detail: `${p.productName} for ${o.customer}: ${fmt(p.completedQty)}/${fmt(o.quantity)} packed. Due ${fmtShortDate(o.dueDate)} (in ${dueIn} days), projected ${fmtShortDate(p.projectedFinish!)}${p.currentStage ? `; currently at ${stageName(p.currentStage)}` : ''}.`,
      });
    }
  }

  return out
    .map((x) => {
      const linked = db.issues.find((i) => i.exceptionKey === x.key);
      const memoryStage = x.type === 'order_risk' ? undefined : x.stage;
      return {
        ...x,
        suggestedAction: suggestedActionFor(x.type, x.stage),
        linkedIssueId: linked?.id,
        similarIncidents: x.type === 'data_gap' ? [] : similarIncidents(db.issues, x.type, memoryStage, date),
      };
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.type.localeCompare(b.type));
}
