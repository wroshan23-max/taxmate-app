// V64 — client portal: VAT Invoice & RAMIS add-on
import { useAuth } from '../../contexts/AuthContext';
import VatApp from '../../components/vat/VatApp';
import PageLoader from '../../components/PageLoader';

export default function ClientVat() {
  const { profile } = useAuth();
  if (!profile?.client_id) return <PageLoader />;
  return <VatApp clientId={profile.client_id} syncUrl />;
}
