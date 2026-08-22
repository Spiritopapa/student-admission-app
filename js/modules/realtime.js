/**
 * Real-Time Subscriptions Module
 *
 * Listens for INSERT / UPDATE / DELETE changes on key database tables
 * using Supabase Realtime channels and automatically refreshes the
 * currently visible UI — no page reload needed.
 *
 * Supports: students, fees, payments, attendance, announcements,
 *           classes, subjects, teachers, accountants, exams, settings,
 *           school_modules (module lock changes).
 */

import { getEl } from './utils.js';

// ================================================================
// Internal State
// ================================================================

let _supabase = null;
let _channel = null;
let _subscriptionTimers = {};

// ================================================================
// Table → Refresh Action Mapping
// ================================================================

/**
 * Map of table names to arrays of functions that should be called
 * when a change is detected on that table.
 *
 * Each entry: { pages: string[], refresh: string|Function }
 *   - pages: array of page section IDs where this refresh should run
 *   - refresh: function name (window scoped) or direct function reference to call
 */
const TABLE_ACTIONS = {
  applications: [
    {
      pages: ['page-admin-students', 'page-admin-dashboard', 'page-admin-admit',
              'page-teacher-dashboard', 'page-parent-dashboard',
              'page-admin-attendance'],
      refresh: 'loadAllStudents',
    },
    {
      pages: ['page-admin-dashboard'],
      refresh: 'loadAdminDashboardHome',
    },
    {
      pages: ['page-student-dashboard'],
      refresh: 'refreshStudentDashboard',
    },
  ],
  attendance: [
    {
      pages: ['page-admin-attendance', 'page-teacher-dashboard', 'page-student-dashboard',
              'page-parent-dashboard'],
      refresh: 'loadAttendancePage',
    },
  ],
  announcements: [
    {
      pages: ['page-admin-announcements', 'page-admin-dashboard'],
      refresh: 'refreshAnnouncements',
    },
  ],
  classes: [
    {
      pages: ['page-admin-classes', 'page-admin-students', 'page-admin-admit'],
      refresh: 'refreshClasses',
    },
  ],
  subjects: [
    {
      pages: ['page-admin-subjects', 'page-teacher-dashboard', 'page-student-dashboard'],
      refresh: 'refreshSubjects',
    },
  ],
  teachers: [
    {
      pages: ['page-admin-teachers'],
      refresh: 'refreshTeachers',
    },
  ],
   accountants: [
     {
       pages: ['page-admin-accountants'],
       refresh: 'refreshAccountants',
     },
   ],
   payment_transactions: [
     {
       pages: ['page-accountant-dashboard'],
       refresh: 'refreshAccountantTodayReceipts',
     },
   ],
   receipts: [
     {
       pages: ['page-accountant-dashboard'],
       refresh: 'refreshAccountantTodayReceipts',
     },
   ],
   income_expenses: [
     {
       pages: ['page-accountant-dashboard', 'page-admin-dashboard'],
       refresh: 'refreshIncomeExpenses',
     },
   ],
   income_expense_categories: [
     {
       pages: ['page-accountant-dashboard', 'page-admin-dashboard'],
       refresh: 'refreshIncomeExpenses',
     },
   ],
  exams: [
    {
      pages: ['page-admin-exams', 'page-teacher-dashboard', 'page-student-dashboard',
              'page-parent-dashboard'],
      refresh: 'renderExamsTable',
    },
  ],
  exam_results: [
    {
      pages: ['page-admin-exams'],
      refresh: 'refreshAdminExamWorkspace',
    },
    {
      pages: ['page-teacher-dashboard'],
      refresh: 'refreshTeacherExamWorkspace',
    },
    {
      pages: ['page-student-dashboard'],
      refresh: 'refreshStudentExamReport',
    },
  ],
  exam_student_details: [
    {
      pages: ['page-admin-exams'],
      refresh: 'refreshAdminExamWorkspace',
    },
    {
      pages: ['page-teacher-dashboard'],
      refresh: 'refreshTeacherExamWorkspace',
    },
  ],
  school_modules: [
    {
      pages: ['page-admin-dashboard'],
      refresh: 'loadAdminDashboardHome',
    },
  ],
};

// ================================================================
// Debounced Refresh
// ================================================================

/**
 * Calls a refresh function but debounces it so rapid successive
 * DB changes only trigger one re-render.
 */
function debouncedRefresh(refreshFn, key) {
  if (_subscriptionTimers[key]) {
    clearTimeout(_subscriptionTimers[key]);
  }
  _subscriptionTimers[key] = setTimeout(() => {
    try {
      if (typeof refreshFn === 'function') {
        refreshFn();
      } else if (typeof refreshFn === 'string' && typeof window[refreshFn] === 'function') {
        window[refreshFn]();
      }
    } catch (err) {
      console.warn(`[Realtime] Refresh error for "${key}":`, err.message);
    }
    delete _subscriptionTimers[key];
  }, 350); // 350ms debounce — smooth, no flicker
}

// ================================================================
// Page Activation Check
// ================================================================

/**
 * Check if any of the given page IDs are currently active.
 */
function isPageActive(pageIds) {
  return pageIds.some((id) => {
    const el = document.getElementById(id);
    return el && el.classList.contains('active-page');
  });
}

// ================================================================
// Handle a Table Change Event
// ================================================================

async function handleTableChange(table, eventType, newRecord, oldRecord) {
  const actions = TABLE_ACTIONS[table];
  if (!actions) return;

  // CRITICAL DATA ISOLATION: Only process events from the CURRENT USER's school
  try {
    const { getCurrentSchoolId } = await import('./utils.js');
    const schoolId = await getCurrentSchoolId();
    if (schoolId) {
      const recordSchoolId = newRecord?.school_id || oldRecord?.school_id;
      if (recordSchoolId && recordSchoolId !== schoolId) {
        // Skip events from other schools - data isolation
        return;
      }
    }
  } catch (err) {
    // If we can't determine school scope, skip the event to be safe
    return;
  }

  for (const action of actions) {
    if (!isPageActive(action.pages)) continue;

    let refreshFn = action.refresh;

    // Some refreshes need custom logic depending on which page is active
    if (table === 'applications' && refreshFn === 'loadAdminDashboardHome') {
      // Dashboard refresh uses the new real-time aware refreshDashboardData (exposed globally by app.js)
      debouncedRefresh(() => {
        if (typeof window.refreshDashboardData === 'function') {
          window.refreshDashboardData('realtime');
        } else {
          window.loadAdminDashboardHome();
        }
      }, `${table}-dashboard-${eventType}`);
      continue;
    }

    // For dashboard-specific refreshes from fees table
    if (table === 'fees' && refreshFn === 'loadAdminDashboardHome') {
      debouncedRefresh(() => {
        if (typeof window.refreshDashboardData === 'function') {
          window.refreshDashboardData('realtime');
        } else {
          window.loadAdminDashboardHome();
        }
      }, `${table}-dashboard-${eventType}`);
      continue;
    }

    // For school_modules changes, refresh the dashboard and re-filter the sidebar
    if (table === 'school_modules' && refreshFn === 'loadAdminDashboardHome') {
      debouncedRefresh(() => {
        if (typeof window.refreshDashboardData === 'function') {
          window.refreshDashboardData('realtime');
        } else {
          window.loadAdminDashboardHome();
        }
        // Re-filter the admin sidebar to show/hide locked module links
        if (typeof window.filterAdminSidebarByLockedModules === 'function') {
          window.filterAdminSidebarByLockedModules();
        }
      }, `${table}-dashboard-${eventType}`);
      continue;
    }

    if (typeof refreshFn === 'string') {
      debouncedRefresh(refreshFn, `${table}-${eventType}`);
    }
  }
}

// ================================================================
// Start / Stop Subscriptions
// ================================================================

/**
 * Creates a single Realtime channel that listens for changes
 * on all key tables. Call once after user is authenticated.
 */
export function startRealtimeSubscriptions(supabase) {
  _supabase = supabase;

  // Prevent duplicate subscriptions
  if (_channel) {
    console.log('[Realtime] Already subscribed.');
    return;
  }

  console.log('[Realtime] Starting live subscriptions...');

  // Build a single channel with filters for every table
  const tables = Object.keys(TABLE_ACTIONS);

  _channel = _supabase.channel('app-realtime-changes');

  for (const table of tables) {
    _channel.on(
      'postgres_changes',
      {
        event: '*', // INSERT, UPDATE, DELETE
        schema: 'public',
        table: table,
      },
      (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        handleTableChange(table, eventType, newRecord, oldRecord);
      }
    );
  }

  _channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[Realtime] Subscribed to ${tables.length} tables.`);
    } else if (status === 'CHANNEL_ERROR') {
      console.warn('[Realtime] Channel error, will retry...');
    } else if (status === 'TIMED_OUT') {
      console.warn('[Realtime] Subscription timed out, retrying...');
    } else if (status === 'CLOSED') {
      console.log('[Realtime] Channel closed.');
    }
  });
}

/**
 * Cleanly unsubscribe and remove all realtime listeners.
 * Call on logout or when the user session ends.
 */
export function stopRealtimeSubscriptions() {
  if (_channel) {
    _channel.unsubscribe();
    _channel = null;
    console.log('[Realtime] Unsubscribed from all tables.');
  }

  // Clear any pending debounced refreshes
  for (const key of Object.keys(_subscriptionTimers)) {
    clearTimeout(_subscriptionTimers[key]);
  }
  _subscriptionTimers = {};
}

/**
 * Restart subscriptions (useful after session refresh / reconnect).
 */
export function restartRealtimeSubscriptions(supabase) {
  stopRealtimeSubscriptions();
  startRealtimeSubscriptions(supabase);
}

// ================================================================
// Manual Refresh Helpers (called from realtime dispatcher)
// ================================================================

/**
 * Each function checks which page(s) are currently active and
 * uses dynamic import to call the appropriate module's render function.
 * This avoids needing globals for every exported function.
 */

// -- Announcements Refresh --
window.refreshAnnouncements = async function () {
  const annPage = document.getElementById('page-admin-announcements');
  if (annPage && annPage.classList.contains('active-page')) {
    const { renderAnnouncementsList } = await import('./admin-announcements.js');
    await renderAnnouncementsList();
  }
};

// -- Classes Refresh --
window.refreshClasses = async function () {
  const classesPage = document.getElementById('page-admin-classes');
  if (classesPage && classesPage.classList.contains('active-page')) {
    const { renderClassesTable } = await import('./admin-classes.js');
    await renderClassesTable();
  }
  // When classes change, student-related UI might need updates too
  const studentsPage = document.getElementById('page-admin-students');
  if (studentsPage && studentsPage.classList.contains('active-page')) {
    if (typeof window.loadAllStudents === 'function') {
      window.loadAllStudents();
    }
  }
};

// -- Subjects Refresh --
window.refreshSubjects = async function () {
  const subjectsPage = document.getElementById('page-admin-subjects');
  if (subjectsPage && subjectsPage.classList.contains('active-page')) {
    const { renderSubjectsTable } = await import('./admin-subjects.js');
    await renderSubjectsTable();
  }
  // Teachers page also shows subjects
  const teachersPage = document.getElementById('page-admin-teachers');
  if (teachersPage && teachersPage.classList.contains('active-page')) {
    if (typeof window.renderTeachersTable === 'function') {
      window.renderTeachersTable();
    }
  }
};

// -- Teachers Refresh --
window.refreshTeachers = async function () {
  const teachersPage = document.getElementById('page-admin-teachers');
  if (teachersPage && teachersPage.classList.contains('active-page')) {
    const { renderTeachersTable } = await import('./admin-teachers.js');
    await renderTeachersTable();
  }
};

// -- Accountants Refresh --
window.refreshAccountants = async function () {
  const accountantsPage = document.getElementById('page-admin-accountants');
  if (accountantsPage && accountantsPage.classList.contains('active-page')) {
    const { renderAccountantsTable } = await import('./admin-accountants.js');
    await renderAccountantsTable();
  }
};

// -- Accountant Dashboard: Today's Receipts Refresh --
window.refreshAccountantTodayReceipts = async function () {
  const accountantPage = document.getElementById('page-accountant-dashboard');
  if (!accountantPage || !accountantPage.classList.contains('active-page')) return;
  const dashboardSubpage = document.getElementById('accountantPage-dashboard');
  if (!dashboardSubpage || dashboardSubpage.style.display === 'none') return;
  const { loadAccountantDashboard } = await import('./accountant-dashboard.js');
  await loadAccountantDashboard();
};

// -- Income & Expenses Refresh --
window.refreshIncomeExpenses = async function () {
  // Check if accountant dashboard is active
  const accountantPage = document.getElementById('page-accountant-dashboard');
  if (accountantPage && accountantPage.classList.contains('active-page')) {
    const ieSubpage = document.getElementById('accountantPage-income-expenses');
    if (ieSubpage && ieSubpage.style.display !== 'none') {
      const { loadIncomeExpensesPage } = await import('./income-expenses.js');
      await loadIncomeExpensesPage('accIeContainer');
      return;
    }
  }
  // Check if admin dashboard is active
  const adminPage = document.getElementById('page-admin-dashboard');
  if (adminPage && adminPage.classList.contains('active-page')) {
    const ieContainer = document.getElementById('ieContainer');
    if (ieContainer && ieContainer.children.length > 0) {
      const { loadIncomeExpensesPage } = await import('./income-expenses.js');
      await loadIncomeExpensesPage('ieContainer');
    }
  }
};

// ================================================================
// Exports used by TABLE_ACTIONS mapping via window[name] pattern
// Bind module exports that aren't already window-scoped.
// ================================================================

// Exams render function (exported from admin-exams.js, not on window)
window.renderExamsTable = async function () {
  const examsPage = document.getElementById('page-admin-exams');
  if (examsPage && examsPage.classList.contains('active-page')) {
    const { renderExamsTable } = await import('./admin-exams.js');
    await renderExamsTable();
  }
};

// Attendance load function (exported from admin-attendance.js, not on window)
window.loadAttendancePage = async function () {
  const attendancePage = document.getElementById('page-admin-attendance');
  if (attendancePage && attendancePage.classList.contains('active-page')) {
    const { loadAttendancePage } = await import('./admin-attendance.js');
    await loadAttendancePage();
  }
};

// -- Student Dashboard Refresh (for portal confirmation status changes) --
window.refreshStudentDashboard = async function () {
  const studentPage = document.getElementById('page-student-dashboard');
  if (studentPage && studentPage.classList.contains('active-page')) {
    const { data: { user } } = await (await import('./supabase-config.js')).default.auth.getUser();
    if (user) {
      const { loadStudentDashboard } = await import('./student-dashboard.js');
      await loadStudentDashboard(user);
    }
  }
};

// -- Admin Exam Workspace Refresh (score sheet, rankings, overall scores, report cards) --
window.refreshAdminExamWorkspace = async function () {
  const examsPage = document.getElementById('page-admin-exams');
  if (!examsPage || !examsPage.classList.contains('active-page')) return;

  try {
    const { loadScoreSheet, loadOverallScores, generateRankings, loadReportStudents } = await import('./admin-exams.js');

    // Determine which exam tab is currently active and refresh only that view
    const activeTab = document.querySelector('.exam-tab.active');
    const tab = activeTab?.getAttribute('data-etab');

    if (tab === 'scoresheet') {
      await loadScoreSheet();
    } else if (tab === 'rankings') {
      await generateRankings();
    } else if (tab === 'reportcard') {
      await loadReportStudents();
    } else if (tab === 'overallscores') {
      await loadOverallScores();
    }
  } catch (err) {
    console.warn('[Realtime] Admin exam workspace refresh error:', err.message);
  }
};

// -- Teacher Exam Workspace Refresh (score sheet) --
window.refreshTeacherExamWorkspace = async function () {
  const teacherPage = document.getElementById('page-teacher-dashboard');
  if (!teacherPage || !teacherPage.classList.contains('active-page')) return;

  try {
    // Check if the exams subpage is active
    const examsSubpage = document.getElementById('teacherPage-exams');
    if (examsSubpage && examsSubpage.classList.contains('active-subpage')) {
      const { loadTeacherExamStudents } = await import('./teacher-dashboard.js');
      // Only reload if an exam is already selected
      const examSelect = document.getElementById('teacherExamSelect');
      if (examSelect && examSelect.value) {
        await loadTeacherExamStudents();
      }
    }
  } catch (err) {
    console.warn('[Realtime] Teacher exam workspace refresh error:', err.message);
  }
};

// -- Student Exam Report Refresh --
window.refreshStudentExamReport = async function () {
  const studentPage = document.getElementById('page-student-dashboard');
  if (!studentPage || !studentPage.classList.contains('active-page')) return;

  try {
    // Check if the exams subpage is active
    const examsSubpage = document.getElementById('studentPage-exams');
    if (examsSubpage && examsSubpage.classList.contains('active-subpage')) {
      const { loadStudentExamsReport } = await import('./student-dashboard.js');
      await loadStudentExamsReport();
    }
  } catch (err) {
    console.warn('[Realtime] Student exam report refresh error:', err.message);
  }
};