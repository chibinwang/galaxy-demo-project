import { boxFaces, pts, TONES, type Tone } from './iso';

interface Props {
  u: number;
  v: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  tone: Tone;
  panel?: 'u' | 'v';
  glow?: boolean;
  liquid?: boolean;
  /** Override the top colour (e.g. status tint). */
  topFill?: string;
}

/** Extruded isometric box — the building block of the scene. */
export function IsoBox({ u, v, z = 0, w, d, h, tone, panel, glow, liquid, topFill }: Props) {
  const f = boxFaces(u, v, z, w, d, h);
  const [top, right, left] = TONES[tone];
  const edge = 'rgba(15,23,42,0.08)';
  return (
    <g>
      <polygon points={f.left} fill={left} stroke={edge} strokeWidth={0.6} />
      <polygon points={f.right} fill={right} stroke={edge} strokeWidth={0.6} />
      <polygon points={f.top} fill={topFill ?? top} stroke={edge} strokeWidth={0.6} />
      {panel && <Panel u={u} v={v} z={z} w={w} d={d} h={h} face={panel} glow={glow} />}
      {liquid && (
        <polygon
          points={pts([
            [u + 4, v + 4, z + h - 3],
            [u + w - 4, v + 4, z + h - 3],
            [u + w - 4, v + d - 4, z + h - 3],
            [u + 4, v + d - 4, z + h - 3],
          ])}
          fill="#8fbfe0"
          opacity={0.9}
        />
      )}
    </g>
  );
}

function Panel({ u, v, z, w, d, h, face, glow }: { u: number; v: number; z: number; w: number; d: number; h: number; face: 'u' | 'v'; glow?: boolean }) {
  const z0 = z + h * 0.35;
  const z1 = z + h * 0.8;
  const corners: [number, number, number][] =
    face === 'v'
      ? [
          [u + w * 0.18, v + d, z0],
          [u + w * 0.82, v + d, z0],
          [u + w * 0.82, v + d, z1],
          [u + w * 0.18, v + d, z1],
        ]
      : [
          [u + w, v + d * 0.18, z0],
          [u + w, v + d * 0.82, z0],
          [u + w, v + d * 0.82, z1],
          [u + w, v + d * 0.18, z1],
        ];
  return <polygon points={pts(corners)} fill={glow ? 'url(#furnaceGlow)' : '#3b4757'} opacity={glow ? 1 : 0.85} />;
}

/** Flat quad at height z (used for platform tops, lanes, highlights). */
export function IsoRect({ u, v, z = 0, w, d, ...rest }: { u: number; v: number; z?: number; w: number; d: number } & Omit<React.SVGProps<SVGPolygonElement>, 'u' | 'v' | 'z' | 'w' | 'd' | 'points'>) {
  return (
    <polygon
      points={pts([
        [u, v, z],
        [u + w, v, z],
        [u + w, v + d, z],
        [u, v + d, z],
      ])}
      {...rest}
    />
  );
}

