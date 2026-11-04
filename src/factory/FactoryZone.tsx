import { memo } from 'react';
import { iso, pts, STATUS_COLOR } from './iso';
import { IsoBox, IsoRect } from './IsoBox';
import { BEACON, FINISHED_SLOTS, lanes, origin, PLATFORM_H, PROPS, SIZE } from './layout';
import type { Zone } from './model';

interface Props {
  zone: Zone;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  showFlow: boolean;
  /** Finished-goods zone only: share of plan packed (0–1). */
  finishedFill?: number;
  onSelect: (id: Zone['id']) => void;
  onHover: (id: Zone['id'] | null) => void;
}

export function zoneColor(zone: Zone): string {
  if (zone.kind === 'illustrative') return STATUS_COLOR.illustrative;
  if (zone.isBottleneck) return STATUS_COLOR.bottleneck;
  return STATUS_COLOR[zone.condition];
}

/** One production area: platform, conveyor lanes, schematic equipment and a stage-status andon light. */
export const FactoryZone = memo(function FactoryZone({ zone, selected, hovered, dimmed, showFlow, finishedFill = 0, onSelect, onHover }: Props) {
  const [u0, v0] = origin(zone.id);
  const z = PLATFORM_H;
  const color = zoneColor(zone);
  const isStage = zone.kind === 'stage';
  const alert = isStage && (zone.isBottleneck || zone.condition === 'critical');
  const noData = isStage && zone.condition === 'no_data';

  const props = [...PROPS[zone.id]].sort((p, q) => (p.layer ?? 0) - (q.layer ?? 0) || p.a + p.w / 2 + p.b + p.d / 2 - (q.a + q.w / 2 + q.b + q.d / 2));
  const pallets = zone.id === 'finished' ? Math.round(Math.min(1, finishedFill) * FINISHED_SLOTS.length) : 0;
  const [bx, by] = iso(u0 + BEACON[0] + 2, v0 + BEACON[1] + 2, z + 72);

  return (
    <g
      className="factory-zone"
      style={{ opacity: dimmed ? 0.38 : 1, transition: 'opacity 300ms ease', cursor: 'pointer' }}
      onClick={() => onSelect(zone.id)}
      onMouseEnter={() => onHover(zone.id)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-label={`${zone.name}${isStage ? `: ${zone.statusLabel}` : ' (illustrative)'}`}
    >
      {/* soft ground shadow */}
      <polygon
        points={pts([
          [u0 + 10, v0 + 14, 0],
          [u0 + SIZE + 14, v0 + 14, 0],
          [u0 + SIZE + 14, v0 + SIZE + 18, 0],
          [u0 + 10, v0 + SIZE + 18, 0],
        ])}
        fill="#0f172a"
        opacity={0.09}
        filter="url(#softShadow)"
      />
      <g className="zone-lift" style={{ transform: hovered || selected ? 'translateY(-4px)' : undefined }}>
        <IsoBox u={u0} v={v0} w={SIZE} d={SIZE} h={z} tone="platform" />
        {/* status band along the visible platform edges */}
        {isStage && (
          <>
            <polygon points={pts([[u0, v0 + SIZE, z - 4], [u0 + SIZE, v0 + SIZE, z - 4], [u0 + SIZE, v0 + SIZE, z], [u0, v0 + SIZE, z]])} fill={color} opacity={0.9} />
            <polygon points={pts([[u0 + SIZE, v0, z - 4], [u0 + SIZE, v0 + SIZE, z - 4], [u0 + SIZE, v0 + SIZE, z], [u0 + SIZE, v0, z]])} fill={color} opacity={0.75} />
          </>
        )}

        {/* conveyor lanes with directional flow marks */}
        {lanes(zone.id).map((l, i) => (
          <g key={i}>
            <IsoRect u={u0 + l.a} v={v0 + l.b} z={z + 0.3} w={l.w} d={l.d} fill="#e7eaee" stroke="#d6dae0" strokeWidth={0.8} />
            {showFlow && (
              <polyline
                points={pts([
                  [u0 + l.from[0], v0 + l.from[1], z + 0.6],
                  [u0 + l.to[0], v0 + l.to[1], z + 0.6],
                ])}
                className="flow-dash"
                stroke={zone.kind === 'illustrative' ? '#cbd5e1' : '#f59e0b'}
                strokeWidth={2.4}
                strokeLinecap="round"
                fill="none"
                opacity={zone.kind === 'illustrative' ? 0.8 : 0.85}
              />
            )}
          </g>
        ))}

        {/* selection / hover outline and bottleneck pulse */}
        {(selected || hovered) && <IsoRect u={u0 - 3} v={v0 - 3} z={z + 0.4} w={SIZE + 6} d={SIZE + 6} fill="none" stroke="#f59e0b" strokeWidth={selected ? 3.5 : 2} strokeLinejoin="round" />}
        {alert && !selected && <IsoRect u={u0 - 6} v={v0 - 6} z={z + 0.4} w={SIZE + 12} d={SIZE + 12} fill="none" stroke={color} strokeWidth={3} className="zone-pulse" />}

        {/* schematic equipment */}
        <g opacity={noData ? 0.5 : 1}>
          {props.map((p, i) => (
            <IsoBox key={i} u={u0 + p.a} v={v0 + p.b} z={z + (p.z ?? 0)} w={p.w} d={p.d} h={p.h} tone={p.tone} panel={p.panel} glow={p.glow} liquid={p.liquid} />
          ))}
          {FINISHED_SLOTS.slice(0, pallets)
            .sort((p, q) => p[0] + p[1] - (q[0] + q[1]))
            .map(([a, b], i) => (
              <g key={`p${i}`}>
                <IsoBox u={u0 + a} v={v0 + b} z={z} w={40} d={36} h={5} tone="crate" />
                <IsoBox u={u0 + a + 3} v={v0 + b + 3} z={z + 5} w={34} d={30} h={26} tone="carton" />
              </g>
            ))}
        </g>

        {/* andon light — reflects the stage's reported status, not machine telemetry */}
        {isStage && (
          <g>
            <IsoBox u={u0 + BEACON[0]} v={v0 + BEACON[1]} z={z} w={4} d={4} h={66} tone="dark" />
            {alert && <circle cx={bx} cy={by} r={9} fill={color} className="beacon-pulse" />}
            <circle cx={bx} cy={by} r={6.5} fill={color} stroke="#fff" strokeWidth={1.5} />
          </g>
        )}
      </g>
    </g>
  );
});
