import type { IssueType, Settings, Severity, StageDef, StageId } from './types';

/** Manufacturing route for brass bathroom fittings, in process order. The last stage is the factory's finished output. */
export const STAGES: StageDef[] = [
  { id: 'forging', name: 'Forging', description: 'Hot brass forging of bodies' },
  { id: 'machining', name: 'Machining', description: 'CNC / VMC machining and threading' },
  { id: 'polishing', name: 'Polishing', description: 'Grinding, buffing and polishing' },
  { id: 'plating', name: 'Plating', description: 'Nickel–chrome electroplating' },
  { id: 'assembly', name: 'Assembly & Testing', description: 'Cartridge fit-up and leak testing' },
  { id: 'packing', name: 'Packing', description: 'Final inspection and packing (finished goods)' },
];

export const STAGE_IDS = STAGES.map((s) => s.id);
export const FINAL_STAGE: StageId = 'packing';
export const SHIFTS = ['A', 'B', 'C'] as const;

export const stageName = (id: StageId) => STAGES.find((s) => s.id === id)?.name ?? id;
export const stageIndex = (id: StageId) => STAGE_IDS.indexOf(id);

export const DEFAULT_SETTINGS: Settings = {
  plantName: 'Galaxy Taps — Bhiwadi Plant',
  stages: [
    { stage: 'forging', dailyTarget: 1800, rejectThresholdPct: 2 },
    { stage: 'machining', dailyTarget: 1700, rejectThresholdPct: 2.5 },
    { stage: 'polishing', dailyTarget: 1650, rejectThresholdPct: 3 },
    { stage: 'plating', dailyTarget: 1600, rejectThresholdPct: 4 },
    { stage: 'assembly', dailyTarget: 1550, rejectThresholdPct: 1.5 },
    { stage: 'packing', dailyTarget: 1500, rejectThresholdPct: 0.5 },
  ],
  shortfallPct: 85,
  downtimeAlertMin: 60,
  firstStageAllowancePct: 15,
};

export const DOWNTIME_REASONS = [
  'Machine breakdown',
  'Tool / die change',
  'Material shortage',
  'Power cut',
  'Manpower shortage',
  'Quality hold',
  'Planned maintenance',
  'Other',
];

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  shortfall: 'Target shortfall',
  quality: 'Quality / rejection',
  downtime: 'Downtime',
  bottleneck: 'Bottleneck',
  order_risk: 'Order at risk',
  data_gap: 'Missing data',
  other: 'Other',
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Plant works Monday–Saturday. */
export const WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6];
