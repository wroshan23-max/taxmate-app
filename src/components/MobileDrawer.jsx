import { useEffect, useRef, useState } from 'react';

const EDGE = 44;        // px from the left edge where a swipe opens the menu
const WIDTH = 280;      // drawer width

/**
 * Phone menu that slides in from the left.
 * • swipe right from the left edge → opens   • swipe left on the menu or tap outside → closes
 * • follows the finger while dragging, scrolls smoothly down to the last tab
 */
export default function MobileDrawer({ open, setOpen, children }) {
  const [drag, setDrag] = useState(null);           // drawer offset (px, -WIDTH…0) while a finger is down
  const dragRef = useRef(null);
  const g = useRef(null);                           // current gesture
  const set = (v) => { dragRef.current = v; setDrag(v); };

  // Inside the portal, a sideways swipe opens/closes the menu — stop the browser using it as "go back"
  // (Chrome on Android). The back button / back gesture from the system bar still works.
  useEffect(() => {
    const el = document.documentElement, b = document.body;
    const prev = [el.style.overscrollBehaviorX, b.style.overscrollBehaviorX];
    el.style.overscrollBehaviorX = 'none'; b.style.overscrollBehaviorX = 'none';
    return () => { el.style.overscrollBehaviorX = prev[0]; b.style.overscrollBehaviorX = prev[1]; };
  }, []);

  // Swipe from the left edge of the screen to open
  useEffect(() => {
    if (open) return undefined;
    const start = (e) => {
      if (window.innerWidth >= 768 || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) return;
      g.current = { x: t.clientX, y: t.clientY, axis: null };
    };
    const move = (e) => {
      const s = g.current; if (!s) return;
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (!s.axis) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
      if (s.axis !== 'x') { g.current = null; set(null); return; }
      set(Math.max(-WIDTH, Math.min(0, dx - WIDTH)));
    };
    const end = () => {
      if (!g.current) return;
      g.current = null;
      const d = dragRef.current; set(null);
      if (d !== null && d > -WIDTH * 0.65) setOpen(true);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, [open, setOpen]);

  // Swipe left on the open menu to close (vertical swipes keep scrolling the list)
  const onStart = (e) => { if (!open) return; const t = e.touches[0]; g.current = { x: t.clientX, y: t.clientY, axis: null }; };
  const onMove = (e) => {
    const s = g.current; if (!open || !s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.axis) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
    if (s.axis === 'x') set(Math.max(-WIDTH, Math.min(0, dx)));
  };
  const onEnd = () => {
    if (!open || !g.current) return;
    g.current = null;
    const d = dragRef.current; set(null);
    if (d !== null && d < -WIDTH * 0.3) setOpen(false);
  };

  // Close with the phone's Escape / when the screen becomes wide
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    const r = () => { if (window.innerWidth >= 768) setOpen(false); };
    window.addEventListener('keydown', k); window.addEventListener('resize', r);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('resize', r); };
  }, [open, setOpen]);

  const dragging = drag !== null;
  const x = dragging ? drag : open ? 0 : -WIDTH;
  const progress = (x + WIDTH) / WIDTH;              // 0 closed … 1 open
  const shown = open || dragging;

  return (
    <div className="md:hidden" aria-hidden={!open}>
      <div
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-black"
        style={{ opacity: progress * 0.5, pointerEvents: open ? 'auto' : 'none', transition: dragging ? 'none' : 'opacity .25s ease' }}
      />
      <aside
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col bg-primary-800 shadow-2xl"
        style={{
          width: WIDTH,
          transform: `translate3d(${x}px,0,0)`,
          transition: dragging ? 'none' : 'transform .26s cubic-bezier(.2,.8,.2,1), visibility 0s linear ' + (shown ? '0s' : '.26s'),
          visibility: shown ? 'visible' : 'hidden',
          paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </aside>
    </div>
  );
}
