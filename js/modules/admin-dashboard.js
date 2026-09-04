/**
 * Admin Dashboard Homepage — Real-Time Dashboard
 *
 * Features:
 * - Live counter updates with smooth easing animations
 * - Real-time data subscriptions (auto-refreshes when data changes)
 * - Activity feed showing recent changes in real-time
 * - Connection status indicator (live / reconnecting)
 * - Last-updated timestamps on widgets
 * - Pulse highlight animation when data updates
 * - Module lock filtering (hides sections for locked modules)
 */

import { getEl, buildStudentName, formatDate, formatDateTime, statusBadge, getCurrentSchoolId, showMessage, clearMessage, setLoading } from './utils.js';
import { buildFeeClassChartHtml, animateFeeClassChart } from './fee-class-chart.js';
import { svgIcon } from './icons.js';

let supabaseClient = null;
let allStudents = [];
let allFees = [];
let allAnnouncements = [];
let allTeachers = [];
let todayAttendance = []; // [{ class_name, present, absent }] for today
let schoolName = '';
let lastUpdated = null;
let activityLog = [];
let lockedModules = new Set();
let trialStatus = { isTrial: false, endsAt: null }; // Trial version countdown state
let _trialTimerId = null;

// ================================================================
// Realtime subscription references (for cleanup)
// ================================================================
let _dashboardChannel = null;
let _refreshIntervalId = null;
const ACTIVITY_MAX = 20;
const REFRESH_INTERVAL = 30000; // fallback poll every 30s

// ================================================================
// Init
// ================================================================

export function initAdminDashboard(supabase) {
  supabaseClient = supabase;
  setupAdminPhotoZoom();
}

// ================================================================
// Main Loader — fetches all data, renders dashboard, starts realtime
// ================================================================

export async function loadAdminDashboardHome() {
  try {
    await fetchLockedModules();
    await Promise.all([
      fetchStudents(),
      fetchFees(),
      fetchAnnouncements(),
      fetchTeachers(),
      fetchTodayAttendance(),
      fetchSchoolName(),
      fetchTrialStatus(),
      applyAdminAvatar(),
    ]);
    renderDashboard();
    renderTrialBanner();
    propagateSchoolName();
    startRealtimeSubscription();
    startPeriodicRefresh();
    updateConnectionStatus('live');
    recordActivity('Dashboard loaded', 'refresh');
  } catch (err) {
    console.error('Dashboard load error:', err);
    updateConnectionStatus('error');
  }
}

/**
 * Shows the administrator's framed picture (uploaded during school
 * registration) in the admin sidebar avatar when one exists.
 */
async function applyAdminAvatar() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const schoolRes = await supabaseClient.from('schools')
      .select('admin_photo_url')
      .eq('user_id', user.id)
      .maybeSingle();
    const avatarEl = document.querySelector('#adminSidebar .dash-avatar');
    if (!avatarEl) return;
    if (schoolRes?.data?.admin_photo_url) {
      avatarEl.innerHTML = `<img src="${schoolRes.data.admin_photo_url}" alt="Administrator" />`;
    } else if (avatarEl.querySelector('img')) {
      avatarEl.innerHTML = '';
    }
  } catch (err) {
    console.warn('Could not load administrator picture for avatar:', err.message);
  }
}

/**
 * Zoom the administrator's sidebar photo into a lightbox.
 *
 * The admin picture can be injected by two places
 * (applyAdminAvatar() here or loadAdminDashboard() in admin-students.js),
 * so a delegated document-level listener reliably reacts to the photo
 * no matter which module rendered it. Tapping the avatar enlarges it;
 * tapping the backdrop, the × button, or pressing Escape closes it.
 */
function setupAdminPhotoZoom() {
  document.addEventListener('click', (e) => {
    const img = e.target.closest('#adminSidebar .dash-avatar img');
    if (!img || !img.src) return;
    openAdminPhotoLightbox(img.src);
  });
}

function openAdminPhotoLightbox(src) {
  closeAdminPhotoLightbox();
  const overlay = document.createElement('div');
  overlay.id = 'adminPhotoLightbox';
  overlay.className = 'modal-overlay admin-photo-lightbox';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal-card admin-photo-card">
      <div class="modal-header">
        <h3>Administrator</h3>
        <button type="button" class="modal-close" aria-label="Close" title="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
        <img src="${src}" alt="Administrator" />
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Escape key closes the lightbox while it is open.
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') closeAdminPhotoLightbox(overlay);
  };
  document.addEventListener('keydown', onKeyDown);

  // Backdrop click or the × button closes the lightbox.
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('.modal-close')) {
      closeAdminPhotoLightbox(overlay);
    }
  });
}

function closeAdminPhotoLightbox(overlay) {
  const target = overlay || document.getElementById('adminPhotoLightbox');
  if (target) target.remove();
}

/**
 * Fetches the set of locked module names for the current admin's school.
 * These are used to hide related dashboard sections.
 */
async function fetchLockedModules() {
  lockedModules = new Set();
  try {
    const schoolId = await getCurrentSchoolId();
    if (!schoolId) return;
    const { data, error } = await supabaseClient
      .from('school_modules')
      .select('module_name')
      .eq('school_id', schoolId)
      .eq('is_locked', true);
    if (error) {
      console.warn('Failed to fetch locked modules:', error.message);
      return;
    }
    (data || []).forEach(m => lockedModules.add(m.module_name));
  } catch (err) {
    console.warn('Failed to fetch locked modules:', err.message);
  }
}

// ================================================================
// Data Fetching
// ================================================================

async function fetchSchoolName() {
  try {
    const schoolId = await getCurrentSchoolId();
    if (!schoolId) return;

    let logoUrl = '';

    // 1. Try the per-school `school_settings` table first
    const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
      .select('school_name, logo_url')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (schoolSettingsData?.school_name) {
      schoolName = schoolSettingsData.school_name;
    }
    if (schoolSettingsData?.logo_url) {
      logoUrl = schoolSettingsData.logo_url;
    }

    // 2. Try the legacy `settings` table
    if (!schoolName) {
      const { data: settingsData } = await supabaseClient
        .from('settings')
        .select('school_name')
        .eq('id', 'singleton')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (settingsData?.school_name) {
        schoolName = settingsData.school_name;
      }
    }

    // 3. Ultimate fallback: read directly from the `schools` table
    //    (also the source the Super Admin uses to upload logos).
    if (!schoolName || !logoUrl) {
      const { data: schoolData } = await supabaseClient
        .from('schools')
        .select('name, logo_url')
        .eq('id', schoolId)
        .maybeSingle();
      if (schoolData?.name && !schoolName) {
        schoolName = schoolData.name;
      }
      if (schoolData?.logo_url) {
        logoUrl = schoolData.logo_url;
      }
    }

    // Always push the logo around once resolved, no matter which source
    // provided the school name.
    if (logoUrl) {
      applySchoolLogo(logoUrl);
    }
  } catch (err) {
    console.warn('Failed to fetch school name:', err.message);
  }
}

function applySchoolLogo(logoUrl) {
  if (!logoUrl) return;
  // Update admin sidebar logo
  const adminSidebarLogo = document.querySelector('#adminSidebar .sidebar-logo-circle');
  if (adminSidebarLogo) {
    adminSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
  }
  // Update admin school banner icon
  const adminBannerIcon = document.querySelector('#adminSchoolBanner .school-banner-icon');
  if (adminBannerIcon) {
    adminBannerIcon.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:10px;background:rgba(255,255,255,0.2);padding:2px;" />`;
  }
  // Update accountant sidebar logo
  const accountantSidebarLogo = document.querySelector('#accountantSidebar .sidebar-logo-circle');
  if (accountantSidebarLogo) {
    accountantSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
  }
  // Update teacher sidebar logo
  const teacherSidebarLogo = document.querySelector('#teacherSidebar .sidebar-logo-circle');
  if (teacherSidebarLogo) {
    teacherSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
  }
  // Update student sidebar logo
  const studentSidebarLogo = document.querySelector('#studentSidebar .sidebar-logo-circle');
  if (studentSidebarLogo) {
    studentSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
  }
  // Update parent sidebar logo
  const parentSidebarLogo = document.querySelector('#parentSidebar .sidebar-logo-circle');
  if (parentSidebarLogo) {
    parentSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
  }
}

function propagateSchoolName() {
  if (!schoolName) return;
  const sidebarSchoolName = document.getElementById('sidebarSchoolName');
  if (sidebarSchoolName) sidebarSchoolName.textContent = schoolName;
  const bannerName = document.getElementById('adminSchoolBannerName');
  if (bannerName) bannerName.textContent = schoolName;
  const adminWelcome = document.getElementById('adminWelcome');
  if (adminWelcome) {
    // Make the school name BOLD and prominent on the admin dashboard
    adminWelcome.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.5rem;">${svgIcon('school')}<span style="font-size:1.6rem;font-weight:800;color:var(--primary-dark);letter-spacing:0.5px;">${schoolName}</span></span>`;
  }
  document.title = `Admission Portal - ${schoolName}`;
  document.querySelectorAll('.school-name-display').forEach(el => {
    el.textContent = schoolName;
  });
}

// ================================================================
// Trial Version Countdown
// ================================================================

// Reads the current school's version + trial expiry from the schools table.
async function fetchTrialStatus() {
  const schoolId = await getCurrentSchoolId();
  trialStatus = { isTrial: false, endsAt: null };
  if (!schoolId) return;
  try {
    const { data, error } = await supabaseClient
      .from('schools')
      .select('plan_version, trial_ends_at')
      .eq('id', schoolId)
      .maybeSingle();
    if (error) {
      console.warn('Failed to fetch trial status:', error.message);
      return;
    }
    trialStatus.isTrial = data?.plan_version === 'trial';
    trialStatus.endsAt = data?.trial_ends_at ? new Date(data.trial_ends_at) : null;
  } catch (err) {
    console.warn('Failed to fetch trial status:', err.message);
  }
}

// Shows/hides the trial banner and (re)starts the live countdown timer.
function renderTrialBanner() {
  const banner = getEl('adminTrialBanner');
  if (!banner) return;
  if (!trialStatus.isTrial || !trialStatus.endsAt) {
    banner.style.display = 'none';
    stopTrialTimer();
    return;
  }
  banner.style.display = 'flex';
  updateTrialBannerText();
  startTrialTimer();
}

function startTrialTimer() {
  if (_trialTimerId) return;
  _trialTimerId = setInterval(updateTrialBannerText, 1000);
}

function stopTrialTimer() {
  if (_trialTimerId) {
    clearInterval(_trialTimerId);
    _trialTimerId = null;
  }
}

function padNum(n) {
  return String(n).padStart(2, '0');
}

// Live-updating countdown: shows days remaining + an hh:mm:ss countdown.
function updateTrialBannerText() {
  const countEl = getEl('adminTrialCountdown');
  const daysEl = getEl('adminTrialDays');
  const pluralEl = getEl('adminTrialDaysPlural');
  if (!countEl || !trialStatus.endsAt) return;
  const now = new Date();
  const diff = trialStatus.endsAt.getTime() - now.getTime();

  if (diff <= 0) {
    if (countEl) countEl.textContent = '00:00:00';
    if (daysEl) daysEl.textContent = '0';
    if (pluralEl) pluralEl.textContent = 's';
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);

  if (daysEl) daysEl.textContent = days;
  if (pluralEl) pluralEl.textContent = days === 1 ? '' : 's';
  if (countEl) countEl.textContent = `${padNum(hrs)}:${padNum(mins)}:${padNum(secs)}`;
}

async function fetchStudents() {
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { allStudents = []; return; }
  const { data } = await supabaseClient
    .from('applications')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  allStudents = data || [];
}

async function fetchFees() {
  // Skip fetching fees if the fees module is locked
  if (lockedModules.has('fees')) {
    allFees = [];
    return;
  }
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { allFees = []; return; }
  // Fetch ALL fee records (all terms, all years) for complete financial picture
  const { data } = await supabaseClient
    .from('fees')
    .select('*')
    .eq('school_id', schoolId)
    .order('academic_year')
    .order('term');
  allFees = data || [];
}

async function fetchAnnouncements() {
  // Skip fetching announcements if the announcements module is locked
  if (lockedModules.has('announcements')) {
    allAnnouncements = [];
    return;
  }
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { allAnnouncements = []; return; }
  const { data } = await supabaseClient
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(5);
  allAnnouncements = data || [];
}

async function fetchTeachers() {
  // Skip fetching teachers if the teachers module is locked
  if (lockedModules.has('teachers')) {
    allTeachers = [];
    return;
  }
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { allTeachers = []; return; }
  const { data } = await supabaseClient
    .from('teachers')
    .select('*')
    .eq('school_id', schoolId);
  allTeachers = data || [];
}

/**
 * Fetches today's attendance records for the current school and groups them
 * by class, counting only Present and Absent statuses (excludes late/excused).
 */
async function fetchTodayAttendance() {
  todayAttendance = [];
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { todayAttendance = []; return; }
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseClient
    .from('attendance')
    .select('class_name, status')
    .eq('date', today)
    .eq('school_id', schoolId);
  if (error) {
    console.warn('Failed to fetch today\'s attendance:', error.message);
    todayAttendance = [];
    return;
  }
  const grouped = {};
  (data || []).forEach(r => {
    if (!r.class_name) return;
    if (!grouped[r.class_name]) grouped[r.class_name] = { class_name: r.class_name, present: 0, absent: 0 };
    if (r.status === 'present') grouped[r.class_name].present++;
    else if (r.status === 'absent') grouped[r.class_name].absent++;
  });
  todayAttendance = Object.values(grouped).sort((a, b) => a.class_name.localeCompare(b.class_name));
}

// ================================================================
// Refresh Data (called by realtime subscription)
// ================================================================

export async function refreshDashboardData(source = 'realtime') {
  const oldStudentsCount = allStudents.length;
  const oldFeesCount = allFees.length;

  try {
    await fetchLockedModules();
    await Promise.all([
      fetchStudents(),
      fetchFees(),
      fetchAnnouncements(),
      fetchTeachers(),
      fetchTodayAttendance(),
      fetchTrialStatus(),
    ]);

    const newStudentsCount = allStudents.length;
    const newFeesCount = allFees.length;

    // Log activity if data changed
    if (newStudentsCount !== oldStudentsCount) {
      const diff = newStudentsCount - oldStudentsCount;
      if (diff > 0) {
        recordActivity(`${diff} new student(s) added`, 'student_add');
      } else {
        recordActivity(`${Math.abs(diff)} student(s) removed`, 'student_remove');
      }
    }
    if (newFeesCount !== oldFeesCount) {
      recordActivity('Fee records updated', 'fee_update');
    }

    renderDashboard();
    renderTrialBanner();
    updateLastUpdated();
    updateConnectionStatus('live');
    recordActivity(`Dashboard refreshed via ${source}`, 'refresh');
  } catch (err) {
    console.error('Dashboard refresh error:', err);
    updateConnectionStatus('error');
  }
}

// ================================================================
// Real-Time Subscription Setup
// ================================================================

function startRealtimeSubscription() {
  // Clean up existing subscription
  stopRealtimeSubscription();

  if (!supabaseClient) return;

  _dashboardChannel = supabaseClient.channel('admin-dashboard-realtime');

  const tables = ['applications', 'fees', 'announcements', 'teachers', 'payment_transactions', 'exam_results', 'exam_student_details', 'school_modules', 'attendance', 'teacher_classes_subjects'];
  
  for (const table of tables) {
    _dashboardChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        const { eventType } = payload;
        handleRealtimeEvent(table, eventType, payload);
      }
    );
  }

  _dashboardChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('[Dashboard] Real-time subscription active');
      updateConnectionStatus('live');
    } else if (status === 'CHANNEL_ERROR') {
      console.warn('[Dashboard] Real-time channel error');
      updateConnectionStatus('error');
    } else if (status === 'TIMED_OUT') {
      console.warn('[Dashboard] Real-time subscription timed out');
      updateConnectionStatus('reconnecting');
    } else if (status === 'CLOSED') {
      console.log('[Dashboard] Real-time channel closed');
      updateConnectionStatus('offline');
    }
  });
}

function stopRealtimeSubscription() {
  if (_dashboardChannel) {
    _dashboardChannel.unsubscribe();
    _dashboardChannel = null;
  }
}

async function handleRealtimeEvent(table, eventType, payload) {
  const { new: newRecord, old: oldRecord } = payload;

  // CRITICAL: Only process events from the CURRENT USER's school
  const schoolId = await getCurrentSchoolId();
  if (schoolId) {
    const recordSchoolId = newRecord?.school_id || oldRecord?.school_id;
    if (recordSchoolId && recordSchoolId !== schoolId) {
      // Skip events from other schools - data isolation
      return;
    }
  }

  // Log activity
  switch (table) {
    case 'applications':
      if (eventType === 'INSERT') {
        const name = buildStudentName(
          newRecord.first_name || '', 
          newRecord.middle_name || '', 
          newRecord.last_name || ''
        );
        recordActivity(`New student: ${name}`, 'student_add');
      } else if (eventType === 'UPDATE') {
        const name = buildStudentName(
          newRecord.first_name || '', 
          newRecord.middle_name || '', 
          newRecord.last_name || ''
        );
        const oldStatus = oldRecord?.status || 'unknown';
        const newStatus = newRecord?.status || 'unknown';
        if (oldStatus !== newStatus) {
          recordActivity(`${name} status: ${oldStatus} → ${newStatus}`, 'status_change');
        }
      }
      break;
    case 'fees':
      if (eventType === 'INSERT') {
        recordActivity(`New fee record: ${newRecord?.student_id || 'unknown'}`, 'fee_add');
      } else if (eventType === 'UPDATE') {
        if (newRecord?.amount_paid !== oldRecord?.amount_paid) {
          recordActivity(`Payment received: ${newRecord?.student_id || 'unknown'}`, 'payment');
        }
      }
      break;
    case 'announcements':
      if (eventType === 'INSERT') {
        recordActivity(`New announcement: ${newRecord?.title || 'Untitled'}`, 'announcement');
      }
      break;
    case 'payment_transactions':
      recordActivity(`Transaction: ${newRecord?.student_id || 'unknown'}`, 'payment');
      break;
    case 'exam_results':
      if (eventType === 'INSERT') {
        recordActivity(`Exam score added: ${newRecord?.student_id || 'unknown'} (${newRecord?.subject || 'subject'})`, 'exam_score');
      } else if (eventType === 'UPDATE') {
        recordActivity(`Exam score updated: ${newRecord?.student_id || 'unknown'} (${newRecord?.subject || 'subject'})`, 'exam_score');
      }
      break;
    case 'exam_student_details':
      if (eventType === 'INSERT' || eventType === 'UPDATE') {
        recordActivity(`Exam details updated: ${newRecord?.student_id || 'unknown'}`, 'exam_score');
      }
      break;
    case 'school_modules':
      // When module locks change, re-fetch locked modules and refresh the dashboard
      if (eventType === 'INSERT' || eventType === 'UPDATE' || eventType === 'DELETE') {
        recordActivity('Module permissions updated', 'refresh');
      }
      break;
  }

  // Debounced refresh (300ms to aggregate rapid changes)
  if (window._dashboardRefreshTimer) {
    clearTimeout(window._dashboardRefreshTimer);
  }
  window._dashboardRefreshTimer = setTimeout(() => {
    refreshDashboardData('realtime');
  }, 300);
}

// ================================================================
// Periodic Fallback Refresh
// ================================================================

function startPeriodicRefresh() {
  stopPeriodicRefresh();
  _refreshIntervalId = setInterval(() => {
    refreshDashboardData('polling');
  }, REFRESH_INTERVAL);
}

function stopPeriodicRefresh() {
  if (_refreshIntervalId) {
    clearInterval(_refreshIntervalId);
    _refreshIntervalId = null;
  }
}

// ================================================================
// Activity Log
// ================================================================

function recordActivity(message, type = 'info') {
  activityLog.unshift({
    message,
    type,
    timestamp: new Date().toISOString(),
  });
  
  // Keep max entries
  if (activityLog.length > ACTIVITY_MAX) {
    activityLog = activityLog.slice(0, ACTIVITY_MAX);
  }

  // Update activity feed in DOM if rendered
  renderActivityFeed();
}

function renderActivityFeed() {
  const container = document.getElementById('dashActivityFeed');
  if (!container) return;

  if (activityLog.length === 0) {
    container.innerHTML = '<div class="dash-empty" style="padding:1rem;text-align:center;color:var(--text-muted);">No recent activity</div>';
    return;
  }

  container.innerHTML = activityLog.slice(0, 10).map((item) => {
    const iconMap = {
      student_add: 'graduation',
      student_remove: 'trash',
      status_change: 'refresh',
      fee_add: 'coins',
      payment: 'credit-card',
      announcement: 'megaphone',
      refresh: 'refresh',
      fee_update: 'chart',
      exam_score: 'file-text',
    };
    const icon = svgIcon(iconMap[item.type] || 'sparkles');
    const time = formatTimeAgo(item.timestamp);
    return `
      <div class="dash-activity-item" data-type="${item.type}">
        <span class="dash-activity-icon">${icon}</span>
        <span class="dash-activity-msg">${item.message}</span>
        <span class="dash-activity-time">${time}</span>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(isoString) {
  const now = new Date();
  const date = new Date(isoString);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  // For activities older than 24h, show the full date AND time they were performed
  return formatDateTime(isoString);
}

// ================================================================
// Connection Status
// ================================================================

function updateConnectionStatus(status) {
  const badge = document.getElementById('dashConnectionStatus');
  if (!badge) return;

  const statusMap = {
    live: { text: '● Live', class: 'status-live' },
    reconnecting: { text: '◐ Reconnecting...', class: 'status-reconnecting' },
    error: { text: '◑ Connection Error', class: 'status-error' },
    offline: { text: '○ Offline', class: 'status-offline' },
  };

  const s = statusMap[status] || statusMap.offline;
  badge.textContent = s.text;
  badge.className = `dash-connection-badge ${s.class}`;

  // Also update timestamp display
  if (status === 'live') {
    updateLastUpdated();
  }
}

function updateLastUpdated() {
  const el = document.getElementById('dashLastUpdated');
  if (!el) return;
  lastUpdated = new Date();
  const time = lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.textContent = `Last updated: ${time}`;
}

// ================================================================
// Counter Animation with Pulse
// ================================================================

function animateCounter(element, targetValue, isFee = false, isPct = false) {
  if (!element) return;

  const duration = 1000;
  const startTime = performance.now();
  
  // Reset to 0 for animation
  if (!isPct) {
    element.textContent = isFee ? 'GHC 0.00' : '0';
  } else {
    element.textContent = '0%';
  }

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = targetValue * eased;

    if (isPct) {
      element.textContent = current.toFixed(1) + '%';
    } else if (isFee) {
      element.textContent = 'GHC ' + current.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } else {
      element.textContent = Math.round(current);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      // Final value
      if (isPct) {
        element.textContent = targetValue.toFixed(1) + '%';
      } else if (isFee) {
        element.textContent = 'GHC ' + targetValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      } else {
        element.textContent = Math.round(targetValue);
      }
      // Add pulse animation
      element.classList.remove('counter-pulse');
      void element.offsetWidth; // force reflow
      element.classList.add('counter-pulse');
    }
  }
  requestAnimationFrame(update);
}

function animateFeeProgressBar() {
  const fill = document.getElementById('feeProgressFill');
  if (!fill) return;

  let totalAmount = 0, totalPaid = 0, totalDebt = 0;
  allFees.forEach(f => {
    totalAmount += Number(f.total_amount) || 0;
    totalPaid += Number(f.amount_paid) || 0;
    totalDebt += Number(f.debt) || 0;
  });

  // Collection rate = paid ÷ total expected (term fees + carried-forward debt).
  // Keeps the admin Collection Rate consistent with the "Total Expected" stat
  // above it and with the accountant dashboard.
  const totalExpected = totalAmount + totalDebt;
  const pct = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : 0;

  setTimeout(() => {
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
    fill.style.width = Math.min(pct, 100) + '%';
  }, 300);
}

// ================================================================
// Render Dashboard
// ================================================================

function renderDashboard() {
  const container = getEl('adminDashboardContent');
  if (!container) return;

  // Save old data for comparison
  const oldTotal = allStudents.length;

  // Determine which sections to show based on locked modules
  const showFees = !lockedModules.has('fees');
  const showAnnouncements = !lockedModules.has('announcements');
  const showStudents = !lockedModules.has('students'); // core module, but check anyway
  const showTeachers = !lockedModules.has('teachers');

  container.innerHTML = `
    <!-- Real-Time Dashboard Header -->
    <div class="dash-realtime-header">
      <div class="dash-realtime-header-left">
        <div class="dash-realtime-title-row">
          <h2 class="dash-realtime-title">${svgIcon('chart')} Dashboard Overview</h2>
          <span id="dashConnectionStatus" class="dash-connection-badge status-live">● Live</span>
        </div>
        <span id="dashLastUpdated" class="dash-last-updated">Last updated: —</span>
      </div>
      <div class="dash-realtime-header-right">
        <button type="button" class="btn btn-sm btn-secondary" id="dashRefreshBtn" title="Refresh now">
          ${svgIcon('refresh')} Refresh
        </button>
      </div>
    </div>

    <!-- Dashboard Stats Overview -->
    <div class="dash-overview-cards" id="dashOverviewCards">
      <div class="dash-overview-card animated-card" style="--accent:var(--primary);">
        <div class="dash-overview-icon">${svgIcon('users')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashTotalStudents">0</span>
          <span class="dash-overview-label">Total Students</span>
        </div>
      </div>
      <div class="dash-overview-card animated-card" style="--accent:var(--success);">
        <div class="dash-overview-icon">${svgIcon('check-circle')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashAdmitted">0</span>
          <span class="dash-overview-label">Admitted</span>
        </div>
      </div>
      <div class="dash-overview-card animated-card" style="--accent:var(--warning);">
        <div class="dash-overview-icon">${svgIcon('clock')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashPending">0</span>
          <span class="dash-overview-label">Awaiting Portal Confirmation</span>
        </div>
      </div>
      <div class="dash-overview-card animated-card" style="--accent:#ec4899;">
        <div class="dash-overview-icon">${svgIcon('user')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashFemale">0</span>
          <span class="dash-overview-label">Female</span>
        </div>
      </div>
      <div class="dash-overview-card animated-card" style="--accent:#06b6d4;">
        <div class="dash-overview-icon">${svgIcon('user')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashMale">0</span>
          <span class="dash-overview-label">Male</span>
        </div>
      </div>
      <div class="dash-overview-card animated-card" style="--accent:var(--purple);">
        <div class="dash-overview-icon">${svgIcon('check-circle')}</div>
        <div class="dash-overview-info">
          <span class="dash-overview-number" id="dashConfirmed">0</span>
          <span class="dash-overview-label">Portal Confirmed</span>
        </div>
      </div>
    </div>

    <!-- Today's Attendance by Class -->
    <div class="dash-list-card animated-card dash-attendance-card">
      <div class="dash-list-header">
        <h3>${svgIcon('clipboard')} Today's Attendance</h3>
        <span class="dash-list-count" id="dashTodayAttCount">${todayAttendance.length} classes</span>
      </div>
      <div class="dash-list-body" id="dashTodayAttendance">
        ${renderTodayAttendance()}
      </div>
    </div>

    <!-- Charts & Fee Row -->
    <div class="dash-duo-row">
      <!-- Student Population Chart -->
      ${showStudents ? `
      <div class="dash-chart-card animated-card">
        <div class="dash-chart-header">
          <h3>${svgIcon('chart')} Student Population by Class</h3>
          <span class="dash-chart-subtitle">Distribution across classes</span>
        </div>
        <div class="dash-chart-body" id="dashStudentChart">
          ${renderBarChart()}
        </div>
      </div>
      ` : ''}

      <!-- Fee Overview -->
      ${showFees ? `
      <div class="dash-chart-card animated-card">
        <div class="dash-chart-header">
          <h3>${svgIcon('coins')} Fee Overview</h3>
          <span class="dash-chart-subtitle">Overall financial summary</span>
        </div>
        <div class="dash-fee-summary" id="dashFeeSummary">
          ${renderFeeOverview()}
        </div>
        <div class="dash-fee-chart">
          ${renderFeeProgress()}
        </div>
      </div>
      ` : ''}
    </div>

    <!-- Fees by Class (Animated Bar Chart) -->
    ${showFees ? `
    <div class="dash-chart-card animated-card" style="margin-bottom:1rem;">
      <div class="dash-chart-header">
        <h3>${svgIcon('chart')} Fees by Class</h3>
        <span class="dash-chart-subtitle">Total fees vs collected vs outstanding per class</span>
      </div>
      <div class="dash-chart-body" id="dashFeeClassChart">
        ${renderFeeClassChart()}
      </div>
    </div>
    ` : ''}

    <!-- Duo Row: Announcements + Recent Students -->
    <div class="dash-duo-row">
      <!-- Announcements -->
      ${showAnnouncements ? `
      <div class="dash-list-card animated-card">
        <div class="dash-list-header">
          <h3>${svgIcon('megaphone')} Latest Announcements</h3>
          <span class="dash-list-count">${allAnnouncements.length}</span>
        </div>
        <div class="dash-list-body" id="dashAnnouncementsList">
          ${renderAnnouncements()}
        </div>
      </div>
      ` : ''}

      <!-- Recent Admitted Students -->
      ${showStudents ? `
      <div class="dash-list-card animated-card">
        <div class="dash-list-header">
          <h3>${svgIcon('user-plus')} Recent Admitted Students</h3>
          <span class="dash-list-count">5</span>
        </div>
        <div class="dash-list-body" id="dashRecentStudents">
          ${renderRecentStudents()}
        </div>
      </div>
      ` : ''}
    </div>
  `;

  // Animate counters and chart
  requestAnimationFrame(() => {
    animateDashboardCounters();
    if (showStudents) animateChartBars();
    if (showFees) animateFeeProgressBar();
    if (showFees) animateFeeClassChart(document.getElementById('dashFeeClassChart'));
    renderActivityFeed();
    updateLastUpdated();
  });

  // Start announcement popup rotation (only if announcements module is not locked)
  if (showAnnouncements) {
    startAnnouncementPopupRotation();
  } else {
    stopAnnouncementPopupRotation();
  }

  // Bind refresh button
  const refreshBtn = document.getElementById('dashRefreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      refreshBtn.innerHTML = `${svgIcon('clock')} Refreshing...`;
      refreshBtn.disabled = true;
      refreshDashboardData('manual').then(() => {
        refreshBtn.innerHTML = `${svgIcon('refresh')} Refresh`;
        refreshBtn.disabled = false;
      });
    };
  }
}

// ================================================================
// Today's Attendance by Class
// ================================================================

/**
 * Renders the today's-attendance summary grouped by class. Counts only
 * Present and Absent statuses (per requirement, excludes late/excused).
 */
function renderTodayAttendance() {
  if (todayAttendance.length === 0) {
    return '<div class="dash-empty" style="padding:1rem;text-align:center;color:var(--text-muted);">No attendance marked today yet.</div>';
  }

  const totalPresent = todayAttendance.reduce((s, c) => s + c.present, 0);
  const totalAbsent = todayAttendance.reduce((s, c) => s + c.absent, 0);

  return `
    <div class="dash-att-summary">
      <div class="dash-att-row dash-att-header">
        <span class="dash-att-class">Class</span>
        <span class="dash-att-count present">Present</span>
        <span class="dash-att-count absent">Absent</span>
        <span class="dash-att-count">Total</span>
      </div>
      ${todayAttendance.map(cls => `
        <div class="dash-att-row" data-class="${cls.class_name}">
          <span class="dash-att-class">${cls.class_name}</span>
          <span class="dash-att-count present">${cls.present}</span>
          <span class="dash-att-count absent">${cls.absent}</span>
          <span class="dash-att-count">${cls.present + cls.absent}</span>
        </div>
      `).join('')}
      <div class="dash-att-row dash-att-total">
        <span class="dash-att-class">All Classes</span>
        <span class="dash-att-count present">${totalPresent}</span>
        <span class="dash-att-count absent">${totalAbsent}</span>
        <span class="dash-att-count">${totalPresent + totalAbsent}</span>
      </div>
    </div>
  `;
}

// ================================================================
// Animate All Dashboard Counters
// ================================================================

function animateDashboardCounters() {
  const configs = [
    { id: 'dashTotalStudents', target: allStudents.length },
    { id: 'dashAdmitted', target: allStudents.filter(s => s.status === 'admitted').length },
    { id: 'dashPending', target: allStudents.filter(s => s.status === 'admitted' && !s.portal_confirmed).length },
    { id: 'dashFemale', target: allStudents.filter(s => s.gender === 'Female').length },
    { id: 'dashMale', target: allStudents.filter(s => s.gender === 'Male').length },
    { id: 'dashConfirmed', target: allStudents.filter(s => s.portal_confirmed).length },
  ];

  configs.forEach((cfg, index) => {
    const el = document.getElementById(cfg.id);
    if (el) {
      setTimeout(() => {
        animateCounter(el, cfg.target, false, false);
      }, 100 + index * 80);
    }
  });

  // Fee counters (only if fees module is not locked)
  if (!lockedModules.has('fees')) {
    let totalAmount = 0, totalPaid = 0, totalDebt = 0;
    allFees.forEach(f => {
      const amt = Number(f.total_amount) || 0;
      const paid = Number(f.amount_paid) || 0;
      totalAmount += amt;
      totalPaid += paid;
      totalDebt += Number(f.debt) || 0;
    });

    // Total Expected = all term fees + carried-forward debt (matches the label)
    const totalExpected = totalAmount + totalDebt;
    // Outstanding Balance = what's still owed after all payments (never negative)
    const outstandingBalance = Math.max(totalExpected - totalPaid, 0);
    // Grand Total Outstanding = the true debt picture
    const grandTotalOutstanding = outstandingBalance;

    const feeConfigs = [
      { id: 'feeTotalAmount', target: totalExpected },
      { id: 'feeTotalPaid', target: totalPaid },
      { id: 'feeTotalBalance', target: outstandingBalance },
      { id: 'feeTotalDebt', target: totalDebt },
      { id: 'feeGrandTotalDebt', target: grandTotalOutstanding },
    ];

    // Collection rate = paid ÷ total expected (matches accountant dashboard)
    const pct = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : 0;
    feeConfigs.forEach((cfg, index) => {
      const el = document.getElementById(cfg.id);
      if (el) {
        setTimeout(() => {
          animateCounter(el, cfg.target, true, false);
        }, 200 + index * 100);
      }
    });

    const pctEl = document.getElementById('feePct');
    if (pctEl) {
      setTimeout(() => {
        animateCounter(pctEl, pct, false, true);
      }, 600);
    }
  }
}

// ================================================================
// Bar Chart
// ================================================================

function renderBarChart() {
  const classMap = {};
  allStudents.forEach(s => {
    const cls = s.class_applying || 'Unassigned';
    if (!classMap[cls]) classMap[cls] = { total: 0, male: 0, female: 0 };
    classMap[cls].total++;
    if (s.gender === 'Female') classMap[cls].female++;
    else classMap[cls].male++;
  });

  const classNames = Object.keys(classMap).sort();
  const maxCount = Math.max(...classNames.map(c => classMap[c].total), 1);

  return classNames.map((cls, idx) => {
    const data = classMap[cls];
    const barHeight = (data.total / maxCount) * 100;
    return `
      <div class="dash-bar-item" style="animation-delay:${idx * 0.08}s">
        <div class="dash-bar-label">${cls}</div>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" data-width="${barHeight}%" style="height:0;">
            <div class="dash-bar-fill-inner">
              <div class="dash-bar-segment male" style="flex:${data.male || 0.5}"></div>
              <div class="dash-bar-segment female" style="flex:${data.female || 0.5}"></div>
            </div>
          </div>
        </div>
        <div class="dash-bar-value">
          <span class="dash-bar-total">${data.total}</span>
          <span class="dash-bar-gender"><span class="male-dot"></span>${data.male} <span class="female-dot"></span>${data.female}</span>
        </div>
      </div>
    `;
  }).join('');
}

function animateChartBars() {
  document.querySelectorAll('.dash-bar-fill').forEach(bar => {
    const w = bar.getAttribute('data-width') || '0%';
    setTimeout(() => {
      bar.style.height = w;
      bar.style.transition = 'height 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    }, 200);
  });
}

// ================================================================
// Fee Overview
// ================================================================

function renderFeeOverview() {
  let totalAmount = 0, totalPaid = 0, totalDebt = 0;
  let paidCount = 0, unpaidCount = 0, partialCount = 0;

  // allFees now contains ALL fee records across all terms and years
  allFees.forEach(f => {
    const amt = Number(f.total_amount) || 0;
    const paid = Number(f.amount_paid) || 0;
    const debt = Number(f.debt) || 0;
    totalAmount += amt;
    totalPaid += paid;
    totalDebt += debt;
    if (f.payment_status === 'paid') paidCount++;
    else if (f.payment_status === 'partial') partialCount++;
    else unpaidCount++;
  });

  // Total Expected = all term fees + all carried-forward debts
  const totalExpected = totalAmount + totalDebt;
  // Outstanding Balance = what's still owed after all payments
  const outstandingBalance = Math.max(totalExpected - totalPaid, 0);
  // Grand Total Debt = total outstanding balance (the true debt picture)
  const grandTotalDebt = outstandingBalance;

  return `
    <div class="dash-fee-stat">
      <span class="dash-fee-label">Total Expected</span>
      <span class="dash-fee-value" id="feeTotalAmount">GHC 0.00</span>
    </div>
    <div class="dash-fee-stat">
      <span class="dash-fee-label">Total Collected</span>
      <span class="dash-fee-value paid" id="feeTotalPaid">GHC 0.00</span>
    </div>
    <div class="dash-fee-stat">
      <span class="dash-fee-label">Outstanding Balance</span>
      <span class="dash-fee-value balance" id="feeTotalBalance">GHC 0.00</span>
    </div>
    <div class="dash-fee-stat">
      <span class="dash-fee-label">Carried Forward Debt</span>
      <span class="dash-fee-value debt" id="feeTotalDebt">GHC 0.00</span>
    </div>
    <div class="dash-fee-stat dash-fee-stat-grand">
      <span class="dash-fee-label">Grand Total Outstanding</span>
      <span class="dash-fee-value grand-debt" id="feeGrandTotalDebt">GHC 0.00</span>
    </div>
    <div class="dash-fee-counts">
      <span class="dash-fee-count-item"><span class="fee-dot paid-dot"></span>Paid: ${paidCount}</span>
      <span class="dash-fee-count-item"><span class="fee-dot partial-dot"></span>Partial: ${partialCount}</span>
      <span class="dash-fee-count-item"><span class="fee-dot unpaid-dot"></span>Unpaid: ${unpaidCount}</span>
    </div>
  `;
}

function renderFeeProgress() {
  let totalAmount = 0, totalPaid = 0;
  allFees.forEach(f => {
    totalAmount += Number(f.total_amount) || 0;
    totalPaid += Number(f.amount_paid) || 0;
  });

  return `
    <div class="dash-fee-progress">
      <div class="dash-fee-progress-header">
        <span>Collection Rate</span>
        <span class="dash-fee-pct" id="feePct">0%</span>
      </div>
      <div class="dash-fee-progress-track">
        <div class="dash-fee-progress-fill" id="feeProgressFill" style="width:0%;"></div>
      </div>
    </div>
  `;
}

// ================================================================
// Fees by Class — Animated Bar Chart
// ================================================================

/**
 * Aggregates total fees vs collected vs outstanding per class and returns the
 * shared animated bar chart HTML (see fee-class-chart.js).
 */
function renderFeeClassChart() {
  const classMap = {};
  const studentClassMap = {};

  // Bucket every student into a class first so classes with zero fees
  // still show up on the chart (helpful early in the year).
  allStudents.forEach((s) => {
    const cls = s.class_applying || 'Unassigned';
    if (!classMap[cls]) classMap[cls] = { totalFees: 0, collected: 0, outstanding: 0 };
    if (s.student_id) studentClassMap[s.student_id] = cls;
  });

  // Aggregate fee totals / collected / outstanding per class (matches the
  // accountant's definition: total = total_amount + carried-forward debt,
  // collected = amount_paid, outstanding = max(total - collected, 0) per record).
  allFees.forEach((f) => {
    const cls = studentClassMap[f.student_id] || 'Unassigned';
    if (!classMap[cls]) classMap[cls] = { totalFees: 0, collected: 0, outstanding: 0 };
    const total = (Number(f.total_amount) || 0) + (Number(f.debt) || 0);
    const paid = Number(f.amount_paid) || 0;
    classMap[cls].totalFees += total;
    classMap[cls].collected += paid;
    classMap[cls].outstanding += Math.max(total - paid, 0);
  });

  return buildFeeClassChartHtml(classMap);
}

// ================================================================
// Announcements
// ================================================================

let _announcementPopupInterval = null;
let _currentAnnouncementIndex = 0;

/**
 * Show a modern animated announcement popup that slides in from the right
 */
let _remindLaterTimers = [];

function showAnnouncementPopup(announcement) {
  const existing = document.getElementById('dashAnnouncementPopup');
  if (existing) existing.remove();
  if (!announcement) return;

  const priority = announcement.priority || 'normal';
  const date = formatDate(announcement.created_at);
  const priorityClasses = { urgent: 'app-dot-urgent', high: 'app-dot-high', normal: 'app-dot-normal', low: 'app-dot-low' };
  const popup = document.createElement('div');
  popup.id = 'dashAnnouncementPopup';
  popup.innerHTML = `
    <div class="announcement-popup-overlay"></div>
    <div class="announcement-popup-card">
      <div class="announcement-popup-header" style="background:${priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#f59e0b' : '#6366f1'};">
        <span class="announcement-popup-icon"><span class="app-dot ${priorityClasses[priority] || 'app-dot-normal'}"></span></span>
        <span class="announcement-popup-badge">${priority.toUpperCase()}</span>
        <button class="announcement-popup-close" onclick="this.closest('#dashAnnouncementPopup').remove()">×</button>
      </div>
      <div class="announcement-popup-body">
        <h3 class="announcement-popup-title">${announcement.title || 'Announcement'}</h3>
        <p class="announcement-popup-text">${announcement.content || ''}</p>
        <div class="announcement-popup-footer">
          <span class="announcement-popup-date">${svgIcon('calendar')} ${date}</span>
          <div style="display:flex;gap:0.5rem;">
            <button class="announcement-popup-remind" onclick="this.closest('#dashAnnouncementPopup').remove(); window._remindAnnouncement && window._remindAnnouncement()">${svgIcon('clock')} Remind Later</button>
            <button class="announcement-popup-dismiss" onclick="this.closest('#dashAnnouncementPopup').remove()">Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Set up remind later handler
  window._remindAnnouncement = () => {
    // Save announcement ID to localStorage so it's suppressed until next login
    try {
      const dismissed = JSON.parse(localStorage.getItem('_dismissedAnnouncements') || '[]');
      const annId = announcement.id || announcement.title || 'unknown';
      if (!dismissed.includes(annId)) {
        dismissed.push(annId);
        localStorage.setItem('_dismissedAnnouncements', JSON.stringify(dismissed));
      }
    } catch (e) {
      // localStorage may be unavailable
    }
  };

  requestAnimationFrame(() => {
    const card = popup.querySelector('.announcement-popup-card');
    if (card) { card.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; card.style.opacity = '1'; card.style.transform = 'translateX(0) scale(1)'; }
    const overlay = popup.querySelector('.announcement-popup-overlay');
    if (overlay) { overlay.style.transition = 'opacity 0.3s ease'; overlay.style.opacity = '1'; }
  });
  setTimeout(() => {
    const p = document.getElementById('dashAnnouncementPopup');
    if (p) {
      const card = p.querySelector('.announcement-popup-card');
      if (card) { card.style.transition = 'all 0.4s ease'; card.style.opacity = '0'; card.style.transform = 'translateX(100px) scale(0.9)'; }
      const overlay = p.querySelector('.announcement-popup-overlay');
      if (overlay) { overlay.style.transition = 'opacity 0.3s ease'; overlay.style.opacity = '0'; }
      setTimeout(() => p.remove(), 500);
    }
  }, 8000);
}

function getDismissedAnnouncementIds() {
  try {
    return JSON.parse(localStorage.getItem('_dismissedAnnouncements') || '[]');
  } catch (e) {
    return [];
  }
}

function getVisibleAnnouncements() {
  const dismissed = getDismissedAnnouncementIds();
  return allAnnouncements.filter(a => {
    const id = a.id || a.title || 'unknown';
    return !dismissed.includes(id);
  });
}

function startAnnouncementPopupRotation() {
  stopAnnouncementPopupRotation();
  const visible = getVisibleAnnouncements();
  if (!visible || visible.length === 0) return;
  _currentAnnouncementIndex = 0;
  setTimeout(() => { if (visible.length > 0) showAnnouncementPopup(visible[0]); }, 5000);
  _announcementPopupInterval = setInterval(() => {
    const v = getVisibleAnnouncements();
    if (!v || v.length === 0) { stopAnnouncementPopupRotation(); return; }
    _currentAnnouncementIndex = (_currentAnnouncementIndex + 1) % v.length;
    showAnnouncementPopup(v[_currentAnnouncementIndex]);
  }, 20000);
}

function stopAnnouncementPopupRotation() {
  if (_announcementPopupInterval) { clearInterval(_announcementPopupInterval); _announcementPopupInterval = null; }
  const existing = document.getElementById('dashAnnouncementPopup');
  if (existing) existing.remove();
}

function renderAnnouncements() {
  if (allAnnouncements.length === 0) {
    return '<div class="dash-empty">No announcements yet.</div>';
  }
  return allAnnouncements.slice(0, 5).map((a, idx) => {
    const priority = a.priority || 'normal';
    const pClass = `priority-${priority}`;
    const date = formatDate(a.created_at);
    return `
      <div class="dash-announcement-item" style="animation-delay:${idx * 0.1}s">
        <div class="dash-ann-badge ${pClass}">${priority}</div>
        <div class="dash-ann-content">
          <div class="dash-ann-title">${a.title || 'Untitled'}</div>
          <div class="dash-ann-text">${(a.content || '').substring(0, 120)}${(a.content || '').length > 120 ? '...' : ''}</div>
          <div class="dash-ann-meta">${date}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentStudents() {
  const recent = allStudents
    .filter(s => s.status === 'admitted')
    .slice(0, 5);
  if (recent.length === 0) {
    return '<div class="dash-empty">No admitted students yet.</div>';
  }
  return recent.map((s, idx) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
    const photo = s.student_photo_url
      ? `<img src="${s.student_photo_url}" class="dash-recent-photo" alt="" />`
      : '<span class="dash-recent-photo-placeholder"></span>';
    return `
      <div class="dash-recent-item" style="animation-delay:${idx * 0.1}s">
        ${photo}
        <div class="dash-recent-info">
          <span class="dash-recent-name">${name}</span>
          <span class="dash-recent-id">${s.student_id} · ${s.class_applying}</span>
        </div>
        <span class="dash-recent-status">${statusBadge(s.status)}</span>
      </div>
    `;
  }).join('');
}

// ================================================================
// Admin Password Change
// ================================================================

export function setupAdminPasswordChange() {
  const form = getEl('adminPasswordForm');
  if (!form) return;
  form.addEventListener('submit', changeAdminPassword);
}

async function changeAdminPassword(e) {
  e.preventDefault();
  clearMessage('adminProfileMessage');
  const newPassword = getEl('adminNewPassword').value;
  const confirmPassword = getEl('adminConfirmPassword').value;
  if (newPassword.length < 6) {
    showMessage('adminProfileMessage', 'Password must be at least 6 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage('adminProfileMessage', 'Passwords do not match.', 'error');
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Changing...');
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    showMessage('adminProfileMessage', 'Password changed successfully. Use your new password next time you sign in.', 'success');
    getEl('adminNewPassword').value = '';
    getEl('adminConfirmPassword').value = '';
  } catch (err) {
    showMessage('adminProfileMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Change Password');
  }
}

// ================================================================
// Cleanup
// ================================================================

export function cleanupDashboardRealtime() {
  stopRealtimeSubscription();
  stopPeriodicRefresh();
  stopAnnouncementPopupRotation();
  stopTrialTimer();
  if (window._dashboardRefreshTimer) {
    clearTimeout(window._dashboardRefreshTimer);
    window._dashboardRefreshTimer = null;
  }
}