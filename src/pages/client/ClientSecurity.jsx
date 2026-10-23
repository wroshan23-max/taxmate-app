import { ShieldCheck, Lock, Smartphone, Eye } from 'lucide-react';
import { TwoFactorCard } from '../../components/TwoFactor';

const TIPS = [
  [Lock, 'Use a strong password', 'At least 8 characters. Don\'t reuse your email or Facebook password.'],
  [Smartphone, 'Turn on two-step login', 'Even if someone learns your password, they still need your phone.'],
  [Eye, 'TaxMate never asks for your code', 'Never share the 6-digit code with anyone — not even us.'],
];

export default function ClientSecurity() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center shadow-md"><ShieldCheck size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Security</h1>
          <p className="text-sm text-gray-500">Keep your tax information safe · ඔබේ ගිණුම ආරක්ෂා කරගන්න</p>
        </div>
      </div>
      <TwoFactorCard />
      <div className="grid sm:grid-cols-3 gap-3">
        {TIPS.map(([Icon, t, d]) => (
          <div key={t} className="card p-4">
            <Icon size={18} className="text-primary-600" />
            <div className="font-semibold text-sm text-gray-800 mt-2">{t}</div>
            <div className="text-xs text-gray-500 mt-0.5">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
