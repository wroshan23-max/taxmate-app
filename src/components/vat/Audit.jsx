// V64 — audit trail of the VAT module (read only; the database does not allow changes to it)
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { History, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { loadAudit } from '../../lib/vat/api';
import { dt, slToday, ROLES } from '../../lib/vat/format';
import { Spinner, Empty, downloadCsv } from './ui';

const ENT = { vi_documents: 'Document', vi_payments: 'Payment', vi_customers: 'Customer', vi_items: 'Item', vi_settings: 'Settings', vi_sequences: 'Numbering', vi_branches: 'Code / branch', vi_members: 'User', vi_purchases: 'Purchase', vi_ramis_config: 'RAMIS settings' };

function changes(o, n) {
  if (!o || !n) return [];
  return Object.keys(n).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]) && !['updated_at'].includes(k)).slice(0, 12)
    .map((k) => `${k}: ${String(JSON.stringify(o[k]) ?? '').slice(0, 60)} → ${String(JSON.stringify(n[k]) ?? '').slice(0, 60)}`);
}

export default function Audit({ app }) {
  const { clientId, data, openDoc } = app;
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { loadAudit(clientId).then(setRows).catch((e) => { toast.error(e.message); setRows([]); }); }, [clientId]);
  if (!rows) return <Spinner />;
  const docNo = Object.fromEntries(data.docs.map((d) => [d.id, d.doc_no || 'draft']));
  const list = rows.filter((r) => !q || [r.action, r.entity, docNo[r.doc_id], r.note, r.actor_role].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <History size={16} className="text-primary-700" /><input className="input flex-1" placeholder="Filter: action, document no., role…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => downloadCsv(`vat-audit-${slToday()}.csv`, [['When', 'Action', 'Record', 'Document', 'Role', 'IP', 'Note', 'Changes'], ...list.map((r) => [r.created_at, r.action, ENT[r.entity] || r.entity, docNo[r.doc_id] || '', r.actor_role, r.ip, r.note, changes(r.old_value, r.new_value).join(' | ')])])}><Download size={12} className="inline" /> CSV</button>
      </div>
      {list.length === 0 ? <Empty icon={History} title="Nothing logged yet" /> : (
        <div className="card divide-y">
          {list.map((r) => { const ch = changes(r.old_value, r.new_value); return (
            <div key={r.id} className="px-3 py-1.5 text-xs">
              <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {ch.length ? (open === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
                <span className="w-36 text-gray-500">{dt(r.created_at)}</span><b>{r.action.replace(/_/g, ' ')}</b><span className="text-gray-600">{ENT[r.entity] || r.entity}</span>
                {r.doc_id && <span role="link" tabIndex={0} className="font-mono text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); openDoc(r.doc_id); }} onKeyDown={() => {}}>{docNo[r.doc_id]}</span>}
                <span className="flex-1" /><span className="text-gray-500">{ROLES[r.actor_role] || r.actor_role}</span>{r.ip && <span className="text-gray-400">{r.ip}</span>}
              </button>
              {open === r.id && <div className="ml-5 mt-1 space-y-0.5 font-mono text-[10px] text-gray-600">{ch.map((c) => <div key={c}>{c}</div>)}{r.note && <div>{r.note}</div>}</div>}
            </div>); })}
        </div>
      )}
      <div className="text-[11px] text-gray-500">The audit trail is kept by the database and cannot be edited or deleted.</div>
    </div>
  );
}
