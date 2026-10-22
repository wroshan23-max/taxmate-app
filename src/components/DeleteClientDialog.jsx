import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Archive, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { callPortal } from '../lib/portal';
import { purgeClientFiles } from '../lib/documents';

const TABLES = [
  ['iit_calculations', 'tax calculations'], ['tax_returns', 'tax returns'], ['invoices', 'invoices'],
  ['asset_statements', 'Assets & Liabilities sheets'], ['income_sheets', 'monthly income sheets'], ['reminders', 'reminders'], ['client_documents', 'uploaded documents'],
];

/** Archive (hide, keep everything) or permanently delete a client. */
export default function DeleteClientDialog({ client, onClose, onDone }) {
  const [counts, setCounts] = useState(null);
  const [typed, setTyped] = useState('');
  const [removeLogin, setRemoveLogin] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all(TABLES.map(([t]) => supabase.from(t).select('id', { count: 'exact', head: true }).eq('client_id', client.id)))
      .then(res => setCounts(res.map(r => r.count ?? 0)));
  }, [client.id]);

  const archive = async () => {
    setBusy(true);
    const { error } = await supabase.from('clients').update({ archived_at: new Date().toISOString() }).eq('id', client.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${client.full_name} archived — find them under "Archived"`);
    onDone?.();
  };

  const remove = async () => {
    if (typed.trim().toLowerCase() !== client.full_name.trim().toLowerCase()) return toast.error('Type the client name exactly to confirm');
    setBusy(true);
    try {
      if (client.profile_id && removeLogin) await callPortal('delete_user', { user_id: client.profile_id });
      await purgeClientFiles(client.id);   // stored files are not removed by the database cascade
      const { error } = await supabase.from('clients').delete().eq('id', client.id);
      if (error) throw error;
      toast.success(`${client.full_name} deleted`);
      onDone?.();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };

  const total = counts?.reduce((a, b) => a + b, 0) ?? 0;
  const invoices = counts?.[2] ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-primary-800">Remove {client.full_name}?</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl border-2 border-primary-100 bg-primary-50/50 p-4">
            <div className="font-semibold text-primary-800 flex items-center gap-2"><Archive size={16} /> Archive (recommended)</div>
            <p className="text-sm text-gray-600 mt-1">Hides the client from your lists. All calculations, returns and invoices are kept and you can restore them anytime.</p>
            <button onClick={archive} disabled={busy} className="btn-primary text-sm mt-3"><Archive size={14} /> Archive client</button>
          </div>

          <div className="rounded-xl border-2 border-red-100 p-4 space-y-3">
            <div className="font-semibold text-red-700 flex items-center gap-2"><Trash2 size={16} /> Delete permanently</div>
            {counts === null ? <div className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking records…</div> : (
              <div className="text-sm text-gray-700">
                {total === 0 ? 'This client has no saved records.' : (
                  <>This also deletes: <b>{TABLES.map(([, l], i) => counts[i] ? `${counts[i]} ${l}` : null).filter(Boolean).join(', ')}</b>.</>
                )}
              </div>
            )}
            {invoices > 0 && (
              <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2 flex gap-1.5"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Invoices are accounting records — deleting them removes them from your income reports. Archive instead if you may need them.</div>
            )}
            {client.profile_id && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={removeLogin} onChange={e => setRemoveLogin(e.target.checked)} /> Also delete their portal login
              </label>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Type <b>{client.full_name}</b> to confirm</label>
              <input className="input" value={typed} onChange={e => setTyped(e.target.value)} placeholder={client.full_name} />
            </div>
            <button onClick={remove} disabled={busy || typed.trim().toLowerCase() !== client.full_name.trim().toLowerCase()}
              className="w-full px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete permanently
            </button>
            <p className="text-[11px] text-gray-400">This cannot be undone.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
