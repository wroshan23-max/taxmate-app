// V65.2 — dropdown drawn on top of the page (portal), so a card with overflow-hidden can't cut it off.
// Placed under the button; opens upwards when there is no room below; closes on outside click, Esc, scroll or resize.
import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function FloatingMenu({ anchorRef, onClose, align = 'right', width = 256, children }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth, vh = window.innerHeight, gap = 4, pad = 8;
      const w = Math.min(width, vw - pad * 2);
      const h = menuRef.current?.offsetHeight || 0;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(pad, Math.min(left, vw - w - pad));
      const below = vh - a.bottom - gap - pad, above = a.top - gap - pad;
      const up = h > below && above > below;
      const top = up ? Math.max(pad, a.top - gap - h) : a.bottom + gap;
      setPos({ left, top, width: w, maxHeight: Math.max(160, up ? above : below) });
    };
    place();
    const r = requestAnimationFrame(place);   // again once the menu height is known
    return () => cancelAnimationFrame(r);
  }, [anchorRef, align, width]);

  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose(); };
    const moved = (e) => { if (!menuRef.current?.contains(e.target)) onClose(); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={menuRef} role="menu"
      style={pos ? { position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { position: 'fixed', left: -9999, top: 0, width }}
      className="z-[60] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
      {children}
    </div>,
    document.body,
  );
}
