import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { applyFirm } from '../lib/iitStatement';
import { applyInvoiceSettings } from '../lib/invoice';

const SettingsContext = createContext({ version: 0, reload: () => {} });

// Loads Settings → Firm Profile (public) and Settings → Invoices (admin) into the shared
// FIRM / INVOICE_CFG objects, then re-renders so pages show the new values.
export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('key, value').in('key', ['firm', 'invoice']);
    applyFirm(data?.find(r => r.key === 'firm')?.value ?? null);
    applyInvoiceSettings(data?.find(r => r.key === 'invoice')?.value ?? null);
    setVersion(v => v + 1);
  }, []);

  useEffect(() => { reload(); }, [reload, user?.id]);

  return <SettingsContext.Provider value={{ version, reload }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
