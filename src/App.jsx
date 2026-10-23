import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import SharedDocument from './pages/SharedDocument';
import { InvitePage, ResetPasswordPage } from './pages/AccountLinks';
import Register from './pages/Register';
import { MfaChallengeScreen, MfaSetupScreen } from './components/TwoFactor';
import AdminMessages from './pages/admin/Messages';
import Activity from './pages/admin/Activity';
import ClientMessages from './pages/client/ClientMessages';
import ClientSecurity from './pages/client/ClientSecurity';
import Settings from './pages/admin/Settings';
import { useSettings } from './contexts/SettingsContext';
import AdminLayout from './components/AdminLayout';
import ClientLayout from './components/ClientLayout';
import Dashboard from './pages/admin/Dashboard';
import Clients from './pages/admin/Clients';
import ClientDetail from './pages/admin/ClientDetail';
import Calculator from './pages/admin/Calculator';
import TaxReturns from './pages/admin/TaxReturns';
import Invoices from './pages/admin/Invoices';
import UpdateRequests from './pages/admin/UpdateRequests';
import TaxUpdates from './pages/admin/TaxUpdates';
import AssetStatements from './pages/admin/AssetStatements';
import ClientAssets from './pages/client/ClientAssets';
import ClientTaxCalculator from './pages/client/ClientTaxCalculator';
import ClientIncome from './pages/client/ClientIncome';
import ClientInvite from './pages/client/ClientInvite';
import ClientDocuments from './pages/client/ClientDocuments';
import TaxCalendar from './pages/TaxCalendar';
import ClientDashboard from './pages/client/ClientDashboard';
import ClientCalculations from './pages/client/ClientCalculations';
import ClientTaxReturns from './pages/client/ClientTaxReturns';
import ClientInvoices from './pages/client/ClientInvoices';
import ClientProfile from './pages/client/ClientProfile';
import ClientTaxUpdates from './pages/client/ClientTaxUpdates';

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

export default function App() {
  useSettings();   // re-render pages when firm / invoice settings load or change
  return (
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
        <Route path="invoices" element={<Invoices />} />
        <Route path="requests" element={<UpdateRequests />} />
        <Route path="updates" element={<TaxUpdates />} />
        <Route path="messages" element={<AdminMessages />} />
        <Route path="activity" element={<Activity />} />
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
  );
}
