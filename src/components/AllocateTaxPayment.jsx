// V57 — Save a Monthly APIT / Quarterly instalment calculation to a client (one row per month / quarter)
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserCheck, Loader2, Save, ExternalLink } from 'lucide-react';
import { fmtRs } from '../lib/supabase';
import { yaOf, yaList, yaMonths, instalmentDue, loadPayments, savePayments, QUARTER_MONTHS, monthLabelOf } from '../lib/taxPayments';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * kind: 'apit' | 'instalment' · amount: calculated amount · basis: calculator inputs (saved with the row)
 * quarter: preselected quarter ('1'–'4') for instalments · ya: preselected Y/A
 */
export default function AllocateTaxPayment({ kind, amount, basis, clients, quarter, ya: yaInit, presetClient, userId }) {
  const [clientId, setClientId] = useState(presetClient ?? '');
  const [ya, setYa] = useState(yaInit ?? yaOf());
  const [months, setMonths] = useState(() => new Set());
  const [q, setQ] = useState(`Q${quarter ?? '1'}`);
  const [amt, setAmt] = useState('');
  const [paid, setPaid] = useState(false);
  const [paidOn, setPaidOn] = useState(today());
  const [ref, setRef] = useState('');
  const [existing, setExisting] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (presetClient) setClientId(presetClient); }, [presetClient]);
  useEffect(() => { if (quarter) setQ(`Q${quarter}`); }, [quarter]);
  useEffect(() => { if (yaInit) setYa(yaInit); }, [yaInit]);
  useEffect(() => { setAmt(amount > 0 ? String(Math.round(amount)) : ''); }, [amount]);
  useEffect(() => {
    if (!clientId) { setExisting([]); return; }
    loadPayments(clientId, ya).then(rows => setExisting(rows.filter(r => r.kind === kind))).catch(() => setExisting([]));
  }, [clientId, ya, kind]);
  // APIT: default to the current month when it is in this Y/A
  const list = useMemo(() => yaMonths(ya), [ya]);
  useEffect(() => {
    const cur = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    setMonths(new Set(list.some(m => m.period === cur) ? [cur] : []));
  }, [list]);

  const byPeriod = Object.fromEntries(existing.map(r => [r.period, r]));
  const targets = kind === 'apit' ? list.filter(m => months.has(m.period)).map(m => ({ period: m.period, due: m.due, label: m.label }))
    : [{ period: q, due: instalmentDue(ya, q), label: `${q} (${QUARTER_MONTHS[q]})` }];
  const value = Math.max(0, Math.round(Number(String(amt).replace(/,/g, '')) || 0));
  const toggle = (p) => setMonths(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const save = async () => {
    if (!clientId) return toast.error('Choose the client');
    if (!targets.length) return toast.error('Choose at least one month');
    const replacing = targets.filter(t => byPeriod[t.period]);
    if (replacing.length && !window.confirm(`Replace what is already saved for ${replacing.map(t => t.label).join(', ')}?${replacing.some(t => byPeriod[t.period].status === 'paid') ? ' Some are marked PAID — they will be replaced too.' : ''}`)) return;
    setBusy(true);
    try {
      const rows = targets.map(t => ({
        client_id: clientId, year: ya, kind, period: t.period, basis: basis ?? {}, amount: value, due_date: t.due,
        status: paid ? 'paid' : 'due', paid_amount: paid ? value : null, paid_on: paid ? paidOn || null : null, reference: paid ? ref.trim() || null : null,
        paid_by_role: paid ? 'admin' : null, checked_at: paid ? new Date().toISOString() : null, checked_by: null,
        receipt_path: null, receipt_name: null, note: null, created_by: userId ?? null,
      }));
      await savePayments(rows);
      const c = clients.find(x => x.id === clientId);
      toast.success(`Saved to ${c?.full_name ?? 'client'} — ${targets.length} ${kind === 'apit' ? `month${targets.length > 1 ? 's' : ''}` : 'instalment'}${paid ? ' (paid)' : ''}`);
      setExisting(await loadPayments(clientId, ya).then(r => r.filter(x => x.kind === kind)));
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="card p-5 space-y-3 border-2 border-primary-100">
      <div className="text-xs font-bold text-primary-700 uppercase tracking-wider flex items-center gap-2"><UserCheck size={15} /> Allocate to a client</div>
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
        <select className="input" value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Client">
          <option value="">— Select client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.tin ? ` (${c.tin})` : ''}</option>)}
        </select>
        <select className="input" value={ya} onChange={e => setYa(e.target.value)} aria-label="Year of assessment">
          {yaList([ya]).map(y => <option key={y} value={y}>Y/A {y}</option>)}
        </select>
        {kind === 'instalment' && (
          <select className="input" value={q} onChange={e => setQ(e.target.value)} aria-label="Quarter">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(x => <option key={x} value={x}>{x} · due {instalmentDue(ya, x)}</option>)}
          </select>
        )}
      </div>

      {kind === 'apit' && (
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">Months
            <button type="button" onClick={() => setMonths(new Set(list.map(m => m.period)))} className="text-primary-700 hover:underline">all 12</button>
            <button type="button" onClick={() => setMonths(new Set())} className="text-gray-500 hover:underline">none</button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
            {list.map(m => {
              const ex = byPeriod[m.period];
              return (
                <button key={m.period} type="button" onClick={() => toggle(m.period)} title={ex ? `Saved: ${fmtRs(ex.amount)}${ex.status === 'paid' ? ' · paid' : ''}` : 'Not saved yet'}
                  className={`relative rounded-lg border px-2 py-1.5 text-xs font-semibold ${months.has(m.period) ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300'}`}>
                  {m.label}
                  {ex && <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${ex.status === 'paid' ? 'bg-green-500' : 'bg-amber-400'}`} />}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Dot: green = already saved & paid · amber = saved, not paid yet. APIT is paid to the IRD by the 15th of the next month.</div>
        </div>
      )}
      {kind === 'instalment' && byPeriod[q] && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Already saved for {q}: {fmtRs(byPeriod[q].amount)}{byPeriod[q].status === 'paid' ? ` · paid ${byPeriod[q].paid_on ?? ''}` : ' · not paid yet'} — saving replaces it.</div>
      )}

      <div className="grid sm:grid-cols-2 gap-2 items-end">
        <label className="text-xs font-semibold text-gray-500">{kind === 'apit' ? 'APIT per month (Rs.)' : 'Instalment (Rs.)'}
          <input className="input mt-1 text-right tabular-nums" inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> {kind === 'apit' ? 'Already deducted / paid to IRD' : 'Already paid'}
        </label>
      </div>
      {paid && (
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-gray-500">Paid on<input type="date" className="input mt-1" value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>
          <label className="text-xs font-semibold text-gray-500">Reference (optional)<input className="input mt-1" maxLength={100} placeholder="Payment / slip no." value={ref} onChange={e => setRef(e.target.value)} /></label>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={busy || !clientId || !targets.length} className="btn-primary text-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save {kind === 'apit' ? `${targets.length || ''} month${targets.length === 1 ? '' : 's'}` : q} · {fmtRs(value)}{kind === 'apit' && targets.length > 1 ? ' each' : ''}
        </button>
        {clientId && <Link to={`/admin/clients/${clientId}?tab=returns`} className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1">Client's tax payments <ExternalLink size={11} /></Link>}
      </div>
      <p className="text-[11px] text-gray-500">Paid amounts fill <b>Tax already paid</b> in this client's IIT Return for Y/A {ya} ({kind === 'apit' ? 'APIT — cage 903' : 'instalments — cage 911'}). Mark payments as paid later on the client's page → Returns.{existing.length ? ` Saved so far: ${existing.length} ${kind === 'apit' ? 'month(s)' : 'quarter(s)'} (${existing.map(r => (kind === 'apit' ? monthLabelOf(r.period) : r.period)).join(', ')}).` : ''}</p>
    </div>
  );
}
