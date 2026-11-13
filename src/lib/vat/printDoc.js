// V64 — Printable Tax Invoice / Non-Tax Invoice / Credit Note / Debit Note (5 templates).
// The visual template only changes the look. Every IRD field of a tax invoice is always printed
// (Circular SEC/2026/E/03): "TAX INVOICE", supplier TIN / name / address, purchaser TIN / name / address,
// serial number, invoice date, date of supply, description, quantity + unit, value excl. VAT, VAT, total incl. VAT.
// The data comes straight from the stored document (vi_document_json / vi_public_document), never recalculated here.
import { money, qty, dmyNum, amountInWords, docTitle, METHODS, CREDIT_REASONS, DEBIT_REASONS } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const imgOk = (s) => typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
const colorOk = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#1e3a8a');

const CSS = (brand, paper) => `
@page{size:${paper === 'Letter' ? 'letter' : 'A4'};margin:14mm 12mm 16mm 12mm;
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px Arial,sans-serif;color:#667}}
*{box-sizing:border-box}body{margin:0;font:11.5px/1.45 "Segoe UI",Arial,"Noto Sans Sinhala","Noto Sans Tamil",sans-serif;color:#1f2937;background:#f3f4f6}
.sheet{background:#fff;max-width:820px;margin:0 auto;padding:26px 30px;position:relative}
@media print{body{background:#fff}.sheet{padding:0;max-width:none}.tb{display:none!important}}
.tb{position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:center;padding:10px;background:#111827}
.tb button{font:600 13px Arial;padding:8px 16px;border-radius:8px;border:0;cursor:pointer;background:#eab308;color:#111}
.tb button.g{background:#374151;color:#fff}
.hd{display:flex;gap:18px;align-items:flex-start;justify-content:space-between}
.hd.center{flex-direction:column;align-items:center;text-align:center}.hd.right{flex-direction:row-reverse}
.logo{max-height:70px;max-width:200px;object-fit:contain}
.sup .nm{font-size:17px;font-weight:800;color:${brand}}.sup .tr{font-size:12px;font-weight:600;color:#374151}
.sup div{font-size:11px}.muted{color:#6b7280}
.ttl{margin:16px 0 10px;text-align:center}.ttl h1{margin:0;font-size:24px;letter-spacing:3px;color:${brand}}
.ttl .sub{font-size:10.5px;color:#6b7280}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.box{border:1px solid #d1d5db;border-radius:6px;padding:8px 10px}.box h3{margin:0 0 4px;font-size:10px;letter-spacing:1px;color:${brand};text-transform:uppercase}
.kv{width:100%;border-collapse:collapse}.kv td{padding:1.5px 0;vertical-align:top}.kv td.k{color:#6b7280;width:42%;padding-right:6px}.kv td.v{font-weight:600}
table.ln{width:100%;border-collapse:collapse;margin-top:4px}table.ln thead{display:table-header-group}
table.ln th{background:${brand};color:#fff;font-size:10px;text-align:left;padding:6px 5px;font-weight:700}
table.ln td{padding:5px;border-bottom:1px solid #e5e7eb;vertical-align:top}table.ln tr{page-break-inside:avoid}
.r{text-align:right;white-space:nowrap}.c{text-align:center}
.tot{display:flex;justify-content:space-between;gap:16px;margin-top:10px;page-break-inside:avoid}
.tot table{border-collapse:collapse;min-width:300px}.tot td{padding:3px 6px}.tot tr.g td{font-size:14px;font-weight:800;border-top:2px solid ${brand};color:${brand}}
.words{font-size:11px;font-style:italic;max-width:360px}
.note{margin-top:12px;border-left:3px solid ${brand};background:#f9fafb;padding:7px 10px;page-break-inside:avoid}
.note h4{margin:0 0 3px;font-size:10.5px;color:${brand};text-transform:uppercase;letter-spacing:.5px}
.sig{display:flex;justify-content:space-between;margin-top:26px;page-break-inside:avoid}.sig div{width:42%;text-align:center;border-top:1px solid #9ca3af;padding-top:4px;font-size:10px;color:#4b5563}
.sig img{max-height:60px;display:block;margin:0 auto 4px}
.ftr{margin-top:14px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:9.5px;color:#6b7280;text-align:center}
.lock{margin:8px 0;padding:6px 10px;border:1px solid #16a34a;background:#f0fdf4;color:#166534;border-radius:6px;font-weight:700;font-size:11px;text-align:center}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:110px;font-weight:900;color:rgba(220,38,38,.12);transform:rotate(-24deg);pointer-events:none;z-index:0}
.adj td{font-size:11px}
/* Template 02 – Modern */
body.modern .hd{background:${brand};color:#fff;padding:16px 18px;border-radius:12px}
body.modern .sup .nm,body.modern .sup .tr,body.modern .sup div,body.modern .muted{color:#fff}
body.modern .box{border:0;background:#f3f4f6;border-radius:10px}body.modern table.ln th{border-radius:0}
body.modern .ttl h1{font-weight:300;letter-spacing:6px}
/* Template 03 – Minimal */
body.minimal table.ln th{background:#fff;color:#111;border-bottom:2px solid #111}body.minimal .box{border:0;padding:0}
body.minimal .ttl h1{color:#111;font-size:20px}body.minimal .sup .nm{color:#111}body.minimal .note{border-left-color:#111;background:#fff}
body.minimal .tot tr.g td{border-top-color:#111;color:#111}
/* Template 04 – Corporate */
body.corporate .sheet{border-top:10px solid ${brand}}body.corporate .ttl{text-align:right}body.corporate .ttl h1{font-size:28px}
body.corporate .box{border-radius:0;border-color:${brand}}body.corporate .box h3{background:${brand};color:#fff;margin:-8px -10px 6px;padding:4px 10px}
/* Template 01 – Classic */
body.classic .ttl h1{font-family:Georgia,"Times New Roman",serif}body.classic .sup .nm{font-family:Georgia,serif}
/* Template 05 – Tax Compliance: each IRD field in its own labelled cell */
body.compliance .ttl h1{border:2px solid #111;display:inline-block;padding:4px 18px;color:#111}
body.compliance .box{border-radius:0;border:1px solid #111}body.compliance table.ln th{background:#e5e7eb;color:#111;border:1px solid #111}
body.compliance table.ln td{border:1px solid #9ca3af}body.compliance .irdf{display:block}
.irdf{display:none;margin-top:8px;font-size:9.5px;color:#374151;border:1px dashed #9ca3af;padding:5px 8px}
`;

/**
 * data: { doc, lines, original, notes_against, brand } (from vi_document_json / vi_public_document)
 * opts: { toolbar, draftPreview, showBalance }
 */
export function buildDocHtml(data, opts = {}) {
  const d = data.doc || {}, b = data.brand || {}, s = d.supplier || {}, c = d.customer || {}, lines = data.lines || [];
  const brand = colorOk(b.brand_color);
  const tpl = ['classic', 'modern', 'minimal', 'corporate', 'compliance'].includes(d.template_key) ? d.template_key : (b.template_key || 'classic');
  const isNote = d.doc_type === 'credit' || d.doc_type === 'debit';
  const tax = !!d.is_tax;
  const title = docTitle(d);
  const logo = imgOk(b.logo) ? `<img class="logo" src="${b.logo}" alt="">` : '';
  const pos = ['left', 'center', 'right'].includes(b.logo_position) ? b.logo_position : 'left';
  const sign = (x) => (d.doc_type === 'credit' ? `(${money(x)})` : money(x));
  const vatRates = [...new Set(lines.filter((l) => Number(l.rate) > 0).map((l) => Number(l.rate)))];
  const reasons = d.doc_type === 'credit' ? CREDIT_REASONS : DEBIT_REASONS;
  const anyDisc = lines.some((l) => Number(l.discount) > 0);

  const supplierBlock = `<div class="sup">
    <div class="nm">${esc(s.legal_name || b.brand_name || '')}</div>
    ${s.trading_name && s.trading_name !== s.legal_name ? `<div class="tr">Trading as ${esc(s.trading_name)}</div>` : ''}
    <div>${nl(s.address || '')}</div>
    ${s.branch ? `<div>Branch: ${esc(s.branch)}</div>` : ''}
    ${tax || s.tin ? `<div><b>TIN:</b> ${esc(s.tin || '—')}${s.vat_no ? ` &nbsp;·&nbsp; <b>VAT No:</b> ${esc(s.vat_no)}` : ''}</div>` : ''}
    <div class="muted">${[s.phone && `Tel: ${esc(s.phone)}`, s.mobile && `Mobile: ${esc(s.mobile)}`, s.email && esc(s.email), s.website && esc(s.website)].filter(Boolean).join(' · ')}</div>
    ${s.brn ? `<div class="muted">Business Reg. No: ${esc(s.brn)}</div>` : ''}
  </div>`;

  const meta = [
    [isNote ? `${title.includes('CREDIT') ? 'Credit' : 'Debit'} note No.` : 'Invoice No.', `<b>${esc(d.doc_no || 'DRAFT — number given at issue')}</b>`],
    [isNote ? 'Date' : 'Invoice date', dmyNum(d.issue_date)],
    ...(d.doc_type === 'tax' || d.supply_date ? [['Date of supply', dmyNum(d.supply_date)]] : []),
    ...(isNote ? [['Original invoice', `${esc(data.original?.doc_no || '')} · ${dmyNum(data.original?.issue_date)}`], ['Reason', esc(reasons[d.reason_code] || d.reason_code || '') + (d.reason ? ` — ${esc(d.reason)}` : '')]] : []),
    ...(!isNote && d.due_date ? [['Due date', `${dmyNum(d.due_date)}${d.terms_days != null ? ` (${d.terms_days ? `${d.terms_days} days` : 'immediate'})` : ''}`]] : []),
    ...(d.place_of_supply ? [['Place of supply', esc(d.place_of_supply)]] : []),
    ...(d.payment_mode ? [['Mode of payment', esc(METHODS[d.payment_mode] || d.payment_mode)]] : []),
  ];
  const buyer = [
    ['Name', `<b>${esc(c.name || '')}</b>${c.company_name && c.company_name !== c.name ? `<br>${esc(c.company_name)}` : ''}`],
    ...(tax || c.tin ? [['TIN', esc(c.tin || (tax ? '— (not VAT-registered)' : '—'))]] : []),
    ...(c.vat_no ? [['VAT No.', esc(c.vat_no)]] : []),
    ['Address', nl(c.address || '—')],
    ...(c.phone ? [['Telephone', esc(c.phone)]] : []),
  ];
  const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('')}</table>`;

  const head = `<tr><th class="c" style="width:26px">#</th><th>Description of goods / services</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price</th>
    ${anyDisc ? '<th class="r">Discount</th>' : ''}<th class="r">${tax ? 'Value excl. VAT' : 'Amount'}</th>${tax ? '<th class="r">VAT %</th><th class="r">VAT</th><th class="r">Total incl. VAT</th>' : ''}</tr>`;
  const body = lines.map((l, i) => `<tr>
    <td class="c">${i + 1}</td><td>${nl(l.description)}${tax && l.treatment === 'zero' ? ' <i class="muted">(zero-rated)</i>' : ''}${tax && l.treatment === 'exempt' ? ' <i class="muted">(exempt)</i>' : ''}</td>
    <td class="r">${qty(l.quantity)}</td><td>${esc(l.unit)}</td><td class="r">${money(l.unit_price)}</td>
    ${anyDisc ? `<td class="r">${Number(l.discount) ? money(l.discount) : ''}</td>` : ''}
    <td class="r">${money(l.net)}</td>${tax ? `<td class="r">${Number(l.rate)}%</td><td class="r">${money(l.vat)}</td><td class="r">${money(l.total)}</td>` : ''}
  </tr>`).join('');

  const totals = [
    ...(Number(d.discount_total) ? [['Gross amount', money(d.gross)], ['Discount', `(${money(d.discount_total)})`]] : []),
    ...(tax ? [
      ['Value of supply excluding VAT', money(d.net_total)],
      ...(Number(d.taxable_zero) ? [['of which zero-rated', money(d.taxable_zero)]] : []),
      ...(Number(d.exempt_amount) ? [['of which exempt', money(d.exempt_amount)]] : []),
      [`VAT${vatRates.length === 1 ? ` @ ${vatRates[0]}%` : ''}`, money(d.vat_total)],
    ] : []),
  ];
  const showBal = opts.showBalance !== false && !isNote && d.status === 'issued' && (Number(d.paid) || Number(d.credited) || Number(d.debited));
  const balRows = showBal ? [
    ...(Number(d.debited) ? [['Debit notes', `+ ${money(d.debited)}`]] : []),
    ...(Number(d.credited) ? [['Credit notes', `− ${money(d.credited)}`]] : []),
    ...(Number(d.paid) ? [['Paid', `− ${money(d.paid)}`]] : []),
    ['Balance due', `<b>${money(d.balance)}</b>`],
  ] : [];

  const notesAgainst = (data.notes_against || []);
  const adjust = !isNote && notesAgainst.length ? `<div class="note"><h4>Adjustments to this invoice</h4><table class="kv adj">
      ${notesAgainst.map((n) => `<tr><td class="k">${n.doc_type === 'credit' ? 'Credit note' : 'Debit note'} ${esc(n.doc_no)} · ${dmyNum(n.issue_date)}</td><td class="v r">${n.doc_type === 'credit' ? '−' : '+'} ${money(n.total)} <span class="muted">(VAT ${money(n.vat_total)})</span></td></tr>`).join('')}
      <tr><td class="k">Original amount</td><td class="v r">${money(d.total)}</td></tr>
      <tr><td class="k">Adjusted amount</td><td class="v r">${money(Number(d.total) + Number(d.debited) - Number(d.credited))}</td></tr></table></div>` : '';

  const ramis = (d.ramis_status === 'accepted' || d.ramis_status === 'locked')
    ? `<div class="lock">✔ Submitted to IRD/RAMIS – Locked${d.ramis_ref ? ` · RAMIS ref ${esc(d.ramis_ref)}` : ''}</div>` : '';
  const pay = !isNote && (b.payment_instructions || b.bank_details || b.online_pay_url)
    ? `<div class="note"><h4>Payment instructions</h4>${b.payment_instructions ? `<div>${nl(b.payment_instructions)}</div>` : ''}${b.bank_details ? `<div style="margin-top:3px">${nl(b.bank_details)}</div>` : ''}${b.online_pay_url && opts.payLink !== false ? `<div style="margin-top:3px">Pay online: ${esc(b.online_pay_url)}</div>` : ''}</div>` : '';
  const wm = d.status === 'cancelled' ? '<div class="wm">CANCELLED</div>' : opts.draftPreview || d.status === 'draft' ? '<div class="wm">DRAFT</div>' : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} ${esc(d.doc_no || '')}</title><style>${CSS(brand, b.paper)}</style></head><body class="${tpl}">
${opts.toolbar ? '<div class="tb"><button onclick="window.print()">🖨 Print / Save as PDF</button><button class="g" onclick="window.close()">Close</button></div>' : ''}
${wm}<div class="sheet">
  ${b.header_text ? `<div class="muted" style="text-align:center;margin-bottom:6px">${nl(b.header_text)}</div>` : ''}
  <div class="hd ${pos}">${pos === 'right' ? supplierBlock + logo : logo + supplierBlock}</div>
  <div class="ttl"><h1>${esc(title)}</h1>${tax && d.doc_type === 'tax' ? '<div class="sub">Issued under the Value Added Tax Act No. 14 of 2002</div>' : ''}
    ${d.status === 'cancelled' ? `<div class="sub" style="color:#b91c1c;font-weight:700">CANCELLED ${d.cancel_reason ? `— ${esc(d.cancel_reason)}` : ''}</div>` : ''}</div>
  ${ramis}
  <div class="grid"><div class="box"><h3>${tax ? 'Purchaser' : 'Bill to'}</h3>${kv(buyer)}</div><div class="box"><h3>Details</h3>${kv(meta)}</div></div>
  <table class="ln"><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="tot"><div class="words"><b>Amount in words:</b> ${esc(amountInWords(d.total))}${d.doc_type === 'credit' ? ' (credit)' : ''}
      ${tax ? `<div class="muted" style="margin-top:6px;font-style:normal">${d.price_mode === 'inclusive' ? 'Prices include VAT.' : 'Prices exclude VAT.'} All amounts in Sri Lankan Rupees (LKR).</div>` : '<div class="muted" style="margin-top:6px;font-style:normal">All amounts in Sri Lankan Rupees (LKR).</div>'}</div>
    <table>${totals.map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join('')}
      <tr class="g"><td>${tax ? 'Total including VAT' : 'Total'}</td><td class="r">LKR ${sign(d.total)}</td></tr>
      ${balRows.map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</table></div>
  ${adjust}${pay}
  ${d.notes ? `<div class="note"><h4>Notes</h4>${nl(d.notes)}</div>` : ''}
  ${d.terms && !isNote ? `<div class="note"><h4>Terms &amp; conditions</h4>${nl(d.terms)}</div>` : ''}
  <div class="sig"><div>Received by (purchaser)</div><div>${imgOk(b.stamp) ? `<img src="${b.stamp}" alt="">` : ''}Authorised signature — ${esc(s.legal_name || '')}</div></div>
  ${tax ? `<div class="irdf">IRD tax invoice fields: supplier TIN ${esc(s.tin || '—')} · supplier name &amp; address as per VAT registration · purchaser TIN ${esc(c.tin || '—')} · serial ${esc(d.doc_no || '—')} (YYMMM_QQQQ_XXXXX) · invoice date ${dmyNum(d.issue_date)} · date of supply ${dmyNum(d.supply_date)} · value excl. VAT ${money(d.net_total)} · VAT ${money(d.vat_total)} · total incl. VAT ${money(d.total)}</div>` : ''}
  <div class="ftr">${b.footer_text ? `${nl(b.footer_text)}<br>` : ''}${tax && d.compliance ? `${esc(d.compliance)} · ` : ''}${d.doc_type === 'nontax' ? 'This is not a VAT tax invoice. · ' : ''}Prepared with TaxMate Solutions</div>
</div></body></html>`;
  return html;
}

/** Open a print window (opened first, inside the click, so the browser allows it) */
export function openPrintWindow() {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font:14px Arial;padding:20px">Preparing the document…</p>');
  return w;
}
export function writePrint(w, html) {
  if (!w) { const b = new Blob([html], { type: 'text/html' }); window.open(URL.createObjectURL(b), '_blank'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
