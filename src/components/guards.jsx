import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';
import { photoUrl } from '../lib/storage';
import { ROLES } from '../lib/constants';
import { roleBasePath } from '../lib/nav';

export function AuthLoader() {
  const { loading, schoolBranding } = useAuth();
  if (!loading) return null;
  const logoUrl = schoolBranding?.logo_url ? photoUrl(schoolBranding.logo_url) : null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="School logo"
            className="img-zoom h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-card ring-1 ring-slate-200"
          />
        ) : (
          <div className="inline-flex items-center justify-center bg-blend p-4 text-white shadow-card">
            <span className="h-8 w-8 animate-pulse rounded-xl" />
          </div>
        )}
        {schoolBranding?.school_name ? (
          <p className="text-sm font-semibold text-slate-700">{schoolBranding.school_name}</p>
        ) : null}
        <Spinner label="Preparing your workspace..." />
      </div>
    </div>
  );
}

// Non-blocking indicator for BACKGROUND auth refreshes (token refresh, silent
// re-auth). The signed-in page stays mounted underneath so dialogs, filters,
// scroll position and form input are all retained — this pill only signals
// that the workspace is being prepared. pointer-events-none keeps every
// control clickable while it is visible.
export function AuthRefreshPill() {
  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[2147483000] flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-card backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden="true" />
      <span className="text-xs font-semibold text-slate-600">Preparing your workspace...</span>
    </div>
  );
}

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Full-screen loader only when there is no signed-in user to render for
  // (initial load / login transitions). During a background auth refresh the
  // current page stays MOUNTED so its state (dialogs, filters, scroll, form
  // input) is retained — only the small non-blocking pill is overlaid.
  if (loading && !user) return <AuthLoader />;
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  // When used as a layout route (<Route element={<ProtectedRoute />}> with nested
  // routes), children is undefined — the nested dashboard must render via <Outlet />.
  const content = children ?? <Outlet />;
  if (loading) {
    return (
      <>
        {content}
        <AuthRefreshPill />
      </>
    );
  }
  return content;
}

export function RoleRoute({ roles, children }) {
  const { profile, user, loading } = useAuth();
  // Full-screen loader only while there is no user/profile to render for;
  // a background auth refresh keeps the current page mounted (see
  // ProtectedRoute) so the page is never reset mid-task.
  if (loading && (!user || !profile)) return <AuthLoader />;
  if (!user) return <Navigate to="/login" replace />;
  const role = profile?.role;
  if (!roles.includes(role)) {
    const fallback = role === ROLES.ADMIN || role === ROLES.SUB_ADMIN
      ? '/admin'
      : role === ROLES.STUDENT
        ? '/dashboard'
        : role === ROLES.PARENT
          ? '/parent'
          : role === ROLES.TEACHER
            ? '/teacher'
            : role === ROLES.ACCOUNTANT
              ? '/accountant'
              : role === ROLES.SUPER_ADMIN
                ? '/superadmin'
                : '/login';
    return <Navigate to={fallback} replace />;
  }
  if (loading) {
    return (
      <>
        {children}
        <AuthRefreshPill />
      </>
    );
  }
  return children;
}

export function PublicOnlyRoute({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading && !user) return <AuthLoader />;
  if (user) {
    if (profile?.role) {
      // Signed-in user with a known role → send them to their role home.
      return <Navigate to={roleBasePath(profile.role)} replace />;
    }
    // Signed-in user with no resolvable role: NEVER fall through to a privileged
    // area, and do not bounce between /superadmin and /login. Land on the public
    // landing page instead.
    return <Navigate to="/" replace />;
  }
  return children;
}