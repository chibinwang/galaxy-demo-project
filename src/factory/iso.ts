/*
 * Isometric projection helpers for the Factory View.
 * World space: u runs to the screen's lower-right, v to the lower-left, z is up.
 */

export const COS30 = 0.866;

export function iso(u: number, v: number, z = 0): [number, number] {
  return [(u - v) * COS30, (u + v) * 0.5 - z];
}

export const pts = (corners: [number, number, number][]) =>
  corners
    .map(([u, v, z]) => iso(u, v, z))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

/** Visible faces of an axis-aligned box: top, the +u face (screen right) and the +v face (screen left). */
export function boxFaces(u: number, v: number, z: number, w: number, d: number, h: number) {
  const t = z + h;
  return {
    top: pts([
      [u, v, t],
      [u + w, v, t],
      [u + w, v + d, t],
      [u, v + d, t],
    ]),
    right: pts([
      [u + w, v, z],
      [u + w, v + d, z],
      [u + w, v + d, t],
      [u + w, v, t],
    ]),
    left: pts([
      [u, v + d, z],
      [u + w, v + d, z],
      [u + w, v + d, t],
      [u, v + d, t],
    ]),
  };
}

export type Tone = 'platform' | 'machine' | 'steel' | 'dark' | 'yellow' | 'brass' | 'tank' | 'carton' | 'crate' | 'wip' | 'belt';

/** [top, right face, left face] — light from the upper right. */
export const TONES: Record<Tone, [string, string, string]> = {
  platform: ['#fbfbfc', '#e4e7ec', '#d5d9e0'],
  machine: ['#ffffff', '#e8ebf0', '#d3d8df'],
  steel: ['#d9dde3', '#bfc5ce', '#a9b0bb'],
  dark: ['#55606f', '#3d4756', '#2c3440'],
  yellow: ['#f8c64a', '#e9ab1f', '#cf9212'],
  brass: ['#e2bf6e', '#c9a14c', '#b08838'],
  tank: ['#cfd6de', '#b4bdc8', '#9ea8b5'],
  carton: ['#e3c595', '#cfac77', '#b99462'],
  crate: ['#ead9b8', '#d6c19a', '#c2ab83'],
  wip: ['#f7c35c', '#e3a73a', '#c98d27'],
  belt: ['#e9ecf0', '#c9ced6', '#b7bdc7'],
};

/** Status colours (reserved; always shown with a text label). */
export const STATUS_COLOR = {
  normal: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  no_data: '#94a3b8',
  illustrative: '#94a3b8',
  bottleneck: '#f59e0b',
} as const;
