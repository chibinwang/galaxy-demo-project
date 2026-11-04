import { describe, expect, it } from 'vitest';
import { defaultAiState } from '../shared/ai';
import { emptyEngState } from '../shared/eng';
import { generateBrief } from '../shared/brief';
import { allOrderProgress, dayKpis, finishedOutput, findBottleneck, stageDaySummary } from '../shared/calc';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { addWorkingDays, isWorkingDay, lastWorkingDays, parseFlexibleDate } from '../shared/dates';
import { detectExceptions } from '../shared/exceptions';
import { mapHeaders, parseShift, parseStage, previewProductionImport } from '../shared/importer';
import { availableForStage, checkDelete, checkEntry, validateOrderFlow } from '../shared/integrity';
import { generateDemoData } from '../shared/seed';
import type { DB, Order, ProductionEntry, StageId } from '../shared/types';

const TODAY = '2026-10-24'; // a Saturday (working day)

function emptyDb(): DB {
  return {
    version: 1,
    meta: { demoData: false },
    settings: structuredClone(DEFAULT_SETTINGS),
    products: [{ code: 'P1', name: 'Test Tap', category: 'x', source: 'manual' }],
    orders: [order('WO-1', 1000)],
    entries: [],
    issues: [],
    briefs: [],
    ai: defaultAiState(),
    eng: emptyEngState(),
  };
}

function order(id: string, quantity: number, dueDate = '2026-11-30'): Order {
  return { id, productCode: 'P1', customer: 'C', quantity, releaseDate: '2026-10-01', dueDate, priority: 'Normal', source: 'manual', createdAt: '' };
}

let seq = 0;
function entry(stage: StageId, goodQty: number, opts: Partial<ProductionEntry> = {}): ProductionEntry {
  return {
    id: `E${++seq}`,
    date: '2026-10-20',
    shift: 'A',
    orderId: 'WO-1',
    stage,
    goodQty,
    rejectQty: 0,
    downtimeMin: 0,
    supervisor: 'S',
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    ...opts,
  };
}

describe('no double counting across stages', () => {
  it('factory output counts only the final stage', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 500), entry('machining', 480), entry('polishing', 470), entry('plating', 460), entry('assembly', 455), entry('packing', 450)];
    expect(finishedOutput(db.entries, '2026-10-20')).toBe(450);
    const k = dayKpis(db, '2026-10-20');
    expect(k.finishedOutput).toBe(450);
    // A naive sum of every stage would be 2,815 — make sure nothing reports that.
    expect(k.finishedOutput).not.toBe(2815);
  });

  it('rejects a downstream stage processing more than upstream delivered', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 300), entry('machining', 200)];
    const r = checkEntry(db, { date: '2026-10-20', shift: 'B', orderId: 'WO-1', stage: 'polishing', goodQty: 190, rejectQty: 20, downtimeMin: 0, supervisor: 'S' }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Machining has only delivered 200/);
  });

  it('counts rejects as units consumed from the previous stage', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 300)];
    expect(checkEntry(db, { date: '2026-10-20', shift: 'B', orderId: 'WO-1', stage: 'machining', goodQty: 290, rejectQty: 10, downtimeMin: 0, supervisor: 'S' }, TODAY).ok).toBe(true);
    expect(checkEntry(db, { date: '2026-10-20', shift: 'B', orderId: 'WO-1', stage: 'machining', goodQty: 291, rejectQty: 10, downtimeMin: 0, supervisor: 'S' }, TODAY).ok).toBe(false);
  });

  it('is date-aware: a stage cannot use output that the previous stage records later', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 300, { date: '2026-10-21' })];
    const r = checkEntry(db, { date: '2026-10-20', shift: 'A', orderId: 'WO-1', stage: 'machining', goodQty: 100, rejectQty: 0, downtimeMin: 0, supervisor: 'S' }, TODAY);
    expect(r.ok).toBe(false);
  });

  it('caps packing at the order quantity and forging at the allowance', () => {
    const db = emptyDb();
    db.orders = [order('WO-1', 100)];
    const base = { date: '2026-10-20', shift: 'A' as const, orderId: 'WO-1', rejectQty: 0, downtimeMin: 0, supervisor: 'S' };
    expect(checkEntry(db, { ...base, stage: 'forging', goodQty: 115 }, TODAY).ok).toBe(true);
    expect(checkEntry(db, { ...base, stage: 'forging', goodQty: 116 }, TODAY).ok).toBe(false);
    db.entries = ['forging', 'machining', 'polishing', 'plating', 'assembly'].map((s) => entry(s as StageId, 110));
    const r = checkEntry(db, { ...base, shift: 'B', stage: 'packing', goodQty: 101 }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/above the order quantity of 100/);
  });

  it('blocks duplicate order + stage + shift + date entries', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 100)];
    const r = checkEntry(db, { date: '2026-10-20', shift: 'A', orderId: 'WO-1', stage: 'forging', goodQty: 5, rejectQty: 0, downtimeMin: 0, supervisor: 'S' }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.duplicateOf).toBe(db.entries[0].id);
  });

  it('blocks deleting an upstream entry that downstream stages depend on', () => {
    const db = emptyDb();
    const f = entry('forging', 300);
    db.entries = [f, entry('machining', 250)];
    expect(checkDelete(db, f.id).ok).toBe(false);
    expect(checkDelete(db, db.entries[1].id).ok).toBe(true);
  });

  it('reports units available to a stage', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 300), entry('machining', 120, { rejectQty: 5 })];
    expect(availableForStage(db, 'WO-1', 'machining', '2026-10-20')).toBe(175);
    expect(availableForStage(db, 'WO-1', 'polishing', '2026-10-20')).toBe(120);
  });

  it('validates field values', () => {
    const r = checkEntry(emptyDb(), { date: '2026-10-25', shift: 'A', orderId: 'WO-1', stage: 'forging', goodQty: -1, rejectQty: 0, downtimeMin: 30, supervisor: '' }, TODAY);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/future/), expect.stringMatching(/Good quantity/), expect.stringMatching(/downtime reason/), expect.stringMatching(/Supervisor/)]));
  });
});

describe('demo data', () => {
  const db = generateDemoData(TODAY);

  it('is deterministic for the same anchor', () => {
    const again = generateDemoData(TODAY);
    expect(again.entries.length).toBe(db.entries.length);
    expect(again.entries.slice(0, 50)).toEqual(db.entries.slice(0, 50));
  });

  it('satisfies the same integrity rules as manual entry', () => {
    for (const o of db.orders) expect(validateOrderFlow(o, db.entries, db.settings)).toEqual([]);
  });

  it('has production only on working days and is labelled as demo', () => {
    expect(db.entries.every((e) => isWorkingDay(e.date) && e.source === 'demo')).toBe(true);
    expect(db.meta.demoData).toBe(true);
    expect(db.orders.every((o) => o.customer.includes('demo'))).toBe(true);
  });

  it('tells the intended story on the anchor day: plating bottleneck with quality issue and a late export order', () => {
    const stages = stageDaySummary(db, TODAY);
    expect(findBottleneck(stages, db.settings)?.stage).toBe('plating');
    const ex = detectExceptions(db, TODAY);
    expect(ex.some((e) => e.type === 'quality' && e.stage === 'plating')).toBe(true);
    const progress = allOrderProgress(db, TODAY);
    expect(progress.some((p) => p.order.customer.startsWith('Export') && p.status === 'delayed')).toBe(true);
  });

  it('links plating quality exceptions to the past bath-contamination fix (operational memory)', () => {
    const ex = detectExceptions(db, TODAY).find((e) => e.type === 'quality' && e.stage === 'plating')!;
    expect(ex.similarIncidents[0].correctiveAction).toMatch(/Carbon treatment/);
  });
});

describe('daily brief', () => {
  it('is deterministic and cites only recorded figures', () => {
    const db = generateDemoData(TODAY);
    const a = generateBrief(db, TODAY);
    const b = generateBrief(db, TODAY);
    expect(a.markdown).toBe(b.markdown);
    const k = dayKpis(db, TODAY);
    expect(a.headline).toContain(k.finishedOutput.toLocaleString('en-IN'));
    expect(a.markdown).toMatch(/SYNTHETIC DEMO DATA/);
    expect(a.whatsapp).not.toMatch(/\*\*/);
  });

  it('handles a day with no data', () => {
    const b = generateBrief(emptyDb(), '2026-10-20');
    expect(b.status).toBe('critical');
    expect(b.headline).toMatch(/No production recorded/);
  });
});

describe('dates', () => {
  it('parses spreadsheet date formats', () => {
    expect(parseFlexibleDate('21-10-2026')).toBe('2026-10-21');
    expect(parseFlexibleDate('21/10/26')).toBe('2026-10-21');
    expect(parseFlexibleDate('2026-10-21')).toBe('2026-10-21');
    expect(parseFlexibleDate('21-Oct-2026')).toBe('2026-10-21');
    expect(parseFlexibleDate(46316)).toBe('2026-10-21'); // Excel serial
    expect(parseFlexibleDate(new Date(Date.UTC(2026, 9, 21)))).toBe('2026-10-21');
    expect(parseFlexibleDate('31-02-2026')).toBeNull();
    expect(parseFlexibleDate('yesterday')).toBeNull();
  });

  it('skips Sundays', () => {
    expect(isWorkingDay('2026-10-25')).toBe(false);
    expect(addWorkingDays('2026-10-24', 1)).toBe('2026-10-26');
    expect(lastWorkingDays('2026-10-26', 2)).toEqual(['2026-10-24', '2026-10-26']);
  });
});

describe('importer', () => {
  it('maps common plant header names', () => {
    const { columns, missingRequired } = mapHeaders(['Prod Date', 'Shift', 'WO No', 'Process', 'OK Qty', 'Rejection', 'Breakdown Min', 'Remarks'], 'production');
    expect(missingRequired).toEqual([]);
    expect(columns.map((c) => c.field)).toEqual(['date', 'shift', 'orderId', 'stage', 'goodQty', 'rejectQty', 'downtimeMin', 'notes']);
  });

  it('recognises stage and shift aliases', () => {
    expect(parseStage('CNC')).toBe('machining');
    expect(parseStage('Chrome Plating')).toBe('plating');
    expect(parseStage('Assembly & Testing')).toBe('assembly');
    expect(parseStage('Buffing')).toBe('polishing');
    expect(parseStage('Painting')).toBeNull();
    expect(parseShift('Shift B')).toBe('B');
    expect(parseShift('2')).toBe('B');
  });

  it('validates rows in process order so a single file can feed consecutive stages', () => {
    const db = emptyDb();
    const headers = ['Date', 'Shift', 'Work Order', 'Stage', 'Good Qty', 'Reject Qty'];
    const rows = [
      { Date: '20-10-2026', Shift: 'A', 'Work Order': 'wo-1', Stage: 'CNC', 'Good Qty': '180', 'Reject Qty': '5' }, // listed before forging
      { Date: '20-10-2026', Shift: 'A', 'Work Order': 'WO-1', Stage: 'Forging', 'Good Qty': '200', 'Reject Qty': '' },
      { Date: '20-10-2026', Shift: 'A', 'Work Order': 'WO-1', Stage: 'Buffing', 'Good Qty': '500', 'Reject Qty': '0' }, // exceeds machining
      { Date: '20-10-2026', Shift: 'A', 'Work Order': 'WO-9', Stage: 'Forging', 'Good Qty': '10', 'Reject Qty': '0' }, // unknown order
      { Date: 'bad', Shift: 'Z', 'Work Order': 'WO-1', Stage: 'Forging', 'Good Qty': 'x', 'Reject Qty': '0' },
      { Date: '20-10-2026', Shift: 'A', 'Work Order': 'WO-1', Stage: 'Forging', 'Good Qty': '1', 'Reject Qty': '0' }, // repeat in file
    ];
    const { preview } = previewProductionImport(db, rows, headers, 'skip', TODAY);
    expect(preview.rows.map((r) => r.status)).toEqual(['ok', 'ok', 'error', 'error', 'error', 'error']);
    expect(preview.rows[2].errors[0]).toMatch(/Machining has only delivered 180/);
    expect(preview.rows[3].errors[0]).toMatch(/does not exist/);
  });

  it('skips or replaces duplicates of existing entries', () => {
    const db = emptyDb();
    db.entries = [entry('forging', 100)];
    const headers = ['Date', 'Shift', 'Order', 'Stage', 'Good Qty'];
    const rows = [{ Date: '2026-10-20', Shift: 'A', Order: 'WO-1', Stage: 'forging', 'Good Qty': 150 }];
    expect(previewProductionImport(db, rows, headers, 'skip', TODAY).preview.rows[0].status).toBe('duplicate');
    expect(previewProductionImport(db, rows, headers, 'replace', TODAY).preview.rows[0].status).toBe('replace');
  });

  it('reports missing required columns', () => {
    const { preview } = previewProductionImport(emptyDb(), [{ Foo: 1 }], ['Foo', 'Shift'], 'skip', TODAY);
    expect(preview.missingRequired).toEqual(['date', 'orderId', 'stage', 'goodQty']);
  });
});
