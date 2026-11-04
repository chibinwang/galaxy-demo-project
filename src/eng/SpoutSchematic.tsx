import type { Characteristic } from '../../shared/eng';

/*
 * ILLUSTRATIVE schematic of the seeded SP-220 spout drawing with interactive dimension callouts.
 * It is not the customer file and not parsed geometry: callout positions are hand-placed for the demo,
 * while the values shown come from the revision's (reviewed) characteristics.
 */

const AMBER = '#f59e0b';
const STATUS_DOT: Record<Characteristic['status'], string> = { extracted: '#94a3b8', confirmed: '#0ca30c', flagged: '#ec835a', clarification: '#8b5cf6' };

export function formatSpec(c?: Characteristic): string {
  if (!c) return '—';
  if (c.kind === 'attribute') return c.spec ?? c.description;
  if (c.gdt) return c.gdt;
  if (c.nominal == null) return '?';
  const dec = c.unit === 'mm' ? 2 : 1;
  const n = c.nominal.toFixed(dec);
  if (c.upperTol == null || c.lowerTol == null) return `${n} ${c.unit} (tol ?)`;
  if (Math.abs(c.upperTol + c.lowerTol) < 1e-9) return `${n} ±${c.upperTol.toFixed(dec)}`;
  return `${n} +${c.upperTol.toFixed(dec)}/${c.lowerTol.toFixed(dec)}`;
}

/** Region highlighted on the drawing for each callout. */
const REGIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  C01: { x: 78, y: 92, w: 526, h: 40 },
  C02: { x: 536, y: 352, w: 68, h: 66 },
  C03: { x: 705, y: 160, w: 170, h: 200 },
  C04: { x: 600, y: 190, w: 80, h: 196 },
  C05: { x: 76, y: 205, w: 34, h: 50 },
  C06: { x: 150, y: 188, w: 380, h: 24 },
  C07: { x: 536, y: 352, w: 200, h: 70 },
  C08: { x: 200, y: 252, w: 300, h: 20 },
};

export function SpoutSchematic({ chars, selected, onSelect, rev }: { chars: Characteristic[]; selected?: string | null; onSelect?: (code: string) => void; rev: string }) {
  const by = (code: string) => chars.find((c) => c.callout === code || c.code === code);
  const active = (code: string) => selected === code;

  const Label = ({ code, x, y, anchor = 'start' }: { code: string; x: number; y: number; anchor?: 'start' | 'middle' | 'end' }) => {
    const c = by(code);
    const text = `${code}  ${formatSpec(c)}`;
    const w = text.length * 6.6 + 18;
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    return (
      <g className="cursor-pointer" onClick={() => onSelect?.(code)} role="button" aria-label={`${code} ${c?.description ?? ''}`}>
        <rect x={x0} y={y - 13} width={w} height={20} rx={5} fill={active(code) ? AMBER : '#ffffff'} stroke={active(code) ? AMBER : '#cbd5e1'} />
        {c && <circle cx={x0 + 9} cy={y - 3} r={3.5} fill={STATUS_DOT[c.status]} />}
        <text x={x0 + 16} y={y + 1} fontSize={11.5} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={active(code) ? '#111827' : '#0f172a'} fontWeight={600}>
          {text}
        </text>
      </g>
    );
  };

  const line = (code: string) => (active(code) ? AMBER : '#334155');

  return (
    <svg viewBox="0 0 900 520" className="h-auto w-full select-none" role="img" aria-label="Illustrative annotated schematic of the SP-220 spout">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#94a3b8" strokeWidth="1.2" />
        </pattern>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#334155" />
        </marker>
        <marker id="arrA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={AMBER} />
        </marker>
      </defs>
      <rect x="0" y="0" width="900" height="520" fill="#fbfcfd" />
      {/* drawing grid */}
      {Array.from({ length: 18 }, (_, i) => (
        <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="520" stroke="#eef1f5" />
      ))}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 50} x2="900" y2={i * 50} stroke="#eef1f5" />
      ))}

      {/* highlighted region for the selected characteristic */}
      {selected && REGIONS[selected] && (
        <rect {...REGIONS[selected]} rx={8} fill={AMBER} opacity={0.14} stroke={AMBER} strokeDasharray="5 4" className="callout-pulse" />
      )}

      {/* wall + datum A */}
      <rect x="40" y="60" width="38" height="400" fill="url(#hatch)" stroke="#94a3b8" />
      <text x="44" y="480" fontSize="11" fill="#64748b">WALL · DATUM A</text>

      <g fill="none" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round">
        <rect x="78" y="150" width="26" height="240" fill="#fff" />
        <path d="M104 200 H555 Q600 200 600 245 V360 H540 V285 Q540 260 515 260 H104" fill="#fff" />
        <line x1="552" y1="300" x2="552" y2="360" strokeWidth="1" strokeDasharray="5 4" />
        <line x1="588" y1="300" x2="588" y2="360" strokeWidth="1" strokeDasharray="5 4" />
      </g>
      {/* inlet thread (zig-zag) */}
      <path d="M82 214 l8 5 l-8 5 l8 5 l-8 5 l8 5 l-8 5 l8 5 l-8 5" fill="none" stroke={line('C05')} strokeWidth="1.4" />
      <line x1="60" y1="230" x2="640" y2="230" stroke="#94a3b8" strokeDasharray="12 4 2 4" />
      <line x1="570" y1="180" x2="570" y2="400" stroke="#94a3b8" strokeDasharray="12 4 2 4" />

      {/* side view with C03 */}
      <text x="735" y="150" fontSize="11" fill="#64748b" fontWeight="600">SIDE VIEW</text>
      <circle cx="790" cy="280" r="75" fill="#fff" stroke="#0f172a" strokeWidth="2" />
      <circle cx="790" cy="280" r="24" fill="none" stroke={line('C05')} strokeWidth="1.6" />
      <circle cx="790" cy="280" r="19" fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
      <g stroke={line('C03')} strokeWidth="1.2">
        <line x1="715" y1="280" x2="715" y2="178" />
        <line x1="865" y1="280" x2="865" y2="178" />
        <line x1="717" y1="186" x2="863" y2="186" markerStart={`url(#${active('C03') ? 'arrA' : 'arr'})`} markerEnd={`url(#${active('C03') ? 'arrA' : 'arr'})`} />
      </g>
      <Label code="C03" x={790} y={176} anchor="middle" />

      {/* C01 — overall projection */}
      <g stroke={line('C01')} strokeWidth="1.2">
        <line x1="78" y1="150" x2="78" y2="100" />
        <line x1="600" y1="200" x2="600" y2="100" />
        <line x1="80" y1="112" x2="598" y2="112" markerStart={`url(#${active('C01') ? 'arrA' : 'arr'})`} markerEnd={`url(#${active('C01') ? 'arrA' : 'arr'})`} />
      </g>
      <Label code="C01" x={339} y={102} anchor="middle" />

      {/* C04 — drop height */}
      <g stroke={line('C04')} strokeWidth="1.2">
        <line x1="604" y1="200" x2="672" y2="200" />
        <line x1="604" y1="360" x2="672" y2="360" />
        <line x1="660" y1="202" x2="660" y2="358" markerStart={`url(#${active('C04') ? 'arrA' : 'arr'})`} markerEnd={`url(#${active('C04') ? 'arrA' : 'arr'})`} />
      </g>
      <Label code="C04" x={668} y={378} />

      {/* C02 — outlet bore */}
      <g stroke={line('C02')} strokeWidth="1.2">
        <line x1="552" y1="362" x2="552" y2="410" />
        <line x1="588" y1="362" x2="588" y2="410" />
        <line x1="554" y1="404" x2="586" y2="404" markerStart={`url(#${active('C02') ? 'arrA' : 'arr'})`} markerEnd={`url(#${active('C02') ? 'arrA' : 'arr'})`} />
      </g>
      <Label code="C02" x={548} y={446} anchor="middle" />

      {/* C07 — perpendicularity frame */}
      <g stroke={line('C07')} strokeWidth="1.2" fill="none">
        <line x1="600" y1="360" x2="612" y2="404" />
      </g>
      <Label code="C07" x={612} y={412} />

      {/* C05 — inlet thread leader */}
      <line x1="92" y1="240" x2="150" y2="300" stroke={line('C05')} strokeWidth="1.2" />
      <Label code="C05" x={110} y={318} />

      {/* C06 — plating note (top surface) */}
      <line x1="300" y1="200" x2="280" y2="170" stroke={line('C06')} strokeWidth="1.2" />
      <Label code="C06" x={150} y={166} />

      {/* C08 — roughness (bottom surface) */}
      <line x1="380" y1="262" x2="400" y2="282" stroke={line('C08')} strokeWidth="1.2" />
      <Label code="C08" x={360} y={300} />

      <g>
        <rect x="640" y="452" width="250" height="56" rx="6" fill="#fff" stroke="#cbd5e1" />
        <text x="652" y="472" fontSize="12" fontWeight="700" fill="#0f172a">
          SP-220 BATH SPOUT · REV {rev}
        </text>
        <text x="652" y="490" fontSize="10.5" fill="#64748b">
          Illustrative schematic — not to scale
        </text>
        <text x="652" y="502" fontSize="10.5" fill="#64748b">
          Values from reviewed characteristics
        </text>
      </g>
    </svg>
  );
}
