// V63 — "📄 Notice" buttons: open the payment notice (print / save as PDF)
import { useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openTaxNotice, buildTaxNoticeHtml } from '../lib/taxNotice';

/** Admin: client details are already loaded */
export function NoticeButton({ row, client, className = '', label = 'Notice' }) {
  return (
    <button type="button" title="Payment notice — print / save as PDF" onClick={(e) => { e.stopPropagation(); if (!openTaxNotice(row, client)) toast.error('Allow pop-ups to open the notice'); }}
      className={`btn-secondary text-xs py-1 px-2 ${className}`}><FileText size={12} /> {label}</button>
  );
}

/** Client portal: loads the client's own name / TIN / NIC first */
export function ClientNoticeButton({ row, className = '' }) {
  const [busy, setBusy] = useState(false);
  const open = async (e) => {
    e.stopPropagation();
    const w = window.open('', '_blank', 'width=920,height=900');
    setBusy(true);
    try {
      const { data: c, error } = await supabase.from('clients').select('full_name, tin, nic, client_no').eq('id', row.client_id).single();
      if (error) throw new Error(error.message);
      if (!w) throw new Error('Allow pop-ups to open the notice');
      w.document.open(); w.document.write(buildTaxNoticeHtml(row, c)); w.document.close(); w.focus();
    } catch (err) { w?.close(); toast.error(err.message); }
    setBusy(false);
  };
  return (
    <button type="button" onClick={open} disabled={busy} className={`text-[11px] font-semibold text-primary-700 hover:underline inline-flex items-center gap-0.5 ${className}`}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} Payment notice
    </button>
  );
}
