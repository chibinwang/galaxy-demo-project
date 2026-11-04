import express, { type Express, type Request } from 'express';
import {
  evaluate,
  overallResult,
  revisionApprovalBlockers,
  suggestMethod,
  type Characteristic,
  type CharKind,
  type CharStatus,
  type DrawingRevision,
  type Inspection,
  type Measurement,
  type PlanItem,
  type QcPlan,
} from '../shared/eng';
import { demoExtractor, folderDelivery, portalDelivery, type InboundDelivery } from '../shared/engSeed';
import type { DB, Issue, StageId } from '../shared/types';
import { nextId, type Store } from './db';
import { bad, h, HttpError, notFound, q } from './http';

/*
 * Engineering & QC API. Interfaces are kept explicit so real services can replace the demo ones:
 *   - ingestion: `ingest()` is the single entry point for uploads, demo connectors and (later) webhooks;
 *   - extraction: `demoExtractor` implements DrawingExtractor (shared/engSeed.ts);
 *   - nonconformance: failed characteristics become Issues in the existing Exceptions & Actions module.
 */

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  dwg: 'application/acad',
  dxf: 'image/vnd.dxf',
  step: 'application/step',
  stp: 'application/step',
  igs: 'model/iges',
  iges: 'model/iges',
  sldprt: 'application/octet-stream',
  x_t: 'application/octet-stream',
};
const MAX_UPLOAD = 25 * 1024 * 1024;

export interface Connector {
  id: 'manual' | 'portal' | 'folder' | 'pdm';
  name: string;
  status: 'available' | 'demo' | 'planned';
  description: string;
}

export const CONNECTORS: Connector[] = [
  { id: 'manual', name: 'Manual upload', status: 'available', description: 'Drag & drop or browse PDF, image or CAD files.' },
  { id: 'portal', name: 'Designer Portal', status: 'demo', description: 'Demo connector — simulates an OEM designer submitting a revised drawing.' },
  { id: 'folder', name: 'Shared Engineering Folder', status: 'demo', description: 'Demo connector — simulates a new file appearing in the shared inbound folder.' },
  { id: 'pdm', name: 'CAD / PDM integration', status: 'planned', description: 'Planned — webhook / API ingestion from PDM systems.' },
];

const nextRevLetter = (revs: DrawingRevision[]) => {
  const letters = revs.map((r) => r.rev).filter((r) => /^[A-Z]$/.test(r)).sort();
  return letters.length ? String.fromCharCode(letters[letters.length - 1].charCodeAt(0) + 1) : 'A';
};

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Map a characteristic to the production stage most likely responsible, for the nonconformance record. */
function stageFor(type: string): StageId | undefined {
  if (/coating|plating/i.test(type)) return 'plating';
  if (/rough/i.test(type)) return 'polishing';
  if (/length|height|diameter|thread|perpend|angle/i.test(type)) return 'machining';
  return undefined;
}

export function registerEngRoutes(app: Express, { store, today, nowIso }: { store: Store; today: () => string; nowIso: () => string }) {
  /** Single ingestion path for uploads, demo connectors and future webhooks. */
  function ingest(db: DB, d: InboundDelivery, opts: { workOrderId?: string } = {}): DrawingRevision {
    const eng = db.eng;
    const ext = (d.file.name.split('.').pop() ?? '').toLowerCase();
    if (!MIME[ext]) throw bad(`Unsupported file type ".${ext}". Use PDF, PNG/JPG/SVG or CAD (DWG, DXF, STEP, IGES).`);
    if (d.file.bytes.length === 0) throw bad('The uploaded file is empty.');
    if (d.file.bytes.length > MAX_UPLOAD) throw bad('Files are limited to 25 MB in this demo.');
    let drawing = d.drawing.id ? eng.drawings.find((x) => x.id === d.drawing.id) : eng.drawings.find((x) => x.partSku === d.drawing.partSku && x.customer === d.drawing.customer);
    if (d.drawing.id && !drawing) throw notFound('Drawing');
    const now = nowIso();
    if (!drawing) {
      if (!d.drawing.partSku.trim() || !d.drawing.partName.trim()) throw bad('Part / SKU and part name are required for a new drawing.');
      drawing = { id: nextId('DRW', eng.drawings.map((x) => x.id)), partSku: d.drawing.partSku.trim(), partName: d.drawing.partName.trim(), customer: d.drawing.customer.trim() || '—', material: d.drawing.material.trim() || '—', createdAt: now, synthetic: d.source !== 'manual' };
      eng.drawings.push(drawing);
    }
    const existingRevs = eng.revisions.filter((r) => r.drawingId === drawing!.id);
    const rev = (d.rev || nextRevLetter(existingRevs)).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,5}$/.test(rev)) throw bad('Revision must be 1–6 letters/digits, e.g. B or 02.');
    if (existingRevs.some((r) => r.rev === rev)) throw new HttpError(409, `${drawing.id} revision ${rev} already exists. Previous revisions are never overwritten — use the next revision letter.`);
    const fileId = nextId('FILE', eng.files.map((f) => f.id));
    store.writeFile(fileId, Buffer.from(d.file.bytes));
    eng.files.push({ id: fileId, name: d.file.name, mime: MIME[ext] ?? d.file.mime, size: d.file.bytes.length, storedAt: now });
    const r: DrawingRevision = {
      id: `${drawing.id}-${rev}`,
      drawingId: drawing.id,
      rev,
      fileId,
      fileName: d.file.name,
      format: ext,
      mime: MIME[ext],
      size: d.file.bytes.length,
      schematic: d.schematic,
      source: d.source,
      sourceMeta: d.sourceMeta,
      uploadedAt: now,
      status: 'awaiting_review',
      workOrderId: opts.workOrderId,
      notes: d.notes,
      synthetic: d.source !== 'manual',
    };
    eng.revisions.push(r);
    // Approved requirements stay in force; plans built on earlier revisions are flagged for re-approval.
    for (const p of eng.plans) if (p.drawingId === drawing.id && p.status !== 'superseded') p.reapprovalPending = r.id;
    return r;
  }

  const findRev = (db: DB, id: string) => {
    const r = db.eng.revisions.find((x) => x.id === id);
    if (!r) throw notFound('Drawing revision');
    return r;
  };

  app.get(
    '/api/eng',
    h((_req, res) => res.json({ ...store.db.eng, connectors: CONNECTORS, workOrders: store.db.orders.map((o) => ({ id: o.id, label: `${o.id} · ${o.customer}` })) })),
  );

  app.get(
    '/api/eng/files/:id',
    h((req, res) => {
      const meta = store.db.eng.files.find((f) => f.id === req.params.id);
      const bytes = meta && store.readFile(meta.id);
      if (!meta || !bytes) throw notFound('File');
      res.setHeader('Content-Type', meta.mime);
      res.setHeader('Content-Disposition', `${q(req, 'download') ? 'attachment' : 'inline'}; filename="${encodeURIComponent(meta.name)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Uploaded SVG / files are untrusted: never let them run script on this origin.
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
      res.send(bytes);
    }),
  );

  const raw = express.raw({ type: () => true, limit: MAX_UPLOAD + 1024 });

  app.post(
    '/api/eng/upload',
    raw,
    h((req: Request, res) => {
      if (!Buffer.isBuffer(req.body)) throw bad('No file received.');
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? '')).replace(/[\\/]/g, '_');
      if (!name) throw bad('File name missing.');
      const workOrderId = q(req, 'workOrderId') || undefined;
      if (workOrderId && !store.db.orders.some((o) => o.id === workOrderId)) throw bad(`Work order ${workOrderId} does not exist.`);
      const rev = store.update((db) =>
        ingest(
          db,
          {
            drawing: { id: q(req, 'drawingId') || undefined, partSku: q(req, 'partSku') ?? '', partName: q(req, 'partName') ?? '', customer: q(req, 'customer') ?? '', material: q(req, 'material') ?? '' },
            rev: q(req, 'rev') ?? '',
            file: { name, mime: String(req.headers['content-type'] ?? ''), bytes: req.body },
            source: 'manual',
            notes: q(req, 'notes') || undefined,
          },
          { workOrderId },
        ),
      );
      res.status(201).json(rev);
    }),
  );

  app.post(
    '/api/eng/connectors/:id/receive',
    h((req, res) => {
      const id = req.params.id;
      const rev = store.update((db) => {
        if (id === 'portal') {
          if (db.eng.revisions.some((r) => r.id === 'DRW-0001-B')) throw new HttpError(409, 'No new drawings waiting on the Designer Portal (demo connector).');
          if (!db.eng.drawings.some((d) => d.id === 'DRW-0001')) throw new HttpError(409, 'Demo scenario data was cleared — reset the Engineering demo first.');
          return ingest(db, portalDelivery(nowIso()));
        }
        if (id === 'folder') {
          const existing = db.eng.drawings.find((d) => d.partSku === 'OEM-HL-40');
          const rev = existing ? nextRevLetter(db.eng.revisions.filter((r) => r.drawingId === existing.id)) : 'A';
          return ingest(db, folderDelivery(nowIso(), rev));
        }
        throw bad(id === 'pdm' ? 'CAD / PDM integration is planned — not available in v0.1.' : 'Use the upload area for manual files.');
      });
      res.status(201).json(rev);
    }),
  );

  app.put(
    '/api/eng/revisions/:id',
    h((req, res) => {
      const b = req.body ?? {};
      const out = store.update((db) => {
        const r = findRev(db, String(req.params.id));
        const d = db.eng.drawings.find((x) => x.id === r.drawingId)!;
        if (b.workOrderId !== undefined) {
          if (b.workOrderId && !db.orders.some((o) => o.id === b.workOrderId)) throw bad(`Work order ${b.workOrderId} does not exist.`);
          r.workOrderId = b.workOrderId || undefined;
        }
        if (b.notes !== undefined) r.notes = String(b.notes).trim() || undefined;
        for (const k of ['partName', 'customer', 'material'] as const) {
          if (b[k] === undefined) continue;
          if (!String(b[k]).trim()) throw bad(`${k} cannot be empty.`);
          d[k] = String(b[k]).trim();
        }
        return { revision: r, drawing: d };
      });
      res.json(out);
    }),
  );

  app.post(
    '/api/eng/revisions/:id/extract',
    h((req, res) => {
      const out = store.update((db) => {
        const r = findRev(db, String(req.params.id));
        if (db.eng.characteristics.some((c) => c.revisionId === r.id)) throw new HttpError(409, 'Characteristics already exist for this revision.');
        const result = demoExtractor.extract(r);
        if (!result.available) throw new HttpError(422, result.reason!);
        const now = nowIso();
        const chars: Characteristic[] = result.characteristics!.map((c) => ({ ...c, id: `${r.id}-${c.code}`, revisionId: r.id, status: 'extracted' as const, source: 'simulated_ai' as const }));
        db.eng.characteristics.push(...chars);
        r.extraction = { method: 'simulated_ai', at: now };
        if (r.status === 'awaiting_review') r.status = 'in_review';
        return chars;
      });
      res.status(201).json(out);
    }),
  );

  const charFields = (b: Record<string, unknown>) => {
    const out: Partial<Characteristic> = {};
    for (const k of ['nominal', 'upperTol', 'lowerTol'] as const) if (k in b) {
      const v = num(b[k]);
      if (Number.isNaN(v)) throw bad(`${k} must be a number.`);
      out[k] = v;
    }
    for (const k of ['type', 'description', 'unit', 'gdt', 'spec'] as const) if (k in b) out[k] = String(b[k] ?? '').trim() || undefined;
    if ('page' in b) out.page = Math.max(1, Math.round(Number(b.page) || 1));
    if ('kind' in b) {
      if (b.kind !== 'variable' && b.kind !== 'attribute') throw bad('kind must be variable or attribute.');
      out.kind = b.kind as CharKind;
    }
    if (out.upperTol != null && out.lowerTol != null && out.upperTol < out.lowerTol) throw bad('Upper tolerance must be ≥ lower tolerance.');
    return out;
  };

  app.post(
    '/api/eng/revisions/:id/characteristics',
    h((req, res) => {
      const c = store.update((db) => {
        const r = findRev(db, String(req.params.id));
        if (r.status === 'approved' || r.status === 'superseded') throw new HttpError(409, 'Approved revisions are locked. Upload a new revision to change requirements.');
        const f = charFields(req.body ?? {});
        if (!f.description || !f.type) throw bad('Type and description are required.');
        const codes = db.eng.characteristics.filter((x) => x.revisionId === r.id).map((x) => Number(x.code.slice(1)));
        const code = `C${String(Math.max(0, ...codes) + 1).padStart(2, '0')}`;
        const ch: Characteristic = { kind: 'variable', unit: 'mm', page: 1, ...f, type: f.type, description: f.description, id: `${r.id}-${code}`, revisionId: r.id, code, source: 'manual', status: 'extracted' };
        db.eng.characteristics.push(ch);
        r.extraction ??= { method: 'manual', at: nowIso() };
        if (r.status === 'awaiting_review') r.status = 'in_review';
        return ch;
      });
      res.status(201).json(c);
    }),
  );

  app.put(
    '/api/eng/characteristics/:id',
    h((req, res) => {
      const b = req.body ?? {};
      const c = store.update((db) => {
        const ch = db.eng.characteristics.find((x) => x.id === req.params.id);
        if (!ch) throw notFound('Characteristic');
        const r = findRev(db, ch.revisionId);
        if (r.status === 'approved' || r.status === 'superseded') throw new HttpError(409, 'Approved revisions are locked. Upload a new revision to change requirements.');
        const f = charFields(b);
        const changed = Object.entries(f).some(([k, v]) => (ch as unknown as Record<string, unknown>)[k] !== v);
        Object.assign(ch, f);
        if (changed) {
          if (ch.source === 'simulated_ai') ch.editedAfterExtraction = true;
          ch.status = 'extracted'; // edited values must be confirmed again
        }
        if ('reviewerNote' in b) ch.reviewerNote = String(b.reviewerNote ?? '').trim() || undefined;
        if (b.status) {
          const status = b.status as CharStatus;
          if (!['extracted', 'confirmed', 'flagged', 'clarification'].includes(status)) throw bad('Invalid status.');
          const reviewer = String(b.reviewer ?? '').trim();
          if (status !== 'extracted' && !reviewer) throw bad('Reviewer name is required.');
          if ((status === 'flagged' || status === 'clarification') && !ch.reviewerNote) throw bad('Add a reviewer note explaining the concern.');
          ch.status = status;
          ch.reviewedBy = status === 'extracted' ? undefined : reviewer;
          ch.reviewedAt = status === 'extracted' ? undefined : nowIso();
        }
        return ch;
      });
      res.json(c);
    }),
  );

  app.delete(
    '/api/eng/characteristics/:id',
    h((req, res) => {
      store.update((db) => {
        const ch = db.eng.characteristics.find((x) => x.id === req.params.id);
        if (!ch) throw notFound('Characteristic');
        const r = findRev(db, ch.revisionId);
        if (r.status === 'approved' || r.status === 'superseded') throw new HttpError(409, 'Approved revisions are locked.');
        db.eng.characteristics = db.eng.characteristics.filter((x) => x.id !== ch.id);
      });
      res.status(204).end();
    }),
  );

  app.post(
    '/api/eng/revisions/:id/approve',
    h((req, res) => {
      const approver = String(req.body?.approver ?? '').trim();
      const r = store.update((db) => {
        const r = findRev(db, String(req.params.id));
        if (r.status === 'approved') throw new HttpError(409, 'Revision is already approved.');
        if (r.status === 'superseded') throw new HttpError(409, 'A newer revision has been approved; this one is superseded.');
        if (!approver) throw bad('Approver name is required — approvals are never automatic.');
        const blockers = revisionApprovalBlockers(db.eng.characteristics.filter((c) => c.revisionId === r.id));
        if (blockers.length) throw bad(blockers[0], blockers);
        const now = nowIso();
        r.status = 'approved';
        r.approvedBy = approver;
        r.approvedAt = now;
        // Older approved revisions — and plans built on them — are superseded, but kept for traceability.
        for (const old of db.eng.revisions)
          if (old.drawingId === r.drawingId && old.id !== r.id && old.status === 'approved') {
            old.status = 'superseded';
            old.supersededBy = r.id;
          }
        for (const p of db.eng.plans) {
          if (p.drawingId !== r.drawingId) continue;
          if (p.revisionId !== r.id && p.status !== 'superseded') p.status = 'superseded';
          if (p.reapprovalPending === r.id) p.reapprovalPending = undefined;
        }
        return r;
      });
      res.json(r);
    }),
  );

  app.post(
    '/api/eng/revisions/:id/plans',
    h((req, res) => {
      const createdBy = String(req.body?.createdBy ?? '').trim();
      const plan = store.update((db) => {
        const r = findRev(db, String(req.params.id));
        if (r.status !== 'approved') throw bad('Approve the drawing revision before creating a QC plan — plans must reference an approved revision.');
        if (!createdBy) throw bad('Plan author is required.');
        const existing = db.eng.plans.find((p) => p.revisionId === r.id && p.status !== 'superseded');
        if (existing) throw new HttpError(409, `Plan ${existing.id} already exists for ${r.id}.`);
        const d = db.eng.drawings.find((x) => x.id === r.drawingId)!;
        const items: PlanItem[] = db.eng.characteristics
          .filter((c) => c.revisionId === r.id && c.status === 'confirmed')
          .map((c) => {
            const s = suggestMethod(c);
            return { characteristicId: c.id, code: c.code, type: c.type, description: c.description, kind: c.kind, nominal: c.nominal, upperTol: c.upperTol, lowerTol: c.lowerTol, unit: c.unit, gdt: c.gdt, spec: c.spec, method: s.method, methodSuggested: s.method, sampleSize: s.sampleSize };
          });
        const p: QcPlan = { id: nextId('QCP', db.eng.plans.map((x) => x.id)), drawingId: d.id, revisionId: r.id, rev: r.rev, partSku: d.partSku, status: 'draft', items, createdAt: nowIso(), createdBy, synthetic: r.synthetic };
        db.eng.plans.push(p);
        return p;
      });
      res.status(201).json(plan);
    }),
  );

  app.put(
    '/api/eng/plans/:id',
    h((req, res) => {
      const b = req.body ?? {};
      const plan = store.update((db) => {
        const p = db.eng.plans.find((x) => x.id === req.params.id);
        if (!p) throw notFound('Plan');
        if (p.status !== 'draft') throw new HttpError(409, 'Only draft plans can be edited. Approved plans are fixed for traceability.');
        if (Array.isArray(b.items))
          for (const u of b.items as { characteristicId: string; method?: string; sampleSize?: number }[]) {
            const it = p.items.find((x) => x.characteristicId === u.characteristicId);
            if (!it) continue;
            if (u.method !== undefined) it.method = String(u.method).trim();
            if (u.sampleSize !== undefined) {
              const n = Number(u.sampleSize);
              if (!Number.isInteger(n) || n < 1 || n > 50) throw bad('Sample size must be a whole number from 1 to 50.');
              it.sampleSize = n;
            }
          }
        if (b.notes !== undefined) p.notes = String(b.notes).trim() || undefined;
        return p;
      });
      res.json(plan);
    }),
  );

  app.post(
    '/api/eng/plans/:id/approve',
    h((req, res) => {
      const approver = String(req.body?.approver ?? '').trim();
      const plan = store.update((db) => {
        const p = db.eng.plans.find((x) => x.id === req.params.id);
        if (!p) throw notFound('Plan');
        if (p.status !== 'draft') throw new HttpError(409, `Plan is ${p.status}.`);
        const r = findRev(db, p.revisionId);
        if (r.status !== 'approved') throw bad(`Drawing ${r.id} is not the approved revision.`);
        if (!approver) throw bad('Approver name is required — QC plans are never approved automatically.');
        if (approver.toLowerCase() === p.createdBy.toLowerCase()) throw bad('Four-eyes rule: the approver must be a different person from the plan author.');
        const missing = p.items.filter((i) => !i.method || i.sampleSize < 1);
        if (missing.length) throw bad(`Set an inspection method and sample size for ${missing.map((i) => i.code).join(', ')}.`);
        if (!p.items.length) throw bad('Plan has no characteristics.');
        p.status = 'approved';
        p.approvedBy = approver;
        p.approvedAt = nowIso();
        return p;
      });
      res.json(plan);
    }),
  );

  const recompute = (db: DB, ins: Inspection) => {
    const plan = db.eng.plans.find((p) => p.id === ins.planId)!;
    const rev = db.eng.revisions.find((r) => r.id === ins.revisionId)!;
    // An inspection is evaluated against the plan it was opened with; a later supersession does not rewrite history.
    const ctx = ins.status === 'completed' ? { planApproved: true, revisionApproved: true } : { planApproved: plan.status === 'approved', revisionApproved: rev.status === 'approved' };
    for (const m of ins.measurements) {
      const item = plan.items.find((i) => i.characteristicId === m.characteristicId)!;
      Object.assign(m, evaluate(item, m.value, ctx));
    }
    ins.overall = overallResult(ins.measurements);
  };

  app.post(
    '/api/eng/inspections',
    h((req, res) => {
      const b = req.body ?? {};
      const ins = store.update((db) => {
        const p = db.eng.plans.find((x) => x.id === b.planId);
        if (!p) throw bad('Select an inspection plan.');
        if (p.status !== 'approved') throw bad(`Plan ${p.id} is ${p.status} — only approved plans can be used for inspection.`);
        const rev = findRev(db, p.revisionId);
        if (rev.status !== 'approved') throw bad(`Drawing ${rev.id} is ${rev.status}; inspect against the current approved revision.`);
        const batch = String(b.batch ?? '').trim();
        const inspector = String(b.inspector ?? '').trim();
        if (!batch) throw bad('Batch number is required.');
        if (!inspector) throw bad('Inspector name is required.');
        if (b.workOrderId && !db.orders.some((o) => o.id === b.workOrderId)) throw bad(`Work order ${b.workOrderId} does not exist.`);
        const measurements: Measurement[] = p.items.flatMap((it) =>
          Array.from({ length: it.sampleSize }, (_, i) => ({ code: it.code, characteristicId: it.characteristicId, sample: i + 1, result: 'review' as const, reason: 'No measurement entered.' })),
        );
        const ins: Inspection = {
          id: nextId('INS', db.eng.inspections.map((x) => x.id)),
          planId: p.id,
          drawingId: p.drawingId,
          revisionId: p.revisionId,
          rev: p.rev,
          partSku: p.partSku,
          batch,
          workOrderId: b.workOrderId || undefined,
          inspector,
          status: 'open',
          measurements,
          attachmentIds: [],
          overall: 'review',
          issueIds: [],
          createdAt: nowIso(),
          synthetic: p.synthetic,
        };
        db.eng.inspections.push(ins);
        return ins;
      });
      res.status(201).json(ins);
    }),
  );

  app.put(
    '/api/eng/inspections/:id',
    h((req, res) => {
      const b = req.body ?? {};
      const ins = store.update((db) => {
        const ins = db.eng.inspections.find((x) => x.id === req.params.id);
        if (!ins) throw notFound('Inspection');
        if (ins.status !== 'open') throw new HttpError(409, 'Completed inspections are locked for traceability.');
        if (b.values && typeof b.values === 'object')
          for (const [key, v] of Object.entries(b.values as Record<string, unknown>)) {
            const [code, sample] = key.split(':');
            const m = ins.measurements.find((x) => x.code === code && x.sample === Number(sample));
            if (!m) continue;
            if (v === null || v === '' || v === undefined) m.value = undefined;
            else if (v === 'ok' || v === 'nok') m.value = v;
            else {
              const n = Number(v);
              if (!Number.isFinite(n)) throw bad(`${code} sample ${sample}: "${v}" is not a number.`);
              m.value = n;
            }
          }
        if (b.comments !== undefined) ins.comments = String(b.comments).trim() || undefined;
        recompute(db, ins);
        return ins;
      });
      res.json(ins);
    }),
  );

  app.post(
    '/api/eng/inspections/:id/complete',
    h((req, res) => {
      const out = store.update((db) => {
        const ins = db.eng.inspections.find((x) => x.id === req.params.id);
        if (!ins) throw notFound('Inspection');
        if (ins.status !== 'open') throw new HttpError(409, 'Inspection is already completed.');
        recompute(db, ins);
        if (ins.measurements.every((m) => m.value === undefined)) throw bad('Enter at least one measurement before completing the inspection.');
        ins.status = 'completed';
        ins.completedAt = nowIso();
        const plan = db.eng.plans.find((p) => p.id === ins.planId)!;
        const now = nowIso();
        const failedCodes = [...new Set(ins.measurements.filter((m) => m.result === 'fail').map((m) => m.code))];
        for (const code of failedCodes) {
          const item = plan.items.find((i) => i.code === code)!;
          const fails = ins.measurements.filter((m) => m.code === code && m.result === 'fail');
          const issue: Issue = {
            id: nextId('ISS', db.issues.map((i) => i.id)),
            title: `NCR ${ins.partSku} ${code}: ${item.description} out of tolerance`,
            type: 'quality',
            severity: 'high',
            stage: stageFor(item.type),
            orderId: ins.workOrderId,
            detectedDate: today(),
            description: `Inspection ${ins.id} (batch ${ins.batch}) against ${ins.drawingId} rev ${ins.rev}, plan ${plan.id}. ${fails.length} of ${ins.measurements.filter((m) => m.code === code).length} samples failed: ${fails.map((m) => `#${m.sample} ${m.reason}`).join(' ')} Batch disposition pending QA decision — no automatic rejection.`,
            correctiveAction: 'Quarantine nonconforming samples; 100% check this characteristic on the batch; investigate set-up / fixture against the new revision.',
            status: 'open',
            exceptionKey: `ncr:${ins.id}:${code}`,
            inspectionId: ins.id,
            source: 'manual',
            createdAt: now,
            updatedAt: now,
          };
          db.issues.push(issue);
          ins.issueIds.push(issue.id);
        }
        return ins;
      });
      res.json(out);
    }),
  );

  app.post(
    '/api/eng/inspections/:id/attachments',
    raw,
    h((req: Request, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('No file received.');
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'attachment')).replace(/[\\/]/g, '_');
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      if (!MIME[ext]) throw bad('Attach a PDF or image file.');
      const ins = store.update((db) => {
        const ins = db.eng.inspections.find((x) => x.id === req.params.id);
        if (!ins) throw notFound('Inspection');
        const id = nextId('FILE', db.eng.files.map((f) => f.id));
        store.writeFile(id, req.body);
        db.eng.files.push({ id, name, mime: MIME[ext], size: req.body.length, storedAt: nowIso() });
        ins.attachmentIds.push(id);
        return ins;
      });
      res.status(201).json(ins);
    }),
  );

  app.post(
    '/api/eng/reset',
    h((_req, res) => {
      store.seedEngineering(today());
      res.json({ ok: true });
    }),
  );
}
