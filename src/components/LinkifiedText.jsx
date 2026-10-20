// Plain text with any http(s) links turned into clickable links (opens in a new tab).
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

export const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
};
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export default function LinkifiedText({ text, className = '' }) {
  const parts = String(text ?? '').split(URL_RE);
  return (
    <p className={className}>
      {parts.map((p, i) => (i % 2 === 1
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-primary-600 underline break-all hover:text-primary-800">{p}</a>
        : p))}
    </p>
  );
}
