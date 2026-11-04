import type { DayKpis } from '../../shared/calc';
import { SEVERITY_RANK } from '../../shared/constants';
import type { DetectedException, Severity, StageDay, StageId } from '../../shared/types';

/*
 * Adapter: maps the existing /api/overview snapshot into a visualization model.
 * It performs NO production calculations of its own — every figure is passed through from the
 * same server-side calculations the Analytics view uses. It only classifies and arranges them.
 */

export interface OverviewSnapshot {
  date: string;
  kpis: DayKpis;
  stages: StageDay[];
  bottleneck: { stage: StageId; queue: number; daysOfWork: number } | null;
  exceptions: DetectedException[];
}

export type ZoneId = 'raw' | StageId | 'finished' | 'dispatch';
export type Condition = 'normal' | 'warning' | 'critical' | 'no_data';

export interface StageZone {
  kind: 'stage';
  id: StageId;
  name: string;
  day: StageDay;
  condition: Condition;
  statusLabel: string;
  isBottleneck: boolean;
  /** Exceptions attributed to this stage (includes order-risk items currently sitting at this stage). */
  exceptions: DetectedException[];
  topSeverity: Severity | null;
}

export interface IllustrativeZone {
  kind: 'illustrative';
  id: 'raw' | 'finished' | 'dispatch';
  name: string;
  /** What, if anything, this zone shows from recorded data. */
  note: string;
}

export type Zone = StageZone | IllustrativeZone;

export interface FlowSegment {
  from: ZoneId;
  to: ZoneId;
  /** Relative flow, 0–1.2: the source stage's good output ÷ its plan. Illustrative segments use a fixed low value. */
  intensity: number;
  /** WIP waiting in front of the destination stage (units), when the destination is a stage. */
  queue: number;
  /** Queue expressed as days of the destination stage's plan. */
  queueDays: number;
  intoBottleneck: boolean;
  illustrative: boolean;
}

export interface FactoryModel {
  date: string;
  zones: Zone[];
  stageZones: StageZone[];
  segments: FlowSegment[];
  bottleneck: OverviewSnapshot['bottleneck'];
  finishedOutput: number;
  finishedTarget: number;
  attainmentPct: number;
  /** Stage zones needing attention, most severe first (bottleneck first). */
  attention: StageZone[];
  hasData: boolean;
}

/** Exception types that describe the condition of a stage itself (order risk and missing data do not). */
const CONDITION_TYPES = new Set(['shortfall', 'quality', 'downtime', 'bottleneck']);

const STATUS_LABEL: Record<Condition, string> = {
  normal: 'On plan',
  warning: 'Needs attention',
  critical: 'Critical',
  no_data: 'No report',
};

export function classifyStage(day: StageDay, exceptions: DetectedException[], shortfallPct: number): { condition: Condition; topSeverity: Severity | null } {
  if (day.target > 0 && day.entryCount === 0) return { condition: 'no_data', topSeverity: null };
  const relevant = exceptions.filter((e) => CONDITION_TYPES.has(e.type));
  const top = relevant.reduce<Severity | null>((best, e) => (!best || SEVERITY_RANK[e.severity] < SEVERITY_RANK[best] ? e.severity : best), null);
  if (top === 'critical') return { condition: 'critical', topSeverity: top };
  if (top || (day.target > 0 && day.attainmentPct < shortfallPct)) return { condition: 'warning', topSeverity: top };
  return { condition: 'normal', topSeverity: null };
}

const clampFlow = (v: number) => Math.max(0, Math.min(1.2, v));

export function buildFactoryModel(snap: OverviewSnapshot, shortfallPct: number): FactoryModel {
  const bnStage = snap.bottleneck?.stage ?? null;

  const stageZones: StageZone[] = snap.stages.map((day) => {
    const exceptions = snap.exceptions.filter((e) => e.stage === day.stage);
    const { condition, topSeverity } = classifyStage(day, exceptions, shortfallPct);
    const isBottleneck = day.stage === bnStage;
    return {
      kind: 'stage',
      id: day.stage,
      name: day.name,
      day,
      condition,
      statusLabel: isBottleneck ? 'Bottleneck' : STATUS_LABEL[condition],
      isBottleneck,
      exceptions,
      topSeverity,
    };
  });

  const hasData = snap.kpis.entryCount > 0;
  const zones: Zone[] = [
    { kind: 'illustrative', id: 'raw', name: 'Raw material', note: 'Illustrative — brass stock levels are not tracked in v0.1.' },
    ...stageZones,
    {
      kind: 'illustrative',
      id: 'finished',
      name: 'Finished goods',
      note: hasData ? `${snap.kpis.finishedOutput.toLocaleString('en-IN')} units packed on this date (Packing good output).` : 'No packing output recorded on this date.',
    },
    { kind: 'illustrative', id: 'dispatch', name: 'Dispatch', note: 'Illustrative — dispatch and shipments are not tracked in v0.1.' },
  ];

  const segments: FlowSegment[] = [];
  const first = stageZones[0];
  segments.push({ from: 'raw', to: first.id, intensity: hasData ? clampFlow(first.day.attainmentPct / 100) : 0, queue: 0, queueDays: 0, intoBottleneck: first.isBottleneck, illustrative: false });
  for (let i = 1; i < stageZones.length; i++) {
    const src = stageZones[i - 1].day;
    const dst = stageZones[i];
    const dstPlan = dst.day.target || 0;
    segments.push({
      from: src.stage,
      to: dst.id,
      intensity: src.target > 0 ? clampFlow(src.goodQty / src.target) : 0,
      queue: dst.day.queueBefore,
      queueDays: dstPlan > 0 ? Math.round((dst.day.queueBefore / dstPlan) * 10) / 10 : 0,
      intoBottleneck: dst.isBottleneck,
      illustrative: false,
    });
  }
  const last = stageZones[stageZones.length - 1];
  segments.push({ from: last.id, to: 'finished', intensity: last.day.target > 0 ? clampFlow(last.day.goodQty / last.day.target) : 0, queue: 0, queueDays: 0, intoBottleneck: false, illustrative: false });
  segments.push({ from: 'finished', to: 'dispatch', intensity: hasData ? 0.35 : 0, queue: 0, queueDays: 0, intoBottleneck: false, illustrative: true });

  const rank = (z: StageZone) => (z.isBottleneck ? -1 : z.condition === 'critical' ? 0 : z.condition === 'warning' ? 1 : z.condition === 'no_data' ? 2 : 3);
  const attention = stageZones.filter((z) => z.isBottleneck || z.condition !== 'normal').sort((a, b) => rank(a) - rank(b));

  return {
    date: snap.date,
    zones,
    stageZones,
    segments,
    bottleneck: snap.bottleneck,
    finishedOutput: snap.kpis.finishedOutput,
    finishedTarget: snap.kpis.finishedTarget,
    attainmentPct: snap.kpis.attainmentPct,
    attention,
    hasData,
  };
}
