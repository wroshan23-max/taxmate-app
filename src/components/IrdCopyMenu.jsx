// V78 — "IRD copy" (unbranded PDF for uploading to IRD) — with or without the taxpayer's declaration & signature block
import { useRef, useState } from 'react';
import { FileCheck2, ChevronDown, PenLine, FileX2 } from 'lucide-react';
import FloatingMenu from './FloatingMenu';

export default function IrdCopyMenu({ onPick, className = 'btn-secondary text-xs py-1 px-2.5', label = 'IRD copy', size = 13 }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const pick = (sign) => { setOpen(false); onPick(sign); };
  const item = 'flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-primary-50';
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className={className} title="Unbranded PDF — no TaxMate header or details. Upload to IRD as a supporting document.">
        <FileCheck2 size={size} /> {label} <ChevronDown size={11} />
      </button>
      {open && (
        <FloatingMenu anchorRef={ref} onClose={() => setOpen(false)} align="right" width={250}>
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
            <button type="button" onClick={() => pick(true)} className={item}><PenLine size={15} className="mt-0.5 text-primary-600" /><span><b className="block text-gray-800">With signature</b><span className="text-[11px] text-gray-500">Declaration, date and signature line</span></span></button>
            <button type="button" onClick={() => pick(false)} className={item}><FileX2 size={15} className="mt-0.5 text-gray-500" /><span><b className="block text-gray-800">Without signature</b><span className="text-[11px] text-gray-500">Figures only — for uploading to RAMIS</span></span></button>
          </div>
        </FloatingMenu>
      )}
    </>
  );
}
