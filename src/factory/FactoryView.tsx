import clsx from 'clsx';
import { AlertTriangle, Focus, Maximize, Minus, Plus, Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtShortDate } from '../../shared/dates';
import { Card, fmtN } from '../components/ui';
import { FactoryDetailPanel } from './FactoryDetailPanel';
import { FactoryScene, VIEWBOX } from './FactoryScene';
import { zoneColor } from './FactoryZone';
import { iso } from './iso';
import { center } from './layout';
import { buildFactoryModel, type OverviewSnapshot, type ZoneId } from './model';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

interface Camera {
  s: number;
  x: number;
  y: number;
}
const HOME: Camera = { s: 1, x: 0, y: 0 };
const PANEL_W = 380;

export function FactoryView({ data, shortfallPct }: { data: OverviewSnapshot; shortfallPct: number }) {
  const model = useMemo(() => buildFactoryModel(data, shortfallPct), [data, shortfallPct]);
  const [selected, setSelected] = useState<ZoneId | null>(null);
  const [hovered, setHovered] = useState<ZoneId | null>(null);
  const [showFlow, setShowFlow] = useState(true);
  const [focusIssues, setFocusIssues] = useState(false);
  const [cam, setCam] = useState<Camera>(HOME);
  const reduced = usePrefersReducedMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const [width, setWidth] = useState(1100);
  const wide = width >= 900;
  const labelScale = Math.min(1, Math.max(0.5, width / 1100));

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Pan/zoom so a zone sits in the middle of the area left visible by the docked panel. */
  const focusOn = useCallback(
    (id: ZoneId, scale = 1.25) => {
      const el = viewport.current;
      if (!el) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const [cu, cv] = center(id);
      const [x, y] = iso(cu, cv, 40);
      const px = ((x - VIEWBOX.x) / VIEWBOX.w) * W;
      const py = ((y - VIEWBOX.y) / VIEWBOX.h) * H;
      const visibleW = wide ? W - PANEL_W - 24 : W;
      setCam({ s: scale, x: visibleW / 2 - px * scale, y: H / 2 - py * scale });
    },
    [wide],
  );

  const select = useCallback(
    (id: ZoneId | null) => {
      if (drag.current?.moved) return;
      setSelected(id);
      if (id) focusOn(id);
      else setCam(HOME);
    },
    [focusOn],
  );

  // Changing date keeps the selection but re-reads the data; Escape closes the panel.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && select(null);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [select]);

  const zoom = (f: number) => {
    const el = viewport.current;
    if (!el) return;
    setCam((c) => {
      const s = Math.min(2.2, Math.max(0.8, c.s * f));
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      return { s, x: cx - ((cx - c.x) / c.s) * s, y: cy - ((cy - c.y) / c.s) * s };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, cam, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setCam({ ...d.cam, x: d.cam.x + dx, y: d.cam.y + dy });
  };
  const onPointerUp = () => {
    // Let the click handler see `moved` before clearing.
    setTimeout(() => (drag.current = null), 0);
  };

  const selectedZone = model.zones.find((z) => z.id === selected) ?? null;
  const bnZone = model.attention.find((z) => z.isBottleneck);

  return (
    <Card className="overflow-hidden">
      {/* Summary + controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-5 py-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-slate-900">Factory view</div>
          <div className="text-xs text-slate-500">
            Conceptual layout of the configured stages · {fmtShortDate(model.date)} shift reports · packed{' '}
            <span className="num font-medium text-slate-700">
              {fmtN(model.finishedOutput)} / {fmtN(model.finishedTarget)}
            </span>{' '}
            ({model.attainmentPct}%)
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton active={showFlow} onClick={() => setShowFlow((v) => !v)} label="Show flow paths">
            <Route className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={focusIssues} onClick={() => setFocusIssues((v) => !v)} label="Focus on issues">
            <Focus className="h-4 w-4" />
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <ToolButton onClick={() => zoom(1 / 1.2)} label="Zoom out">
            <Minus className="h-4 w-4" />
          </ToolButton>
          <ToolButton onClick={() => zoom(1.2)} label="Zoom in">
            <Plus className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            onClick={() => {
              setSelected(null);
              setCam(HOME);
            }}
            label="Fit to view"
          >
            <Maximize className="h-4 w-4" />
          </ToolButton>
        </div>
      </div>

      {/* Attention rail */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
        {!model.hasData ? (
          <span className="text-xs text-slate-500">No production recorded for this date — zones show no report.</span>
        ) : model.attention.length === 0 ? (
          <span className="text-xs text-green-700">All stages on plan — no constraint detected.</span>
        ) : (
          <>
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Needs attention</span>
            {model.attention.map((z) => {
              const color = zoneColor(z);
              return (
                <button
                  key={z.id}
                  onClick={() => select(z.id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-slate-50',
                    selected === z.id ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200',
                  )}
                >
                  {z.isBottleneck ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
                  <span className="text-slate-800">{z.name}</span>
                  <span className="text-slate-500">
                    {z.isBottleneck && model.bottleneck
                      ? `bottleneck · ${fmtN(model.bottleneck.queue)} waiting`
                      : z.condition === 'no_data'
                        ? 'no report'
                        : z.exceptions.find((e) => e.type === 'quality')
                          ? `rejection ${z.day.rejectRatePct}%`
                          : `${z.day.attainmentPct}% of plan`}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className={clsx('relative', wide && selectedZone && 'min-h-[560px]')}>
        {/* Viewport */}
        <div
          ref={viewport}
          className={clsx('relative overflow-hidden bg-[#eef1f5]', wide && 'pb-20', drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) select(null);
          }}
        >
          <div
            className="factory-camera origin-top-left"
            style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, transition: drag.current?.moved || reduced ? 'none' : 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          >
            <FactoryScene
              model={model}
              selected={selected}
              hovered={hovered}
              showFlow={showFlow}
              focusIssues={focusIssues}
              animate={!reduced}
              onSelect={(id) => select(id === selected ? null : id)}
              onHover={setHovered}
              labelScale={labelScale}
            />
          </div>

          {wide && <Legend style={selectedZone ? { maxWidth: `calc(100% - ${PANEL_W + 36}px)` } : undefined} />}
          {bnZone && !selected && wide && (
            <button
              onClick={() => select(bnZone.id)}
              className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white/95 px-3 py-2 text-left text-xs shadow-sm backdrop-blur hover:bg-amber-50"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span>
                <span className="font-semibold text-slate-900">{bnZone.name} is the constraint</span>
                <span className="block text-slate-500">
                  {fmtN(model.bottleneck!.queue)} units waiting · {model.bottleneck!.daysOfWork} days of plan — click to inspect
                </span>
              </span>
            </button>
          )}
        </div>

        {!wide && <Legend className="m-3" />}

        {/* Detail panel: docked over the scene on wide screens, below it on narrow ones */}
        {selectedZone && (
          <div className={clsx(wide ? 'absolute top-3 right-3 bottom-3 z-30' : 'border-t border-slate-100 p-3')} style={wide ? { width: PANEL_W } : undefined}>
            <div className={clsx(wide ? 'h-full' : 'h-[520px]', 'panel-in')}>
              <FactoryDetailPanel key={selectedZone.id} zone={selectedZone} model={model} shortfallPct={shortfallPct} onClose={() => select(null)} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ToolButton({ children, onClick, label, active }: { children: React.ReactNode; onClick: () => void; label: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx('rounded-lg p-1.5 transition-colors', active ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}
    >
      {children}
    </button>
  );
}

function Legend({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur', className ?? 'pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-24px)]')}
      style={style}
    >
      {(
        [
          ['On plan', '#0ca30c'],
          ['Needs attention', '#fab219'],
          ['Critical', '#d03b3b'],
          ['Bottleneck', '#f59e0b'],
          ['No report / illustrative', '#94a3b8'],
        ] as const
      ).map(([l, c]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: c }} />
          {l}
        </span>
      ))}
      <span className="w-full text-[10px] text-slate-400">
        Layout and equipment are schematic, not to scale. Flow animation illustrates daily shift-report figures — not live tracking. Crates beside conveyors = WIP waiting (≈5 per day of plan).
      </span>
    </div>
  );
}
