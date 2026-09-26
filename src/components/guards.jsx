import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';
import { ROLES } from '../lib/constants';

export function AuthLoader() {
  const { loading } = useAuth();
  if (!loading) return null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="inline-flex items-center justify-center bg-blend p-4 text-white shadow-card">
          <span className="h-8 w-8 animate-pulse rounded-xl" />
        </div>
        <Spinner label="Preparing your workspace..." />
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoader />;
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

export function RoleRoute({ roles, children }) {
  const { profile, user, loading } = useAuth();
  if (loading) return <AuthLoader />;
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
  return children;
}

export function PublicOnlyRoute({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <AuthLoader />;
  if (user) {
    const role = profile?.role;
    const home = role === ROLES.ADMIN || role === ROLES.SUB_ADMIN
      ? '/admin'
      : role === ROLES.STUDENT
        ? '/dashboard'
        : role === ROLES.PARENT
          ? '/parent'
          : role === ROLES.TEACHER
            ? '/teacher'
            : role === ROLES.ACCOUNTANT
              ? '/accountant'
              : '/superadmin';
    return <Navigate to={home} replace />;
  }
  return children;
}