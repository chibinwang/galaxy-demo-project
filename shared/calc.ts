import { FINAL_STAGE, STAGES, STAGE_IDS } from './constants';
import { addDays, addWorkingDays, daysBetween, isWorkingDay, lastWorkingDays } from './dates';
import type {
  DB,
  Order,
  OrderProgress,
  OrderStatus,
  ProductionEntry,
  Settings,
  StageDay,
  StageId,
  StageSettings,
} from './types';

/*
 * Data-integrity rule for all aggregates:
 * a unit passes through every stage, so stage quantities are THROUGHPUT and must never be summed into a factory total.
 * Factory output = good units completing the final stage (Packing) only.
 */

export const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
export const round1 = (n: number) => Math.round(n * 10) / 10;

export function stageSettings(settings: Settings, stage: StageId): StageSettings {
  return settings.stages.find((s) => s.stage === stage) ?? { stage, dailyTarget: 0, rejectThresholdPct: 100 };
}

export function finalTarget(settings: Settings): number {
  return stageSettings(settings, FINAL_STAGE).dailyTarget;
}

/** Finished output for a date: good units packed. This is the only "total production" figure. */
export function finishedOutput(entries: ProductionEntry[], date: string): number {
  let sum = 0;
  for (const e of entries) if (e.date === date && e.stage === FINAL_STAGE) sum += e.goodQty;
  return sum;
}

/** Per-stage summary for one date, including the WIP queue in front of each stage at end of day. */
export function stageDaySummary(db: DB, date: string): StageDay[] {
  const cumGood: Record<string, number> = {};
  const cumProcessed: Record<string, number> = {};
  const day: Record<string, { good: number; reject: number; downtime: number; count: number }> = {};
  for (const id of STAGE_IDS) {
    cumGood[id] = 0;
    cumProcessed[id] = 0;
    day[id] = { good: 0, reject: 0, downtime: 0, count: 0 };
  }
  for (const e of db.entries) {
    if (e.date > date) continue;
    cumGood[e.stage] += e.goodQty;
    cumProcessed[e.stage] += e.goodQty + e.rejectQty;
    if (e.date === date) {
      const d = day[e.stage];
      d.good += e.goodQty;
      d.reject += e.rejectQty;
      d.downtime += e.downtimeMin;
      d.count++;
    }
  }
  return STAGES.map((s, i) => {
    const cfg = stageSettings(db.settings, s.id);
    const d = day[s.id];
    const processed = d.good + d.reject;
    const target = isWorkingDay(date) ? cfg.dailyTarget : 0;
    return {
      stage: s.id,
      name: s.name,
      goodQty: d.good,
      rejectQty: d.reject,
      processedQty: processed,
      downtimeMin: d.downtime,
      target,
      attainmentPct: round1(pct(d.good, target)),
      rejectRatePct: round1(pct(d.reject, processed)),
      rejectThresholdPct: cfg.rejectThresholdPct,
      entryCount: d.count,
      queueBefore: i === 0 ? 0 : Math.max(0, cumGood[STAGE_IDS[i - 1]] - cumProcessed[s.id]),
    };
  });
}

/** About one day of WIP in front of every stage is normal (each shift works what upstream delivered earlier). */
export const BOTTLENECK_DAYS = 1.5;

/** The stage with the largest backlog relative to its daily capacity, if that backlog is clearly above normal. */
export function findBottleneck(stages: StageDay[], settings: Settings): { stage: StageId; queue: number; daysOfWork: number } | null {
  let best: { stage: StageId; queue: number; daysOfWork: number } | null = null;
  for (const s of stages.slice(1)) {
    const cap = stageSettings(settings, s.stage).dailyTarget;
    if (cap <= 0) continue;
    const daysOfWork = s.queueBefore / cap;
    if (!best || daysOfWork > best.daysOfWork) best = { stage: s.stage, queue: s.queueBefore, daysOfWork };
  }
  return best && best.daysOfWork >= BOTTLENECK_DAYS ? { ...best, daysOfWork: round1(best.daysOfWork) } : null;
}

export interface DayKpis {
  date: string;
  finishedOutput: number;
  finishedTarget: number;
  attainmentPct: number;
  rejectQty: number;
  processedQty: number;
  rejectRatePct: number;
  downtimeMin: number;
  entryCount: number;
}

export function dayKpis(db: DB, date: string, stages = stageDaySummary(db, date)): DayKpis {
  const finished = stages.find((s) => s.stage === FINAL_STAGE)!;
  const rejectQty = stages.reduce((a, s) => a + s.rejectQty, 0);
  const processedQty = stages.reduce((a, s) => a + s.processedQty, 0);
  return {
    date,
    finishedOutput: finished.goodQty,
    finishedTarget: finished.target,
    attainmentPct: finished.attainmentPct,
    rejectQty,
    processedQty,
    // weighted rejection rate across stages (a rate, not an output total — safe to combine)
    rejectRatePct: round1(pct(rejectQty, processedQty)),
    downtimeMin: stages.reduce((a, s) => a + s.downtimeMin, 0),
    entryCount: stages.reduce((a, s) => a + s.entryCount, 0),
  };
}

export interface SeriesPoint {
  date: string;
  finished: number;
  target: number;
  attainmentPct: number;
  rejectRatePct: number;
  downtimeMin: number;
  entries: number;
}

/** Daily series over a date range: every working day plus any non-working day that has data. */
export function dailySeries(db: DB, from: string, to: string): SeriesPoint[] {
  const byDate = new Map<string, { finished: number; reject: number; processed: number; downtime: number; entries: number }>();
  for (const e of db.entries) {
    if (e.date < from || e.date > to) continue;
    let d = byDate.get(e.date);
    if (!d) byDate.set(e.date, (d = { finished: 0, reject: 0, processed: 0, downtime: 0, entries: 0 }));
    if (e.stage === FINAL_STAGE) d.finished += e.goodQty;
    d.reject += e.rejectQty;
    d.processed += e.goodQty + e.rejectQty;
    d.downtime += e.downtimeMin;
    d.entries++;
  }
  const target = finalTarget(db.settings);
  const out: SeriesPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = byDate.get(d);
    if (!isWorkingDay(d) && !v) continue;
    const t = isWorkingDay(d) ? target : 0;
    out.push({
      date: d,
      finished: v?.finished ?? 0,
      target: t,
      attainmentPct: round1(pct(v?.finished ?? 0, t)),
      rejectRatePct: round1(pct(v?.reject ?? 0, v?.processed ?? 0)),
      downtimeMin: v?.downtime ?? 0,
      entries: v?.entries ?? 0,
    });
  }
  return out;
}

export function latestEntryDate(db: DB, onOrBefore?: string): string | null {
  let max: string | null = null;
  for (const e of db.entries) if ((!onOrBefore || e.date <= onOrBefore) && (!max || e.date > max)) max = e.date;
  return max;
}

// ---------------- Orders ----------------

const PROJECTION_WINDOW = 5;
/** A unit needs roughly this many working days to move through each remaining stage (shift reports, inspection, transport). */
const TRANSIT_DAYS_PER_STAGE = 0.8;

const priorityRank = (o: Order) => (o.priority === 'High' ? 0 : o.priority === 'Normal' ? 1 : 2);
/** Sequence in which the plant works orders: priority, then due date. */
export const orderSequence = (a: Order, b: Order) => priorityRank(a) - priorityRank(b) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id);

interface ProjectionContext {
  /** Packing work still remaining on orders sequenced ahead of this one. */
  aheadRemaining: number;
  /** Recent finished output per working day. */
  plantRate: number;
}

function orderProgress(db: DB, order: Order, asOf: string, ctx: ProjectionContext): OrderProgress {
  const good: Record<string, number> = {};
  const rej: Record<string, number> = {};
  for (const id of STAGE_IDS) good[id] = rej[id] = 0;
  let any = false;
  for (const e of db.entries) {
    if (e.orderId !== order.id || e.date > asOf) continue;
    any = true;
    good[e.stage] += e.goodQty;
    rej[e.stage] += e.rejectQty;
  }
  const stages = STAGE_IDS.map((id, i) => ({
    stage: id,
    goodQty: good[id],
    rejectQty: rej[id],
    waiting: i === 0 ? 0 : Math.max(0, good[STAGE_IDS[i - 1]] - good[id] - rej[id]),
  }));
  const completed = good[FINAL_STAGE];
  const qty = order.quantity;

  // Current stage = the furthest-downstream stage holding WIP for this order.
  let currentStage: StageId | null = null;
  if (completed < qty && any) {
    for (let i = STAGE_IDS.length - 1; i >= 1; i--) if (stages[i].waiting > 0) { currentStage = STAGE_IDS[i]; break; }
    if (!currentStage) currentStage = STAGE_IDS[0];
  }

  let status: OrderStatus;
  let projectedFinish: string | null = null;
  if (completed >= qty) status = 'completed';
  else {
    // Queue-based projection: finished-goods work ahead of this order plus its own remainder, at the recent plant rate,
    // plus transit time through the stages this order has not reached yet.
    let furthest = -1;
    STAGE_IDS.forEach((id, i) => { if (good[id] > 0) furthest = i; });
    const transit = Math.max(0, STAGE_IDS.length - 1 - furthest) * TRANSIT_DAYS_PER_STAGE;
    const days = Math.max((ctx.aheadRemaining + (qty - completed)) / ctx.plantRate, transit + (qty - completed) / ctx.plantRate);
    projectedFinish = addWorkingDays(asOf, Math.max(1, days));
    if (order.dueDate < asOf) status = 'delayed';
    else if (projectedFinish > order.dueDate) status = 'at_risk';
    else status = any ? 'on_track' : 'not_started';
  }
  const daysLate =
    status === 'delayed' ? daysBetween(order.dueDate, asOf) : status === 'at_risk' && projectedFinish ? daysBetween(order.dueDate, projectedFinish) : 0;

  return {
    order,
    productName: db.products.find((p) => p.code === order.productCode)?.name ?? order.productCode,
    completedQty: completed,
    completionPct: round1(pct(Math.min(completed, qty), qty)),
    stages,
    currentStage,
    status,
    projectedFinish,
    daysLate,
  };
}

/** Progress for every order released on or before `asOf`, in expected work sequence. */
export function allOrderProgress(db: DB, asOf: string): OrderProgress[] {
  // Overdue orders are expedited ahead of everything else, then normal work sequence.
  const overdue = (o: Order) => (o.dueDate < asOf ? 0 : 1);
  const released = db.orders.filter((o) => o.releaseDate <= asOf).sort((a, b) => overdue(a) - overdue(b) || orderSequence(a, b));
  const packed = new Map<string, number>();
  for (const e of db.entries) if (e.stage === FINAL_STAGE && e.date <= asOf) packed.set(e.orderId, (packed.get(e.orderId) ?? 0) + e.goodQty);

  const window = lastWorkingDays(asOf, PROJECTION_WINDOW);
  const recent = window.map((d) => finishedOutput(db.entries, d));
  const recentAvg = recent.reduce((a, b) => a + b, 0) / PROJECTION_WINDOW;
  // Never project faster than plan, and never assume less than a quarter of plan (avoids absurd dates after a bad day).
  const plan = finalTarget(db.settings) || 1;
  const plantRate = Math.min(plan, Math.max(recentAvg, plan * 0.25));

  let ahead = 0;
  return released.map((o) => {
    const p = orderProgress(db, o, asOf, { aheadRemaining: ahead, plantRate });
    ahead += Math.max(0, o.quantity - (packed.get(o.id) ?? 0));
    return p;
  });
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  not_started: 'Not started',
  on_track: 'On track',
  at_risk: 'At risk',
  delayed: 'Delayed',
  completed: 'Completed',
};
