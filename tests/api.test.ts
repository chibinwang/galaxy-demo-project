import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import { generateDemoData } from '../shared/seed';

const TODAY = '2026-10-24';
let app: ReturnType<typeof createApp>;
let store: Store;

beforeEach(() => {
  store = new Store(null, generateDemoData(TODAY));
  app = createApp({ store, today: () => TODAY });
});

/** An order with no production yet, for clean test scenarios. */
async function freshOrder(id = 'WO-T1', quantity = 500) {
  const r = await request(app).post('/api/orders').send({ id, productCode: 'GT-PC-101', customer: 'Test', quantity, releaseDate: '2026-10-20', dueDate: '2026-11-20', priority: 'Normal' });
  expect(r.status).toBe(201);
}

const entry = (over: Record<string, unknown> = {}) => ({ date: TODAY, shift: 'C', orderId: 'WO-T1', stage: 'forging', goodQty: 100, rejectQty: 2, downtimeMin: 0, supervisor: 'Test Supervisor', ...over });

describe('API', () => {
  it('serves meta and overview for the latest date', async () => {
    const meta = await request(app).get('/api/meta');
    expect(meta.body.latestDate).toBe(TODAY);
    expect(meta.body.demoData).toBe(true);
    const ov = await request(app).get('/api/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.date).toBe(TODAY);
    expect(ov.body.stages).toHaveLength(6);
    expect(ov.body.kpis.finishedOutput).toBe(ov.body.stages[5].goodQty);
    expect(ov.body.trend.length).toBe(14);
  });

  it('records production and updates finished output only at Packing', async () => {
    await freshOrder();
    const before = (await request(app).get(`/api/overview?date=${TODAY}`)).body.kpis.finishedOutput;
    for (const stage of ['forging', 'machining', 'polishing', 'plating', 'assembly']) {
      const r = await request(app).post('/api/entries').send(entry({ stage, goodQty: 100, rejectQty: 0 }));
      expect(r.status).toBe(201);
    }
    let after = (await request(app).get(`/api/overview?date=${TODAY}`)).body.kpis.finishedOutput;
    expect(after).toBe(before);
    expect((await request(app).post('/api/entries').send(entry({ stage: 'packing', goodQty: 90, rejectQty: 0 }))).status).toBe(201);
    after = (await request(app).get(`/api/overview?date=${TODAY}`)).body.kpis.finishedOutput;
    expect(after).toBe(before + 90);
  });

  it('rejects flow violations, duplicates and bad input with clear messages', async () => {
    await freshOrder();
    const over = await request(app).post('/api/entries').send(entry({ stage: 'machining', goodQty: 50 }));
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/Forging has only delivered 0/);

    expect((await request(app).post('/api/entries').send(entry())).status).toBe(201);
    const dup = await request(app).post('/api/entries').send(entry({ goodQty: 5 }));
    expect(dup.status).toBe(409);

    const bad = await request(app).post('/api/entries').send({ date: 'nope', shift: 'X' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.length).toBeGreaterThan(2);
  });

  it('edits and deletes entries with integrity checks', async () => {
    await freshOrder();
    const f = (await request(app).post('/api/entries').send(entry({ goodQty: 200, rejectQty: 0 }))).body;
    const m = (await request(app).post('/api/entries').send(entry({ stage: 'machining', goodQty: 150, rejectQty: 0 }))).body;
    expect((await request(app).put(`/api/entries/${f.id}`).send({ goodQty: 100 })).status).toBe(400);
    expect((await request(app).put(`/api/entries/${f.id}`).send({ goodQty: 160, notes: 'corrected' })).body.goodQty).toBe(160);
    expect((await request(app).delete(`/api/entries/${f.id}`)).status).toBe(400);
    expect((await request(app).delete(`/api/entries/${m.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/entries/${f.id}`)).status).toBe(204);
  });

  it('manages orders', async () => {
    await freshOrder('WO-T2', 300);
    expect((await request(app).post('/api/orders').send({ id: 'WO-T2', productCode: 'GT-PC-101', quantity: 1, dueDate: '2026-11-01' })).status).toBe(409);
    const newProduct = await request(app).post('/api/orders').send({ id: 'WO-T3', productCode: 'NEW-1', quantity: 10, dueDate: '2026-11-01' });
    expect(newProduct.status).toBe(400);
    expect(newProduct.body.error).toMatch(/product name/);
    expect((await request(app).post('/api/orders').send({ id: 'WO-T3', productCode: 'NEW-1', productName: 'New Mixer', quantity: 10, dueDate: '2026-11-01' })).status).toBe(201);
    const detail = await request(app).get('/api/orders/WO-T2');
    expect(detail.body.progress.status).toBe('not_started');
    expect((await request(app).delete('/api/orders/WO-T2')).status).toBe(204);
    const withEntries = store.db.orders.find((o) => store.db.entries.some((e) => e.orderId === o.id))!;
    expect((await request(app).delete(`/api/orders/${withEntries.id}`)).status).toBe(400);
  });

  it('turns an exception into an action and requires a resolution before closing it', async () => {
    const ex = (await request(app).get(`/api/exceptions?date=${TODAY}`)).body.items;
    const open = ex.find((e: { linkedIssueId?: string }) => !e.linkedIssueId);
    const created = await request(app).post('/api/issues').send({ title: open.title, type: open.type, severity: open.severity, stage: open.stage, detectedDate: TODAY, exceptionKey: open.key, owner: 'Shift in-charge' });
    expect(created.status).toBe(201);
    expect((await request(app).post('/api/issues').send({ title: 'again', type: open.type, exceptionKey: open.key })).status).toBe(409);
    const relinked = (await request(app).get(`/api/exceptions?date=${TODAY}`)).body.items.find((e: { key: string }) => e.key === open.key);
    expect(relinked.linkedIssueId).toBe(created.body.id);

    const noRes = await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'resolved' });
    expect(noRes.status).toBe(400);
    const ok = await request(app).put(`/api/issues/${created.body.id}`).send({ status: 'resolved', resolution: 'Fixed and verified' });
    expect(ok.body.status).toBe('resolved');
    expect(ok.body.resolvedDate).toBe(TODAY);
    const memory = (await request(app).get('/api/issues?status=resolved&q=verified')).body;
    expect(memory.map((i: { id: string }) => i.id)).toContain(created.body.id);
  });

  it('generates and saves the daily brief', async () => {
    const b = await request(app).get(`/api/brief?date=${TODAY}`);
    expect(b.body.priorities.length).toBeGreaterThan(0);
    const saved = await request(app).post('/api/briefs').send({ date: TODAY });
    expect(saved.status).toBe(201);
    expect((await request(app).get('/api/briefs')).body[0].id).toBe(saved.body.id);
  });

  it('returns history for a range', async () => {
    const h = await request(app).get('/api/history?from=2026-10-01&to=2026-10-24');
    expect(h.status).toBe(200);
    expect(h.body.summary.finished).toBe(h.body.stageTotals.find((s: { stage: string }) => s.stage === 'packing').good);
  });

  it('previews and commits a CSV production import', async () => {
    await freshOrder();
    const csv = ['Date,Shift,WO No,Process,OK Qty,Rejection,Downtime (min),Reason,Supervisor', `24-10-2026,C,WO-T1,CNC,90,2,0,,R. Kumar`, `24-10-2026,C,WO-T1,Forging,100,1,20,Power cut,R. Kumar`, `24-10-2026,C,WO-T1,Buffing,500,0,0,,R. Kumar`].join('\n');
    const prev = await request(app).post('/api/import/preview?kind=production').set('x-filename', 'shift.csv').set('Content-Type', 'application/octet-stream').send(Buffer.from(csv));
    expect(prev.status).toBe(200);
    expect(prev.body.summary).toMatchObject({ total: 3, ok: 2, errors: 1 });
    const commit = await request(app).post('/api/import/commit?kind=production').set('x-filename', 'shift.csv').set('Content-Type', 'application/octet-stream').send(Buffer.from(csv));
    expect(commit.body).toMatchObject({ added: 2, errors: 1 });
    expect(store.db.entries.filter((e) => e.orderId === 'WO-T1' && e.source === 'import')).toHaveLength(2);
    // Re-importing the same file skips the existing rows.
    const again = await request(app).post('/api/import/commit?kind=production').set('x-filename', 'shift.csv').set('Content-Type', 'application/octet-stream').send(Buffer.from(csv));
    expect(again.body).toMatchObject({ added: 0, skipped: 2 });
  });

  it('imports work orders from an Excel file', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Orders');
    ws.addRow(['Galaxy Taps — open orders']); // title row above the header
    ws.addRow(['Work Order', 'Product Code', 'Product Name', 'Customer', 'Qty', 'Due Date', 'Priority']);
    ws.addRow(['WO-X1', 'GT-AV-310', '', 'Dealer A', 1200, new Date(Date.UTC(2026, 10, 15)), 'High']);
    ws.addRow(['WO-X2', 'NEW-99', 'Brand New Mixer', 'Dealer B', 800, '20/11/2026', '']);
    ws.addRow(['WO-X3', 'NEW-98', '', 'Dealer C', 10, '20/11/2026', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await request(app).post('/api/import/commit?kind=orders').set('x-filename', 'orders.xlsx').set('Content-Type', 'application/octet-stream').send(buf);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: 2, errors: 1 });
    expect(store.db.orders.find((o) => o.id === 'WO-X1')).toMatchObject({ quantity: 1200, dueDate: '2026-11-15', priority: 'High' });
    expect(store.db.products.some((p) => p.code === 'NEW-99')).toBe(true);
  });

  it('serves import templates', async () => {
    const csv = await request(app).get('/api/import/template?kind=production&format=csv');
    expect(csv.text.split('\n')[0]).toMatch(/^Date,Shift,Work Order,Stage,Good Qty/);
    const xlsx = await request(app).get('/api/import/template?kind=orders&format=xlsx').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('updates settings with validation, and can clear and reset data', async () => {
    expect((await request(app).put('/api/settings').send({ shortfallPct: 500 })).status).toBe(400);
    const s = await request(app).put('/api/settings').send({ stages: [{ stage: 'plating', dailyTarget: 1400, rejectThresholdPct: 5 }] });
    expect(s.body.stages.find((x: { stage: string }) => x.stage === 'plating').dailyTarget).toBe(1400);

    await request(app).post('/api/admin/clear');
    const cleared = (await request(app).get('/api/meta')).body;
    expect(cleared.demoData).toBe(false);
    expect(cleared.counts).toMatchObject({ orders: 0, entries: 0, issues: 0 });
    const ov = await request(app).get('/api/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.exceptions[0].type).toBe('data_gap');

    await request(app).post('/api/admin/reset-demo');
    expect((await request(app).get('/api/meta')).body.demoData).toBe(true);
  });

  it('returns JSON 404 for unknown endpoints', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/not found/);
  });
});

describe('demo sample sheet', () => {
  it('imports cleanly except for the one deliberate error row', async () => {
    const sample = await request(app).get('/api/import/sample').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const prev = await request(app).post('/api/import/preview?kind=production').set('x-filename', 'sample.xlsx').set('Content-Type', 'application/octet-stream').send(sample.body as Buffer);
    expect(prev.status).toBe(200);
    expect(prev.body.summary.errors).toBe(1);
    expect(prev.body.summary.ok).toBeGreaterThan(5);
    expect(prev.body.rows.find((r: { status: string }) => r.status === 'error').errors.join(' ')).toMatch(/order quantity|only delivered/);
  });
});

describe('AI copilot', () => {
  it('ships with autonomy defaults and seeded action history', async () => {
    const r = await request(app).get('/api/ai');
    expect(r.body.autonomy).toMatchObject({ summary: 'auto', brief: 'auto', assign: 'ask', expedite: 'ask' });
    expect(r.body.actions.length).toBeGreaterThan(0);
    expect(r.body.actions.every((a: { simulated: boolean }) => a.simulated)).toBe(true);
  });

  it('updates autonomy, but read-only capabilities cannot require approval', async () => {
    expect((await request(app).put('/api/ai/autonomy').send({ intent: 'assign', level: 'auto' })).body.assign).toBe('auto');
    expect((await request(app).put('/api/ai/autonomy').send({ intent: 'summary', level: 'ask' })).status).toBe(400);
    expect((await request(app).put('/api/ai/autonomy').send({ intent: 'nope', level: 'auto' })).status).toBe(400);
  });

  it('logs actions and filters the log by mode', async () => {
    const created = await request(app)
      .post('/api/ai/actions')
      .send({ prompt: 'send the brief', intent: 'brief', title: 'Send daily brief', mode: 'autonomous', status: 'completed', steps: [{ tool: 'WhatsApp', label: 'Sent' }], result: 'Shared', link: '/brief' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: expect.stringMatching(/^AI-\d+$/), simulated: true, source: 'manual' });
    const log = (await request(app).get('/api/ai?mode=autonomous')).body.actions;
    expect(log[0].id).toBe(created.body.id);
    expect(log.every((a: { mode: string }) => a.mode === 'autonomous')).toBe(true);
    expect((await request(app).post('/api/ai/actions').send({ intent: 'brief', mode: 'whenever', status: 'completed', title: 'x', steps: [] })).status).toBe(400);
  });

  it('clearing data empties the log but keeps autonomy preferences', async () => {
    await request(app).put('/api/ai/autonomy').send({ intent: 'expedite', level: 'auto' });
    await request(app).post('/api/admin/clear');
    const r = await request(app).get('/api/ai');
    expect(r.body.actions).toEqual([]);
    expect(r.body.autonomy.expedite).toBe('auto');
  });
});
