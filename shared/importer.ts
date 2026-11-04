import { STAGES, STAGE_IDS, stageIndex } from './constants';
import { parseFlexibleDate } from './dates';
import { checkEntry, findDuplicate, type EntryInput } from './integrity';
import type { DB, Order, Priority, ProductionEntry, Shift, StageId } from './types';

export type ImportKind = 'production' | 'orders';
export type DuplicateMode = 'skip' | 'replace';
export type RawRow = Record<string, unknown>;

export interface ImportRowResult {
  row: number;
  status: 'ok' | 'error' | 'duplicate' | 'replace';
  errors: string[];
  data: Record<string, unknown>;
}

export interface ImportPreview {
  kind: ImportKind;
  columns: { source: string; field: string | null }[];
  missingRequired: string[];
  rows: ImportRowResult[];
  summary: { total: number; ok: number; errors: number; duplicates: number; replacing: number };
}

// Header aliases seen in plant spreadsheets (matched after lower-casing and stripping punctuation).
const PRODUCTION_FIELDS: Record<string, string[]> = {
  date: ['date', 'production date', 'prod date', 'entry date', 'day'],
  shift: ['shift', 'shift name'],
  orderId: ['order', 'order id', 'order no', 'work order', 'work order no', 'wo', 'wo no', 'job', 'job no', 'batch'],
  stage: ['stage', 'process', 'operation', 'department', 'dept', 'section'],
  goodQty: ['good qty', 'good', 'ok qty', 'ok', 'output', 'produced', 'production qty', 'qty ok', 'accepted', 'good quantity', 'quantity'],
  rejectQty: ['reject qty', 'reject', 'rejects', 'rejection', 'rejected', 'nok', 'scrap', 'reject quantity', 'rejection qty'],
  downtimeMin: ['downtime', 'downtime min', 'downtime mins', 'downtime minutes', 'breakdown min', 'loss min', 'stoppage min'],
  downtimeReason: ['downtime reason', 'reason', 'breakdown reason', 'stoppage reason'],
  supervisor: ['supervisor', 'entered by', 'incharge', 'in charge', 'operator', 'recorded by'],
  notes: ['notes', 'remarks', 'remark', 'comments', 'comment'],
};
const PRODUCTION_REQUIRED = ['date', 'shift', 'orderId', 'stage', 'goodQty'];

const ORDER_FIELDS: Record<string, string[]> = {
  id: ['order', 'order id', 'order no', 'work order', 'work order no', 'wo', 'wo no', 'job no'],
  productCode: ['product code', 'sku', 'item code', 'part no', 'product', 'item'],
  productName: ['product name', 'item name', 'description', 'model'],
  customer: ['customer', 'party', 'client', 'dealer', 'buyer'],
  quantity: ['quantity', 'qty', 'order qty', 'order quantity'],
  releaseDate: ['release date', 'start date', 'order date', 'issue date'],
  dueDate: ['due date', 'delivery date', 'dispatch date', 'due'],
  priority: ['priority'],
  notes: ['notes', 'remarks', 'remark'],
};
const ORDER_REQUIRED = ['id', 'productCode', 'quantity', 'dueDate'];

const STAGE_ALIASES: Record<StageId, string[]> = {
  forging: ['forging', 'forge', 'hot forging', 'casting', 'press'],
  machining: ['machining', 'cnc', 'vmc', 'machine shop', 'turning', 'threading'],
  polishing: ['polishing', 'buffing', 'grinding', 'polish', 'buff'],
  plating: ['plating', 'chrome plating', 'electroplating', 'nickel chrome', 'cp', 'chrome', 'nickel plating'],
  assembly: ['assembly', 'assembly testing', 'assembly and testing', 'testing', 'leak testing', 'fitting'],
  packing: ['packing', 'packaging', 'pack', 'final inspection', 'dispatch', 'fg'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function mapHeaders(headers: string[], kind: ImportKind) {
  const fields = kind === 'production' ? PRODUCTION_FIELDS : ORDER_FIELDS;
  const used = new Set<string>();
  const columns = headers.map((h) => {
    const n = norm(h);
    let field: string | null = null;
    for (const [f, aliases] of Object.entries(fields)) {
      if (used.has(f)) continue;
      if (n === norm(f) || aliases.includes(n)) {
        field = f;
        break;
      }
    }
    if (field) used.add(field);
    return { source: h, field };
  });
  const required = kind === 'production' ? PRODUCTION_REQUIRED : ORDER_REQUIRED;
  return { columns, missingRequired: required.filter((r) => !used.has(r)) };
}

export function parseStage(v: unknown): StageId | null {
  if (v == null) return null;
  const n = norm(String(v));
  if (!n) return null;
  for (const id of STAGE_IDS) if (n === id || STAGE_ALIASES[id].includes(n)) return id;
  const byName = STAGES.find((s) => norm(s.name) === n);
  return byName?.id ?? null;
}

export function parseShift(v: unknown): Shift | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase().replace(/^SHIFT\s*/, '');
  if (s === 'A' || s === '1' || s === 'I' || s === 'DAY' || s === 'GENERAL' || s === 'G') return 'A';
  if (s === 'B' || s === '2' || s === 'II' || s === 'EVENING' || s === 'NIGHT') return 'B';
  if (s === 'C' || s === '3' || s === 'III') return 'C';
  return null;
}

function parseQty(v: unknown, blankAsZero: boolean): number | null {
  if (v == null || v === '') return blankAsZero ? 0 : null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

function remap(raw: RawRow, columns: { source: string; field: string | null }[]) {
  const out: Record<string, unknown> = {};
  for (const c of columns) if (c.field) out[c.field] = raw[c.source];
  return out;
}

const isBlankRow = (raw: RawRow) => Object.values(raw).every((v) => v == null || String(v).trim() === '');

/**
 * Validate production rows against the database and against each other.
 * Rows are applied in process order (date, then stage) to a scratch copy of the data,
 * so a file containing both Polishing and Plating output for the same order validates correctly.
 */
export function previewProductionImport(db: DB, raws: RawRow[], headers: string[], mode: DuplicateMode, today: string, defaultSupervisor = 'Imported') {
  const { columns, missingRequired } = mapHeaders(headers, 'production');
  const rows: (ImportRowResult & { input?: EntryInput; replaceId?: string })[] = [];
  if (!missingRequired.length) {
    raws.forEach((raw, i) => {
      if (isBlankRow(raw)) return;
      const r = remap(raw, columns);
      const errors: string[] = [];
      const date = parseFlexibleDate(r.date);
      const shift = parseShift(r.shift);
      const stage = parseStage(r.stage);
      const goodQty = parseQty(r.goodQty, false);
      const rejectQty = parseQty(r.rejectQty, true);
      const downtimeMin = parseQty(r.downtimeMin, true);
      if (!date) errors.push(`Unrecognised date "${str(r.date)}".`);
      if (!shift) errors.push(`Unrecognised shift "${str(r.shift)}".`);
      if (!stage) errors.push(`Unrecognised stage "${str(r.stage)}".`);
      if (goodQty == null) errors.push(`Good quantity "${str(r.goodQty)}" is not a number.`);
      if (rejectQty == null) errors.push(`Reject quantity "${str(r.rejectQty)}" is not a number.`);
      if (downtimeMin == null) errors.push(`Downtime "${str(r.downtimeMin)}" is not a number.`);
      const input: EntryInput = {
        date: date ?? '',
        shift: shift ?? 'A',
        orderId: str(r.orderId).toUpperCase(),
        stage: stage ?? 'forging',
        goodQty: goodQty ?? 0,
        rejectQty: rejectQty ?? 0,
        downtimeMin: downtimeMin ?? 0,
        downtimeReason: str(r.downtimeReason) || (downtimeMin ? 'Other' : undefined),
        supervisor: str(r.supervisor) || defaultSupervisor,
        notes: str(r.notes) || undefined,
      };
      rows.push({ row: i + 2, status: errors.length ? 'error' : 'ok', errors, data: { ...input, stage: stage ?? str(r.stage), shift: shift ?? str(r.shift), date: date ?? str(r.date) }, input: errors.length ? undefined : input });
    });
  }

  // Apply valid rows in process order against a scratch copy.
  const scratch: DB = { ...db, entries: [...db.entries] };
  const seenInFile = new Set<string>();
  const order = rows
    .filter((r) => r.input)
    .sort((a, b) => a.input!.date.localeCompare(b.input!.date) || stageIndex(a.input!.stage) - stageIndex(b.input!.stage) || a.row - b.row);
  let seq = 0;
  for (const r of order) {
    const e = r.input!;
    const k = `${e.date}|${e.shift}|${e.orderId}|${e.stage}`;
    if (seenInFile.has(k)) {
      r.status = 'error';
      r.errors.push('Same order, stage, shift and date appears earlier in this file.');
      continue;
    }
    seenInFile.add(k);
    const dup = findDuplicate(scratch.entries, e);
    if (dup && mode === 'skip') {
      r.status = 'duplicate';
      r.errors.push(`Already recorded as ${dup.id} — will be skipped.`);
      continue;
    }
    const res = checkEntry(scratch, e, today, dup?.id);
    if (!res.ok) {
      r.status = 'error';
      r.errors.push(...res.errors);
      continue;
    }
    const placeholder: ProductionEntry = { ...e, id: dup?.id ?? `__import_${seq++}`, source: 'import', createdAt: '', updatedAt: '' };
    scratch.entries = dup ? scratch.entries.map((x) => (x.id === dup.id ? placeholder : x)) : scratch.entries.concat(placeholder);
    if (dup) {
      r.status = 'replace';
      r.replaceId = dup.id;
      r.errors.push(`Will replace existing entry ${dup.id}.`);
    }
  }

  return { preview: summarise('production', columns, missingRequired, rows), rows };
}

export function previewOrderImport(db: DB, raws: RawRow[], headers: string[], mode: DuplicateMode, today: string) {
  const { columns, missingRequired } = mapHeaders(headers, 'orders');
  const rows: (ImportRowResult & { order?: Omit<Order, 'source' | 'createdAt'>; productName?: string })[] = [];
  const seen = new Set<string>();
  if (!missingRequired.length) {
    raws.forEach((raw, i) => {
      if (isBlankRow(raw)) return;
      const r = remap(raw, columns);
      const errors: string[] = [];
      const id = str(r.id).toUpperCase();
      const productCode = str(r.productCode).toUpperCase();
      const quantity = parseQty(r.quantity, false);
      const dueDate = parseFlexibleDate(r.dueDate);
      const releaseDate = r.releaseDate ? parseFlexibleDate(r.releaseDate) : today;
      const pr = str(r.priority).toLowerCase();
      const priority: Priority = pr.startsWith('h') || pr === 'urgent' ? 'High' : pr.startsWith('l') ? 'Low' : 'Normal';
      if (!id) errors.push('Order number is required.');
      if (!productCode) errors.push('Product code is required.');
      if (quantity == null || !Number.isInteger(quantity) || quantity <= 0) errors.push(`Quantity "${str(r.quantity)}" must be a whole number above 0.`);
      if (!dueDate) errors.push(`Unrecognised due date "${str(r.dueDate)}".`);
      if (!releaseDate) errors.push(`Unrecognised release date "${str(r.releaseDate)}".`);
      if (dueDate && releaseDate && dueDate < releaseDate) errors.push('Due date is before release date.');
      if (productCode && !db.products.some((p) => p.code === productCode) && !str(r.productName))
        errors.push(`Unknown product ${productCode} — add a "Product name" column to create it.`);
      let status: ImportRowResult['status'] = errors.length ? 'error' : 'ok';
      if (!errors.length && seen.has(id)) {
        status = 'error';
        errors.push('Order appears earlier in this file.');
      }
      seen.add(id);
      const existing = db.orders.find((o) => o.id === id);
      if (status === 'ok' && existing) {
        if (mode === 'skip') {
          status = 'duplicate';
          errors.push('Order already exists — will be skipped.');
        } else {
          const packed = db.entries.filter((e) => e.orderId === id && e.stage === 'packing').reduce((a, e) => a + e.goodQty, 0);
          if (quantity! < packed) {
            status = 'error';
            errors.push(`Quantity ${quantity} is below the ${packed} already packed.`);
          } else {
            status = 'replace';
            errors.push('Existing order will be updated.');
          }
        }
      }
      const order = { id, productCode, customer: str(r.customer) || '—', quantity: quantity ?? 0, releaseDate: releaseDate ?? '', dueDate: dueDate ?? '', priority, notes: str(r.notes) || undefined };
      rows.push({ row: i + 2, status, errors, data: { ...order, productName: str(r.productName) }, order: status === 'ok' || status === 'replace' ? order : undefined, productName: str(r.productName) });
    });
  }
  return { preview: summarise('orders', columns, missingRequired, rows), rows };
}

function summarise(kind: ImportKind, columns: ImportPreview['columns'], missingRequired: string[], rows: ImportRowResult[]): ImportPreview {
  const clean = rows.map(({ row, status, errors, data }) => ({ row, status, errors, data }));
  return {
    kind,
    columns,
    missingRequired,
    rows: clean,
    summary: {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      errors: rows.filter((r) => r.status === 'error').length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      replacing: rows.filter((r) => r.status === 'replace').length,
    },
  };
}

export const PRODUCTION_TEMPLATE_HEADERS = ['Date', 'Shift', 'Work Order', 'Stage', 'Good Qty', 'Reject Qty', 'Downtime (min)', 'Downtime Reason', 'Supervisor', 'Remarks'];
export const ORDER_TEMPLATE_HEADERS = ['Work Order', 'Product Code', 'Product Name', 'Customer', 'Quantity', 'Release Date', 'Due Date', 'Priority', 'Remarks'];

