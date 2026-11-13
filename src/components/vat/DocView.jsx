// V64 — one document: status, lock, adjustments, payments, sharing, reminders, RAMIS, audit trail
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Printer, Share2, MessageCircle, Mail, Link2, Wallet, FileMinus, FilePlus, Send, Lock, Pencil, Trash2, Copy, Ban, RotateCcw, Landmark, AlertTriangle, Loader2, Bell, History, Paperclip, Undo2, Unlink } from 'lucide-react';
import {
  loadDoc, loadLines, docJson, logEvent, shareDoc, shareOff, invoiceUrl, loadDocPayments, loadDocSubmissions, loadReminders, logReminder, emailDocument,
  deleteDraft, cancelDoc, copyDoc, correctRejected, submitRamis, withdrawRamis, retryRamis, validateDoc, voidPayment, loadAudit, vatFileUrl,
} from '../../lib/vat/api';
import { rs, money, dmy, dt, slToday, docTitle, RAMIS, PAY, DOC_STATUS, SUB_STATUS, METHODS, CREDIT_REASONS, DEBIT_REASONS, ROLES } from '../../lib/vat/format';
import { buildDocHtml, openPrintWindow, writePrint } from '../../lib/vat/printDoc';
import { whatsappLink, emailLink } from '../../lib/share';
import { t } from '../../lib/vat/i18n';
import { Badge, Spinner, Modal } from './ui';
import { Checklist } from './DocEditor';
import PaymentForm from './PaymentForm';

export function shareText(d, settings, url, reminder) {
  const biz = settings?.trading_name || settings?.legal_name || d.supplier?.legal_name || '';
  const kind = docTitle(d).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const lines = reminder
    ? [`Dear ${d.customer?.name || 'Sir / Madam'},`, '', `This is a friendly reminder that ${kind} ${d.doc_no} for ${rs(d.balance)} ${d.due_date && d.due_date < slToday() ? `was due on ${dmy(d.due_date)}` : `is due on ${dmy(d.due_date)}`}.`]
    : [`Dear ${d.customer?.name || 'Sir / Madam'},`, '', `Please find ${kind} ${d.doc_no} dated ${dmy(d.issue_date)} for ${rs(d.total)}.`, ...(d.due_date && (d.doc_type === 'tax' || d.doc_type === 'nontax') ? [`Due date: ${dmy(d.due_date)}`] : [])];
  return [...lines, '', `View / download (secure link): ${url}`, ...(settings?.bank_details ? ['', settings.bank_details] : []), '', 'Thank you,', biz, settings?.phone || ''].filter((x) => x !== undefined).join('\n');
}

export default function DocView({ app, docId }) {
  const { clientId, data, reload, go, openDoc, can, ctx } = app;
  const [d, setD] = useState(null);
  const [lines, setLines] = useState([]);
  const [pays, setPays] = useState([]);
  const [subs, setSubs] = useState([]);
  const [rems, setRems] = useState([]);
  const [audit, setAudit] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const doc = await loadDoc(docId);
      if (!doc) { toast.error('Document not found'); go('docs'); return; }
      setD(doc);
      const [ls, ps, ss, rr] = await Promise.all([loadLines(docId), loadDocPayments(docId), loadDocSubmissions(docId), loadReminders(clientId, docId)]);
      setLines(ls); setPays(ps); setSubs(ss); setRems(rr);
      if (doc.is_tax && doc.status === 'issued' && ['ready', 'draft', 'failed'].includes(doc.ramis_status)) validateDoc(docId, true).then(setCheck).catch(() => {});
    } catch (e) { toast.error(e.message); }
  }, [docId, clientId, go]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Spinner />;
  const isInv = d.doc_type === 'tax' || d.doc_type === 'nontax';
  const locked = ['accepted', 'locked'].includes(d.ramis_status) || !!d.locked_at;
  const inRamis = ['queued', 'submitting', 'submitted', 'accepted', 'locked'].includes(d.ramis_status);
  const notes = data.docs.filter((x) => x.original_id === d.id && x.status !== 'draft');
  const orig = d.original_id ? data.docs.find((x) => x.id === d.original_id) : null;
  const reasons = d.doc_type === 'credit' ? CREDIT_REASONS : DEBIT_REASONS;
  const after = async (msg) => { if (msg) toast.success(msg); await Promise.all([load(), reload(['docs'])]); };
  const act = async (key, fn, msg) => {
    setBusy(key);
    try { const r = await fn(); await after(typeof msg === 'function' ? msg(r) : msg); return r; } catch (e) { toast.error(e.message, { duration: 8000 }); return null; } finally { setBusy(''); }
  };

  const print = async () => {
    const w = openPrintWindow();
    try { writePrint(w, buildDocHtml(await docJson(d.id), { toolbar: true })); logEvent(d.id, 'printed'); } catch (e) { w?.close(); toast.error(e.message); }
  };
  const getLink = async () => { const r = await shareDoc(d.id); setD((x) => ({ ...x, share_token: r.token, share_expires_at: r.expires_at })); return invoiceUrl(r.token); };
  const send = async (channel, reminder) => {
    const w = channel === 'whatsapp' ? window.open('', '_blank') : null;
    try {
      const url = await getLink();
      const text = shareText(d, data.settings, url, reminder);
      if (channel === 'whatsapp') {
        const link = whatsappLink(d.customer?.phone, text);
        if (w) w.location.href = link; else window.open(link, '_blank');
      } else if (channel === 'email') {
        window.location.href = emailLink(d.customer?.email, `${docTitle(d)} ${d.doc_no}${reminder ? ' — payment reminder' : ''}`, text);
      } else {
        await navigator.clipboard.writeText(channel === 'link' ? url : text);
        toast.success(channel === 'link' ? 'Link copied' : 'Message copied');
      }
      if (reminder) await logReminder(d.id, channel === 'link' ? 'copy' : channel, channel === 'whatsapp' ? d.customer?.phone : channel === 'email' ? d.customer?.email : null, text).catch((e) => toast.error(e.message));
      else logEvent(d.id, channel === 'whatsapp' ? 'sent_whatsapp' : channel === 'email' ? 'sent_email' : 'copied_link');
      setShareOpen(null); load();
    } catch (e) { w?.close(); toast.error(e.message); }
  };
  const serverEmail = (reminder) => act('mail', () => emailDocument(d.id, reminder ? 'reminder' : 'document'), (r) => `Emailed to ${r?.to || d.customer?.email}`).then(() => setShareOpen(null));

  const canPay = isInv && d.status === 'issued' && can('payment');
  const canRemind = isInv && d.status === 'issued' && can('reminder');

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => go('docs')} className="p-1 text-gray-500 hover:text-gray-800" aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold tracking-wide text-gray-500">{docTitle(d)}</div>
            <div className="font-mono text-lg font-black text-primary-800">{d.doc_no || 'Draft'}</div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge meta={DOC_STATUS[d.status]} />
            {isInv && d.status !== 'draft' && <Badge meta={PAY[d.pay_status]} />}
            {d.is_tax && d.status !== 'draft' && <Badge meta={RAMIS[d.ramis_status]}>{locked && <Lock size={10} />}{RAMIS[d.ramis_status]?.label}</Badge>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.status === 'draft' && can('edit_draft') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => go('edit', { id: d.id })}><Pencil size={14} /> Edit draft</button>}
          {d.status === 'draft' && can('edit_draft') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm text-red-700" onClick={() => window.confirm('Delete this draft?') && act('del', () => deleteDraft(d.id), 'Draft deleted').then(() => go('docs'))}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={print}><Printer size={14} /> {t('act.pdf')}</button>
          {d.status === 'issued' && can('reminder') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setShareOpen('share')}><Share2 size={14} /> {t('act.share')}</button>}
          {canRemind && Number(d.balance) > 0 && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setShareOpen('remind')}><Bell size={14} /> {t('act.remind')}</button>}
          {canPay && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => setPayOpen(true)}><Wallet size={14} /> {t('act.pay')}</button>}
          {isInv && d.status === 'issued' && can('credit_note') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => go('new', { type: 'credit', original: d.id })}><FileMinus size={14} /> Credit note</button>}
          {isInv && d.status === 'issued' && can('debit_note') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => go('new', { type: 'debit', original: d.id })}><FilePlus size={14} /> Debit note</button>}
          {d.is_tax && d.status === 'issued' && ['ready', 'draft'].includes(d.ramis_status) && can('submit_ramis') && (
            <button type="button" disabled={!!busy || (check && !check.ok)} className="btn-primary px-3 py-1.5 text-sm" title={check && !check.ok ? 'Fix the checklist first' : ''}
              onClick={() => act('ramis', () => submitRamis(d.id), (r) => (r.status === 'pending_config' ? 'Queued — RAMIS integration pending configuration (not sent to IRD yet)' : 'Queued for RAMIS'))}>
              {busy === 'ramis' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t('act.submit_ramis')}</button>
          )}
          {d.ramis_status === 'failed' && can('submit_ramis') && <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => act('retry', () => retryRamis(d.id), 'Queued again for RAMIS')}><RotateCcw size={14} /> Retry RAMIS</button>}
          {d.ramis_status === 'queued' && subs[0] && ['pending_config', 'queued'].includes(subs[0].status) && subs[0].attempts === 0 && can('submit_ramis') && (
            <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => window.confirm('Take this invoice out of the RAMIS queue? (It has not been sent yet.)') && act('wd', () => withdrawRamis(d.id), 'Withdrawn from the RAMIS queue')}><Undo2 size={14} /> Withdraw from queue</button>
          )}
          {d.ramis_status === 'rejected' && d.status === 'issued' && d.doc_type === 'tax' && can('cancel') && (
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => window.confirm('RAMIS rejected this invoice. Cancel it and open a corrected draft (same lines) to fix and issue again?') && act('fix', () => correctRejected(d.id), 'Corrected draft created').then((nid) => nid && go('edit', { id: nid }))}><Pencil size={14} /> Create corrected draft</button>
          )}
          {isInv && can('create') && <button type="button" className="btn-secondary border px-3 py-1.5 text-sm" onClick={() => act('copy', () => copyDoc(d.id), 'Copied to a new draft').then((nid) => nid && go('edit', { id: nid }))}><Copy size={14} /> {t('act.copy')}</button>}
          {d.status === 'issued' && !inRamis && can('cancel') && (
            <button type="button" className="btn-secondary border px-3 py-1.5 text-sm text-red-700" onClick={() => { const r = window.prompt('Reason for cancelling (the document stays on record, marked CANCELLED):'); if (r) act('cancel', () => cancelDoc(d.id, r), 'Document cancelled'); }}><Ban size={14} /> {t('act.cancel')}</button>
          )}
        </div>
      </div>

      {locked && (
        <div className="card border-green-300 bg-green-50 p-3 text-sm text-green-900">
          <div className="flex items-center gap-1.5 font-bold"><Lock size={15} /> {t('locked')}{d.ramis_ref && <span className="font-mono text-xs font-normal">· RAMIS ref {d.ramis_ref}</span>}</div>
          <div className="mt-1 text-xs">{t('locked.msg')}</div>
        </div>
      )}
      {!locked && d.ramis_message && d.is_tax && d.status !== 'draft' && (
        <div className={`card p-3 text-sm ${['rejected', 'failed'].includes(d.ramis_status) ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <Landmark size={14} className="-mt-0.5 inline" /> {d.ramis_message}
          {d.ramis_status === 'rejected' && <div className="mt-1 text-xs"><b>Action:</b> review the purchaser information and create a corrected draft. The rejected invoice is not changed.</div>}
        </div>
      )}
      {d.status === 'cancelled' && <div className="card border-gray-300 bg-gray-50 p-3 text-sm text-gray-700"><Ban size={14} className="-mt-0.5 inline" /> Cancelled {dmy(d.cancelled_at)} — {d.cancel_reason}{d.replaced_by && <> · <button type="button" className="font-semibold text-primary-700 underline" onClick={() => openDoc(d.replaced_by)}>open the corrected document</button></>}</div>}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><div className="text-[11px] font-semibold uppercase text-gray-500">{d.is_tax ? 'Purchaser' : 'Customer'}</div>
              <div className="font-semibold">{d.customer?.name || '—'}</div>
              <div className="text-xs text-gray-600">{d.customer?.tin && <>TIN {d.customer.tin} · </>}{d.customer?.address}</div>
              {d.customer_id && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => go('customers', { c: d.customer_id })}>Customer statement</button>}</div>
            <div className="text-xs text-gray-600">
              <div>{d.doc_type === 'credit' || d.doc_type === 'debit' ? 'Note' : 'Invoice'} date <b>{dmy(d.issue_date)}</b>{d.supply_date && <> · supply <b>{dmy(d.supply_date)}</b></>}</div>
              {isInv && d.due_date && <div>Due <b className={d.status === 'issued' && Number(d.balance) > 0 && d.due_date < slToday() ? 'text-red-600' : ''}>{dmy(d.due_date)}</b>{d.terms_days != null && ` (${d.terms_days} days)`}</div>}
              {orig && <div>Against <button type="button" className="font-mono font-semibold text-primary-700 underline" onClick={() => openDoc(orig.id)}>{orig.doc_no}</button> · {reasons[d.reason_code] || d.reason_code}{d.reason && ` — ${d.reason}`}</div>}
              {d.issued_at && <div>Issued {dt(d.issued_at)}</div>}
              {d.rules_version && <div className="text-gray-400">Tax rules v{d.rules_version} · {d.calc_method}</div>}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50"><tr><th className="p-1.5 text-left">Description</th><th className="p-1.5 text-right">Qty</th><th className="p-1.5 text-right">Price</th>{d.is_tax && <th className="p-1.5 text-right">VAT</th>}<th className="p-1.5 text-right">Value</th>{d.is_tax && <th className="p-1.5 text-right">VAT amt</th>}<th className="p-1.5 text-right">Total</th></tr></thead>
              <tbody className="divide-y">
                {lines.map((l) => (
                  <tr key={l.id}><td className="p-1.5">{l.description}{l.schedule && <span className="ml-1 text-[10px] text-gray-400">Sch {l.schedule}</span>}</td><td className="p-1.5 text-right">{Number(l.quantity)} {l.unit}</td><td className="p-1.5 text-right">{money(l.unit_price)}</td>
                    {d.is_tax && <td className="p-1.5 text-right">{l.treatment === 'exempt' ? 'Exempt' : `${Number(l.rate)}%`}</td>}<td className="p-1.5 text-right">{money(l.net)}</td>{d.is_tax && <td className="p-1.5 text-right">{money(l.vat)}</td>}<td className="p-1.5 text-right font-semibold">{money(l.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-1 p-4 text-sm">
          {d.is_tax && <Row k="Value excl. VAT" v={rs(d.net_total)} />}
          {d.is_tax && <Row k="VAT" v={rs(d.vat_total)} />}
          <Row k={d.is_tax ? 'Total incl. VAT' : 'Total'} v={rs(d.total)} b />
          {isInv && d.status !== 'draft' && (
            <>
              <div className="my-2 border-t" />
              <Row k="Original amount" v={rs(d.total)} />
              {Number(d.debited) > 0 && <Row k="+ Debit notes" v={rs(d.debited)} />}
              {Number(d.credited) > 0 && <Row k="− Credit notes" v={rs(d.credited)} />}
              {(Number(d.debited) > 0 || Number(d.credited) > 0) && <Row k="Adjusted amount" v={rs(Number(d.total) + Number(d.debited) - Number(d.credited))} b />}
              {d.is_tax && notes.length > 0 && <Row k="VAT adjustment" v={rs(notes.filter((n) => n.status === 'issued').reduce((a, n) => a + (n.doc_type === 'credit' ? -1 : 1) * Number(n.vat_total), 0))} />}
              <Row k="− Paid" v={rs(d.paid)} />
              <Row k="Outstanding" v={rs(d.balance)} b tone={Number(d.balance) > 0 ? 'text-amber-700' : 'text-green-700'} />
            </>
          )}
          {notes.length > 0 && (
            <div className="pt-2"><div className="text-[11px] font-semibold uppercase text-gray-500">Credit / debit notes</div>
              {notes.map((n) => <button key={n.id} type="button" onClick={() => openDoc(n.id)} className="flex w-full justify-between py-0.5 text-xs hover:text-primary-700"><span className="font-mono">{n.doc_no}</span><span>{n.doc_type === 'credit' ? '−' : '+'}{rs(n.total)}</span></button>)}
            </div>
          )}
          {d.share_token && (
            <div className="pt-2 text-[11px] text-gray-500">Share link active until {dmy(d.share_expires_at)} · opened {d.share_views}×
              {can('reminder') && <button type="button" className="ml-1 font-semibold text-red-600" onClick={() => act('off', () => shareOff(d.id), 'Link switched off')}><Unlink size={10} className="inline" /> switch off</button>}</div>
          )}
        </div>
      </div>

      {check && d.is_tax && ['ready', 'draft', 'failed'].includes(d.ramis_status) && d.status === 'issued' && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><Landmark size={15} /> Pre-submission validation (RAMIS)
            <Badge meta={{ cls: check.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200' }}>{check.ok ? 'Ready' : 'Not ready'}</Badge></div>
          <Checklist checks={check.checks} />
          {ctx.ramis_adapter !== 'active' && <div className="mt-2 text-xs text-amber-800">{t('ramis.pending')}: submissions wait in the queue and are <b>not sent to IRD</b> until TaxMate connects the official IRD Web API.</div>}
        </div>
      )}

      {pays.length > 0 && (
        <div className="card p-4">
          <div className="mb-1 text-sm font-semibold text-gray-700">Payments</div>
          {pays.map((a) => { const p = a.vi_payments || {}; return (
            <div key={a.payment_id} className={`flex flex-wrap items-center gap-2 border-b border-gray-50 py-1 text-xs ${p.voided_at ? 'text-gray-400 line-through' : ''}`}>
              <span className="w-24">{dmy(p.paid_on)}</span><span className="font-mono">{p.receipt_no}</span><span>{METHODS[p.method]}{p.reference && ` · ${p.reference}`}</span>
              <span className="flex-1" /><b className="tabular-nums">{rs(a.amount)}</b>{Number(a.amount) !== Number(p.amount) && <span className="text-gray-400">(of {rs(p.amount)})</span>}
              {p.attachment_path && <button type="button" className="text-primary-700" onClick={async () => { const w = window.open('', '_blank'); try { w.location.href = await vatFileUrl(p.attachment_path); } catch (e) { w?.close(); toast.error(e.message); } }}><Paperclip size={12} /></button>}
              {!p.voided_at && can('payment') && <button type="button" className="text-red-600" onClick={() => { const r = window.prompt('Reason for voiding this payment (it stays on record):'); if (r) act('void', () => voidPayment(p.id, r), 'Payment voided'); }}>void</button>}
              {p.voided_at && <span className="no-underline text-red-600">void: {p.void_reason}</span>}
            </div>); })}
        </div>
      )}

      {subs.length > 0 && (
        <div className="card p-4">
          <div className="mb-1 text-sm font-semibold text-gray-700">RAMIS submissions</div>
          {subs.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-b border-gray-50 py-1 text-xs">
              <span className="font-mono">{s.submission_no}</span><Badge meta={SUB_STATUS[s.status]} /><span className="text-gray-500">{s.environment} · adapter {s.adapter_version} · tries {s.attempts}/{s.max_attempts}</span>
              {s.ramis_ref && <span>ref <b>{s.ramis_ref}</b></span>}{s.error_message && <span className="text-red-700">{s.error_code && `${s.error_code}: `}{s.error_message}</span>}
              <span className="flex-1" /><span className="text-gray-400">{dt(s.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {rems.length > 0 && (
        <div className="card p-4">
          <div className="mb-1 text-sm font-semibold text-gray-700">Reminders</div>
          {rems.map((r) => <div key={r.id} className="flex flex-wrap gap-2 border-b border-gray-50 py-0.5 text-xs"><span className="w-36 text-gray-500">{dt(r.created_at)}</span><span>{r.channel}</span><span>{r.automatic ? 'automatic' : 'manual'}</span><span className={r.status === 'failed' ? 'text-red-600' : 'text-gray-600'}>{r.status}{r.error && `: ${r.error}`}</span><span className="text-gray-400">{r.recipient}</span></div>)}
        </div>
      )}

      {can('reports') && ['taxmate', 'owner', 'admin', 'accountant'].includes(ctx.role) && (
        <div className="card p-4">
          <button type="button" className="flex items-center gap-1.5 text-sm font-semibold text-gray-700" onClick={() => loadAudit(clientId, d.id).then(setAudit).catch((e) => toast.error(e.message))}><History size={15} /> Audit trail {audit ? `(${audit.length})` : '— show'}</button>
          {audit && audit.map((a) => <div key={a.id} className="flex flex-wrap gap-2 border-b border-gray-50 py-0.5 text-xs"><span className="w-36 text-gray-500">{dt(a.created_at)}</span><b>{a.action.replace(/_/g, ' ')}</b><span className="text-gray-500">{ROLES[a.actor_role] || a.actor_role || ''}</span>{a.note && <span className="text-gray-400">{a.note}</span>}</div>)}
        </div>
      )}

      {payOpen && <PaymentForm app={app} doc={d} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); after(); }} />}
      {shareOpen && (
        <Modal title={shareOpen === 'remind' ? `Payment reminder — ${d.doc_no}` : `Share ${d.doc_no}`} onClose={() => setShareOpen(null)}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-gray-500">A secure link opens the {docTitle(d).toLowerCase()} for {d.customer?.name}{d.customer?.phone ? ` (${d.customer.phone})` : ''} — no login, expires automatically, no other data of yours is visible.</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="btn-secondary border justify-center text-sm" onClick={() => send('whatsapp', shareOpen === 'remind')}><MessageCircle size={15} className="text-green-600" /> WhatsApp</button>
              <button type="button" className="btn-secondary border justify-center text-sm" onClick={() => send('email', shareOpen === 'remind')}><Mail size={15} /> Email app</button>
              <button type="button" disabled={!d.customer?.email || busy === 'mail'} className="btn-secondary border justify-center text-sm" onClick={() => serverEmail(shareOpen === 'remind')} title={d.customer?.email ? '' : 'No customer email'}>{busy === 'mail' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Email via TaxMate</button>
              <button type="button" className="btn-secondary border justify-center text-sm" onClick={() => send('copy', shareOpen === 'remind')}><Copy size={15} /> Copy message</button>
              <button type="button" className="btn-secondary border justify-center text-sm" onClick={() => send('link', shareOpen === 'remind')}><Link2 size={15} /> Copy link only</button>
              <button type="button" className="btn-secondary border justify-center text-sm" onClick={print}><Printer size={15} /> Download PDF</button>
            </div>
            {shareOpen === 'remind' && d.last_reminder_at && <div className="text-xs text-amber-800"><AlertTriangle size={12} className="inline" /> Last reminder {dt(d.last_reminder_at)} ({d.reminder_count} so far).</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ k, v, b, tone = '' }) {
  return <div className={`flex justify-between gap-2 ${b ? 'font-bold' : ''}`}><span className="text-gray-500">{k}</span><span className={`tabular-nums ${tone}`}>{v}</span></div>;
}
