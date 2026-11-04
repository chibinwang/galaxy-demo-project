/*
 * Engineering & QC domain: drawings → revisions → characteristics → QC plans → inspections → nonconformance.
 * Pure, deterministic logic shared by server, client and tests.
 */

export type DrawingSource = 'manual' | 'portal' | 'folder';
export type RevisionStatus = 'awaiting_review' | 'in_review' | 'approved' | 'superseded';
export type CharStatus = 'extracted' | 'confirmed' | 'flagged' | 'clarification';
export type CharKind = 'variable' | 'attribute';
export type PlanStatus = 'draft' | 'approved' | 'superseded';
export type MeasureResult = 'pass' | 'fail' | 'review';

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  storedAt: string;
}

export interface Drawing {
  id: string;
  partSku: string;
  partName: string;
  customer: string;
  material: string;
  createdAt: string;
  synthetic: boolean;
}

export interface DrawingRevision {
  id: string;
  drawingId: string;
  rev: string;
  fileId?: string;
  fileName: string;
  /** Lower-case extension, e.g. pdf, png, step. */
  format: string;
  mime: string;
  size: number;
  /** Seeded illustrative schematic to display instead of a file (demo drawings only). */
  schematic?: 'spout-A' | 'spout-B';
  source: DrawingSource;
  sourceMeta?: { connector: string; sender: string; receivedAt: string; reference?: string };
  uploadedAt: string;
  status: RevisionStatus;
  workOrderId?: string;
  notes?: string;
  approvedBy?: string;
  approvedAt?: string;
  supersededBy?: string;
  /** Set once characteristics have been loaded (simulated AI) or added manually. */
  extraction?: { method: 'simulated_ai' | 'manual'; at: string };
  synthetic: boolean;
}

export interface Characteristic {
  id: string;
  revisionId: string;
  code: string;
  type: string;
  description: string;
  kind: CharKind;
  nominal?: number;
  upperTol?: number;
  lowerTol?: number;
  unit: string;
  /** Feature-control frame text for GD&T callouts — evaluated manually, never automatically. */
  gdt?: string;
  /** Attribute specification text, e.g. "G 1/2 — Go/No-Go". */
  spec?: string;
  page: number;
  source: 'simulated_ai' | 'manual';
  confidence?: number;
  status: CharStatus;
  reviewerNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  editedAfterExtraction?: boolean;
  /** Callout id in the seeded schematic, used to highlight the region on the drawing. */
  callout?: string;
}

export interface PlanItem {
  characteristicId: string;
  code: string;
  type: string;
  description: string;
  kind: CharKind;
  nominal?: number;
  upperTol?: number;
  lowerTol?: number;
  unit: string;
  gdt?: string;
  spec?: string;
  method: string;
  methodSuggested: string;
  sampleSize: number;
}

export interface QcPlan {
  id: string;
  drawingId: string;
  revisionId: string;
  rev: string;
  partSku: string;
  status: PlanStatus;
  items: PlanItem[];
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
  /** A newer drawing revision has arrived; this plan may need re-approval against it. */
  reapprovalPending?: string;
  synthetic: boolean;
}

export interface Measurement {
  code: string;
  characteristicId: string;
  sample: number;
  /** Numeric value for variable characteristics; 'ok' / 'nok' for attribute checks. */
  value?: number | 'ok' | 'nok';
  result: MeasureResult;
  reason: string;
}

export interface Inspection {
  id: string;
  planId: string;
  drawingId: string;
  revisionId: string;
  rev: string;
  partSku: string;
  batch: string;
  workOrderId?: string;
  inspector: string;
  status: 'open' | 'completed';
  measurements: Measurement[];
  comments?: string;
  attachmentIds: string[];
  overall: MeasureResult;
  issueIds: string[];
  createdAt: string;
  completedAt?: string;
  synthetic: boolean;
}

export interface EngState {
  files: StoredFile[];
  drawings: Drawing[];
  revisions: DrawingRevision[];
  characteristics: Characteristic[];
  plans: QcPlan[];
  inspections: Inspection[];
}

export const emptyEngState = (): EngState => ({ files: [], drawings: [], revisions: [], characteristics: [], plans: [], inspections: [] });

// ---------------- tolerance evaluation ----------------

/** Integer micro-units so 119.80 and 120.20 compare exactly (no floating-point drift). */
const micro = (x: number) => Math.round(x * 1e6);
const KNOWN_UNITS = new Set(['mm', 'µm', 'um', 'deg', '°', 'Ra µm']);

export function specLimits(c: Pick<PlanItem, 'nominal' | 'upperTol' | 'lowerTol'>): { lsl: number; usl: number } | null {
  if (c.nominal == null || c.upperTol == null || c.lowerTol == null) return null;
  if (!Number.isFinite(c.nominal) || !Number.isFinite(c.upperTol) || !Number.isFinite(c.lowerTol)) return null;
  return { lsl: (micro(c.nominal) + micro(c.lowerTol)) / 1e6, usl: (micro(c.nominal) + micro(c.upperTol)) / 1e6 };
}

export interface EvalContext {
  planApproved: boolean;
  revisionApproved: boolean;
}

const fmtNum = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Deterministic compliance check. Anything the system cannot verify — no approval, no tolerance,
 * GD&T, unknown unit, missing value — is "review", never an invented pass.
 */
export function evaluate(item: PlanItem, value: Measurement['value'], ctx: EvalContext): { result: MeasureResult; reason: string } {
  if (!ctx.revisionApproved) return { result: 'review', reason: 'Drawing revision is not approved.' };
  if (!ctx.planApproved) return { result: 'review', reason: 'Inspection plan is not approved.' };
  if (value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value))) return { result: 'review', reason: 'No measurement entered.' };
  if (item.kind === 'attribute') {
    if (value === 'ok') return { result: 'pass', reason: `${item.spec ?? 'Attribute check'}: conforming.` };
    if (value === 'nok') return { result: 'fail', reason: `${item.spec ?? 'Attribute check'}: nonconforming.` };
    return { result: 'review', reason: 'Attribute checks need OK / NOK.' };
  }
  if (typeof value !== 'number') return { result: 'review', reason: 'Numeric measurement required.' };
  if (item.gdt) return { result: 'review', reason: `GD&T (${item.gdt}) requires manual evaluation by quality engineering.` };
  if (!KNOWN_UNITS.has(item.unit)) return { result: 'review', reason: `Unit "${item.unit || 'none'}" is missing or ambiguous.` };
  const lim = specLimits(item);
  if (!lim) return { result: 'review', reason: 'Specification has no complete tolerance.' };
  const v = micro(value);
  if (v < micro(lim.lsl)) return { result: 'fail', reason: `${fmtNum(value)} ${item.unit} is below LSL ${fmtNum(lim.lsl)} (−${fmtNum((micro(lim.lsl) - v) / 1e6)}).` };
  if (v > micro(lim.usl)) return { result: 'fail', reason: `${fmtNum(value)} ${item.unit} exceeds USL ${fmtNum(lim.usl)} (+${fmtNum((v - micro(lim.usl)) / 1e6)}).` };
  return { result: 'pass', reason: `Within ${fmtNum(lim.lsl)}–${fmtNum(lim.usl)} ${item.unit}.` };
}

/** Inspection-level summary: any failed characteristic → fail; else any open item → review; else pass. */
export function overallResult(ms: Pick<Measurement, 'result'>[]): MeasureResult {
  if (ms.some((m) => m.result === 'fail')) return 'fail';
  if (ms.length === 0 || ms.some((m) => m.result === 'review')) return 'review';
  return 'pass';
}

// ---------------- suggestions (humans approve the final choice) ----------------

export function suggestMethod(c: Pick<Characteristic, 'type' | 'kind' | 'gdt' | 'unit' | 'description'>): { method: string; sampleSize: number } {
  if (c.gdt) return { method: 'CMM — manual evaluation against datum', sampleSize: 1 };
  if (c.kind === 'attribute') return { method: 'Thread ring gauge (Go / No-Go)', sampleSize: 5 };
  switch (c.type) {
    case 'Coating thickness':
      return { method: 'XRF coating thickness gauge', sampleSize: 3 };
    case 'Surface roughness':
      return { method: 'Portable surface roughness tester', sampleSize: 1 };
    case 'Diameter':
      return /bore|inner|outlet/i.test(c.description) ? { method: 'Bore gauge / pin gauge set', sampleSize: 5 } : { method: 'Digital vernier caliper (0.01 mm)', sampleSize: 5 };
    case 'Length':
    case 'Height':
      return { method: 'Height gauge on surface plate', sampleSize: 5 };
    case 'Angle':
      return { method: 'Digital protractor', sampleSize: 3 };
    default:
      return { method: 'To be defined by quality engineering', sampleSize: 1 };
  }
}

export const METHOD_OPTIONS = [
  'Digital vernier caliper (0.01 mm)',
  'Outside micrometer (0.001 mm)',
  'Height gauge on surface plate',
  'Bore gauge / pin gauge set',
  'Thread ring gauge (Go / No-Go)',
  'XRF coating thickness gauge',
  'Portable surface roughness tester',
  'Digital protractor',
  'CMM — manual evaluation against datum',
  'Visual inspection',
];

/** Approval gate for a drawing revision: every characteristic must be human-confirmed. */
export function revisionApprovalBlockers(chars: Characteristic[]): string[] {
  if (chars.length === 0) return ['No characteristics recorded for this revision.'];
  const out: string[] = [];
  const open = chars.filter((c) => c.status === 'extracted');
  const flagged = chars.filter((c) => c.status === 'flagged' || c.status === 'clarification');
  if (open.length) out.push(`${open.length} characteristic(s) not yet reviewed (${open.map((c) => c.code).join(', ')}).`);
  if (flagged.length) out.push(`${flagged.length} flagged / awaiting clarification (${flagged.map((c) => c.code).join(', ')}).`);
  return out;
}

export const SOURCE_LABEL: Record<DrawingSource, string> = { manual: 'Manual upload', portal: 'Designer portal', folder: 'Shared folder' };
export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  awaiting_review: 'Awaiting review',
  in_review: 'In review',
  approved: 'Approved',
  superseded: 'Superseded',
};
export const CHAR_STATUS_LABEL: Record<CharStatus, string> = { extracted: 'To review', confirmed: 'Confirmed', flagged: 'Flagged', clarification: 'Needs clarification' };

export const PREVIEWABLE = (format: string) => ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(format);

export function fmtLimits(c: Pick<PlanItem, 'nominal' | 'upperTol' | 'lowerTol' | 'unit' | 'kind' | 'spec' | 'gdt'>): string {
  if (c.kind === 'attribute') return c.spec ?? 'Attribute';
  if (c.gdt) return c.gdt;
  const l = specLimits(c);
  if (!l) return c.nominal != null ? `${c.nominal} ${c.unit} (tolerance missing)` : 'Not specified';
  return `${fmtNum(l.lsl)} – ${fmtNum(l.usl)} ${c.unit}`;
}
