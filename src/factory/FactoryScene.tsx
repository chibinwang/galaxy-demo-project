import clsx from 'clsx';
import { Boxes, Cog, Disc3, Droplets, Flame, Package, PackageCheck, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { iso, pts } from './iso';
import { FactoryGap } from './FactoryFlow';
import { FactoryZone, zoneColor } from './FactoryZone';
import { center, gaps, PITCH, SIZE } from './layout';
import type { FactoryModel, Zone, ZoneId } from './model';

export const VIEWBOX = { x: -780, y: -175, w: 1560, h: 1075 };
const toPct = (x: number, y: number) => ({ left: `${((x - VIEWBOX.x) / VIEWBOX.w) * 100}%`, top: `${((y - VIEWBOX.y) / VIEWBOX.h) * 100}%` });

const ICON: Record<ZoneId, LucideIcon> = {
  raw: Boxes,
  forging: Flame,
  machining: Cog,
  polishing: Disc3,
  plating: Droplets,
  assembly: Wrench,
  packing: Package,
  finished: PackageCheck,
  dispatch: Truck,
};

const fmt = (n: number) => n.toLocaleString('en-IN');

interface SceneProps {
  model: FactoryModel;
  selected: ZoneId | null;
  hovered: ZoneId | null;
  showFlow: boolean;
  focusIssues: boolean;
  animate: boolean;
  onSelect: (id: ZoneId) => void;
  onHover: (id: ZoneId | null) => void;
  /** HTML labels scale with the rendered scene width so they stay proportionate on small screens. */
  labelScale: number;
}

/** Zones whose condition is fine are dimmed in "focus on issues" mode. */
function isQuiet(z: Zone) {
  return z.kind === 'illustrative' || (!z.isBottleneck && z.condition === 'normal');
}

export function FactoryScene({ model, selected, hovered, showFlow, focusIssues, animate, onSelect, onHover, labelScale }: SceneProps) {
  const gapList = useMemo(gaps, []);
  const finishedFill = model.finishedTarget > 0 ? model.finishedOutput / model.finishedTarget : 0;

  // Painter's algorithm: zones and conveyor gaps drawn back-to-front by depth (u + v).
  const items = useMemo(() => {
    const zoneItems = model.zones.map((z) => {
      const [cu, cv] = center(z.id);
      return { depth: cu + cv, key: z.id, zone: z };
    });
    const gapItems = gapList.map((g, i) => ({ depth: g.belt.u + g.belt.w / 2 + g.belt.v + g.belt.d / 2, key: `gap-${i}`, gap: g, seg: model.segments[i] }));
    return [...zoneItems, ...gapItems].sort((a, b) => a.depth - b.depth);
  }, [model, gapList]);

  const extent = PITCH * 2 + SIZE;
  const floor = pts([
    [-70, -70, 0],
    [extent + 70, -70, 0],
    [extent + 70, extent + 70, 0],
    [-70, extent + 70, 0],
  ]);
  const gridLines = [];
  for (let t = -70; t <= extent + 70; t += 80) {
    gridLines.push(pts([[t, -70, 0], [t, extent + 70, 0]]), pts([[-70, t, 0], [extent + 70, t, 0]]));
  }

  return (
    <div className="relative w-full" style={{ aspectRatio: `${VIEWBOX.w} / ${VIEWBOX.h}` }}>
      <svg viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`} className="absolute inset-0 h-full w-full select-none" role="img" aria-label="Conceptual isometric layout of the production stages">
        <defs>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <linearGradient id="furnaceGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffb547" />
            <stop offset="100%" stopColor="#f0642a" />
          </linearGradient>
          <radialGradient id="floorFade" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#f3f5f8" />
            <stop offset="100%" stopColor="#e9ecf1" />
          </radialGradient>
        </defs>
        <polygon points={floor} fill="url(#floorFade)" />
        {gridLines.map((p, i) => (
          <polyline key={i} points={p} stroke="#dfe3e9" strokeWidth={0.8} fill="none" />
        ))}
        {items.map((it) =>
          'zone' in it && it.zone ? (
            <FactoryZone
              key={it.key}
              zone={it.zone}
              selected={selected === it.zone.id}
              hovered={hovered === it.zone.id}
              dimmed={(focusIssues && isQuiet(it.zone)) || (selected !== null && selected !== it.zone.id && hovered !== it.zone.id)}
              showFlow={showFlow}
              finishedFill={finishedFill}
              onSelect={onSelect}
              onHover={onHover}
            />
          ) : 'gap' in it && it.gap && it.seg ? (
            <FactoryGap key={it.key} gap={it.gap} seg={it.seg} showFlow={showFlow} animate={animate} dimmed={focusIssues && !it.seg.intoBottleneck} />
          ) : null,
        )}
      </svg>

      {/* WIP badges for significant queues */}
      {gapList.map((g, i) => {
        const seg = model.segments[i];
        if (!seg || seg.queue <= 0 || (!seg.intoBottleneck && seg.queueDays < 1.5)) return null;
        const [x, y] = iso(g.pile.u + 30, g.pile.v + 30, 52);
        return (
          <div key={`wip-${i}`} className="pointer-events-none absolute" style={{ ...toPct(x, y), transform: `translate(-50%, -100%) scale(${labelScale})`, transformOrigin: '50% 100%' }}>
            <div className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap shadow-sm ring-1', seg.intoBottleneck ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-700 ring-slate-200')}>
              {fmt(seg.queue)} waiting · {seg.queueDays}d
            </div>
          </div>
        );
      })}

      {/* zone label cards */}
      {model.zones.map((z) => {
        const [cu, cv] = center(z.id);
        const [x, y] = iso(cu - 70, cv - 70, 105);
        const Icon = ICON[z.id];
        const active = selected === z.id || hovered === z.id;
        const faded = (selected !== null && !active) || (focusIssues && isQuiet(z) && !active);
        const color = zoneColor(z);
        return (
          <div key={z.id} className="absolute" style={{ ...toPct(x, y), zIndex: active ? 20 : 10, transform: `translate(-50%, -100%) scale(${labelScale})`, transformOrigin: '50% 100%' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(z.id);
              }}
              onMouseEnter={() => onHover(z.id)}
              onMouseLeave={() => onHover(null)}
              className={clsx(
                'flex items-start gap-2 rounded-xl border bg-white/95 px-2.5 py-2 text-left shadow-[0_4px_14px_rgba(15,23,42,0.08)] backdrop-blur transition-all duration-200',
                active ? '-translate-y-1 border-amber-300 shadow-[0_10px_24px_rgba(15,23,42,0.14)]' : 'border-white',
                faded && 'opacity-50',
              )}
              aria-pressed={selected === z.id}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1f` }}>
                <Icon className="h-4 w-4" style={{ color: z.kind === 'illustrative' ? '#64748b' : color === '#fab219' ? '#b45309' : color }} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] leading-tight font-semibold whitespace-nowrap text-slate-900">{z.name}</span>
                {z.kind === 'stage' ? (
                  <>
                    <span className="num block text-[11px] whitespace-nowrap text-slate-600">
                      {z.condition === 'no_data' ? 'No report' : `${fmt(z.day.goodQty)} / ${fmt(z.day.target)}`}
                      {z.condition !== 'no_data' && <span className="text-slate-400"> · {z.day.attainmentPct}%</span>}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap" style={{ color: color === '#fab219' ? '#b45309' : color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {z.statusLabel}
                    </span>
                    {active && z.condition !== 'no_data' && (
                      <span className="num mt-1 block border-t border-slate-100 pt-1 text-[10px] whitespace-nowrap text-slate-500">
                        Rej {z.day.rejectRatePct}% · Down {z.day.downtimeMin}m{z.day.queueBefore > 0 ? ` · ${fmt(z.day.queueBefore)} waiting` : ''}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="block text-[10px] whitespace-nowrap text-slate-400">{z.id === 'finished' && model.hasData ? `${fmt(model.finishedOutput)} packed · illustrative` : 'Illustrative zone'}</span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
