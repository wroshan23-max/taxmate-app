// V64 — small shared pieces for the VAT Invoice screens
import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { rs } from '../../lib/vat/format';

export function Badge({ meta, children, className = '' }) {
  const m = meta || { label: children, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.cls} ${className}`}>{children ?? m.label}</span>;
}

export function Money({ v, className = '', neg }) {
  return <span className={`tabular-nums ${className}`}>{neg && Number(v) ? '−' : ''}{rs(v)}</span>;
}

export function Stat({ label, value, sub, tone = 'gray', onClick, icon: Icon }) {
  const tones = { gray: 'text-gray-800', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', blue: 'text-primary-700', violet: 'text-violet-700' };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card p-3 text-left ${onClick ? 'hover:border-primary-200 hover:shadow transition' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{Icon && <Icon size={13} />}{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${tones[tone] || tones.gray}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </Tag>
  );
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-label={title} className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-white px-4 py-3">
          <div className="flex-1 font-bold text-primary-800">{title}</div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-gray-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block text-xs font-medium text-gray-600 ${className}`}>
      <span>{label}</span>
      <div className="mt-0.5">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] font-normal text-gray-400">{hint}</span>}
    </label>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="card p-8 text-center">
      {Icon && <Icon size={36} className="mx-auto text-gray-200" />}
      <div className="mt-2 font-semibold text-gray-700">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-gray-500">{children}</div>}
    </div>
  );
}

export const Spinner = ({ className = '' }) => <div className={`p-10 text-center ${className}`}><Loader2 className="mx-auto animate-spin text-gray-400" /></div>;

/** Simple vertical bar chart (no library). data: [{label, value, value2?}] */
export function Bars({ data, height = 120, color = '#1e3a8a', color2 = '#eab308', fmt = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => Math.max(Number(d.value) || 0, Number(d.value2) || 0)));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.label}: ${fmt(d.value)}${d.value2 != null ? ` · ${fmt(d.value2)}` : ''}`}>
          <div className="flex w-full items-end justify-center gap-px" style={{ height: height - 16 }}>
            <div className="w-full max-w-[18px] rounded-t" style={{ height: `${(Number(d.value) || 0) / max * 100}%`, background: color, minHeight: d.value ? 2 : 0 }} />
            {d.value2 != null && <div className="w-full max-w-[18px] rounded-t" style={{ height: `${(Number(d.value2) || 0) / max * 100}%`, background: color2, minHeight: d.value2 ? 2 : 0 }} />}
          </div>
          <div className="truncate text-[9px] text-gray-500">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal share bars. data: [{label, value}] */
export function HBars({ data, fmt = (v) => v, color = '#1e3a8a' }) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="text-xs">
          <div className="flex justify-between gap-2"><span className="truncate text-gray-700">{d.label}</span><span className="tabular-nums text-gray-500">{fmt(d.value)}</span></div>
          <div className="h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded" style={{ width: `${(Number(d.value) || 0) / max * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const v = c == null ? '' : typeof c === 'object' && 'v' in c ? c.v : c;
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/** An HTML document shown at its print width (820 px) and scaled down to fit the box */
export function ScaledFrame({ html, title = 'Preview', width = 820, maxHeight = 700 }) {
  const wrap = useRef(null), frame = useRef(null);
  const [scale, setScale] = useState(1);
  const [h, setH] = useState(1100);
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width))); ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={wrap} className="overflow-y-auto overflow-x-hidden rounded border bg-gray-100" style={{ maxHeight }}>
      <div style={{ height: h * scale }}>
        <iframe ref={frame} title={title} srcDoc={html} onLoad={() => { const x = frame.current?.contentDocument?.body?.scrollHeight; if (x) setH(x + 20); }}
          style={{ width, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
      </div>
    </div>
  );
}
