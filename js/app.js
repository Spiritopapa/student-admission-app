/**
 * Student Admission Portal v3 — Main Entry Point
 * Modular architecture with ES6 modules
 * 
 * This file serves as the application bootstrap.
 * All modules are initialized here and their event listeners set up.
 */

import supabaseClient from './supabase-config.js';
import { initAuth, setupRegisterStudentForm, setupRegisterParentForm, setupRegisterSchoolForm, setupRegisterTeacherForm, setupRegisterSubAdminForm, setupRegisterAccountantForm, setupRegisterSuperAdminForm, setupLoginForm, initSession, checkAndGuardSuperAdminRegistration } from './modules/auth.js';
import { initNavigation } from './modules/navigation.js';
import { initAdminStudents, setupAdmitForm, setupStudentSearchListeners, setupEditStudent, setupPrintClassList, setupPromoteClass, ensureAdmitClassDropdown, renderAdminSubStudentsTable, setupStudentCSVHandlers } from './modules/admin-students.js';
import { initAdminDashboard, loadAdminDashboardHome, refreshDashboardData, cleanupDashboardRealtime, setupAdminPasswordChange } from './modules/admin-dashboard.js';
import { initAdminSearch, setupAdminSearch, refreshSearchCache } from './modules/admin-search.js';
import { initAdminClasses, setupClassForm, renderClassesTable } from './modules/admin-classes.js';
import { initAdminSubjects, setupSubjectForm, renderSubjectsTable } from './modules/admin-subjects.js';
import { initAdminTeachers, setupTeacherForm, renderTeachersTable } from './modules/admin-teachers.js';
import { initAdminParents, setupParentListeners, renderParentsTable } from './modules/admin-parents.js';
import { initAdminAnnouncements, setupAnnouncementForm, renderAnnouncementsList } from './modules/admin-announcements.js';
import { initAdminAttendance, setupAttendanceListeners, loadAttendancePage } from './modules/admin-attendance.js';
import { initAdminExams, setupExamListeners } from './modules/admin-exams.js';
import { initAdminGrading, setupGradingListeners, loadGradingPage } from './modules/admin-grading.js';
import { initAdminFees, setupFeesListeners, loadFeesPage } from './modules/admin-fees.js';
import { initStudentDashboard, setupStudentDashboard, loadStudentDashboard } from './modules/student-dashboard.js';
import { initParentDashboard, loadParentDashboard } from './modules/parent-dashboard.js';
import { initSuperAdmin, setupSuperAdmin, loadSuperAdminDashboard } from './modules/super-admin.js';
import { initAdminAccountants, setupAccountantForm, renderAccountantsTable } from './modules/admin-accountants.js';
import { initTeacherDashboard, setupTeacherDashboard, loadTeacherDashboard } from './modules/teacher-dashboard.js';
import { initBackupRestore, setupBackupRestore } from './modules/backup-restore.js';
import { initAccountantDashboard, setupAccountantDashboard, loadAccountantDashboard } from './modules/accountant-dashboard.js';
import { initIncomeExpenses, loadIncomeExpensesPage } from './modules/income-expenses.js';
import { initSmsMonitor, loadSmsMonitorPage } from './modules/admin-sms-monitor.js';
import { initAdminAssessments, setupAdminAssessments, loadAdminAssessmentsPage } from './modules/admin-assessments.js';
import { initTeacherAssessments, setupTeacherAssessments } from './modules/teacher-assessments.js';
import { initAssessmentTaking } from './modules/assessment-taking.js';
import { getEl, initActivityLogger, initSchoolIdHelper, clearSchoolIdCache, applyTableLabels } from './modules/utils.js';
import { injectAppIcons, initIconInjector, svgIcon } from './modules/icons.js';
import { startRealtimeSubscriptions, stopRealtimeSubscriptions } from './modules/realtime.js';
import { setupForgotPassword } from './modules/forgot-password.js';
import { initSupportReports, setupSupportReports } from './modules/support-reports.js';

// ================================================================
// Expose supabaseClient globally for non-module scripts
// ================================================================

window.supabaseClient = supabaseClient;

// ================================================================
// Initialize All Modules
// ================================================================

function initAllModules() {
  initActivityLogger(supabaseClient);
  initSchoolIdHelper(supabaseClient);
  initAuth(supabaseClient);
  initAdminStudents(supabaseClient);
  initAdminDashboard(supabaseClient);
  initAdminSearch(supabaseClient);
  initAdminClasses(supabaseClient);
  initAdminSubjects(supabaseClient);
  initAdminTeachers(supabaseClient);
  initAdminParents(supabaseClient);
  initAdminAnnouncements(supabaseClient);
  initAdminAttendance(supabaseClient);
  initAdminExams(supabaseClient);
  initAdminGrading(supabaseClient);
  initStudentDashboard(supabaseClient);
  initParentDashboard(supabaseClient);
  initSuperAdmin(supabaseClient);
  initAdminAccountants(supabaseClient);
  initTeacherDashboard(supabaseClient);
  initAccountantDashboard(supabaseClient);
  initIncomeExpenses(supabaseClient);
  initAdminFees(supabaseClient);
  initBackupRestore(supabaseClient);
  initSmsMonitor(supabaseClient);
  initAdminAssessments(supabaseClient);
  initTeacherAssessments(supabaseClient);
  initAssessmentTaking(supabaseClient);
  initSupportReports(supabaseClient);
}

// ================================================================
// Show Page (wrapping navigation module)
// ================================================================

import { showPage } from './modules/navigation.js';

// ================================================================
// Load Admin Dashboard (combines old stats + new animated cards)
// ================================================================

window.loadAdminDashboard = async function loadAdminDashboard() {
  const dashTitle = getEl('adminDashTitle');
  if (dashTitle) dashTitle.innerHTML = `${svgIcon('crown')} Admin Dashboard`;

  // Show the home overview and hide any previously active module panel,
  // so the sticky sidebar + dashboard shell stay in view.
  const homeContent = getEl('adminDashboardContent');
  if (homeContent) homeContent.style.display = '';
  const dashHeader = getEl('adminDashHeader');
  if (dashHeader) dashHeader.style.display = '';
  document.querySelectorAll('#page-admin-dashboard .admin-module-panel').forEach((p) => p.classList.remove('active-page'));
  const dashBtn = document.querySelector('#adminSidebar .dash-nav-link[data-admin-page="dashboard"]');
  if (dashBtn) {
    document.querySelectorAll('#adminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
    dashBtn.classList.add('active');
  }

  // Call the new animated dashboard home
  await loadAdminDashboardHome();
};

// Expose loadAdminDashboardHome globally so admin-students can trigger dashboard refresh
window.loadAdminDashboardHome = loadAdminDashboardHome;

// ================================================================
// Setup All Event Listeners
// ================================================================

function setupAllListeners() {
  initNavigation();
  setupForgotPassword();
  setupRegisterStudentForm();
  setupRegisterSchoolForm();
  setupRegisterTeacherForm();
  setupRegisterParentForm();
  setupRegisterSubAdminForm();
  setupRegisterAccountantForm();
  setupRegisterSuperAdminForm();
  setupLoginForm({
    showPage,
    loadAdminDashboard,
    loadStudentDashboard,
    loadParentDashboard,
    loadSuperAdminDashboard,
    loadTeacherDashboard,
    loadAccountantDashboard,
  });
  setupAdmitForm();
  setupStudentSearchListeners();
  setupEditStudent();
  setupPrintClassList();
  setupPromoteClass();
  setupClassForm();
  setupSubjectForm();
  setupTeacherForm();
  setupParentListeners();
  setupAnnouncementForm();
  setupAttendanceListeners();
  setupExamListeners();
  setupStudentDashboard();
  setupSuperAdmin();
  setupAccountantForm();
  setupTeacherDashboard();
  setupBackupRestore();
  setupAccountantDashboard();
  setupGradingListeners();
  setupFeesListeners();
  setupStudentCSVHandlers();
  setupAdminPasswordChange();
  setupAdminSearch();
  setupAdminAssessments();
  setupTeacherAssessments();
  setupEmailButtonMobileBehavior();
  setupSupportReports();
}

// ================================================================
// Mobile Email Buttons — Open the Gmail App (fallback: default email app)
// ================================================================

/**
 * On the mobile view, tapping an email button tries to open the Gmail app
 * straight into a compose window via the Gmail URI scheme. If Gmail is not
 * installed, it falls back to the device's default email app using a mailto:
 * link. On desktop the original Gmail-web compose link is kept as-is.
 */
function setupEmailButtonMobileBehavior() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('a.email-admin-btn');
    if (!btn || !btn.href) return;

    // Only intercept in the mobile view (small screen or touch device).
    const isMobileView =
      (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (!isMobileView) return; // Desktop: keep existing Gmail-web link behaviour

    e.preventDefault();

    let email = 'boahengeeman@gmail.com';
    try {
      email = new URL(btn.href).searchParams.get('to') || email;
    } catch (err) { /* keep the default address */ }

    openGmailAppWithMailtoFallback(email);
  });
}

/**
 * Attempts to launch the installed Gmail app (compose window) and, when the
 * app is not available, opens the default email app instead via mailto:.
 */
function openGmailAppWithMailtoFallback(email) {
  const mailtoUrl = 'mailto:' + email;
  const encEmail = encodeURIComponent(email);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  // Gmail app URI schemes: gmail:// on Android, googlegmail:// on iOS.
  const gmailUrl = isIOS
    ? 'googlegmail:///co?to=' + encEmail
    : 'gmail://co?to=' + encEmail;

  let settled = false;
  let timer = null;

  const onVisibilityChange = () => {
    if (document.hidden) onLaunchDetected();
  };

  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', onLaunchDetected);
  };

  // If the Gmail app launches, this page is pushed into the background and we
  // detect that here so the mailto fallback is never triggered afterwards.
  const onLaunchDetected = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  const openDefaultEmailApp = () => {
    if (settled) return;
    settled = true;
    cleanup();
    // Gmail is not installed / could not launch → default email app.
    window.location.href = mailtoUrl;
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onLaunchDetected);
  timer = setTimeout(openDefaultEmailApp, 700);

  // Launch the Gmail app from a hidden anchor click so the page itself never
  // navigates away if the scheme is unsupported or Gmail is not installed.
  const launchLink = document.createElement('a');
  launchLink.href = gmailUrl;
  launchLink.setAttribute('style', 'display:none;');
  launchLink.setAttribute('aria-hidden', 'true');
  launchLink.tabIndex = -1;
  document.body.appendChild(launchLink);
  launchLink.click();
  // Discard the helper element shortly after; the fallback timer above is the
  // source of truth for retrying with the default email app.
  setTimeout(() => {
    if (launchLink.parentNode) launchLink.parentNode.removeChild(launchLink);
  }, 3000);
}

// ================================================================
// Admin Sidebar Navigation
// ================================================================

function setupAdminSidebar() {
  document.querySelectorAll('#adminSidebar .dash-nav-link[data-admin-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-admin-page');
      document.querySelectorAll('#adminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadAdminSubPage(page);
    });
  });
  
  // Filter sidebar based on locked modules for this school
  filterAdminSidebarByLockedModules();
}

/**
 * Fetches the locked modules for the current admin's school and hides
 * those sidebar nav items so the admin cannot access locked features.
 */
async function filterAdminSidebarByLockedModules() {
  try {
    // Get the admin's school_id
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await supabaseClient.from('profiles')
      .select('school_id, role')
      .eq('id', user.id)
      .single();
    
    if (!profile || !profile.school_id) return;
    // Only apply filtering for admin/school role (not super_admin)
    if (profile.role !== 'admin' && profile.role !== 'sub_admin') return;
    
    // Fetch locked modules for this school
    const { data: lockedModules } = await supabaseClient
      .from('school_modules')
      .select('module_name')
      .eq('school_id', profile.school_id)
      .eq('is_locked', true);
    
    const lockedNames = new Set((lockedModules || []).map(m => m.module_name));
    
    // First, reset all sidebar buttons and page sections to visible
    document.querySelectorAll('#adminSidebar .dash-nav-link[data-admin-page]').forEach((btn) => {
      btn.style.display = '';
    });
    document.querySelectorAll('.page[id^="page-admin-"]').forEach((page) => {
      page.style.display = '';
    });
    
    // Hide sidebar buttons for locked modules
    document.querySelectorAll('#adminSidebar .dash-nav-link[data-admin-page]').forEach((btn) => {
      const page = btn.getAttribute('data-admin-page');
      if (lockedNames.has(page)) {
        btn.style.display = 'none';
      }
    });
    
    // Also hide page sections for locked modules (as a secondary guard)
    lockedNames.forEach(name => {
      const pageEl = getEl('page-admin-' + name);
      if (pageEl) {
        pageEl.style.display = 'none';
      }
    });
  } catch (err) {
    console.warn('Failed to filter sidebar by locked modules:', err);
    // Non-critical, silently fail
  }
}

// Expose globally so realtime module can re-filter the sidebar when module locks change
window.filterAdminSidebarByLockedModules = filterAdminSidebarByLockedModules;

/** Icon shown next to each admin sub-page heading. */
const ADMIN_PAGE_ICONS = {
  students: 'users',
  classes: 'school',
  subjects: 'book-open',
  teachers: 'users',
  accountants: 'receipt',
  parents: 'parents',
  admit: 'user-plus',
  announcements: 'megaphone',
  attendance: 'clipboard',
  exams: 'file-text',
  assessments: 'clipboard-check',
  grading: 'chart',
  fees: 'coins',
  'income-expenses': 'trending-up',
  'sms-monitoring': 'message-square',
  backup: 'archive',
  profile: 'key',
};

async function loadAdminSubPage(page) {
  // Keep the clicked sidebar button highlighted
  document.querySelectorAll('#adminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
  const dashBtn = document.querySelector(`#adminSidebar .dash-nav-link[data-admin-page="${page}"]`);
  if (dashBtn) dashBtn.classList.add('active');

  // Check if this page/module is locked - redirect to the first available module if so
  const isHidden = document.querySelector(`#adminSidebar .dash-nav-link[data-admin-page="${page}"]`)?.style?.display === 'none';
  if (isHidden) {
    // Redirect to the first available (non-locked) page
    const firstVisible = document.querySelector('#adminSidebar .dash-nav-link[data-admin-page]:not([style*="display: none"])');
    if (firstVisible) {
      firstVisible.click();
    }
    return;
  }

  const shell = getEl('page-admin-dashboard');
  if (shell) {
    // Keep the dashboard shell (sticky sidebar + right-hand content area) as the active page
    document.querySelectorAll('section.page').forEach((p) => p.classList.remove('active-page'));
    shell.classList.add('active-page');
  }

  // Hide every module panel before revealing the requested one
  document.querySelectorAll('#page-admin-dashboard .admin-module-panel').forEach((p) => p.classList.remove('active-page'));

  const homeContent = getEl('adminDashboardContent');
  const dashHeader = getEl('adminDashHeader');
  const titleEl = getEl('adminDashTitle');

  // "Dashboard" shows the home overview inside the right-hand content area
  if (page === 'dashboard') {
    if (homeContent) homeContent.style.display = '';
    if (dashHeader) dashHeader.style.display = '';
    if (titleEl) titleEl.innerHTML = `${svgIcon('crown')} Admin Dashboard`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadAdminDashboardHome();
    return;
  }

  // Hide the home overview while a module panel is showing
  if (homeContent) homeContent.style.display = 'none';
  if (dashHeader) dashHeader.style.display = 'none';

  const map = {
    students: { id: 'page-admin-students', title: 'All Students' },
    classes: { id: 'page-admin-classes', title: 'Classes' },
    subjects: { id: 'page-admin-subjects', title: 'Subjects' },
    teachers: { id: 'page-admin-teachers', title: 'Teachers' },
    accountants: { id: 'page-admin-accountants', title: 'Accountants' },
    parents: { id: 'page-admin-parents', title: 'Parents / Guardians' },
    admit: { id: 'page-admin-admit', title: 'Admit Student' },
    announcements: { id: 'page-admin-announcements', title: 'Announcements' },
    attendance: { id: 'page-admin-attendance', title: 'Attendance Management' },
    exams: { id: 'page-admin-exams', title: 'Examinations' },
    assessments: { id: 'page-admin-assessments', title: 'Multi-Choice Assessments' },
    grading: { id: 'page-admin-grading', title: 'Grading System' },
    fees: { id: 'page-admin-fees', title: 'Fees Management' },
    'income-expenses': { id: 'page-admin-income-expenses', title: 'Income & Expenses' },
    'sms-monitoring': { id: 'page-admin-sms-monitoring', title: 'SMS Monitoring' },
    backup: { id: 'page-admin-backup', title: 'Backup & Restore' },
    profile: { id: 'page-admin-profile', title: 'Change Password' },
  };
  const targetPage = getEl(map[page]?.id);
  if (targetPage) targetPage.classList.add('active-page');
  if (titleEl && map[page]?.title) {
    titleEl.innerHTML = `${svgIcon(ADMIN_PAGE_ICONS[page] || 'home')} ${map[page].title}`;
  }
  switch (page) {
    case 'students': await renderAdminSubStudentsTable(); break;
    case 'classes': await renderClassesTable(); break;
    case 'subjects': await renderSubjectsTable(); break;
    case 'teachers': await renderTeachersTable(); break;
    case 'accountants': await renderAccountantsTable(); break;
    case 'parents': await renderParentsTable(); break;
    case 'announcements': await renderAnnouncementsList(); break;
    case 'attendance': await loadAttendancePage(); break;
    case 'exams': { const m = await import('./modules/admin-exams.js'); await m.renderExamsTable(); } break;
    case 'assessments': await loadAdminAssessmentsPage(); break;
    case 'grading': await loadGradingPage(); break;
    case 'fees': await loadFeesPage(); break;
    case 'income-expenses': {
      const { loadIncomeExpensesPage } = await import('./modules/income-expenses.js');
      await loadIncomeExpensesPage();
      break;
    }
    case 'sms-monitoring': {
      await loadSmsMonitorPage();
      break;
    }
    case 'admit': await ensureAdmitClassDropdown(); break;
    case 'profile': break; // Password change form is static HTML; no dynamic load needed
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Expose globally so navigation.js can open a module page while keeping the sidebar visible
window.loadAdminSubPage = loadAdminSubPage;

/**
 * Moves every admin module page (students, classes, fees, ...) into the
 * dashboard's right-hand content area. This keeps the left sidebar sticky
 * and visible while each module's content swaps in on the right.
 */
function nestAdminModulePages() {
  const shell = getEl('page-admin-dashboard');
  const dashMain = shell ? shell.querySelector('.dash-main') : null;
  if (!dashMain) return;
  document.querySelectorAll('section.page[id^="page-admin-"]').forEach((section) => {
    if (section.id === 'page-admin-dashboard') return; // skip the shell itself
    section.classList.add('admin-module-panel');
    dashMain.appendChild(section);
  });
}

// ================================================================
// Init App
// ================================================================

async function initApp() {
  // Nest admin module pages inside the dashboard's content area FIRST so the
  // sticky left sidebar stays visible while modules swap in on the right.
  nestAdminModulePages();
  initAllModules();
  setupAllListeners();
  setupAdminSidebar();

  // Inject modern SVG icons (sidebars, welcome cards, headings, buttons…)
  // and keep them applied as dynamic content renders.
  initIconInjector();

  // Initialize session
  await initSession({
    loadAdminDashboard,
    loadStudentDashboard,
    loadParentDashboard,
    loadSuperAdminDashboard,
    loadTeacherDashboard,
    loadAccountantDashboard,
  });

  // After session is established, filter the admin sidebar for locked modules
  await filterAdminSidebarByLockedModules();

  // Start real-time subscriptions after session is established
  // The subscription will listen for changes on all key tables and
  // automatically refresh the UI when data changes
  startRealtimeSubscriptions(supabaseClient);

  // Refresh search cache when data changes
  window.addEventListener('data-updated', () => {
    refreshSearchCache();
  });

  // Listen for auth state changes to stop/restart subscriptions
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      stopRealtimeSubscriptions();
      cleanupDashboardRealtime();
      // CRITICAL SECURITY: Clear the search cache on logout to prevent
      // cross-user data leakage when a different user logs in.
      refreshSearchCache();
      // Reset sidebar visibility on logout
      document.querySelectorAll('#adminSidebar .dash-nav-link[data-admin-page]').forEach((btn) => {
        btn.style.display = '';
      });
      // Reset page visibility
      document.querySelectorAll('.page[id^="page-admin-"]').forEach((page) => {
        page.style.display = '';
      });
    } else if (event === 'SIGNED_IN') {
      // CRITICAL SECURITY: Force refresh the search cache on sign in
      // to ensure the new user only sees their own school's data.
      refreshSearchCache();
      // Restart subscriptions on sign in (they might have been stopped)
      startRealtimeSubscriptions(supabaseClient);
      // Re-filter sidebar on sign in
      filterAdminSidebarByLockedModules();
    }
  });

  // Check if super admin already exists and guard the registration tab
  await checkAndGuardSuperAdminRegistration();

  // Apply data-label attributes to all tables for mobile stacked card layout
  applyTableLabels();

  // Re-apply table labels when tables are dynamically updated
  const tableObserver = new MutationObserver(() => {
    applyTableLabels();
  });
  tableObserver.observe(document.body, { childList: true, subtree: true });
}

// ================================================================
// DOM Ready
// ================================================================

document.addEventListener('DOMContentLoaded', initApp);