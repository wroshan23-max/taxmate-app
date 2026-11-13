// V64 — Settings: company & VAT, branding & templates, numbering, payment terms, reminders, RAMIS, users
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, Loader2, Upload, Trash2, Plus, Pencil, Landmark, ShieldCheck, Users } from 'lucide-react';
import { saveSettings, loadSequences, saveSequence, saveBranch, ramisInfo, saveRamisConfig, loadMembers, saveMember, removeMember } from '../../lib/vat/api';
import { TEMPLATES, ROLES, TERMS, slToday, dt } from '../../lib/vat/format';
import { buildDocHtml } from '../../lib/vat/printDoc';
import { t } from '../../lib/vat/i18n';
import { Field, Modal, Badge, Spinner, ScaledFrame } from './ui';

const TABS = [['company', 'Company & VAT'], ['branding', 'Branding & templates'], ['numbering', 'Invoice numbering'], ['terms', 'Payment terms'], ['reminders', 'Reminders'], ['ramis', 'RAMIS integration'], ['users', 'Users & roles']];

export default function Settings({ app }) {
  const { nav, go, data, can } = app;
  const tab = nav.tab || 'company';
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ ...EMPTY, ...Object.fromEntries(Object.entries(data.settings || {}).map(([k, v]) => [k, v ?? ''])) }); }, [data.settings]);
  if (!f) return <Spinner />;
  const ro = !can('settings');
  const save = async (patch) => {
    setBusy(true);
    try { await saveSettings(app.clientId, { ...f, ...patch }); toast.success('Saved'); await app.reload(['settings']); app.reloadCtx(); } catch (e) { toast.error(e.message, { duration: 7000 }); } finally { setBusy(false); }
  };
  const saveBtn = () => !ro && <div className="flex justify-end border-t pt-3"><button type="button" disabled={busy} className="btn-primary text-sm" onClick={() => save()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button></div>;
  const s = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => go('settings', { tab: k })} className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === k ? 'bg-primary-700 text-white' : 'border bg-white text-gray-600'}`}>{l}</button>)}</div>
      {ro && <div className="card p-3 text-xs text-gray-600">Your role can view settings only.</div>}

      {tab === 'company' && (
        <fieldset disabled={ro} className="card space-y-3 p-4">
          <div className="text-sm font-bold text-primary-800">Business information</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Legal business name" hint="Exactly as on the VAT registration certificate (printed on tax invoices)." className="sm:col-span-2"><input className="input" value={f.legal_name} onChange={s('legal_name')} /></Field>
            <Field label="Trading name"><input className="input" value={f.trading_name} onChange={s('trading_name')} /></Field>
            <Field label="Business registration no."><input className="input" value={f.brn} onChange={s('brn')} /></Field>
            <Field label="TIN (9 digits)"><input className="input" inputMode="numeric" maxLength={9} value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Business activity"><input className="input" value={f.activity} onChange={s('activity')} /></Field>
            <Field label="Registered address" hint="As on the VAT registration certificate." className="sm:col-span-3"><textarea className="input" rows={2} value={f.address} onChange={s('address')} /></Field>
            <Field label="Telephone"><input className="input" value={f.phone} onChange={s('phone')} /></Field>
            <Field label="Mobile"><input className="input" value={f.mobile} onChange={s('mobile')} /></Field>
            <Field label="Email"><input className="input" type="email" value={f.email} onChange={s('email')} /></Field>
            <Field label="Website"><input className="input" value={f.website} onChange={s('website')} /></Field>
            <Field label="Industry"><input className="input" value={f.industry} onChange={s('industry')} /></Field>
            <Field label="Country"><input className="input" value={f.country} onChange={s('country')} /></Field>
            <Field label="Currency"><select className="input" value={f.currency} onChange={s('currency')}><option value="LKR">LKR — Sri Lankan Rupee</option></select></Field>
            <Field label="Time zone"><select className="input" value={f.time_zone} onChange={s('time_zone')}><option value="Asia/Colombo">Asia/Colombo (UTC+5:30)</option></select></Field>
            <Field label="Language of the module"><select className="input" value={f.locale} onChange={s('locale')}><option value="en">English</option><option value="si">සිංහල (partly)</option><option value="ta">தமிழ் (partly)</option></select></Field>
          </div>
          <div className="text-sm font-bold text-primary-800">VAT configuration</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={!!f.vat_registered} onChange={s('vat_registered')} /> VAT-registered (allows Tax Invoices)</label>
            {f.vat_registered && <>
              <Field label="VAT registration number"><input className="input" value={f.vat_no} onChange={s('vat_no')} placeholder="e.g. 123456789-7000" /></Field>
              <Field label="VAT registration effective date"><input type="date" className="input" value={f.vat_effective || ''} onChange={s('vat_effective')} /></Field>
              <Field label="Default VAT treatment for new lines"><select className="input" value={f.default_rate_code} onChange={s('default_rate_code')}>{[...new Set(data.rates.map((r) => r.code))].map((c) => { const r = data.rates.filter((x) => x.code === c).slice(-1)[0]; return <option key={c} value={c}>{r.description} {r.treatment === 'standard' ? `(${Number(r.rate)}%)` : ''}</option>; })}</select></Field>
              <Field label="Prices you type are"><select className="input" value={f.price_mode} onChange={s('price_mode')}><option value="exclusive">Excluding VAT</option><option value="inclusive">Including VAT</option></select></Field>
            </>}
          </div>
          <RateTable rates={data.rates} />
          {saveBtn()}
        </fieldset>
      )}

      {tab === 'branding' && <Branding f={f} setF={setF} s={s} ro={ro} saveBtn={saveBtn} />}
      {tab === 'numbering' && <Numbering app={app} ro={ro} />}

      {tab === 'terms' && (
        <fieldset disabled={ro} className="card space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Default payment terms"><select className="input" value={f.default_terms_days} onChange={(e) => setF({ ...f, default_terms_days: Number(e.target.value) })}>{TERMS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}<option value={90}>90 days</option></select></Field>
            <div className="text-xs text-gray-500 sm:pt-5">The due date = invoice date + terms. A customer's own terms (Customers) and a custom date on the invoice take priority.</div>
          </div>
          <Field label="Default terms & conditions (printed on invoices)"><textarea className="input" rows={4} value={f.terms} onChange={s('terms')} /></Field>
          {saveBtn()}
        </fieldset>
      )}

      {tab === 'reminders' && (
        <fieldset disabled={ro} className="card space-y-3 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!f.auto_reminders} onChange={s('auto_reminders')} /> Send automatic payment reminders by email</label>
          <div className="text-xs text-gray-500">Sent each morning to customers with an email address, for unpaid invoices. WhatsApp / SMS reminders are sent by you from the invoice (WhatsApp has no automatic sending here).</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {(Array.isArray(f.reminder_rules) ? f.reminder_rules : []).map((r, i) => (
              <label key={r.key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" checked={!!r.on} onChange={(e) => setF({ ...f, reminder_rules: f.reminder_rules.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                {r.days < 0 ? `${-r.days} days before the due date` : r.days === 0 ? 'On the due date' : `${r.days} days overdue`}
              </label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Don't remind the same invoice again within (days)"><input className="input" inputMode="numeric" value={f.reminder_gap_days} onChange={(e) => setF({ ...f, reminder_gap_days: e.target.value.replace(/\D/g, '') })} /></Field>
            <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.reminder_cc_me} onChange={s('reminder_cc_me')} /> Send me a copy (business email)</label>
          </div>
          {saveBtn()}
        </fieldset>
      )}

      {tab === 'ramis' && <RamisSettings app={app} ro={ro} />}
      {tab === 'users' && <UsersTab app={app} />}
    </div>
  );
}

const EMPTY = { legal_name: '', trading_name: '', brn: '', tin: '', vat_registered: false, vat_no: '', vat_effective: '', address: '', phone: '', mobile: '', email: '', website: '', activity: '', industry: '', country: 'Sri Lanka', currency: 'LKR', time_zone: 'Asia/Colombo',
  default_rate_code: 'VAT_STD', price_mode: 'exclusive', vat_invoice_enabled: true, logo_data: '', stamp_data: '', logo_position: 'left', brand_name: '', brand_color: '#1e3a8a', header_text: '', footer_text: '', payment_instructions: '', bank_details: '', terms: '',
  online_pay_url: '', template_key: 'classic', paper: 'A4', default_terms_days: 30, auto_reminders: false, reminder_rules: [], reminder_gap_days: 2, reminder_cc_me: false, locale: 'en' };

function RateTable({ rates }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-gray-600">VAT rates in TaxMate (kept up to date by TaxMate; each invoice keeps the rate it used)</div>
      {rates.map((r) => <div key={r.id} className="flex flex-wrap gap-2"><span className="w-24 font-mono">{r.code}</span><span className="w-28">{r.treatment === 'standard' ? `${Number(r.rate)}%` : r.treatment}</span><span className="text-gray-500">from {r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ''}</span>{r.ird_status === 'verify' && <Badge meta={{ cls: 'bg-amber-50 text-amber-700 border-amber-200' }}>TaxMate to confirm</Badge>}</div>)}
    </div>
  );
}

async function toDataUrl(file, maxW) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG, JPG or WEBP only.');
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL('image/png');
  if (out.length > 400000) out = c.toDataURL('image/jpeg', 0.85);
  if (out.length > 440000) throw new Error('Image too large — use a smaller one.');
  return out;
}

function Branding({ f, setF, s, ro, saveBtn }) {
  const sample = useMemo(() => ({
    doc: { doc_type: 'tax', is_tax: true, status: 'issued', doc_no: `${slToday().slice(2, 4)}NOV_MAIN_00001`, issue_date: slToday(), supply_date: slToday(), due_date: slToday(), terms_days: 30, template_key: f.template_key,
      supplier: { legal_name: f.legal_name || 'Your Company (Pvt) Ltd', trading_name: f.trading_name, tin: f.tin || '123456789', vat_no: f.vat_no, address: f.address || 'Your registered address', phone: f.phone, email: f.email, website: f.website },
      customer: { name: 'Sample Customer (Pvt) Ltd', tin: '987654321', address: '10 Main Street, Colombo' }, price_mode: 'exclusive', gross: 15000, discount_total: 0, net_total: 15000, vat_total: 2700, total: 17700, taxable_zero: 0, exempt_amount: 0, terms: f.terms, compliance: 'IRD Circular SEC/2026/E/03' },
    lines: [{ description: 'Sample goods — steel rods 12 mm', quantity: 10, unit: 'Nos', unit_price: 1000, net: 10000, vat: 1800, total: 11800, rate: 18, treatment: 'standard', discount: 0 },
      { description: 'Sample service — installation', quantity: 1, unit: 'Job', unit_price: 5000, net: 5000, vat: 900, total: 5900, rate: 18, treatment: 'standard', discount: 0 }],
    brand: { logo: f.logo_data, stamp: f.stamp_data, logo_position: f.logo_position, brand_name: f.brand_name, brand_color: f.brand_color, header_text: f.header_text, footer_text: f.footer_text, payment_instructions: f.payment_instructions, bank_details: f.bank_details, online_pay_url: f.online_pay_url, template_key: f.template_key, paper: f.paper },
  }), [f]);
  const pick = (key, w) => async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setF({ ...f, [key]: await toDataUrl(file, w) }); } catch (er) { toast.error(er.message); } };
  return (
    <fieldset disabled={ro} className="card space-y-3 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {f.logo_data ? <img src={f.logo_data} alt="Logo" className="h-14 max-w-[160px] rounded border object-contain" /> : <div className="flex h-14 w-28 items-center justify-center rounded border text-xs text-gray-400">No logo</div>}
            <label className="btn-secondary cursor-pointer border px-3 py-1.5 text-xs"><Upload size={13} /> Logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick('logo_data', 600)} /></label>
            {f.logo_data && <button type="button" className="text-xs text-red-600" onClick={() => setF({ ...f, logo_data: '' })}><Trash2 size={12} className="inline" /> remove</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {f.stamp_data ? <img src={f.stamp_data} alt="Stamp" className="h-12 max-w-[140px] rounded border object-contain" /> : <div className="flex h-12 w-28 items-center justify-center rounded border text-xs text-gray-400">No stamp</div>}
            <label className="btn-secondary cursor-pointer border px-3 py-1.5 text-xs"><Upload size={13} /> Stamp / signature<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick('stamp_data', 400)} /></label>
            {f.stamp_data && <button type="button" className="text-xs text-red-600" onClick={() => setF({ ...f, stamp_data: '' })}><Trash2 size={12} className="inline" /> remove</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Logo position"><select className="input" value={f.logo_position} onChange={s('logo_position')}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>
            <Field label="Brand colour"><input type="color" className="h-9 w-full rounded border" value={f.brand_color || '#1e3a8a'} onChange={s('brand_color')} /></Field>
            <Field label="Brand name"><input className="input" value={f.brand_name} onChange={s('brand_name')} /></Field>
            <Field label="Paper"><select className="input" value={f.paper} onChange={s('paper')}><option value="A4">A4</option><option value="Letter">Letter</option></select></Field>
          </div>
          <Field label="Template (all IRD fields stay on every template)">
            <select className="input" value={f.template_key} onChange={s('template_key')}>{TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
          </Field>
          <Field label="Header text"><input className="input" value={f.header_text} onChange={s('header_text')} /></Field>
          <Field label="Footer text"><input className="input" value={f.footer_text} onChange={s('footer_text')} /></Field>
          <Field label="Payment instructions"><textarea className="input" rows={2} value={f.payment_instructions} onChange={s('payment_instructions')} /></Field>
          <Field label="Bank details"><textarea className="input" rows={2} value={f.bank_details} onChange={s('bank_details')} placeholder="Bank of Ceylon · Acc 0000000 · Branch …" /></Field>
          <Field label="Online payment link (optional, https://…)" hint="Your own payment page (e.g. your PayHere / bank link) — shown as PAY NOW on the customer page."><input className="input" value={f.online_pay_url} onChange={s('online_pay_url')} /></Field>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-gray-600">Preview</div>
          <ScaledFrame title="Template preview" html={buildDocHtml(sample, { showBalance: false })} />
        </div>
      </div>
      {saveBtn()}
    </fieldset>
  );
}

function Numbering({ app, ro }) {
  const { clientId, data, reload } = app;
  const [seqs, setSeqs] = useState(null);
  const [edit, setEdit] = useState(null);
  const [br, setBr] = useState(null);
  const load = () => loadSequences(clientId).then(setSeqs).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seqs) return <Spinner />;
  const saveSeq = async () => { try { await saveSequence(clientId, edit); toast.success('Saved'); setEdit(null); load(); } catch (e) { toast.error(e.message, { duration: 7000 }); } };
  const saveBr = async () => { try { await saveBranch(clientId, br); toast.success('Saved'); setBr(null); reload(['branches']); } catch (e) { toast.error(e.message); } };
  const TYPE = { tax: 'Tax invoice', nontax: 'Non-tax invoice', credit: 'Credit note', debit: 'Debit note', receipt: 'Payment receipt' };
  return (
    <div className="space-y-3">
      <div className="card p-4 text-xs text-gray-600">
        <b>Tax invoice numbers follow IRD Circular SEC/2026/E/03:</b> <span className="font-mono">YYMMM_QQQQ_XXXXX</span> — year + month of the invoice date, your code (QQQQ: 1–15 letters/digits for a branch, department, unit, project or customer group), and a running number (digits only). Max 40 characters, no spaces, numbers continue from the last invoice.
        Numbers are given only when a document is issued, so drafts never leave gaps; duplicates are impossible.
      </div>
      <div className="card p-4">
        <div className="mb-2 flex items-center text-sm font-bold text-primary-800">Codes (QQQQ) — branches, departments, units, projects
          {!ro && <button type="button" className="ml-auto text-xs font-semibold text-primary-700" onClick={() => setBr({ code: '', name: '', kind: 'branch', address: '', phone: '', is_default: false, active: true })}><Plus size={12} className="inline" /> Add code</button>}</div>
        <div className="flex flex-wrap gap-2 text-xs"><Badge>MAIN — default</Badge>
          {data.branches.map((b) => <button key={b.id} type="button" disabled={ro} onClick={() => setBr({ ...b, address: b.address || '', phone: b.phone || '' })} className="rounded-full border px-2 py-0.5 hover:bg-gray-50"><b className="font-mono">{b.code}</b> — {b.name} ({b.kind}){b.is_default && ' · default'}{!b.active && ' · off'}</button>)}</div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="table-th">Document</th><th className="table-th">Code</th><th className="table-th">Format</th><th className="table-th">Next no.</th><th className="table-th">Restart</th><th className="table-th" /></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {seqs.map((q) => (
              <tr key={q.id}><td className="table-td">{TYPE[q.doc_type]}</td><td className="table-td font-mono">{q.code}</td><td className="table-td font-mono text-xs">{q.format}</td><td className="table-td tabular-nums">{q.next_no}</td><td className="table-td text-xs">{q.reset}</td>
                <td className="table-td text-right">{!ro && <button type="button" className="p-1 text-gray-400 hover:text-primary-700" onClick={() => setEdit({ ...q, reset_reason: q.reset_reason || '' })} aria-label="Edit"><Pencil size={14} /></button>}</td></tr>
            ))}
          </tbody>
        </table>
        {seqs.length === 0 && <div className="p-4 text-xs text-gray-500">Sequences are created automatically with the first issued document: tax <span className="font-mono">YYMMM_MAIN_00001</span>, non-tax <span className="font-mono">NT-YYYY-00001</span>, credit <span className="font-mono">CN-YYYY-00001</span>, debit <span className="font-mono">DN-YYYY-00001</span>.</div>}
        {!ro && <div className="border-t p-2 text-right"><button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setEdit({ doc_type: 'tax', code: 'MAIN', format: '', next_no: 1, pad: 5, reset: 'never', reset_reason: '', active: true })}><Plus size={12} className="inline" /> Add / set up a sequence</button></div>}
      </div>
      {edit && (
        <Modal title="Numbering sequence" onClose={() => setEdit(null)} footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary text-sm" onClick={saveSeq}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Document"><select className="input" value={edit.doc_type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, doc_type: e.target.value })}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Code"><select className="input" value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })}><option value="MAIN">MAIN</option>{data.branches.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select></Field>
            {edit.doc_type !== 'tax' ? <Field label="Format" hint="{YYYY} {YY} {MMM} {MM} {CODE} {N}" className="sm:col-span-2"><input className="input font-mono" value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value.replace(/\s/g, '') })} placeholder="NT-{YYYY}-{N}" /></Field>
              : <div className="text-xs text-gray-500 sm:col-span-2">Format fixed by IRD: <span className="font-mono">{'{YY}{MMM}_{CODE}_{N}'}</span></div>}
            <Field label="Next number" hint="Start from your last number + 1 if you used another system. Cannot go below a number already used."><input className="input" inputMode="numeric" value={edit.next_no} onChange={(e) => setEdit({ ...edit, next_no: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Digits"><input className="input" inputMode="numeric" value={edit.pad} onChange={(e) => setEdit({ ...edit, pad: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Restart numbering"><select className="input" value={edit.reset} onChange={(e) => setEdit({ ...edit, reset: e.target.value })}><option value="never">Never (continuous)</option><option value="yearly">Each year</option><option value="monthly">Each month</option></select></Field>
            {edit.doc_type === 'tax' && edit.reset !== 'never' && <Field label="Reason (IRD: only for reasons beyond your control)" className="sm:col-span-2"><input className="input" value={edit.reset_reason} onChange={(e) => setEdit({ ...edit, reset_reason: e.target.value })} /></Field>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
          </div>
        </Modal>
      )}
      {br && (
        <Modal title={br.id ? 'Edit code' : 'New code (QQQQ)'} onClose={() => setBr(null)} footer={<><button type="button" className="btn-secondary border text-sm" onClick={() => setBr(null)}>Cancel</button><button type="button" className="btn-primary text-sm" onClick={saveBr}>Save</button></>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Code (1–15 letters / digits)"><input className="input font-mono uppercase" maxLength={15} value={br.code} onChange={(e) => setBr({ ...br, code: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() })} /></Field>
            <Field label="Name"><input className="input" value={br.name} onChange={(e) => setBr({ ...br, name: e.target.value })} /></Field>
            <Field label="Kind"><select className="input" value={br.kind} onChange={(e) => setBr({ ...br, kind: e.target.value })}>{['branch', 'department', 'unit', 'project', 'customer_class', 'other'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Telephone"><input className="input" value={br.phone} onChange={(e) => setBr({ ...br, phone: e.target.value })} /></Field>
            <Field label="Branch address (printed under the supplier)" className="sm:col-span-2"><input className="input" value={br.address} onChange={(e) => setBr({ ...br, address: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!br.is_default} onChange={(e) => setBr({ ...br, is_default: e.target.checked })} /> Default for new invoices</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!br.active} onChange={(e) => setBr({ ...br, active: e.target.checked })} /> Active</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RamisSettings({ app, ro }) {
  const { clientId, reload, ctx } = app;
  const [info, setInfo] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => ramisInfo(clientId).then((i) => { setInfo(i); setF({ enabled: !!i.config?.enabled, environment: i.config?.environment || 'production', auto_submit: !!i.config?.auto_submit, use_saved_login: !!i.config?.use_saved_login }); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Spinner />;
  const save = async () => { setBusy(true); try { await saveRamisConfig(clientId, f); toast.success('Saved'); load(); reload(['docs']); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const irdLink = ctx.role === 'taxmate' ? 'the client page → Overview → IRD login details' : 'My Profile → IRD login details';
  return (
    <fieldset disabled={ro} className="card space-y-3 p-4 text-sm">
      <div className={`rounded-lg p-3 text-xs ${info.adapter_status === 'active' ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
        <div className="flex items-center gap-1.5 font-semibold"><Landmark size={14} /> {info.adapter_status === 'active' ? `IRD Web API adapter ${info.adapter} active (spec ${info.spec_version})` : t('ramis.pending')}</div>
        <div className="mt-1">The IRD VAT Web API signs in with <b>your own RAMIS SSID and password</b>; TaxMate keeps them encrypted and uses them only on the server to submit your invoices. {info.adapter_status !== 'active' && 'Until TaxMate configures the adapter from IRD\'s official specification, submissions only wait in the queue (never shown as sent to IRD).'}</div>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Submit tax invoices / tax credit &amp; debit notes to RAMIS through the Web API</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.auto_submit} disabled={!f.enabled} onChange={(e) => setF({ ...f, auto_submit: e.target.checked })} /> Submit automatically when a tax document is issued</label>
      <Field label="Environment"><select className="input w-auto" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}><option value="production">Production (real IRD)</option><option value="sandbox">Sandbox / test (only if IRD gives a test system)</option></select></Field>
      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> RAMIS login for the Web API</div>
        <div className="mt-1 text-xs text-gray-600">SSID: <b>{info.has_ssid ? 'saved' : 'not saved'}</b> · password: <b>{info.has_pin ? 'saved' : 'not saved'}</b> — save or change them in {irdLink}.</div>
        <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={f.use_saved_login} onChange={(e) => setF({ ...f, use_saved_login: e.target.checked })} />
          <span>I allow TaxMate to use my saved RAMIS SSID and password to submit my VAT invoice data to IRD through the RAMIS Web API. {info.config?.consent_at && <span className="text-gray-500">(allowed {dt(info.config.consent_at)})</span>}</span></label>
      </div>
      <div className="text-[11px] text-gray-500">{t('disclaimer')}</div>
      {!ro && <div className="flex justify-end"><button type="button" disabled={busy} className="btn-primary text-sm" onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button></div>}
    </fieldset>
  );
}

function UsersTab({ app }) {
  const { clientId, can, ctx } = app;
  const [list, setList] = useState(null);
  const [f, setF] = useState({ email: '', role: 'invoice_operator' });
  const load = () => loadMembers(clientId).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <Spinner />;
  const add = async () => { try { await saveMember(clientId, f.email, f.role); toast.success('User added'); setF({ email: '', role: 'invoice_operator' }); load(); } catch (e) { toast.error(e.message, { duration: 7000 }); } };
  const limit = ctx.catalog?.limits?.users;
  return (
    <div className="card space-y-3 p-4 text-sm">
      <div className="flex items-center gap-1.5 font-bold text-primary-800"><Users size={15} /> Users &amp; roles {limit ? <span className="text-xs font-normal text-gray-500">(plan: up to {limit} users incl. owner)</span> : null}</div>
      <div className="grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
        {[['Owner', 'everything incl. subscription'], ['Admin', 'everything except subscription'], ['Accountant', 'invoices, notes, RAMIS, payments, purchases, reports, cancel'], ['Invoice operator', 'create & issue invoices, payments, reminders'],
          ['Viewer', 'view and reports'], ['Purchaser', 'add purchase invoices'], ['Approver', 'review / approve purchase invoices, reports']].map(([r, d]) => <div key={r}><b>{r}</b> — {d}</div>)}
      </div>
      <div className="divide-y rounded-lg border">
        <div className="flex items-center gap-2 px-3 py-2"><b className="flex-1">Owner (client login)</b><Badge>Owner</Badge></div>
        {list.map((m) => (
          <div key={m.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${m.active ? '' : 'opacity-50'}`}>
            <span className="flex-1">{m.full_name || m.email} <span className="text-xs text-gray-500">{m.email}</span></span>
            {can('users') ? <select className="input w-auto py-1 text-xs" value={m.role} onChange={async (e) => { try { await saveMember(clientId, m.email, e.target.value, m.active); load(); } catch (er) { toast.error(er.message); } }}>{Object.entries(ROLES).filter(([k]) => !['owner', 'taxmate'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : <Badge>{ROLES[m.role]}</Badge>}
            {can('users') && <button type="button" className="text-xs text-red-600" onClick={async () => { if (!window.confirm(`Remove ${m.email}?`)) return; try { await removeMember(m.id); load(); } catch (e) { toast.error(e.message); } }}>remove</button>}
          </div>
        ))}
      </div>
      {can('users') && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Email of their TaxMate login" className="min-w-[220px] flex-1"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).filter(([k]) => !['owner', 'taxmate'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <button type="button" disabled={!f.email} className="btn-primary text-sm" onClick={add}><Plus size={14} /> Add</button>
        </div>
      )}
      <div className="text-[11px] text-gray-500">Team members sign in at <b>{window.location.origin}/vat</b> and see only this VAT module — not your tax returns or documents. They need a TaxMate login first (ask TaxMate to create one).</div>
    </div>
  );
}
