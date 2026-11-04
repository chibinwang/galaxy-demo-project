import clsx from 'clsx';
import { Lock, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AI_CAPABILITIES, type AiAction } from '../../shared/ai';
import { Chat } from '../ai/Chat';
import { useAssistant } from '../ai/AssistantContext';
import { AiModeBadge } from '../ai/AiModeBadge';
import { Button, Card, Empty, Loading, PageHeader } from '../components/ui';
import { useFetch } from '../state';

export default function Assistant() {
  const { autonomy, setAutonomy, reset } = useAssistant();
  const recent = useFetch<{ actions: AiAction[] }>('/api/ai');

  return (
    <div>
      <PageHeader
        title="AI Copilot"
        subtitle="Talk to the copilot and let it do the work. You decide which actions it may take on its own and which need your approval."
        actions={
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> New conversation
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="flex h-[calc(100vh-190px)] min-h-[520px] flex-col overflow-hidden xl:col-span-2">
          <Chat />
        </Card>
        <div className="space-y-4">
          <Card title="Autonomy" subtitle="Autonomous actions run immediately and are logged. “Ask first” shows the plan and waits for your approval.">
            <div className="divide-y divide-slate-100 pb-2">
              {!autonomy && <Loading />}
              {autonomy &&
                AI_CAPABILITIES.map((c) => {
                  const level = autonomy[c.id];
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-slate-800">{c.label}</div>
                        <div className="text-[11px] text-slate-500">{c.description}</div>
                      </div>
                      {c.readOnly ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title="Read-only — never changes anything">
                          <Lock className="h-3 w-3" /> Always
                        </span>
                      ) : (
                        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-[11px] font-medium" role="radiogroup" aria-label={c.label}>
                          <button
                            role="radio"
                            aria-checked={level === 'ask'}
                            onClick={() => setAutonomy(c.id, 'ask')}
                            className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1', level === 'ask' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500')}
                          >
                            <ShieldCheck className="h-3 w-3" /> Ask first
                          </button>
                          <button
                            role="radio"
                            aria-checked={level === 'auto'}
                            onClick={() => setAutonomy(c.id, 'auto')}
                            className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1', level === 'auto' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500')}
                          >
                            <Zap className="h-3 w-3" /> Autonomous
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </Card>
          <Card
            title="Recent AI actions"
            action={
              <Link to="/history?tab=ai" className="text-xs font-medium text-sky-700 hover:underline">
                Full log →
              </Link>
            }
          >
            {!recent.data ? (
              <Loading />
            ) : recent.data.actions.length === 0 ? (
              <Empty>No actions yet.</Empty>
            ) : (
              <div className="divide-y divide-slate-100 pb-1">
                {recent.data.actions.slice(0, 6).map((a) => (
                  <div key={a.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{a.title}</span>
                      <AiModeBadge mode={a.mode} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {a.id} · {new Date(a.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
