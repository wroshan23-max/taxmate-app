import { useState } from 'react';
import { Smartphone, Download, X, Share, PlusSquare } from 'lucide-react';
import { useInstallPrompt } from '../lib/pwa';

const KEY = 'tm_install_dismissed';
const dismissedAt = () => { try { return Number(localStorage.getItem(KEY) || 0); } catch { return 0; } };

/** "Install TaxMate on your phone" — Android/desktop: one tap; iPhone: Share → Add to Home Screen. */
export default function InstallAppCard() {
  const { canInstall, ios, installed, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => Date.now() - dismissedAt() < 14 * 864e5);
  const [howto, setHowto] = useState(false);
  if (installed || hidden || (!canInstall && !ios)) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ } setHidden(true); };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-700 to-indigo-800 text-white p-4 flex items-center gap-4 shadow-lg">
      <div className="absolute -right-6 -bottom-8 w-32 h-32 rounded-full bg-gold-500/20 blur-2xl" />
      <img src="/icons/icon-192.png" alt="" className="relative w-12 h-12 rounded-xl bg-white p-1 flex-shrink-0" />
      <div className="relative flex-1 min-w-0">
        <div className="font-bold">Get the TaxMate app</div>
        {!howto ? <div className="text-xs text-primary-200">Open your tax portal in one tap from your home screen · phone එකට app එක දාගන්න</div> : (
          <div className="text-xs text-primary-100 space-y-0.5 mt-0.5">
            <div className="flex items-center gap-1">1. Tap <Share size={12} className="inline" /> <b>Share</b> at the bottom of Safari</div>
            <div className="flex items-center gap-1">2. Choose <PlusSquare size={12} className="inline" /> <b>Add to Home Screen</b></div>
          </div>
        )}
      </div>
      <button onClick={async () => { if (canInstall) { if (await install()) dismiss(); } else setHowto(h => !h); }}
        className="relative flex-shrink-0 bg-gold-500 text-primary-900 font-bold text-sm rounded-xl px-3 py-2 flex items-center gap-1.5 hover:brightness-95">
        {canInstall ? <><Download size={15} /> Install</> : <><Smartphone size={15} /> How?</>}
      </button>
      <button onClick={dismiss} className="relative p-1 text-primary-200 hover:text-white" title="Not now"><X size={15} /></button>
    </div>
  );
}
