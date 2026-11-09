// V55 — Main applicant: family members, their tax returns, computations (share with the member) and bills
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UsersRound, Loader2, ArrowRight, FileText, Receipt, MessageCircle, Copy, Mail, Link2Off, Bell, KeyRound, Calculator } from 'lucide-react';
import { supabase, fmtRs, fmtDate, switchFamily, FAMILY_AS } from '../../lib/supabase';
import { STAGES, stageIndex } from '../../lib/documents';
import { shareUrl, waNumber } from '../../lib/share';
import { FIRM } from '../../lib/iitStatement';

const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function familyMessage(m, calc, url, from) {
  return [
    `Hi ${first(m.full_name)},`,
    '',
    `Here is your Income Tax ${calc.status === 'final' ? 'computation' : 'draft computation'} for Y/A ${calc.year}${calc.label ? ` (${calc.label})` : ''}, prepared by ${FIRM.name}.`,
    '',
    `View / download PDF: ${url}`,
    '',
    calc.status === 'final' ? '' : 'Please check it and tap "Confirm" or "Request changes" on that page.',
    `— ${first(from)}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

function CalcRow({ m, c, from, onChange }) {
  const [busy, setBusy] = useState(false);
  const link = async () => {
    const { data, error } = await supabase.rpc('share_family_calc', { p_calc: c.id, p_on: true });
    if (error) throw new Error(error.message);
    onChange(c.id, data);
    return shareUrl(data);
  };
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast.error(e.message); } setBusy(false); };
  const sendWa = () => run(async () => {
    // open the window first (phones block pop-ups opened after a wait), then fill in the link
    const w = window.open('', '_blank');
    const url = await link();
    const to = waNumber(m.mobile);
    const href = `https://wa.me/${to}?text=${encodeURIComponent(familyMessage(m, c, url, from))}`;
    if (w) w.location.href = href; else window.location.href = href;
  });
  const copy = () => run(async () => { const url = await link(); await navigator.clipboard.writeText(familyMessage(m, c, url, from)); toast.success('Message with link copied'); });
  const mail = () => run(async () => {
    const url = await link();
    window.location.href = `mailto:${m.email || ''}?subject=${encodeURIComponent(`Income Tax computation Y/A ${c.year}`)}&body=${encodeURIComponent(familyMessage(m, c, url, from))}`;
  });
  const stop = () => run(async () => {
    const { error } = await supabase.rpc('share_family_calc', { p_calc: c.id, p_on: false });
    if (error) throw new Error(error.message);
    onChange(c.id, null); toast.success('Link switched off — the old link no longer opens');
  });
  return (
    <div className="flex items-center gap-2 flex-wrap py-2">
      <Calculator size={15} className="text-primary-500 flex-shrink-0" />
      <span className="flex-1 min-w-[150px] text-sm">
        <b>Y/A {c.year}</b> · {c.status === 'final' ? 'Final' : 'Draft'}{c.label ? ` · ${c.label}` : ''}
        {c.client_status === 'approved' && <span className="ml-1 text-[11px] text-green-700">✓ confirmed</span>}
        {c.client_status === 'changes_requested' && <span className="ml-1 text-[11px] text-amber-700">changes asked</span>}
        {c.share_token && <span className="ml-1 text-[11px] text-emerald-700">· link active</span>}
      </span>
      {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
      <button disabled={busy} onClick={sendWa} className="text-xs font-semibold rounded-lg bg-[#25D366] text-white px-2.5 py-1.5 inline-flex items-center gap-1"><MessageCircle size={13} /> Send to {first(m.full_name)}</button>
      <button disabled={busy} onClick={copy} title="Copy message with link" className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 hover:bg-gray-50"><Copy size={13} /></button>
      <button disabled={busy} onClick={mail} title="Email" className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 hover:bg-gray-50"><Mail size={13} /></button>
      {c.share_token && <button disabled={busy} onClick={stop} title="Switch the link off" className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 hover:bg-red-50 text-red-600"><Link2Off size={13} /></button>}
    </div>
  );
}

export default function ClientFamily() {
  const [fam, setFam] = useState(null);
  const load = () => supabase.rpc('my_family').then(({ data, error }) => { if (error) toast.error(error.message); setFam(data ?? { members: [] }); });
  useEffect(() => { load(); }, []);

  if (FAMILY_AS) return (
    <div className="card p-8 text-center space-y-3">
      <UsersRound size={36} className="mx-auto text-gray-300" />
      <p className="text-gray-600">You are managing a family member right now.</p>
      <button onClick={() => switchFamily(null, '/client/family')} className="btn-primary inline-flex">Back to my family</button>
    </div>
  );
  if (!fam) return <div className="card p-10 text-center"><Loader2 className="animate-spin mx-auto text-gray-400" /></div>;

  const members = fam.members ?? [];
  const setToken = (mid, cid, tok) => setFam(f => ({ ...f, members: f.members.map(m => m.id !== mid ? m : { ...m, calcs: m.calcs.map(c => c.id === cid ? { ...c, share_token: tok } : c) }) }));
  const wa = `https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent('Hi TaxMate, I would like to add a family member to my portal.')}`;
  const totalDue = members.reduce((t, m) => t + m.unpaid.reduce((a, v) => a + Number(v.total || 0), 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 flex items-center gap-2"><UsersRound size={24} className="text-gold-500" /> My Family</h1>
          <p className="text-sm text-gray-500">Your family members' tax returns, computations and bills · පවුලේ සාමාජිකයන්ගේ බදු කටයුතු</p>
        </div>
        {totalDue > 0 && <div className="ml-auto text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">Family bills to pay: <b>{fmtRs(totalDue)}</b></div>}
      </div>

      {fam.head && (
        <div className="card p-4 text-sm text-gray-700">👪 Your tax matters are managed by <b>{fam.head.full_name}</b>{fam.head.relation ? ` (you are their ${fam.head.relation.toLowerCase()})` : ''}.</div>
      )}

      {members.length === 0 && !fam.head && (
        <div className="card p-8 text-center space-y-3">
          <UsersRound size={40} className="mx-auto text-gray-200" />
          <p className="text-gray-600">No family members yet. TaxMate can add your spouse, parents or children so you can manage their tax returns here.</p>
          <a href={wa} target="_blank" rel="noreferrer" className="btn-primary inline-flex"><MessageCircle size={16} /> Ask TaxMate to add them</a>
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-4">
        {members.map(m => (
          <div key={m.id} className="card overflow-hidden">
            <div className="p-4 flex items-center gap-3 border-b border-gray-100">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white font-bold flex items-center justify-center">{initials(m.full_name)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-800 truncate">{m.full_name}</div>
                <div className="text-xs text-gray-500">{[m.relation, m.client_no, m.tin ? `TIN ${m.tin}` : null].filter(Boolean).join(' · ')}</div>
              </div>
              {m.unread > 0 && <span title="New notifications" className="text-[11px] font-bold bg-red-500 text-white rounded-full px-2 py-0.5 inline-flex items-center gap-1"><Bell size={11} /> {m.unread}</span>}
              {m.has_login && <span title={`${first(m.full_name)} can also sign in`} className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 inline-flex items-center gap-1"><KeyRound size={11} /> own login</span>}
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1"><FileText size={13} /> Tax returns</div>
                {m.returns.length === 0 ? <div className="text-sm text-gray-400 mt-1">No return started yet.</div> : m.returns.map(r => {
                  const st = STAGES[stageIndex(r.stage)];
                  return <div key={r.year} className="text-sm mt-1">Y/A {r.year} — {st.emoji} {st.label}</div>;
                })}
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1"><Calculator size={13} /> Tax computations — share with {first(m.full_name)}</div>
                {m.calcs.length === 0 ? <div className="text-sm text-gray-400 mt-1">TaxMate has not sent a computation yet.</div>
                  : <div className="divide-y divide-gray-50">{m.calcs.map(c => <CalcRow key={c.id} m={m} c={c} from={fam.me?.full_name} onChange={(cid, tok) => setToken(m.id, cid, tok)} />)}</div>}
              </div>
              {m.unpaid.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 flex-wrap">
                  <Receipt size={15} className="text-amber-700" />
                  <span className="flex-1 text-sm text-amber-900">{m.unpaid.length} unpaid invoice{m.unpaid.length > 1 ? 's' : ''} · <b>{fmtRs(m.unpaid.reduce((a, v) => a + Number(v.total || 0), 0))}</b>
                    <span className="block text-xs">{m.unpaid.map(v => `${v.invoice_no}${v.due_date ? ` (due ${fmtDate(v.due_date)})` : ''}`).join(', ')}</span></span>
                  <button onClick={() => switchFamily(m.id, '/client/invoices')} className="btn-primary text-xs py-1.5">Pay</button>
                </div>
              )}
              <button onClick={() => switchFamily(m.id, '/client')} className="w-full btn-secondary justify-center">Open {first(m.full_name)}'s portal <ArrowRight size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {members.length > 0 && (
        <p className="text-xs text-gray-500">In a family member's portal you can upload documents, fill in monthly income, check computations and pay invoices for them. A shared link opens the computation without a login — switch it off any time. Need to add someone? <a href={wa} target="_blank" rel="noreferrer" className="text-primary-700 font-semibold hover:underline">Ask TaxMate</a>.</p>
      )}
    </div>
  );
}
