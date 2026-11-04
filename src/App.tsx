import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  DraftingCompass,
  FileStack,
  Gauge,
  ScanSearch,
  ClipboardList,
  FileText,
  Factory,
  History as HistoryIcon,
  LayoutDashboard,
  Lock,
  Menu,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings as SettingsIcon,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { fmtDate } from '../shared/dates';
import { AssistantProvider } from './ai/AssistantContext';
import { AssistantDrawer } from './ai/AssistantDrawer';
import Assistant from './pages/Assistant';
import AiReview from './eng/AiReview';
import DrawingsLibrary from './eng/DrawingsLibrary';
import DrawingViewer from './eng/DrawingViewer';
import Inspections from './eng/Inspections';
import QcPlans from './eng/QcPlans';
import DailyBrief from './pages/DailyBrief';
import Exceptions from './pages/Exceptions';
import FutureModule from './pages/FutureModule';
import History from './pages/History';
import OrderDetail from './pages/OrderDetail';
import Orders from './pages/Orders';
import Overview from './pages/Overview';
import ProductionUpdates from './pages/ProductionUpdates';
import Settings from './pages/Settings';
import { AppProvider, useApp } from './state';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/assistant', label: 'AI Copilot', icon: Sparkles },
  { to: '/production', label: 'Production Updates', icon: ClipboardList },
  { to: '/orders', label: 'Orders & Stages', icon: Factory },
  { to: '/exceptions', label: 'Exceptions & Actions', icon: AlertTriangle },
  { to: '/brief', label: 'Daily Brief', icon: FileText },
  { to: '/history', label: 'History', icon: HistoryIcon },
];

const ENG = [
  { to: '/eng/drawings', label: 'Drawings Library', icon: FileStack },
  { to: '/eng/review', label: 'AI Drawing Review', icon: ScanSearch },
  { to: '/eng/plans', label: 'QC Inspection Plans', icon: ClipboardCheck },
  { to: '/eng/inspections', label: 'Inspection Results', icon: Gauge },
];
const ENG_OPEN_KEY = 'everyse.sidebar.eng';

const FUTURE = [
  { to: '/modules/po-price-verification', label: 'PO Price Verification', icon: Receipt },
  { to: '/modules/assembly-material-planning', label: 'Assembly Material Planning', icon: PackageSearch },
];

const COLLAPSE_KEY = 'everyse.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Nav item. When the sidebar is collapsed it shows only the icon, with a tooltip on hover/focus. */
function NavItem({ to, label, icon: Icon, end, collapsed, locked, onNavigate }: { to: string; label: string; icon: LucideIcon; end?: boolean; collapsed: boolean; locked?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex items-center rounded-xl py-2 text-sm font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
          isActive ? 'bg-amber-50 text-slate-900 ring-1 ring-amber-200/70' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      <span className="relative shrink-0">
        <Icon className="h-[18px] w-[18px]" />
        {locked && collapsed && (
          <span className="absolute -right-1.5 -bottom-1 rounded-full bg-white p-px">
            <Lock className="h-2.5 w-2.5 text-slate-400" />
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {label}
          {locked && <span className="text-slate-400"> · planned</span>}
        </span>
      )}
    </NavLink>
  );
}

/** Expandable "Engineering & QC" section. Collapsed sidebar shows its pages as icons under a divider. */
function EngGroup({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const inEng = pathname.startsWith('/eng');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ENG_OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(ENG_OPEN_KEY, o ? '0' : '1');
      } catch {
        /* session only */
      }
      return !o;
    });
  if (collapsed)
    return (
      <>
        <div className="mx-2 my-3 border-t border-slate-200" role="separator" aria-label="Engineering & QC" />
        {ENG.map((n) => (
          <NavItem key={n.to} {...n} collapsed onNavigate={onNavigate} />
        ))}
      </>
    );
  const expanded = open || inEng;
  return (
    <div className="pt-2">
      <button
        onClick={toggle}
        aria-expanded={expanded}
        className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors', inEng ? 'text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
      >
        <DraftingCompass className="h-[18px] w-[18px]" />
        <span className="flex-1 text-left">Engineering & QC</span>
        <ChevronDown className={clsx('h-4 w-4 text-slate-400 transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-1 ml-[21px] space-y-1 border-l border-slate-200 pl-2">
          {ENG.map((n) => (
            <NavItem key={n.to} {...n} collapsed={false} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggle = onToggle && (
    <button
      onClick={onToggle}
      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <ToggleIcon className="h-[18px] w-[18px]" />
    </button>
  );
  return (
    <div className="flex h-full flex-col">
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 pt-5 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-base font-semibold text-amber-400" title="Everyse Factory Operations Copilot">
            E
          </div>
          {toggle}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2 pt-6 pr-3 pb-5 pl-5">
          <div className="min-w-0">
            <div className="text-[19px] font-semibold tracking-[0.32em] text-slate-900">EVERYSE</div>
            <div className="mt-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase">Factory Operations Copilot</div>
          </div>
          {toggle}
        </div>
      )}
      {/* Collapsed: no scroll container, so tooltips can extend past the sidebar edge. */}
      <nav className={clsx('flex-1 space-y-1 px-3', collapsed ? 'overflow-visible' : 'overflow-y-auto')} aria-label="Main">
        {NAV.map((n) => (
          <NavItem key={n.to} {...n} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        <EngGroup collapsed={collapsed} onNavigate={onNavigate} />
        {collapsed ? (
          <div className="mx-2 my-4 border-t border-slate-200" role="separator" aria-label="Planned modules" />
        ) : (
          <div className="px-3 pt-6 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Planned modules</div>
        )}
        {FUTURE.map((n) => (
          <NavItem key={n.to} {...n} locked collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <NavItem to="/settings" label="Settings & data" icon={SettingsIcon} collapsed={collapsed} onNavigate={onNavigate} />
        {!collapsed && <p className="px-3 pt-3 text-[11px] text-slate-400">v0.1 · interactive MVP demo</p>}
      </div>
    </div>
  );
}

function Shell() {
  const { meta, toasts } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable — still works for this session */
      }
      return !c;
    });
  const loc = useLocation();
  return (
    <div className="flex min-h-full">
      <aside
        className={clsx('sidebar-width sticky top-0 z-40 hidden h-screen shrink-0 border-r border-slate-200 bg-white lg:block', collapsed ? 'w-[72px]' : 'w-64')}
        data-collapsed={collapsed || undefined}
      >
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-5 right-3 p-1 text-slate-500" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur lg:px-8">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{meta?.settings.plantName ?? 'Loading…'}</div>
          {meta?.demoData && (
            <span
              className="hidden items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 ring-inset sm:inline-flex"
              title="All orders, figures, names and incidents are synthetic. Replace via Settings → Clear data, then import real records."
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Demo data — synthetic, not Galaxy Taps records
            </span>
          )}
          {meta && <div className="hidden text-xs text-slate-500 md:block">{fmtDate(meta.today, true)}</div>}
        </header>
        <main key={loc.pathname.split('/')[1]} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
          {meta?.demoData && (
            <div className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 sm:hidden">Demo data — synthetic, not Galaxy Taps records</div>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/production" element={<ProductionUpdates />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/exceptions" element={<Exceptions />} />
            <Route path="/brief" element={<DailyBrief />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/eng" element={<Navigate to="/eng/drawings" replace />} />
            <Route path="/eng/drawings" element={<DrawingsLibrary />} />
            <Route path="/eng/drawings/:revId" element={<DrawingViewer />} />
            <Route path="/eng/review" element={<AiReview />} />
            <Route path="/eng/plans" element={<QcPlans />} />
            <Route path="/eng/plans/:id" element={<QcPlans />} />
            <Route path="/eng/inspections" element={<Inspections />} />
            <Route path="/eng/inspections/:id" element={<Inspections />} />
            <Route path="/modules/:slug" element={<FutureModule />} />
            <Route path="*" element={<div className="py-20 text-center text-slate-500">Page not found.</div>} />
          </Routes>
        </main>
      </div>
      <AssistantDrawer />
      <div className="fixed right-4 bottom-20 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg', t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AssistantProvider>
        <Shell />
      </AssistantProvider>
    </AppProvider>
  );
}
