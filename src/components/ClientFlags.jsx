// V60 — 📌 pin + 🏷️ coloured labels for clients (admin only)
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Pin, PinOff, Tag, X, Plus, Trash2, Loader2, Check, Settings2 } from 'lucide-react';
import { LABEL_COLORS, colorOf, setPin, setPinNote, setLabels, saveLabel, deleteLabel } from '../lib/clientFlags';

/** Small coloured label chips */
export function LabelChips({ ids = [], labels = [], className = '' }) {
  const list = labels.filter(l => ids.includes(l.id));
  if (!list.length) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {list.map(l => <span key={l.id} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${colorOf(l.color).chip}`}>{l.name}</span>)}
    </span>
  );
}

/** Popover placed with fixed position so tables with scrolling don't cut it off */
function usePopover() {
  const [pos, setPos] = useState(null);
  const btn = useRef(null), box = useRef(null);
  const open = () => {
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 6, h = 380;
    setPos({ left, width: w, top: below + h > window.innerHeight && r.top > h ? Math.max(8, r.top - h - 6) : below });
  };
  useEffect(() => {
    if (!pos) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target) && !btn.current?.contains(e.target)) setPos(null); };
    const esc = (e) => { if (e.key === 'Escape') setPos(null); };
    const scroll = (e) => { if (!box.current?.contains(e.target)) setPos(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); };
  }, [pos]);
  return { pos, open, close: () => setPos(null), btn, box };
}

/**
 * 📌 + 🏷️ buttons with an editor. flag = { pinned_at, pin_note, label_ids }.
 * onChange(newFlag) after a save; onManage() opens the label manager.
 */
export function FlagButtons({ clientId, name, flag, labels, onChange, onManage, size = 14 }) {
  const pinned = !!flag?.pinned_at;
  const ids = flag?.label_ids ?? [];
  const pin = usePopover(), tag = usePopover();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => { setBusy(true); try { const f = await fn(); onChange?.(f); if (ok) toast.success(ok); return true; } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); } };

  const openPin = () => { setNote(flag?.pin_note ?? ''); tag.close(); pin.pos ? pin.close() : pin.open(); };
  const toggleLabel = (id) => run(() => setLabels(clientId, ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  const stop = (e) => e.stopPropagation();

  return (
    <span className="inline-flex items-center gap-0.5 align-middle" onClick={stop}>
      <button ref={pin.btn} type="button" onClick={openPin} title={pinned ? `Pinned${flag.pin_note ? `: ${flag.pin_note}` : ''}` : 'Pin to the top of the list'}
        className={`p-1 rounded-md ${pinned ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-gray-300 hover:text-amber-600 hover:bg-amber-50'}`}>
        <Pin size={size} className={pinned ? 'fill-amber-500' : ''} />
      </button>
      <button ref={tag.btn} type="button" onClick={() => { pin.close(); tag.pos ? tag.close() : tag.open(); }} title="Labels"
        className={`p-1 rounded-md ${ids.length ? 'text-primary-600 bg-primary-50 hover:bg-primary-100' : 'text-gray-300 hover:text-primary-600 hover:bg-primary-50'}`}>
        <Tag size={size} />
      </button>

      {pin.pos && (
        <div ref={pin.box} style={{ position: 'fixed', top: pin.pos.top, left: pin.pos.left, width: pin.pos.width }} onClick={stop}
          className="z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-3 space-y-2 text-left cursor-default">
          <div className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><Pin size={13} className="text-amber-600" /> {pinned ? 'Pinned' : 'Pin'} {name}</div>
          <label className="block text-[11px] text-gray-500">Note (optional) — why is it pinned?
            <input autoFocus className="input py-1.5 mt-0.5 text-sm" maxLength={120} placeholder="e.g. Waiting for bank certificate" value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run(() => (pinned ? setPinNote(clientId, note) : setPin(clientId, true, note)), pinned ? 'Note saved' : 'Pinned to the top').then(ok => ok && pin.close()); } }} /></label>
          <div className="flex gap-1.5 justify-end">
            {pinned && <button type="button" disabled={busy} onClick={() => run(() => setPin(clientId, false), 'Unpinned').then(ok => ok && pin.close())} className="btn-secondary text-xs py-1 px-2"><PinOff size={12} /> Unpin</button>}
            <button type="button" disabled={busy} onClick={() => run(() => (pinned ? setPinNote(clientId, note) : setPin(clientId, true, note)), pinned ? 'Note saved' : 'Pinned to the top').then(ok => ok && pin.close())}
              className="btn-primary text-xs py-1 px-2.5">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {pinned ? 'Save note' : 'Pin'}</button>
          </div>
        </div>
      )}

      {tag.pos && (
        <div ref={tag.box} style={{ position: 'fixed', top: tag.pos.top, left: tag.pos.left, width: tag.pos.width }} onClick={stop}
          className="z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-2 text-left cursor-default">
          <div className="text-xs font-bold text-gray-700 px-1 pb-1.5 flex items-center gap-1.5"><Tag size={13} className="text-primary-600" /> Labels — {name}{busy && <Loader2 size={12} className="animate-spin text-gray-400 ml-auto" />}</div>
          <div className="max-h-64 overflow-y-auto">
            {labels.length === 0 && <div className="text-xs text-gray-400 px-1 py-2">No labels yet.</div>}
            {labels.map(l => (
              <button key={l.id} type="button" disabled={busy} onClick={() => toggleLabel(l.id)} className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-gray-50 text-sm">
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${ids.includes(l.id) ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300'}`}>{ids.includes(l.id) && <Check size={11} />}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${colorOf(l.color).chip}`}>{l.name}</span>
              </button>
            ))}
          </div>
          {onManage && <button type="button" onClick={() => { tag.close(); onManage(); }} className="mt-1 w-full text-xs font-semibold text-primary-700 hover:bg-primary-50 rounded-lg px-2 py-1.5 flex items-center gap-1.5"><Settings2 size={12} /> Create / edit labels</button>}
        </div>
      )}
    </span>
  );
}

/** Create, rename, recolour, delete labels */
export function ManageLabels({ labels, counts = {}, onClose, onChange }) {
  const [rows, setRows] = useState(() => labels.map(l => ({ ...l })));
  const [add, setAdd] = useState({ name: '', color: 'blue' });
  const [busy, setBusy] = useState(null);
  useEffect(() => { setRows(labels.map(l => ({ ...l }))); }, [labels]);
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); toast.success(ok); await onChange?.(); return true; } catch (e) { toast.error(e.message); return false; } finally { setBusy(null); } };
  const Swatches = ({ value, onPick }) => (
    <div className="flex flex-wrap gap-1">
      {Object.entries(LABEL_COLORS).map(([k, c]) => (
        <button key={k} type="button" title={c.name} onClick={() => onPick(k)}
          className={`w-5 h-5 rounded-full ${c.dot} ${value === k ? 'ring-2 ring-offset-1 ring-gray-800' : 'opacity-80 hover:opacity-100'}`} />
      ))}
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-primary-800 flex items-center gap-2"><Tag size={17} /> Client labels</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3">
          {rows.map(r => {
            const orig = labels.find(l => l.id === r.id);
            const dirty = orig && (orig.name !== r.name || orig.color !== r.color);
            return (
              <div key={r.id} className="rounded-xl border border-gray-100 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border whitespace-nowrap ${colorOf(r.color).chip}`}>{r.name || '—'}</span>
                  <input className="input py-1 text-sm flex-1" maxLength={30} value={r.name} onChange={e => setRows(x => x.map(y => (y.id === r.id ? { ...y, name: e.target.value } : y)))} />
                  {dirty && <button type="button" disabled={!!busy} onClick={() => run(r.id, () => saveLabel(r), 'Label saved')} className="btn-primary text-xs py-1 px-2">{busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save</button>}
                  <button type="button" disabled={!!busy} title="Delete label"
                    onClick={() => { if (window.confirm(`Delete the label "${orig?.name}"?${counts[r.id] ? ` It is removed from ${counts[r.id]} client(s).` : ''}`)) run(r.id, () => deleteLabel(r.id), 'Label deleted'); }}
                    className="p-1 text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
                <div className="flex items-center gap-2"><Swatches value={r.color} onPick={(k) => setRows(x => x.map(y => (y.id === r.id ? { ...y, color: k } : y)))} />
                  <span className="ml-auto text-[11px] text-gray-400">{counts[r.id] ?? 0} client{counts[r.id] === 1 ? '' : 's'}</span></div>
              </div>
            );
          })}
          <div className="rounded-xl border-2 border-dashed border-primary-100 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded border whitespace-nowrap ${colorOf(add.color).chip}`}>{add.name || 'New label'}</span>
              <input className="input py-1 text-sm flex-1" maxLength={30} placeholder="e.g. VAT client" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && add.name.trim()) run('new', () => saveLabel({ ...add, sort: rows.length + 1 }), 'Label added').then(ok => ok && setAdd({ name: '', color: add.color })); }} />
              <button type="button" disabled={!add.name.trim() || !!busy} onClick={() => run('new', () => saveLabel({ ...add, sort: rows.length + 1 }), 'Label added').then(ok => ok && setAdd({ name: '', color: add.color }))}
                className="btn-primary text-xs py-1 px-2">{busy === 'new' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add</button>
            </div>
            <Swatches value={add.color} onPick={(k) => setAdd(a => ({ ...a, color: k }))} />
          </div>
          <p className="text-[11px] text-gray-500">Only TaxMate admins see labels and pins — clients never see them. Up to 10 labels per client.</p>
        </div>
      </div>
    </div>
  );
}
