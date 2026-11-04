/*
 * Tiny vector PDF writer used to produce genuine sample drawing files for the demo
 * (so the PDF viewer renders real documents, not pictures pretending to be files).
 * Supports lines, rectangles, circles, polylines and Helvetica text. ASCII only.
 */

type Op =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w?: number; dash?: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number; lw?: number }
  | { t: 'circle'; x: number; y: number; r: number; lw?: number }
  | { t: 'poly'; pts: [number, number][]; lw?: number; close?: boolean }
  | { t: 'text'; x: number; y: number; s: string; size?: number; bold?: boolean };

export type PdfPage = Op[];

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

function stream(ops: Op[]): string {
  const out: string[] = ['0 0 0 RG 0 0 0 rg'];
  for (const o of ops) {
    switch (o.t) {
      case 'line':
        out.push(`${n(o.w ?? 0.6)} w ${o.dash ? '[4 3] 0 d' : '[] 0 d'} ${n(o.x1)} ${n(o.y1)} m ${n(o.x2)} ${n(o.y2)} l S`);
        break;
      case 'rect':
        out.push(`${n(o.lw ?? 0.8)} w [] 0 d ${n(o.x)} ${n(o.y)} ${n(o.w)} ${n(o.h)} re S`);
        break;
      case 'circle': {
        const k = 0.5523 * o.r;
        const { x, y, r } = o;
        out.push(
          `${n(o.lw ?? 0.8)} w [] 0 d ${n(x + r)} ${n(y)} m ${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c ${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c ${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c ${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c S`,
        );
        break;
      }
      case 'poly':
        out.push(`${n(o.lw ?? 0.8)} w [] 0 d ${o.pts.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? 'l' : 'm'}`).join(' ')} ${o.close ? 'h ' : ''}S`);
        break;
      case 'text':
        out.push(`BT /${o.bold ? 'F2' : 'F1'} ${n(o.size ?? 9)} Tf ${n(o.x)} ${n(o.y)} Td (${esc(o.s)}) Tj ET`);
        break;
    }
  }
  return out.join('\n');
}

/** Build a multi-page A4-landscape PDF (842 × 595 pt). */
export function buildPdf(pages: PdfPage[]): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 F1, 4 F2, then page/content pairs
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  let id = 5;
  for (const p of pages) {
    const content = stream(p);
    const pageId = id++;
    const contentId = id++;
    pageIds.push(pageId);
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Standard drawing frame with title block. */
export function frame(t: { title: string; partNo: string; rev: string; customer: string; material: string; drawingNo: string; sheet: string; date: string }): Op[] {
  const ops: Op[] = [
    { t: 'rect', x: 20, y: 20, w: 802, h: 555, lw: 1.4 },
    { t: 'rect', x: 532, y: 20, w: 290, h: 110, lw: 1 },
    { t: 'line', x1: 532, y1: 100, x2: 822, y2: 100 },
    { t: 'line', x1: 532, y1: 75, x2: 822, y2: 75 },
    { t: 'line', x1: 532, y1: 48, x2: 822, y2: 48 },
    { t: 'line', x1: 690, y1: 20, x2: 690, y2: 100 },
    { t: 'text', x: 540, y: 110, s: t.title, size: 12, bold: true },
    { t: 'text', x: 540, y: 86, s: `PART NO  ${t.partNo}`, size: 8 },
    { t: 'text', x: 698, y: 86, s: `DWG NO  ${t.drawingNo}`, size: 8 },
    { t: 'text', x: 540, y: 60, s: `CUSTOMER  ${t.customer}`, size: 8 },
    { t: 'text', x: 698, y: 60, s: `REV  ${t.rev}     SHEET ${t.sheet}`, size: 8, bold: true },
    { t: 'text', x: 540, y: 33, s: `MATERIAL  ${t.material}`, size: 8 },
    { t: 'text', x: 698, y: 33, s: `DATE ${t.date}   SCALE 1:1`, size: 8 },
    { t: 'text', x: 30, y: 28, s: 'SYNTHETIC DEMO DRAWING - generated for the Everyse demo, not a customer document. Dimensions in mm unless stated.', size: 7 },
  ];
  return ops;
}

export function dimH(x1: number, x2: number, y: number, label: string): Op[] {
  return [
    { t: 'line', x1, y1: y, x2, y2: y, w: 0.5 },
    { t: 'line', x1, y1: y - 5, x2: x1, y2: y + 5, w: 0.5 },
    { t: 'line', x1: x2, y1: y - 5, x2, y2: y + 5, w: 0.5 },
    { t: 'text', x: (x1 + x2) / 2 - label.length * 2.4, y: y + 5, s: label, size: 8.5 },
  ];
}

export function dimV(x: number, y1: number, y2: number, label: string): Op[] {
  return [
    { t: 'line', x1: x, y1, x2: x, y2, w: 0.5 },
    { t: 'line', x1: x - 5, y1, x2: x + 5, y2: y1, w: 0.5 },
    { t: 'line', x1: x - 5, y1: y2, x2: x + 5, y2, w: 0.5 },
    { t: 'text', x: x + 6, y: (y1 + y2) / 2 - 3, s: label, size: 8.5 },
  ];
}
