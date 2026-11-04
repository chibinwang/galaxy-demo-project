import ExcelJS from 'exceljs';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AI_INTENTS, capability, type AiAction, type AiIntent, type AiStep } from '../shared/ai';
import { generateBrief } from '../shared/brief';
import { allOrderProgress, dailySeries, dayKpis, findBottleneck, latestEntryDate, stageDaySummary } from '../shared/calc';
import { DOWNTIME_REASONS, ISSUE_TYPE_LABEL, SHIFTS, STAGES, STAGE_IDS, stageIndex } from '../shared/constants';
import { addDays, isIsoDate, lastWorkingDays, localToday } from '../shared/dates';
import { detectExceptions, similarIncidents } from '../shared/exceptions';
import {
  ORDER_TEMPLATE_HEADERS,
  PRODUCTION_TEMPLATE_HEADERS,
  previewOrderImport,
  previewProductionImport,
  type DuplicateMode,
} from '../shared/importer';
import { availableForStage, checkDelete, checkEntry, type EntryInput } from '../shared/integrity';
import type { DB, Issue, IssueStatus, IssueType, Order, Priority, ProductionEntry, Settings, Severity } from '../shared/types';
import { nextId, Store } from './db';
import { registerEngRoutes } from './eng';
import { bad, h, HttpError, notFound, q } from './http';
import { buildXlsx, parseUpload, toCsv } from './parse';

export interface AppOptions {
  store: Store;
  /** Injected for tests; defaults to the server's local date. */
  today?: () => string;
  staticDir?: string;
}

export function createApp({ store, today = () => localToday(), staticDir }: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const nowIso = () => new Date().toISOString();
  /** Default reporting date: latest date with data, not after today. */
  const reportDate = (req: Request) => {
    const d = q(req, 'date');
    if (d) {
      if (!isIsoDate(d)) throw bad('Invalid date');
      return d;
    }
    return latestEntryDate(store.db, today()) ?? today();
  };

  // ---------------- meta ----------------
  app.get(
    '/api/meta',
    h((_req, res) => {
      const db = store.db;
      res.json({
        today: today(),
        latestDate: latestEntryDate(db, today()),
        demoData: db.meta.demoData,
        settings: db.settings,
        stages: STAGES,
        shifts: SHIFTS,
        products: db.products,
        downtimeReasons: DOWNTIME_REASONS,
        issueTypes: ISSUE_TYPE_LABEL,
        supervisors: [...new Set(db.entries.map((e) => e.supervisor))].sort(),
        counts: { orders: db.orders.length, entries: db.entries.length, issues: db.issues.length, briefs: db.briefs.length, aiActions: db.ai.actions.length },
      });
    }),
  );

  // ---------------- overview ----------------
  app.get(
    '/api/overview',
    h((req, res) => {
      const db = store.db;
      const date = reportDate(req);
      const stages = stageDaySummary(db, date);
      const kpis = dayKpis(db, date, stages);
      const window = lastWorkingDays(date, 14);
      const prev = lastWorkingDays(date, 2)[0];
      const exceptions = detectExceptions(db, date);
      const orders = allOrderProgress(db, date);
      res.json({
        date,
        kpis,
        previous: prev !== date ? dayKpis(db, prev) : null,
        stages,
        bottleneck: findBottleneck(stages, db.settings),
        trend: dailySeries(db, window[0], date),
        exceptions,
        orderCounts: countBy(orders.map((o) => o.status)),
        attentionOrders: orders.filter((o) => o.status === 'delayed' || o.status === 'at_risk').slice(0, 6),
        openIssues: db.issues.filter((i) => i.status !== 'resolved').length,
        overdueIssues: db.issues.filter((i) => i.status !== 'resolved' && i.dueDate && i.dueDate < today()).length,
      });
    }),
  );

  // ---------------- production entries ----------------
  app.get(
    '/api/entries',
    h((req, res) => {
      let list = store.db.entries;
      const from = q(req, 'from');
      const to = q(req, 'to');
      const orderId = q(req, 'orderId');
      const stage = q(req, 'stage');
      const shift = q(req, 'shift');
      const source = q(req, 'source');
      const search = q(req, 'q')?.toLowerCase();
      if (from) list = list.filter((e) => e.date >= from);
      if (to) list = list.filter((e) => e.date <= to);
      if (orderId) list = list.filter((e) => e.orderId === orderId);
      if (stage) list = list.filter((e) => e.stage === stage);
      if (shift) list = list.filter((e) => e.shift === shift);
      if (source) list = list.filter((e) => e.source === source);
      if (search)
        list = list.filter((e) =>
          [e.id, e.orderId, e.supervisor, e.notes, e.downtimeReason].some((v) => v?.toLowerCase().includes(search)),
        );
      const sorted = [...list].sort(
        (a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || stageIndex(a.stage) - stageIndex(b.stage) || a.shift.localeCompare(b.shift),
      );
      const limit = Math.min(Number(q(req, 'limit') ?? 200), 5000);
      const offset = Number(q(req, 'offset') ?? 0);
      res.json({ total: sorted.length, items: sorted.slice(offset, offset + limit) });
    }),
  );

  const entryInput = (body: Record<string, unknown>): Partial<EntryInput> => ({
    date: body.date as string,
    shift: body.shift as EntryInput['shift'],
    orderId: typeof body.orderId === 'string' ? body.orderId.trim().toUpperCase() : undefined,
    stage: body.stage as EntryInput['stage'],
    goodQty: num(body.goodQty),
    rejectQty: num(body.rejectQty ?? 0),
    downtimeMin: num(body.downtimeMin ?? 0),
    downtimeReason: (body.downtimeReason as string) || undefined,
    supervisor: typeof body.supervisor === 'string' ? body.supervisor.trim() : undefined,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined,
  });

  app.get(
    '/api/entries/available',
    h((req, res) => {
      const orderId = q(req, 'orderId');
      const stage = q(req, 'stage') as ProductionEntry['stage'] | undefined;
      const date = q(req, 'date');
      if (!orderId || !stage || !STAGE_IDS.includes(stage) || !isIsoDate(date)) throw bad('orderId, stage and date are required');
      res.json({ available: availableForStage(store.db, orderId, stage, date, q(req, 'ignoreId')) });
    }),
  );

  app.post(
    '/api/entries',
    h((req, res) => {
      const input = entryInput(req.body ?? {});
      const created = store.update((db) => {
        const chk = checkEntry(db, input, today());
        if (!chk.ok) throw new HttpError(chk.duplicateOf ? 409 : 400, chk.errors[0], chk.errors);
        const now = nowIso();
        const entry: ProductionEntry = { ...(input as EntryInput), id: nextId('PE', db.entries.map((e) => e.id), 5), source: 'manual', createdAt: now, updatedAt: now };
        db.entries.push(entry);
        return entry;
      });
      res.status(201).json(created);
    }),
  );

  app.put(
    '/api/entries/:id',
    h((req, res) => {
      const id = String(req.params.id);
      const updated = store.update((db) => {
        const existing = db.entries.find((e) => e.id === id);
        if (!existing) throw notFound('Entry');
        const input = entryInput({ ...pickEntry(existing), ...req.body });
        const chk = checkEntry(db, input, today(), existing.id);
        if (!chk.ok) throw new HttpError(chk.duplicateOf ? 409 : 400, chk.errors[0], chk.errors);
        Object.assign(existing, input, { updatedAt: nowIso() });
        return existing;
      });
      res.json(updated);
    }),
  );

  app.delete(
    '/api/entries/:id',
    h((req, res) => {
      const id = String(req.params.id);
      store.update((db) => {
        const chk = checkDelete(db, id);
        if (!chk.ok) throw new HttpError(chk.errors[0] === 'Entry not found.' ? 404 : 400, chk.errors[0], chk.errors);
        db.entries = db.entries.filter((e) => e.id !== id);
      });
      res.status(204).end();
    }),
  );

  // ---------------- orders ----------------
  app.get(
    '/api/orders',
    h((req, res) => {
      const date = q(req, 'date') ?? today();
      if (!isIsoDate(date)) throw bad('Invalid date');
      const progress = allOrderProgress(store.db, date);
      // Orders released after the date are listed as not started.
      const future = store.db.orders.filter((o) => o.releaseDate > date);
      res.json({ date, items: progress, upcoming: future });
    }),
  );

  app.get(
    '/api/orders/:id',
    h((req, res) => {
      const id = String(req.params.id);
      const db = store.db;
      const order = db.orders.find((o) => o.id === id);
      if (!order) throw notFound('Order');
      const date = q(req, 'date') ?? today();
      const progress = allOrderProgress(db, date >= order.releaseDate ? date : order.releaseDate).find((p) => p.order.id === id)!;
      const entries = db.entries.filter((e) => e.orderId === id).sort((a, b) => b.date.localeCompare(a.date) || stageIndex(b.stage) - stageIndex(a.stage));
      const daily = new Map<string, Record<string, number>>();
      for (const e of entries) {
        const d: Record<string, number> = daily.get(e.date) ?? {};
        d[e.stage] = (d[e.stage] ?? 0) + e.goodQty;
        daily.set(e.date, d);
      }
      res.json({
        progress,
        entries,
        daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ ...v, date })),
        issues: db.issues.filter((i) => i.orderId === id),
      });
    }),
  );

  const orderInput = (body: Record<string, unknown>, db: DB, existing?: Order) => {
    const errors: string[] = [];
    const id = String(body.id ?? existing?.id ?? '').trim().toUpperCase();
    const productCode = String(body.productCode ?? existing?.productCode ?? '').trim().toUpperCase();
    const quantity = num(body.quantity ?? existing?.quantity);
    const releaseDate = String(body.releaseDate ?? existing?.releaseDate ?? today());
    const dueDate = String(body.dueDate ?? existing?.dueDate ?? '');
    const priority = (body.priority ?? existing?.priority ?? 'Normal') as Priority;
    if (!/^[A-Z0-9][A-Z0-9\-/_.]{1,30}$/.test(id)) errors.push('Order number must be 2–31 letters, digits or - / _ .');
    if (!productCode) errors.push('Product is required.');
    if (!Number.isInteger(quantity) || quantity <= 0) errors.push('Quantity must be a whole number above 0.');
    if (!isIsoDate(releaseDate)) errors.push('Release date is invalid.');
    if (!isIsoDate(dueDate)) errors.push('Due date is invalid.');
    else if (isIsoDate(releaseDate) && dueDate < releaseDate) errors.push('Due date is before release date.');
    if (!['High', 'Normal', 'Low'].includes(priority)) errors.push('Priority must be High, Normal or Low.');
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';
    if (productCode && !db.products.some((p) => p.code === productCode) && !productName) errors.push(`Unknown product ${productCode}; enter a product name to add it.`);
    if (existing) {
      const packed = db.entries.filter((e) => e.orderId === existing.id && e.stage === 'packing').reduce((a, e) => a + e.goodQty, 0);
      if (quantity < packed) errors.push(`Quantity cannot be below the ${packed} units already packed.`);
    }
    if (errors.length) throw bad(errors[0], errors);
    return {
      order: {
        id,
        productCode,
        customer: String(body.customer ?? existing?.customer ?? '').trim() || '—',
        quantity,
        releaseDate,
        dueDate,
        priority,
        notes: typeof body.notes === 'string' ? body.notes.trim() || undefined : existing?.notes,
      },
      productName,
    };
  };

  const ensureProduct = (db: DB, code: string, name: string, source: 'manual' | 'import') => {
    if (!db.products.some((p) => p.code === code)) db.products.push({ code, name: name || code, category: '—', source });
  };

  app.post(
    '/api/orders',
    h((req, res) => {
      const created = store.update((db) => {
        const { order, productName } = orderInput(req.body ?? {}, db);
        if (db.orders.some((o) => o.id === order.id)) throw new HttpError(409, `Order ${order.id} already exists.`);
        ensureProduct(db, order.productCode, productName, 'manual');
        const o: Order = { ...order, source: 'manual', createdAt: nowIso() };
        db.orders.push(o);
        return o;
      });
      res.status(201).json(created);
    }),
  );

  app.put(
    '/api/orders/:id',
    h((req, res) => {
      const id = String(req.params.id);
      const updated = store.update((db) => {
        const existing = db.orders.find((o) => o.id === id);
        if (!existing) throw notFound('Order');
        const { order, productName } = orderInput({ ...req.body, id: existing.id }, db, existing);
        // Shrinking an order must not leave the first stage above its allowance.
        const firstGood = db.entries.filter((e) => e.orderId === id && e.stage === STAGE_IDS[0]).reduce((a, e) => a + e.goodQty, 0);
        if (firstGood > Math.ceil(order.quantity * (1 + db.settings.firstStageAllowancePct / 100)))
          throw bad(`${firstGood} units have already been forged; quantity cannot be reduced below ${Math.ceil(firstGood / (1 + db.settings.firstStageAllowancePct / 100))}.`);
        ensureProduct(db, order.productCode, productName, 'manual');
        Object.assign(existing, order);
        return existing;
      });
      res.json(updated);
    }),
  );

  app.delete(
    '/api/orders/:id',
    h((req, res) => {
      const id = String(req.params.id);
      store.update((db) => {
        if (!db.orders.some((o) => o.id === id)) throw notFound('Order');
        if (db.entries.some((e) => e.orderId === id)) throw bad('This order has production entries. Delete those entries first.');
        db.orders = db.orders.filter((o) => o.id !== id);
      });
      res.status(204).end();
    }),
  );

  // ---------------- exceptions & issues ----------------
  app.get(
    '/api/exceptions',
    h((req, res) => {
      const date = reportDate(req);
      res.json({ date, items: detectExceptions(store.db, date) });
    }),
  );

  app.get(
    '/api/issues',
    h((req, res) => {
      let list = store.db.issues;
      const status = q(req, 'status');
      const search = q(req, 'q')?.toLowerCase();
      if (status === 'active') list = list.filter((i) => i.status !== 'resolved');
      else if (status) list = list.filter((i) => i.status === status);
      if (search)
        list = list.filter((i) =>
          [i.id, i.title, i.description, i.rootCause, i.correctiveAction, i.resolution, i.owner, i.orderId, i.stage].some((v) => v?.toLowerCase().includes(search)),
        );
      res.json([...list].sort((a, b) => b.detectedDate.localeCompare(a.detectedDate) || b.id.localeCompare(a.id)));
    }),
  );

  app.get(
    '/api/issues/:id/similar',
    h((req, res) => {
      const issue = store.db.issues.find((i) => i.id === req.params.id);
      if (!issue) throw notFound('Issue');
      res.json(similarIncidents(store.db.issues.filter((i) => i.id !== issue.id), issue.type, issue.stage, undefined, 5));
    }),
  );

  const ISSUE_TYPES = Object.keys(ISSUE_TYPE_LABEL) as IssueType[];
  const issueInput = (body: Record<string, unknown>, existing?: Issue): Omit<Issue, 'id' | 'source' | 'createdAt' | 'updatedAt'> => {
    const v = { ...existing, ...body } as Record<string, unknown>;
    const opt = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : undefined);
    const errors: string[] = [];
    const title = opt('title');
    const type = v.type as IssueType;
    const severity = (v.severity ?? 'medium') as Severity;
    const status = (v.status ?? 'open') as IssueStatus;
    const detectedDate = (v.detectedDate as string) ?? today();
    if (!title) errors.push('Title is required.');
    if (!ISSUE_TYPES.includes(type)) errors.push('Type is invalid.');
    if (!['critical', 'high', 'medium', 'low'].includes(severity)) errors.push('Severity is invalid.');
    if (!['open', 'in_progress', 'resolved'].includes(status)) errors.push('Status is invalid.');
    if (!isIsoDate(detectedDate)) errors.push('Detected date is invalid.');
    if (v.stage && !STAGE_IDS.includes(v.stage as never)) errors.push('Stage is invalid.');
    if (opt('dueDate') && !isIsoDate(opt('dueDate'))) errors.push('Due date is invalid.');
    if (status === 'resolved' && !opt('resolution')) errors.push('Record what fixed the problem before resolving — this becomes the plant’s operational memory.');
    if (errors.length) throw bad(errors[0], errors);
    return {
      title: title!,
      type,
      severity,
      stage: (v.stage as Issue['stage']) || undefined,
      orderId: opt('orderId')?.toUpperCase(),
      detectedDate,
      description: opt('description') ?? '',
      rootCause: opt('rootCause'),
      correctiveAction: opt('correctiveAction'),
      owner: opt('owner'),
      dueDate: opt('dueDate'),
      status,
      resolution: opt('resolution'),
      resolvedDate: status === 'resolved' ? (opt('resolvedDate') ?? existing?.resolvedDate ?? today()) : undefined,
      exceptionKey: opt('exceptionKey'),
    };
  };

  app.post(
    '/api/issues',
    h((req, res) => {
      const created = store.update((db) => {
        const input = issueInput(req.body ?? {});
        if (input.exceptionKey) {
          const linked = db.issues.find((i) => i.exceptionKey === input.exceptionKey);
          if (linked) throw new HttpError(409, `An action already exists for this exception (${linked.id}).`);
        }
        const now = nowIso();
        const issue: Issue = { ...input, id: nextId('ISS', db.issues.map((i) => i.id)), source: 'manual', createdAt: now, updatedAt: now };
        db.issues.push(issue);
        return issue;
      });
      res.status(201).json(created);
    }),
  );

  app.put(
    '/api/issues/:id',
    h((req, res) => {
      const updated = store.update((db) => {
        const existing = db.issues.find((i) => i.id === req.params.id);
        if (!existing) throw notFound('Issue');
        Object.assign(existing, issueInput(req.body ?? {}, existing), { updatedAt: nowIso() });
        return existing;
      });
      res.json(updated);
    }),
  );

  app.delete(
    '/api/issues/:id',
    h((req, res) => {
      store.update((db) => {
        if (!db.issues.some((i) => i.id === req.params.id)) throw notFound('Issue');
        db.issues = db.issues.filter((i) => i.id !== req.params.id);
      });
      res.status(204).end();
    }),
  );

  // ---------------- daily brief ----------------
  app.get(
    '/api/brief',
    h((req, res) => {
      res.json(generateBrief(store.db, reportDate(req)));
    }),
  );

  app.get(
    '/api/briefs',
    h((_req, res) => {
      res.json([...store.db.briefs].sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt)).map(({ markdown: _m, whatsapp: _w, ...rest }) => rest));
    }),
  );

  app.get(
    '/api/briefs/:id',
    h((req, res) => {
      const b = store.db.briefs.find((x) => x.id === req.params.id);
      if (!b) throw notFound('Brief');
      res.json(b);
    }),
  );

  app.post(
    '/api/briefs',
    h((req, res) => {
      const date = req.body?.date;
      if (!isIsoDate(date)) throw bad('Invalid date');
      const saved = store.update((db) => {
        const b = generateBrief(db, date);
        const rec = { id: nextId('BR', db.briefs.map((x) => x.id)), date, headline: b.headline, markdown: b.markdown, whatsapp: b.whatsapp, generatedAt: nowIso(), source: 'manual' as const };
        db.briefs.push(rec);
        return rec;
      });
      res.status(201).json(saved);
    }),
  );

  // ---------------- history ----------------
  app.get(
    '/api/history',
    h((req, res) => {
      const db = store.db;
      const to = q(req, 'to') ?? latestEntryDate(db, today()) ?? today();
      const from = q(req, 'from') ?? addDays(to, -29);
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw bad('Invalid date range');
      const series = dailySeries(db, from, to);
      const stageTotals = STAGES.map((s) => {
        let good = 0;
        let reject = 0;
        let downtime = 0;
        for (const e of db.entries)
          if (e.stage === s.id && e.date >= from && e.date <= to) {
            good += e.goodQty;
            reject += e.rejectQty;
            downtime += e.downtimeMin;
          }
        const target = series.reduce((a, p) => a + (p.target > 0 ? db.settings.stages.find((x) => x.stage === s.id)!.dailyTarget : 0), 0);
        return { stage: s.id, name: s.name, good, reject, downtime, target, attainmentPct: target ? Math.round((good / target) * 1000) / 10 : 0, rejectRatePct: good + reject ? Math.round((reject / (good + reject)) * 1000) / 10 : 0 };
      });
      const finished = series.reduce((a, p) => a + p.finished, 0);
      const target = series.reduce((a, p) => a + p.target, 0);
      const downtimeReasons: Record<string, number> = {};
      for (const e of db.entries) if (e.date >= from && e.date <= to && e.downtimeMin > 0) downtimeReasons[e.downtimeReason ?? 'Unspecified'] = (downtimeReasons[e.downtimeReason ?? 'Unspecified'] ?? 0) + e.downtimeMin;
      res.json({
        from,
        to,
        series,
        stageTotals,
        summary: {
          finished,
          target,
          attainmentPct: target ? Math.round((finished / target) * 1000) / 10 : 0,
          workingDays: series.filter((p) => p.target > 0).length,
          bestDay: series.reduce<(typeof series)[number] | null>((b, p) => (!b || p.finished > b.finished ? p : b), null),
          worstDay: series.filter((p) => p.target > 0).reduce<(typeof series)[number] | null>((b, p) => (!b || p.finished < b.finished ? p : b), null),
          issuesRaised: db.issues.filter((i) => i.detectedDate >= from && i.detectedDate <= to).length,
          issuesResolved: db.issues.filter((i) => i.resolvedDate && i.resolvedDate >= from && i.resolvedDate <= to).length,
        },
        downtimeReasons: Object.entries(downtimeReasons).map(([reason, minutes]) => ({ reason, minutes })).sort((a, b) => b.minutes - a.minutes),
      });
    }),
  );

  // ---------------- import / export ----------------
  const raw = express.raw({ type: () => true, limit: '10mb' });

  const runImport = async (req: Request) => {
    const kind = q(req, 'kind') === 'orders' ? 'orders' : 'production';
    const mode: DuplicateMode = q(req, 'mode') === 'replace' ? 'replace' : 'skip';
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'upload.csv'));
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw bad('The uploaded file is empty.');
    let sheet;
    try {
      sheet = await parseUpload(req.body, filename);
    } catch (e) {
      throw bad((e as Error).message);
    }
    if (!sheet.rows.length) throw bad('No data rows found in the file.');
    if (sheet.rows.length > 20000) throw bad('Files are limited to 20,000 rows per import.');
    return { kind, mode, sheet, filename } as const;
  };

  app.post(
    '/api/import/preview',
    raw,
    h(async (req, res) => {
      const { kind, mode, sheet, filename } = await runImport(req);
      const result =
        kind === 'production'
          ? previewProductionImport(store.db, sheet.rows, sheet.headers, mode, today(), 'Imported')
          : previewOrderImport(store.db, sheet.rows, sheet.headers, mode, today());
      res.json({ ...result.preview, filename, sheetName: sheet.sheetName });
    }),
  );

  app.post(
    '/api/import/commit',
    raw,
    h(async (req, res) => {
      const { kind, mode, sheet } = await runImport(req);
      const outcome = store.update((db) => {
        const now = nowIso();
        if (kind === 'production') {
          // Re-validate against current data inside the write, so nothing stale is committed.
          const { rows, preview } = previewProductionImport(db, sheet.rows, sheet.headers, mode, today(), 'Imported');
          if (preview.missingRequired.length) throw bad(`Missing required columns: ${preview.missingRequired.join(', ')}`);
          let added = 0;
          let replaced = 0;
          const ids = db.entries.map((e) => e.id);
          for (const r of rows) {
            if (!r.input || (r.status !== 'ok' && r.status !== 'replace')) continue;
            if (r.status === 'replace' && r.replaceId) {
              const ex = db.entries.find((e) => e.id === r.replaceId)!;
              Object.assign(ex, r.input, { source: 'import', updatedAt: now });
              replaced++;
            } else {
              const id = nextId('PE', ids, 5);
              ids.push(id);
              db.entries.push({ ...r.input, id, source: 'import', createdAt: now, updatedAt: now });
              added++;
            }
          }
          return { added, replaced, skipped: preview.summary.duplicates, errors: preview.summary.errors };
        }
        const { rows, preview } = previewOrderImport(db, sheet.rows, sheet.headers, mode, today());
        if (preview.missingRequired.length) throw bad(`Missing required columns: ${preview.missingRequired.join(', ')}`);
        let added = 0;
        let replaced = 0;
        for (const r of rows) {
          if (!r.order) continue;
          ensureProduct(db, r.order.productCode, r.productName ?? '', 'import');
          const ex = db.orders.find((o) => o.id === r.order!.id);
          if (ex) {
            Object.assign(ex, r.order);
            replaced++;
          } else {
            db.orders.push({ ...r.order, source: 'import', createdAt: now });
            added++;
          }
        }
        return { added, replaced, skipped: preview.summary.duplicates, errors: preview.summary.errors };
      });
      res.json(outcome);
    }),
  );

  app.get(
    '/api/import/template',
    h(async (req, res) => {
      const kind = q(req, 'kind') === 'orders' ? 'orders' : 'production';
      const format = q(req, 'format') === 'xlsx' ? 'xlsx' : 'csv';
      const db = store.db;
      const d = latestEntryDate(db, today()) ?? today();
      const exampleOrder = db.orders.find((o) => o.releaseDate <= d)?.id ?? 'WO-1001';
      const headers = kind === 'production' ? PRODUCTION_TEMPLATE_HEADERS : ORDER_TEMPLATE_HEADERS;
      const rows =
        kind === 'production'
          ? [
              [d, 'A', exampleOrder, 'Machining', 0, 0, 0, '', 'Supervisor name', 'Example row — replace with real figures'],
            ]
          : [['WO-2001', 'GT-PC-101', 'Aria Pillar Cock', 'Customer name', 2000, today(), addDays(today(), 21), 'Normal', 'Example row']];
      const name = `everyse-${kind}-template.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      if (format === 'xlsx') {
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await buildXlsx(headers, rows, kind === 'production' ? 'Production' : 'Orders'));
      } else res.type('text/csv').send(toCsv(headers, rows));
    }),
  );

  /**
   * A realistic plant-style shift sheet (Shift C of the latest day) sized to the WIP actually available,
   * with one deliberately over-counted row so the import validation can be demonstrated.
   */
  app.get(
    '/api/import/sample',
    h(async (_req, res) => {
      const db = store.db;
      const date = latestEntryDate(db, today()) ?? today();
      const scratch: DB = { ...db, entries: [...db.entries] };
      const active = allOrderProgress(db, date).filter((p) => p.status !== 'completed').slice(0, 4);
      const rows: unknown[][] = [];
      const dmy = date.split('-').reverse().join('-');
      const label: Record<string, string> = { forging: 'Forging', machining: 'CNC', polishing: 'Buffing', plating: 'Chrome Plating', assembly: 'Assembly', packing: 'Packing' };
      const sup: Record<string, string> = { forging: 'Ramesh Yadav', machining: 'Anil Sharma', polishing: 'Mukesh Kumar', plating: 'Pooja Meena', assembly: 'Sunita Devi', packing: 'Imran Khan' };
      let n = 0;
      for (const stage of STAGE_IDS) {
        for (const p of active) {
          const avail = availableForStage(scratch, p.order.id, stage, date) ?? 0;
          if (avail < 20 || scratch.entries.some((e) => e.date === date && e.shift === 'C' && e.orderId === p.order.id && e.stage === stage)) continue;
          const processed = Math.min(Math.round(avail * 0.35), 260);
          const rej = Math.round(processed * (stage === 'plating' ? 0.07 : 0.015));
          const good = processed - rej;
          const dt = stage === 'plating' && n % 2 === 0 ? 25 : 0;
          rows.push([dmy, 'C', p.order.id, label[stage], good, rej, dt || '', dt ? 'Quality hold' : '', sup[stage], '']);
          scratch.entries.push({ id: `__s${n++}`, date, shift: 'C', orderId: p.order.id, stage, goodQty: good, rejectQty: rej, downtimeMin: dt, supervisor: sup[stage], source: 'import', createdAt: '', updatedAt: '' });
        }
      }
      const bad = active[0];
      if (bad) rows.push([dmy, 'C', bad.order.id, 'Packing', bad.order.quantity * 2, 0, '', '', 'Imran Khan', 'Typo — extra zero']);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Shift C');
      ws.addRow([`Galaxy Taps — Shift C production report (DEMO) — ${dmy}`]).font = { bold: true, size: 13 };
      const header = ['Prod Date', 'Shift', 'WO No', 'Process', 'OK Qty', 'Rejection', 'Breakdown Min', 'Reason', 'Supervisor', 'Remarks'];
      ws.addRow(header).font = { bold: true };
      for (const r of rows) ws.addRow(r);
      ws.columns.forEach((c) => (c.width = 16));
      res.setHeader('Content-Disposition', `attachment; filename="demo-shift-C-${date}.xlsx"`);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await wb.xlsx.writeBuffer()));
    }),
  );

  app.get(
    '/api/export/entries.csv',
    h((req, res) => {
      const from = q(req, 'from') ?? '0000-01-01';
      const to = q(req, 'to') ?? '9999-12-31';
      const rows = store.db.entries
        .filter((e) => e.date >= from && e.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date) || stageIndex(a.stage) - stageIndex(b.stage) || a.shift.localeCompare(b.shift))
        .map((e) => [e.date, e.shift, e.orderId, STAGES.find((s) => s.id === e.stage)!.name, e.goodQty, e.rejectQty, e.downtimeMin, e.downtimeReason ?? '', e.supervisor, e.notes ?? '', e.source, e.id]);
      res.setHeader('Content-Disposition', `attachment; filename="production-${from === '0000-01-01' ? 'all' : from}-to-${to === '9999-12-31' ? 'latest' : to}.csv"`);
      res.type('text/csv').send(toCsv([...PRODUCTION_TEMPLATE_HEADERS, 'Source', 'Entry ID'], rows));
    }),
  );

  app.get(
    '/api/export/backup.json',
    h((_req, res) => {
      res.setHeader('Content-Disposition', `attachment; filename="everyse-backup-${today()}.json"`);
      res.json(store.db);
    }),
  );

  // ---------------- AI assistant (mock execution) ----------------
  app.get(
    '/api/ai',
    h((req, res) => {
      const { autonomy, actions } = store.db.ai;
      const mode = q(req, 'mode');
      const search = q(req, 'q')?.toLowerCase();
      let list = actions;
      if (mode) list = list.filter((a) => a.mode === mode);
      if (search) list = list.filter((a) => [a.id, a.prompt, a.title, a.result].some((v) => v.toLowerCase().includes(search)));
      res.json({ autonomy, actions: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }),
  );

  app.put(
    '/api/ai/autonomy',
    h((req, res) => {
      const { intent, level } = req.body ?? {};
      if (!AI_INTENTS.includes(intent)) throw bad('Unknown capability');
      if (level !== 'auto' && level !== 'ask') throw bad('Level must be auto or ask');
      if (capability(intent).readOnly && level === 'ask') throw bad('Read-only capabilities always run without approval.');
      const autonomy = store.update((db) => {
        db.ai.autonomy[intent as AiIntent] = level;
        return db.ai.autonomy;
      });
      res.json(autonomy);
    }),
  );

  app.post(
    '/api/ai/actions',
    h((req, res) => {
      const b = req.body ?? {};
      const errors: string[] = [];
      if (!AI_INTENTS.includes(b.intent)) errors.push('Unknown intent.');
      if (!['autonomous', 'approved', 'rejected'].includes(b.mode)) errors.push('Invalid mode.');
      if (!['completed', 'cancelled'].includes(b.status)) errors.push('Invalid status.');
      if (typeof b.title !== 'string' || !b.title.trim()) errors.push('Title is required.');
      if (!Array.isArray(b.steps) || b.steps.some((s: AiStep) => typeof s?.label !== 'string')) errors.push('Steps are invalid.');
      if (errors.length) throw bad(errors[0], errors);
      const action = store.update((db) => {
        const a: AiAction = {
          id: nextId('AI', db.ai.actions.map((x) => x.id)),
          createdAt: nowIso(),
          prompt: String(b.prompt ?? '').slice(0, 500),
          intent: b.intent,
          title: b.title.trim(),
          mode: b.mode,
          status: b.status,
          steps: b.steps.map((s: AiStep) => ({ tool: String(s.tool ?? ''), label: s.label, detail: s.detail ? String(s.detail) : undefined })),
          result: String(b.result ?? ''),
          link: typeof b.link === 'string' && b.link.startsWith('/') ? b.link : undefined,
          simulated: true,
          source: 'manual',
        };
        db.ai.actions.push(a);
        return a;
      });
      res.status(201).json(action);
    }),
  );

  // ---------------- settings & admin ----------------
  app.put(
    '/api/settings',
    h((req, res) => {
      const body = req.body as Partial<Settings>;
      const updated = store.update((db) => {
        const s = db.settings;
        const errors: string[] = [];
        if (body.plantName !== undefined) {
          if (!String(body.plantName).trim()) errors.push('Plant name is required.');
          else s.plantName = String(body.plantName).trim();
        }
        for (const [k, min, max] of [
          ['shortfallPct', 1, 100],
          ['downtimeAlertMin', 0, 1440],
          ['firstStageAllowancePct', 0, 50],
        ] as const) {
          if (body[k] === undefined) continue;
          const v = Number(body[k]);
          if (!Number.isFinite(v) || v < min || v > max) errors.push(`${k} must be between ${min} and ${max}.`);
          else s[k] = v;
        }
        if (Array.isArray(body.stages)) {
          for (const st of body.stages) {
            const cur = s.stages.find((x) => x.stage === st.stage);
            if (!cur) continue;
            const t = Number(st.dailyTarget);
            const r = Number(st.rejectThresholdPct);
            if (!Number.isInteger(t) || t < 0) errors.push(`Daily target for ${st.stage} must be a whole number ≥ 0.`);
            else cur.dailyTarget = t;
            if (!Number.isFinite(r) || r < 0 || r > 100) errors.push(`Reject limit for ${st.stage} must be 0–100%.`);
            else cur.rejectThresholdPct = r;
          }
        }
        if (errors.length) throw bad(errors[0], errors);
        return s;
      });
      res.json(updated);
    }),
  );

  app.post(
    '/api/admin/reset-demo',
    h((_req, res) => {
      store.resetDemo(today());
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/admin/clear',
    h((_req, res) => {
      store.clearAll();
      res.json({ ok: true });
    }),
  );

  registerEngRoutes(app, { store, today, nowIso });

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if ((err as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large (max 10 MB).' });
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error' });
  });

  return app;
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function countBy<T extends string>(arr: T[]) {
  const out: Record<string, number> = {};
  for (const x of arr) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function pickEntry(e: ProductionEntry): EntryInput {
  const { date, shift, orderId, stage, goodQty, rejectQty, downtimeMin, downtimeReason, supervisor, notes } = e;
  return { date, shift, orderId, stage, goodQty, rejectQty, downtimeMin, downtimeReason, supervisor, notes };
}
