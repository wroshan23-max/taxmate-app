import { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazyPage, whenIdle } from './lib/lazyPage';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import { MfaChallengeScreen, MfaSetupScreen } from './components/TwoFactor';
import { useSettings } from './contexts/SettingsContext';
import AdminLayout from './components/AdminLayout';
import ClientLayout from './components/ClientLayout';

// Pages load on demand (smaller first download on phones). lazyPage() also lets us preload.
const SharedDocument = lazyPage(() => import('./pages/SharedDocument'));
const Register = lazyPage(() => import('./pages/Register'));
const AdminMessages = lazyPage(() => import('./pages/admin/Messages'));
const Activity = lazyPage(() => import('./pages/admin/Activity'));
const ClientMessages = lazyPage(() => import('./pages/client/ClientMessages'));
const ClientSecurity = lazyPage(() => import('./pages/client/ClientSecurity'));
const Settings = lazyPage(() => import('./pages/admin/Settings'));
const Dashboard = lazyPage(() => import('./pages/admin/Dashboard'));
const Clients = lazyPage(() => import('./pages/admin/Clients'));
const ClientDetail = lazyPage(() => import('./pages/admin/ClientDetail'));
const Calculator = lazyPage(() => import('./pages/admin/Calculator'));
const TaxReturns = lazyPage(() => import('./pages/admin/TaxReturns'));
const Invoices = lazyPage(() => import('./pages/admin/Invoices'));
const UpdateRequests = lazyPage(() => import('./pages/admin/UpdateRequests'));
const TaxUpdates = lazyPage(() => import('./pages/admin/TaxUpdates'));
const AssetStatements = lazyPage(() => import('./pages/admin/AssetStatements'));
const ClientAssets = lazyPage(() => import('./pages/client/ClientAssets'));
const ClientTaxCalculator = lazyPage(() => import('./pages/client/ClientTaxCalculator'));
const ClientIncome = lazyPage(() => import('./pages/client/ClientIncome'));
const ClientInvite = lazyPage(() => import('./pages/client/ClientInvite'));
const ClientDocuments = lazyPage(() => import('./pages/client/ClientDocuments'));
const ClientQuickTax = lazyPage(() => import('./pages/client/ClientQuickTax'));
const PublicCalculator = lazyPage(() => import('./pages/PublicCalculator'));
const PublicIrdCodes = lazyPage(() => import('./pages/PublicIrdCodes'));
const IrdCodes = lazyPage(() => import('./pages/admin/IrdCodes'));
const ClientIrdCodes = lazyPage(() => import('./pages/client/ClientIrdCodes'));
const VerifyLetter = lazyPage(() => import('./pages/VerifyLetter'));
const AdminPayments = lazyPage(() => import('./pages/admin/Payments'));
const AdminSubscriptions = lazyPage(() => import('./pages/admin/Subscriptions'));
const ClientPlan = lazyPage(() => import('./pages/client/ClientPlan'));
const ClientPayroll = lazyPage(() => import('./pages/client/ClientPayroll'));
const ServiceRequests = lazyPage(() => import('./pages/admin/ServiceRequests'));
const ClientServices = lazyPage(() => import('./pages/client/ClientServices'));
const TaxCalendar = lazyPage(() => import('./pages/TaxCalendar'));
const ClientDashboard = lazyPage(() => import('./pages/client/ClientDashboard'));
const ClientCalculations = lazyPage(() => import('./pages/client/ClientCalculations'));
const ClientTaxReturns = lazyPage(() => import('./pages/client/ClientTaxReturns'));
const ClientInvoices = lazyPage(() => import('./pages/client/ClientInvoices'));
const ClientProfile = lazyPage(() => import('./pages/client/ClientProfile'));
const ClientTaxUpdates = lazyPage(() => import('./pages/client/ClientTaxUpdates'));
const InvitePage = lazyPage(() => import('./pages/AccountLinks').then(m => ({ default: m.InvitePage })));
const ResetPasswordPage = lazyPage(() => import('./pages/AccountLinks').then(m => ({ default: m.ResetPasswordPage })));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-primary-600">
      <div className="text-center text-white">
        <div className="text-2xl font-black mb-2">
          Tax<span className="text-gold-500">Mate</span>
        </div>
        <div className="text-sm opacity-70">Loading...</div>
      </div>
    </div>
  );
}

function ProtectedAdmin({ children }) {
  const { user, isAdmin, loading, needsCode, has2fa, mfa } = useAuth();
  const loc = useLocation();
  if (loading || (user && !mfa.loaded)) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (needsCode) return <MfaChallengeScreen />;
  if (!isAdmin) return <Navigate to="/client" replace />;
  if (!has2fa) return <MfaSetupScreen />;          // admins must use two-step login
  return children;
}

function ProtectedClient({ children }) {
  const { user, isClient, loading, needsCode, mfa } = useAuth();
  const loc = useLocation();
  if (loading || (user && !mfa.loaded)) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (needsCode) return <MfaChallengeScreen />;
  if (!isClient) return <Navigate to="/admin" replace />;
  return children;
}

function RootRedirect() {
  const { user, isAdmin, isClient, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (isClient) return <Navigate to="/client" replace />;
  return <Navigate to="/login" replace />;
}

// Fetch the pages people open first in the background, so they appear instantly
function Preload() {
  const { user, isAdmin, isClient } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!user) {
      if (pathname === '/login') whenIdle(() => { ClientDashboard.preload(); Dashboard.preload(); });
      return;
    }
    if (isClient) {
      ClientDashboard.preload();
      whenIdle(() => [ClientDocuments, ClientTaxReturns, ClientInvoices, ClientCalculations, ClientMessages].forEach(c => c.preload()));
    }
    if (isAdmin) {
      Dashboard.preload();
      whenIdle(() => [Clients, ClientDetail, TaxReturns, Invoices, Calculator].forEach(c => c.preload()));
    }
  }, [user, isAdmin, isClient, pathname]);
  return null;
}

export default function App() {
  useSettings();   // re-render pages when firm / invoice settings load or change
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Preload />
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      {/* Public: one document shared by secure link (WhatsApp / email) */}
      <Route path="/share/:token" element={<SharedDocument />} />
      {/* Public: create password from an invite / reset link */}
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      {/* Public: new client fills in their own details from a one-time link */}
      <Route path="/register/:token" element={<Register />} />
      {/* Public: reusable link for Facebook / flyers (e.g. /join/fb) */}
      <Route path="/join/:code" element={<Register />} />
      <Route path="/calculator" element={<PublicCalculator />} />
      <Route path="/ird-codes" element={<PublicIrdCodes />} />
      <Route path="/verify/:ref" element={<VerifyLetter />} />
      <Route path="/tax-calculator" element={<PublicCalculator />} />

      {/* Admin routes */}
      <Route path="/admin" element={
        <ProtectedAdmin><AdminLayout /></ProtectedAdmin>
      }>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="calculator" element={<Calculator />} />
        <Route path="tax-returns" element={<TaxReturns />} />
        <Route path="assets" element={<AssetStatements />} />
        <Route path="calendar" element={<TaxCalendar role="admin" />} />
        <Route path="ird-codes" element={<IrdCodes />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="requests" element={<UpdateRequests />} />
        <Route path="updates" element={<TaxUpdates />} />
        <Route path="messages" element={<AdminMessages />} />
        <Route path="activity" element={<Activity />} />
        <Route path="payments" element={<AdminPayments />} />
        <Route path="subscriptions" element={<AdminSubscriptions />} />
        <Route path="service-requests" element={<ServiceRequests />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Client routes */}
      <Route path="/client" element={
        <ProtectedClient><ClientLayout /></ProtectedClient>
      }>
        <Route index element={<ClientDashboard />} />
        <Route path="calculations" element={<ClientCalculations />} />
        <Route path="tax-returns" element={<ClientTaxReturns />} />
        <Route path="assets" element={<ClientAssets />} />
        <Route path="tax-calculator" element={<ClientTaxCalculator />} />
        <Route path="quick-tax" element={<ClientQuickTax />} />
        <Route path="ird-codes" element={<ClientIrdCodes />} />
        <Route path="services" element={<ClientServices />} />
        <Route path="plan" element={<ClientPlan />} />
        <Route path="payroll" element={<ClientPayroll />} />
        <Route path="income" element={<ClientIncome />} />
        <Route path="calendar" element={<TaxCalendar role="client" />} />
        <Route path="invite" element={<ClientInvite />} />
        <Route path="documents" element={<ClientDocuments />} />
        <Route path="invoices" element={<ClientInvoices />} />
        <Route path="profile" element={<ClientProfile />} />
        <Route path="updates" element={<ClientTaxUpdates />} />
        <Route path="messages" element={<ClientMessages />} />
        <Route path="security" element={<ClientSecurity />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
