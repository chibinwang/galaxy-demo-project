import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import { generateDemoData } from '../shared/seed';
import type { DetectedException } from '../shared/types';
import { crateCount } from '../src/factory/FactoryFlow';
import { gaps, lanes, ROUTE } from '../src/factory/layout';
import { buildFactoryModel, classifyStage, type OverviewSnapshot } from '../src/factory/model';

const TODAY = '2026-10-24';

function setup() {
  const store = new Store(null, generateDemoData(TODAY));
  return { store, app: createApp({ store, today: () => TODAY }) };
}

async function overview(app: ReturnType<typeof createApp>, date?: string): Promise<OverviewSnapshot> {
  return (await request(app).get(`/api/overview${date ? `?date=${date}` : ''}`)).body;
}

describe('factory visualization adapter', () => {
  it('passes the Analytics figures through unchanged (same endpoint, same numbers)', async () => {
    const { app } = setup();
    const snap = await overview(app);
    const m = buildFactoryModel(snap, 85);
    expect(m.stageZones).toHaveLength(6);
    m.stageZones.forEach((z, i) => expect(z.day).toEqual(snap.stages[i]));
    expect(m.finishedOutput).toBe(snap.kpis.finishedOutput);
    expect(m.attainmentPct).toBe(snap.kpis.attainmentPct);
    // every exception attributed to a stage appears in exactly that zone
    for (const e of snap.exceptions.filter((x) => x.stage)) expect(m.stageZones.find((z) => z.id === e.stage)!.exceptions).toContainEqual(e);
  });

  it('derives the bottleneck from data, not from a stage name', async () => {
    const { app, store } = setup();
    const snap = await overview(app);
    const m = buildFactoryModel(snap, 85);
    expect(m.stageZones.filter((z) => z.isBottleneck).map((z) => z.id)).toEqual([snap.bottleneck!.stage]);
    expect(m.attention[0].isBottleneck).toBe(true);

    // Synthetic snapshot where a different stage holds the backlog
    const moved: OverviewSnapshot = { ...snap, bottleneck: { stage: 'machining', queue: 5000, daysOfWork: 2.9 } };
    expect(buildFactoryModel(moved, 85).stageZones.find((z) => z.isBottleneck)!.id).toBe('machining');

    // An early date in the history with balanced flow has no bottleneck at all
    const dates = [...new Set(store.db.entries.map((e) => e.date))].sort();
    let found = false;
    for (const d of dates.slice(5, 25)) {
      const s = await overview(app, d);
      if (!s.bottleneck) {
        expect(buildFactoryModel(s, 85).stageZones.some((z) => z.isBottleneck)).toBe(false);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('maps WIP queues onto the conveyor segments feeding each stage', async () => {
    const { app } = setup();
    const snap = await overview(app);
    const m = buildFactoryModel(snap, 85);
    expect(m.segments).toHaveLength(ROUTE.length - 1);
    for (const st of snap.stages.slice(1)) {
      const seg = m.segments.find((s) => s.to === st.stage)!;
      expect(seg.queue).toBe(st.queueBefore);
    }
    const into = m.segments.find((s) => s.intoBottleneck)!;
    expect(into.to).toBe(snap.bottleneck!.stage);
    expect(crateCount(into)).toBeGreaterThan(crateCount(m.segments.find((s) => s.to === 'forging')!));
  });

  it('labels missing data instead of inventing it', async () => {
    const { app } = setup();
    await request(app).post('/api/admin/clear');
    const snap = await overview(app, TODAY);
    const m = buildFactoryModel(snap, 85);
    expect(m.hasData).toBe(false);
    expect(m.stageZones.every((z) => z.condition === 'no_data' && z.statusLabel === 'No report')).toBe(true);
    expect(m.segments.every((s) => s.intensity === 0 && s.queue === 0)).toBe(true);
    expect(m.zones.filter((z) => z.kind === 'illustrative').map((z) => z.id)).toEqual(['raw', 'finished', 'dispatch']);
  });

  it('classifies stage condition from its own exceptions and attainment', () => {
    const day = { stage: 'plating', name: 'Plating', goodQty: 1500, rejectQty: 10, processedQty: 1510, downtimeMin: 0, target: 1600, attainmentPct: 93.8, rejectRatePct: 0.7, rejectThresholdPct: 4, entryCount: 4, queueBefore: 0 } as const;
    expect(classifyStage(day, [], 85).condition).toBe('normal');
    expect(classifyStage({ ...day, attainmentPct: 70 }, [], 85).condition).toBe('warning');
    const crit: DetectedException = { key: 'k', date: TODAY, type: 'downtime', severity: 'critical', stage: 'plating', title: '', detail: '', suggestedAction: '', similarIncidents: [] };
    expect(classifyStage(day, [crit], 85).condition).toBe('critical');
    // order risk at a stage does not make the stage itself critical
    expect(classifyStage(day, [{ ...crit, type: 'order_risk' }], 85).condition).toBe('normal');
    expect(classifyStage({ ...day, entryCount: 0 }, [], 85).condition).toBe('no_data');
  });

  it('has a continuous conveyor route through every zone', () => {
    expect(gaps()).toHaveLength(ROUTE.length - 1);
    for (const id of ROUTE) expect(lanes(id).length).toBe(id === 'raw' || id === 'dispatch' ? 1 : 2);
  });
});
