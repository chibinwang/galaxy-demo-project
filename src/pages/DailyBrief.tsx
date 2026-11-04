import clsx from 'clsx';
import { Check, Copy, Download, MessageCircle, Printer, Save } from 'lucide-react';
import { useState } from 'react';
import type { BriefSection, DailyBrief as Brief } from '../../shared/brief';
import { fmtDate, fmtShortDate } from '../../shared/dates';
import type { SavedBrief } from '../../shared/types';
import { api, qs } from '../api';
import { DatePicker } from '../components/DatePicker';
import { Button, Card, Empty, ErrorNote, Loading, Modal, PageHeader, Rich, SourceTag } from '../components/ui';
import { useApp, useFetch } from '../state';

const STATUS = {
  good: { cls: 'border-green-200 bg-green-50 text-green-900', label: 'On plan' },
  watch: { cls: 'border-amber-200 bg-amber-50 text-amber-950', label: 'Watch' },
  critical: { cls: 'border-red-200 bg-red-50 text-red-900', label: 'Action needed' },
};

export default function DailyBrief() {
  const { meta, reportDate, setReportDate, toast, changed } = useApp();
  const { data, error, loading } = useFetch<Brief>(reportDate ? `/api/brief${qs({ date: reportDate })}` : null);
  const saved = useFetch<Omit<SavedBrief, 'markdown' | 'whatsapp'>[]>('/api/briefs');
  const [copied, setCopied] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SavedBrief | null>(null);
  const [saving, setSaving] = useState(false);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !meta || !reportDate) return <Loading />;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast('Clipboard not available in this browser', 'error');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([data.markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-brief-${data.date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const save = async () => {
    setSaving(true);
    try {
      const b = await api.post<SavedBrief>('/api/briefs', { date: data.date });
      toast(`Brief saved as ${b.id}`);
      changed();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const openSaved = async (id: string) => setViewing(await api.get<SavedBrief>(`/api/briefs/${id}`));
  const st = STATUS[data.status];
  const stageSection = data.sections;

  return (
    <div>
      <PageHeader
        title="Daily Brief"
        subtitle="Management summary generated from recorded data with fixed rules — works fully offline, no AI service required."
        actions={<DatePicker value={reportDate} onChange={setReportDate} max={meta.today} />}
      />
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="no-print mb-3 flex flex-wrap gap-2">
            <Button onClick={() => copy(data.markdown, 'md')}>{copied === 'md' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} Copy text</Button>
            <Button onClick={() => copy(data.whatsapp, 'wa')}>
              {copied === 'wa' ? <Check className="h-4 w-4 text-green-600" /> : <MessageCircle className="h-4 w-4" />} Copy for WhatsApp
            </Button>
            <Button onClick={download}>
              <Download className="h-4 w-4" /> Download .md
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              <Save className="h-4 w-4" /> Save to history
            </Button>
          </div>
          <Card className={clsx('overflow-hidden', loading && 'opacity-70')}>
            <div className="border-b border-slate-100 px-6 pt-6 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{data.plantName}</div>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Daily Production Brief — {fmtDate(data.date, true)}</h2>
                </div>
                {data.demoData && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900">Demo data</span>}
              </div>
              <div className={clsx('mt-4 rounded-xl border px-4 py-3 text-sm font-medium', st.cls)}>
                <span className="mr-2 rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase">{st.label}</span>
                {data.headline}
              </div>
            </div>
            <div className="px-6 py-5">
              <h3 className="text-sm font-semibold text-slate-900">Priorities for today</h3>
              <ol className="mt-2 space-y-2">
                {data.priorities.map((p, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{i + 1}</span>
                    <span>
                      <Rich text={p} />
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {stageSection.map((s: BriefSection) => (
                  <div key={s.title}>
                    <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
                    <ul className="mt-2 space-y-1.5">
                      {s.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-700">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                          <span>
                            <Rich text={b} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
        <Card className="no-print h-fit" title="Saved briefs" subtitle="Archived for later reference">
          {!saved.data ? (
            <Loading />
          ) : saved.data.length === 0 ? (
            <Empty>No briefs saved yet.</Empty>
          ) : (
            <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {saved.data.map((b) => (
                <button key={b.id} onClick={() => openSaved(b.id)} className="block w-full px-5 py-3 text-left hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900">
                    {fmtShortDate(b.date)} <SourceTag source={b.source} />
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{b.headline}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.id} · brief for ${fmtDate(viewing.date)}` : ''} wide>
        {viewing && (
          <>
            <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-800">{viewing.markdown}</pre>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" onClick={() => copy(viewing.whatsapp, 'wa-saved')}>
                <MessageCircle className="h-3.5 w-3.5" /> Copy for WhatsApp
              </Button>
              <Button size="sm" onClick={() => copy(viewing.markdown, 'md-saved')}>
                <Copy className="h-3.5 w-3.5" /> Copy text
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Saved {new Date(viewing.generatedAt).toLocaleString('en-IN')} — reflects the data as it was then.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
