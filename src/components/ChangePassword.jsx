import { useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function ChangePassword() {
  const { user, profile } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error('Password must be at least 8 characters');
    if (pw !== pw2) return toast.error('The two passwords do not match');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPw(''); setPw2('');
    toast.success('Password changed');
  };
  return (
    <form onSubmit={save} className="card p-5 space-y-3 self-start">
      <h3 className="font-semibold text-primary-800">Change my password</h3>
      <p className="text-xs text-gray-500">Signed in as <strong>{user?.email}</strong>{profile?.role ? ` (${profile.role})` : ''}.</p>
      <input type="password" className="input" placeholder="New password (min 8 characters)" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
      <input type="password" className="input" placeholder="Repeat new password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
      <button type="submit" disabled={busy} className="btn-primary"><Save size={15} /> {busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}
