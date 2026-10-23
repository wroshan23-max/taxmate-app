import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { LogIn, Eye, EyeOff, Globe } from 'lucide-react';
import { FIRM, websiteUrl, websiteLabel } from '../lib/iitStatement';
import { waNumber } from '../lib/share';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activity';

export default function Login() {
  const { signIn, user, profile, loading: authLoading, isAdmin, isClient } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Go back to the page that sent the user here (e.g. a WhatsApp link to /client/assets)
  const from = location.state?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Redirect when auth state is ready
  useEffect(() => {
    if (!authLoading && user && profile) {
      if (isAdmin) navigate(from?.startsWith('/admin') ? from : '/admin', { replace: true });
      else if (isClient) navigate(from?.startsWith('/client') ? from : '/client', { replace: true });
    }
  }, [authLoading, user, profile, isAdmin, isClient, navigate, from]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error('Email හෝ Password වැරදියි — Email or password is incorrect');
    } else {
      // with two-step login the "login" is recorded after the code is entered
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel !== 'aal2') logActivity('login');
    }
    // Navigation handled by useEffect above when auth state updates
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl font-black text-white mb-1">
            Tax<span className="text-gold-500">Mate</span>
          </div>
          <div className="text-primary-200 text-sm font-medium">Solutions</div>
          <div className="text-primary-300 text-xs mt-2">Accounting & Tax Advisory</div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-primary-700 mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Email Address
              </label>
              <input
                type="email"
                className="input"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center mt-2"
            >
              <LogIn size={16} />
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <div className="mt-3 text-center">
            <a
              href={`https://wa.me/${waNumber(FIRM.whatsapp)}?text=${encodeURIComponent(`Hi ${FIRM.name}, I forgot my portal password. My email is: ${email || ''}`)}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-primary-600 hover:underline"
            >
              Forgot password? Ask {FIRM.name} on WhatsApp for a reset link
            </a>
          </div>

          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              {FIRM.name} · Accounting &amp; Tax Advisory
            </p>
            <p className="text-xs text-gray-400 mt-1">
              📞 {FIRM.phone} · {FIRM.email}
            </p>
            <a href={websiteUrl()} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline mt-2">
              <Globe size={12} /> {websiteLabel()}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
