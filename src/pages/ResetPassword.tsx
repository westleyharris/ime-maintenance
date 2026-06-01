import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, Lock, CheckCircle2 } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [ready, setReady]         = useState(false);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    // Supabase processes the recovery token from the URL hash and fires
    // a PASSWORD_RECOVERY event, then establishes a session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setReady(true);
      }
    });

    // Also check for an existing session in case the page is refreshed
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
    // Sign out so the user logs in fresh with the new password
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 2500);
  };

  // ── Waiting for token ──────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
          <p className="text-sm">Verifying reset link…</p>
        </div>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-5 text-center">
          <CheckCircle2 size={40} className="text-green-500" />
          <div>
            <p className="text-base font-semibold text-gray-900">Password updated</p>
            <p className="text-sm text-gray-500 mt-1.5">Redirecting you to sign in…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src="/logo.png"
            alt="IME Logo"
            className="w-14 h-14"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h1 className="text-2xl font-bold text-sidebar tracking-tight">IME Platform</h1>
          <p className="text-sm text-gray-500">Set a new password</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="new-password">
              New password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="confirm-password">
              Confirm password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-sidebar text-white text-sm font-semibold hover:bg-primary transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Saving…' : 'Update Password'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} IME — All rights reserved
        </p>
      </div>
    </div>
  );
}
