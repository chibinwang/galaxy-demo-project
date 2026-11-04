import { allOrderProgress, dayKpis, findBottleneck, round1, stageDaySummary } from './calc';
import { SEVERITY_RANK, stageName } from './constants';
import { fmtDate, fmtShortDate, lastWorkingDays } from './dates';
import { detectExceptions } from './exceptions';
import type { DB } from './types';

export interface BriefSection {
  title: string;
  bullets: string[];
}

export interface DailyBrief {
  date: string;
  plantName: string;
  headline: string;
  status: 'good' | 'watch' | 'critical';
  sections: BriefSection[];
  priorities: string[];
  markdown: string;
  whatsapp: string;
  demoData: boolean;
  basedOnEntries: number;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

/**
 * Deterministic management brief. Every statement is computed from recorded data with fixed rules,
 * so the same data always produces the same brief and every number can be traced back to entries.
 */
export function generateBrief(db: DB, date: string): DailyBrief {
  const stages = stageDaySummary(db, date);
  const k = dayKpis(db, date, stages);
  const exceptions = detectExceptions(db, date);
  const orders = allOrderProgress(db, date);
  const bn = findBottleneck(stages, db.settings);

  const prevDays = lastWorkingDays(date, 8).filter((d) => d < date).slice(-7);
  const prevOutputs = prevDays.map((d) => dayKpis(db, d).finishedOutput).filter((v) => v > 0);
  const avg7 = prevOutputs.length ? Math.round(prevOutputs.reduce((a, b) => a + b, 0) / prevOutputs.length) : 0;
  const vsAvg = avg7 ? round1(((k.finishedOutput - avg7) / avg7) * 100) : 0;

  const delayed = orders.filter((o) => o.status === 'delayed');
  const atRisk = orders.filter((o) => o.status === 'at_risk');
  const completedToday = orders.filter(
    (o) => o.status === 'completed' && db.entries.some((e) => e.orderId === o.order.id && e.date === date && e.stage === 'packing'),
  );

  const critical = exceptions.filter((e) => e.severity === 'critical').length;
  const status: DailyBrief['status'] =
    k.entryCount === 0 || critical > 0 || k.attainmentPct < 75 ? 'critical' : k.attainmentPct < 95 || exceptions.some((e) => e.severity === 'high') ? 'watch' : 'good';

  const headlineParts = [
    k.entryCount === 0 ? 'No production recorded' : `Finished output ${fmt(k.finishedOutput)} / ${fmt(k.finishedTarget)} (${k.attainmentPct}%)`,
  ];
  if (bn) headlineParts.push(`${stageName(bn.stage)} is the bottleneck`);
  if (delayed.length + atRisk.length) headlineParts.push(`${delayed.length + atRisk.length} order${delayed.length + atRisk.length === 1 ? '' : 's'} need attention`);
  const headline = headlineParts.join(' · ');

  const sections: BriefSection[] = [];

  // 1. Production
  const prod: string[] = [];
  if (k.entryCount === 0) prod.push('No shift reports have been recorded for this date.');
  else {
    prod.push(
      `Finished goods packed: **${fmt(k.finishedOutput)}** against a plan of ${fmt(k.finishedTarget)} (${k.attainmentPct}%).` +
        (avg7 ? ` ${vsAvg >= 0 ? 'Up' : 'Down'} ${Math.abs(vsAvg)}% vs the 7-day average of ${fmt(avg7)}.` : ''),
    );
    const below = stages.filter((s) => s.target > 0 && s.entryCount > 0 && s.attainmentPct < db.settings.shortfallPct);
    const ahead = stages.filter((s) => s.target > 0 && s.attainmentPct >= 100);
    if (below.length) prod.push(`Below plan: ${below.map((s) => `${s.name} ${s.attainmentPct}%`).join(', ')}.`);
    if (ahead.length) prod.push(`At or above plan: ${ahead.map((s) => `${s.name} ${s.attainmentPct}%`).join(', ')}.`);
    prod.push('Stage figures are throughput at each stage; only Packing output is counted as factory production.');
  }
  sections.push({ title: 'Production', bullets: prod });

  // 2. Flow & bottleneck
  const flow: string[] = [];
  if (bn) {
    flow.push(`**${stageName(bn.stage)}** is constraining flow: ${fmt(bn.queue)} units are waiting in front of it (${bn.daysOfWork} days of capacity).`);
  } else flow.push('No stage has more than one day of work queued — flow is balanced.');
  const queues = stages.filter((s) => s.queueBefore > 0).map((s) => `${s.name} ${fmt(s.queueBefore)}`);
  if (queues.length) flow.push(`WIP waiting by stage: ${queues.join(' · ')}.`);
  sections.push({ title: 'Flow & bottleneck', bullets: flow });

  // 3. Quality & downtime
  const qd: string[] = [];
  if (k.processedQty) qd.push(`Overall rejection ${k.rejectRatePct}% (${fmt(k.rejectQty)} units across all stages).`);
  for (const s of stages.filter((s) => s.processedQty >= 50 && s.rejectRatePct > s.rejectThresholdPct))
    qd.push(`${s.name} rejection ${s.rejectRatePct}% is above its ${s.rejectThresholdPct}% limit (${fmt(s.rejectQty)} units).`);
  if (k.downtimeMin) {
    const worst = [...stages].sort((a, b) => b.downtimeMin - a.downtimeMin)[0];
    qd.push(`Downtime ${fmt(k.downtimeMin)} min in total; highest at ${worst.name} (${worst.downtimeMin} min).`);
  } else if (k.entryCount) qd.push('No downtime recorded.');
  sections.push({ title: 'Quality & downtime', bullets: qd.length ? qd : ['No quality or downtime data recorded.'] });

  // 4. Orders
  const ord: string[] = [];
  for (const o of delayed)
    ord.push(`🔴 ${o.order.id} (${o.productName}, ${o.order.customer}) is ${o.daysLate} day${o.daysLate === 1 ? '' : 's'} overdue — ${fmt(o.completedQty)}/${fmt(o.order.quantity)} packed.`);
  for (const o of atRisk)
    ord.push(`🟠 ${o.order.id} (${o.productName}) due ${fmtShortDate(o.order.dueDate)}, projected ${fmtShortDate(o.projectedFinish!)} — ${o.completionPct}% complete${o.currentStage ? `, at ${stageName(o.currentStage)}` : ''}.`);
  for (const o of completedToday) ord.push(`✅ ${o.order.id} (${o.productName}, ${fmt(o.order.quantity)} pcs) completed packing.`);
  const active = orders.filter((o) => o.status !== 'completed').length;
  ord.push(`${active} open order${active === 1 ? '' : 's'} in production; ${orders.filter((o) => o.status === 'on_track').length} on track.`);
  sections.push({ title: 'Orders', bullets: ord });

  // 5. Actions
  const act: string[] = [];
  // Issue state as of the brief date, so briefs for past days stay historically accurate.
  const open = db.issues.filter((i) => i.detectedDate <= date && (i.status !== 'resolved' || (i.resolvedDate ?? '') > date));
  const overdue = open.filter((i) => i.dueDate && i.dueDate < date);
  const resolvedToday = db.issues.filter((i) => i.status === 'resolved' && i.resolvedDate === date);
  act.push(`${open.length} open corrective action${open.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}.`);
  for (const i of overdue.slice(0, 3)) act.push(`Overdue: ${i.id} ${i.title} — owner ${i.owner ?? 'unassigned'}, due ${fmtShortDate(i.dueDate!)}.`);
  for (const i of resolvedToday) act.push(`Resolved: ${i.id} ${i.title}.`);
  const untracked = exceptions.filter((e) => !e.linkedIssueId && (e.severity === 'critical' || e.severity === 'high'));
  if (untracked.length) act.push(`${untracked.length} high-severity exception${untracked.length === 1 ? ' has' : 's have'} no owner yet.`);
  sections.push({ title: 'Corrective actions', bullets: act });

  // Priorities: top exceptions → action, with the lesson from the most similar resolved incident.
  const priorities = [...exceptions]
    .filter((e) => e.type !== 'data_gap' || e.severity !== 'medium')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 4)
    .map((e) => {
      // Only cite a past fix for the same kind of problem.
      const mem = e.similarIncidents.find((m) => m.type === e.type);
      const lesson = mem?.correctiveAction ? ` Last time (${mem.id}, ${fmtShortDate(mem.detectedDate)}): ${mem.correctiveAction}` : '';
      return `${e.title}. ${e.suggestedAction}${lesson}`;
    });
  if (!priorities.length) priorities.push('No exceptions detected. Maintain the plan and confirm material for tomorrow.');

  const dataNotes: string[] = [];
  const gaps = exceptions.filter((e) => e.type === 'data_gap');
  if (gaps.length) dataNotes.push(`Missing reports: ${gaps.map((g) => (g.stage ? stageName(g.stage) : 'all stages')).join(', ')}.`);
  if (db.meta.demoData) dataNotes.push('Figures are SYNTHETIC DEMO DATA, not Galaxy Taps records.');
  dataNotes.push(`Based on ${fmt(k.entryCount)} shift entries. Generated offline by deterministic rules.`);
  sections.push({ title: 'Data notes', bullets: dataNotes });

  const title = `Daily Production Brief — ${fmtDate(date, true)}`;
  const md = [
    `# ${title}`,
    `**${db.settings.plantName}**`,
    '',
    `> ${headline}`,
    '',
    '## Priorities for today',
    ...priorities.map((p, i) => `${i + 1}. ${p}`),
    '',
    ...sections.flatMap((s) => [`## ${s.title}`, ...s.bullets.map((b) => `- ${b}`), '']),
    '| Stage | Good | Target | Attainment | Reject % | Downtime (min) | WIP waiting |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...stages.map((s) => `| ${s.name} | ${fmt(s.goodQty)} | ${fmt(s.target)} | ${s.attainmentPct}% | ${s.rejectRatePct}% | ${s.downtimeMin} | ${fmt(s.queueBefore)} |`),
  ].join('\n');

  const icon = status === 'good' ? '🟢' : status === 'watch' ? '🟡' : '🔴';
  const strip = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '*$1*');
  const wa = [
    `*${title}*`,
    db.settings.plantName,
    '',
    `${icon} ${headline}`,
    '',
    '*Priorities*',
    ...priorities.map((p, i) => `${i + 1}. ${strip(p)}`),
    '',
    '*Stage output (good / target)*',
    ...stages.map((s) => `• ${s.name}: ${fmt(s.goodQty)} / ${fmt(s.target)} (${s.attainmentPct}%)${s.rejectRatePct > s.rejectThresholdPct ? ` ⚠ rej ${s.rejectRatePct}%` : ''}`),
    '',
    ...sections.filter((s) => s.title === 'Orders').flatMap((s) => [`*${s.title}*`, ...s.bullets.map((b) => `• ${strip(b)}`)]),
    '',
    db.meta.demoData ? '_Demo data — synthetic figures_' : '_Everyse Factory Copilot_',
  ].join('\n');

  return {
    date,
    plantName: db.settings.plantName,
    headline,
    status,
    sections,
    priorities,
    markdown: md,
    whatsapp: wa,
    demoData: db.meta.demoData,
    basedOnEntries: k.entryCount,
  };
}
