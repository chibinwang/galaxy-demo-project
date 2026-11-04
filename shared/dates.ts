import { WORKING_WEEKDAYS } from './constants';

// All dates are plain ISO calendar dates (YYYY-MM-DD), handled in UTC to avoid timezone drift.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in the server/browser's local timezone. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function weekday(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

export function isWorkingDay(iso: string): boolean {
  return WORKING_WEEKDAYS.includes(weekday(iso));
}

/** Move forward by n working days (n may be fractional; rounded up). */
export function addWorkingDays(iso: string, n: number): string {
  let remaining = Math.ceil(n);
  let d = iso;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d)) remaining--;
  }
  return d;
}

/** The last `count` working days ending on (and including, if a working day) `end`, oldest first. */
export function lastWorkingDays(end: string, count: number): string[] {
  const out: string[] = [];
  let d = end;
  while (out.length < count) {
    if (isWorkingDay(d)) out.unshift(d);
    d = addDays(d, -1);
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(iso: string, withWeekday = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]} ${y}`;
  return withWeekday ? `${DAYS[weekday(iso)]}, ${base}` : base;
}

export function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Parse dates as they appear in Indian factory spreadsheets:
 * ISO (2026-10-21), DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY, DD-Mon-YYYY, Excel serial numbers and Date objects.
 */
export function parseFlexibleDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // exceljs returns dates at UTC midnight
    return toIso(v);
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const ms = Math.round((v - 25569) * 86400000);
    return toIso(new Date(ms));
  }
  const s = String(v).trim();
  if (isIsoDate(s as unknown)) return s;
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return checked(+iso[1], +iso[2], +iso[3]);
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3];
    return checked(y, +dmy[2], +dmy[1]);
  }
  const dMonY = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})$/);
  if (dMonY) {
    const m = MONTHS.findIndex((x) => x.toLowerCase() === dMonY[2].toLowerCase());
    if (m < 0) return null;
    const y = dMonY[3].length === 2 ? 2000 + +dMonY[3] : +dMonY[3];
    return checked(y, m + 1, +dMonY[1]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseFlexibleDate(Number(s));
  return null;
}

function checked(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(s) ? s : null;
}
