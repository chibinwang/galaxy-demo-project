import { Download } from 'lucide-react';
import type { DrawingRevision } from '../../shared/eng';
import { fileUrl, fmtBytes, useEng } from './data';
import { FormatChip } from './ui';

/*
 * MOCK preview for CAD formats (STEP / IGES / DWG / DXF …) that the browser cannot render.
 * This is a hand-drawn illustrative engineering sheet for demo purposes — it is NOT generated from the
 * uploaded file's geometry. Only the title-block text comes from the drawing's metadata.
 */

const INK = '#1e293b';
const DIM = '#334155';
const BLUE = '#2563eb';
const FONT = 'Helvetica, Arial, sans-serif';

function Balloon({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={10} fill={BLUE} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" fontFamily={FONT}>
        {n}
      </text>
    </g>
  );
}

/** Horizontal dimension with extension lines and arrowheads. */
function HDim({ x1, x2, y, ext, label }: { x1: number; x2: number; y: number; ext: number; label: string }) {
  return (
    <g stroke={DIM} strokeWidth={1}>
      <line x1={x1} y1={ext} x2={x1} y2={y - 6} />
      <line x1={x2} y1={ext} x2={x2} y2={y - 6} />
      <line x1={x1} y1={y} x2={x2} y2={y} markerStart="url(#mArr)" markerEnd="url(#mArr)" />
      <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fontSize={13} fill={INK} stroke="none" fontFamily={FONT}>
        {label}
      </text>
    </g>
  );
}

function VDim({ x, y1, y2, ext, label }: { x: number; y1: number; y2: number; ext: number; label: string }) {
  return (
    <g stroke={DIM} strokeWidth={1}>
      <line x1={ext} y1={y1} x2={x + 6} y2={y1} />
      <line x1={ext} y1={y2} x2={x + 6} y2={y2} />
      <line x1={x} y1={y1} x2={x} y2={y2} markerStart="url(#mArr)" markerEnd="url(#mArr)" />
      <text x={x - 6} y={(y1 + y2) / 2} textAnchor="middle" fontSize={13} fill={INK} stroke="none" fontFamily={FONT} transform={`rotate(-90 ${x - 6} ${(y1 + y2) / 2})`}>
        {label}
      </text>
    </g>
  );
}

/** Small honeycomb of mesh holes clipped to a circle (aerator screen). */
function Mesh({ cx, cy, r, step = 11, hole = 3.2 }: { cx: number; cy: number; r: number; step?: number; hole?: number }) {
  const dots = [];
  for (let row = -Math.ceil(r / step); row <= Math.ceil(r / step); row++) {
    for (let col = -Math.ceil(r / step); col <= Math.ceil(r / step); col++) {
      const x = cx + col * step + (row % 2 ? step / 2 : 0);
      const y = cy + row * step * 0.866;
      if ((x - cx) ** 2 + (y - cy) ** 2 < (r - hole) ** 2) dots.push(<circle key={`${row}:${col}`} cx={x} cy={y} r={hole} fill="none" stroke={DIM} strokeWidth={0.8} />);
    }
  }
  return <g>{dots}</g>;
}

export function MockCadPreview({ rev, width, zoom }: { rev: DrawingRevision; width: number; zoom: 'fit' | number }) {
  const { data } = useEng();
  const d = data?.drawings.find((x) => x.id === rev.drawingId);
  const w = zoom === 'fit' ? width - 32 : Math.round(1120 * zoom);
  const date = rev.uploadedAt.slice(0, 10);
  const title = (d?.customer ?? 'OEM CUSTOMER').replace(/\s*\(demo OEM\)/i, '').toUpperCase();

  const rows: [string, string][] = [
    ['Part No.', d?.partSku ?? '—'],
    ['Description', d?.partName ?? '—'],
    ['Material', d?.material ?? '—'],
    ['Drawing', `${rev.drawingId}  ·  Rev ${rev.rev}`],
    ['Source file', `${rev.fileName}`],
    ['Date', date],
  ];

  return (
    <div className="mx-auto" style={{ width: w }}>
      <div className="relative overflow-hidden bg-white shadow-[0_2px_12px_rgba(15,23,42,0.12)]">
        <svg viewBox="0 0 1120 760" className="block h-auto w-full select-none" role="img" aria-label={`Illustrative mock drawing preview for ${rev.fileName}`}>
          <defs>
            <pattern id="mHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="7" stroke={DIM} strokeWidth="1" />
            </pattern>
            <marker id="mArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L10,5 L0,9 z" fill={DIM} />
            </marker>
            <linearGradient id="mChrome" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7c8794" />
              <stop offset="0.18" stopColor="#e9eef3" />
              <stop offset="0.32" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#aab4bf" />
              <stop offset="0.72" stopColor="#f3f6f9" />
              <stop offset="1" stopColor="#6b7684" />
            </linearGradient>
            <radialGradient id="mTop" cx="0.4" cy="0.35" r="0.8">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.6" stopColor="#d5dbe2" />
              <stop offset="1" stopColor="#8f9aa6" />
            </radialGradient>
            <clipPath id="mLeftHalf">
              <rect x="150" y="150" width="150" height="260" />
            </clipPath>
            <clipPath id="mTopMesh">
              <circle cx="640" cy="300" r="96" />
            </clipPath>
            <clipPath id="mDetail">
              <circle cx="935" cy="470" r="72" />
            </clipPath>
          </defs>

          {/* sheet borders & zone markers */}
          <rect x="0" y="0" width="1120" height="760" fill="#fff" />
          <rect x="14" y="14" width="1092" height="732" fill="none" stroke={INK} strokeWidth="1.2" />
          <rect x="28" y="28" width="1064" height="704" fill="none" stroke={INK} strokeWidth="2" />
          {[1, 2, 3, 4, 5, 6].map((n, i) => (
            <text key={n} x={28 + (i + 0.5) * (1064 / 6)} y="24" textAnchor="middle" fontSize="9" fill="#64748b" fontFamily={FONT}>
              {n}
            </text>
          ))}
          {['A', 'B', 'C', 'D'].map((l, i) => (
            <text key={l} x="21" y={28 + (i + 0.5) * (704 / 4)} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily={FONT}>
              {l}
            </text>
          ))}

          {/* ---------- SECTION A-A (half section) ---------- */}
          <line x1="300" y1="160" x2="300" y2="400" stroke="#94a3b8" strokeDasharray="14 4 3 4" />
          {/* hatched wall, left half only */}
          <path d="M180 200 H420 V280 L410 290 V360 H190 V290 L180 280 Z M206 216 H394 V344 H206 Z" fill="url(#mHatch)" fillRule="evenodd" clipPath="url(#mLeftHalf)" />
          <path d="M180 200 H420 V280 L410 290 V360 H190 V290 L180 280 Z" fill="none" stroke={INK} strokeWidth="2" />
          <rect x="206" y="216" width="188" height="128" fill="none" stroke={INK} strokeWidth="1.6" />
          {/* thread flanks */}
          <path d="M180 204 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6" fill="none" stroke={INK} strokeWidth="1.2" />
          <path d="M420 204 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6 l7 6 l-7 6" fill="none" stroke={INK} strokeWidth="1.2" />
          {/* mesh screens */}
          {[246, 274, 302].map((y) => (
            <g key={y}>
              <line x1="206" y1={y} x2="394" y2={y} stroke={DIM} strokeWidth="2.4" strokeDasharray="2 3" />
            </g>
          ))}
          <rect x="226" y="320" width="148" height="14" rx="3" fill="#e2e8f0" stroke={INK} strokeWidth="1" />
          {/* detail B marker */}
          <circle cx="420" cy="236" r="26" fill="none" stroke={BLUE} strokeWidth="1.2" strokeDasharray="5 3" />
          <text x="452" y="216" fontSize="13" fontWeight="700" fill={BLUE} fontFamily={FONT}>
            B
          </text>

          <HDim x1={180} x2={420} y={168} ext={196} label="Ø24 ±0.05" />
          <VDim x={466} y1={200} y2={360} ext={424} label="16 ±0.10" />
          <HDim x1={206} x2={394} y={392} ext={348} label="Ø20 ±0.05" />
          <g stroke={DIM} strokeWidth="1" fill="none">
            <line x1="176" y1="240" x2="120" y2="284" />
            <line x1="120" y1="284" x2="78" y2="284" />
          </g>
          <text x="78" y="278" fontSize="13" fill={INK} fontFamily={FONT}>
            M24×1 – 6g
          </text>
          <Balloon x={156} y={168} n={1} />
          <Balloon x={466} y={182} n={2} />
          <Balloon x={300} y={420} n={3} />
          <Balloon x={66} y={300} n={4} />
          <text x="300" y="458" textAnchor="middle" fontSize="14" fontWeight="700" fill={INK} fontFamily={FONT}>
            SECTION A-A
          </text>

          {/* ---------- TOP VIEW ---------- */}
          <line x1="500" y1="300" x2="780" y2="300" stroke="#94a3b8" strokeDasharray="14 4 3 4" />
          <line x1="640" y1="160" x2="640" y2="440" stroke="#94a3b8" strokeDasharray="14 4 3 4" />
          <circle cx="640" cy="300" r="120" fill="none" stroke={INK} strokeWidth="2" />
          <circle cx="640" cy="300" r="112" fill="none" stroke={DIM} strokeWidth="0.8" strokeDasharray="4 3" />
          <circle cx="640" cy="300" r="100" fill="none" stroke={INK} strokeWidth="1.6" />
          <g clipPath="url(#mTopMesh)">
            <Mesh cx={640} cy={300} r={96} />
          </g>
          <circle cx="640" cy="300" r="16" fill="#fff" stroke={INK} strokeWidth="1.6" />
          {/* cutting plane A-A */}
          <g stroke={INK} strokeWidth="2.2">
            <line x1="500" y1="300" x2="516" y2="300" />
            <line x1="764" y1="300" x2="780" y2="300" />
          </g>
          <path d="M508 300 V276" stroke={INK} strokeWidth="1.6" markerEnd="url(#mArr)" />
          <path d="M772 300 V276" stroke={INK} strokeWidth="1.6" markerEnd="url(#mArr)" />
          <text x="498" y="270" fontSize="14" fontWeight="700" fill={INK} fontFamily={FONT}>
            A
          </text>
          <text x="770" y="270" fontSize="14" fontWeight="700" fill={INK} fontFamily={FONT}>
            A
          </text>
          <g stroke={DIM} strokeWidth="1" fill="none">
            <line x1="711" y1="229" x2="760" y2="190" />
            <line x1="760" y1="190" x2="800" y2="190" />
          </g>
          <text x="764" y="184" fontSize="13" fill={INK} fontFamily={FONT}>
            Ø20 mesh 60
          </text>
          <text x="640" y="458" textAnchor="middle" fontSize="14" fontWeight="700" fill={INK} fontFamily={FONT}>
            TOP VIEW
          </text>

          {/* ---------- ISOMETRIC RENDER ---------- */}
          <ellipse cx="948" cy="262" rx="92" ry="20" fill="#0f172a" opacity="0.08" />
          <path d="M870 120 V230 A78 26 0 0 0 1026 230 V120 Z" fill="url(#mChrome)" stroke="#475569" strokeWidth="1" />
          {[134, 146, 158, 170, 182].map((y) => (
            <path key={y} d={`M870 ${y} A78 26 0 0 0 1026 ${y}`} fill="none" stroke="#64748b" strokeWidth="0.8" opacity="0.6" />
          ))}
          <ellipse cx="948" cy="120" rx="78" ry="26" fill="url(#mTop)" stroke="#475569" strokeWidth="1" />
          <ellipse cx="948" cy="120" rx="62" ry="20" fill="#cbd5e1" stroke="#64748b" strokeWidth="1" />
          <g transform="translate(948 120) scale(1 0.33) translate(-948 -120)">
            <clipPath id="mIsoMesh">
              <circle cx="948" cy="120" r="58" />
            </clipPath>
            <g clipPath="url(#mIsoMesh)">
              <Mesh cx={948} cy={120} r={58} step={9} hole={2.4} />
            </g>
          </g>
          <text x="948" y="296" textAnchor="middle" fontSize="12" fill="#64748b" fontFamily={FONT}>
            ISOMETRIC VIEW (not to scale)
          </text>

          {/* ---------- DETAIL B ---------- */}
          <circle cx="935" cy="470" r="72" fill="#fff" stroke={BLUE} strokeWidth="1.4" />
          <g clipPath="url(#mDetail)">
            <rect x="860" y="398" width="60" height="150" fill="url(#mHatch)" />
            <path d="M920 398 l26 15 l-26 15 l26 15 l-26 15 l26 15 l-26 15 l26 15 l-26 15 l26 15 l-26 15 V548 H860 V398 Z" fill="none" stroke={INK} strokeWidth="1.8" />
          </g>
          <text x="946" y="455" fontSize="12" fill={INK} fontFamily={FONT}>
            60°
          </text>
          <text x="946" y="495" fontSize="12" fill={INK} fontFamily={FONT}>
            P 1.0
          </text>
          <text x="935" y="560" textAnchor="middle" fontSize="13" fontWeight="700" fill={BLUE} fontFamily={FONT}>
            DETAIL B (4:1)
          </text>

          {/* ---------- notes ---------- */}
          <g fontFamily={FONT} fill={INK}>
            <text x="48" y="600" fontSize="13" fontWeight="700">
              NOTES
            </text>
            <text x="48" y="622" fontSize="12">
              1. Material: {d?.material ?? 'see title block'}
            </text>
            <text x="48" y="642" fontSize="12">
              2. Mesh screens: 3 layers, stainless 60 mesh, press-fit.
            </text>
            <text x="48" y="662" fontSize="12">
              3. Unless otherwise specified: dimensions in millimetres.
            </text>
            <text x="48" y="682" fontSize="12">
              4. General tolerances ISO 2768-m. Remove all burrs.
            </text>
            <text x="48" y="702" fontSize="12">
              5. Thread M24×1 – 6g, check with ring gauge.
            </text>
          </g>

          {/* ---------- title block ---------- */}
          <g fontFamily={FONT}>
            <rect x="640" y="590" width="452" height="142" fill="#fff" stroke={INK} strokeWidth="1.6" />
            <rect x="640" y="590" width="452" height="34" fill="#f8fafc" stroke={INK} strokeWidth="1.6" />
            <text x="866" y="613" textAnchor="middle" fontSize="17" fontWeight="800" fill={INK} letterSpacing="1">
              {title}
            </text>
            {rows.map(([k, v], i) => (
              <g key={k}>
                <line x1="640" y1={624 + i * 18} x2="1092" y2={624 + i * 18} stroke="#94a3b8" strokeWidth="0.8" />
                <text x="648" y={637 + i * 18} fontSize="10.5" fill="#475569">
                  {k}
                </text>
                <text x="752" y={637 + i * 18} fontSize="10.5" fill={INK} fontWeight={i === 0 ? 700 : 400}>
                  {v.length > 52 ? `${v.slice(0, 51)}…` : v}
                </text>
              </g>
            ))}
            <line x1="744" y1="624" x2="744" y2="732" stroke="#94a3b8" strokeWidth="0.8" />
            <text x="1084" y="727" textAnchor="end" fontSize="9.5" fill="#64748b">
              SCALE 2:1 · SHEET 1/1 · A3
            </text>
          </g>
        </svg>
        <div className="pointer-events-none absolute top-[5%] left-[4%] inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-[11px] font-medium text-amber-900 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Illustrative mock preview for demo — not rendered from the .{rev.format} file
        </div>
      </div>
      {rev.fileId && (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
          <FormatChip format={rev.format} /> {rev.fileName} · {fmtBytes(rev.size)}
          <a href={fileUrl(rev.fileId, true)} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline">
            <Download className="h-3.5 w-3.5" /> Download original
          </a>
        </div>
      )}
    </div>
  );
}
