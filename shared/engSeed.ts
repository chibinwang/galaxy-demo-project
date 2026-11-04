import { addDays } from './dates';
import { evaluate, overallResult, suggestMethod, type Characteristic, type DrawingRevision, type EngState, type Inspection, type Measurement, type PlanItem, type QcPlan } from './eng';
import { buildPdf, dimH, dimV, frame, type PdfPage } from './pdf';

/*
 * SYNTHETIC Engineering & QC scenario: an OEM customer revises a wall-mounted bath spout.
 * All customers, parts, people, drawings and measurements here are fictional demo data.
 */

export const DEMO_OEM = 'AquaLine Bath Co. (demo OEM)';
export const DEMO_APPROVER = 'Neha Gupta (Quality Engineer, demo)';
export const DEMO_INSPECTOR = 'Ravi Verma (QC Inspector, demo)';
export const SPOUT = { drawingId: 'DRW-0001', partSku: 'OEM-SP-220', partName: 'SP-220 Wall-mounted bath spout', material: 'Brass CW617N, Ni-Cr plated' };
export const DEMO_BATCH = 'SP220-B2610-01';

// ---------------- seeded "AI" extraction results ----------------

type Seeded = Omit<Characteristic, 'id' | 'revisionId' | 'status' | 'source'>;

function spoutCharacteristics(rev: 'A' | 'B'): Seeded[] {
  const confirmedA = rev === 'A';
  return [
    { code: 'C01', type: 'Length', description: 'Overall projection, wall face to outlet end', kind: 'variable', nominal: rev === 'A' ? 118 : 120, upperTol: 0.2, lowerTol: -0.2, unit: 'mm', page: 1, confidence: 0.97, callout: 'C01' },
    { code: 'C02', type: 'Diameter', description: 'Outlet bore diameter', kind: 'variable', nominal: 18, upperTol: 0.1, lowerTol: -0.1, unit: 'mm', page: 1, confidence: 0.95, callout: 'C02' },
    { code: 'C03', type: 'Diameter', description: 'Wall flange outside diameter', kind: 'variable', nominal: 60, upperTol: 0.3, lowerTol: -0.3, unit: 'mm', page: 1, confidence: 0.93, callout: 'C03' },
    { code: 'C04', type: 'Height', description: 'Outlet drop height, body top to outlet face', kind: 'variable', nominal: rev === 'A' ? 40 : 42, upperTol: 0.25, lowerTol: -0.25, unit: 'mm', page: 1, confidence: 0.91, callout: 'C04' },
    { code: 'C05', type: 'Thread', description: 'Inlet connection thread', kind: 'attribute', spec: 'G 1/2 (BSPP) — Go / No-Go', unit: '', page: 1, confidence: 0.88, callout: 'C05' },
    { code: 'C06', type: 'Coating thickness', description: 'Ni-Cr plating thickness, visible surfaces', kind: 'variable', nominal: 10, upperTol: 5, lowerTol: -2, unit: 'µm', page: 2, confidence: 0.84, callout: 'C06' },
    {
      code: 'C07',
      type: 'Perpendicularity',
      description: 'Outlet face perpendicular to datum A',
      kind: 'variable',
      gdt: '⊥ 0.05 | A',
      nominal: 0,
      upperTol: 0.05,
      lowerTol: 0,
      unit: 'mm',
      page: 1,
      confidence: confirmedA ? 0.9 : 0.58,
      reviewerNote: confirmedA ? 'Evaluated on CMM by quality engineering.' : 'Simulated AI: feature-control frame partly illegible on scan — verify symbol and datum.',
      callout: 'C07',
    },
    confirmedA
      ? { code: 'C08', type: 'Surface roughness', description: 'Ra, visible chrome surfaces (max)', kind: 'variable', nominal: 0, upperTol: 0.4, lowerTol: 0, unit: 'µm', page: 2, confidence: 0.9, callout: 'C08' }
      : {
          code: 'C08',
          type: 'Surface roughness',
          description: 'Ra, visible chrome surfaces',
          kind: 'variable',
          nominal: 0.4,
          unit: 'µm',
          page: 2,
          confidence: 0.62,
          reviewerNote: 'Simulated AI: "Ra 0.4" found in notes — unclear whether maximum or nominal; no tolerance extracted.',
          callout: 'C08',
        },
  ];
}

export interface ExtractionResult {
  available: boolean;
  method?: 'simulated_ai';
  characteristics?: Seeded[];
  reason?: string;
}

/**
 * Extraction service boundary. A real OCR / vision-language / CAD-parsing pipeline would implement
 * this interface. The demo implementation only returns pre-seeded results for the demo drawings —
 * it never invents values for arbitrary uploaded documents.
 */
export interface DrawingExtractor {
  extract(rev: DrawingRevision): ExtractionResult;
}

export const demoExtractor: DrawingExtractor = {
  extract(rev) {
    if (rev.schematic === 'spout-A') return { available: true, method: 'simulated_ai', characteristics: spoutCharacteristics('A') };
    if (rev.schematic === 'spout-B') return { available: true, method: 'simulated_ai', characteristics: spoutCharacteristics('B') };
    return {
      available: false,
      reason: 'Simulated AI extraction is only available for the seeded demo drawings. Add characteristics manually for this document — a real OCR / CAD parsing pipeline would plug in here.',
    };
  },
};

// ---------------- genuine sample files ----------------

function spoutPdf(rev: 'A' | 'B', date: string): Uint8Array {
  const L = rev === 'A' ? '118.00' : '120.00';
  const H = rev === 'A' ? '40.00' : '42.00';
  const f = frame({ title: 'WALL-MOUNTED BATH SPOUT SP-220', partNo: SPOUT.partSku, rev, customer: 'AQUALINE BATH CO. (DEMO)', material: 'BRASS CW617N  NI-CR PLATED', drawingNo: SPOUT.drawingId, sheet: '1/2', date });
  const p1: PdfPage = [
    ...f,
    { t: 'text', x: 60, y: 540, s: 'FRONT VIEW', size: 9, bold: true },
    // wall flange
    { t: 'rect', x: 90, y: 245, w: 22, h: 150, lw: 1.2 },
    // body
    { t: 'poly', pts: [[112, 350], [380, 350], [410, 335], [418, 310], [418, 290]], lw: 1.4 },
    { t: 'poly', pts: [[112, 300], [360, 300], [372, 290]], lw: 1.4 },
    // outlet nozzle
    { t: 'poly', pts: [[372, 290], [372, 205], [418, 205], [418, 290]], lw: 1.4 },
    { t: 'line', x1: 395, y1: 300, x2: 395, y2: 190, w: 0.4, dash: true },
    { t: 'line', x1: 80, y1: 325, x2: 430, y2: 325, w: 0.4, dash: true },
    ...dimH(90, 418, 440, `${L} +/-0.20`),
    ...dimV(450, 350, 205, `${H} +/-0.25`),
    ...dimH(372, 418, 180, 'BORE D18.00 +/-0.10'),
    { t: 'rect', x: 425, y: 205, w: 70, h: 16, lw: 0.6 },
    { t: 'text', x: 430, y: 210, s: 'PERP 0.05 | A', size: 8 },
    { t: 'text', x: 60, y: 230, s: 'DATUM A = WALL FACE', size: 8 },
    { t: 'text', x: 600, y: 540, s: 'SIDE VIEW', size: 9, bold: true },
    { t: 'circle', x: 670, y: 330, r: 80, lw: 1.2 },
    { t: 'circle', x: 670, y: 330, r: 28, lw: 1.2 },
    { t: 'circle', x: 670, y: 330, r: 22, lw: 0.5 },
    ...dimH(590, 750, 440, 'D60.00 +/-0.30'),
    { t: 'text', x: 700, y: 360, s: 'G 1/2 (BSPP)', size: 8.5 },
    { t: 'line', x1: 692, y1: 352, x2: 698, y2: 358, w: 0.5 },
  ];
  const p2: PdfPage = [
    ...frame({ title: 'WALL-MOUNTED BATH SPOUT SP-220', partNo: SPOUT.partSku, rev, customer: 'AQUALINE BATH CO. (DEMO)', material: 'BRASS CW617N  NI-CR PLATED', drawingNo: SPOUT.drawingId, sheet: '2/2', date }),
    { t: 'text', x: 60, y: 530, s: 'GENERAL NOTES', size: 11, bold: true },
    { t: 'text', x: 60, y: 505, s: '1. NI-CR PLATING THICKNESS ON VISIBLE SURFACES 8 - 15 UM (NOMINAL 10).', size: 9 },
    { t: 'text', x: 60, y: 487, s: '2. SURFACE FINISH ON VISIBLE CHROME SURFACES RA 0.4.', size: 9 },
    { t: 'text', x: 60, y: 469, s: '3. REMOVE ALL BURRS AND SHARP EDGES. NO POROSITY AT 6 BAR AIR TEST.', size: 9 },
    { t: 'text', x: 60, y: 451, s: '4. UNTOLERANCED DIMENSIONS PER ISO 2768-m.', size: 9 },
    { t: 'text', x: 60, y: 400, s: 'REVISION HISTORY', size: 11, bold: true },
    { t: 'rect', x: 60, y: 300, w: 460, h: 90, lw: 0.8 },
    { t: 'line', x1: 60, y1: 365, x2: 520, y2: 365 },
    { t: 'line', x1: 60, y1: 335, x2: 520, y2: 335 },
    { t: 'line', x1: 110, y1: 300, x2: 110, y2: 390 },
    { t: 'text', x: 70, y: 373, s: 'REV', size: 8, bold: true },
    { t: 'text', x: 120, y: 373, s: 'DESCRIPTION', size: 8, bold: true },
    { t: 'text', x: 75, y: 345, s: 'A', size: 9 },
    { t: 'text', x: 120, y: 345, s: 'INITIAL RELEASE', size: 9 },
    ...(rev === 'B'
      ? ([
          { t: 'text', x: 75, y: 315, s: 'B', size: 9 },
          { t: 'text', x: 120, y: 315, s: 'PROJECTION 118.00 -> 120.00, DROP 40.00 -> 42.00 (CUSTOMER ECN-0412)', size: 9 },
        ] as PdfPage)
      : []),
  ];
  return buildPdf([p1, p2]);
}

function cartridgePdf(date: string): Uint8Array {
  const f = (sheet: string) => frame({ title: 'CARTRIDGE HOUSING CH-35', partNo: 'OEM-CH-35', rev: 'A', customer: 'NORDBAD FIXTURES (DEMO)', material: 'BRASS CW614N', drawingNo: 'DRW-0002', sheet, date });
  return buildPdf([
    [
      ...f('1/2'),
      { t: 'text', x: 60, y: 540, s: 'SECTION A-A', size: 9, bold: true },
      { t: 'rect', x: 150, y: 220, w: 180, h: 220, lw: 1.3 },
      { t: 'rect', x: 185, y: 220, w: 110, h: 180, lw: 1 },
      { t: 'line', x1: 240, y1: 200, x2: 240, y2: 460, w: 0.4, dash: true },
      ...dimH(150, 330, 470, 'D35.00 +/-0.05'),
      ...dimH(185, 295, 205, 'D22.00 H7'),
      ...dimV(350, 440, 220, '44.50 +/-0.10'),
      { t: 'circle', x: 640, y: 330, r: 90 },
      { t: 'circle', x: 640, y: 330, r: 55 },
    ],
    [...f('2/2'), { t: 'text', x: 60, y: 530, s: 'NOTES', size: 11, bold: true }, { t: 'text', x: 60, y: 505, s: '1. BORE D22 H7 TO BE GAUGED 100%.', size: 9 }, { t: 'text', x: 60, y: 487, s: '2. THREAD M35x1.5 - 6g.', size: 9 }],
  ]);
}

function aeratorStep(): Uint8Array {
  return new TextEncoder().encode(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('SYNTHETIC DEMO FILE - AR-16 aerator insert'),'2;1');",
      "FILE_NAME('AR-16_aerator_insert.step','2026-10-01T10:00:00',('Everyse demo'),(''),'','','');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      "#1=PRODUCT('AR-16','Aerator insert M24x1','',(#2));",
      "#2=PRODUCT_CONTEXT('',#3,'mechanical');",
      "#3=APPLICATION_CONTEXT('automotive design');",
      '#10=CARTESIAN_POINT(\'\',(0.,0.,0.));',
      '#11=CIRCLE(\'\',#12,12.);',
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
  );
}

export function leverSvg(rev: string): Uint8Array {
  return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595" width="842" height="595">
<rect width="842" height="595" fill="#fff"/>
<g fill="none" stroke="#111" stroke-width="1.2">
<rect x="20" y="20" width="802" height="555" stroke-width="2"/>
<rect x="532" y="465" width="290" height="110"/>
<path d="M150 300 L520 260 Q560 256 560 290 Q560 322 520 320 L150 340 Z" stroke-width="1.6"/>
<circle cx="170" cy="320" r="45" stroke-width="1.6"/>
<circle cx="170" cy="320" r="16"/>
<line x1="125" y1="400" x2="560" y2="400" stroke-width="0.6"/>
<line x1="125" y1="392" x2="125" y2="408" stroke-width="0.6"/><line x1="560" y1="392" x2="560" y2="408" stroke-width="0.6"/>
</g>
<g font-family="Helvetica, Arial, sans-serif" fill="#111">
<text x="300" y="420" font-size="13">96.00 ±0.30</text>
<text x="120" y="250" font-size="13">Ø40.00 ±0.20</text>
<text x="540" y="490" font-size="15" font-weight="bold">LEVER HANDLE HL-40</text>
<text x="540" y="515" font-size="11">PART OEM-HL-40   REV ${rev}</text>
<text x="540" y="535" font-size="11">ZAMAK 5, CHROME PLATED</text>
<text x="30" y="568" font-size="10">SYNTHETIC DEMO DRAWING — generated for the Everyse demo, not a customer document.</text>
</g></svg>`);
}

// ---------------- connector deliveries ----------------

export interface InboundDelivery {
  drawing: { id?: string; partSku: string; partName: string; customer: string; material: string };
  rev: string;
  file: { name: string; mime: string; bytes: Uint8Array };
  schematic?: DrawingRevision['schematic'];
  source: 'portal' | 'folder' | 'manual';
  sourceMeta?: DrawingRevision['sourceMeta'];
  notes?: string;
}

export function portalDelivery(nowIso: string): InboundDelivery {
  return {
    drawing: { id: SPOUT.drawingId, partSku: SPOUT.partSku, partName: SPOUT.partName, customer: DEMO_OEM, material: SPOUT.material },
    rev: 'B',
    file: { name: 'SP220_spout_RevB.pdf', mime: 'application/pdf', bytes: spoutPdf('B', nowIso.slice(0, 10)) },
    schematic: 'spout-B',
    source: 'portal',
    sourceMeta: { connector: 'Designer Portal (demo connector)', sender: 'm.lindqvist@aqualine.example (demo)', receivedAt: nowIso, reference: 'ECN-0412' },
    notes: 'Customer ECN-0412: projection 118.00 → 120.00 mm, drop 40.00 → 42.00 mm.',
  };
}

export function folderDelivery(nowIso: string, rev: string): InboundDelivery {
  return {
    drawing: { partSku: 'OEM-HL-40', partName: 'HL-40 Lever handle', customer: 'Nordbad Fixtures (demo OEM)', material: 'Zamak 5, chrome plated' },
    rev,
    file: { name: `HL-40_lever_handle_Rev${rev}.svg`, mime: 'image/svg+xml', bytes: leverSvg(rev) },
    source: 'folder',
    sourceMeta: { connector: 'Shared Engineering Folder (demo connector)', sender: '\\\\eng-share\\inbound\\nordbad (demo)', receivedAt: nowIso },
  };
}

// ---------------- seed ----------------

export interface EngSeed {
  state: EngState;
  blobs: Record<string, Uint8Array>;
}

export function seedEng(today: string): EngSeed {
  const at = (days: number, time = '09:30') => `${addDays(today, days)}T${time}:00.000Z`;
  const blobs: Record<string, Uint8Array> = {};
  const state: EngState = { files: [], drawings: [], revisions: [], characteristics: [], plans: [], inspections: [] };
  const addFile = (id: string, name: string, mime: string, bytes: Uint8Array, storedAt: string) => {
    blobs[id] = bytes;
    state.files.push({ id, name, mime, size: bytes.length, storedAt });
  };

  // DRW-0001 — bath spout, Rev A approved with a historical inspection
  addFile('FILE-0001', 'SP220_spout_RevA.pdf', 'application/pdf', spoutPdf('A', addDays(today, -40)), at(-40));
  state.drawings.push({ id: SPOUT.drawingId, partSku: SPOUT.partSku, partName: SPOUT.partName, customer: DEMO_OEM, material: SPOUT.material, createdAt: at(-40), synthetic: true });
  const revA: DrawingRevision = {
    id: 'DRW-0001-A',
    drawingId: SPOUT.drawingId,
    rev: 'A',
    fileId: 'FILE-0001',
    fileName: 'SP220_spout_RevA.pdf',
    format: 'pdf',
    mime: 'application/pdf',
    size: blobs['FILE-0001'].length,
    schematic: 'spout-A',
    source: 'folder',
    sourceMeta: { connector: 'Shared Engineering Folder (demo connector)', sender: '\\\\eng-share\\inbound\\aqualine (demo)', receivedAt: at(-40) },
    uploadedAt: at(-40),
    status: 'approved',
    approvedBy: DEMO_APPROVER,
    approvedAt: at(-38, '11:00'),
    extraction: { method: 'simulated_ai', at: at(-39) },
    synthetic: true,
  };
  state.revisions.push(revA);
  for (const c of spoutCharacteristics('A')) state.characteristics.push({ ...c, id: `${revA.id}-${c.code}`, revisionId: revA.id, status: 'confirmed', source: 'simulated_ai', reviewedBy: DEMO_APPROVER, reviewedAt: at(-38, '10:30') });

  const items: PlanItem[] = state.characteristics
    .filter((c) => c.revisionId === revA.id)
    .map((c) => {
      const s = suggestMethod(c);
      return { characteristicId: c.id, code: c.code, type: c.type, description: c.description, kind: c.kind, nominal: c.nominal, upperTol: c.upperTol, lowerTol: c.lowerTol, unit: c.unit, gdt: c.gdt, spec: c.spec, method: s.method, methodSuggested: s.method, sampleSize: s.sampleSize };
    });
  const planA: QcPlan = { id: 'QCP-0001', drawingId: SPOUT.drawingId, revisionId: revA.id, rev: 'A', partSku: SPOUT.partSku, status: 'approved', items, createdAt: at(-38, '12:00'), createdBy: DEMO_APPROVER, approvedBy: 'Arjun Mehta (QA Manager, demo)', approvedAt: at(-37), synthetic: true };
  state.plans.push(planA);

  const histValues: Record<string, (number | 'ok')[]> = {
    C01: [118.04, 117.95, 118.11, 118.02, 117.9],
    C02: [18.03, 17.98, 18.01, 18.04, 17.96],
    C03: [60.12, 59.9, 60.04, 60.18, 59.97],
    C04: [40.08, 39.95, 40.1, 40.02, 39.88],
    C05: ['ok', 'ok', 'ok', 'ok', 'ok'],
    C06: [10.8, 11.6, 9.9],
    C07: [0.03],
    C08: [0.28],
  };
  const ms: Measurement[] = items.flatMap((it) =>
    Array.from({ length: it.sampleSize }, (_, i) => {
      const value = histValues[it.code]?.[i];
      const r = evaluate(it, value, { planApproved: true, revisionApproved: true });
      return { code: it.code, characteristicId: it.characteristicId, sample: i + 1, value, ...r };
    }),
  );
  const hist: Inspection = {
    id: 'INS-0001',
    planId: planA.id,
    drawingId: SPOUT.drawingId,
    revisionId: revA.id,
    rev: 'A',
    partSku: SPOUT.partSku,
    batch: 'SP220-B2609-07',
    inspector: DEMO_INSPECTOR,
    status: 'completed',
    measurements: ms,
    comments: 'C07 perpendicularity checked on CMM by QE — within 0.03; recorded as reviewed.',
    attachmentIds: [],
    overall: overallResult(ms),
    issueIds: [],
    createdAt: at(-20, '08:40'),
    completedAt: at(-20, '10:05'),
    synthetic: true,
  };
  state.inspections.push(hist);

  // DRW-0002 — real 2-page PDF, awaiting review, no simulated extraction available
  addFile('FILE-0002', 'CH-35_cartridge_housing_RevA.pdf', 'application/pdf', cartridgePdf(addDays(today, -6)), at(-6));
  state.drawings.push({ id: 'DRW-0002', partSku: 'OEM-CH-35', partName: 'CH-35 Cartridge housing', customer: 'Nordbad Fixtures (demo OEM)', material: 'Brass CW614N', createdAt: at(-6), synthetic: true });
  state.revisions.push({
    id: 'DRW-0002-A',
    drawingId: 'DRW-0002',
    rev: 'A',
    fileId: 'FILE-0002',
    fileName: 'CH-35_cartridge_housing_RevA.pdf',
    format: 'pdf',
    mime: 'application/pdf',
    size: blobs['FILE-0002'].length,
    source: 'manual',
    uploadedAt: at(-6, '14:20'),
    status: 'awaiting_review',
    workOrderId: 'WO-1016',
    synthetic: true,
  });

  // DRW-0003 — STEP CAD file: metadata only, no in-browser preview
  addFile('FILE-0003', 'AR-16_aerator_insert.step', 'application/step', aeratorStep(), at(-3));
  state.drawings.push({ id: 'DRW-0003', partSku: 'OEM-AR-16', partName: 'AR-16 Aerator insert M24×1', customer: DEMO_OEM, material: 'POM + stainless mesh', createdAt: at(-3), synthetic: true });
  state.revisions.push({
    id: 'DRW-0003-A',
    drawingId: 'DRW-0003',
    rev: 'A',
    fileId: 'FILE-0003',
    fileName: 'AR-16_aerator_insert.step',
    format: 'step',
    mime: 'application/step',
    size: blobs['FILE-0003'].length,
    source: 'folder',
    sourceMeta: { connector: 'Shared Engineering Folder (demo connector)', sender: '\\\\eng-share\\inbound\\aqualine (demo)', receivedAt: at(-3) },
    uploadedAt: at(-3, '16:45'),
    status: 'awaiting_review',
    synthetic: true,
  });

  return { state, blobs };
}

/** Measurements the guided demo enters for the Rev B inspection: all pass except one C01 sample above USL. */
export const DEMO_MEASUREMENTS: Record<string, (number | 'ok')[]> = {
  C01: [120.05, 120.12, 120.34, 119.96, 120.08],
  C02: [18.02, 17.97, 18.05, 18.01, 17.99],
  C03: [60.1, 59.88, 60.05, 60.21, 59.95],
  C04: [42.1, 41.92, 42.05, 41.98, 42.12],
  C05: ['ok', 'ok', 'ok', 'ok', 'ok'],
  C06: [11.2, 10.4, 12.1],
  C07: [0.03],
  C08: [0.32],
};
