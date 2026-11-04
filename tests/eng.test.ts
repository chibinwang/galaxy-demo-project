import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import { evaluate, overallResult, specLimits, type PlanItem } from '../shared/eng';
import { DEMO_APPROVER, DEMO_INSPECTOR, DEMO_MEASUREMENTS, demoExtractor } from '../shared/engSeed';
import { generateDemoData } from '../shared/seed';

const TODAY = '2026-10-24';
const ok = { planApproved: true, revisionApproved: true };
const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  characteristicId: 'X-C01',
  code: 'C01',
  type: 'Length',
  description: 'Length',
  kind: 'variable',
  nominal: 120,
  upperTol: 0.2,
  lowerTol: -0.2,
  unit: 'mm',
  method: 'Caliper',
  methodSuggested: 'Caliper',
  sampleSize: 5,
  ...over,
});

describe('tolerance evaluation', () => {
  it('computes the accepted interval exactly', () => {
    expect(specLimits(item())).toEqual({ lsl: 119.8, usl: 120.2 });
    expect(specLimits(item({ nominal: 10, upperTol: 5, lowerTol: -2 }))).toEqual({ lsl: 8, usl: 15 });
  });

  it('passes on both boundaries and fails just outside', () => {
    expect(evaluate(item(), 119.8, ok).result).toBe('pass');
    expect(evaluate(item(), 120.2, ok).result).toBe('pass');
    expect(evaluate(item(), 120.0, ok).result).toBe('pass');
    expect(evaluate(item(), 120.201, ok).result).toBe('fail');
    expect(evaluate(item(), 119.799, ok).result).toBe('fail');
  });

  it('fails 120.34 mm against 120.00 ±0.20 with a clear reason', () => {
    const r = evaluate(item(), 120.34, ok);
    expect(r.result).toBe('fail');
    expect(r.reason).toBe('120.34 mm exceeds USL 120.2 (+0.14).');
  });

  it('is immune to floating-point drift (0.1 + 0.2 style values)', () => {
    expect(evaluate(item({ nominal: 0.1, upperTol: 0.2, lowerTol: 0 }), 0.3, ok).result).toBe('pass');
    expect(evaluate(item({ nominal: 60, upperTol: 0.3, lowerTol: -0.3 }), 60.3, ok).result).toBe('pass');
  });

  it('returns Needs Review — never an invented pass — when the system cannot verify', () => {
    expect(evaluate(item({ upperTol: undefined }), 120, ok).result).toBe('review');
    expect(evaluate(item({ gdt: '⊥ 0.05 | A' }), 0.01, ok).result).toBe('review');
    expect(evaluate(item({ unit: '' }), 120, ok).result).toBe('review');
    expect(evaluate(item({ unit: 'inch-ish' }), 120, ok).result).toBe('review');
    expect(evaluate(item(), undefined, ok).result).toBe('review');
    expect(evaluate(item(), 120, { planApproved: true, revisionApproved: false }).result).toBe('review');
    expect(evaluate(item(), 120, { planApproved: false, revisionApproved: true }).result).toBe('review');
  });

  it('handles attribute (Go/No-Go) checks', () => {
    const a = item({ kind: 'attribute', spec: 'G 1/2 Go/No-Go', nominal: undefined, unit: '' });
    expect(evaluate(a, 'ok', ok).result).toBe('pass');
    expect(evaluate(a, 'nok', ok).result).toBe('fail');
    expect(evaluate(a, 3, ok).result).toBe('review');
  });

  it('summarises an inspection without upgrading unknowns to pass', () => {
    expect(overallResult([{ result: 'pass' }, { result: 'pass' }])).toBe('pass');
    expect(overallResult([{ result: 'pass' }, { result: 'review' }])).toBe('review');
    expect(overallResult([{ result: 'review' }, { result: 'fail' }])).toBe('fail');
    expect(overallResult([])).toBe('review');
  });

  it('only returns simulated extraction for seeded demo drawings', () => {
    const base = { id: 'X', drawingId: 'X', rev: 'A', fileName: 'x.pdf', format: 'pdf', mime: 'application/pdf', size: 1, source: 'manual' as const, uploadedAt: '', status: 'awaiting_review' as const, synthetic: false };
    expect(demoExtractor.extract(base).available).toBe(false);
    expect(demoExtractor.extract({ ...base, schematic: 'spout-B' }).characteristics?.find((c) => c.code === 'C01')?.nominal).toBe(120);
  });
});

describe('Engineering & QC API', () => {
  let app: ReturnType<typeof createApp>;
  let store: Store;
  beforeEach(() => {
    store = new Store(null, generateDemoData(TODAY));
    app = createApp({ store, today: () => TODAY });
  });

  it('seeds three sample drawings with real files', async () => {
    const s = (await request(app).get('/api/eng')).body;
    expect(s.drawings.map((d: { id: string }) => d.id)).toEqual(['DRW-0001', 'DRW-0002', 'DRW-0003']);
    const pdf = await request(app).get('/api/eng/files/FILE-0002').buffer(true).parse(binary);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).toString().match(/\/Type \/Page /g)?.length).toBe(2);
    expect(s.revisions.find((r: { id: string }) => r.id === 'DRW-0003-A').format).toBe('step');
  });

  it('uploads a file, persists bytes, and protects existing revisions', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const up = await request(app)
      .post('/api/eng/upload?partSku=OEM-T1&partName=Test%20part&customer=Test%20OEM&material=Brass&rev=A')
      .set('x-filename', 'test.png')
      .set('Content-Type', 'application/octet-stream')
      .send(png);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ rev: 'A', format: 'png', source: 'manual', status: 'awaiting_review' });
    const file = await request(app).get(`/api/eng/files/${up.body.fileId}`).buffer(true).parse(binary);
    expect(Buffer.compare(file.body as Buffer, png)).toBe(0);
    // same revision again is refused; next revision is accepted under the same drawing
    const dup = await request(app).post(`/api/eng/upload?drawingId=${up.body.drawingId}&rev=A`).set('x-filename', 'test.png').set('Content-Type', 'application/octet-stream').send(png);
    expect(dup.status).toBe(409);
    const b = await request(app).post(`/api/eng/upload?drawingId=${up.body.drawingId}`).set('x-filename', 'test.png').set('Content-Type', 'application/octet-stream').send(png);
    expect(b.body.rev).toBe('B');
    expect((await request(app).post('/api/eng/upload?partSku=X&partName=Y').set('x-filename', 'virus.exe').set('Content-Type', 'application/octet-stream').send(png)).status).toBe(400);
    // simulated AI never fabricates results for arbitrary uploads
    expect((await request(app).post(`/api/eng/revisions/${up.body.id}/extract`)).status).toBe(422);
  });

  it('runs the full scenario: portal → review → approval → plan → inspection → NCR → traceability', async () => {
    // 1. revised drawing arrives; Rev A stays approved, its plan is flagged
    const recv = await request(app).post('/api/eng/connectors/portal/receive');
    expect(recv.status).toBe(201);
    expect(recv.body).toMatchObject({ id: 'DRW-0001-B', source: 'portal', status: 'awaiting_review' });
    let s = (await request(app).get('/api/eng')).body;
    expect(s.revisions.find((r: { id: string }) => r.id === 'DRW-0001-A').status).toBe('approved');
    expect(s.plans.find((p: { id: string }) => p.id === 'QCP-0001').reapprovalPending).toBe('DRW-0001-B');
    expect((await request(app).post('/api/eng/connectors/portal/receive')).status).toBe(409);

    // 2. simulated extraction; approval blocked until every value is human-confirmed
    const chars = (await request(app).post('/api/eng/revisions/DRW-0001-B/extract')).body;
    expect(chars).toHaveLength(8);
    expect((await request(app).post('/api/eng/revisions/DRW-0001-B/approve').send({ approver: DEMO_APPROVER })).status).toBe(400);
    // reviewer fixes the ambiguous roughness value (edit resets to "to review"), then confirms all
    const c08 = await request(app).put('/api/eng/characteristics/DRW-0001-B-C08').send({ nominal: 0, upperTol: 0.4, lowerTol: 0, reviewerNote: 'Ra 0.4 is a maximum per customer notes.' });
    expect(c08.body).toMatchObject({ status: 'extracted', editedAfterExtraction: true });
    expect((await request(app).put('/api/eng/characteristics/DRW-0001-B-C07').send({ status: 'flagged' })).status).toBe(400); // needs reviewer
    for (const c of chars) expect((await request(app).put(`/api/eng/characteristics/${c.id}`).send({ status: 'confirmed', reviewer: DEMO_APPROVER })).status).toBe(200);
    expect((await request(app).post('/api/eng/revisions/DRW-0001-B/approve').send({})).status).toBe(400); // approver required
    const appr = await request(app).post('/api/eng/revisions/DRW-0001-B/approve').send({ approver: DEMO_APPROVER });
    expect(appr.body.status).toBe('approved');
    s = (await request(app).get('/api/eng')).body;
    expect(s.revisions.find((r: { id: string }) => r.id === 'DRW-0001-A')).toMatchObject({ status: 'superseded', supersededBy: 'DRW-0001-B' });
    expect(s.plans.find((p: { id: string }) => p.id === 'QCP-0001').status).toBe('superseded');
    // approved requirements are locked
    expect((await request(app).put('/api/eng/characteristics/DRW-0001-B-C01').send({ nominal: 121 })).status).toBe(409);

    // 3. draft plan → four-eyes approval
    const plan = (await request(app).post('/api/eng/revisions/DRW-0001-B/plans').send({ createdBy: DEMO_APPROVER })).body;
    expect(plan).toMatchObject({ status: 'draft', revisionId: 'DRW-0001-B', rev: 'B' });
    expect(plan.items.find((i: { code: string }) => i.code === 'C01')).toMatchObject({ nominal: 120, sampleSize: 5 });
    expect((await request(app).post('/api/eng/inspections').send({ planId: plan.id, batch: 'B1', inspector: 'X' })).status).toBe(400); // not approved yet
    expect((await request(app).post(`/api/eng/plans/${plan.id}/approve`).send({ approver: DEMO_APPROVER })).status).toBe(400); // same person
    expect((await request(app).post(`/api/eng/plans/${plan.id}/approve`).send({ approver: 'Arjun Mehta (QA Manager, demo)' })).body.status).toBe('approved');
    expect((await request(app).post('/api/eng/inspections').send({ planId: 'QCP-0001', batch: 'B1', inspector: 'X' })).status).toBe(400); // superseded plan

    // 4. inspection with one C01 sample above USL
    const ins = (await request(app).post('/api/eng/inspections').send({ planId: plan.id, batch: 'SP220-B2610-01', workOrderId: 'WO-1013', inspector: DEMO_INSPECTOR })).body;
    const values: Record<string, number | string> = {};
    for (const [code, vs] of Object.entries(DEMO_MEASUREMENTS)) vs.forEach((v, i) => (values[`${code}:${i + 1}`] = v));
    const saved = (await request(app).put(`/api/eng/inspections/${ins.id}`).send({ values, comments: 'Demo run' })).body;
    const c01 = saved.measurements.filter((m: { code: string }) => m.code === 'C01');
    expect(c01.map((m: { result: string }) => m.result)).toEqual(['pass', 'pass', 'fail', 'pass', 'pass']);
    expect(saved.measurements.find((m: { code: string }) => m.code === 'C07').result).toBe('review'); // GD&T
    expect(saved.overall).toBe('fail');

    // 5. completion raises a linked nonconformance in Exceptions & Actions
    const done = (await request(app).post(`/api/eng/inspections/${ins.id}/complete`)).body;
    expect(done.status).toBe('completed');
    expect(done.issueIds).toHaveLength(1);
    const issues = (await request(app).get('/api/issues?status=active')).body;
    const ncr = issues.find((i: { id: string }) => i.id === done.issueIds[0]);
    expect(ncr).toMatchObject({ type: 'quality', inspectionId: ins.id, orderId: 'WO-1013', stage: 'machining' });
    expect(ncr.description).toContain('DRW-0001 rev B');
    expect(ncr.description).toContain('120.34 mm exceeds USL 120.2');
    expect(ncr.description).toContain('no automatic rejection');
    expect((await request(app).put(`/api/eng/inspections/${ins.id}`).send({ values: {} })).status).toBe(409); // locked

    // 6. traceability: history stays linked to the revision used at the time
    s = (await request(app).get('/api/eng')).body;
    const hist = s.inspections.find((i: { id: string }) => i.id === 'INS-0001');
    expect(hist).toMatchObject({ revisionId: 'DRW-0001-A', planId: 'QCP-0001', overall: 'review' });
    expect(s.inspections.find((i: { id: string }) => i.id === ins.id)).toMatchObject({ revisionId: 'DRW-0001-B', planId: plan.id, batch: 'SP220-B2610-01' });
  });

  it('resets the engineering scenario independently of production data', async () => {
    await request(app).post('/api/eng/connectors/portal/receive');
    const entries = store.db.entries.length;
    await request(app).post('/api/eng/reset');
    const s = (await request(app).get('/api/eng')).body;
    expect(s.revisions.some((r: { id: string }) => r.id === 'DRW-0001-B')).toBe(false);
    expect(store.db.entries.length).toBe(entries);
  });

  it('folder connector delivers successive revisions of the same drawing', async () => {
    const a = (await request(app).post('/api/eng/connectors/folder/receive')).body;
    const b = (await request(app).post('/api/eng/connectors/folder/receive')).body;
    expect(a.drawingId).toBe(b.drawingId);
    expect([a.rev, b.rev]).toEqual(['A', 'B']);
    expect((await request(app).post('/api/eng/connectors/pdm/receive')).status).toBe(400);
  });
});

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}
