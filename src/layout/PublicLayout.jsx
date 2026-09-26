import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Menu, X, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { roleBasePath } from '../lib/nav';

export function PublicLayout() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const goDashboard = () => {
    if (user) {
      navigate(roleBasePath(profile?.role));
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="SchoolRunner home">
            <Logo size="sm" />
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-600">
              Features
            </a>
            <a href="#roles" className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-600">
              For Schools
            </a>
            <a href="#footer" className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-600">
              Contact
            </a>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {user ? (
              <button type="button" onClick={goDashboard} className="btn-secondary">
                Open Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">
                  Sign in
                </Link>
                <Link to="/apply" className="btn-primary">
                  Apply Now
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((m) => !m)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>

        {menuOpen ? (
          <div className="border-t border-slate-100 bg-white px-4 py-4 md:hidden">
            <nav className="flex flex-col gap-1">
              <a href="#features" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Features
              </a>
              <a href="#roles" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                For Schools
              </a>
              {user ? (
                <button type="button" onClick={goDashboard} className="btn-primary mt-2 w-full">
                  Open Dashboard
                </button>
              ) : (
                <>
                  <Link to="/login" className="btn-secondary mt-2 w-full">
                    Sign in
                  </Link>
                  <Link to="/apply" className="btn-primary mt-2 w-full">
                    Apply Now
                  </Link>
                </>
              )}
            </nav>
          </div>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer id="footer" className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row">
            <div className="max-w-sm">
              <Logo size="sm" />
              <p className="mt-4 text-sm leading-relaxed text-slate-500">
                The complete admission and school management platform. Streamline applications,
                fees, attendance and results from one place.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
              <div>
                <p className="text-sm font-bold text-slate-800">Platform</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-500">
                  <li>
                    <Link to="/apply" className="hover:text-brand-600">
                      Apply for Admission
                    </Link>
                  </li>
                  <li>
                    <Link to="/login" className="hover:text-brand-600">
                      Student Portal
                    </Link>
                  </li>
                  <li>
                    <Link to="/login" className="hover:text-brand-600">
                      School Portal
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Resources</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-500">
                  <li>
                    <Link to="/verify-receipt" className="hover:text-brand-600">
                      Verify Receipt
                    </Link>
                  </li>
                  <li>
                    <Link to="/school-onboarding" className="hover:text-brand-600">
                      Register My School
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Security</p>
                <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                  <ShieldCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
                  RLS-protected data
                </p>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
            <p>
              SchoolRunner Student Admission Portal. Powered by Supabase, SMS notifications and
              secure cloud storage.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}