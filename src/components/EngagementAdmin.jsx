// V69 — Admin: engagement letters for one client (client page → Overview)
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSignature, Plus, Trash2, Loader2, Send, Eye, Save, X, Undo2, ChevronUp, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { INVOICE_CFG } from '../lib/invoice';
import { recipientsOf } from '../lib/contacts';
import { BASIS, DEFAULT_TEMPLATE, makeContent, loadTemplate, saveTemplate, loadLetters, saveDraft, sendLetter, setLetter, deleteLetter, letterUrl, letterMessage, openLetter } from '../lib/engagement';
import MessageMenu from './MessageMenu';

const ST = {
  draft: ['Draft', 'bg-gray-100 text-gray-700'], sent: ['Waiting for signature', 'bg-amber-100 text-amber-800'], signed: ['Signed', 'bg-green-100 text-green-800'],
  declined: ['Declined', 'bg-red-100 text-red-700'], withdrawn: ['Withdrawn', 'bg-gray-100 text-gray-500'],
};
const dmy = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const in30 = () => { const d = new Date(Date.now() + 30 * 86400e3); return d.toISOString().slice(0, 10); };

function Editor({ client, draft, onClose, onSaved }) {
  const [tpl, setTpl] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const t = await loadTemplate().catch(() => DEFAULT_TEMPLATE);
      setTpl(t);
      const c = draft?.content;
      setF({
        title: draft?.title || `Engagement letter — ${client.full_name}`,
        valid_until: draft?.valid_until || in30(),
        intro: c?.intro || '',
        services: c?.services?.length ? c.services : [{ name: INVOICE_CFG.catalog[0]?.name || 'Individual Income Tax Return', fee: INVOICE_CFG.catalog[0]?.price || 0, basis: 'year', note: '' }],
        sections: c?.sections?.length ? c.sections : t.sections,
        consents: c?.consents?.length ? c.consents : t.consents,
      });
    })();
  }, [draft, client.full_name]);
  if (!f) return <div className="p-4 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div>;
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const upd = (k, i, p) => set({ [k]: f[k].map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const del = (k, i) => set({ [k]: f[k].filter((_, j) => j !== i) });
  const move = (k, i, d) => { const a = [...f[k]]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ [k]: a }); };

  const save = async (andSend) => {
    if (!f.services.some((s) => s.name.trim())) { toast.error('Add at least one service'); return; }
    setBusy(true);
    try {
      const { data: sig } = await supabase.from('app_settings').select('value').eq('key', 'firm_signature').maybeSingle();
      const content = { ...makeContent({ ...f, client }), ...(sig?.value?.image ? { firm_signature: sig.value.image } : {}) };
      const row = await saveDraft({ id: draft?.id, client_id: client.id, title: f.title.trim().slice(0, 150) || 'Engagement letter', valid_until: f.valid_until || null, content });
      let sent = null;
      if (andSend) sent = await sendLetter(row.id);
      toast.success(andSend ? `Letter ${sent.letter_no} ready — now send the link` : 'Draft saved');
      onSaved(sent ? { ...row, status: 'sent', share_token: sent.token, letter_no: sent.letter_no } : row);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const asDefault = async () => {
    if (!window.confirm('Use these sections and confirmations as the default for every new engagement letter?')) return;
    try { await saveTemplate({ sections: f.sections, consents: f.consents }); setTpl({ sections: f.sections, consents: f.consents }); toast.success('Saved as the default template'); } catch (e) { toast.error(e.message); }
  };
  const preview = () => openLetter({ title: f.title, letter_no: 'DRAFT', status: 'draft', valid_until: f.valid_until, content: makeContent({ ...f, client }), client });

  return (
    <div className="space-y-4 rounded-xl border border-primary-100 bg-primary-50/30 p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="text-xs font-semibold text-gray-600">Title<input className="input mt-1" maxLength={150} value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="text-xs font-semibold text-gray-600">Sign by<input type="date" className="input mt-1" value={f.valid_until || ''} onChange={(e) => set({ valid_until: e.target.value })} /></label>
      </div>
      <label className="block text-xs font-semibold text-gray-600">Opening line (optional)<textarea className="input mt-1 resize-y" rows={2} maxLength={1000} placeholder="e.g. Thank you for choosing us for your Y/A 2025/26 income tax return." value={f.intro} onChange={(e) => set({ intro: e.target.value })} /></label>

      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-gray-600">Services and fees
          <select className="input ml-auto w-auto py-1 text-xs" value="" onChange={(e) => { const s = INVOICE_CFG.catalog[Number(e.target.value)]; if (s) set({ services: [...f.services, { name: s.name, fee: s.price, basis: /monthly/i.test(s.name) ? 'month' : 'once', note: '' }] }); }} aria-label="Add from service catalog">
            <option value="">+ Add from catalog…</option>{INVOICE_CFG.catalog.map((s, i) => <option key={s.name} value={i}>{s.name} — Rs. {Number(s.price).toLocaleString('en-LK')}</option>)}
          </select>
          <button type="button" className="btn-secondary border px-2 py-1 text-xs" onClick={() => set({ services: [...f.services, { name: '', fee: 0, basis: 'once', note: '' }] })}><Plus size={12} /> Blank</button>
        </div>
        <div className="space-y-1.5">
          {f.services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_110px_auto] gap-1.5 max-sm:grid-cols-2">
              <input className="input py-1.5 text-sm max-sm:col-span-2" maxLength={120} placeholder="Service" value={s.name} onChange={(e) => upd('services', i, { name: e.target.value })} />
              <input className="input py-1.5 text-sm" inputMode="numeric" placeholder="Fee" value={s.fee} onChange={(e) => upd('services', i, { fee: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Fee (Rs.)" />
              <select className="input py-1.5 text-sm" value={s.basis} onChange={(e) => upd('services', i, { basis: e.target.value })} aria-label="Basis">{Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button type="button" onClick={() => del('services', i)} className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove service"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-lg border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-primary-800">Terms ({f.sections.length} sections) — edit for this client</summary>
        <div className="mt-2 space-y-2">
          {f.sections.map((s, i) => (
            <div key={i} className="rounded-lg border p-2">
              <div className="flex items-center gap-1"><input className="input flex-1 py-1 text-sm font-semibold" maxLength={120} value={s.h} onChange={(e) => upd('sections', i, { h: e.target.value })} aria-label="Heading" />
                <button type="button" onClick={() => move('sections', i, -1)} className="p-1 text-gray-400" aria-label="Move up"><ChevronUp size={14} /></button>
                <button type="button" onClick={() => move('sections', i, 1)} className="p-1 text-gray-400" aria-label="Move down"><ChevronDown size={14} /></button>
                <button type="button" onClick={() => del('sections', i)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove section"><Trash2 size={14} /></button></div>
              <textarea className="input mt-1 resize-y text-sm" rows={3} maxLength={4000} value={s.p} onChange={(e) => upd('sections', i, { p: e.target.value })} aria-label="Text" />
            </div>
          ))}
          <button type="button" className="btn-secondary border py-1 text-xs" onClick={() => set({ sections: [...f.sections, { h: 'New section', p: '' }] })}><Plus size={12} /> Section</button>
          <div className="pt-2 text-xs font-semibold text-gray-600">Confirmations the client ticks</div>
          {f.consents.map((k, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input className="input flex-1 py-1 text-sm" maxLength={300} value={k.text} onChange={(e) => upd('consents', i, { text: e.target.value })} aria-label="Confirmation text" />
              <label className="flex items-center gap-1 whitespace-nowrap text-xs"><input type="checkbox" checked={!!k.required} onChange={(e) => upd('consents', i, { required: e.target.checked })} /> required</label>
              <button type="button" onClick={() => del('consents', i)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove confirmation"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary border py-1 text-xs" onClick={() => set({ consents: [...f.consents, { key: `c${Date.now()}`, text: '', required: false }] })}><Plus size={12} /> Confirmation</button>
            <button type="button" className="btn-secondary border py-1 text-xs" onClick={() => set({ sections: tpl.sections, consents: tpl.consents })}><Undo2 size={12} /> Reset to default</button>
            <button type="button" className="ml-auto text-xs font-semibold text-primary-700 underline" onClick={asDefault}>Save as my default template</button>
          </div>
          <p className="text-[11px] text-gray-500">The default text is a starting point — please have it checked by your lawyer. {'{{client}}'} and {'{{firm}}'} are replaced with the names.</p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClose} className="btn-secondary border text-sm"><X size={14} /> Cancel</button>
        <button type="button" onClick={preview} className="btn-secondary border text-sm"><Eye size={14} /> Preview</button>
        <button type="button" disabled={busy} onClick={() => save(false)} className="btn-secondary border text-sm"><Save size={14} /> Save draft</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="btn-primary ml-auto text-sm">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Save &amp; get signing link</button>
      </div>
    </div>
  );
}

export default function EngagementAdmin({ client }) {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);   // null | {} new | row draft
  const [missing, setMissing] = useState(false);
  const load = () => loadLetters(client.id).then(setRows).catch((e) => { setRows([]); if (/engagement_letters|schema cache/.test(e.message)) setMissing(true); else toast.error(e.message); });
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return null;
  const view = (r) => openLetter({ ...r, client });
  const withdraw = async (r) => { if (!window.confirm(`Withdraw ${r.letter_no}? The signing link stops working.`)) return; try { await setLetter(r.id, { status: 'withdrawn' }); load(); } catch (e) { toast.error(e.message); } };
  const remove = async (r) => { if (!window.confirm('Delete this draft?')) return; try { await deleteLetter(r.id); load(); } catch (e) { toast.error(e.message); } };
  const latest = rows[0];

  return (
    <div className="card">
      <div className="card-header flex-wrap"><FileSignature size={16} /> Engagement letter
        {latest && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ST[latest.status][1]}`}>{ST[latest.status][0]}</span>}
        {!edit && !missing && <button type="button" onClick={() => setEdit({})} className="btn-secondary ml-auto border py-1 text-xs"><Plus size={13} /> New letter</button>}
      </div>
      <div className="space-y-3 p-5">
        {missing && <div className="text-sm text-amber-800">The engagement letter database is not set up yet — run the V69 script in Supabase.</div>}
        {edit && <Editor client={client} draft={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
        {!edit && !rows.length && !missing && <div className="text-sm text-gray-500">No engagement letter yet. A signed letter sets out the services, fees and responsibilities — it protects you and builds trust. <button type="button" onClick={() => setEdit({})} className="font-semibold text-primary-700 underline">Create one</button></div>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800">{r.letter_no || 'Draft'} <span className={`rounded-full px-2 py-0.5 text-[11px] ${ST[r.status][1]}`}>{ST[r.status][0]}</span></div>
              <div className="text-xs text-gray-500">{r.title}
                {r.sent_at && ` · sent ${dmy(r.sent_at)}`}{r.viewed_at && r.status === 'sent' && ` · opened ${dmy(r.viewed_at)}`}{r.status === 'sent' && !r.viewed_at && ' · not opened yet'}
                {r.signed_at && ` · signed ${dmy(r.signed_at)} by ${r.signer_name}`}{r.status === 'declined' && ` · ${r.decline_reason || 'no reason given'}`}
                {r.status === 'sent' && r.valid_until && ` · sign by ${dmy(r.valid_until)}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {r.status === 'draft' && <><button type="button" onClick={() => setEdit(r)} className="btn-secondary border py-1 text-xs">Edit</button><button type="button" onClick={() => remove(r)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Delete draft"><Trash2 size={14} /></button></>}
              {r.status === 'sent' && <MessageMenu label="Send link" phone={client.mobile} email={client.email} recipients={recipientsOf(client)} subject={`Engagement letter ${r.letter_no} — please sign`} getText={async () => letterMessage(client, r, letterUrl(r.share_token))} />}
              {r.status === 'sent' && <button type="button" onClick={() => { navigator.clipboard?.writeText(letterUrl(r.share_token)); toast.success('Link copied'); }} className="btn-secondary border py-1 text-xs">Copy link</button>}
              <button type="button" onClick={() => view(r)} className="btn-secondary border py-1 text-xs"><Eye size={13} /> {r.status === 'signed' ? 'Signed copy' : 'View'}</button>
              {r.status === 'sent' && <button type="button" onClick={() => withdraw(r)} className="text-xs text-gray-400 hover:text-red-600">Withdraw</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
