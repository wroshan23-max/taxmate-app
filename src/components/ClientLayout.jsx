import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Calculator, FileText, Receipt,
  LogOut, Menu, X, User, Bell, Megaphone
} from 'lucide-react';

const nav = [
  { to: '/client', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/client/calculations', icon: Calculator, label: 'My Calculations' },
  { to: '/client/tax-returns', icon: FileText, label: 'Tax Returns' },
  { to: '/client/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/client/updates', icon: Megaphone, label: 'Tax Updates' },
  { to: '/client/profile', icon: User, label: 'My Profile' },
];

export default function ClientLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-primary-700">
        <div className="text-2xl font-black text-white">
          Tax<span className="text-gold-500">Mate</span>
        </div>
        <div className="text-primary-300 text-xs mt-0.5">Client Portal</div>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto px-2">
        {nav.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-gold-500 text-primary-900 font-semibold'
                  : 'text-primary-200 hover:bg-primary-700 hover:text-white'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-primary-700">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-gold-500 flex items-center justify-center text-primary-900 font-bold text-sm flex-shrink-0">
            {profile?.full_name?.[0] ?? 'C'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs font-semibold truncate">{profile?.full_name ?? 'Client'}</div>
            <div className="text-primary-400 text-xs">Client Account</div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-primary-300 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-primary-700 w-full transition-colors"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className="hidden md:flex flex-col w-56 lg:w-64 bg-primary-800 flex-shrink-0">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-primary-800 z-50 flex flex-col">
            <div className="absolute top-4 right-4">
              <button onClick={() => setOpen(false)} className="text-primary-300 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setOpen(true)} className="md:hidden text-gray-500 hover:text-gray-700">
            <Menu size={20} />
          </button>
          <div className="md:hidden text-lg font-black text-primary-700">
            Tax<span className="text-gold-500">Mate</span>
          </div>
          <div className="flex-1" />
          <div className="text-xs text-gray-500 hidden sm:block">
            Welcome, {profile?.full_name?.split(' ')[0] ?? 'Client'}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
