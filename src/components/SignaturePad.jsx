import { useEffect, useRef } from 'react';

// Draw-with-mouse/finger signature box. value/onChange use a PNG data URL ('' when empty).
export default function SignaturePad({ value, onChange, height = 130 }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Size the canvas to its box and paint the current value
  useEffect(() => {
    const cv = ref.current;
    const ratio = window.devicePixelRatio || 1;
    const w = cv.offsetWidth || 400;
    cv.width = w * ratio;
    cv.height = height * ratio;
    const ctx = cv.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a3c6e';
    if (value) {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(w / img.width, height / img.height, 1);
        ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
      };
      img.src = value;
    }
    // only on mount: later value changes come from this pad itself
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    e.preventDefault();
    ref.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const cv = ref.current;
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    dirty.current = false;
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={ref}
        style={{ width: '100%', height, touchAction: 'none' }}
        className="bg-white border-2 border-dashed border-gray-300 rounded-lg cursor-crosshair"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs text-gray-400">Sign above with mouse or finger</span>
        <button type="button" onClick={clear} className="text-xs text-red-500 hover:underline">✕ Clear</button>
      </div>
    </div>
  );
}
