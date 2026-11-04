import { Database, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Settings as SettingsT } from '../../shared/types';
import { api, ApiError } from '../api';
import { Button, Card, ErrorNote, Field, fmtN, Input, Loading, PageHeader } from '../components/ui';
import { useApp } from '../state';

export default function Settings() {
  const { meta, changed, toast } = useApp();
  const [s, setS] = useState<SettingsT | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (meta) setS(structuredClone(meta.settings));
  }, [meta]);
  if (!meta || !s) return <Loading />;

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      await api.put('/api/settings', s);
      toast('Settings saved — targets and alert thresholds updated');
      changed();
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  const admin = async (action: 'reset-demo' | 'clear') => {
    const msg =
      action === 'reset-demo'
        ? 'Replace ALL current data with a fresh synthetic demo dataset anchored to today?'
        : 'Delete all orders, production entries, actions and briefs so you can start with real Galaxy Taps data? Download a backup first if you need one.';
    if (!confirm(msg)) return;
    setBusy(action);
    try {
      await api.post(`/api/admin/${action}`);
      toast(action === 'reset-demo' ? 'Demo data regenerated' : 'All data cleared — ready for real records');
      changed();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Settings & data" subtitle="Plant targets, alert thresholds, and demo/real data management." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Targets & thresholds" subtitle="Daily plan per stage drives attainment, shortfall exceptions and the bottleneck calculation.">
          <div className="space-y-5 px-5 pb-5">
            <Field label="Plant name">
              <Input value={s.plantName} onChange={(e) => setS({ ...s, plantName: e.target.value })} />
            </Field>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Stage</th>
                    <th className="py-2 font-medium">Daily plan (good pcs)</th>
                    <th className="py-2 font-medium">Rejection limit (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stages.map((st, i) => (
                    <tr key={st.stage}>
                      <td className="py-1.5 pr-3 font-medium text-slate-700">{meta.stages.find((x) => x.id === st.stage)?.name}</td>
                      <td className="py-1.5 pr-3">
                        <Input
                          type="number"
                          min={0}
                          value={st.dailyTarget}
                          onChange={(e) => {
                            const stages = [...s.stages];
                            stages[i] = { ...st, dailyTarget: Number(e.target.value) };
                            setS({ ...s, stages });
                          }}
                        />
                      </td>
                      <td className="py-1.5">
                        <Input
                          type="number"
                          min={0}
                          step={0.1}
                          value={st.rejectThresholdPct}
                          onChange={(e) => {
                            const stages = [...s.stages];
                            stages[i] = { ...st, rejectThresholdPct: Number(e.target.value) };
                            setS({ ...s, stages });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Shortfall alert below (% of plan)">
                <Input type="number" value={s.shortfallPct} onChange={(e) => setS({ ...s, shortfallPct: Number(e.target.value) })} />
              </Field>
              <Field label="Downtime alert above (min/stage/day)">
                <Input type="number" value={s.downtimeAlertMin} onChange={(e) => setS({ ...s, downtimeAlertMin: Number(e.target.value) })} />
              </Field>
              <Field label="Forging over-run allowance (%)" hint="Extra forgings allowed to replace downstream rejects.">
                <Input type="number" value={s.firstStageAllowancePct} onChange={(e) => setS({ ...s, firstStageAllowancePct: Number(e.target.value) })} />
              </Field>
            </div>
            {errors.length > 0 && <ErrorNote>{errors.join(' ')}</ErrorNote>}
            <div className="flex justify-end">
              <Button variant="primary" onClick={save} loading={saving}>
                Save settings
              </Button>
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Data" subtitle={meta.demoData ? 'Currently showing synthetic demo data.' : 'Demo data has been cleared.'}>
            <div className="space-y-3 px-5 pb-5 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(meta.counts).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-slate-500 capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</div>
                    <div className="num text-base font-semibold">{fmtN(v)}</div>
                  </div>
                ))}
              </div>
              <a href="/api/export/backup.json" className="block">
                <Button className="w-full">
                  <Download className="h-4 w-4" /> Download full backup (JSON)
                </Button>
              </a>
              <Button className="w-full" onClick={() => admin('reset-demo')} loading={busy === 'reset-demo'}>
                <RotateCcw className="h-4 w-4" /> Reset demo data
              </Button>
              <Button variant="danger" className="w-full" onClick={() => admin('clear')} loading={busy === 'clear'}>
                <Trash2 className="h-4 w-4" /> Clear all data (start with real records)
              </Button>
            </div>
          </Card>
          <Card title="Going live with Galaxy Taps data">
            <ol className="list-decimal space-y-1.5 px-5 pr-5 pb-5 pl-9 text-[13px] text-slate-600">
              <li>Confirm stage names and daily plans with the plant and update them above.</li>
              <li>Clear demo data.</li>
              <li>Import open work orders (Production Updates → Import → Work orders).</li>
              <li>Import recent shift sheets, or have supervisors record each shift.</li>
            </ol>
            <div className="mx-5 mb-5 flex gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <Database className="h-4 w-4 shrink-0" /> Data is stored locally in <code>data/db.json</code> on the machine running the app.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
