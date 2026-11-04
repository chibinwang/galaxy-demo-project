import type { AiState } from './ai';
import type { EngState } from './eng';

export type StageId = 'forging' | 'machining' | 'polishing' | 'plating' | 'assembly' | 'packing';
export type Shift = 'A' | 'B' | 'C';
/** Where a record came from. `demo` records are synthetic and labelled as such in the UI. */
export type Source = 'demo' | 'manual' | 'import';
export type Priority = 'High' | 'Normal' | 'Low';

export interface StageDef {
  id: StageId;
  name: string;
  description: string;
}

export interface StageSettings {
  stage: StageId;
  /** Planned good output per working day (all shifts). */
  dailyTarget: number;
  /** Rejection rate (%) above which a quality exception is raised. */
  rejectThresholdPct: number;
}

export interface Settings {
  plantName: string;
  stages: StageSettings[];
  /** A stage below this % of its daily target raises a shortfall exception. */
  shortfallPct: number;
  /** Downtime (minutes per stage per day) above which an exception is raised. */
  downtimeAlertMin: number;
  /** First stage may produce up to order qty × (1 + allowance) to cover downstream rejects. */
  firstStageAllowancePct: number;
}

export interface Product {
  code: string;
  name: string;
  category: string;
  source: Source;
}

export interface Order {
  id: string;
  productCode: string;
  customer: string;
  quantity: number;
  releaseDate: string;
  dueDate: string;
  priority: Priority;
  notes?: string;
  source: Source;
  createdAt: string;
}

export interface ProductionEntry {
  id: string;
  date: string;
  shift: Shift;
  orderId: string;
  stage: StageId;
  goodQty: number;
  rejectQty: number;
  downtimeMin: number;
  downtimeReason?: string;
  supervisor: string;
  notes?: string;
  source: Source;
  createdAt: string;
  updatedAt: string;
}

export type IssueType = 'shortfall' | 'quality' | 'downtime' | 'bottleneck' | 'order_risk' | 'data_gap' | 'other';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IssueStatus = 'open' | 'in_progress' | 'resolved';

export interface Issue {
  id: string;
  title: string;
  type: IssueType;
  severity: Severity;
  stage?: StageId;
  orderId?: string;
  detectedDate: string;
  description: string;
  rootCause?: string;
  correctiveAction?: string;
  owner?: string;
  dueDate?: string;
  status: IssueStatus;
  resolution?: string;
  resolvedDate?: string;
  /** Links an action to the auto-detected exception it was raised from. */
  exceptionKey?: string;
  /** Nonconformance raised from a QC inspection (Engineering & QC module). */
  inspectionId?: string;
  source: Source;
  createdAt: string;
  updatedAt: string;
}

export interface SavedBrief {
  id: string;
  date: string;
  headline: string;
  markdown: string;
  whatsapp: string;
  generatedAt: string;
  source: Source;
}

export interface DB {
  version: 1;
  meta: { demoData: boolean; seededAt?: string; anchorDate?: string };
  settings: Settings;
  products: Product[];
  orders: Order[];
  entries: ProductionEntry[];
  issues: Issue[];
  briefs: SavedBrief[];
  /** AI assistant autonomy settings and action log. */
  ai: AiState;
  /** Engineering drawings & QC inspections. */
  eng: EngState;
}

// ---------- computed shapes ----------

export interface StageDay {
  stage: StageId;
  name: string;
  goodQty: number;
  rejectQty: number;
  processedQty: number;
  downtimeMin: number;
  target: number;
  attainmentPct: number;
  rejectRatePct: number;
  rejectThresholdPct: number;
  entryCount: number;
  /** Units waiting in front of this stage at end of day (good output of previous stage not yet processed). */
  queueBefore: number;
}

export type OrderStatus = 'not_started' | 'on_track' | 'at_risk' | 'delayed' | 'completed';

export interface OrderStageProgress {
  stage: StageId;
  goodQty: number;
  rejectQty: number;
  /** Units available to this stage but not yet processed. */
  waiting: number;
}

export interface OrderProgress {
  order: Order;
  productName: string;
  completedQty: number;
  completionPct: number;
  stages: OrderStageProgress[];
  currentStage: StageId | null;
  status: OrderStatus;
  projectedFinish: string | null;
  daysLate: number;
}

export interface DetectedException {
  key: string;
  date: string;
  type: IssueType;
  severity: Severity;
  stage?: StageId;
  orderId?: string;
  title: string;
  detail: string;
  suggestedAction: string;
  linkedIssueId?: string;
  similarIncidents: Pick<Issue, 'id' | 'title' | 'type' | 'detectedDate' | 'rootCause' | 'correctiveAction' | 'resolution'>[];
}

export interface FlowViolation {
  orderId: string;
  stage: StageId;
  date: string;
  message: string;
}
