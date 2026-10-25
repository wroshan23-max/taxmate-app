import { Suspense, useEffect, useState } from 'react';
import PageLoader from './PageLoader';
import { supabase } from '../lib/supabase';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { logActivity } from '../lib/activity';
import { useUnreadMessages } from '../lib/messages';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Calculator, FileText, Receipt,
  LogOut, Menu, X, User, Bell, Megaphone, Landmark, Percent, Wallet, CalendarDays, Gift, FolderLock, MessageCircle, ShieldCheck,
  Zap, CalendarCheck, Globe, Crown, Hash, Users,
} from 'lucide-react';
import { websiteUrl } from '../lib/firm';
import NotificationBell from './NotificationBell';
import MobileDrawer from './MobileDrawer';
import { PlanAvatar, PlanBadge } from './PlanBadge';
import { myActivePlan, myPayrollAccess, planStyle } from '../lib/plans';

const nav = [
  { to: '/client', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/client/calculations', icon: Calculator, label: 'My Calculations' },
  { to: '/client/quick-tax', icon: Zap, label: 'Quick Tax Check', feature: 'quick_tax' },
  { to: '/client/tax-calculator', icon: Percent, label: 'Tax Calculator', feature: 'tax_calculator' },
  { to: '/client/income', icon: Wallet, label: 'Monthly Income', feature: 'income_sheets' },
  { to: '/client/calendar', icon: CalendarDays, label: 'Tax Calendar', feature: 'tax_calendar' },
  { to: '/client/ird-codes', icon: Hash, label: 'IRD Payment Codes', feature: 'ird_codes' },
  { to: '/client/invite', icon: Gift, label: 'Invite Friends', feature: 'referrals' },
  { to: '/client/services', icon: CalendarCheck, label: 'Book a Service', feature: 'services' },
  { to: '/client/plan', icon: Crown, label: 'My Plan', feature: 'plans' },
  { to: '/client/payroll', icon: Users, label: 'Payroll', feature: 'payroll' },
  { to: '/client/documents', icon: FolderLock, label: 'My Documents', feature: 'documents' },
  { to: '/client/tax-returns', icon: FileText, label: 'Tax Returns' },
  { to: '/client/assets', icon: Landmark, label: 'Assets & Liabilities' },
  { to: '/client/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/client/updates', icon: Megaphone, label: 'Tax Updates' },
  { to: '/client/profile', icon: User, label: 'My Profile' },
  { to: '/client/security', icon: ShieldCheck, label: 'Security' },
];

export default function ClientLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  // Features switched on by TaxMate (Tax Calculator on/off, Monthly Income sheet enabled)
  const [features, setFeatures] = useState({ quick_tax: true, tax_calculator: true, tax_calendar: true, ird_codes: true, reminders: true, referrals: true, documents: true, return_tracker: true, messages: true, services: true, summary_letters: true, plans: true, tax_reviews: true, income_sheets: 0, loaded: false });
  useEffect(() => {
    supabase.rpc('my_portal_features').then(({ data }) => { if (data) setFeatures({ ...data, loaded: true }); else setFeatures(f => ({ ...f, loaded: true })); });
  }, [profile?.id]);
  // Active monthly plan → member look (sidebar avatar, header badge, dashboard)
  const [plan, setPlan] = useState(null);
  useEffect(() => { if (profile?.id) myActivePlan().then(setPlan).catch(() => {}); }, [profile?.id]);
  // Payroll menu: plan includes it or the add-on is active
  const [payrollOn, setPayrollOn] = useState(false);
  useEffect(() => { if (profile?.id) myPayrollAccess().then(a => setPayrollOn(!!a?.on)).catch(() => {}); }, [profile?.id]);
  const feats = { ...features, payroll: payrollOn };
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const unread = useUnreadMessages('client', features.messages !== false);
  // usage stats for TaxMate (page opened + "online now" heartbeat)
  useEffect(() => { logActivity('view', loc.pathname); }, [loc.pathname]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') logActivity('ping'); }, 60000);
    return () => clearInterval(t);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const Sidebar = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 py-5 border-b border-primary-700">
        <div className="text-2xl font-black text-white">
          Tax<span className="text-gold-500">Mate</span>
        </div>
        <div className="text-primary-300 text-xs mt-0.5">Client Portal</div>
      </div>

      <nav className="flex-1 min-h-0 py-3 space-y-0.5 overflow-y-auto overscroll-contain px-2">
        {nav.filter(n => !n.feature || feats[n.feature]).map(({ to, icon: Icon, label, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-gold-500 text-primary-900 font-semibold'
                  : 'text-primary-200 hover:bg-primary-700 hover:text-white'
              }`
            }
          >
            <Icon size={17} />
            <span className="flex-1">{label}</span>
            {badge && unread > 0 && <span className="text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 min-w-[18px] text-center">{unread}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-primary-700">
        <NavLink to="/client/plan" onClick={() => setOpen(false)} title={plan ? `${plan.plan_name} plan` : undefined}
          className={`flex items-center gap-3 px-3 py-2 mb-1 rounded-xl ${plan && planStyle(plan.plan_key).tier >= 3 ? 'bg-gradient-to-r from-white/10 to-transparent ring-1 ring-white/10' : ''}`}>
          <PlanAvatar name={profile?.full_name || 'C'} plan={plan} plain="bg-gold-500 text-primary-900" />
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs font-semibold truncate">{profile?.full_name ?? 'Client'}</div>
            {plan
              ? <div className={`text-xs font-semibold truncate ${plan.plan_key === 'premium' ? 'text-gold-400' : 'text-primary-200'}`}>{planStyle(plan.plan_key).emoji} {plan.plan_name} member</div>
              : <div className="text-primary-400 text-xs">Client Account</div>}
          </div>
        </NavLink>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-primary-300 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700 w-full transition-colors"
        >
          <LogOut size={14} />
          Sign Out
        </button>
        <a href={websiteUrl()} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 text-primary-300 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700 w-full transition-colors">
          <Globe size={14} />
          TaxMate website
        </a>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className="hidden md:flex flex-col w-56 lg:w-64 bg-primary-800 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile menu — slides in (swipe from the left edge or tap ☰) */}
      <MobileDrawer open={open} setOpen={setOpen}>
        <div className="absolute top-4 right-4 z-10" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <button onClick={() => setOpen(false)} className="text-primary-300 hover:text-white p-1" aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <Sidebar />
      </MobileDrawer>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setOpen(true)} className="md:hidden text-gray-500 hover:text-gray-700 relative">
            <Menu size={20} />
          </button>
          <div className="md:hidden text-lg font-black text-primary-700">
            Tax<span className="text-gold-500">Mate</span>
          </div>
          <div className="flex-1" />
          <NotificationBell />
          {features.messages !== false && (
            <NavLink to="/client/messages" title="Messages" className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100">
              <MessageCircle size={19} />
              {unread > 0 && <span className="absolute top-0.5 right-0.5 text-[9px] font-black bg-red-500 text-white rounded-full px-1 min-w-[15px] text-center">{unread}</span>}
            </NavLink>
          )}
          <div className="text-xs text-gray-500 hidden sm:block">
            Welcome, {profile?.full_name?.split(' ')[0] ?? 'Client'}
          </div>
          {plan && <NavLink to="/client/plan" title="My Plan"><PlanBadge plan={plan} compact /></NavLink>}
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Suspense fallback={<PageLoader />}><Outlet context={{ ...feats, myPlan: plan }} /></Suspense>
        </main>
      </div>
    </div>
  );
}
