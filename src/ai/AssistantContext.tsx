import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { capability, type AiIntent, type AiMode, type AiState, type Autonomy } from '../../shared/ai';
import { api } from '../api';
import { useApp } from '../state';
import { buildPlan, matchIntent, SUGGESTIONS, type Plan } from './flows';

export type StepState = 'pending' | 'running' | 'done';

export type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'ai'; kind: 'text'; text: string; chips?: string[] }
  | { id: string; role: 'ai'; kind: 'thinking' }
  | {
      id: string;
      role: 'ai';
      kind: 'plan';
      prompt: string;
      plan: Plan;
      status: 'awaiting' | 'running' | 'done' | 'cancelled';
      mode?: AiMode;
      stepStates: StepState[];
      logId?: string;
    };

interface AssistantState {
  messages: Message[];
  busy: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  send: (text: string) => void;
  approve: (id: string, alwaysAuto: boolean) => void;
  reject: (id: string) => void;
  autonomy: Record<AiIntent, Autonomy> | null;
  setAutonomy: (intent: AiIntent, level: Autonomy) => Promise<void>;
  reset: () => void;
}

const Ctx = createContext<AssistantState>(null as unknown as AssistantState);
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WELCOME: Message = {
  id: 'welcome',
  role: 'ai',
  kind: 'text',
  text: 'Hi, I’m the Everyse copilot. Ask me about production, or tell me what to do — I’ll show my plan, ask for approval where needed, and log everything I do in History → AI action log.',
  chips: SUGGESTIONS,
};

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { reportDate, changed, toast, version } = useApp();
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [autonomy, setAutonomyState] = useState<Record<AiIntent, Autonomy> | null>(null);
  const msgsRef = useRef(messages);
  msgsRef.current = messages;

  useEffect(() => {
    api.get<AiState>('/api/ai').then((s) => setAutonomyState(s.autonomy)).catch(() => {});
  }, [version]);

  const patch = (id: string, fn: (m: Message) => Message) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const log = async (m: Extract<Message, { kind: 'plan' }>, mode: AiMode, status: 'completed' | 'cancelled', steps = m.plan.steps) => {
    try {
      const saved = await api.post<{ id: string }>('/api/ai/actions', {
        prompt: m.prompt,
        intent: m.plan.intent,
        title: m.plan.title,
        mode,
        status,
        steps,
        result: status === 'completed' ? m.plan.result.replace(/\*\*/g, '') : 'Declined by user.',
        link: m.plan.link?.to,
      });
      patch(m.id, (x) => ({ ...x, logId: saved.id }) as Message);
      changed();
    } catch (e) {
      toast(`Could not save to action log: ${(e as Error).message}`, 'error');
    }
  };

  const execute = useCallback(async (id: string, mode: AiMode) => {
    const m = msgsRef.current.find((x) => x.id === id);
    if (!m || m.role !== 'ai' || m.kind !== 'plan') return;
    setBusy(true);
    patch(id, (x) => ({ ...x, status: 'running', mode }) as Message);
    for (let i = 0; i < m.plan.steps.length; i++) {
      patch(id, (x) => (x.role === 'ai' && x.kind === 'plan' ? { ...x, stepStates: x.stepStates.map((s, j) => (j === i ? 'running' : s)) } : x));
      await sleep(550 + Math.random() * 450);
      patch(id, (x) => (x.role === 'ai' && x.kind === 'plan' ? { ...x, stepStates: x.stepStates.map((s, j) => (j === i ? 'done' : s)) } : x));
    }
    patch(id, (x) => ({ ...x, status: 'done' }) as Message);
    await log(m, mode, 'completed');
    setBusy(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      const thinkingId = uid();
      setMessages((ms) => [...ms, { id: uid(), role: 'user', text: t }, { id: thinkingId, role: 'ai', kind: 'thinking' }]);
      setBusy(true);
      await sleep(700);
      const intent = matchIntent(t);
      if (!intent) {
        setMessages((ms) => [
          ...ms.filter((m) => m.id !== thinkingId),
          { id: uid(), role: 'ai', kind: 'text', text: 'I can help with production questions, daily briefs, corrective actions, at-risk orders, missing reports and recurring routines. Try one of these:', chips: SUGGESTIONS },
        ]);
        setBusy(false);
        return;
      }
      let plan: Plan;
      try {
        plan = await buildPlan(intent, t, reportDate ?? '');
      } catch (e) {
        setMessages((ms) => [...ms.filter((m) => m.id !== thinkingId), { id: uid(), role: 'ai', kind: 'text', text: `I couldn’t read the plant data: ${(e as Error).message}` }]);
        setBusy(false);
        return;
      }
      const cap = capability(intent);
      const auto = cap.readOnly || autonomy?.[intent] === 'auto';
      const id = uid();
      setMessages((ms) => [
        ...ms.filter((m) => m.id !== thinkingId),
        { id, role: 'ai', kind: 'plan', prompt: t, plan, status: auto ? 'running' : 'awaiting', mode: auto ? 'autonomous' : undefined, stepStates: plan.steps.map(() => 'pending') },
      ]);
      setBusy(false);
      if (auto) {
        await sleep(50);
        execute(id, 'autonomous');
      }
    },
    [busy, reportDate, autonomy, execute],
  );

  const setAutonomy = useCallback(
    async (intent: AiIntent, level: Autonomy) => {
      try {
        setAutonomyState(await api.put<Record<AiIntent, Autonomy>>('/api/ai/autonomy', { intent, level }));
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [toast],
  );

  const approve = useCallback(
    async (id: string, alwaysAuto: boolean) => {
      const m = msgsRef.current.find((x) => x.id === id);
      if (alwaysAuto && m?.role === 'ai' && m.kind === 'plan') {
        await setAutonomy(m.plan.intent, 'auto');
        toast(`“${capability(m.plan.intent).label}” will now run autonomously`);
      }
      execute(id, 'approved');
    },
    [execute, setAutonomy, toast],
  );

  const reject = useCallback(async (id: string) => {
    const m = msgsRef.current.find((x) => x.id === id);
    if (!m || m.role !== 'ai' || m.kind !== 'plan') return;
    patch(id, (x) => ({ ...x, status: 'cancelled', mode: 'rejected' }) as Message);
    await log(m, 'rejected', 'cancelled', []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => setMessages([WELCOME]);

  return <Ctx.Provider value={{ messages, busy, open, setOpen, send, approve, reject, autonomy, setAutonomy, reset }}>{children}</Ctx.Provider>;
}

export const useAssistant = () => useContext(Ctx);
