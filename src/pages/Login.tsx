import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Loader2, Lock, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

type View = 'login' | 'forgot' | 'forgot-sent';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Sign in ────────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError(error);
    else navigate('/');
  };

  // ── Send reset email ───────────────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setView('forgot-sent');
  };

  const switchToForgot = () => { setError(null); setView('forgot'); };
  const switchToLogin  = () => { setError(null); setView('login'); };

  return (
    <div className="min-h-screen bg-page-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src="/logo.png"
            alt="IME Logo"
            className="w-14 h-14"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <h1 className="text-2xl font-bold text-sidebar tracking-tight">IME Platform</h1>
          <p className="text-sm text-gray-500">
            {view === 'login' ? 'Sign in to your account' : 'Reset your password'}
          </p>
        </div>

        {/* ── Login form ── */}
        {view === 'login' && (
          <form
            onSubmit={handleSignIn}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col gap-5"
          >
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="email">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-700" htmlFor="password">Password</label>
                <button
                  type="button"
                  onClick={switchToForgot}
                  className="text-xs text-primary hover:text-primary-light font-medium transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── Forgot password form ── */}
        {view === 'forgot' && (
          <form
            onSubmit={handleResetPassword}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col gap-5"
          >
            <p className="text-sm text-gray-500 leading-relaxed">
              Enter your account email and we'll send you a link to reset your password.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="reset-email">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
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
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={switchToLogin}
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={14} /> Back to Sign In
            </button>
          </form>
        )}

        {/* ── Email sent confirmation ── */}
        {view === 'forgot-sent' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-5 text-center">
            <CheckCircle2 size={40} className="text-green-500" />
            <div>
              <p className="text-base font-semibold text-gray-900">Check your email</p>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                We sent a password reset link to <strong className="text-gray-700">{email}</strong>.
                The link expires in 1 hour.
              </p>
            </div>
            <button
              type="button"
              onClick={switchToLogin}
              className="flex items-center gap-1.5 text-sm text-primary hover:text-primary-light font-medium transition-colors"
            >
              <ArrowLeft size={14} /> Back to Sign In
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} IME — All rights reserved
        </p>
      </div>
    </div>
  );
}
