import clsx from 'clsx';
import { ArrowUp, Bot, Check, CheckCircle2, Circle, Loader2, ShieldCheck, Sparkles, XCircle, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { capability } from '../../shared/ai';
import { Button, Rich } from '../components/ui';
import { useAssistant, type Message } from './AssistantContext';

type PlanMsg = Extract<Message, { kind: 'plan' }>;

function PlanCard({ m, compact }: { m: PlanMsg; compact?: boolean }) {
  const { approve, reject, busy } = useAssistant();
  const [always, setAlways] = useState(false);
  const cap = capability(m.plan.intent);
  const doneCount = m.stepStates.filter((s) => s === 'done').length;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-900">{m.plan.title}</div>
          <div className="mt-0.5 text-xs text-slate-500">{m.plan.intro}</div>
        </div>
        {m.mode === 'autonomous' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200 ring-inset">
            <Zap className="h-3 w-3" /> Autonomous
          </span>
        )}
        {m.mode === 'approved' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200 ring-inset">
            <ShieldCheck className="h-3 w-3" /> Approved
          </span>
        )}
      </div>

      <ol className={clsx('space-y-2 px-4 py-3', m.status === 'cancelled' && 'opacity-50')}>
        {m.plan.steps.map((s, i) => {
          const st = m.stepStates[i];
          return (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0">
                {st === 'done' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : st === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                ) : (
                  <Circle className="h-4 w-4 text-slate-300" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className={clsx('flex flex-wrap items-center gap-1.5 text-[13px]', st === 'pending' ? 'text-slate-500' : 'text-slate-800')}>
                  <span className="font-medium">{s.label}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500">{s.tool}</span>
                </div>
                {s.detail && (st !== 'pending' || m.status === 'awaiting') && <div className="mt-0.5 text-xs text-slate-500">{s.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {m.status === 'awaiting' && (
        <div className="border-t border-slate-100 bg-amber-50/50 px-4 py-3">
          <div className="mb-2 text-xs text-slate-600">
            <span className="font-medium text-slate-800">Needs your approval</span> — “{cap.label}” is set to ask first.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => approve(m.id, always)} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> Approve & run
            </Button>
            <Button size="sm" variant="ghost" onClick={() => reject(m.id)} disabled={busy}>
              Decline
            </Button>
            <label className={clsx('flex cursor-pointer items-center gap-1.5 text-xs text-slate-600', !compact && 'ml-auto')}>
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="accent-violet-600" />
              Always run this autonomously
            </label>
          </div>
        </div>
      )}

      {m.status === 'running' && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Executing step {Math.min(doneCount + 1, m.plan.steps.length)} of {m.plan.steps.length}…
        </div>
      )}

      {m.status === 'done' && (
        <div className="border-t border-slate-100 bg-green-50/40 px-4 py-3">
          <div className="text-[13px] text-slate-800">
            <Rich text={m.plan.result} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {m.plan.link && (
              <Link to={m.plan.link.to} className="font-medium text-sky-700 hover:underline">
                {m.plan.link.label} →
              </Link>
            )}
            {m.logId && (
              <Link to="/history?tab=ai" className="hover:underline">
                Logged as {m.logId}
              </Link>
            )}
            {!cap.readOnly && <span>External actions simulated in this demo</span>}
          </div>
        </div>
      )}

      {m.status === 'cancelled' && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <XCircle className="h-3.5 w-3.5" /> Declined — nothing was done.{m.logId && ` Logged as ${m.logId}.`}
        </div>
      )}
    </div>
  );
}

export function Chat({ compact }: { compact?: boolean }) {
  const { messages, send, busy } = useAssistant();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const submit = (t = text) => {
    if (!t.trim() || busy) return;
    send(t);
    setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2 text-[13px] text-white">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <Bot className="h-4 w-4 text-amber-700" />
              </div>
              <div className="min-w-0 flex-1">
                {m.kind === 'thinking' && (
                  <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 px-3 py-2.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                )}
                {m.kind === 'text' && (
                  <>
                    <div className="text-[13px] leading-relaxed text-slate-700">{m.text}</div>
                    {m.chips && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.chips.map((c) => (
                          <button key={c} onClick={() => submit(c)} disabled={busy} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-xs text-slate-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50">
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {m.kind === 'plan' && <PlanCard m={m} compact={compact} />}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t border-slate-200 bg-white p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask or tell the copilot what to do…"
            className="max-h-32 min-h-[22px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-slate-400"
            aria-label="Message the AI copilot"
          />
          <button type="submit" disabled={!text.trim() || busy} className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white disabled:opacity-30" aria-label="Send">
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 px-1 text-[10px] text-slate-400">Demo copilot — reads real plant data; messages and changes it makes are simulated and logged.</div>
      </form>
    </div>
  );
}
