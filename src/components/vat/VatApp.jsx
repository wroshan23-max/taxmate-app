// V64 — VAT Invoice & RAMIS add-on: the whole module for one business (client portal, team members and TaxMate admin)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, FileText, Users, Package, Wallet, Landmark, Inbox, BarChart3, Settings as Cog, Crown, ShieldCheck, AlertTriangle, Plus, History, BookOpen } from 'lucide-react';
import { vatContext, loadSettings, loadRates, loadCustomers, loadItems, loadBranches, loadDocs } from '../../lib/vat/api';
import { setLocale, t } from '../../lib/vat/i18n';
import { SUBSCRIPTION, ROLES, dmy } from '../../lib/vat/format';
import { Badge, Spinner } from './ui';
import Dashboard from './Dashboard';
import DocList from './DocList';
import DocEditor from './DocEditor';
import DocView from './DocView';
import Customers from './Customers';
import Items from './Items';
import Payments from './Payments';
import Ramis from './Ramis';
import Purchases from './Purchases';
import Reports from './Reports';
import Settings from './Settings';
import Subscription from './Subscription';
import Audit from './Audit';
import Guide from './Guide';

const NAV = [
  { v: 'dashboard', icon: LayoutDashboard, k: 'nav.dashboard' },
  { v: 'docs', icon: FileText, k: 'nav.invoices', sub: [['all', 'nav.all'], ['tax', 'nav.tax'], ['nontax', 'nav.nontax'], ['credit', 'nav.credit'], ['debit', 'nav.debit']] },
  { v: 'customers', icon: Users, k: 'nav.customers' },
  { v: 'items', icon: Package, k: 'nav.items' },
  { v: 'payments', icon: Wallet, k: 'nav.payments' },
  { v: 'ramis', icon: Landmark, k: 'nav.vat', sub: [['dashboard', 'nav.ramis'], ['schedules', 'nav.schedules'], ['history', 'nav.history'], ['failed', 'nav.failed']] },
  { v: 'purchases', icon: Inbox, k: 'nav.purchases' },
  { v: 'reports', icon: BarChart3, k: 'nav.reports' },
  { v: 'audit', icon: History, k: 'nav.audit', perm: 'reports' },
  { v: 'settings', icon: Cog, k: 'nav.settings' },
  { v: 'subscription', icon: Crown, k: 'nav.subscription' },
  { v: 'guide', icon: BookOpen, k: 'nav.guide', live: true },   // V64.2 — only while the add-on is switched on
];
const LIVE = ['trial', 'active', 'past_due', 'paused', 'suspended'];

/**
 * clientId  the business (tenant)
 * syncUrl   keep the open screen in the address bar (?v=…&doc=…) — client portal / workspace
 */
export default function VatApp({ clientId, syncUrl = false }) {
  const [sp, setSp] = useSearchParams();
  const [local, setLocal] = useState({ v: 'dashboard' });
  const nav = syncUrl ? Object.fromEntries(sp.entries()) : local;
  const view = nav.doc ? 'doc' : (nav.v || 'dashboard');

  const go = useCallback((v, params = {}) => {
    const next = { v, ...Object.fromEntries(Object.entries(params).filter(([, x]) => x != null && x !== '')) };
    if (syncUrl) {
      const keep = {};
      for (const k of ['member']) if (sp.get(k)) keep[k] = sp.get(k);
      setSp({ ...keep, ...next });
    } else setLocal(next);
    window.scrollTo?.({ top: 0 });
  }, [syncUrl, sp, setSp]);
  const openDoc = useCallback((id) => go('doc', { doc: id }), [go]);

  const [ctx, setCtx] = useState(null);
  const [err, setErr] = useState(null);
  const [data, setData] = useState({ settings: null, rates: [], customers: [], items: [], branches: [], docs: [] });
  const [tick, setTick] = useState(0);

  const reloadCtx = useCallback(() => vatContext(clientId).then(setCtx).catch((e) => setErr(e.message)), [clientId]);
  const reload = useCallback(async (what = ['settings', 'customers', 'items', 'branches', 'docs']) => {
    const w = new Set(what);
    const [settings, customers, items, branches, docs] = await Promise.all([
      w.has('settings') ? loadSettings(clientId) : undefined,
      w.has('customers') ? loadCustomers(clientId) : undefined,
      w.has('items') ? loadItems(clientId) : undefined,
      w.has('branches') ? loadBranches(clientId) : undefined,
      w.has('docs') ? loadDocs(clientId) : undefined,
    ].map((p) => Promise.resolve(p).catch(() => undefined)));
    setData((d) => ({
      ...d, ...(settings !== undefined && { settings }), ...(customers && { customers }), ...(items && { items }), ...(branches && { branches }), ...(docs && { docs }),
    }));
    setTick((x) => x + 1);
  }, [clientId]);

  useEffect(() => {
    setCtx(null); setErr(null);
    reloadCtx();
    reload();
    loadRates().then((rates) => setData((d) => ({ ...d, rates }))).catch(() => {});
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLocale(data.settings?.locale || 'en'); }, [data.settings?.locale]);

  const can = useCallback((p) => !!ctx?.perms?.[p], [ctx]);
  const app = useMemo(() => ({ clientId, ctx, can, data, reload, reloadCtx, go, openDoc, nav, tick }), [clientId, ctx, can, data, reload, reloadCtx, go, openDoc, nav, tick]);

  if (err) return <div className="card p-6 text-sm text-red-700"><AlertTriangle className="inline -mt-0.5" size={16} /> {err}</div>;
  if (!ctx) return <Spinner />;

  const st = ctx.status;
  const writable = ['trial', 'active', 'past_due'].includes(st) || ctx.role === 'taxmate';
  const noAddon = st === 'none' && ctx.role !== 'taxmate' && !data.docs.length;

  const navBtn = (item) => {
    const active = view === item.v || (view === 'doc' && item.v === 'docs') || (['new', 'edit'].includes(view) && item.v === 'docs');
    return (
      <div key={item.v}>
        <button type="button" onClick={() => go(item.v)}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-primary-50 text-primary-800' : 'text-gray-600 hover:bg-gray-50'}`}>
          <item.icon size={16} /> {t(item.k)}
        </button>
        {active && item.sub && (
          <div className="ml-7 mt-0.5 space-y-0.5 border-l border-gray-100 pl-2">
            {item.sub.map(([k, lk]) => {
              const on = item.v === 'docs' ? (nav.type || 'all') === k : (nav.tab || 'dashboard') === k;
              return <button key={k} type="button" onClick={() => go(item.v, item.v === 'docs' ? { type: k === 'all' ? null : k } : { tab: k })}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${on ? 'font-semibold text-primary-700' : 'text-gray-500 hover:text-gray-800'}`}>{t(lk)}</button>;
            })}
          </div>
        )}
      </div>
    );
  };

  const guideOn = LIVE.includes(st) || ctx.role === 'taxmate';
  const navItems = NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.live || guideOn));
  let body;
  if (noAddon && view !== 'subscription') body = <Subscription app={app} intro />;
  else if (view === 'dashboard') body = <Dashboard app={app} />;
  else if (view === 'docs') body = <DocList app={app} />;
  else if (view === 'new') body = <DocEditor key={`new-${nav.type}-${nav.original || ''}`} app={app} type={nav.type || 'tax'} originalId={nav.original} />;
  else if (view === 'edit') body = <DocEditor key={`edit-${nav.id}`} app={app} draftId={nav.id} />;
  else if (view === 'doc') body = <DocView key={nav.doc} app={app} docId={nav.doc} />;
  else if (view === 'customers') body = <Customers app={app} />;
  else if (view === 'items') body = <Items app={app} />;
  else if (view === 'payments') body = <Payments app={app} />;
  else if (view === 'ramis') body = <Ramis app={app} />;
  else if (view === 'purchases') body = <Purchases app={app} />;
  else if (view === 'reports') body = <Reports app={app} />;
  else if (view === 'audit') body = <Audit app={app} />;
  else if (view === 'settings') body = <Settings app={app} />;
  else if (view === 'subscription') body = <Subscription app={app} />;
  else if (view === 'guide' && guideOn) body = <Guide app={app} />;
  else body = <Dashboard app={app} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-primary-800 sm:text-2xl"><FileText size={22} /> {t('app.title')}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            <span className="truncate font-medium text-gray-700">{data.settings?.trading_name || data.settings?.legal_name || ctx.client_name}</span>
            <Badge meta={SUBSCRIPTION[st]}>{SUBSCRIPTION[st]?.label}{ctx.addon?.cycle && st !== 'none' ? ` · ${ctx.addon.cycle}` : ''}{st === 'trial' && ctx.addon?.trial_ends ? ` · until ${dmy(ctx.addon.trial_ends)}` : ''}</Badge>
            <Badge><ShieldCheck size={11} /> {ROLES[ctx.role] || ctx.role}</Badge>
          </div>
        </div>
        {writable && !noAddon && (can('create') || can('credit_note')) && (
          <div className="flex flex-wrap gap-1.5">
            {can('create') && <button type="button" onClick={() => go('new', { type: data.settings?.vat_registered ? 'tax' : 'nontax' })} className="btn-primary px-3 py-1.5 text-sm"><Plus size={15} /> {data.settings?.vat_registered ? t('act.new_tax') : t('act.new_nontax')}</button>}
            {can('create') && data.settings?.vat_registered && <button type="button" onClick={() => go('new', { type: 'nontax' })} className="btn-secondary border px-3 py-1.5 text-sm">{t('act.new_nontax')}</button>}
          </div>
        )}
      </div>

      {!writable && !noAddon && (
        <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={15} className="-mt-0.5 inline" /> The VAT Invoice add-on is <b>{SUBSCRIPTION[st]?.label?.toLowerCase()}</b>. Your invoices, notes and reports stay available to view and download; creating or changing documents needs an active subscription.
          <button type="button" onClick={() => go('subscription')} className="ml-2 font-semibold underline">Subscription</button>
        </div>
      )}
      {st === 'past_due' && <div className="card border-orange-200 bg-orange-50 p-3 text-sm text-orange-900"><AlertTriangle size={15} className="-mt-0.5 inline" /> Your VAT Invoice subscription payment is overdue. Please pay the TaxMate invoice to avoid suspension.</div>}
      {writable && !noAddon && !ctx.setup_done && view !== 'settings' && can('settings') && (
        <div className="card border-primary-200 bg-primary-50 p-3 text-sm text-primary-900">
          Start with <b>Settings → Company &amp; VAT</b>: your registered name, TIN, VAT registration and address appear on every tax invoice.
          <button type="button" onClick={() => go('settings')} className="ml-2 font-semibold underline">Open setup</button>
          {guideOn && <button type="button" onClick={() => go('guide')} className="ml-3 inline-flex items-center gap-1 font-semibold underline"><BookOpen size={13} /> {t('nav.guide')}</button>}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row">
        {!noAddon && (
          <>
            <div className="lg:hidden">
              <select className="input" value={view === 'doc' || view === 'new' || view === 'edit' ? 'docs' : view} onChange={(e) => go(e.target.value)} aria-label="Section">
                {navItems.map((n) => <option key={n.v} value={n.v}>{t(n.k)}</option>)}
              </select>
            </div>
            <nav className="hidden w-52 shrink-0 space-y-0.5 lg:block">
              <div className="card sticky top-3 p-2">{navItems.map((n) => navBtn(n))}</div>
            </nav>
          </>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          {body}
          <p className="px-1 text-[11px] leading-snug text-gray-400">{t('disclaimer')} TaxMate is not the IRD; an approval in TaxMate is not an IRD approval.</p>
        </div>
      </div>
    </div>
  );
}
