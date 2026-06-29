import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { signUp, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create account"
      subtitle="Create an account to start tracking shared budgets."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/40"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={6}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/40"
            placeholder="At least 6 characters"
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/40"
            placeholder="Repeat password"
          />
        </div>

        {error ? (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-indigo-500/20"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Creating account…
            </>
          ) : (
            'Create account'
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
