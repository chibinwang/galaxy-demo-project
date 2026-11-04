import { memo } from 'react';
import { boxFaces, iso, pts, TONES } from './iso';
import { IsoBox } from './IsoBox';
import { LANE, PLATFORM_H, type Gap } from './layout';
import type { FlowSegment } from './model';

/** Max WIP crates drawn per queue (4 along × 2 deep × 2 high). One day of plan ≈ 5 crates. */
const MAX_CRATES = 16;
const CRATES_PER_DAY = 5;

export function crateCount(seg: FlowSegment) {
  if (seg.queue <= 0) return 0;
  return Math.max(1, Math.min(MAX_CRATES, Math.round(seg.queueDays * CRATES_PER_DAY)));
}

/**
 * Conveyor bridge between two zones, with moving work packets (rate follows the source stage's
 * output vs plan) and a pile of crates representing WIP waiting for the next stage.
 * Motion is illustrative of daily flow — not live tracking.
 */
export const FactoryGap = memo(function FactoryGap({ gap, seg, showFlow, animate, dimmed }: { gap: Gap; seg: FlowSegment; showFlow: boolean; animate: boolean; dimmed: boolean }) {
  const { belt } = gap;
  const z = PLATFORM_H;
  const n = crateCount(seg);
  const crates = Array.from({ length: n }, (_, k) => {
    const layer = Math.floor(k / 8);
    const idx = k % 8;
    const along = idx % 4;
    const perp = Math.floor(idx / 4);
    const [du, dv] = gap.axis === 'u' ? [along * 21, perp * 21] : [perp * 21, along * 21];
    return { u: gap.pile.u + du, v: gap.pile.v + dv, z: layer * 14, layer };
  }).sort((a, b) => a.layer - b.layer || a.u + a.v - (b.u + b.v));

  // Belt centreline in the direction of travel
  const c = LANE / 2;
  const startU = gap.axis === 'u' ? (gap.sign > 0 ? belt.u : belt.u + belt.w) : belt.u + c;
  const endU = gap.axis === 'u' ? (gap.sign > 0 ? belt.u + belt.w : belt.u) : belt.u + c;
  const startV = gap.axis === 'v' ? (gap.sign > 0 ? belt.v : belt.v + belt.d) : belt.v + c;
  const endV = gap.axis === 'v' ? (gap.sign > 0 ? belt.v + belt.d : belt.v) : belt.v + c;
  // Packets are drawn at platform height around the origin, so the motion path runs at ground level.
  const [x0, y0] = iso(startU, startV, 0);
  const [x1, y1] = iso(endU, endV, 0);

  const packets = !showFlow || !animate || seg.intensity <= 0 ? 0 : seg.intensity >= 0.9 ? 3 : seg.intensity >= 0.5 ? 2 : 1;
  const dur = 2.4 / Math.max(0.35, seg.intensity);
  const cube = boxFaces(-5, -5, z, 10, 10, 8);
  const [ct, cr, cl] = seg.illustrative ? TONES.steel : TONES.wip;

  return (
    <g style={{ opacity: dimmed ? 0.38 : 1, transition: 'opacity 300ms ease' }}>
      {/* WIP pile beside the belt */}
      {crates.map((k, i) => (
        <IsoBox key={i} u={k.u} v={k.v} z={k.z} w={18} d={18} h={13} tone={seg.intoBottleneck ? 'wip' : 'crate'} />
      ))}
      <IsoBox u={belt.u} v={belt.v} w={belt.w} d={belt.d} h={z} tone="belt" />
      {showFlow && (
        <polyline
          points={pts([
            [startU, startV, z + 0.5],
            [endU, endV, z + 0.5],
          ])}
          className="flow-dash"
          stroke={seg.illustrative ? '#cbd5e1' : '#f59e0b'}
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
          opacity={seg.illustrative ? 0.8 : 0.35 + Math.min(1, seg.intensity) * 0.6}
        />
      )}
      {Array.from({ length: packets }, (_, i) => (
        <g key={i} opacity={0}>
          <polygon points={cube.left} fill={cl} />
          <polygon points={cube.right} fill={cr} />
          <polygon points={cube.top} fill={ct} />
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(i * dur) / packets}s`} path={`M ${x0} ${y0} L ${x1} ${y1}`} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur={`${dur}s`} repeatCount="indefinite" begin={`${(i * dur) / packets}s`} />
        </g>
      ))}
    </g>
  );
});
