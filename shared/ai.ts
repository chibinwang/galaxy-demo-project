/*
 * AI assistant — mock execution layer for v0.1.
 * The assistant plans and "executes" workflows with visible steps, but external effects
 * (WhatsApp messages, re-sequencing, notifications) are SIMULATED and only recorded in the action log.
 */

export type AiIntent = 'summary' | 'brief' | 'assign' | 'expedite' | 'datagap' | 'schedule';
export type Autonomy = 'auto' | 'ask';
/** How an action came to run: on its own, after the user approved it, or declined by the user. */
export type AiMode = 'autonomous' | 'approved' | 'rejected';

export interface AiCapability {
  id: AiIntent;
  label: string;
  description: string;
  defaultAutonomy: Autonomy;
  /** Read-only capabilities never change anything, so they always run without asking. */
  readOnly?: boolean;
}

export const AI_CAPABILITIES: AiCapability[] = [
  { id: 'summary', label: 'Answer production questions', description: 'Read data and summarise performance', defaultAutonomy: 'auto', readOnly: true },
  { id: 'brief', label: 'Send daily brief', description: 'Generate the brief and share it on WhatsApp', defaultAutonomy: 'auto' },
  { id: 'datagap', label: 'Chase missing reports', description: 'Remind supervisors who have not submitted', defaultAutonomy: 'auto' },
  { id: 'assign', label: 'Assign corrective actions', description: 'Draft an action from past fixes and assign an owner', defaultAutonomy: 'ask' },
  { id: 'expedite', label: 'Re-sequence at-risk orders', description: 'Move late orders up the queue and inform sales', defaultAutonomy: 'ask' },
  { id: 'schedule', label: 'Create routines', description: 'Set up recurring autonomous tasks', defaultAutonomy: 'ask' },
];

export const AI_INTENTS = AI_CAPABILITIES.map((c) => c.id);
export const capability = (id: AiIntent) => AI_CAPABILITIES.find((c) => c.id === id)!;

export interface AiStep {
  tool: string;
  label: string;
  detail?: string;
}

export interface AiAction {
  id: string;
  createdAt: string;
  prompt: string;
  intent: AiIntent;
  title: string;
  mode: AiMode;
  status: 'completed' | 'cancelled';
  steps: AiStep[];
  result: string;
  link?: string;
  /** External effects were simulated, not performed. Always true in v0.1. */
  simulated: true;
  source: 'demo' | 'manual';
}

export interface AiState {
  autonomy: Record<AiIntent, Autonomy>;
  actions: AiAction[];
}

export const defaultAiState = (): AiState => ({
  autonomy: Object.fromEntries(AI_CAPABILITIES.map((c) => [c.id, c.defaultAutonomy])) as Record<AiIntent, Autonomy>,
  actions: [],
});
