import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Logo } from '../components/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <Logo size="md" />
      <div className="mt-10 flex flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-blend-soft text-white shadow-card">
          <Compass className="h-10 w-10" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900">404</h1>
        <p className="mt-2 text-slate-500">The page you are looking for does not exist.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="btn-primary">
            Back to home
          </Link>
          <Link to="/login" className="btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}