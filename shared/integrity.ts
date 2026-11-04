import { FINAL_STAGE, SHIFTS, STAGE_IDS, stageName } from './constants';
import { fmtShortDate, isIsoDate } from './dates';
import type { DB, FlowViolation, Order, ProductionEntry, Settings } from './types';

export type EntryInput = Pick<
  ProductionEntry,
  'date' | 'shift' | 'orderId' | 'stage' | 'goodQty' | 'rejectQty' | 'downtimeMin' | 'downtimeReason' | 'supervisor' | 'notes'
>;

const fmt = (n: number) => n.toLocaleString('en-IN');

/** Field-level checks that don't depend on other records. */
export function validateEntryFields(e: Partial<EntryInput>, today: string): string[] {
  const errs: string[] = [];
  if (!isIsoDate(e.date)) errs.push('Date is missing or invalid.');
  else if (e.date > today) errs.push(`Date ${e.date} is in the future.`);
  if (!e.shift || !SHIFTS.includes(e.shift)) errs.push('Shift must be A, B or C.');
  if (!e.stage || !STAGE_IDS.includes(e.stage)) errs.push('Stage is missing or not recognised.');
  if (!e.orderId) errs.push('Work order is required.');
  for (const [k, label] of [
    ['goodQty', 'Good quantity'],
    ['rejectQty', 'Reject quantity'],
    ['downtimeMin', 'Downtime'],
  ] as const) {
    const v = e[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) errs.push(`${label} must be a whole number ≥ 0.`);
  }
  if ((e.downtimeMin ?? 0) > 720) errs.push('Downtime cannot exceed 720 minutes for one shift.');
  if (e.goodQty === 0 && e.rejectQty === 0 && (e.downtimeMin ?? 0) === 0) errs.push('Enter a good, reject or downtime figure.');
  if ((e.downtimeMin ?? 0) > 0 && !e.downtimeReason) errs.push('Select a downtime reason.');
  if (!e.supervisor?.trim()) errs.push('Supervisor name is required.');
  return errs;
}

export const entryKey = (e: Pick<ProductionEntry, 'date' | 'shift' | 'orderId' | 'stage'>) => `${e.date}|${e.shift}|${e.orderId}|${e.stage}`;

/** One record per order + stage + shift + date. A second submission is a duplicate (edit the existing one instead). */
export function findDuplicate(entries: ProductionEntry[], e: Pick<ProductionEntry, 'date' | 'shift' | 'orderId' | 'stage'>, ignoreId?: string) {
  const k = entryKey(e);
  return entries.find((x) => x.id !== ignoreId && entryKey(x) === k);
}

/**
 * Flow integrity for one order, checked cumulatively at every date:
 *  - a stage cannot process (good + reject) more units than the previous stage has delivered as good output by that date;
 *  - the first stage may exceed the order quantity only by the configured allowance (to replace downstream rejects);
 *  - the final stage cannot pack more than the order quantity.
 * This is what prevents the same units being counted twice as they move between stages.
 */
export function validateOrderFlow(order: Order, entries: ProductionEntry[], settings: Settings): FlowViolation[] {
  const mine = entries.filter((e) => e.orderId === order.id);
  const dates = [...new Set(mine.map((e) => e.date))].sort();
  const good: Record<string, number> = {};
  const processed: Record<string, number> = {};
  for (const id of STAGE_IDS) good[id] = processed[id] = 0;
  const byDate = new Map<string, ProductionEntry[]>();
  for (const e of mine) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  const firstCap = Math.ceil(order.quantity * (1 + settings.firstStageAllowancePct / 100));
  const violations: FlowViolation[] = [];
  const seen = new Set<string>();
  const add = (v: FlowViolation) => {
    const k = v.stage;
    if (seen.has(k)) return;
    seen.add(k);
    violations.push(v);
  };
  for (const d of dates) {
    for (const e of byDate.get(d)!) {
      good[e.stage] += e.goodQty;
      processed[e.stage] += e.goodQty + e.rejectQty;
    }
    STAGE_IDS.forEach((id, i) => {
      if (i === 0) {
        if (good[id] > firstCap)
          add({
            orderId: order.id,
            stage: id,
            date: d,
            message: `${stageName(id)} output for ${order.id} would reach ${fmt(good[id])} by ${fmtShortDate(d)}, above the order quantity of ${fmt(order.quantity)} + ${settings.firstStageAllowancePct}% allowance (${fmt(firstCap)}).`,
          });
        return;
      }
      const prev = STAGE_IDS[i - 1];
      if (processed[id] > good[prev])
        add({
          orderId: order.id,
          stage: id,
          date: d,
          message: `${stageName(id)} would have processed ${fmt(processed[id])} units of ${order.id} by ${fmtShortDate(d)}, but ${stageName(prev)} has only delivered ${fmt(good[prev])} good units by then. Record the ${stageName(prev)} output first or correct the quantity.`,
        });
      if (id === FINAL_STAGE && good[id] > order.quantity)
        add({
          orderId: order.id,
          stage: id,
          date: d,
          message: `Packed quantity for ${order.id} would reach ${fmt(good[id])}, above the order quantity of ${fmt(order.quantity)}.`,
        });
    });
  }
  return violations;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  duplicateOf?: string;
}

/**
 * Full validation of a proposed create/update against the database.
 * `replaceId` is the entry being edited (or a duplicate being overwritten on import).
 */
export function checkEntry(db: DB, input: Partial<EntryInput>, today: string, replaceId?: string): CheckResult {
  const errors = validateEntryFields(input, today);
  if (errors.length) return { ok: false, errors };
  const e = input as EntryInput;
  const order = db.orders.find((o) => o.id === e.orderId);
  if (!order) return { ok: false, errors: [`Work order ${e.orderId} does not exist. Create the order first.`] };
  const dup = findDuplicate(db.entries, e, replaceId);
  if (dup) return { ok: false, duplicateOf: dup.id, errors: [`An entry already exists for ${e.orderId} · ${stageName(e.stage)} · Shift ${e.shift} on ${e.date} (${dup.id}). Edit that entry instead of adding a second one.`] };
  const proposed: ProductionEntry = { ...e, id: replaceId ?? '__new__', source: 'manual', createdAt: '', updatedAt: '' };
  const next = db.entries.filter((x) => x.orderId === order.id && x.id !== replaceId).concat(proposed);
  const violations = validateOrderFlow(order, next, db.settings);
  // Only report violations the change introduces.
  const before = new Set(validateOrderFlow(order, db.entries.filter((x) => x.orderId === order.id), db.settings).map((v) => v.stage));
  const introduced = violations.filter((v) => !before.has(v.stage));
  return introduced.length ? { ok: false, errors: introduced.map((v) => v.message) } : { ok: true, errors: [] };
}

/** Deleting an upstream entry can strand downstream quantities; block that. */
export function checkDelete(db: DB, id: string): CheckResult {
  const target = db.entries.find((e) => e.id === id);
  if (!target) return { ok: false, errors: ['Entry not found.'] };
  const order = db.orders.find((o) => o.id === target.orderId);
  if (!order) return { ok: true, errors: [] };
  const mine = db.entries.filter((x) => x.orderId === order.id);
  const before = new Set(validateOrderFlow(order, mine, db.settings).map((v) => v.stage));
  const after = validateOrderFlow(order, mine.filter((x) => x.id !== id), db.settings).filter((v) => !before.has(v.stage));
  return after.length
    ? { ok: false, errors: [`Deleting this entry would leave downstream stages with more units than were supplied: ${after[0].message}`] }
    : { ok: true, errors: [] };
}

/** Units of an order available for a stage to process on a date (good output of previous stage minus what this stage already processed). */
export function availableForStage(db: DB, orderId: string, stage: ProductionEntry['stage'], date: string, ignoreId?: string): number | null {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const i = STAGE_IDS.indexOf(stage);
  let supplied = 0;
  let processed = 0;
  let good = 0;
  for (const e of db.entries) {
    if (e.orderId !== orderId || e.date > date || e.id === ignoreId) continue;
    if (i > 0 && e.stage === STAGE_IDS[i - 1]) supplied += e.goodQty;
    if (e.stage === stage) {
      processed += e.goodQty + e.rejectQty;
      good += e.goodQty;
    }
  }
  if (i === 0) return Math.max(0, Math.ceil(order.quantity * (1 + db.settings.firstStageAllowancePct / 100)) - good);
  const avail = Math.max(0, supplied - processed);
  return stage === FINAL_STAGE ? Math.min(avail, Math.max(0, order.quantity - good)) : avail;
}
