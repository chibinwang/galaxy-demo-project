import type { Tone } from './iso';
import type { ZoneId } from './model';

/*
 * CONCEPTUAL floor layout. Positions, equipment and conveyors are schematic illustrations of the
 * configured stages — not Galaxy Taps' real floor plan, machine counts or connections.
 */

export const PITCH = 320; // grid spacing between zone origins (world units)
export const SIZE = 220; // platform edge length
export const PLATFORM_H = 14;
export const LANE = 24; // conveyor width
const MID = SIZE / 2;

/** Serpentine material route on a 3×3 grid. */
export const GRID: Record<ZoneId, [number, number]> = {
  raw: [0, 0],
  forging: [1, 0],
  machining: [2, 0],
  polishing: [2, 1],
  plating: [1, 1],
  assembly: [0, 1],
  packing: [0, 2],
  finished: [1, 2],
  dispatch: [2, 2],
};

export const ROUTE: ZoneId[] = ['raw', 'forging', 'machining', 'polishing', 'plating', 'assembly', 'packing', 'finished', 'dispatch'];

export const origin = (id: ZoneId): [number, number] => [GRID[id][0] * PITCH, GRID[id][1] * PITCH];
export const center = (id: ZoneId): [number, number] => {
  const [u, v] = origin(id);
  return [u + MID, v + MID];
};

type Side = 'u-' | 'u+' | 'v-' | 'v+';

/** Which platform edge the route enters from / leaves through. */
function sideTowards(from: ZoneId, to: ZoneId): Side {
  const [fx, fy] = GRID[from];
  const [tx, ty] = GRID[to];
  if (tx > fx) return 'u+';
  if (tx < fx) return 'u-';
  return ty > fy ? 'v+' : 'v-';
}

export interface Lane {
  a: number;
  b: number;
  w: number;
  d: number;
  /** Centreline in the direction of travel (local coords). */
  from: [number, number];
  to: [number, number];
}

/** Lane rectangles (local coords) from the entry edge to the centre and from the centre to the exit edge. */
export function lanes(id: ZoneId): Lane[] {
  const i = ROUTE.indexOf(id);
  const h = LANE / 2;
  const edge: Record<Side, [number, number]> = { 'u+': [SIZE, MID], 'u-': [0, MID], 'v+': [MID, SIZE], 'v-': [MID, 0] };
  const rect = (s: Side) =>
    s === 'u+'
      ? { a: MID - h, b: MID - h, w: SIZE - MID + h, d: LANE }
      : s === 'u-'
        ? { a: 0, b: MID - h, w: MID + h, d: LANE }
        : s === 'v+'
          ? { a: MID - h, b: MID - h, w: LANE, d: SIZE - MID + h }
          : { a: MID - h, b: 0, w: LANE, d: MID + h };
  const out: Lane[] = [];
  if (i > 0) {
    const s = sideTowards(id, ROUTE[i - 1]);
    out.push({ ...rect(s), from: edge[s], to: [MID, MID] });
  }
  if (i < ROUTE.length - 1) {
    const s = sideTowards(id, ROUTE[i + 1]);
    out.push({ ...rect(s), from: [MID, MID], to: edge[s] });
  }
  return out;
}

export interface Gap {
  from: ZoneId;
  to: ZoneId;
  /** Conveyor bridge between the two platforms (world coords). */
  belt: { u: number; v: number; w: number; d: number };
  /** Direction of travel along the belt. */
  axis: 'u' | 'v';
  sign: 1 | -1;
  /** Ground area beside the belt where WIP waiting for the next stage is drawn. */
  pile: { u: number; v: number };
}

export function gaps(): Gap[] {
  const out: Gap[] = [];
  const h = LANE / 2;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const from = ROUTE[i];
    const to = ROUTE[i + 1];
    const [fu, fv] = origin(from);
    const [tu, tv] = origin(to);
    if (fv === tv) {
      const u0 = Math.min(fu, tu) + SIZE;
      const len = Math.max(fu, tu) - u0;
      out.push({ from, to, axis: 'u', sign: tu > fu ? 1 : -1, belt: { u: u0, v: fv + MID - h, w: len, d: LANE }, pile: { u: u0 + 8, v: fv + MID + h + 10 } });
    } else {
      const v0 = Math.min(fv, tv) + SIZE;
      const len = Math.max(fv, tv) - v0;
      out.push({ from, to, axis: 'v', sign: tv > fv ? 1 : -1, belt: { u: fu + MID - h, v: v0, w: LANE, d: len }, pile: { u: fu + MID + h + 10, v: v0 + 8 } });
    }
  }
  return out;
}

export interface Prop {
  a: number;
  b: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  tone: Tone;
  /** Inset panel on a visible face: a machine window / control screen. */
  panel?: 'u' | 'v';
  /** Panel glows warm (furnace mouth). */
  glow?: boolean;
  /** Tank: draws a liquid surface on top. */
  liquid?: boolean;
  /** Draw order override: higher layers render later. */
  layer?: number;
}

const box = (a: number, b: number, w: number, d: number, h: number, tone: Tone, extra: Partial<Prop> = {}): Prop => ({ a, b, w, d, h, tone, ...extra });

/** Schematic equipment per zone, placed clear of the conveyor lanes. */
export const PROPS: Record<ZoneId, Prop[]> = {
  raw: [
    // storage racks with brass billet bundles
    ...[0, 34, 68].flatMap((z) => [box(18, 18, 150, 44, 4, 'steel', { z }), box(26, 24, 40, 30, 14, 'brass', { z: z + 4 }), box(78, 24, 40, 30, 14, 'brass', { z: z + 4 }), box(122, 24, 38, 30, 12, 'brass', { z: z + 4 })]),
    box(16, 16, 6, 6, 92, 'dark', { layer: 1 }),
    box(162, 16, 6, 6, 92, 'dark', { layer: 1 }),
    box(30, 146, 60, 40, 16, 'brass'),
    box(36, 152, 48, 28, 12, 'brass', { z: 16 }),
    box(140, 150, 50, 44, 26, 'yellow'), // forklift body (schematic)
    box(150, 156, 22, 26, 22, 'dark', { z: 26 }),
  ],
  forging: [
    box(16, 16, 56, 56, 26, 'steel'),
    box(26, 26, 36, 36, 52, 'yellow', { z: 26 }),
    box(18, 18, 52, 52, 18, 'dark', { z: 78 }),
    box(104, 18, 92, 64, 48, 'machine', { panel: 'v', glow: true }),
    box(118, 30, 20, 20, 30, 'steel', { z: 48 }),
    box(30, 148, 46, 42, 14, 'brass'),
    box(120, 150, 60, 34, 12, 'crate'),
  ],
  machining: [
    box(8, 16, 60, 64, 54, 'machine', { panel: 'v' }),
    box(78, 16, 60, 64, 54, 'machine', { panel: 'v' }),
    box(148, 16, 60, 64, 54, 'machine', { panel: 'v' }),
    box(28, 30, 18, 16, 10, 'yellow', { z: 54 }),
    box(98, 30, 18, 16, 10, 'yellow', { z: 54 }),
    box(168, 30, 18, 16, 10, 'yellow', { z: 54 }),
    box(26, 150, 40, 34, 28, 'dark'),
    box(146, 146, 58, 52, 50, 'machine', { panel: 'v' }),
  ],
  polishing: [
    box(18, 22, 58, 44, 32, 'machine', { panel: 'u' }),
    box(140, 18, 60, 32, 30, 'machine', { panel: 'v' }),
    box(140, 60, 60, 30, 30, 'machine', { panel: 'v' }),
    box(24, 162, 150, 18, 20, 'steel'),
    box(168, 138, 40, 40, 66, 'yellow'),
  ],
  plating: [
    box(10, 18, 46, 70, 30, 'tank', { liquid: true }),
    box(62, 18, 46, 70, 30, 'tank', { liquid: true }),
    box(114, 18, 46, 70, 30, 'tank', { liquid: true }),
    box(166, 18, 46, 70, 30, 'tank', { liquid: true }),
    box(6, 46, 8, 12, 78, 'yellow', { layer: 1 }),
    box(206, 46, 8, 12, 78, 'yellow', { layer: 1 }),
    box(6, 46, 208, 12, 10, 'yellow', { z: 78, layer: 2 }),
    box(96, 44, 22, 16, 22, 'dark', { z: 56, layer: 2 }),
    box(26, 146, 44, 34, 48, 'dark', { panel: 'u' }),
    box(116, 150, 66, 30, 22, 'steel'),
  ],
  assembly: [
    box(16, 26, 186, 36, 22, 'steel'),
    ...[30, 74, 118, 162].map((a) => box(a, 32, 20, 20, 10, 'brass', { z: 22 })),
    box(20, 148, 64, 34, 22, 'steel'),
    box(146, 144, 54, 54, 46, 'machine', { panel: 'v' }),
  ],
  packing: [
    box(18, 24, 64, 46, 22, 'steel'),
    box(28, 32, 26, 24, 18, 'carton', { z: 22 }),
    box(140, 22, 62, 52, 38, 'yellow', { panel: 'v' }),
    box(18, 138, 56, 52, 6, 'crate'),
    box(22, 142, 48, 44, 30, 'carton', { z: 6 }),
    box(146, 144, 56, 50, 6, 'crate'),
    box(150, 148, 48, 42, 24, 'carton', { z: 6 }),
  ],
  finished: [],
  dispatch: [
    box(26, 140, 120, 52, 58, 'machine'), // trailer (schematic)
    box(150, 144, 42, 44, 44, 'yellow', { panel: 'v' }), // cab
    box(28, 20, 54, 50, 6, 'crate'),
    box(32, 24, 46, 42, 30, 'carton', { z: 6 }),
  ],
};

/** Pallet slots in the finished-goods zone; how many are filled reflects packed output vs plan. */
export const FINISHED_SLOTS: [number, number][] = [
  [126, 18],
  [172, 18],
  [126, 56],
  [172, 56],
  [20, 140],
  [70, 140],
  [126, 140],
  [172, 140],
];

/** Andon light position (local coords) on each stage platform. */
export const BEACON: [number, number] = [198, 8];
