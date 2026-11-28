// V84 — "IRD attachments" for one client & Y/A (admin): the two RAMIS check-lists ("Verification of return" and
// "Verification of attachment / documents") with the relevant items ticked from the data, a View button for every
// document the app can make, and one printable pack of everything ticked.
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Paperclip, Eye, Download, Loader2, RotateCcw, PenLine, FileX2, FolderOpen, CheckSquare, Square, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buildDraft, buildDraftHtml, draftCages } from '../lib/ramisDraft';
import { buildStatementHtml } from '../lib/iitStatement';
import { buildAssetStatementHtml } from '../lib/assets';
import { computeBusiness } from '../lib/bizAccounts';
import { buildBizStatementHtml } from '../lib/bizStatement';
import { buildAccountsHtml, buildPitHtml, openHtml } from '../lib/bizDocs';
import { RETURN_ITEMS, DOC_ITEMS, relevance, buildPackHtml } from '../lib/irdAttachments';

const COLS = 'id, client_id, year, kind, name, tin, activity_code, mode, data, status, result, finalized_at';

export default function IrdAttachmentsPack({ client, year, calc, draft, ctx, attach = {}, onAttach }) {
  const [biz, setBiz] = useState({ sole: [], partnerships: [], loading: true });
  const [sign, setSign] = useState(true);
  const [busy, setBusy] = useState(false);

  // business accounts for this Y/A: own sole proprietorships + partnerships where the client is a linked partner
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: rows, error } = await supabase.from('business_accounts').select(COLS).eq('year', year);
      if (!live) return;
      if (error) { setBiz({ sole: [], partnerships: [], loading: false, missing: true }); return; }
      const parts = (rows || []).filter((r) => r.kind === 'partnership');
      let offices = {};
      if (parts.length) {
        const { data: od } = await supabase.from('business_account_office').select('account_id, data').in('account_id', parts.map((r) => r.id));
        offices = Object.fromEntries((od || []).map((o) => [o.account_id, o.data || {}]));
      }
      const withC = (r) => { const office = offices[r.id] || {}; return { acc: r, office, c: computeBusiness(r, office), name: r.name }; };
      const sole = (rows || []).filter((r) => r.kind === 'sole' && r.client_id === client.id).map(withC);
      const partnerships = parts.filter((r) => r.client_id === client.id || Object.values(offices[r.id]?.links || {}).includes(client.id) || (r.result?.partners || []).some((p) => p.client_id === client.id)).map(withC);
      if (live) setBiz({ sole, partnerships, loading: false });
    })();
    return () => { live = false; };
  }, [client.id, year]);

  const d = useMemo(() => draft || (calc ? buildDraft({ year, calc, client, sheet: ctx.sheet, al: ctx.al, docs: ctx.docs }) : null), [draft, calc, year, client, ctx]);
  const C = useMemo(() => (calc ? draftCages(year, calc.input_data || {}, d || {}) : null), [calc, year, d]);
  const auto = useMemo(() => relevance({ C, d: d || {}, biz, al: ctx.al, docs: ctx.docs || [] }), [C, d, biz, ctx]);
  const isOn = (k) => (attach[k] === undefined ? !!auto[k]?.on : !!attach[k]);
  const toggle = (k) => onAttach?.({ ...attach, [k]: !isOn(k) });
  const overridden = Object.keys(attach).length > 0;

  // ─── document builders (withToolbar = false inside the pack) ───
  const docsFor = (key, tb = true, sg = sign) => {
    const o = { sign: sg, withToolbar: tb };
    const item = RETURN_ITEMS.find((x) => x.key === key);
    if (item) {
      if (!item.sections || !calc || !d) return [];
      return [{ title: `${item.en}${item.hint && key !== 'return' ? ` — ${item.hint}` : ''}`, html: buildDraftHtml({ year, d, calc, client, clean: true, only: item.sections, ...o }) }];
    }
    switch (key) {
      case 'al': return ctx.al ? [{ title: 'Statement of Assets & Liabilities', html: buildAssetStatementHtml({ ...ctx.al, year }, client, { clean: true, ...o }) }]
        : d ? [{ title: 'Statement of Assets & Liabilities (from the RAMIS draft)', html: buildDraftHtml({ year, d, calc, client, clean: true, only: ['al'], ...o }) }] : [];
      case 'accounts': return biz.sole.map((x) => ({ title: `Statement of Accounts — ${x.name}`, html: buildAccountsHtml(x.acc, x.c, client, o) }));
      case 'computation': return [
        ...(calc ? [{ title: 'Income tax computation', html: buildStatementHtml(calc, client, { clean: true, ...o }) }] : []),
        ...biz.sole.map((x) => ({ title: `Computation of business income — ${x.name}`, html: buildBizStatementHtml(x.acc, x.c, client, { status: x.acc.status, clean: true, ...o }) })),
      ];
      case 'pit': return biz.partnerships.map((x) => ({ title: `Statement of Partnership Income — ${x.name}`, html: buildPitHtml(x.acc, x.c, { ...o, office: x.office }) }));
      default: return [];
    }
  };
  const canMake = (key) => {
    const item = RETURN_ITEMS.find((x) => x.key === key);
    if (item) return !!(item.sections && calc && d);
    if (key === 'al') return !!(ctx.al || d);
    if (key === 'accounts') return biz.sole.length > 0;
    if (key === 'computation') return !!calc || biz.sole.length > 0;
    if (key === 'pit') return biz.partnerships.length > 0;
    return false;
  };
  const view = (key) => {
    const list = docsFor(key);
    if (!list.length) return toast.error('Nothing to show yet');
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to view');
    openHtml(list.length === 1 ? list[0].html : buildPackHtml(docsFor(key, false), cover([]), { sign }), w);
  };
  const cover = (keys) => ({
    name: client.full_name, tin: client.tin, year,
    lists: keys.length ? [
      { title: 'Verification of return', items: RETURN_ITEMS.map((x) => ({ sn: x.sn, en: x.en, on: isOn(x.key) })) },
      { title: 'Verification of attachment / documents', items: DOC_ITEMS.map((x) => ({ sn: x.sn, en: x.en, on: isOn(x.key) })) },
    ] : [],
  });
  const all = (sg = sign) => {
    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to open the pack');
    setBusy(true);
    try {
      const retKeys = RETURN_ITEMS.filter((x) => isOn(x.key) && x.sections && x.key !== 'whtSch').map((x) => x.key);
      // the return & its ticked schedules as one document; then the attachments in RAMIS order
      const docs = [];
      if (calc && d && retKeys.length) {
        const sections = RETURN_ITEMS.filter((x) => retKeys.includes(x.key)).flatMap((x) => x.sections);
        const order = ['return', 'sch1', 'sch2', 'sch3', 'sch4', 'sch5', 'sch7', 'sch8', 'sch9', 'sch10', 'decl'];
        docs.push({ title: `Return of income & schedules (${retKeys.filter((k) => k !== 'return').map((k) => RETURN_ITEMS.find((x) => x.key === k).en.replace('Schedule ', 'Sch. ')).join(', ') || 'no schedules'})`, html: buildDraftHtml({ year, d, calc, client, clean: true, only: order.filter((s) => sections.includes(s)), sign: sg, withToolbar: false }) });
      }
      if (isOn('whtSch') && !retKeys.includes('sch7')) docs.push(...docsFor('whtSch', false, sg));
      for (const it of DOC_ITEMS) if (isOn(it.key) && canMake(it.key)) docs.push(...docsFor(it.key, false, sg));
      if (!docs.length) { w.close(); toast.error('Tick at least one item the app can make'); return; }
      openHtml(buildPackHtml(docs, cover(['x']), { sign: sg }), w);
    } catch (e) { w.close(); toast.error(e.message); } finally { setBusy(false); }
  };

  const vaultCount = (it) => (it.vault ? (ctx.docs || []).filter(it.vault).length : null);
  const Row = ({ it }) => {
    const on = isOn(it.key), a = auto[it.key] || {}, changed = attach[it.key] !== undefined && attach[it.key] !== !!a.on, vc = vaultCount(it);
    return (
      <tr className={`border-t border-gray-100 ${on ? '' : 'text-gray-400'}`}>
        <td className="w-10 px-2 py-1.5 text-xs">{it.sn}</td>
        <td className="px-2 py-1.5"><div className={`text-sm ${on ? 'font-semibold text-gray-800' : ''}`}>{it.en}{it.hint && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{it.hint}</span>}</div>
          {a.why && <div className="text-[11px] text-gray-500">{a.why}{changed && <span className="ml-1 font-semibold text-amber-700">· changed by you</span>}</div>}</td>
        <td className="w-20 px-2 py-1.5 text-center"><button type="button" onClick={() => toggle(it.key)} disabled={!onAttach} className="text-primary-700 disabled:opacity-60" aria-label={on ? 'Relevant' : 'Not relevant'}>{on ? <CheckSquare size={18} /> : <Square size={18} className="text-gray-300" />}</button></td>
        <td className="w-36 px-2 py-1.5 text-right">
          {canMake(it.key) ? <button type="button" onClick={() => view(it.key)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-50"><Eye size={12} /> View</button>
            : vc !== null ? <span className={`inline-flex items-center gap-1 text-[11px] ${vc ? 'text-emerald-700' : on ? 'text-amber-700' : 'text-gray-400'}`}><FolderOpen size={12} /> {vc ? `${vc} in Documents` : on ? 'Upload to Documents' : 'From client'}</span>
            : <span className="text-[11px] text-gray-300">—</span>}
        </td>
      </tr>
    );
  };

  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2"><Paperclip size={16} /> IRD attachments — RAMIS verification
        {/* V87: with / without signature — for View; Download all has both buttons */}
        <div className="ml-auto flex rounded-lg bg-gray-100 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Signature">
          {[[true, 'With signature', PenLine], [false, 'Without signature', FileX2]].map(([v, l, I]) => (
            <button key={l} type="button" role="radio" aria-checked={sign === v} onClick={() => setSign(v)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${sign === v ? 'bg-white text-primary-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><I size={12} /> {l}</button>
          ))}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-gray-500">The two lists RAMIS shows before you submit the return. Items are ticked from the computation, the RAMIS draft, the A&amp;L statement and the business accounts — tick or untick to change. <b>View</b> opens a document ready to save as PDF and upload (with or without signature lines — choose at the top right); <b>Download all</b> makes one file with everything ticked. Documents are unbranded (IRD copies).</p>
        {!calc && <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><Info size={13} /> Choose the IIT return computation above to make the return, schedules and tax computation.</div>}
        {biz.loading ? <div className="py-3 text-center"><Loader2 className="mx-auto animate-spin text-gray-400" /></div> : (
          <div className="grid gap-4 xl:grid-cols-2">
            {[['Verification of return', RETURN_ITEMS], ['Verification of attachment / documents', DOC_ITEMS]].map(([t, items]) => (
              <div key={t} className="overflow-x-auto rounded-xl border border-gray-100">
                <div className="bg-[#7a1800] px-3 py-1.5 text-xs font-bold text-white">{t}</div>
                <table className="w-full min-w-[460px]">
                  <thead><tr className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500"><th className="px-2 py-1">S/N</th><th className="px-2 py-1">Description</th><th className="px-2 py-1 text-center">Relevant</th><th className="px-2 py-1 text-right">Document</th></tr></thead>
                  <tbody>{items.map((it) => <Row key={it.key} it={it} />)}</tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => all(true)} disabled={busy || biz.loading} className="btn-primary text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download all ticked — with signature</button>
          <button type="button" onClick={() => all(false)} disabled={busy || biz.loading} className="btn-secondary text-xs"><FileX2 size={13} /> Download all ticked — without signature</button>
          {overridden && onAttach && <button type="button" onClick={() => onAttach({})} className="btn-secondary text-xs"><RotateCcw size={13} /> Back to automatic ticks</button>}
          {!draft && calc && <span className="text-[11px] text-gray-400">Built from the computation — build &amp; save the RAMIS draft above to add certificate numbers, TINs and activity codes.</span>}
          {biz.missing && <span className="text-[11px] text-amber-700">Business accounts are not set up (V76 script).</span>}
        </div>
      </div>
    </div>
  );
}
