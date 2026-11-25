// V78 — "Excel" dropdown: export the data, download a blank template, import a filled file (.xlsx / .csv)
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, Download, FileDown, Upload, ChevronDown, Loader2 } from 'lucide-react';
import FloatingMenu from './FloatingMenu';
import { pickFile, readSpreadsheet } from '../lib/xlsx';

/**
 * onExport() / onTemplate(): build & download (may be async)
 * onImport(sheets, file): apply the file; return a short message (or throw to show an error). Omit to hide Import.
 */
export default function ExcelMenu({ onExport, onTemplate, onImport, label = 'Excel', className = '', dark = false, importHint }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setOpen(false); setBusy(true);
    try { await fn(); } catch (e) { toast.error(e.message || String(e), { duration: 7000 }); }
    setBusy(false);
  };
  const doImport = () => run(async () => {
    const file = await pickFile('.xlsx,.csv');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('The file is too big (max 5 MB).');
    const sheets = await readSpreadsheet(file);
    const msg = await onImport(sheets, file);
    if (msg) toast.success(msg, { duration: 6000 });
  });
  const item = 'flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-primary-50';
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} disabled={busy}
        className={className || `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'border border-gray-200 bg-white text-emerald-700 hover:bg-emerald-50'}`}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} {label} <ChevronDown size={12} />
      </button>
      {open && (
        <FloatingMenu anchorRef={ref} onClose={() => setOpen(false)} align="right" width={270}>
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
            {onExport && <button type="button" onClick={() => run(onExport)} className={item}><Download size={15} className="mt-0.5 text-emerald-600" /><span><b className="block text-gray-800">Export to Excel</b><span className="text-[11px] text-gray-500">The figures as they are now</span></span></button>}
            {onTemplate && <button type="button" onClick={() => run(onTemplate)} className={item}><FileDown size={15} className="mt-0.5 text-primary-600" /><span><b className="block text-gray-800">Download template</b><span className="text-[11px] text-gray-500">Blank sheet to fill in Excel</span></span></button>}
            {onImport && <button type="button" onClick={doImport} className={`${item} border-t border-gray-100`}><Upload size={15} className="mt-0.5 text-amber-600" /><span><b className="block text-gray-800">Import from Excel…</b><span className="text-[11px] text-gray-500">{importHint || 'A filled template or an export (.xlsx / .csv)'}</span></span></button>}
          </div>
        </FloatingMenu>
      )}
    </>
  );
}
