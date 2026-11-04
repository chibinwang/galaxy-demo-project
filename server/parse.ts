import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { RawRow } from '../shared/importer';

export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  sheetName?: string;
}

/** Turn an uploaded .xlsx or .csv buffer into header + row objects. Uses the first worksheet with data. */
export async function parseUpload(buf: Buffer, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(buf.toString('utf8'));
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return parseXlsx(buf);
  if (lower.endsWith('.xls')) throw new Error('Legacy .xls files are not supported. In Excel choose File → Save As → .xlsx (or CSV) and upload again.');
  throw new Error('Upload an Excel (.xlsx) or CSV file.');
}

function parseCsv(text: string): ParsedSheet {
  const res = Papa.parse<RawRow>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data };
}

async function parseXlsx(buf: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 1) ?? wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  // Header row = first row with at least 3 non-empty cells (sheets often have a title row above).
  let headerRowNo = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const vals = (ws.getRow(r).values as unknown[]).filter((v) => v != null && String(v).trim() !== '');
    if (vals.length >= 3) {
      headerRowNo = r;
      break;
    }
  }
  const headerRow = ws.getRow(headerRowNo);
  const headers: { col: number; name: string }[] = [];
  headerRow.eachCell((cell, col) => {
    const name = cellValue(cell.value);
    if (name != null && String(name).trim()) headers.push({ col, name: String(name).trim() });
  });
  const rows: RawRow[] = [];
  for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: RawRow = {};
    for (const h of headers) obj[h.name] = cellValue(row.getCell(h.col).value);
    rows.push(obj);
  }
  return { headers: headers.map((h) => h.name), rows, sheetName: ws.name };
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if ('result' in v) return v.result ?? null; // formula
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text; // hyperlink
  return String(v);
}

export async function buildXlsx(headers: string[], rows: unknown[][], sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c) => (c.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return Papa.unparse({ fields: headers, data: rows });
}
