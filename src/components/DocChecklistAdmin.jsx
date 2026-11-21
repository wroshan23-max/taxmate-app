// V68 — Admin: document checklist for one client (client page → Documents tab)
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ListChecks, Plus, Loader2, Trash2, Bell, CheckCircle2, Circle, MinusCircle, ChevronDown, ChevronUp, Paperclip } from 'lucide-react';
import { DOC_CATS, docYears, defaultDocYear } from '../lib/documents';
import { TEMPLATES, progressOf, loadChecklists, createChecklist, setItem, deleteItem, updateList, deleteList, remind, reminderText } from '../lib/docChecklist';
import { recipientsOf } from '../lib/contacts';
import MessageMenu from './MessageMenu';

const dmy = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const CATS = Object.entries(DOC_CATS).filter(([k]) => !['ack', 'voucher', 'return'].includes(k));

/** Template picker + custom items → items array */
function Builder({ existing = [], onSave, busy, submitLabel, showMeta }) {
  const [tpl, setTpl] = useState(() => new Set(existing.length ? [] : ['basic', 'salary', 'bank']));
  const [off, setOff] = useState(new Set());   // template item labels unticked
  const [custom, setCustom] = useState([]);
  const [c, setC] = useState({ label: '', category: 'other' });
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [notify, setNotify] = useState(true);
  const have = new Set(existing.map((i) => i.label.toLowerCase()));
  const tplItems = TEMPLATES.filter((t) => tpl.has(t.key)).flatMap((t) => t.items);
  const items = [...tplItems.filter((i) => !off.has(i.label)), ...custom].filter((i, k, a) => !have.has(i.label.toLowerCase()) && a.findIndex((x) => x.label === i.label) === k);
  const toggleTpl = (k) => setTpl((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const addCustom = () => { if (!c.label.trim()) return; setCustom((x) => [...x, { label: c.label.trim(), category: c.category }]); setC({ label: '', category: c.category }); };
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-semibold text-gray-600">Templates — tick what applies to this client</div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" onClick={() => toggleTpl(t.key)} aria-pressed={tpl.has(t.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tpl.has(t.key) ? 'border-primary-700 bg-primary-700 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300'}`}>{t.emoji} {t.name}</button>
          ))}
        </div>
      </div>
      {tplItems.length > 0 && (
        <div className="space-y-1 rounded-lg border bg-gray-50/60 p-2">
          {tplItems.filter((i, k, a) => a.findIndex((x) => x.label === i.label) === k).map((i) => {
            const dup = have.has(i.label.toLowerCase());
            return (
              <label key={i.label} className={`flex items-start gap-2 text-sm ${dup ? 'opacity-50' : ''}`}>
                <input type="checkbox" className="mt-0.5" disabled={dup} checked={!dup && !off.has(i.label)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(i.label)) n.delete(i.label); else n.add(i.label); return n; })} />
                <span className="flex-1">{i.label}{dup ? ' (already on the list)' : ''}<span className="block text-[11px] text-gray-500">{DOC_CATS[i.category]?.emoji} {DOC_CATS[i.category]?.label}{i.hint ? ` · ${i.hint}` : ''}</span></span>
              </label>
            );
          })}
        </div>
      )}
      {custom.length > 0 && <ul className="space-y-1 text-sm">{custom.map((i, k) => <li key={k} className="flex items-center gap-2"><Plus size={13} className="text-primary-600" /> <span className="flex-1">{i.label} <span className="text-[11px] text-gray-500">· {DOC_CATS[i.category]?.label}</span></span><button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setCustom((x) => x.filter((_, j) => j !== k))} aria-label="Remove"><Trash2 size={13} /></button></li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-[200px] flex-1 py-1.5 text-sm" maxLength={150} placeholder="Add your own item, e.g. Share dividend certificates" value={c.label} onChange={(e) => setC({ ...c, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <select className="input w-auto py-1.5 text-sm" value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })} aria-label="Category">{CATS.map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select>
        <button type="button" className="btn-secondary border py-1.5 text-sm" onClick={addCustom}><Plus size={14} /> Add</button>
      </div>
      {showMeta && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input className="input py-1.5 text-sm" maxLength={500} placeholder="Message to the client (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-gray-600">Send by <input type="date" className="input w-auto py-1.5 text-sm" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the client in the portal</label>
        <button type="button" disabled={busy || !items.length} onClick={() => onSave(items, { note, due, notify })} className="btn-primary ml-auto text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />} {submitLabel} ({items.length})</button>
      </div>
    </div>
  );
}

export default function DocChecklistAdmin({ client, onChange }) {
  const [lists, setLists] = useState(null);
  const [year, setYear] = useState(defaultDocYear());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(true);
  const years = useMemo(() => docYears(), []);
  const load = () => loadChecklists(client.id).then((l) => { setLists(l); onChange?.(l); }).catch((e) => { setLists([]); if (!/doc_checklists|schema cache/.test(e.message)) toast.error(e.message); });
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lists) return null;
  const list = lists.find((l) => l.year === year);
  const p = list ? progressOf(list.items) : null;

  const create = async (items, meta) => {
    setBusy(true);
    try { await createChecklist({ clientId: client.id, year, items, note: meta.note, due: meta.due, notify: meta.notify }); toast.success(list ? 'Items added' : `Checklist for Y/A ${year} created${meta.notify ? ' — client notified' : ''}`); setAdding(false); await load(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const mark = async (i, status) => { try { await setItem(i.id, { status, ...(status === 'na' ? { na_by: 'admin' } : {}) }); load(); } catch (e) { toast.error(e.message); } };
  const del = async (i) => { if (!window.confirm(`Remove "${i.label}" from the checklist?`)) return; try { await deleteItem(i.id); load(); } catch (e) { toast.error(e.message); } };
  const delList = async () => { if (!window.confirm(`Delete the whole Y/A ${year} checklist? Uploaded documents are not deleted.`)) return; try { await deleteList(list.id); load(); } catch (e) { toast.error(e.message); } };
  const portalRemind = async () => { try { await remind([list.id], true); toast.success('Reminder sent to the client portal (+ phone)'); load(); } catch (e) { toast.error(e.message); } };

  return (
    <div className="card">
      <div className="card-header flex-wrap">
        <ListChecks size={16} /> Document checklist
        {lists.length > 0 && <span className="text-xs font-normal text-gray-400">{lists.map((l) => { const q = progressOf(l.items); return `${l.year}: ${q.done}/${q.total}`; }).join(' · ')}</span>}
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-gray-400" aria-label={open ? 'Collapse' : 'Expand'}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
      {open && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-36 py-1.5 text-sm" value={year} onChange={(e) => { setYear(e.target.value); setAdding(false); }} aria-label="Year of assessment">
              {years.map((y) => <option key={y} value={y}>Y/A {y}{lists.some((l) => l.year === y) ? ' ✓' : ''}</option>)}
            </select>
            {list && <>
              <div className="flex min-w-[160px] flex-1 items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded bg-gray-100"><div className={`h-2 rounded ${p.pct === 100 ? 'bg-green-500' : 'bg-primary-600'}`} style={{ width: `${p.pct}%` }} /></div>
                <span className="whitespace-nowrap text-xs font-semibold text-gray-600">{p.done}/{p.total}{list.completed_at ? ' ✓ complete' : ''}</span>
              </div>
              {p.missing.length > 0 && <MessageMenu label={`Remind (${p.missing.length})`} phone={client.mobile} email={client.email} recipients={recipientsOf(client)} subject={`Documents needed — Y/A ${year} — TaxMate`}
                getText={async () => { remind([list.id], false).then(load).catch(() => {}); return reminderText(client, list); }} />}
              {p.missing.length > 0 && <button type="button" onClick={portalRemind} className="btn-secondary border py-1.5 text-xs" title="Portal notice + phone notification"><Bell size={13} /> Portal reminder</button>}
            </>}
          </div>

          {list ? (
            <>
              {(list.note || list.due_date || list.reminded_at) && <div className="text-xs text-gray-500">{list.note && <>💬 {list.note} · </>}{list.due_date && <>Send by <b>{dmy(list.due_date)}</b> · </>}{list.reminded_at ? `Reminded ${dmy(list.reminded_at)} (${list.reminder_count}×)` : 'Not reminded yet'}</div>}
              <ul className="divide-y rounded-lg border">
                {list.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
                    {i.status === 'received' ? <CheckCircle2 size={17} className="mt-0.5 text-green-600" /> : i.status === 'na' ? <MinusCircle size={17} className="mt-0.5 text-gray-400" /> : <Circle size={17} className="mt-0.5 text-amber-500" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${i.status === 'na' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{i.label}</div>
                      <div className="text-[11px] text-gray-500">{DOC_CATS[i.category]?.emoji} {DOC_CATS[i.category]?.label}
                        {i.status === 'received' && i.received_at && <> · received {dmy(i.received_at)}{i.document_id ? <> · <Paperclip size={10} className="inline" /> linked file</> : ''}</>}
                        {i.status === 'na' && <> · {i.na_by === 'client' ? 'client says they don\'t have it' : 'marked not needed'}</>}
                      </div>
                      {i.client_note && <div className="text-xs text-blue-800">💬 Client: {i.client_note}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      {i.status !== 'received' && <button type="button" onClick={() => mark(i, 'received')} className="rounded border border-green-200 px-2 py-0.5 text-[11px] font-semibold text-green-700 hover:bg-green-50">Received</button>}
                      {i.status !== 'needed' && <button type="button" onClick={() => mark(i, 'needed')} className="rounded border px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Needed</button>}
                      {i.status === 'needed' && <button type="button" onClick={() => mark(i, 'na')} className="rounded border px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">Not needed</button>}
                      <button type="button" onClick={() => del(i)} className="rounded p-1 text-gray-300 hover:text-red-600" aria-label="Remove item"><Trash2 size={13} /></button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setAdding((a) => !a)} className="btn-secondary border py-1.5 text-xs"><Plus size={13} /> Add items</button>
                <button type="button" onClick={() => { const d = window.prompt('Send by (YYYY-MM-DD), empty to clear:', list.due_date || ''); if (d === null) return; if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast.error('Use YYYY-MM-DD'); return; } updateList(list.id, { due_date: d || null }).then(load).catch((e) => toast.error(e.message)); }} className="btn-secondary border py-1.5 text-xs">Due date</button>
                <button type="button" onClick={delList} className="ml-auto text-xs text-gray-400 hover:text-red-600">Delete checklist</button>
              </div>
              {adding && <div className="rounded-xl border border-primary-100 p-3"><Builder existing={list.items} onSave={create} busy={busy} submitLabel="Add to checklist" /></div>}
              <p className="text-[11px] text-gray-400">An upload in the matching category ticks the item automatically (client or TaxMate upload).</p>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-gray-600">No checklist for Y/A {year} yet. Choose what {client.full_name.split(' ')[0]} needs to send — they'll see it in the portal (My Documents) and you can remind them with only the missing items.</div>
              <Builder onSave={create} busy={busy} submitLabel="Create checklist" showMeta />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
