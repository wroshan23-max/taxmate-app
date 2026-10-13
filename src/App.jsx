import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
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
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/client" replace />;
  return children;
}

function ProtectedClient({ children }) {
  const { user, isClient, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
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
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />

      {/* Admin routes */}
      <Route path="/admin" element={
        <ProtectedAdmin><AdminLayout /></ProtectedAdmin>
      }>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="calculator" element={<Calculator />} />
        <Route path="tax-returns" element={<TaxReturns />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="requests" element={<UpdateRequests />} />
        <Route path="updates" element={<TaxUpdates />} />
      </Route>

      {/* Client routes */}
      <Route path="/client" element={
        <ProtectedClient><ClientLayout /></ProtectedClient>
      }>
        <Route index element={<ClientDashboard />} />
        <Route path="calculations" element={<ClientCalculations />} />
        <Route path="tax-returns" element={<ClientTaxReturns />} />
        <Route path="invoices" element={<ClientInvoices />} />
        <Route path="profile" element={<ClientProfile />} />
        <Route path="updates" element={<ClientTaxUpdates />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
