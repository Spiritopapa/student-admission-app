import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { roleBasePath } from '../../lib/nav';
import { Logo } from '../../components/Logo';
import { Button, Input } from '../../components/ui';
import { Alert } from '../../components/ui-extras';

export default function Login() {
  const { signIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Enter your ID or email and password to continue.');
      return;
    }
    setBusy(true);
    try {
      const result = await signIn(identifier, password);
      toast.success('Welcome back', `Signed in as ${result.profile?.full_name || 'a member'}.`);
      const from = location.state?.from;
      const roleHome = roleBasePath(result.profile?.role);
      navigate(from && from !== '/login' ? from : roleHome, { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-[80vh] max-w-7xl items-center justify-center px-4 py-14 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-8">
          <div className="flex flex-col items-center text-center">
            <Logo size="md" />
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign in with your email or registration ID.
            </p>
          </div>

          {error ? (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              label="Email or Registration ID"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. you@school.com or TCH-0001"
            />
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="input pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <Link to="/forgot-password" className="font-semibold text-brand-600 hover:text-brand-700">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" loading={busy} className="w-full" size="lg">
              {!busy ? <LogIn className="h-4 w-4" aria-hidden="true" /> : null}
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            New to SchoolRunner?{' '}
            <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">
              Register an account
            </Link>
          </p>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-6 text-center text-xs leading-relaxed text-slate-400"
        >
          Students sign in with their Student ID (e.g. STU-XXXXX).
          <br />
          Staff sign in with their Teacher or Accountant registration ID.
        </motion.p>
      </motion.div>
    </div>
  );
}