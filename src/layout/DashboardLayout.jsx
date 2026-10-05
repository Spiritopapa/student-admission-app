import { useMemo, useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, LifeBuoy, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { useSchoolSettings } from '../hooks/useSchool';
import { NAV_BY_ROLE, roleBasePath } from '../lib/nav';
import { supabase } from '../lib/supabase';
import { ROLE_LABELS } from '../lib/constants';
import { photoUrl } from '../lib/storage';
import { submitSupportReport } from '../lib/api';
import { Modal, Alert } from '../components/ui-extras';
import { Input, Select, Button } from '../components/ui';

function compactRoleKey(role) {
  if (role === 'admin' || role === 'sub_admin') return 'admin';
  return role || 'student';
}

// Maps the module names stored in `modules` / `school_modules` to the React
// admin dashboard routes they gate. When the Super Admin locks a module for a
// school, those routes are hidden from that school's sidebar (and users are
// redirected away from an already-open locked page).
const MODULE_PATH_MAP = {
  students: ['/admin/students'],
  classes: ['/admin/classes'],
  subjects: ['/admin/subjects'],
  teachers: ['/admin/teachers'],
  accountants: ['/admin/accountants'],
  parents: ['/admin/parents'],
  attendance: ['/admin/attendance'],
  exams: ['/admin/exams'],
  grading: ['/admin/grading'],
  fees: ['/admin/fees'],
  assessments: ['/admin/assessments'],
  'income-expenses': ['/admin/income-expenses'],
  'sms-monitoring': ['/admin/sms-monitoring'],
  settings: ['/admin/settings'],
  transport: ['/admin/transport'],
  backup: ['/admin/backup'],
};

export function DashboardLayout() {
  const { profile, user, signOut } = useAuth();
  const { settings: schoolSettings } = useSchoolSettings();
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [supportOpen, setSupportOpen] = useState(false);
  const [supportForm, setSupportForm] = useState({ type: 'bug', subject: '', details: '' });
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState('');

  const submitSupport = async () => {
    setSupportError('');
    if (!supportForm.subject.trim() || !supportForm.details.trim()) {
      setSupportError('Please complete the subject and message fields.');
      return;
    }
    setSupportBusy(true);
    try {
      await submitSupportReport({
        type: supportForm.type,
        subject: supportForm.subject.trim(),
        details: supportForm.details.trim(),
      });
      toast.success('Report sent', `Your ${supportForm.type === 'bug' ? 'bug report' : 'suggestion'} has been sent to the Super Admin.`);
      setSupportOpen(false);
      setSupportForm({ type: 'bug', subject: '', details: '' });
    } catch (err) {
      setSupportError(err.message || 'Could not submit the report.');
    } finally {
      setSupportBusy(false);
    }
  };

  const roleKey = compactRoleKey(profile?.role);
  const [lockedModuleNames, setLockedModuleNames] = useState([]);

  // Fetch the modules locked for this school so the sidebar can hide them
  // (used by the /dashboard layout for school admins and sub-admins).
  useEffect(() => {
    if (roleKey !== 'admin' || !profile?.school_id) {
      setLockedModuleNames([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('school_modules')
      .select('module_name')
      .eq('school_id', profile.school_id)
      .eq('is_locked', true)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setLockedModuleNames((data || []).map((r) => r.module_name));
      });
    return () => {
      cancelled = true;
    };
  }, [roleKey, profile?.school_id]);

  const lockedPaths = useMemo(
    () => new Set(lockedModuleNames.flatMap((name) => MODULE_PATH_MAP[name] || [])),
    [lockedModuleNames]
  );

  const navItems = (NAV_BY_ROLE[roleKey] || NAV_BY_ROLE.student).filter(
    (item) => !lockedPaths.has(item.path)
  );

  // If this user is already on a page that has just been locked, send them back
  // to their role overview instead of leaving the page rendered.
  useEffect(() => {
    if (lockedPaths.has(location.pathname)) {
      navigate(roleBasePath(roleKey), { replace: true });
    }
  }, [lockedPaths, location.pathname, roleKey, navigate]);

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

  // Large school identity block in the sidebar (all dashboards share this
  // layout): the school's uploaded logo when available, otherwise an initials
  // avatar on the signature blend, plus the school name.
  const schoolName = schoolSettings?.school_name || 'My School';
  const schoolLogoUrl = schoolSettings?.logo_url ? photoUrl(schoolSettings.logo_url) : '';
  const schoolInitial = (schoolName || 'S').trim().charAt(0).toUpperCase();

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-3 px-5 py-5 ${collapsed ? 'justify-center px-2' : ''}`}>
        {schoolLogoUrl ? (
          <img
            src={schoolLogoUrl}
            alt={`${schoolName} logo`}
            className={`shrink-0 rounded-2xl bg-white object-contain p-1 ring-1 ring-slate-100 ${collapsed ? 'h-11 w-11' : 'h-14 w-14'}`}
          />
        ) : (
          <span
            className={`flex shrink-0 items-center justify-center rounded-2xl bg-blend text-xl font-extrabold text-white shadow-card ${collapsed ? 'h-11 w-11' : 'h-14 w-14'}`}
          >
            {schoolInitial}
          </span>
        )}
        {!collapsed ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-slate-800">{schoolName}</p>
            <p className="text-[11px] font-medium text-slate-400">SchoolRunner Portal</p>
          </div>
        ) : null}
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
          onClick={() => setSupportOpen(true)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700 ${
            collapsed ? 'justify-center px-2' : ''
          }`}
          title={collapsed ? 'Report a problem' : undefined}
        >
          <LifeBuoy className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!collapsed ? <span>Report a problem</span> : null}
        </button>
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-brand-300 hover:text-brand-600"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

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
                    className="img-zoom h-8 w-8 rounded-full object-cover ring-2 ring-brand-100"
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
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <Modal open={supportOpen} onClose={() => setSupportOpen(false)} title="Report a problem" subtitle="Tell the Super Admin about a bug or share a suggestion." size="sm">
        {supportError ? (
          <Alert tone="error" className="mb-4">
            {supportError}
          </Alert>
        ) : null}
        <div className="space-y-4">
          <Select label="Type" value={supportForm.type} onChange={(e) => setSupportForm((f) => ({ ...f, type: e.target.value }))}>
            <option value="bug">Bug report</option>
            <option value="suggestion">Suggestion</option>
          </Select>
          <Input
            label="Subject"
            value={supportForm.subject}
            onChange={(e) => setSupportForm((f) => ({ ...f, subject: e.target.value }))}
            placeholder="Short summary"
          />
          <div>
            <label className="label">Message</label>
            <textarea
              value={supportForm.details}
              onChange={(e) => setSupportForm((f) => ({ ...f, details: e.target.value }))}
              placeholder="What happened? What did you expect?"
              rows={4}
              className="input min-h-[100px]"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={() => setSupportOpen(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={submitSupport} loading={supportBusy} className="flex-1">
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Send report
          </Button>
        </div>
      </Modal>
    </div>
  );
}