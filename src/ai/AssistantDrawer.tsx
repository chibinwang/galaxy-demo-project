import { Maximize2, Sparkles, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAssistant } from './AssistantContext';
import { Chat } from './Chat';

/** Floating launcher + slide-over chat, available on every page except the full Assistant page. */
export function AssistantDrawer() {
  const { open, setOpen, busy } = useAssistant();
  const { pathname } = useLocation();
  if (pathname === '/assistant') return null;
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="no-print fixed right-5 bottom-5 z-40 inline-flex items-center gap-2 rounded-full bg-slate-900 py-3 pr-4 pl-3.5 text-sm font-medium text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
        >
          <Sparkles className={busy ? 'h-4 w-4 animate-pulse text-amber-300' : 'h-4 w-4 text-amber-300'} />
          Ask Copilot
        </button>
      )}
      {open && (
        <div className="no-print fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
          <div className="flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-4">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="flex-1 text-sm font-semibold">Everyse Copilot</span>
            <Link to="/assistant" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Open full page" title="Open full page">
              <Maximize2 className="h-4 w-4" />
            </Link>
            <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close copilot">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <Chat compact />
          </div>
        </div>
      )}
    </>
  );
}
