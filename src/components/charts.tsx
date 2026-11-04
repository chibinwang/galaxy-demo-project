import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { SeriesPoint } from '../../shared/calc';
import { fmtDate, fmtShortDate } from '../../shared/dates';
import { fmtN } from './ui';

const AXIS = { fontSize: 11, fill: '#64748b' };
const SERIES_1 = '#2a78d6';
const TARGET = '#94a3b8';

function OutputTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as SeriesPoint;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-900">{fmtDate(p.date, true)}</div>
      <div className="flex items-center gap-2 text-slate-700">
        <span className="h-2 w-2 rounded-sm" style={{ background: SERIES_1 }} /> Finished output <b className="num ml-auto pl-3">{fmtN(p.finished)}</b>
      </div>
      <div className="flex items-center gap-2 text-slate-700">
        <span className="h-0.5 w-2" style={{ background: TARGET }} /> Plan <b className="num ml-auto pl-3">{fmtN(p.target)}</b>
      </div>
      {p.target > 0 && <div className="mt-1 text-slate-500">Attainment {p.attainmentPct}%</div>}
    </div>
  );
}

/** Finished output (Packing) per day with the daily plan as a dashed reference line. */
export function OutputChart({ data, height = 240, onSelect, selected }: { data: SeriesPoint[]; height?: number; onSelect?: (d: string) => void; selected?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} onClick={(s) => onSelect && s?.activeLabel && onSelect(String(s.activeLabel))}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} width={44} />
        <Tooltip content={<OutputTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
        <Bar
          dataKey="finished"
          name="Finished output"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          fill={SERIES_1}
          cursor={onSelect ? 'pointer' : undefined}
          isAnimationActive={false}
        >
          {data.map((p) => (
            <Cell key={p.date} fill={SERIES_1} fillOpacity={selected && p.date !== selected ? 0.45 : 1} />
          ))}
        </Bar>
        <Line dataKey="target" name="Plan" type="stepAfter" stroke={TARGET} strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SimpleTooltip({ active, payload, unit, label: name }: Partial<TooltipContentProps<number, string>> & { unit: string; label: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as SeriesPoint;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-900">{fmtDate(p.date, true)}</div>
      <div className="text-slate-700">
        {name}: <b className="num">{fmtN(Number(payload[0].value))}{unit}</b>
      </div>
    </div>
  );
}

/** Single-measure line (e.g. rejection %) — one series, one axis. */
export function MetricLine({ data, dataKey, unit, label, height = 180, limit }: { data: SeriesPoint[]; dataKey: keyof SeriesPoint; unit: string; label: string; height?: number; limit?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} unit={unit} />
        <Tooltip content={<SimpleTooltip unit={unit} label={label} />} cursor={{ stroke: '#cbd5e1' }} />
        {limit !== undefined && <Line dataKey={() => limit} stroke={TARGET} strokeDasharray="5 4" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />}
        <Line dataKey={dataKey} stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MetricBars({ data, dataKey, unit, label, height = 180 }: { data: SeriesPoint[]; dataKey: keyof SeriesPoint; unit: string; label: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} />
        <Tooltip content={<SimpleTooltip unit={unit} label={label} />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
        <Bar dataKey={dataKey} fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
