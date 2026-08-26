/**
 * Super Admin Module - Complete System Administration
 * 
 * ID Hierarchy:
 *   Super Admin → Schools (School Admin registers with generated ID)
 *   School Admin → Sub-Admins (Sub Admin registers with generated ID)
 *   Sub Admin → Students, Teachers, Accountants, Parents (each registers with their ID)
 * 
 * The Super Admin has read-only access to ALL schools data for oversight.
 * They can create/manage schools and sub-admins, view system-wide analytics.
 * 
 * Module Lock Filtering:
 *   When a module is locked for a school, the super admin dashboard
 *   filters out related data from that school across all views.
 */

import { getEl, showMessage, clearMessage, setLoading, formatDate, formatDateTime, formatCurrency, statusBadge, validateImageFile, previewFile, uploadPhoto, getCurrentAcademicYear, getSchoolInitialsFromName } from './utils.js';

let supabaseClient = null;
let _lockedModulesCache = null;

export function initSuperAdmin(supabase) {
  supabaseClient = supabase;
}

/**
 * Fetches all locked modules across all schools.
 * Returns a Map of school_id -> Set of locked module names.
 * Cached to avoid repeated lookups.
 */
async function getAllLockedModules() {
  if (_lockedModulesCache) return _lockedModulesCache;
  try {
    const { data, error } = await supabaseClient
      .from('school_modules')
      .select('school_id, module_name')
      .eq('is_locked', true);
    if (error) {
      console.warn('Failed to fetch locked modules:', error.message);
      return new Map();
    }
    const map = new Map();
    (data || []).forEach(sm => {
      if (!map.has(sm.school_id)) map.set(sm.school_id, new Set());
      map.get(sm.school_id).add(sm.module_name);
    });
    _lockedModulesCache = map;
    return map;
  } catch (err) {
    console.warn('Failed to fetch locked modules:', err.message);
    return new Map();
  }
}

/**
 * Clears the locked modules cache (e.g., when a module is toggled).
 */
function clearLockedModulesCache() {
  _lockedModulesCache = null;
}

/**
 * Checks if a given module is locked for a school.
 */
function isModuleLocked(lockedMap, schoolId, moduleName) {
  if (!lockedMap || !schoolId) return false;
  const lockedSet = lockedMap.get(schoolId);
  return lockedSet ? lockedSet.has(moduleName) : false;
}

// ================================================================
// Navigation & Initialization
// ================================================================

export function setupSuperAdmin() {
  // Sidebar navigation
  document.querySelectorAll('#superAdminSidebar .dash-nav-link[data-super-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-super-page');
      document.querySelectorAll('#superAdminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.super-subpage').forEach((p) => p.classList.remove('active-subpage'));
      const target = getEl('superPage-' + page);
      if (target) target.classList.add('active-subpage');
      const titles = {
        dashboard: '⭐ Dashboard Overview',
        schools: '🏫 Schools Management',
        'sub-admins': '👥 Sub Admins',
        students: '👥 All Students',
        classes: '🏫 Classes',
        subjects: '📖 Subjects',
        teachers: '📚 Teachers',
        parents: '👨‍👩‍👧 Parents',
        accountants: '🧾 Accountants',
        announcements: '📢 Announcements',
        attendance: '📋 Attendance',
        fees: '💰 Fees',
        exams: '📝 Exams',
        settings: '⚙️ System Settings',
        profile: '👤 My Profile'
      };
      const titleEl = getEl('superAdminDashTitle');
      if (titleEl && titles[page]) titleEl.textContent = titles[page];
      // Load data based on page
      switch (page) {
        case 'dashboard': loadDashboardStats(); break;
        case 'schools': loadSchoolsList(); break;
        case 'sub-admins': loadSubAdminsList(); break;
        case 'students': loadAllStudents(); break;
        case 'classes': loadAllClasses(); break;
        case 'subjects': loadAllSubjects(); break;
        case 'teachers': loadAllTeachers(); break;
        case 'parents': loadAllParents(); break;
        case 'accountants': loadAllAccountants(); break;
        case 'announcements': loadAllAnnouncements(); break;
        case 'attendance': loadAttendancePage(); break;
        case 'exams': loadExamsPage(); break;
        case 'settings': loadSystemSettings(); break;
        case 'profile': loadSuperAdminProfile(); break;
      }
    });
  });

  // School management
  getEl('btnGenerateSchoolId')?.addEventListener('click', generateSchoolId);
  getEl('newSchoolForm')?.addEventListener('submit', saveNewSchool);
  
  // School logo upload
  getEl('newSchoolLogoInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateImageFile(file, 2);
    if (!validation.valid) { alert(validation.error); e.target.value = ''; return; }
    previewFile(file, getEl('newSchoolLogoPreviewImg'), getEl('newSchoolLogoPlaceholder'), getEl('newSchoolLogoClear'));
  });
  
  // Sub admin management
  getEl('btnGenerateSubAdminId')?.addEventListener('click', generateSubAdminId);
  getEl('newSubAdminForm')?.addEventListener('submit', saveNewSubAdmin);

  // Profile forms
  getEl('superAdminNameForm')?.addEventListener('submit', saveSuperAdminName);
  getEl('superAdminPasswordForm')?.addEventListener('submit', saveSuperAdminPassword);

  // Search/filter listeners
  getEl('superStudentsSearch')?.addEventListener('input', debounce(loadAllStudents, 300));
  getEl('superStudentsSchool')?.addEventListener('change', loadAllStudents);
  getEl('superStudentsClass')?.addEventListener('change', loadAllStudents);
  getEl('superStudentsStatus')?.addEventListener('change', loadAllStudents);
  getEl('superStudentsGender')?.addEventListener('change', loadAllStudents);
  
  getEl('superSchoolsSearch')?.addEventListener('input', debounce(loadSchoolsList, 300));
  getEl('superSubAdminsSearch')?.addEventListener('input', debounce(loadSubAdminsList, 300));
  getEl('superTeachersSearch')?.addEventListener('input', debounce(loadAllTeachers, 300));
  getEl('superTeachersSchool')?.addEventListener('change', loadAllTeachers);
  getEl('superParentsSearch')?.addEventListener('input', debounce(loadAllParents, 300));
  getEl('superAccountantsSearch')?.addEventListener('input', debounce(loadAllAccountants, 300));
  getEl('superAccountantsSchool')?.addEventListener('change', loadAllAccountants);
  getEl('superAnnouncementsSearch')?.addEventListener('input', debounce(loadAllAnnouncements, 300));
  getEl('superAnnouncementsPriority')?.addEventListener('change', loadAllAnnouncements);
  getEl('superClassesSearch')?.addEventListener('input', debounce(loadAllClasses, 300));
  getEl('superSubjectsSearch')?.addEventListener('input', debounce(loadAllSubjects, 300));
  
  // Attendance filters
  getEl('superAttDate')?.addEventListener('change', loadAttendancePage);
  getEl('superAttSchool')?.addEventListener('change', () => { populateSuperAttClasses(); loadAttendancePage(); });
  getEl('superAttClass')?.addEventListener('change', loadAttendancePage);
  getEl('superAttStatus')?.addEventListener('change', loadAttendancePage);
  
  
  // Exams filters
  getEl('superExamsSearch')?.addEventListener('input', debounce(loadExamsPage, 300));
  getEl('superExamsSchool')?.addEventListener('change', loadExamsPage);
  getEl('superExamsTerm')?.addEventListener('change', loadExamsPage);
  getEl('superExamsStatus')?.addEventListener('change', loadExamsPage);
  
  // Settings form
  getEl('superSettingsForm')?.addEventListener('submit', saveSystemSettings);
  
  // School module management
  document.addEventListener('click', (e) => {
    const manageBtn = e.target.closest('[data-manage-modules]');
    if (manageBtn) {
      const schoolId = manageBtn.getAttribute('data-manage-modules');
      const schoolName = manageBtn.getAttribute('data-school-name');
      openSchoolModulesManager(schoolId, schoolName);
    }
  });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export async function loadSuperAdminDashboard() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  const welcomeEl = getEl('superAdminWelcome');
  if (welcomeEl) welcomeEl.textContent = `Welcome, ${profile?.full_name || 'Super Admin'}!`;
  const sidebarName = getEl('superSidebarName');
  if (sidebarName) sidebarName.textContent = profile?.full_name || 'Super Admin';
  const { data: settings } = await supabaseClient.from('settings').select('school_name').eq('id', 'singleton').maybeSingle();
  const schoolNameEl = getEl('superSidebarSchoolName');
  if (schoolNameEl && settings?.school_name) schoolNameEl.textContent = settings.school_name;
  getEl('superProfileName').value = profile?.full_name || '';
  getEl('superProfileEmail').value = profile?.email || '';
  
  // Load initial stats
  await loadDashboardStats();
  // Populate school dropdowns across the dashboard
  await populateAllSchoolDropdowns();
}

// ================================================================
// Populate School Dropdowns
// ================================================================

async function getAllSchools() {
  const { data } = await supabaseClient.from('schools').select('id, name').order('name');
  return data || [];
}

async function populateAllSchoolDropdowns() {
  const schools = await getAllSchools();
  const selects = ['superStudentsSchool', 'superTeachersSchool', 'superAccountantsSchool', 'superFeesSchool', 'superExamsSchool', 'superAttSchool'];
  selects.forEach(id => {
    const el = getEl(id);
    if (!el) return;
    const currentVal = el.value;
    el.innerHTML = '<option value="">All Schools</option>' + schools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (currentVal) el.value = currentVal;
  });
}

// ================================================================
// Activity Feed for Super Admin
// ================================================================

let _superActivityLog = [];

function recordSuperActivity(message, type = 'info') {
  _superActivityLog.unshift({
    message,
    type,
    timestamp: new Date().toISOString(),
  });
  if (_superActivityLog.length > 20) {
    _superActivityLog = _superActivityLog.slice(0, 20);
  }
  renderSuperActivityFeed();
}

function renderSuperActivityFeed() {
  const container = document.getElementById('dashActivityFeed');
  if (!container) return;

  if (_superActivityLog.length === 0) {
    container.innerHTML = '<div class="dash-empty" style="padding:1rem;text-align:center;color:var(--text-muted);">No recent activity</div>';
    return;
  }

  const countEl = document.getElementById('superActivityCount');
  if (countEl) countEl.textContent = _superActivityLog.length;

  const iconMap = {
    student_add: '🎓',
    student_remove: '🗑️',
    status_change: '🔄',
    fee_add: '💰',
    payment: '💳',
    announcement: '📢',
    refresh: '🔄',
    fee_update: '📊',
    school_add: '🏫',
    sub_admin_add: '👥',
    teacher_add: '📚',
    info: '•',
  };

  container.innerHTML = _superActivityLog.slice(0, 10).map((item) => {
    const icon = iconMap[item.type] || '•';
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
// DASHBOARD STATS
// ================================================================

async function loadDashboardStats() {
  try {
    // Fetch all counts in parallel
    const [
      { count: schoolsCount },
      { count: studentsCount },
      { count: teachersCount },
      { count: subAdminsCount },
      { count: parentsCount },
      { count: accountantsCount },
      { count: classesCount },
      { count: subjectsCount },
      { count: announcementsCount },
      { data: schools }
    ] = await Promise.all([
      supabaseClient.from('schools').select('*', { count: 'exact', head: true }),
      supabaseClient.from('applications').select('*', { count: 'exact', head: true }),
      supabaseClient.from('teachers').select('*', { count: 'exact', head: true }),
      supabaseClient.from('sub_admins').select('*', { count: 'exact', head: true }),
      supabaseClient.from('parent_links').select('*', { count: 'exact', head: true }),
      supabaseClient.from('accountants').select('*', { count: 'exact', head: true }),
      supabaseClient.from('classes').select('*', { count: 'exact', head: true }),
      supabaseClient.from('subjects').select('*', { count: 'exact', head: true }),
      supabaseClient.from('announcements').select('*', { count: 'exact', head: true }),
      supabaseClient.from('schools').select('id, name, registration_id, admin_name, school_type, student_population, location, address, email, phone, plan_version, trial_ends_at').order('name')
    ]);

    // Fetch locked modules to filter counts
    const lockedMap = await getAllLockedModules();

    // Fetch all data to filter by locked modules
    const { data: allStudents } = await supabaseClient.from('applications').select('school_id');
    const { data: allTeachers } = await supabaseClient.from('teachers').select('school_id');
    const { data: allParents } = await supabaseClient.from('parent_links').select('school_id');
    const { data: allAccountants } = await supabaseClient.from('accountants').select('school_id');
    const { data: allAnnouncements } = await supabaseClient.from('announcements').select('school_id');

    // Filter counts based on locked modules
    const filteredStudents = (allStudents || []).filter(s => !isModuleLocked(lockedMap, s.school_id, 'students')).length;
    const filteredTeachers = (allTeachers || []).filter(t => !isModuleLocked(lockedMap, t.school_id, 'teachers')).length;
    const filteredParents = (allParents || []).filter(p => !isModuleLocked(lockedMap, p.school_id, 'parents')).length;
    const filteredAccountants = (allAccountants || []).filter(a => !isModuleLocked(lockedMap, a.school_id, 'accountants')).length;
    const filteredAnnouncements = (allAnnouncements || []).filter(a => !isModuleLocked(lockedMap, a.school_id, 'announcements')).length;

    // Update stat cards with filtered counts
    setStat('superStatSchools', schoolsCount || 0);
    setStat('superStatStudents', filteredStudents);
    setStat('superStatTeachers', filteredTeachers);
    setStat('superStatSubAdmins', subAdminsCount || 0);
    setStat('superStatParents', filteredParents);
    setStat('superStatAccountants', filteredAccountants);
    setStat('superStatClasses', classesCount || 0);
    setStat('superStatSubjects', subjectsCount || 0);
    setStat('superStatAnnouncements', filteredAnnouncements);

    // Trial / Full version breakdown (from the schools we already fetched).
    const now = new Date();
    let fullCount = 0, trialCount = 0, trialExpiredCount = 0;
    (schools || []).forEach(s => {
      if (s.plan_version === 'trial') {
        trialCount++;
        if (s.trial_ends_at && new Date(s.trial_ends_at) < now) trialExpiredCount++;
      } else {
        fullCount++;
      }
    });
    if (getEl('superStatFullSchools')) setStat('superStatFullSchools', fullCount);
    if (getEl('superStatTrialSchools')) setStat('superStatTrialSchools', trialCount);
    if (getEl('superStatTrialExpired')) setStat('superStatTrialExpired', trialExpiredCount);

    // School quick-access cards with lock indicators
    const container = getEl('superSchoolsQuickList');
    if (container && schools) {
      // Per-school teacher & accountant counts
      const { data: teachers } = await supabaseClient.from('teachers').select('school_id');
      const { data: accountants } = await supabaseClient.from('accountants').select('school_id');
      const teachersBySchool = (teachers || []).reduce((acc, t) => { acc[t.school_id] = (acc[t.school_id] || 0) + 1; return acc; }, {});
      const accountantsBySchool = (accountants || []).reduce((acc, a) => { acc[a.school_id] = (acc[a.school_id] || 0) + 1; return acc; }, {});
      container.innerHTML = schools.map(s => {
        const lockedSet = lockedMap.get(s.id);
        const lockedCount = lockedSet ? lockedSet.size : 0;
        const lockBadge = lockedCount > 0
          ? `<span style="position:absolute;top:0.25rem;right:0.25rem;background:var(--danger);color:#fff;font-size:0.6rem;padding:0.1rem 0.4rem;border-radius:20px;">🔒 ${lockedCount}</span>`
          : '';
        const tCount = teachersBySchool[s.id] || 0;
        const aCount = accountantsBySchool[s.id] || 0;
        return `
          <div class="quick-school-card" style="position:relative;flex-direction:column;align-items:flex-start;gap:0.3rem;padding:0.8rem;cursor:pointer;onclick="openSchoolInfo('${s.id}')">
            <span style="font-size:0.85rem;font-weight:700;color:var(--text);line-height:1.3;">🏫 ${s.name}</span>
            <span style="font-size:0.7rem;color:var(--text-muted);">ID: <strong style="color:var(--primary);">${s.registration_id || '—'}</strong> · <strong>${s.school_type ? (s.school_type === 'private' ? 'Private' : 'Public') : '—'}</strong></span>
            <span style="font-size:0.7rem;color:var(--text-muted);">Admin: ${s.admin_name || 'Pending'} · Students: ${s.student_population != null ? Number(s.student_population).toLocaleString() : '—'}</span>
            <span style="font-size:0.7rem;color:var(--text-muted);">👩‍🏫 ${tCount} teacher${tCount === 1 ? '' : 's'} · 🧾 ${aCount} accountant${aCount === 1 ? '' : 's'}</span>
            <span style="font-size:0.7rem;color:var(--text-muted);">${(s.location || s.address) || ''} ${s.email ? '· ' + s.email : ''}</span>
            ${lockBadge}
          </div>
        `;
      }).join('');
    }

    // Record activity
    recordSuperActivity(`Dashboard loaded — ${schoolsCount} schools, ${filteredStudents} students`, 'refresh');
    renderSuperActivityFeed();
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
  }
}

function setStat(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value;
}

// ================================================================
// SCHOOLS MANAGEMENT
// ================================================================

async function loadSchoolsList() {
  const tbody = getEl('schoolsBody');
  const noEl = getEl('noSchools');
  if (!tbody) return;
  const search = (getEl('superSchoolsSearch')?.value || '').toLowerCase();
  try {
    let query = supabaseClient.from('schools').select('*').order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) { console.error('Load schools error:', error); return; }
    let items = data || [];
    if (search) items = items.filter(s => `${s.name} ${s.email || ''} ${s.registration_id} ${s.plan_version || ''}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';

    // Fetch locked modules to show lock indicators
    const lockedMap = await getAllLockedModules();

    // Per-school teacher & accountant counts
    const { data: teachers } = await supabaseClient.from('teachers').select('school_id');
    const { data: accountants } = await supabaseClient.from('accountants').select('school_id');
    const teachersBySchool = (teachers || []).reduce((acc, t) => { acc[t.school_id] = (acc[t.school_id] || 0) + 1; return acc; }, {});
    const accountantsBySchool = (accountants || []).reduce((acc, a) => { acc[a.school_id] = (acc[a.school_id] || 0) + 1; return acc; }, {});

    tbody.innerHTML = items.map(s => {
      const statusBadge = s.is_approved ? '<span class="badge-confirmed">Approved</span>' : '<span class="badge-unconfirmed">Pending</span>';
      const userInfo = s.user_id ? '<span style="color:var(--success);font-size:0.75rem;">✅ Linked</span>' : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not linked</span>';
      const approveBtn = s.is_approved
        ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
        : `<button class="action-btn confirm" onclick="approveSchool('${s.id}')">✅ Approve</button>`;
      const lockedSet = lockedMap.get(s.id);
      const lockedCount = lockedSet ? lockedSet.size : 0;
      const lockBadge = lockedCount > 0
        ? `<span style="background:var(--danger);color:#fff;font-size:0.65rem;padding:0.15rem 0.5rem;border-radius:20px;margin-left:0.25rem;">🔒 ${lockedCount} locked</span>`
        : '';
      const resetPwBtn = `<button class="btn btn-sm" onclick="openResetSchoolPassword('${s.id}', '${s.name.replace(/'/g, "\\'")}')" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;cursor:pointer;box-shadow:0 2px 8px rgba(245,158,11,0.3);">🔑 Reset Password</button>`;
      const adminName = s.admin_name || '-';
      const schoolType = s.school_type ? (s.school_type === 'private' ? '<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:99px;background:rgba(245,158,11,0.12);color:#d97706;font-size:0.72rem;font-weight:700;">Private</span>' : '<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:99px;background:rgba(16,185,129,0.12);color:#059669;font-size:0.72rem;font-weight:700;">Public</span>') : '-';
      const versionBadge = s.plan_version === 'trial'
        ? (s.trial_ends_at && new Date(s.trial_ends_at) < new Date()
            ? '<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:99px;background:rgba(239,68,68,0.12);color:#dc2626;font-size:0.72rem;font-weight:700;">⏱ Trial · Expired</span>'
            : `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:99px;background:rgba(245,158,11,0.12);color:#d97706;font-size:0.72rem;font-weight:700;">⏱ Trial${s.trial_ends_at ? ' · ' + formatDate(s.trial_ends_at) : ''}</span>`)
        : '<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:99px;background:rgba(16,185,129,0.12);color:#059669;font-size:0.72rem;font-weight:700;">✓ Full</span>';
      const schoolLocation = s.location || s.address || '-';
      const population = s.student_population != null ? Number(s.student_population).toLocaleString() : '-';
      const teacherCount = teachersBySchool[s.id] || 0;
      const accountantCount = accountantsBySchool[s.id] || 0;
      return `<tr>
        <td><strong style="color:var(--primary);">${s.registration_id}</strong></td>
        <td>${s.name} ${lockBadge}</td>
        <td>${adminName}</td>
        <td>${schoolType}</td>
        <td>${versionBadge}</td>
        <td>${schoolLocation}</td>
        <td>${population}</td>
        <td>${teacherCount}</td>
        <td>${accountantCount}</td>
        <td>${s.email || '-'}</td>
        <td>${s.phone || '-'}</td>
        <td>${statusBadge}</td>
        <td>${userInfo}</td>
        <td>${s.created_at ? formatDate(s.created_at) : '-'}</td>
      <td><button class="action-btn" onclick="openSchoolInfo('${s.id}')" style="background:var(--purple);color:#fff;border:none;">👁️ Info</button> <button class="action-btn" onclick="openEditSchoolInfo('${s.id}')" style="background:var(--success);color:#fff;border:none;">✏️ Edit</button> ${approveBtn} <button class="action-btn" data-manage-modules="${s.id}" data-school-name="${s.name.replace(/'/g, "\\'")}" style="background:var(--primary);color:#fff;border:none;">🔒 Modules</button> ${resetPwBtn} <button class="action-btn danger" onclick="deleteSchool('${s.id}')">Delete</button></td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load schools:', err); }
}

window.approveSchool = async function (schoolId) {
  try {
    const { error } = await supabaseClient.from('schools').update({ is_approved: true }).eq('id', schoolId);
    if (error) { alert('Error: ' + error.message); return; }
    await loadSchoolsList();
  } catch (err) { alert('Error: ' + err.message); }
};

window.deleteSchool = async function (schoolId) {
  if (!confirm('⚠️ PERMANENT DELETION\n\nDelete this school and all its data?\n\nThis action CANNOT be undone.')) return;
  try {
    const { data: school } = await supabaseClient.from('schools').select('user_id').eq('id', schoolId).single();
    const userId = school?.user_id;
    const { error } = await supabaseClient.from('schools').delete().eq('id', schoolId);
    if (error) { alert('Error: ' + error.message); return; }
    if (userId) {
      try { await supabaseClient.auth.admin.deleteUser(userId); } catch (e) { console.warn('Could not delete auth user:', e.message); }
      await supabaseClient.from('profiles').delete().eq('id', userId);
    }
    await loadSchoolsList();
    alert('✅ School and associated auth account permanently deleted.');
  } catch (err) { alert('Error: ' + err.message); }
};
// ================================================================
// SCHOOL INFO MODAL (all onboarding details per school)
// ================================================================
window.openSchoolInfo = async function (schoolId) {
  const modal = getEl('schoolInfoModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const content = getEl('schoolInfoContent');
  content.textContent = 'Loading school details...';
  try {
    const { data, error } = await supabaseClient.from('schools').select('*').eq('id', schoolId).maybeSingle();
    if (error) { content.textContent = 'Error loading details: ' + error.message; return; }
    const s = data || {};
    const fmt = v => (v === null || v === undefined || v === '') ? '—' : v;
    const typeVal = s.school_type ? (s.school_type === 'private' ? 'Private' : 'Public') : '—';
    const popVal = s.student_population != null ? Number(s.student_population).toLocaleString() : '—';
    const linked = s.user_id ? '✅ Linked' : '🔗 Not linked';
    const approved = s.is_approved ? 'Approved' : 'Pending';
    // Per-school teacher & accountant counts
    const { data: teachers } = await supabaseClient.from('teachers').select('school_id').eq('school_id', schoolId);
    const { data: accountants } = await supabaseClient.from('accountants').select('school_id').eq('school_id', schoolId);
    const teacherCount = (teachers || []).length;
    const accountantCount = (accountants || []).length;
    const rows = [
      ['School ID', s.registration_id],
      ['School Name', s.name],
      ['School Administrator', s.admin_name],
      ['School Type', typeVal],
      ['Version', s.plan_version === 'trial'
        ? (`Trial${s.trial_ends_at ? ' (expires ' + formatDate(s.trial_ends_at) + ')' : ''}${s.trial_ends_at && new Date(s.trial_ends_at) < new Date() ? ' — EXPIRED' : ''}`)
        : 'Full'],
      ['Location', s.location || s.address],
      ['Student Population', popVal],
      ['Teachers', teacherCount],
      ['Accountants', accountantCount],
      ['Email', s.email],
      ['Mobile (password change)', s.phone],
      ['Status', approved],
      ['Linked Account', linked],
      ['Created', s.created_at ? formatDate(s.created_at) : '—'],
    ].map(([k, v]) => `<div class="school-info-row"><span class="si-label">${k}</span><span class="si-value">${fmt(v)}</span></div>`).join('');
    content.innerHTML = rows;
    const infoEditBtn = getEl('schoolInfoEditBtn');
    if (infoEditBtn) infoEditBtn.setAttribute('onclick', `openEditSchoolInfo('${s.id}')`);
  } catch (err) {
    content.textContent = 'Error loading school details: ' + err.message;
  }
};

window.closeSchoolInfoModal = function () {
  const modal = getEl('schoolInfoModal');
  if (modal) modal.style.display = 'none';
};

// ================================================================
// EDIT SCHOOL INFO MODAL (Super Admin can edit any school's info)
// ================================================================
window.openEditSchoolInfo = async function (schoolId) {
  const modal = getEl('editSchoolInfoModal');
  if (!modal) return;
  clearMessage('editSchoolMessage');
  modal.style.display = 'flex';
  try {
    const { data, error } = await supabaseClient.from('schools').select('*').eq('id', schoolId).maybeSingle();
    if (error) { showMessage('editSchoolMessage', 'Error loading school: ' + error.message, 'error'); return; }
    const s = data || {};
    getEl('editSchoolId').value = s.id || '';
    getEl('editSchoolName').value = s.name || '';
    getEl('editSchoolRegId').value = s.registration_id || '';
    getEl('editAdminName').value = s.admin_name || '';
    getEl('editSchoolType').value = s.school_type || '';
    getEl('editSchoolLocation').value = s.location || s.address || '';
    getEl('editSchoolPopulation').value = (s.student_population != null ? s.student_population : '');
    getEl('editSchoolEmail').value = s.email || '';
    getEl('editSchoolPhone').value = s.phone || '';
    // Version + trial fields
    const editVerSel = getEl('editSchoolVersion');
    if (editVerSel) editVerSel.value = s.plan_version === 'trial' ? 'trial' : 'full';
    const daysGroup = getEl('editSchoolTrialDaysGroup');
    if (s.plan_version === 'trial' && daysGroup) daysGroup.style.display = '';
    if (s.plan_version !== 'trial' && daysGroup) daysGroup.style.display = 'none';
    const trialDaysInput = getEl('editSchoolTrialDays');
    if (trialDaysInput) {
      if (s.plan_version === 'trial' && s.trial_ends_at) {
        const remain = Math.max(Math.ceil((new Date(s.trial_ends_at) - new Date()) / 86400000), 1);
        trialDaysInput.value = Number.isFinite(remain) ? String(remain) : '14';
      } else {
        trialDaysInput.value = '14';
      }
    }
    // Sync the info-modal's Edit button so it opens this modal for the same school.
    const infoEditBtn = getEl('schoolInfoEditBtn');
    if (infoEditBtn) infoEditBtn.setAttribute('onclick', `openEditSchoolInfo('${s.id}')`);
  } catch (err) {
    showMessage('editSchoolMessage', 'Unexpected error loading school: ' + err.message, 'error');
  }
};

window.closeEditSchoolInfoModal = function () {
  const modal = getEl('editSchoolInfoModal');
  if (modal) modal.style.display = 'none';
  clearMessage('editSchoolMessage');
};

window.saveEditSchoolInfo = async function () {
  const modal = getEl('editSchoolInfoModal');
  if (!modal) return;
  const btn = getEl('saveEditSchoolBtn');
  const schoolId = getEl('editSchoolId').value.trim();
  const name = getEl('editSchoolName').value.trim();
  const adminName = getEl('editAdminName').value.trim() || null;
  const schoolType = getEl('editSchoolType').value || null;
  const location = getEl('editSchoolLocation').value.trim() || null;
  const popRaw = getEl('editSchoolPopulation').value;
  const email = getEl('editSchoolEmail').value.trim() || null;
  const phone = getEl('editSchoolPhone').value.trim() || null;
  const version = getEl('editSchoolVersion')?.value || 'full';
  const trialDays = version === 'trial' ? (parseInt(getEl('editSchoolTrialDays')?.value || '14', 10) || 14) : 0;
  const trialEndsAt = version === 'trial' ? new Date(Date.now() + trialDays * 86400000).toISOString() : null;

  if (!name) { showMessage('editSchoolMessage', 'School name is required.', 'error'); return; }
  if (popRaw !== '' && (!Number.isFinite(Number(popRaw)) || Number(popRaw) < 0)) {
    showMessage('editSchoolMessage', 'Student population must be a valid number.', 'error'); return;
  }
  const population = popRaw === '' ? null : Number(popRaw);

  setLoading(btn, true, 'Saving...');
  clearMessage('editSchoolMessage');
  try {
    const { error } = await supabaseClient.from('schools').update({
      name,
      admin_name: adminName,
      school_type: schoolType,
      location: location,
      address: location, // keep legacy address in sync
      email,
      phone,
      student_population: population,
      plan_version: version,
      trial_ends_at: trialEndsAt,
    }).eq('id', schoolId);
    if (error) { showMessage('editSchoolMessage', 'Error saving: ' + error.message, 'error'); setLoading(btn, false, '💾 Save Changes'); return; }
    // School name changes auto-propagate to school_settings via the
    // trg_sync_school_settings trigger, but we also update school_settings
    // directly to cover any case where that trigger is missing.
    try {
      await supabaseClient.from('school_settings').upsert({ school_id: schoolId, school_name: name });
    } catch (e) { console.warn('Could not sync school_settings name:', e.message); }
    recordSuperActivity(`School info edited: ${name}`, 'info');
    showMessage('editSchoolMessage', '✅ School info updated successfully.', 'success');
    setTimeout(() => {
      modal.style.display = 'none';
      clearMessage('editSchoolMessage');
      loadSchoolsList();
      loadDashboardStats().catch(() => {});
    }, 1000);
  } catch (err) {
    showMessage('editSchoolMessage', 'Error saving: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Save Changes');
  }
};

// ================================================================
// RESET SCHOOL ADMIN PASSWORD
// ================================================================

/**
 * Opens the reset password modal for a specific school.
 * @param {string} schoolId - The school's UUID
 * @param {string} schoolName - The school's display name
 */
window.openResetSchoolPassword = function (schoolId, schoolName) {
  const modal = getEl('resetSchoolPasswordModal');
  if (!modal) {
    alert('Reset password modal not found. Please refresh the page.');
    return;
  }
  getEl('resetPwSchoolId').value = schoolId;
  getEl('resetPwSchoolName').textContent = schoolName;
  getEl('resetPwNewPassword').value = '';
  getEl('resetPwConfirmPassword').value = '';
  clearMessage('resetPwMessage');
  modal.style.display = 'flex';
};

/**
 * Closes the reset password modal.
 */
window.closeResetSchoolPasswordModal = function () {
  const modal = getEl('resetSchoolPasswordModal');
  if (modal) modal.style.display = 'none';
};

/**
 * Resets a school admin's password to a custom password.
 * Calls the reset_school_password RPC function.
 */
window.resetSchoolPassword = async function () {
  const schoolId = getEl('resetPwSchoolId').value;
  const schoolName = getEl('resetPwSchoolName').textContent;
  const newPassword = getEl('resetPwNewPassword').value;
  const confirmPassword = getEl('resetPwConfirmPassword').value;
  const btn = getEl('resetPwSubmitBtn');

  // Validate inputs
  if (!newPassword || newPassword.length < 6) {
    showMessage('resetPwMessage', 'Password must be at least 6 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage('resetPwMessage', 'Passwords do not match.', 'error');
    return;
  }

  // Confirm with the super admin
  if (!confirm(`⚠️ RESET PASSWORD\n\nAre you sure you want to reset the password for "${schoolName}"?\n\nThe school admin will need to use the new password to log in.`)) {
    return;
  }

  setLoading(btn, true, 'Resetting...');
  try {
    const { data, error } = await supabaseClient.rpc('reset_school_password', {
      p_school_id: schoolId,
      p_new_password: newPassword,
    });

    if (error) {
      showMessage('resetPwMessage', 'Error: ' + error.message, 'error');
      setLoading(btn, false, '🔑 Reset Password');
      return;
    }

    if (!data?.success) {
      showMessage('resetPwMessage', data?.error || 'Failed to reset password.', 'error');
      setLoading(btn, false, '🔑 Reset Password');
      return;
    }

    showMessage('resetPwMessage', `✅ Password reset successfully for "${schoolName}". The school admin can now log in with the new password.`, 'success');
    recordSuperActivity(`Password reset for school: ${schoolName}`, 'info');
    setLoading(btn, false, '🔑 Reset Password');

    // Close the modal after a short delay
    setTimeout(() => {
      getEl('resetSchoolPasswordModal').style.display = 'none';
    }, 2000);
  } catch (err) {
    showMessage('resetPwMessage', 'Error: ' + err.message, 'error');
    setLoading(btn, false, '🔑 Reset Password');
  }
};

async function generateSchoolId() {
  // Opens the systematic Create-School wizard at Step 1 (enter school name first).
  const section = getEl('newSchoolSection');
  if (section) { section.style.display = 'block'; section.open = true; }
  const step1 = getEl('superSchoolStep1');
  if (step1) step1.style.display = 'block';
  const form = getEl('newSchoolForm');
  if (form) form.style.display = 'none';
  const nameInput = getEl('newSchoolName');
  if (nameInput) setTimeout(() => nameInput.focus(), 50);
}

// Toggle the Trial-duration field in the Create-School wizard Step 1,
// and update the explanatory note based on the selected version.
window.onNewSchoolVersionChange = function () {
  const sel = getEl('newSchoolVersion');
  const daysGroup = getEl('newSchoolTrialDaysGroup');
  const note = getEl('newSchoolVersionNote');
  if (!sel) return;
  const v = sel.value;
  if (daysGroup) daysGroup.style.display = v === 'trial' ? '' : 'none';
  if (note) {
    note.textContent = v === 'trial'
      ? `Trial Version — the school gets access for the chosen number of days, then the trial expires. A trial School ID includes a TRIAL marker.`
      : `Full Version — unlimited access to all enabled modules.`;
  }
};

// Toggle the Trial-duration field in the Edit School modal.
window.onEditSchoolVersionChange = function () {
  const sel = getEl('editSchoolVersion');
  const daysGroup = getEl('editSchoolTrialDaysGroup');
  const daysInput = getEl('editSchoolTrialDays');
  if (!sel) return;
  const v = sel.value;
  if (daysGroup) daysGroup.style.display = v === 'trial' ? '' : 'none';
  if (v === 'trial' && daysInput && !daysInput.value) daysInput.value = '14';
};

// Build an HTML summary showing the selected version + generated ID info.
function renderSchoolVersionSummary() {
  const summary = getEl('newSchoolVersionSummary');
  if (!summary) return;
  const v = getEl('newSchoolVersionInput')?.value || 'full';
  const regId = getEl('newSchoolRegId')?.value || '';
  if (v === 'trial') {
    const days = parseInt(getEl('newSchoolTrialDaysInput')?.value || '14', 10) || 14;
    const end = new Date(Date.now() + days * 86400000);
    summary.innerHTML = `<strong style="color:#d97706;">⏱ Trial Version</strong><br>
      <span style="font-size:0.8rem;color:var(--text-muted);">Trial access for ${days} day(s) (ends ${end.toLocaleDateString()}) — the ID <strong>${regId}</strong> carries the <strong>TRIAL</strong> marker. Convert to Full at any time from the school's Edit info.</span>`;
  } else {
    summary.innerHTML = `<strong style="color:#059669;">✓ Full Version</strong><br>
      <span style="font-size:0.8rem;color:var(--text-muted);">Unlimited access to all enabled modules.</span>`;
  }
}

window.superSchoolGenerateNext = async function () {
  clearMessage('newSchoolMessage');
  const nameInput = getEl('newSchoolName');
  const name = (nameInput?.value || '').trim();
  if (!name) { showMessage('newSchoolMessage', 'Enter the school name first to generate its School ID.', 'error'); nameInput?.focus(); return; }
  const versionSel = getEl('newSchoolVersion');
  const version = versionSel?.value || 'full';
  const trialDays = version === 'trial' ? (parseInt(getEl('newSchoolTrialDays')?.value || '14', 10) || 14) : 0;
  setLoading(getEl('btnSchoolGenNext'), true, 'Generating...');
  try {
    const { data: regId, error } = await supabaseClient.rpc('generate_school_id', { p_school_name: name, p_version: version });
    if (error) { throw new Error(error.message); }
    getEl('newSchoolRegId').value = regId || '';
    getEl('newSchoolNameDisplay').value = name;
    // Stash the version + trial duration into the Step-2 form hidden fields.
    getEl('newSchoolVersionInput').value = version;
    getEl('newSchoolTrialDaysInput').value = String(trialDays);
    const step1 = getEl('superSchoolStep1');
    const form = getEl('newSchoolForm');
    if (step1) step1.style.display = 'none';
    if (form) form.style.display = 'block';
    renderSchoolVersionSummary();
    showMessage('newSchoolMessage', `School ID generated from "${name}" initials (${version === 'trial' ? 'Trial' : 'Full'} version).`, 'success');
  } catch (err) {
    showMessage('newSchoolMessage', 'Error generating ID: ' + err.message, 'error');
  } finally {
    setLoading(getEl('btnSchoolGenNext'), false, 'Next → Generate School ID');
  }
};

window.superSchoolBackToStep1 = function () {
  const step1 = getEl('superSchoolStep1');
  const form = getEl('newSchoolForm');
  if (step1) step1.style.display = 'block';
  if (form) form.style.display = 'none';
};

async function saveNewSchool(e) {
  e.preventDefault();
  clearMessage('newSchoolMessage');
  const btn = getEl('saveSchoolBtn');
  setLoading(btn, true, 'Creating...');
  const name = getEl('newSchoolName').value.trim();
  const email = getEl('newSchoolEmail').value.trim() || null;
  const phone = getEl('newSchoolPhone').value.trim() || null;
  const address = getEl('newSchoolAddress').value.trim() || null;
  const regId = getEl('newSchoolRegId').value.trim();
  const logoFile = getEl('newSchoolLogoInput')?.files?.[0] || null;
  const version = getEl('newSchoolVersionInput')?.value || 'full';
  const trialDays = version === 'trial' ? (parseInt(getEl('newSchoolTrialDaysInput')?.value || '14', 10) || 14) : 0;
  const trialEndsAt = version === 'trial' ? new Date(Date.now() + trialDays * 86400000).toISOString() : null;
  if (!name || !regId) { showMessage('newSchoolMessage', 'School name and generated School ID are required.', 'error'); setLoading(btn, false, '✅ Create School'); return; }
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: newSchool, error } = await supabaseClient.from('schools').insert([{
      registration_id: regId, name, email, phone, address, location: address, created_by: user?.id || null, is_approved: true,
      plan_version: version, trial_ends_at: trialEndsAt,
    }]).select('id').single();
    if (error) { showMessage('newSchoolMessage', 'Error: ' + error.message, 'error'); setLoading(btn, false, '✅ Create School'); return; }
    
    // Upload school logo if provided
    let logoUrl = null;
    if (logoFile && newSchool?.id) {
      try {
        // Tag the logo with the school's own initials, e.g. "school_<id>-SIS",
        // so the Cloudinary folder shows readable school logos at a glance.
        const schoolInitials = getSchoolInitialsFromName(name);
        const logoSuffix = schoolInitials && schoolInitials !== 'SCH' ? `-${schoolInitials}` : '';
        const logoPrefix = `school_${newSchool.id}${logoSuffix}`;
        logoUrl = await uploadPhoto(supabaseClient, 'school-logos', logoFile, logoPrefix);
      } catch (logoErr) {
        console.warn('Logo upload failed:', logoErr.message);
      }
    }
    
    // Auto-create school_settings record so the school name appears everywhere
    // (The legacy `settings` table has a singleton PK and can only hold ONE global row,
    //  so we only use the per-school `school_settings` table here.)
    if (newSchool?.id) {
      try {
        await supabaseClient.from('school_settings').upsert({
          school_id: newSchool.id, school_name: name, academic_year: '2025/2026', current_term: 'First',
          logo_url: logoUrl,
        });
      } catch (schoolSettingsErr) {
        console.warn('Could not create school_settings row for new school:', schoolSettingsErr.message);
      }
      // Also update the schools table with the logo URL
      if (logoUrl) {
        try {
          await supabaseClient.from('schools').update({ logo_url: logoUrl }).eq('id', newSchool.id);
        } catch (logoUpdateErr) {
          console.warn('Could not update school logo_url:', logoUpdateErr.message);
        }
      }
    }
    
    showMessage('newSchoolMessage', `✅ School "${name}" created with ${version === 'trial' ? `TRIAL version (expires ${new Date(trialEndsAt).toLocaleDateString()})` : 'FULL version'} and ID: ${regId}. Provide this ID to the school admin for registration.`, 'success');
    getEl('newSchoolName').value = '';
    getEl('newSchoolEmail').value = '';
    getEl('newSchoolPhone').value = '';
    getEl('newSchoolAddress').value = '';
    getEl('newSchoolRegId').value = '';
    getEl('newSchoolLogoInput').value = '';
    getEl('newSchoolLogoPreviewImg').style.display = 'none';
    getEl('newSchoolLogoPlaceholder').style.display = '';
    getEl('newSchoolLogoClear').style.display = 'none';
    getEl('newSchoolSection').style.display = 'none';
    // Reset the version/trial fields for the next school.
    if (getEl('newSchoolVersion')) getEl('newSchoolVersion').value = 'full';
    const _daysGroup = getEl('newSchoolTrialDaysGroup');
    if (_daysGroup) _daysGroup.style.display = 'none';
    if (getEl('newSchoolTrialDays')) getEl('newSchoolTrialDays').value = '14';
    const _note = getEl('newSchoolVersionNote');
    if (_note) _note.textContent = 'Full Version — unlimited access to all enabled modules.';
    if (getEl('newSchoolVersionInput')) getEl('newSchoolVersionInput').value = 'full';
    if (getEl('newSchoolTrialDaysInput')) getEl('newSchoolTrialDaysInput').value = '14';
    if (getEl('newSchoolVersionSummary')) getEl('newSchoolVersionSummary').innerHTML = '';
    await loadSchoolsList();
    await loadDashboardStats();
  } catch (err) { showMessage('newSchoolMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '✅ Create School'); }
}

// Clear the new school logo preview
window.clearNewSchoolLogo = function() {
  const input = getEl('newSchoolLogoInput');
  const img = getEl('newSchoolLogoPreviewImg');
  const placeholder = getEl('newSchoolLogoPlaceholder');
  const clearBtn = getEl('newSchoolLogoClear');
  if (input) input.value = '';
  if (img) { img.style.display = 'none'; img.src = '#'; }
  if (placeholder) placeholder.style.display = '';
  if (clearBtn) clearBtn.style.display = 'none';
};

// ================================================================
// SUB ADMINS MANAGEMENT
// ================================================================

async function loadSubAdminsList() {
  const tbody = getEl('subAdminsBody');
  const noEl = getEl('noSubAdmins');
  if (!tbody) return;
  const search = (getEl('superSubAdminsSearch')?.value || '').toLowerCase();
  try {
    const { data, error } = await supabaseClient.from('sub_admins')
      .select('*, schools(name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load sub admins error:', error); return; }
    let items = data || [];
    if (search) items = items.filter(s => `${s.full_name} ${s.email || ''} ${s.registration_id}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(sa => {
      const statusBadge = sa.is_approved ? '<span class="badge-confirmed">Approved</span>' : '<span class="badge-unconfirmed">Pending</span>';
      const userInfo = sa.user_id ? '<span style="color:var(--success);font-size:0.75rem;">✅ Linked</span>' : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not linked</span>';
      const approveBtn = sa.is_approved
        ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
        : `<button class="action-btn confirm" onclick="approveSubAdmin('${sa.id}')">✅ Approve</button>`;
      const schoolName = sa.schools?.name || '—';
      return `<tr>
        <td><strong>${sa.registration_id}</strong></td>
        <td>${sa.full_name}</td>
        <td>${sa.email || '-'}</td>
        <td>${schoolName}</td>
        <td>${statusBadge}</td>
        <td>${userInfo}</td>
        <td>${sa.created_at ? formatDate(sa.created_at) : '-'}</td>
        <td>${approveBtn} <button class="action-btn danger" onclick="deleteSubAdmin('${sa.id}')">Delete</button>
        <button class="action-btn" onclick="viewSubAdminActivities('${sa.id}')">📋 Activities</button></td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load sub admins:', err); }
}

window.approveSubAdmin = async function (id) {
  try {
    const { error } = await supabaseClient.from('sub_admins').update({ is_approved: true }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    await loadSubAdminsList();
  } catch (err) { alert('Error: ' + err.message); }
};

window.deleteSubAdmin = async function (id) {
  if (!confirm('Delete this sub admin record?')) return;
  const { data: sa } = await supabaseClient.from('sub_admins').select('user_id').eq('id', id).single();
  const { error } = await supabaseClient.from('sub_admins').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  if (sa?.user_id) {
    try { await supabaseClient.auth.admin.deleteUser(sa.user_id); } catch (e) { console.warn(e); }
    await supabaseClient.from('profiles').delete().eq('id', sa.user_id);
  }
  await loadSubAdminsList();
};

window.viewSubAdminActivities = async function (subAdminId) {
  const modal = getEl('subAdminActivitiesModal');
  if (!modal) return;
  // Remember whose log is on screen so the "Clear All Logs" button deletes the right rows.
  modal.dataset.subAdminId = subAdminId;
  clearMessage('subAdminActivitiesClearMessage');
  modal.style.display = 'flex';
  getEl('activitiesLoading').style.display = 'block';
  getEl('activitiesContent').style.display = 'none';
  try {
    const { data: sa } = await supabaseClient.from('sub_admins').select('full_name, registration_id').eq('id', subAdminId).single();
    if (sa) {
      getEl('activitiesSubAdminName').textContent = sa.full_name;
      getEl('activitiesRegId').textContent = sa.registration_id;
      getEl('activitiesModalTitle').textContent = `📋 Activities: ${sa.full_name}`;
    }
    const { data: activities } = await supabaseClient.from('sub_admin_activities')
      .select('*')
      .eq('sub_admin_id', subAdminId)
      .order('created_at', { ascending: false });
    const body = getEl('activitiesBody');
    const noAct = getEl('noActivities');
    if (!activities || activities.length === 0) {
      body.innerHTML = '';
      if (noAct) noAct.style.display = 'block';
    } else {
      if (noAct) noAct.style.display = 'none';
      body.innerHTML = activities.map(a => `<tr>
        <td>${formatDateTime(a.created_at)}</td>
        <td>${a.action}</td>
        <td>${a.entity_type || '-'}</td>
        <td>${a.entity_details || '-'}</td>
      </tr>`).join('');
    }
  } catch (err) { console.error(err); }
  finally {
    getEl('activitiesLoading').style.display = 'none';
    getEl('activitiesContent').style.display = 'block';
  }
};

// ================================================================
// Clear a sub admin's activity log.
// Deletes ALL rows for the currently-viewed sub admin from the
// `sub_admin_activities` table, then reloads the modal contents.
// ================================================================
window.clearSubAdminActivityLog = async function () {
  const modal = getEl('subAdminActivitiesModal');
  if (!modal) return;
  const subAdminId = modal.dataset.subAdminId;
  if (!subAdminId) return;

  if (!confirm('⚠️ Delete ALL activity log entries for this sub admin?\n\nThis cannot be undone.')) return;

  const btn = getEl('clearSubAdminActivitiesBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Clearing...'; }

  try {
    const { error } = await supabaseClient
      .from('sub_admin_activities')
      .delete()
      .eq('sub_admin_id', subAdminId);
    if (error) throw error;

    // Reload the modal for that sub admin (shows the now-empty list)
    await viewSubAdminActivities(subAdminId);

    showMessage('subAdminActivitiesClearMessage', '🗑️ All activity logs for this sub admin were cleared.', 'success');
  } catch (err) {
    console.error('clearSubAdminActivityLog error:', err);
    showMessage('subAdminActivitiesClearMessage', 'Failed to clear logs: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
};

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

async function generateSubAdminId() {
  try {
    const { data: regId, error } = await supabaseClient.rpc('generate_sub_admin_id');
    if (error) { alert('Error generating ID: ' + error.message); return; }
    getEl('newSubAdminRegId').value = regId || 'SA-0001';
    getEl('newSubAdminSection').style.display = 'block';
    getEl('newSubAdminSection').open = true;
  } catch (err) { alert('Error: ' + err.message); }
}

async function saveNewSubAdmin(e) {
  e.preventDefault();
  clearMessage('newSubAdminMessage');
  const btn = getEl('saveSubAdminBtn');
  setLoading(btn, true, 'Creating...');
  const name = getEl('newSubAdminName').value.trim();
  const email = getEl('newSubAdminEmail').value.trim() || null;
  const regId = getEl('newSubAdminRegId').value.trim();
  if (!name || !regId) { showMessage('newSubAdminMessage', 'Name and Registration ID are required.', 'error'); setLoading(btn, false, '✅ Create Sub Admin & Generate ID'); return; }
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from('sub_admins').insert([{
      registration_id: regId, full_name: name, email,
      created_by: user?.id || null, is_approved: true,
    }]);
    if (error) { showMessage('newSubAdminMessage', 'Error: ' + error.message, 'error'); setLoading(btn, false, '✅ Create Sub Admin & Generate ID'); return; }
    showMessage('newSubAdminMessage', `✅ Sub Admin "${name}" created with ID: ${regId}. Provide this ID to them for registration.`, 'success');
    getEl('newSubAdminName').value = '';
    getEl('newSubAdminEmail').value = '';
    getEl('newSubAdminRegId').value = '';
    getEl('newSubAdminSection').style.display = 'none';
    await loadSubAdminsList();
  } catch (err) { showMessage('newSubAdminMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '✅ Create Sub Admin & Generate ID'); }
}

// ================================================================
// ALL STUDENTS (Read-only across all schools)
// ================================================================

async function loadAllStudents() {
  const tbody = getEl('superStudentsBody');
  const noEl = getEl('superNoStudents');
  if (!tbody) return;
  const search = (getEl('superStudentsSearch')?.value || '').toLowerCase();
  const schoolId = getEl('superStudentsSchool')?.value || '';
  const classFilter = getEl('superStudentsClass')?.value || '';
  const statusFilter = getEl('superStudentsStatus')?.value || '';
  const genderFilter = getEl('superStudentsGender')?.value || '';

  try {
    let query = supabaseClient.from('applications').select('*, schools(name)').order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) { console.error('Load students error:', error); return; }
    let items = data || [];
    // Filter out students from schools where the students module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(s => !isModuleLocked(lockedMap, s.school_id, 'students'));
    if (schoolId) items = items.filter(s => s.school_id === schoolId);
    if (classFilter) items = items.filter(s => s.class_applying === classFilter);
    if (statusFilter) items = items.filter(s => s.status === statusFilter);
    if (genderFilter) items = items.filter(s => s.gender === genderFilter);
    if (search) items = items.filter(s => `${s.first_name} ${s.last_name} ${s.student_id} ${s.parent_name}`.toLowerCase().includes(search));

    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';

    // Populate class filter
    populateClassFilter(items);

    tbody.innerHTML = items.map(s => {
      const photoHtml = s.student_photo_url
        ? `<img src="${s.student_photo_url}" alt="Photo" class="student-photo-thumb" />`
        : '<span class="dash-photo-placeholder">🎓</span>';
      const statusHtml = s.status === 'admitted' 
        ? '<span class="badge-confirmed">Admitted</span>' 
        : '<span class="badge-unconfirmed">Pending</span>';
      const portalHtml = s.portal_confirmed 
        ? '<span class="badge-confirmed">✅ Confirmed</span>' 
        : '<span class="badge-unconfirmed">⏳ Pending</span>';
      const schoolName = s.schools?.name || '—';
      return `<tr>
        <td><strong>${s.student_id}</strong></td>
        <td>${photoHtml}</td>
        <td>${s.first_name} ${s.middle_name || ''} ${s.last_name}</td>
        <td>${s.gender}</td>
        <td>${s.class_applying}</td>
        <td>${schoolName}</td>
        <td>${s.parent_name}</td>
        <td>${s.parent_contact}</td>
        <td>${statusHtml}</td>
        <td>${portalHtml}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load students:', err); }
}

function populateClassFilter(items) {
  const select = getEl('superStudentsClass');
  if (!select) return;
  const classes = [...new Set(items.map(s => s.class_applying).filter(Boolean))].sort();
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c}">${c}</option>`).join('');
  if (currentVal) select.value = currentVal;
}

// ================================================================
// ALL CLASSES
// ================================================================

async function loadAllClasses() {
  const tbody = getEl('superClassesBody');
  const noEl = getEl('superNoClasses');
  if (!tbody) return;
  const search = (getEl('superClassesSearch')?.value || '').toLowerCase();
  try {
    const { data, error } = await supabaseClient.from('classes')
      .select('*, schools(name)')
      .order('name');
    if (error) { console.error('Load classes error:', error); return; }
    let items = data || [];
    if (search) items = items.filter(c => `${c.name} ${c.schools?.name || ''}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(c => `<tr>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge-confirmed">${c.level}</span></td>
      <td>${c.schools?.name || '—'}</td>
      <td>${c.created_at ? formatDate(c.created_at) : '-'}</td>
    </tr>`).join('');
  } catch (err) { console.error('Failed to load classes:', err); }
}

// ================================================================
// ALL SUBJECTS
// ================================================================

async function loadAllSubjects() {
  const tbody = getEl('superSubjectsBody');
  const noEl = getEl('superNoSubjects');
  if (!tbody) return;
  const search = (getEl('superSubjectsSearch')?.value || '').toLowerCase();
  try {
    const { data, error } = await supabaseClient.from('subjects')
      .select('*, schools(name)')
      .order('name');
    if (error) { console.error('Load subjects error:', error); return; }
    let items = data || [];
    if (search) items = items.filter(s => `${s.name} ${s.schools?.name || ''}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(s => `<tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.schools?.name || '—'}</td>
      <td>${s.created_at ? formatDate(s.created_at) : '-'}</td>
    </tr>`).join('');
  } catch (err) { console.error('Failed to load subjects:', err); }
}

// ================================================================
// ALL TEACHERS
// ================================================================

async function loadAllTeachers() {
  const tbody = getEl('superTeachersBody');
  const noEl = getEl('superNoTeachers');
  if (!tbody) return;
  const search = (getEl('superTeachersSearch')?.value || '').toLowerCase();
  const schoolId = getEl('superTeachersSchool')?.value || '';
  try {
    const { data, error } = await supabaseClient.from('teachers')
      .select('*, schools(name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load teachers error:', error); return; }
    let items = data || [];
    // Filter out teachers from schools where the teachers module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(t => !isModuleLocked(lockedMap, t.school_id, 'teachers'));
    if (schoolId) items = items.filter(t => t.school_id === schoolId);
    if (search) items = items.filter(t => `${t.full_name} ${t.email || ''} ${t.registration_id || ''}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(t => {
      const activeBadge = t.is_active 
        ? '<span class="badge-confirmed">Active</span>' 
        : '<span class="badge-unconfirmed">Inactive</span>';
      const regInfo = t.registration_id ? `<br><small style="color:var(--text-muted);font-size:0.75rem;">🔑 ${t.registration_id}</small>` : '';
      const regStatus = t.user_id
        ? '<span style="color:var(--success);font-size:0.75rem;">✅ Registered</span>'
        : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not registered</span>';
      return `<tr>
        <td><span class="dash-photo-placeholder">📚</span></td>
        <td><strong>${t.full_name}</strong>${regInfo}</td>
        <td>${t.email || '-'}</td>
        <td>${t.phone || '-'}</td>
        <td>${t.class_taught || '-'}</td>
        <td>${t.subject || '-'}</td>
        <td>${t.schools?.name || '—'}</td>
        <td>${activeBadge}</td>
        <td>${regStatus}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load teachers:', err); }
}

// ================================================================
// ALL PARENTS
// ================================================================

async function loadAllParents() {
  const tbody = getEl('superParentsBody');
  const noEl = getEl('superNoParents');
  if (!tbody) return;
  const search = (getEl('superParentsSearch')?.value || '').toLowerCase();
  try {
    const { data, error } = await supabaseClient.from('parent_links')
      .select('*, profiles(full_name, email), schools(name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load parents error:', error); return; }
    let items = data || [];
    // Filter out parents from schools where the parents module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(p => !isModuleLocked(lockedMap, p.school_id, 'parents'));
    if (search) items = items.filter(p => `${p.profiles?.full_name || ''} ${p.profiles?.email || ''} ${p.student_id}`.toLowerCase().includes(search));
    // Deduplicate by parent_user_id
    const seen = new Set();
    const unique = items.filter(p => {
      if (seen.has(p.parent_user_id)) return false;
      seen.add(p.parent_user_id);
      return true;
    });
    if (unique.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = unique.map(p => {
      const wardCount = items.filter(x => x.parent_user_id === p.parent_user_id).length;
      return `<tr>
        <td><strong>${p.profiles?.full_name || 'Unknown'}</strong></td>
        <td>${p.profiles?.email || '-'}</td>
        <td>${wardCount} ward(s)</td>
        <td>${p.schools?.name || '—'}</td>
        <td>${p.created_at ? formatDate(p.created_at) : '-'}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load parents:', err); }
}

// ================================================================
// ALL ACCOUNTANTS
// ================================================================

async function loadAllAccountants() {
  const tbody = getEl('superAccountantsBody');
  const noEl = getEl('superNoAccountants');
  if (!tbody) return;
  const search = (getEl('superAccountantsSearch')?.value || '').toLowerCase();
  const schoolId = getEl('superAccountantsSchool')?.value || '';
  try {
    const { data, error } = await supabaseClient.from('accountants')
      .select('*, schools(name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load accountants error:', error); return; }
    let items = data || [];
    // Filter out accountants from schools where the accountants module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(a => !isModuleLocked(lockedMap, a.school_id, 'accountants'));
    if (schoolId) items = items.filter(a => a.school_id === schoolId);
    if (search) items = items.filter(a => `${a.full_name} ${a.email || ''} ${a.registration_id || ''}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(a => {
      const regInfo = a.registration_id ? `<br><small style="color:var(--text-muted);font-size:0.75rem;">🔑 ${a.registration_id}</small>` : '';
      const regStatus = a.user_id
        ? '<span style="color:var(--success);font-size:0.75rem;">✅ Registered</span>'
        : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not registered</span>';
      return `<tr>
        <td><span class="dash-photo-placeholder">🧾</span></td>
        <td><strong>${a.full_name}</strong>${regInfo}</td>
        <td>${a.email || '-'}</td>
        <td>${a.phone || '-'}</td>
        <td>${a.schools?.name || '—'}</td>
        <td>${regStatus}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load accountants:', err); }
}

// ================================================================
// ALL ANNOUNCEMENTS
// ================================================================

async function loadAllAnnouncements() {
  const container = getEl('superAnnouncementsList');
  const noEl = getEl('superNoAnnouncements');
  if (!container) return;
  const search = (getEl('superAnnouncementsSearch')?.value || '').toLowerCase();
  const priority = getEl('superAnnouncementsPriority')?.value || '';
  try {
    const { data, error } = await supabaseClient.from('announcements')
      .select('*, schools(name), profiles(full_name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load announcements error:', error); return; }
    let items = data || [];
    // Filter out announcements from schools where the announcements module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(a => !isModuleLocked(lockedMap, a.school_id, 'announcements'));
    if (priority) items = items.filter(a => a.priority === priority);
    if (search) items = items.filter(a => `${a.title} ${a.content}`.toLowerCase().includes(search));
    if (items.length === 0) { container.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    const priorityColors = { low: 'var(--secondary)', normal: 'var(--primary)', high: 'var(--warning)', urgent: 'var(--danger)' };
    container.innerHTML = items.map(a => `
      <div class="announcement-item" style="border-left:4px solid ${priorityColors[a.priority] || 'var(--primary)'};">
        <div class="announcement-header">
          <strong>${a.title}</strong>
          <span class="announcement-priority" style="background:${priorityColors[a.priority] || 'var(--primary)'};color:#fff;padding:0.15rem 0.5rem;border-radius:20px;font-size:0.65rem;text-transform:uppercase;">${a.priority}</span>
        </div>
        <p>${a.content}</p>
        <div class="announcement-meta">
          <span>🏫 ${a.schools?.name || '—'}</span>
          <span>👤 ${a.profiles?.full_name || '—'}</span>
          <span>📅 ${formatDate(a.created_at)}</span>
          <span>${a.is_active ? '<span class="badge-confirmed">Active</span>' : '<span class="badge-unconfirmed">Inactive</span>'}</span>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error('Failed to load announcements:', err); }
}

// ================================================================
// ATTENDANCE (Read-only Oversight)
// ================================================================

async function loadAttendancePage() {
  const tbody = getEl('superAttBody');
  const noEl = getEl('superNoAttendance');
  if (!tbody) return;
  const date = getEl('superAttDate')?.value || new Date().toISOString().split('T')[0];
  const schoolId = getEl('superAttSchool')?.value || '';
  const classFilter = getEl('superAttClass')?.value || '';
  const statusFilter = getEl('superAttStatus')?.value || '';

  try {
    let query = supabaseClient.from('attendance')
      .select('*, applications!inner(first_name, last_name, student_id, class_applying, school_id), schools(name)')
      .eq('date', date);
    const { data, error } = await query;
    if (error) { console.error('Load attendance error:', error); return; }
    let items = data || [];
    // Filter out attendance from schools where the attendance module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(a => !isModuleLocked(lockedMap, a.applications?.school_id, 'attendance'));
    if (schoolId) items = items.filter(a => a.applications?.school_id === schoolId);
    if (classFilter) items = items.filter(a => a.class_name === classFilter);
    if (statusFilter) items = items.filter(a => a.status === statusFilter);

    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';

    // Update stats
    const total = items.length;
    const present = items.filter(a => a.status === 'present').length;
    const absent = items.filter(a => a.status === 'absent').length;
    getEl('superAttPresent').textContent = present;
    getEl('superAttAbsent').textContent = absent;
    getEl('superAttTotal').textContent = total;
    getEl('superAttStats').style.display = 'flex';

    tbody.innerHTML = items.map(a => {
      const name = a.applications ? `${a.applications.first_name} ${a.applications.last_name}` : a.student_id;
      const statusColors = { present: 'var(--success)', absent: 'var(--danger)' };
      return `<tr>
        <td>${a.applications?.student_id || a.student_id}</td>
        <td>${name}</td>
        <td>${a.class_name}</td>
        <td>${a.schools?.name || '—'}</td>
        <td><span style="color:${statusColors[a.status] || 'var(--text-muted)'};font-weight:700;">${a.status.toUpperCase()}</span></td>
        <td>${a.remarks || '-'}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Failed to load attendance:', err); }
}

async function populateSuperAttClasses() {
  const schoolId = getEl('superAttSchool')?.value || '';
  const select = getEl('superAttClass');
  if (!select) return;
  try {
    let query = supabaseClient.from('classes').select('name');
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data } = await query.order('name');
    const classes = data || [];
    select.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch (err) { console.error(err); }
}

// ================================================================
// EXAMS (Read-only Oversight)
// ================================================================

async function loadExamsPage() {
  const tbody = getEl('superExamsBody');
  const noEl = getEl('superNoExams');
  if (!tbody) return;
  const search = (getEl('superExamsSearch')?.value || '').toLowerCase();
  const schoolId = getEl('superExamsSchool')?.value || '';
  const term = getEl('superExamsTerm')?.value || '';
  const status = getEl('superExamsStatus')?.value || '';

  try {
    const { data, error } = await supabaseClient.from('exams')
      .select('*, schools(name)')
      .order('created_at', { ascending: false });
    if (error) { console.error('Load exams error:', error); return; }
    let items = data || [];
    // Filter out exams from schools where the exams module is locked
    const lockedMap = await getAllLockedModules();
    items = items.filter(e => !isModuleLocked(lockedMap, e.school_id, 'exams'));
    if (schoolId) items = items.filter(e => e.school_id === schoolId);
    if (term) items = items.filter(e => e.term === term);
    if (status === 'active') items = items.filter(e => e.is_active);
    else if (status === 'inactive') items = items.filter(e => !e.is_active);
    if (search) items = items.filter(e => `${e.name}`.toLowerCase().includes(search));
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(e => `
      <tr>
        <td><strong>${e.name}</strong></td>
        <td>${e.schools?.name || '—'}</td>
        <td>${e.academic_year}</td>
        <td>${e.term}</td>
        <td>${e.start_date ? formatDate(e.start_date) : '-'}</td>
        <td>${e.end_date ? formatDate(e.end_date) : '-'}</td>
        <td>${e.is_active ? '<span class="badge-confirmed">Active</span>' : '<span class="badge-unconfirmed">Inactive</span>'}</td>
      </tr>
    `).join('');
  } catch (err) { console.error('Failed to load exams:', err); }
}

// ================================================================
// SYSTEM SETTINGS
// ================================================================

async function loadSystemSettings() {
  try {
    const { data } = await supabaseClient.from('settings').select('*').eq('id', 'singleton').maybeSingle();
    if (data) {
      getEl('superSettingSchoolName').value = data.school_name || '';
      getEl('superSettingAcademicYear').value = data.academic_year || getCurrentAcademicYear();
      getEl('superSettingCurrentTerm').value = data.current_term || 'First';
    } else {
      // No settings row yet - prefill the academic year from today's date so
      // it is detected automatically rather than entered manually.
      getEl('superSettingAcademicYear').value = getCurrentAcademicYear();
    }
  } catch (err) { console.error('Failed to load settings:', err); }
}

async function saveSystemSettings(e) {
  e.preventDefault();
  clearMessage('superSettingsMessage');
  const btn = getEl('superSettingsSubmitBtn');
  setLoading(btn, true, 'Saving...');
  try {
    const { error } = await supabaseClient.from('settings').upsert({
      id: 'singleton',
      school_name: getEl('superSettingSchoolName').value.trim(),
      academic_year: getEl('superSettingAcademicYear').value.trim(),
      current_term: getEl('superSettingCurrentTerm').value,
    });
    if (error) throw error;
    showMessage('superSettingsMessage', '✅ System settings updated successfully.', 'success');
    // Update sidebar
    const schoolNameEl = getEl('superSidebarSchoolName');
    if (schoolNameEl) schoolNameEl.textContent = getEl('superSettingSchoolName').value.trim();
  } catch (err) { showMessage('superSettingsMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Save Settings'); }
}

// ================================================================
// PROFILE MANAGEMENT
// ================================================================

export function loadSuperAdminProfile() {
  const pwForm = getEl('superAdminPasswordForm');
  if (pwForm) {
    getEl('superProfilePassword').value = '';
    getEl('superProfileConfirmPassword').value = '';
  }
  clearMessage('superProfileMessage');
}

async function saveSuperAdminName(e) {
  e.preventDefault();
  clearMessage('superProfileMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Updating...');
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const fullName = getEl('superProfileName').value.trim();
    const { error: profileErr } = await supabaseClient.from('profiles').update({ full_name: fullName }).eq('id', user.id);
    if (profileErr) throw profileErr;
    showMessage('superProfileMessage', '✅ Name updated successfully.', 'success');
    const sidebarName = getEl('superSidebarName');
    if (sidebarName) sidebarName.textContent = fullName;
    const welcomeEl = getEl('superAdminWelcome');
    if (welcomeEl) welcomeEl.textContent = `Welcome, ${fullName}!`;
  } catch (err) { showMessage('superProfileMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Update Name'); }
}

async function saveSuperAdminPassword(e) {
  e.preventDefault();
  clearMessage('superProfileMessage');
  const newPw = getEl('superProfilePassword').value;
  const confirmPw = getEl('superProfileConfirmPassword').value;
  const btn = e.target.querySelector('button[type="submit"]');
  if (!newPw || newPw.length < 6) { showMessage('superProfileMessage', 'Password must be at least 6 characters.', 'error'); return; }
  if (newPw !== confirmPw) { showMessage('superProfileMessage', 'Passwords do not match.', 'error'); return; }
  setLoading(btn, true, 'Changing...');
  try {
    const { error: pwErr } = await supabaseClient.auth.updateUser({ password: newPw });
    if (pwErr) throw pwErr;
    showMessage('superProfileMessage', '✅ Password changed successfully.', 'success');
    getEl('superProfilePassword').value = '';
    getEl('superProfileConfirmPassword').value = '';
  } catch (err) { showMessage('superProfileMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Change Password'); }
}

// ================================================================
// SCHOOL MODULE LOCK / UNLOCK MANAGEMENT
// ================================================================

/**
 * Opens the module management panel for a specific school.
 * Fetches all modules with their lock status and renders toggle buttons.
 */
async function openSchoolModulesManager(schoolId, schoolName) {
  const section = getEl('schoolModulesSection');
  const nameEl = getEl('schoolModulesSchoolName');
  const idEl = getEl('schoolModulesSchoolId');
  const listEl = getEl('schoolModulesList');
  const msgEl = getEl('schoolModulesMessage');
  
  if (!section) {
    alert('Module management section not found. Are you on the Schools page?');
    return;
  }
  
  // Scroll to the section
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  nameEl.textContent = schoolName;
  idEl.value = schoolId;
  clearMessage('schoolModulesMessage');
  
  try {
    // Fetch all modules with lock status using the RPC function
    const { data: modules, error } = await supabaseClient.rpc('get_school_module_status', {
      p_school_id: schoolId,
    });
    
    if (error) {
      // Fallback: if RPC doesn't exist yet, fetch manually
      console.warn('RPC get_school_module_status not available, fetching manually:', error.message);
      const { data: allModules } = await supabaseClient.from('modules').select('*').order('sort_order');
      const { data: schoolMods } = await supabaseClient.from('school_modules').select('*').eq('school_id', schoolId);
      
      const lockMap = {};
      if (schoolMods) {
        schoolMods.forEach(sm => { lockMap[sm.module_name] = sm.is_locked; });
      }
      
      const modList = (allModules || []).map(m => ({
        module_name: m.name,
        label: m.label,
        icon: m.icon,
        is_core: m.is_core,
        is_locked: lockMap[m.name] || false,
        sort_order: m.sort_order,
      }));
      
      renderModuleToggles(modList, listEl, schoolId, msgEl);
    } else {
      renderModuleToggles(modules || [], listEl, schoolId, msgEl);
    }
  } catch (err) {
    console.error('Failed to load modules:', err);
    listEl.innerHTML = '<p style="color:var(--danger);">Error loading modules. Please try again.</p>';
  }
}

/**
 * Renders toggle cards for each module showing lock/unlock status.
 */
function renderModuleToggles(modules, listEl, schoolId, msgEl) {
  if (!modules || modules.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-muted);">No modules found in the system.</p>';
    return;
  }
  
  listEl.innerHTML = modules.map(m => {
    const isLocked = m.is_locked;
    const isCore = m.is_core;
    const lockBtnClass = isLocked ? 'btn-danger' : 'btn-secondary';
    const lockIcon = isLocked ? '🔒' : '🔓';
    const lockLabel = isLocked ? 'Locked' : 'Active';
    const coreLabel = isCore ? '<span style="font-size:0.65rem;color:var(--text-muted);margin-left:0.5rem;">(core)</span>' : '';
    
    return `
      <div class="module-lock-card" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);">
        <span style="font-size:1.5rem;">${m.icon}</span>
        <div style="flex:1;">
          <strong>${m.label}</strong> ${coreLabel}
          <div style="font-size:0.75rem;color:var(--text-muted);">${m.module_name}</div>
        </div>
        <button type="button" class="btn btn-sm ${lockBtnClass}" onclick="toggleSchoolModuleLock('${schoolId}', '${m.module_name}', ${isLocked})" ${isCore ? 'disabled' : ''}>
          ${lockIcon} ${lockLabel}
        </button>
      </div>
    `;
  }).join('');
}

/**
 * Toggles the lock status of a module for a school.
 * Inserts or updates the school_modules record.
 * Also refreshes the super admin dashboard to reflect the change.
 */
window.toggleSchoolModuleLock = async function(schoolId, moduleName, isCurrentlyLocked) {
  try {
    const newLockStatus = !isCurrentlyLocked;
    const action = newLockStatus ? 'Locked' : 'Unlocked';
    
    // Upsert: insert if not exists, update if exists
    const { error } = await supabaseClient.from('school_modules').upsert({
      school_id: schoolId,
      module_name: moduleName,
      is_locked: newLockStatus,
    }, {
      onConflict: 'school_id, module_name',
    });
    
    if (error) {
      showMessage('schoolModulesMessage', `Error: ${error.message}`, 'error');
      return;
    }
    
    showMessage('schoolModulesMessage', `✅ Module "${moduleName}" ${action} for this school.`, 'success');
    
    // Clear the locked modules cache so the dashboard reflects the change
    clearLockedModulesCache();
    
    // Refresh the module list
    const schoolIdEl = getEl('schoolModulesSchoolId');
    const schoolNameEl = getEl('schoolModulesSchoolName');
    if (schoolIdEl && schoolNameEl) {
      await openSchoolModulesManager(schoolIdEl.value, schoolNameEl.textContent);
    }
    
    // Refresh dashboard stats to reflect the lock change
    await loadDashboardStats();
  } catch (err) {
    showMessage('schoolModulesMessage', `Error: ${err.message}`, 'error');
  }
};