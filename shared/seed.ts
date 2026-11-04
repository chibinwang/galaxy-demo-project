import { DEFAULT_SETTINGS, STAGE_IDS } from './constants';
import { addDays, fmtShortDate, isWorkingDay, lastWorkingDays } from './dates';
import { defaultAiState, type AiAction } from './ai';
import { emptyEngState } from './eng';
import { generateBrief } from './brief';
import type { DB, Issue, Order, Priority, Product, ProductionEntry, Shift, StageId } from './types';

/*
 * Synthetic demo data — NOT Galaxy Taps records.
 * A day-by-day flow simulation: each stage can only process what the previous stage has delivered,
 * so the generated history satisfies the same integrity rules enforced on manual entry and imports.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_PRODUCTS: Product[] = [
  { code: 'GT-PC-101', name: 'Aria Pillar Cock', category: 'Pillar cock', source: 'demo' },
  { code: 'GT-BC-204', name: 'Aria Long-Body Bib Cock', category: 'Bib cock', source: 'demo' },
  { code: 'GT-AV-310', name: 'Flo Angle Valve', category: 'Angle valve', source: 'demo' },
  { code: 'GT-WM-415', name: 'Zen 3-in-1 Wall Mixer', category: 'Wall mixer', source: 'demo' },
  { code: 'GT-BM-520', name: 'Zen Single-Lever Basin Mixer', category: 'Basin mixer', source: 'demo' },
  { code: 'GT-SM-612', name: 'Tide Swivel Sink Mixer', category: 'Sink mixer', source: 'demo' },
  { code: 'GT-CD-718', name: 'Nova Concealed Diverter', category: 'Diverter', source: 'demo' },
];

const CUSTOMERS = [
  'Dealer — Jaipur (demo)',
  'Distributor — Delhi NCR (demo)',
  'Project — Gurugram Residency (demo)',
  'Dealer — Lucknow (demo)',
  'Distributor — Ahmedabad (demo)',
  'Online marketplace (demo)',
  'Dealer — Chandigarh (demo)',
];

const SUPERVISORS: Record<StageId, [string, string]> = {
  forging: ['Ramesh Yadav', 'Sanjay Gurjar'],
  machining: ['Anil Sharma', 'Deepak Saini'],
  polishing: ['Mukesh Kumar', 'Rajendra Meena'],
  plating: ['Pooja Meena', 'Vikram Singh'],
  assembly: ['Sunita Devi', 'Arvind Jangid'],
  packing: ['Imran Khan', 'Neha Choudhary'],
};

const BASE_REJECT: Record<StageId, number> = { forging: 0.012, machining: 0.016, polishing: 0.02, plating: 0.026, assembly: 0.008, packing: 0.002 };
const MINOR_DOWNTIME = ['Tool / die change', 'Power cut', 'Machine breakdown', 'Material shortage', 'Planned maintenance'];

interface Incident {
  capMult?: number;
  rejectRate?: number;
  downtime?: [number, number];
  reason?: string;
  note?: string;
}

/** Incidents keyed by working-day offset from the anchor date (0 = anchor, -1 = previous working day). */
const INCIDENTS: Record<number, Partial<Record<StageId, Incident>>> = {
  [-33]: { plating: { rejectRate: 0.071, capMult: 0.9, note: 'Pitting and dull finish on wall mixers' } },
  [-32]: { plating: { rejectRate: 0.058, note: 'Bath under carbon treatment' } },
  [-30]: { packing: { capMult: 0.7, downtime: [90, 60], reason: 'Material shortage', note: 'Export cartons not available' } },
  [-24]: { machining: { rejectRate: 0.072, note: 'Thread rejection on basin-mixer bodies' } },
  [-23]: { machining: { rejectRate: 0.061, note: 'Insert batch suspected' } },
  [-16]: { plating: { capMult: 0.42, downtime: [170, 120], reason: 'Machine breakdown', note: 'Rectifier failure — line 2' } },
  [-15]: { plating: { capMult: 0.78, downtime: [90, 0], reason: 'Machine breakdown', note: 'Line 2 restarted after card replacement' } },
  [-10]: { polishing: { capMult: 0.62, downtime: [0, 0], note: '9 operators on festival leave' } },
  [-9]: { polishing: { capMult: 0.66, note: 'Manpower short — 7 on leave' } },
  [-4]: { plating: { rejectRate: 0.058, capMult: 0.84, note: 'Dull patches observed on bib cocks' } },
  [-3]: { plating: { rejectRate: 0.071, capMult: 0.8, note: 'Rejection rising — Hull cell test requested' } },
  [-2]: { plating: { rejectRate: 0.076, capMult: 0.76, note: 'Re-plating rejected lots' } },
  [-1]: { plating: { rejectRate: 0.081, capMult: 0.74, note: 'Bath contamination suspected' }, forging: { capMult: 0.84, downtime: [150, 0], reason: 'Tool / die change', note: 'Die change overrun on 400T press' } },
  [0]: { plating: { rejectRate: 0.084, capMult: 0.72, downtime: [45, 30], reason: 'Quality hold', note: 'Lots on hold pending bath analysis' } },
};

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

export function generateDemoData(anchor: string, seed = 20261024): DB {
  const rnd = mulberry32(seed);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  // Production happens on working days only; the anchor itself is moved back to a working day if needed.
  let end = anchor;
  while (!isWorkingDay(end)) end = addDays(end, -1);
  const days = lastWorkingDays(end, 40);
  const offsetOf = new Map(days.map((d, i) => [d, i - (days.length - 1)]));

  const settings = structuredClone(DEFAULT_SETTINGS);
  const target = Object.fromEntries(settings.stages.map((s) => [s.stage, s.dailyTarget])) as Record<StageId, number>;

  const orders: Order[] = [];
  let orderSeq = 1001;
  const newOrder = (release: string, opts: Partial<Order> = {}): Order => {
    const qty = opts.quantity ?? Math.round(between(1200, 4000) / 100) * 100;
    const o: Order = {
      id: `WO-${orderSeq++}`,
      productCode: opts.productCode ?? pick(DEMO_PRODUCTS).code,
      customer: opts.customer ?? pick(CUSTOMERS),
      quantity: qty,
      releaseDate: release,
      dueDate: opts.dueDate ?? addDays(release, Math.round(between(16, 26))),
      priority: opts.priority ?? ((rnd() < 0.2 ? 'High' : 'Normal') as Priority),
      notes: opts.notes,
      source: 'demo',
      createdAt: `${release}T04:00:00.000Z`,
    };
    orders.push(o);
    return o;
  };

  // Opening order book
  for (let i = 0; i < 5; i++) newOrder(days[0], { dueDate: addDays(days[0], 10 + i * 3) });

  type State = { good: Record<StageId, number>; processed: Record<StageId, number>; rejects: Record<StageId, number> };
  const state = new Map<string, State>();
  const zero = () => Object.fromEntries(STAGE_IDS.map((s) => [s, 0])) as Record<StageId, number>;
  const st = (id: string) => {
    let s = state.get(id);
    if (!s) state.set(id, (s = { good: zero(), processed: zero(), rejects: zero() }));
    return s;
  };

  const entries: ProductionEntry[] = [];
  let entrySeq = 1;

  for (const day of days) {
    const off = offsetOf.get(day)!;
    // New orders: roughly balanced with packing capacity.
    if (day !== days[0] && rnd() < 0.4) newOrder(day);
    if (off === -15) newOrder(day, { productCode: 'GT-WM-415', customer: 'Export — Dubai (demo)', quantity: 5200, dueDate: addDays(day, 16), priority: 'Normal', notes: 'Export packing, 5-ply cartons' });
    if (off === -6) newOrder(day, { productCode: 'GT-BC-204', customer: 'Project — Gurugram Residency (demo)', quantity: 3800, dueDate: addDays(day, 10), priority: 'High', notes: 'Site delivery schedule fixed' });

    const queue = orders
      .filter((o) => o.releaseDate <= day && st(o.id).good.packing < o.quantity)
      .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'High' ? -1 : 1) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));

    // Start-of-day snapshot: a stage works on what upstream had delivered by the end of the previous day.
    const startGood = new Map(queue.map((o) => [o.id, { ...st(o.id).good }]));

    for (const stage of STAGE_IDS) {
      const inc = INCIDENTS[off]?.[stage];
      let cap = Math.round(target[stage] * between(0.93, 1.05) * (inc?.capMult ?? 1));
      const rr = inc?.rejectRate ?? BASE_REJECT[stage] * between(0.6, 1.4);
      const i = STAGE_IDS.indexOf(stage);
      // Downtime for the stage-day, per shift
      const downtime: [number, number] = inc?.downtime ?? [rnd() < 0.3 ? Math.round(between(10, 35)) : 0, rnd() < 0.25 ? Math.round(between(10, 30)) : 0];
      const reasons: [string, string] = [inc?.reason ?? pick(MINOR_DOWNTIME), inc?.reason ?? pick(MINOR_DOWNTIME)];
      const downtimeAttached = [false, false];

      for (const o of queue) {
        if (cap <= 0) break;
        const s = st(o.id);
        let available: number;
        if (i === 0) {
          const downstreamRejects = STAGE_IDS.slice(1).reduce((a, x) => a + s.rejects[x], 0);
          const needGood = Math.min(o.quantity + downstreamRejects, Math.floor(o.quantity * 1.15)) - s.good.forging;
          available = Math.max(0, Math.ceil(needGood / (1 - rr)));
        } else {
          const prev = STAGE_IDS[i - 1];
          available = startGood.get(o.id)![prev] - s.processed[stage];
          if (stage === 'packing') available = Math.min(available, Math.ceil((o.quantity - s.good.packing) / (1 - rr)));
        }
        let processed = Math.min(available, cap);
        if (processed <= 0) continue;
        let rejects = Math.round(processed * rr);
        let good = processed - rejects;
        if (i === 0) good = Math.min(good, Math.floor(o.quantity * 1.15) - s.good.forging);
        if (stage === 'packing') good = Math.min(good, o.quantity - s.good.packing);
        processed = good + rejects;
        cap -= processed;
        s.good[stage] += good;
        s.processed[stage] += processed;
        s.rejects[stage] += rejects;

        // Split into Shift A / Shift B records
        const goodA = Math.round(good * 0.55);
        const rejA = Math.round(rejects * 0.55);
        const parts: [Shift, number, number][] = [
          ['A', goodA, rejA],
          ['B', good - goodA, rejects - rejA],
        ];
        parts.forEach(([shift, g, r], si) => {
          const dt = !downtimeAttached[si] ? downtime[si] : 0;
          if (g === 0 && r === 0 && dt === 0) return;
          downtimeAttached[si] = true;
          entries.push({
            id: `PE-${pad(entrySeq++, 5)}`,
            date: day,
            shift,
            orderId: o.id,
            stage,
            goodQty: g,
            rejectQty: r,
            downtimeMin: dt,
            downtimeReason: dt > 0 ? reasons[si] : undefined,
            supervisor: SUPERVISORS[stage][si],
            notes: dt > 0 || si === 0 ? inc?.note : undefined,
            source: 'demo',
            createdAt: `${day}T${si === 0 ? '10' : '17'}:30:00.000Z`,
            updatedAt: `${day}T${si === 0 ? '10' : '17'}:30:00.000Z`,
          });
        });
      }
    }
  }

  const d = (off: number) => days[days.length - 1 + off];
  const issue = (n: number, x: Omit<Issue, 'id' | 'source' | 'createdAt' | 'updatedAt'>): Issue => ({
    id: `ISS-${pad(n)}`,
    source: 'demo',
    createdAt: `${x.detectedDate}T12:00:00.000Z`,
    updatedAt: `${x.resolvedDate ?? x.detectedDate}T12:00:00.000Z`,
    ...x,
  });
  const exportOrder = orders.find((o) => o.customer.startsWith('Export'))!;

  const issues: Issue[] = [
    issue(1, {
      title: 'Pitting and dull finish on wall mixers',
      type: 'quality',
      severity: 'high',
      stage: 'plating',
      detectedDate: d(-33),
      description: 'Plating rejection rose to 7% with pitting and dull patches, mainly on GT-WM-415 bodies.',
      rootCause: 'Organic contamination of the nickel bath (brightener breakdown products).',
      correctiveAction: 'Carbon treatment of the nickel bath plus 4 hours of dummy plating; weekly Hull cell test introduced.',
      owner: 'Pooja Meena (Plating)',
      dueDate: d(-31),
      status: 'resolved',
      resolution: 'Rejection back below 3% from the second day. Hull cell test added to the weekly checklist.',
      resolvedDate: d(-31),
      exceptionKey: `quality:${d(-33)}:plating`,
    }),
    issue(2, {
      title: 'Export cartons out of stock',
      type: 'shortfall',
      severity: 'medium',
      stage: 'packing',
      detectedDate: d(-30),
      description: 'Packing ran at 70% because 5-ply export cartons were not available.',
      rootCause: 'Carton reorder level set for domestic volumes only.',
      correctiveAction: 'Raised export carton minimum stock to 3 days of consumption; approved a second carton vendor.',
      owner: 'Imran Khan (Packing)',
      dueDate: d(-28),
      status: 'resolved',
      resolution: 'Cartons received next morning; no recurrence since.',
      resolvedDate: d(-29),
    }),
    issue(3, {
      title: 'Thread rejection on basin-mixer bodies',
      type: 'quality',
      severity: 'high',
      stage: 'machining',
      detectedDate: d(-24),
      description: 'Machining rejection reached 7.2%; thread gauge failures on CNC-03/04.',
      rootCause: 'Worn carbide inserts from a new supplier batch; tool-life counter not enforced.',
      correctiveAction: 'Returned to approved insert supplier; tool change every 400 pieces enforced on CNC-03/04.',
      owner: 'Anil Sharma (Machining)',
      dueDate: d(-22),
      status: 'resolved',
      resolution: 'Rejection back to 1.5% within two days. Supplier batch returned.',
      resolvedDate: d(-22),
      exceptionKey: `quality:${d(-24)}:machining`,
    }),
    issue(4, {
      title: 'Plating line 2 rectifier failure',
      type: 'downtime',
      severity: 'critical',
      stage: 'plating',
      detectedDate: d(-16),
      description: 'Line 2 rectifier tripped in Shift A; 290 minutes lost and plating output fell to 42% of target.',
      rootCause: 'Rectifier control card burnt due to voltage fluctuation.',
      correctiveAction: 'Replaced control card; servo stabiliser installed; spare card now held in stores.',
      owner: 'Maintenance — Electrical',
      dueDate: d(-15),
      status: 'resolved',
      resolution: 'Line restored next morning; one shift of plating lost and recovered by Sunday overtime.',
      resolvedDate: d(-15),
      exceptionKey: `downtime:${d(-16)}:plating`,
    }),
    issue(5, {
      title: 'Polishing short of operators (festival leave)',
      type: 'shortfall',
      severity: 'high',
      stage: 'polishing',
      detectedDate: d(-10),
      description: 'Polishing ran at ~62% of target with 9 operators on leave.',
      rootCause: 'Leave approvals not staggered ahead of the festival.',
      correctiveAction: 'Moved 4 trained operators from assembly for 2 days; staggered leave roster for the festival period.',
      owner: 'HR + Production Manager',
      dueDate: d(-8),
      status: 'resolved',
      resolution: 'Output recovered to 96% by the third day.',
      resolvedDate: d(-8),
      exceptionKey: `shortfall:${d(-10)}:polishing`,
    }),
    issue(6, {
      title: 'Plating rejection rising — nickel bath suspected',
      type: 'quality',
      severity: 'high',
      stage: 'plating',
      detectedDate: d(-3),
      description: 'Rejection above 7% for consecutive days, dull patches on bib cocks. WIP building up before plating.',
      rootCause: 'Suspected bath contamination — Hull cell test result pending.',
      correctiveAction: 'Hull cell test; carbon treatment of nickel bath if confirmed (see ISS-0001).',
      owner: 'Pooja Meena (Plating)',
      dueDate: d(-1),
      status: 'in_progress',
      exceptionKey: `quality:${d(-3)}:plating`,
    }),
    issue(7, {
      title: 'Die change overrun on 400T forging press',
      type: 'downtime',
      severity: 'medium',
      stage: 'forging',
      detectedDate: d(-1),
      description: 'Die change took 150 minutes against a 60-minute standard.',
      rootCause: 'Die not pre-heated; clamping bolts searched for during change-over.',
      correctiveAction: 'Pre-heat next die during running batch; kit of clamps and bolts at the press (SMED checklist).',
      owner: 'Ramesh Yadav (Forging)',
      dueDate: addDays(d(0), 3),
      status: 'open',
      exceptionKey: `downtime:${d(-1)}:forging`,
    }),
    issue(8, {
      title: `Export order ${exportOrder.id} at risk`,
      type: 'order_risk',
      severity: 'high',
      orderId: exportOrder.id,
      detectedDate: d(-2),
      description: `${exportOrder.quantity.toLocaleString('en-IN')} wall mixers for Dubai held up behind the plating constraint.`,
      correctiveAction: 'Prioritise export lots in plating once bath is cleared; confirm vessel cut-off with sales.',
      owner: 'Production Planning',
      dueDate: addDays(d(0), 1),
      status: 'open',
      exceptionKey: `order_risk:${exportOrder.id}`,
    }),
  ];

  const db: DB = {
    version: 1,
    meta: { demoData: true, seededAt: new Date().toISOString(), anchorDate: end },
    settings,
    products: structuredClone(DEMO_PRODUCTS),
    orders,
    entries,
    issues,
    briefs: [],
    ai: defaultAiState(),
    eng: emptyEngState(),
  };

  // A few saved briefs so History has content.
  db.briefs = [-3, -2, -1].map((off, i) => {
    const b = generateBrief(db, d(off));
    return { id: `BR-${pad(i + 1)}`, date: b.date, headline: b.headline, markdown: b.markdown, whatsapp: b.whatsapp, generatedAt: `${b.date}T13:00:00.000Z`, source: 'demo' as const };
  });

  // Past assistant activity so the action log has history.
  const aiAction = (n: number, day: string, time: string, x: Omit<AiAction, 'id' | 'createdAt' | 'simulated' | 'source' | 'status'> & { status?: AiAction['status'] }): AiAction => ({
    id: `AI-${pad(n)}`,
    createdAt: `${day}T${time}:00.000Z`,
    status: 'completed',
    simulated: true,
    source: 'demo',
    ...x,
  });
  const recentBriefs = db.briefs.slice(-2);
  db.ai.actions = [
    aiAction(1, d(-3), '04:10', {
      prompt: 'Assign someone to the plating rejection problem',
      intent: 'assign',
      title: 'Assign corrective action: plating rejection',
      mode: 'approved',
      steps: [
        { tool: 'Exceptions', label: 'Scanned exceptions', detail: 'Plating rejection 7.1% (limit 4%) has no owner' },
        { tool: 'Incident memory', label: 'Searched past incidents', detail: 'ISS-0001 — bath contamination fixed by carbon treatment' },
        { tool: 'Action tracker', label: 'Drafted corrective action', detail: 'Hull cell test; carbon treatment if confirmed' },
        { tool: 'Action tracker', label: 'Assigned owner', detail: 'Pooja Meena (Plating), due in 2 days' },
        { tool: 'WhatsApp', label: 'Notified owner', detail: 'Message sent to Pooja Meena (simulated)' },
      ],
      result: 'Created ISS-0006 and assigned it to Pooja Meena (Plating).',
      link: '/exceptions?issue=ISS-0006',
    }),
    ...recentBriefs.map((b, i) =>
      aiAction(2 + i, b.date, '12:30', {
        prompt: 'Routine: daily brief to management (18:00 Mon–Sat)',
        intent: 'brief',
        title: `Send daily brief for ${fmtShortDate(b.date)}`,
        mode: 'autonomous',
        steps: [
          { tool: 'Production data', label: 'Collected shift reports', detail: `All stages reported for ${fmtShortDate(b.date)}` },
          { tool: 'Brief engine', label: 'Generated daily brief', detail: b.headline },
          { tool: 'WhatsApp', label: 'Sent to “Plant Management” group', detail: '4 recipients (simulated)' },
        ],
        result: `Brief for ${fmtShortDate(b.date)} shared with the management group.`,
        link: '/brief',
      }),
    ),
    aiAction(4, d(-2), '05:45', {
      prompt: `Can you move ${exportOrder.id} ahead of everything else?`,
      intent: 'expedite',
      title: `Re-sequence ${exportOrder.id}`,
      mode: 'rejected',
      status: 'cancelled',
      steps: [
        { tool: 'Orders', label: 'Found order', detail: `${exportOrder.id} — export, due ${exportOrder.dueDate}` },
        { tool: 'Planner', label: 'Proposed moving it to the front of the Plating queue' },
      ],
      result: 'Declined by user — plating bath under investigation, keep current sequence.',
    }),
  ];

  return db;
}
