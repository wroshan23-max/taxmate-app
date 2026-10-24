// ═══════════════════════════════════════════════════════════
//  TaxMate E-Invoice — shared logic + V16 print template
// ═══════════════════════════════════════════════════════════
import { FIRM } from './iitStatement';

import { SERVICE_CATALOG, DEFAULT_NOTE, INVOICE_DEFAULTS, INVOICE_CFG, applyInvoiceSettings } from './invoiceConfig';
export { SERVICE_CATALOG, DEFAULT_NOTE, INVOICE_DEFAULTS, INVOICE_CFG, applyInvoiceSettings };

// Status model: draft → unpaid ("Sent") → paid. 'overdue' is a legacy value treated as sent.
export const isSent = (s) => s === 'unpaid' || s === 'overdue';
export const STATUS_LABEL = { draft: '📝 Draft', unpaid: '📤 Sent', overdue: '📤 Sent', paid: '✅ Paid' };

const n = (x) => parseFloat(x) || 0;
export const itemAmount = (it) => (n(it.quantity) || 1) * n(it.unit_price) * (1 - n(it.discount_pct) / 100);

export function computeTotals(items, discountPct) {
  const subtotal = items.reduce((s, it) => s + itemAmount(it), 0);
  const discount_amt = subtotal * n(discountPct) / 100;
  return { subtotal, discount_amt, total: subtotal - discount_amt };
}

// PREFIX-YYYY-NNNN — NNNN continues across years and prefixes (same as V16)
export function nextInvoiceNo(existingNos, dateStr) {
  const yr = (dateStr ? new Date(dateStr) : new Date()).getFullYear();
  const max = existingNos.reduce((m, no) => {
    const k = /-\d{4}-(\d+)$/.exec(no || '');
    return k ? Math.max(m, parseInt(k[1], 10)) : m;
  }, 0);
  return `${INVOICE_CFG.prefix}-${yr}-${String(max + 1).padStart(4, '0')}`;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (iso, days) => {
  const d = new Date(iso || todayISO());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
export const isOverdue = (inv) => isSent(inv.status) && inv.due_date && inv.due_date < todayISO();

// Client details printed on the invoice: saved snapshot, else the linked client record
export function billTo(inv) {
  const s = inv.client_snapshot || {};
  const c = inv.clients || {};
  return {
    name: s.name || c.full_name || '',
    tin: s.tin ?? c.tin ?? '',
    nic: s.nic ?? c.nic ?? '',
    phone: s.phone ?? c.mobile ?? '',
    email: s.email ?? c.email ?? '',
    address: s.address ?? c.address ?? '',
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rs = (v) => 'Rs. ' + (Math.round((v || 0) * 100) / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// inv: invoice row (+ clients join optional); items: invoice_items rows; bank: bank_accounts row or null
export function buildInvoiceHtml(inv, items = [], bank = null, { autoPrint = false, preview = false } = {}) {
  const c = billTo(inv);
  const sorted = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const subtotal = inv.subtotal ?? sorted.reduce((s, it) => s + itemAmount(it), 0);
  const discPct = n(inv.discount_pct);
  const discAmt = inv.discount_amt ?? subtotal * discPct / 100;
  const total = inv.total_amount ?? subtotal - discAmt;
  const td = 'padding:7px 12px;border-bottom:1px solid #e8eef8';

  const itemRows = sorted.map((it, i) => `<tr>
      <td style="${td}">${i + 1}</td>
      <td style="${td}">${esc(it.description)}</td>
      <td style="${td};text-align:center">${n(it.quantity) || 1}</td>
      <td style="${td};text-align:right">${rs(n(it.unit_price))}</td>
      <td style="${td};text-align:center">${n(it.discount_pct) > 0 ? n(it.discount_pct) + '%' : '&mdash;'}</td>
      <td style="${td};text-align:right;font-weight:700;color:#1a3c6e">${rs(it.amount ?? itemAmount(it))}</td></tr>`).join('');

  const discRow = discPct > 0
    ? `<tr><td colspan="5" style="text-align:right;padding:7px 12px;font-size:9pt;color:#1a7a4a">Discount (${discPct}%)</td><td style="text-align:right;padding:7px 12px;font-size:9pt;color:#1a7a4a;font-weight:700">&minus; ${rs(discAmt)}</td></tr>` : '';

  const bankHtml = bank
    ? `<div style="margin-top:10px;padding:9px 14px;background:#f0f4fc;border-radius:6px;border-left:3px solid #1a3c6e;font-size:9pt;line-height:1.9">
        <strong style="color:#1a3c6e">&#x1F4B3; Bank Transfer Details:</strong><br>
        Bank: <strong>${esc(bank.bank_name)}</strong>${bank.branch ? ' &mdash; ' + esc(bank.branch) : ''}<br>
        ${bank.account_name ? `Account Name: <strong>${esc(bank.account_name)}</strong><br>` : ''}
        Account No: <strong style="font-size:11pt;color:#1a3c6e">${esc(bank.account_no)}</strong></div>` : '';

  const sigHtml = inv.signature
    ? `<img src="${inv.signature}" style="max-height:65px;max-width:220px;display:inline-block;margin-top:8px" alt="Signature">`
    : '<div style="margin:28px 0 0 auto;border-bottom:1px solid #999;width:200px"></div>';

  const paidStamp = inv.status === 'paid'
    ? `<div style="display:inline-block;transform:rotate(-10deg);border:3px solid #1a7a4a;color:#1a7a4a;font-weight:900;font-size:16pt;padding:2px 14px;border-radius:8px;opacity:.8;margin:4px 12px 0 0;vertical-align:middle">PAID${inv.paid_date ? `<div style="font-size:7.5pt;text-align:center">${esc(inv.paid_date)}</div>` : ''}</div>` : '';

  const invNo = esc(inv.invoice_no || '') + (preview ? ' (PREVIEW)' : '');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Invoice ${esc(inv.invoice_no || 'Preview')} | ${FIRM.name}</title>
<style>@page{margin:14mm 12mm;size:A4}*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5pt;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;position:relative}
.bar{display:flex;justify-content:center;padding:10px 0;border-bottom:1px solid #eee;margin-bottom:10px}
.bar button{background:#1a3c6e;color:#fff;border:none;border-radius:6px;padding:9px 26px;font-size:11pt;font-weight:700;cursor:pointer;font-family:inherit}
@media print{.bar{display:none}}</style></head><body>
<div class="bar"><button onclick="window.print()">&#128424; Print / Save as PDF</button></div>
<div style="background:#1a3c6e;color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:flex-start;border-radius:4px 4px 0 0">
  <div><div style="font-size:20pt;font-weight:900;letter-spacing:1px">Tax<span style="color:#e8a020">Mate</span> Solutions</div>
  <div style="font-size:8.5pt;opacity:.8;margin-top:2px">${esc(FIRM.tagline)}</div></div>
  <div style="text-align:right;font-size:8.5pt;line-height:2;opacity:.9">
    <div>&#x1F4E7; ${FIRM.email}</div><div>&#x1F4F1; ${FIRM.phone}</div><div>&#x1F310; ${FIRM.web}</div>${FIRM.facebook ? `<div>&#x1F4D8; ${esc(FIRM.facebook)}</div>` : ''}</div>
</div>
<div style="background:#f0f4fc;border:1px solid #c8d4e8;border-top:none;padding:10px 24px;display:flex;justify-content:space-between;align-items:center">
  <div><div style="font-size:14pt;font-weight:900;color:#1a3c6e">TAX INVOICE</div>
  <div style="font-size:8pt;color:#6b7a99;margin-top:2px">Issued under IRD Sri Lanka guidelines | Sequential Numbering</div></div>
  <div style="background:#1a3c6e;color:#fff;border-radius:6px;padding:4px 14px;font-size:9pt;font-weight:700">${invNo}</div>
</div>
<div style="border:1px solid #c8d4e8;border-top:none;display:grid;grid-template-columns:1fr 1fr">
  <div style="padding:12px 20px;border-right:1px solid #c8d4e8">
    <div style="font-size:7.5pt;font-weight:800;color:#6b7a99;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">From (Seller)</div>
    <div style="font-weight:800;color:#1a3c6e;font-size:11pt">${FIRM.name}</div>
    <div style="font-size:9pt;color:#444;line-height:1.8;margin-top:3px">${FIRM.email}<br>${FIRM.phone}<br>${FIRM.web}</div>
  </div>
  <div style="padding:12px 20px">
    <div style="font-size:7.5pt;font-weight:800;color:#6b7a99;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Bill To (Client)</div>
    <div style="font-weight:800;color:#1a3c6e;font-size:11pt">${esc(c.name)}</div>
    <div style="font-size:9pt;color:#444;line-height:1.8;margin-top:3px">
      ${c.tin ? 'TIN: ' + esc(c.tin) + '<br>' : ''}${c.nic ? 'NIC: ' + esc(c.nic) + '<br>' : ''}${c.phone ? esc(c.phone) + '<br>' : ''}${c.email ? esc(c.email) + '<br>' : ''}${c.address ? esc(c.address) : ''}
    </div>
  </div>
</div>
<div style="border:1px solid #c8d4e8;border-top:none;display:grid;grid-template-columns:1fr 1fr 1fr;background:#f8faff">
  <div style="padding:8px 20px;border-right:1px solid #e0e8f8"><div style="font-size:7.5pt;color:#6b7a99;font-weight:700;text-transform:uppercase">Invoice Date</div><div style="font-size:10pt;font-weight:700;color:#1a3c6e;margin-top:2px">${esc(inv.issue_date || '')}</div></div>
  <div style="padding:8px 20px;border-right:1px solid #e0e8f8"><div style="font-size:7.5pt;color:#6b7a99;font-weight:700;text-transform:uppercase">Due Date</div><div style="font-size:10pt;font-weight:700;color:#1a3c6e;margin-top:2px">${esc(inv.due_date || 'On receipt')}</div></div>
  <div style="padding:8px 20px"><div style="font-size:7.5pt;color:#6b7a99;font-weight:700;text-transform:uppercase">Invoice No.</div><div style="font-size:10pt;font-weight:700;color:#1a3c6e;margin-top:2px">${invNo}</div></div>
</div>
<div style="border:1px solid #c8d4e8;border-top:none">
  <div style="background:#1a3c6e;color:#fff;padding:7px 20px;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Services / Items</div>
  <table style="width:100%;border-collapse:collapse;font-size:10pt">
    <thead><tr style="background:#f0f4fc">
      ${['#:left:5', 'Description:left:42', 'Qty:center:8', 'Unit Price:right:20', 'Discount:center:10', 'Amount:right:15'].map(h => { const [t, a, w] = h.split(':'); return `<th style="padding:8px 12px;text-align:${a};font-size:8pt;font-weight:700;color:#1a3c6e;border-bottom:1px solid #c8d4e8;width:${w}%">${t}</th>`; }).join('')}
    </tr></thead>
    <tbody>${itemRows || '<tr><td colspan="6" style="padding:16px;text-align:center;color:#999">No items</td></tr>'}</tbody>
    <tfoot>
      <tr style="background:#f8faff"><td colspan="5" style="text-align:right;padding:8px 12px;font-size:9pt;color:#6b7a99;font-weight:700">Subtotal</td><td style="text-align:right;padding:8px 12px;font-weight:700;color:#1a3c6e;font-size:9.5pt;white-space:nowrap">${rs(subtotal)}</td></tr>
      ${discRow}
      <tr style="background:#fff0d0"><td colspan="5" style="text-align:right;padding:10px 12px;font-size:11pt;font-weight:900;color:#7a4000">TOTAL DUE</td><td style="text-align:right;padding:10px 12px;font-size:13pt;font-weight:900;color:#1a3c6e;white-space:nowrap">${rs(total)}</td></tr>
    </tfoot>
  </table>
</div>
<div style="border:1px solid #c8d4e8;border-top:none;display:grid;grid-template-columns:1fr 1fr">
  <div style="padding:14px 20px;border-right:1px solid #e0e8f8">
    <div style="font-size:7.5pt;font-weight:800;color:#6b7a99;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Notes / Payment Instructions</div>
    <div style="font-size:9pt;color:#444;line-height:1.7">${esc(inv.notes || INVOICE_CFG.defaultNote).replace(/\n/g, '<br>')}${bankHtml}</div>
  </div>
  <div style="padding:14px 20px;text-align:right">
    <div style="font-size:7.5pt;font-weight:800;color:#6b7a99;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Authorized Signature</div>
    ${paidStamp}${sigHtml}
    <div style="font-size:8.5pt;color:#1a3c6e;font-weight:700;margin-top:8px">${FIRM.name}</div>
  </div>
</div>
<div style="border:1px solid #c8d4e8;border-top:2px solid #1a3c6e;padding:10px 20px;background:#f8faff;border-radius:0 0 4px 4px;display:flex;justify-content:space-between;align-items:center">
  <div style="font-size:7.5pt;color:#6b7a99;line-height:1.8">This is an official invoice from ${FIRM.name}. Invoice numbering is sequential per IRD Sri Lanka guidelines.<br>For queries: ${FIRM.email} | ${FIRM.phone}</div>
  <div style="background:#1a3c6e;color:#fff;border-radius:5px;padding:5px 14px;font-size:8pt;font-weight:700;text-align:center;flex-shrink:0;margin-left:16px">TaxMate<br>Solutions</div>
</div>
${autoPrint ? '<script>window.onload=function(){try{window.print()}catch(e){}}<\/script>' : ''}
</body></html>`;
}

// win: optionally a window already opened inside the click handler (avoids pop-up blockers after an await)
export function openInvoice(inv, items, bank, opts = {}, win = null) {
  const w = win ?? window.open('', '_blank', 'width=900,height=900');
  if (!w) return false;
  w.document.open();
  w.document.write(buildInvoiceHtml(inv, items, bank, opts));
  w.document.close();
  w.focus();
  return true;
}

export function exportInvoicesCSV(rows, banks = []) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const hdr = ['Invoice No', 'Date', 'Due Date', 'Client Name', 'Client TIN', 'Subtotal (Rs.)', 'Discount (Rs.)', 'Total (Rs.)', 'Status', 'Paid Date', 'Bank Account'];
  const lines = rows.map(inv => {
    const c = billTo(inv);
    const bk = banks.find(b => b.id === inv.bank_account_id)?.bank_name ?? '';
    const sub = inv.subtotal ?? inv.total_amount ?? 0;
    return [inv.invoice_no, inv.issue_date, inv.due_date ?? '', q(c.name), c.tin, Number(sub).toFixed(2),
      Number(inv.discount_amt ?? 0).toFixed(2), Number(inv.total_amount ?? 0).toFixed(2),
      (STATUS_LABEL[inv.status] ?? inv.status).replace(/^\S+\s/, ''), inv.paid_date ?? '', q(bk)].join(',');
  });
  const blob = new Blob([[hdr.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `TaxMate_Invoices_${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Fetch everything needed to print one saved invoice
export async function loadInvoiceForPrint(supabase, invoiceId) {
  const { data: inv, error } = await supabase.from('invoices')
    .select('*, clients(full_name, tin, nic, mobile, email, address), invoice_items(*)').eq('id', invoiceId).single();
  if (error) throw error;
  let bank = null;
  if (inv.bank_account_id) {
    const { data } = await supabase.from('bank_accounts').select('*').eq('id', inv.bank_account_id).maybeSingle();
    bank = data;
  }
  return { inv, items: inv.invoice_items ?? [], bank };
}
