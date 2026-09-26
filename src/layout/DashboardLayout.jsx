import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { NAV_BY_ROLE, roleBasePath } from '../lib/nav';
import { ROLE_LABELS } from '../lib/constants';
import { Logo } from '../components/Logo';
import { photoUrl } from '../lib/storage';

function compactRoleKey(role) {
  if (role === 'admin' || role === 'sub_admin') return 'admin';
  return role || 'student';
}

export function DashboardLayout() {
  const { profile, user, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const roleKey = compactRoleKey(profile?.role);
  const navItems = NAV_BY_ROLE[roleKey] || NAV_BY_ROLE.student;

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    toast.info('Signed out', 'You have been signed out successfully.');
    navigate('/login');
  };

  const avatarUrl = profile?.photo_url
    ? photoUrl(profile.photo_url)
    : profile?.avatar_url
      ? photoUrl(profile.avatar_url)
      : null;

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-3 px-5 py-5 ${collapsed ? 'justify-center px-2' : ''}`}>
        <Logo size="sm" />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === roleBasePath(roleKey)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-blend-soft text-white shadow-card'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              } ${collapsed ? 'justify-center px-2' : ''}`
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <button
          type="button"
          onClick={handleSignOut}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700 ${
            collapsed ? 'justify-center px-2' : ''
          }`}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200/70 bg-white transition-all duration-300 lg:block ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-20 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition-colors hover:text-brand-600 lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="absolute inset-y-0 left-0 w-72 bg-white shadow-2xl"
          >
            {sidebarContent}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </motion.aside>
        </div>
      ) : null}

      <div className={`transition-all duration-300 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="leading-tight">
                <p className="hidden text-sm font-semibold text-slate-800 sm:block">
                  Welcome back, {profile?.full_name?.split(' ')[0] || 'there'}
                </p>
                <p className="text-xs font-medium text-slate-400">
                  {ROLE_LABELS[profile?.role] || 'Member'}
                </p>
              </div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((m) => !m)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm transition-colors hover:border-brand-300"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    className="h-8 w-8 rounded-full object-cover ring-2 ring-brand-100"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blend text-xs font-bold text-white">
                    {(profile?.full_name || 'U').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate text-sm font-semibold text-slate-700 sm:block">
                  {profile?.full_name || 'User'}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-card"
                  >
                    <div className="border-b border-slate-100 px-4 py-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{user?.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}