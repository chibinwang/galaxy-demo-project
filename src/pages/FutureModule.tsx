import { Lock } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui';

const MODULES: Record<string, { title: string; summary: string; scope: string[] }> = {
  'po-price-verification': {
    title: 'PO Price Verification',
    summary: 'Check supplier purchase orders and invoices against agreed rates and brass/LME-linked price formulas before approval.',
    scope: [
      'Rate-contract master per supplier and item',
      'Automatic flagging of PO lines above agreed price or tolerance',
      'Brass price index linkage for raw-material POs',
      'Approval trail and savings report',
    ],
  },
  'assembly-material-planning': {
    title: 'Assembly Material Planning',
    summary: 'Plan cartridges, aerators, O-rings, hoses and packing material against the assembly schedule using bills of material.',
    scope: [
      'BOM per product variant',
      'Shortage forecast from open orders and stage WIP',
      'Suggested purchase / issue quantities',
      'Material readiness check before releasing orders to assembly',
    ],
  },
};

export default function FutureModule() {
  const { slug } = useParams();
  const m = MODULES[slug ?? ''];
  if (!m) return <div className="py-20 text-center text-slate-500">Module not found.</div>;
  return (
    <div className="max-w-3xl">
      <PageHeader title={m.title} subtitle="Planned module — not part of the v0.1 demo." />
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-slate-100 p-3">
            <Lock className="h-6 w-6 text-slate-500" />
          </div>
          <div>
            <p className="text-sm text-slate-700">{m.summary}</p>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">Proposed scope</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {m.scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Scope to be validated with Galaxy Taps during the commercial PoC. Production monitoring, exceptions and briefs are the focus of v0.1.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
