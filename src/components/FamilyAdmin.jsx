// V55 — Admin: family of a client (main applicant + family members)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UsersRound, Plus, X, Search, Loader2, UserPlus, Link2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const FAMILY_RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other relative'];
const SEL = 'member_id, head_id, relation, created_at, member:clients!client_family_member_id_fkey(id, full_name, client_no, nic, mobile, profile_id), head:clients!client_family_head_id_fkey(id, full_name, client_no)';

export default function FamilyAdmin({ client, userId, onChange }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);       // { mode: 'new' | 'existing', ... }
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState([]);

  const load = async () => {
    const { data, error } = await supabase.from('client_family').select(SEL).or(`head_id.eq.${client.id},member_id.eq.${client.id}`);
    if (error) { toast.error(error.message); setRows([]); return; }
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // search existing clients for "link an existing client"
  useEffect(() => {
    if (form?.mode !== 'existing') return;
    const q = String(form.q || '').trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const like = `%${q.replace(/[%_,()]/g, ' ')}%`;
      const { data } = await supabase.from('clients').select('id, full_name, client_no, nic, mobile')
        .or(`full_name.ilike.${like},nic.ilike.${like},client_no.ilike.${like},mobile.ilike.${like}`).neq('id', client.id).is('archived_at', null).limit(8);
      setHits(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [form?.mode, form?.q, client.id]);

  if (rows === null) return null;
  const asMember = rows.find(r => r.member_id === client.id);
  const members = rows.filter(r => r.head_id === client.id);

  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast.success(ok); setForm(null); await load(); onChange?.(); } catch (e) { toast.error(e.message || String(e)); } setBusy(false); };
  const link = async (memberId, relation) => {
    const { error } = await supabase.from('client_family').insert({ member_id: memberId, head_id: client.id, relation: relation || null, created_by: userId });
    if (error) throw new Error(error.code === '23505' ? 'That client is already in a family. Remove them from it first.' : error.message);
  };
  const addNew = () => run(async () => {
    const name = String(form.full_name || '').trim();
    if (!name) throw new Error('Enter the family member\'s full name');
    const { data: c, error } = await supabase.from('clients').insert({
      full_name: name, nic: form.nic?.trim() || null, mobile: form.mobile?.trim() || null, email: form.email?.trim() || null, created_by: userId,
      // the main applicant is the contact person (messages go to them)
      contact_name: client.full_name, contact_relation: form.relation === 'Spouse' ? 'Spouse' : 'Relative',
      contact_mobile: client.mobile || null, contact_email: client.email || null, contact_preferred: !!(client.mobile || client.email),
    }).select('id').single();
    if (error) throw new Error(error.message);
    try { await link(c.id, form.relation); }
    catch (e) { await supabase.from('clients').delete().eq('id', c.id); throw e; }
  }, `${name(form)} added to ${client.full_name}'s family`);
  const addExisting = (c) => run(() => link(c.id, form.relation), `${c.full_name} added to the family`);
  const remove = (r) => {
    const who = r.member?.full_name ?? 'this member';
    if (!window.confirm(`Remove ${who} from the family? Their own client record, returns and documents stay — only the link is removed.`)) return;
    run(async () => { const { error } = await supabase.from('client_family').delete().eq('member_id', r.member_id); if (error) throw new Error(error.message); }, `${who} removed from the family`);
  };
  const setRel = async (r, relation) => {
    const { error } = await supabase.from('client_family').update({ relation: relation || null }).eq('member_id', r.member_id);
    if (error) return toast.error(error.message);
    setRows(rs => rs.map(x => (x.member_id === r.member_id ? { ...x, relation } : x)));
  };

  return (
    <div className="card">
      <div className="card-header"><UsersRound size={16} /> Family
        {!asMember && !form && <button onClick={() => setForm({ mode: 'new', relation: 'Spouse' })} className="ml-auto btn-secondary text-xs py-1"><Plus size={13} /> Add family member</button>}
      </div>
      <div className="p-4 space-y-3">
        {asMember && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-center gap-2 flex-wrap">
            <span className="flex-1">👪 Family member of <Link to={`/admin/clients/${asMember.head.id}`} className="font-semibold text-primary-700 hover:underline">{asMember.head.full_name}</Link>
              {asMember.relation ? ` (${asMember.relation})` : ''} — they see and manage this client's returns, documents and invoices in their portal.</span>
            <button disabled={busy} onClick={() => remove({ ...asMember, member: { full_name: client.full_name } })} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><X size={12} /> Remove from family</button>
          </div>
        )}

        {!asMember && members.length === 0 && !form && (
          <p className="text-sm text-gray-500">No family members. Add the spouse, parents or children whose tax returns {client.full_name.split(' ')[0]} wants TaxMate to do — each gets their own returns, and {client.full_name.split(' ')[0]} manages them from the portal.</p>
        )}

        {members.map(r => (
          <div key={r.member_id} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3">
            <div className="flex-1 min-w-0">
              <Link to={`/admin/clients/${r.member_id}`} className="font-semibold text-primary-800 hover:underline">{r.member?.full_name}</Link>
              <div className="text-xs text-gray-500">{[r.member?.client_no, r.member?.nic, r.member?.mobile, r.member?.profile_id ? 'has own login' : null].filter(Boolean).join(' · ')}</div>
            </div>
            <select className="input w-36 py-1 text-sm" value={r.relation ?? ''} onChange={e => setRel(r, e.target.value)} aria-label="Relation">
              <option value="">Relation…</option>
              {FAMILY_RELATIONS.map(x => <option key={x}>{x}</option>)}
            </select>
            <button disabled={busy} onClick={() => remove(r)} title="Remove from family" className="text-gray-400 hover:text-red-600"><X size={16} /></button>
          </div>
        ))}

        {form && (
          <div className="rounded-xl border-2 border-primary-100 bg-primary-50/40 p-3 space-y-3">
            <div className="flex gap-1 bg-white rounded-lg p-1 w-fit">
              {[['new', UserPlus, 'New person'], ['existing', Link2, 'Existing client']].map(([k, I, l]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, mode: k }))} className={`px-3 py-1 rounded-md text-sm inline-flex items-center gap-1.5 ${form.mode === k ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><I size={14} /> {l}</button>
              ))}
            </div>
            <label className="text-xs font-semibold text-gray-500 block">Relation to {client.full_name}
              <select className="input mt-1 w-48" value={form.relation} onChange={e => setForm(f => ({ ...f, relation: e.target.value }))}>
                {FAMILY_RELATIONS.map(x => <option key={x}>{x}</option>)}
              </select>
            </label>
            {form.mode === 'new' ? (
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-gray-500 sm:col-span-2">Full name (as in NIC) *<input className="input mt-1" maxLength={150} value={form.full_name ?? ''} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></label>
                <label className="text-xs font-semibold text-gray-500">NIC<input className="input mt-1 uppercase" maxLength={12} value={form.nic ?? ''} onChange={e => setForm(f => ({ ...f, nic: e.target.value }))} /></label>
                <label className="text-xs font-semibold text-gray-500">Mobile / WhatsApp<input className="input mt-1" inputMode="tel" maxLength={20} placeholder="07X XXXXXXX" value={form.mobile ?? ''} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></label>
                <label className="text-xs font-semibold text-gray-500 sm:col-span-2">Email<input className="input mt-1" type="email" maxLength={150} value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></label>
                <p className="text-[11px] text-gray-500 sm:col-span-2">A new client record is created (with its own client number). {client.full_name} becomes the contact person, so messages go to them.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-9" autoFocus placeholder="Search name, NIC, TM number or mobile" value={form.q ?? ''} onChange={e => setForm(f => ({ ...f, q: e.target.value }))} /></div>
                {hits.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-3 py-2">
                    <span className="flex-1 text-sm"><b>{c.full_name}</b> <span className="text-xs text-gray-500">{[c.client_no, c.nic, c.mobile].filter(Boolean).join(' · ')}</span></span>
                    <button disabled={busy} onClick={() => addExisting(c)} className="btn-primary text-xs py-1">Add</button>
                  </div>
                ))}
                {String(form.q || '').trim().length >= 2 && hits.length === 0 && <p className="text-xs text-gray-500">No client found.</p>}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setForm(null)} className="btn-secondary text-sm">Cancel</button>
              {form.mode === 'new' && <button disabled={busy} onClick={addNew} className="btn-primary text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to family</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const name = (f) => String(f?.full_name || 'Family member').trim();
