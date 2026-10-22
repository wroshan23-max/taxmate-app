import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calculator, X, Delete, Check } from 'lucide-react';

// ── Safe expression evaluator (no eval) ─────────────────────
//  + − × ÷ ( ) and %:  "200000 + 10%" = 220,000 · "50 × 10%" = 5
function tokenize(src) {
  const s = src.replace(/[×x*]/g, '*').replace(/[÷/]/g, '/').replace(/[−–]/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[\d.]/.test(c)) {
      let j = i; while (j < s.length && /[\d.]/.test(s[j])) j++;
      const t = s.slice(i, j);
      if ((t.match(/\./g) || []).length > 1) throw new Error('bad number');
      out.push({ t: 'n', v: parseFloat(t === '.' ? '0' : t) }); i = j;
    } else if ('+-*/()%'.includes(c)) { out.push({ t: c }); i++; } else throw new Error('bad char');
  }
  return out;
}
export function evaluate(src) {
  const tk = tokenize(src); let p = 0;
  const peek = () => tk[p]?.t;
  const factor = () => {
    if (peek() === '-') { p++; const f = factor(); return { v: -f.v, pct: f.pct }; }
    if (peek() === '+') { p++; return factor(); }
    let v;
    if (peek() === '(') { p++; v = expr(); if (peek() !== ')') throw new Error(')'); p++; }
    else if (peek() === 'n') v = tk[p++].v;
    else throw new Error('expected number');
    if (peek() === '%') { p++; return { v: v / 100, pct: true }; }
    return { v, pct: false };
  };
  const term = () => {
    let a = factor(), single = true;
    while (peek() === '*' || peek() === '/') {
      const op = tk[p++].t, b = factor(); single = false;
      if (op === '/' && b.v === 0) throw new Error('÷ 0');
      a = { v: op === '*' ? a.v * b.v : a.v / b.v, pct: false };
    }
    return { v: a.v, pct: single && a.pct };
  };
  function expr() {
    let a = term().v;
    while (peek() === '+' || peek() === '-') {
      const op = tk[p++].t, b = term();
      const r = b.pct ? a * b.v : b.v;          // "a + b%" adds b% of a
      a = op === '+' ? a + r : a - r;
    }
    return a;
  }
  if (!tk.length) return 0;
  const v = expr();
  if (p !== tk.length) throw new Error('unexpected');
  if (!Number.isFinite(v)) throw new Error('∞');
  return Math.round(v * 100) / 100;
}

const fmt = (n) => n.toLocaleString('en-LK', { maximumFractionDigits: 2 });
const pretty = (e) => e
  .replace(/\d+(\.\d*)?/g, (m) => { const [i, d] = m.split('.'); return Number(i).toLocaleString('en-LK') + (d !== undefined ? `.${d}` : ''); })
  .replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/(?<=[\d%)])-/g, ' − ').replace(/-/g, '−');

const KEYS = [
  ['C', 'clear'], ['⌫', 'back'], ['%', '%'], ['÷', '/'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'],
  ['00', '00'], ['0', '0'], ['.', '.'], ['=', 'eq'],
];
const QUICK = [['× 12', '*12', 'monthly → annual'], ['÷ 12', '/12', 'annual → monthly'], ['lakh', '*100000', '× 100,000'], ['Mn', '*1000000', '× 1,000,000']];

/**
 * Small faded calculator icon for money inputs. Opens a pop-up "top-up" calculator
 * that starts from the field's current amount; "Use" writes the result back.
 *  Place inside a `relative` wrapper and give the input right padding (pr-8).
 */
export default function TopUpCalc({ value, onUse, disabled, allowNegative = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef();
  if (disabled) return null;
  return (
    <>
      <button ref={btn} type="button" tabIndex={-1} title="Calculator — add up amounts"
        onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-all ${open ? 'text-primary-600 bg-primary-50 opacity-100' : 'text-gray-400 opacity-30 hover:opacity-100 hover:text-primary-600 hover:bg-primary-50 focus:opacity-100'} ${className}`}>
        <Calculator size={14} />
      </button>
      {open && <Panel anchor={btn.current} start={value} allowNegative={allowNegative} onClose={() => setOpen(false)} onUse={(v) => { onUse(v); setOpen(false); }} />}
    </>
  );
}

function Panel({ anchor, start, onClose, onUse, allowNegative }) {
  const n0 = Number(String(start ?? '').replace(/,/g, ''));
  const [ex, setEx] = useState(Number.isFinite(n0) && n0 !== 0 ? String(n0) : '');
  const [pos, setPos] = useState(null);
  const [flash, setFlash] = useState(false);
  const box = useRef();
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;

  let result = null, err = false;
  try { result = evaluate(ex.replace(/[+\-*/(]+$/, '')); } catch { err = true; }
  const neg = result !== null && result < 0 && !allowNegative;
  const canUse = !err && result !== null && !neg;

  useLayoutEffect(() => {
    if (mobile || !anchor) return;
    const r = anchor.getBoundingClientRect(), W = 288, H = 430;
    let left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
    let top = r.bottom + 6;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6);
    setPos({ left, top });
  }, [anchor, mobile]);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, [pos]);

  const press = useCallback((k) => {
    setEx(e => {
      if (k === 'clear') return '';
      if (k === 'back') return e.slice(0, -1);
      if (k === 'eq') { try { const v = evaluate(e.replace(/[+\-*/(]+$/, '')); setFlash(true); setTimeout(() => setFlash(false), 250); return String(v); } catch { return e; } }
      if (/^[+*/%]$/.test(k)) {
        if (!e) return e;
        if (k !== '%' && /[+\-*/]$/.test(e)) return e.slice(0, -1) + k;   // swap operator
        if (k === '%' && /[+\-*/%(]$/.test(e)) return e;
        return e + k;
      }
      if (k === '-') return /[+\-]$/.test(e) ? e.slice(0, -1) + k : e + k;
      if (k.startsWith('*') || k.startsWith('/')) { try { const v = evaluate(e || '0'); return String(Math.round(evaluate(`${v}${k}`) * 100) / 100); } catch { return e; } }
      if (k === '.') { const last = e.split(/[+\-*/()%]/).pop(); return last.includes('.') ? e : e + (last === '' ? '0.' : '.'); }
      if (/^\d+$/.test(k) && /%$/.test(e)) return e;
      return (e.length > 60 ? e : e + k);
    });
  }, []);

  const onKey = (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); onClose(); return; }
    if (k === 'Enter') { e.preventDefault(); if (canUse) onUse(String(result)); return; }
    if (k === 'Backspace') { e.preventDefault(); press('back'); return; }
    if (k === 'Delete') { e.preventDefault(); press('clear'); return; }
    if (k === '=') { e.preventDefault(); press('eq'); return; }
    if (/^[\d.+\-*/%()]$/.test(k)) { e.preventDefault(); if ('()'.includes(k)) setEx(x => x + k); else press(k); return; }
    if (k === 'x' || k === 'X') { e.preventDefault(); press('*'); }
  };

  const body = (
    <div ref={box} tabIndex={-1} onKeyDown={onKey} onMouseDown={e => e.stopPropagation()}
      className={`outline-none bg-white shadow-2xl border border-gray-200 overflow-hidden ${mobile ? 'fixed inset-x-0 bottom-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)] animate-[slideUp_.18s_ease-out]' : 'fixed w-72 rounded-2xl'}`}
      style={mobile ? { zIndex: 81 } : { zIndex: 81, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      <style>{'@keyframes slideUp{from{transform:translateY(100%)}to{transform:none}}'}</style>
      {/* Display */}
      <div className="bg-gradient-to-br from-primary-800 to-indigo-900 text-white px-4 pt-3 pb-3">
        <div className="flex items-center gap-2 text-[11px] text-primary-200">
          <Calculator size={12} /> Top-up calculator
          <button type="button" onClick={onClose} className="ml-auto p-1 -mr-1 rounded-md hover:bg-white/10 text-primary-200"><X size={15} /></button>
        </div>
        <div className="mt-1 min-h-[20px] text-right text-sm text-primary-200 font-mono break-all leading-snug">{ex ? pretty(ex) : <span className="opacity-50">Type an amount, e.g. 125000 + 45000</span>}</div>
        <div className={`text-right text-3xl font-black tabular-nums tracking-tight transition-transform ${flash ? 'scale-105' : ''} ${err || neg ? 'text-red-300' : ''}`}>
          <span className="text-base font-semibold text-gold-500 mr-1">Rs.</span>{result === null ? '…' : fmt(result)}
        </div>
        {neg && <div className="text-right text-[11px] text-red-300">This field can't be negative</div>}
      </div>
      {/* Quick ops */}
      <div className="flex gap-1.5 px-3 pt-3">
        {QUICK.map(([l, k, hint]) => (
          <button key={l} type="button" title={hint} onClick={() => press(k)} className="flex-1 text-[11px] font-bold py-1.5 rounded-lg bg-gold-500/15 text-amber-800 hover:bg-gold-500/30 transition-colors">{l}</button>
        ))}
      </div>
      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1.5 p-3">
        {KEYS.map(([label, k]) => {
          const op = '+-*/%'.includes(k) || k === 'eq';
          const fn = k === 'clear' || k === 'back';
          return (
            <button key={label} type="button" onClick={() => press(k)}
              className={`h-11 rounded-xl text-lg font-semibold select-none active:scale-95 transition-all
                ${k === 'eq' ? 'bg-primary-600 text-white hover:bg-primary-700' : op ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : fn ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 text-base' : 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50'}`}>
              {k === 'back' ? <Delete size={18} className="mx-auto" /> : label}
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-3">
        <button type="button" disabled={!canUse} onClick={() => onUse(String(result))}
          className="w-full h-11 rounded-xl bg-gold-500 text-primary-900 font-black flex items-center justify-center gap-1.5 hover:brightness-95 disabled:opacity-40 shadow-sm">
          <Check size={17} strokeWidth={3} /> Use {canUse ? `Rs. ${fmt(result)}` : 'amount'}
        </button>
        {!mobile && <div className="text-[10px] text-gray-400 text-center mt-1.5">Keyboard works · Enter = use · Esc = close</div>}
      </div>
    </div>
  );

  return createPortal(
    <>
      <div className={`fixed inset-0 ${mobile ? 'bg-black/40' : ''}`} style={{ zIndex: 80 }} onMouseDown={onClose} />
      {body}
    </>,
    document.body,
  );
}
