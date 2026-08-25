/**
 * Teacher Dashboard Module - Full-featured classroom management
 * 
 * Teachers can view their class students, mark attendance with full UI,
 * manage exams (score entry, rankings, report cards), and update profile.
 * 
 * Enhanced with date-range filtering, daily view, and instant report after save.
 * Updated to support multiple class and subject assignments.
 */

import { getEl, showMessage, clearMessage, setLoading, buildStudentName, formatDate, statusBadge, getGrade, getSubjectGrade, getPerformanceLevel, getTeacherRemarks, getHeadTeacherRemarks, formatCurrency, getCurrentSchoolId, getCurrentSchoolInitials, openPrintWindow, logStaffActivity } from './utils.js';
import { uploadToCloudinary, isCloudinaryReady, getCloudinaryPublicIdFromUrl, deleteCloudinaryFile } from './cloudinary.js';
import { loadTeacherAssessmentsPage } from './teacher-assessments.js';

let supabaseClient = null;
let teacherAttendanceCache = [];
let teacherScoreCache = {};

export function initTeacherDashboard(supabase) {
  supabaseClient = supabase;
}

export function setupTeacherDashboard() {
  // Sidebar navigation
  document.querySelectorAll('#teacherSidebar .dash-nav-link[data-teacher-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-teacher-page');
      document.querySelectorAll('#teacherSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.teacher-subpage').forEach((p) => p.classList.remove('active-subpage'));
      const target = getEl('teacherPage-' + page);
      if (target) target.classList.add('active-subpage');
      const titles = {
        dashboard: '⭐ Dashboard',
        students: '👥 My Students',
        attendance: '📋 Attendance Management',
        exams: '📝 Exams & Scores',
        assessments: '❓ Assessments',
        profile: '👤 My Profile'
      };
      const titleEl = getEl('teacherDashTitle');
      if (titleEl && titles[page]) titleEl.textContent = titles[page];
      switch (page) {
        case 'dashboard': loadTeacherDashboardStats(); break;
        case 'students': loadTeacherStudents(); break;
        case 'attendance': loadTeacherAttendancePage(); break;
        case 'exams': loadTeacherExamsPage(); break;
        case 'assessments': loadTeacherAssessmentsPage(); break;
      }
    });
  });

  // Attendance listeners
  getEl('teacherBtnLoadAttendance')?.addEventListener('click', loadTeacherAttendanceForDate);
  getEl('teacherBtnSaveAttendance')?.addEventListener('click', saveTeacherAttendance);
  getEl('teacherBtnViewReport')?.addEventListener('click', loadTeacherAttReport);
  getEl('teacherAttClass')?.addEventListener('change', () => {});
  getEl('teacherAttDate')?.addEventListener('change', () => {});

  // Report filters
  getEl('teacherAttReportSearch')?.addEventListener('input', renderTeacherAttReport);
  getEl('teacherAttReportTerm')?.addEventListener('change', renderTeacherAttReport);
  getEl('teacherAttReportDateFrom')?.addEventListener('change', renderTeacherAttReport);
  getEl('teacherAttReportDateTo')?.addEventListener('change', renderTeacherAttReport);
  
  // Report mode toggle
  getEl('teacherBtnAttReportSummary')?.addEventListener('click', () => switchTeacherReportMode('summary'));
  getEl('teacherBtnAttReportDaily')?.addEventListener('click', () => switchTeacherReportMode('daily'));
  getEl('teacherBtnPrintAttDailyReport')?.addEventListener('click', printTeacherAttDailyReport);

  // Teacher 30-Day Mode listeners
  getEl('teacherAttModeDaily')?.addEventListener('click', () => switchTeacherAttendanceMode('daily'));
  getEl('teacherAttModeMonthly')?.addEventListener('click', () => switchTeacherAttendanceMode('monthly'));
  getEl('teacherBtnLoadMonthlyAttendance')?.addEventListener('click', loadTeacherMonthlyAttendance);
  getEl('teacherBtnSaveMonthlyAttendance')?.addEventListener('click', saveTeacherMonthlyAttendance);
  getEl('teacherBtnSetAllPresent')?.addEventListener('click', () => setTeacherAllMonthlyStatus('present'));
  getEl('teacherBtnSetAllAbsent')?.addEventListener('click', () => setTeacherAllMonthlyStatus('absent'));
  getEl('teacherBtnResetMonthlyAttendance')?.addEventListener('click', resetTeacherAllMonthlyStatus);

  // Exam listeners
  getEl('teacherBtnLoadExamStudents')?.addEventListener('click', loadTeacherExamStudents);
  getEl('teacherExamSelect')?.addEventListener('change', () => {});
  getEl('teacherExamClass')?.addEventListener('change', () => {});
  getEl('teacherExamSubject')?.addEventListener('change', () => {});
  getEl('teacherBtnSaveScores')?.addEventListener('click', saveTeacherExamScores);
  getEl('teacherBtnAutoRank')?.addEventListener('click', autoRankTeacherSubjects);
  getEl('teacherBtnPrintReportCards')?.addEventListener('click', printTeacherReportCards);

  // Student search/filter listeners
  getEl('teacherStudentsSearch')?.addEventListener('input', loadTeacherStudents);
  getEl('teacherStudentsClass')?.addEventListener('change', loadTeacherStudents);
  getEl('teacherStudentsGender')?.addEventListener('change', loadTeacherStudents);
  getEl('teacherStudentsStatus')?.addEventListener('change', loadTeacherStudents);

  // Profile form
  getEl('teacherProfileForm')?.addEventListener('submit', saveTeacherProfile);
  getEl('teacherProfileDob')?.addEventListener('change', autoCalculateTeacherAge);
  getEl('teacherProfilePhoto')?.addEventListener('change', previewTeacherPhoto);
}

function switchTeacherReportMode(mode) {
  document.querySelectorAll('.teacher-att-report-mode').forEach(b => b.classList.remove('active'));
  if (mode === 'summary') {
    getEl('teacherBtnAttReportSummary')?.classList.add('active');
    getEl('teacherAttReportSummaryTable').style.display = '';
    getEl('teacherAttReportDailyTable').style.display = 'none';
  } else {
    getEl('teacherBtnAttReportDaily')?.classList.add('active');
    getEl('teacherAttReportSummaryTable').style.display = 'none';
    getEl('teacherAttReportDailyTable').style.display = '';
  }
  // Re-render the report to populate the currently active view
  renderTeacherAttReport();
}

/**
 * Get teacher's assigned classes from the junction table.
 * Falls back to registration_id from user metadata if user_id is not linked,
 * and self-heals the link so the teacher record is found on any device.
 */
async function getTeacherClasses(userId) {
  try {
    // Try to get from junction table first
    let { data: teacher } = await supabaseClient.from('teachers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    // If not found by user_id, try registration_id from user metadata (self-heal)
    if (!teacher) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const regId = user?.user_metadata?.registration_id || null;
      
      if (regId) {
        // Look up by registration_id
        const { data: byReg } = await supabaseClient.from('teachers')
          .select('*')
          .eq('registration_id', regId)
          .maybeSingle();
        
        if (byReg) {
          // Self-heal: link the teacher record to this user
          try {
            await supabaseClient.rpc('auto_approve_teacher_on_login', { 
              p_user_id: userId, 
              p_registration_id: regId 
            });
          } catch (healErr) {
            console.warn('auto_approve_teacher_on_login RPC failed in getTeacherClasses:', healErr.message);
            try {
              await supabaseClient.from('teachers')
                .update({ user_id: userId })
                .eq('registration_id', regId);
            } catch (updateErr) {
              console.warn('Direct teacher link fallback failed:', updateErr.message);
            }
          }
          teacher = byReg;
        }
      }
    }
    
    if (!teacher) return { classes: [], subjects: [], teacher };
    
    // Get from junction table
    const { data: assignments } = await supabaseClient.from('teacher_classes_subjects')
      .select('class_name, subject_name')
      .eq('teacher_id', teacher.id);
    
    if (assignments && assignments.length > 0) {
      const classes = [...new Set(assignments.map(a => a.class_name))].sort();
      const subjects = [...new Set(assignments.map(a => a.subject_name))].sort();
      return { classes, subjects, teacher };
    }
    
    // Fallback to comma-separated values
    const classes = teacher.class_taught 
      ? teacher.class_taught.split(',').map(c => c.trim()).filter(Boolean)
      : [];
    const subjects = teacher.subject 
      ? teacher.subject.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    
    return { classes, subjects, teacher };
  } catch (err) {
    console.error('Failed to get teacher classes:', err);
    return { classes: [], subjects: [], teacher: null };
  }
}

export async function loadTeacherDashboard(user) {
  const welcomeEl = getEl('teacherWelcome');
  const sidebarName = getEl('teacherSidebarName');
  if (!user) return;

  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  const teacherName = profile?.full_name || 'Teacher';
  if (welcomeEl) welcomeEl.textContent = `Welcome, ${teacherName}!`;
  if (sidebarName) sidebarName.textContent = teacherName;

  // Get teacher's assigned classes and subjects
  const { classes, subjects, teacher } = await getTeacherClasses(user.id);

  if (teacher) {
    const classInfo = getEl('teacherClassInfo');
    if (classInfo) {
      const classStr = classes.length > 0 ? classes.join(', ') : 'Not assigned';
      const subjectStr = subjects.length > 0 ? subjects.join(', ') : '—';
      classInfo.textContent = `Classes: ${classStr} | Subjects: ${subjectStr}`;
    }
    // Backfill profile school_id if it's NULL (fixes new-device login where
    // the profile may have been created without a school_id)
    if (!profile?.school_id && teacher.school_id) {
      try {
        await supabaseClient.from('profiles')
          .update({ school_id: teacher.school_id })
          .eq('id', user.id);
      } catch (backfillErr) {
        console.warn('Failed to backfill profile school_id:', backfillErr.message);
      }
    }
    // Load teacher profile form
    await loadTeacherProfileForm(teacher);
  }

  // Set default date
  const dateInput = getEl('teacherAttDate');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  await loadTeacherDashboardStats();
  await loadTeacherStudents();
}

// ================================================================
// DASHBOARD STATS
// ================================================================

async function loadTeacherDashboardStats() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { classes } = await getTeacherClasses(user.id);
    if (classes.length === 0) return;

    let totalStudents = 0, admitted = 0, pending = 0, male = 0, female = 0;
    
    const { teacher } = await getTeacherClasses(user.id);
    const teacherSchoolId = teacher?.school_id || null;

    for (const cls of classes) {
      let totalQuery = supabaseClient.from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('class_applying', cls);
      if (teacherSchoolId) totalQuery = totalQuery.eq('school_id', teacherSchoolId);
      const { count: total } = await totalQuery;
      totalStudents += total || 0;

      let admQuery = supabaseClient.from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('class_applying', cls)
        .eq('status', 'admitted');
      if (teacherSchoolId) admQuery = admQuery.eq('school_id', teacherSchoolId);
      const { count: adm } = await admQuery;
      admitted += adm || 0;

      let penQuery = supabaseClient.from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('class_applying', cls)
        .eq('status', 'pending');
      if (teacherSchoolId) penQuery = penQuery.eq('school_id', teacherSchoolId);
      const { count: pen } = await penQuery;
      pending += pen || 0;

      let mQuery = supabaseClient.from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('class_applying', cls)
        .eq('gender', 'Male');
      if (teacherSchoolId) mQuery = mQuery.eq('school_id', teacherSchoolId);
      const { count: m } = await mQuery;
      male += m || 0;

      let fQuery = supabaseClient.from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('class_applying', cls)
        .eq('gender', 'Female');
      if (teacherSchoolId) fQuery = fQuery.eq('school_id', teacherSchoolId);
      const { count: f } = await fQuery;
      female += f || 0;
    }

    getEl('teacherStatTotal').textContent = totalStudents;
    getEl('teacherStatAdmitted').textContent = admitted;
    getEl('teacherStatPending').textContent = pending;
    getEl('teacherStatMale').textContent = male;
    getEl('teacherStatFemale').textContent = female;

    // Load today's attendance summary for the teacher's classes
    await loadTeacherTodayAttendance(classes);

  } catch (err) {
    console.error('Failed to load teacher stats:', err);
  }
}

// ================================================================
// TODAY'S ATTENDANCE BY CLASS (Dashboard card)
// ================================================================

/**
 * Loads today's attendance for the teacher's assigned classes and renders
 * a summary card showing only Present and Absent counts per class.
 */
async function loadTeacherTodayAttendance(classes) {
  const container = getEl('teacherTodayAttendance');
  if (!container) return;
  try {
    const schoolId = await getCurrentSchoolId();
    const today = new Date().toISOString().slice(0, 10);

    let query = supabaseClient
      .from('attendance')
      .select('class_name, status')
      .eq('date', today)
      .in('class_name', classes.length ? classes : ['__none__']);
    if (schoolId) query = query.eq('school_id', schoolId);

    const { data, error } = await query;
    if (error) {
      console.warn('Failed to fetch today\'s attendance:', error.message);
      container.innerHTML = '';
      return;
    }

    // Group by class, counting only present/absent (excludes late/excused)
    const grouped = {};
    (data || []).forEach(r => {
      if (!r.class_name) return;
      if (!grouped[r.class_name]) grouped[r.class_name] = { present: 0, absent: 0 };
      if (r.status === 'present') grouped[r.class_name].present++;
      else if (r.status === 'absent') grouped[r.class_name].absent++;
    });

    const list = Object.keys(grouped).sort().map(cls => ({ class_name: cls, ...grouped[cls] }));

    if (list.length === 0) {
      container.innerHTML = `
        <div class="dash-list-card animated-card dash-attendance-card">
          <div class="dash-list-header">
            <h3>📋 Today's Attendance</h3>
            <span class="dash-list-count">0 classes</span>
          </div>
          <div class="dash-list-body">
            <div class="dash-empty" style="padding:1rem;text-align:center;color:var(--text-muted);">No attendance marked today for your classes.</div>
          </div>
        </div>`;
      return;
    }

    const totalPresent = list.reduce((s, c) => s + c.present, 0);
    const totalAbsent = list.reduce((s, c) => s + c.absent, 0);

    container.innerHTML = `
      <div class="dash-list-card animated-card dash-attendance-card" style="margin-top:1rem;">
        <div class="dash-list-header">
          <h3>📋 Today's Attendance</h3>
          <span class="dash-list-count">${list.length} classes</span>
        </div>
        <div class="dash-list-body">
          <div class="dash-att-summary">
            <div class="dash-att-row dash-att-header">
              <span class="dash-att-class">Class</span>
              <span class="dash-att-count present">Present</span>
              <span class="dash-att-count absent">Absent</span>
              <span class="dash-att-count">Total</span>
            </div>
            ${list.map(cls => `
              <div class="dash-att-row" data-class="${cls.class_name}">
                <span class="dash-att-class">${cls.class_name}</span>
                <span class="dash-att-count present">${cls.present}</span>
                <span class="dash-att-count absent">${cls.absent}</span>
                <span class="dash-att-count">${cls.present + cls.absent}</span>
              </div>
            `).join('')}
            <div class="dash-att-row dash-att-total">
              <span class="dash-att-class">All My Classes</span>
              <span class="dash-att-count present">${totalPresent}</span>
              <span class="dash-att-count absent">${totalAbsent}</span>
              <span class="dash-att-count">${totalPresent + totalAbsent}</span>
            </div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    console.error('Failed to load today\'s attendance:', err);
  }
}

// ================================================================
// MY STUDENTS
// ================================================================

async function loadTeacherStudents() {
  const tbody = getEl('teacherStudentsBody');
  const noEl = getEl('teacherNoStudents');
  if (!tbody) return;

  const search = (getEl('teacherStudentsSearch')?.value || '').toLowerCase();
  const classFilter = getEl('teacherStudentsClass')?.value || '';
  const genderFilter = getEl('teacherStudentsGender')?.value || '';
  const statusFilter = getEl('teacherStudentsStatus')?.value || '';

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { classes, teacher } = await getTeacherClasses(user.id);

    // Populate the class filter; only show it when the teacher has multiple classes
    const classSel = getEl('teacherStudentsClass');
    if (classSel) {
      classSel.innerHTML = '<option value="">All Classes</option>' +
        classes.map(c => `<option value="${c}">${c}</option>`).join('');
      classSel.style.display = classes.length > 1 ? '' : 'none';
    }

    if (classes.length === 0) {
      if (noEl) { noEl.style.display = 'block'; noEl.textContent = 'No classes assigned to you yet.'; }
      tbody.innerHTML = '';
      return;
    }

    // Load students from ALL assigned classes
    let allStudents = [];
    let lastError = null;
    for (const cls of classes) {
      let studentsQuery = supabaseClient.from('applications')
        .select('*')
        .eq('class_applying', cls);
      if (teacher?.school_id) {
        studentsQuery = studentsQuery.eq('school_id', teacher.school_id);
      }
      studentsQuery = studentsQuery.order('last_name', { ascending: true });
      const { data: students, error } = await studentsQuery;
      if (error) {
        lastError = error;
        console.error(`Load students error for class ${cls}:`, error);
      }
      if (students) {
        allStudents = allStudents.concat(students);
      }
    }

    if (lastError && allStudents.length === 0) { console.error('Load students error:', lastError); return; }
    let items = allStudents || [];
    if (classFilter) items = items.filter(s => s.class_applying === classFilter);
    if (genderFilter) items = items.filter(s => s.gender === genderFilter);
    if (statusFilter) items = items.filter(s => s.status === statusFilter);
    if (search) items = items.filter(s => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
      return name.includes(search) || s.student_id.toLowerCase().includes(search) || s.parent_name.toLowerCase().includes(search);
    });
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) { noEl.style.display = 'block'; noEl.textContent = 'No students found matching your criteria.'; } return; }
    if (noEl) noEl.style.display = 'none';

    tbody.innerHTML = items.map((s, idx) => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
      const photoHtml = s.student_photo_url
        ? `<img src="${s.student_photo_url}" class="dash-photo" />`
        : '<span class="dash-photo-placeholder">📷</span>';
      return `<tr>
        <td>${idx + 1}</td>
        <td>${photoHtml}</td>
        <td><strong>${s.student_id}</strong></td>
        <td>${name}</td>
        <td>${s.gender || 'Male'}</td>
        <td>${s.class_applying || '-'}</td>
        <td>${s.parent_name}</td>
        <td>${s.parent_contact}</td>
        <td>${statusBadge(s.status)}</td>
        <td>${s.portal_confirmed ? '<span class="badge-confirmed">✅ Confirmed</span>' : '<span class="badge-unconfirmed">⏳ Not yet</span>'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load teacher students:', err);
  }
}

// ================================================================
// FULL ATTENDANCE MANAGEMENT
// ================================================================

async function loadTeacherAttendancePage() {
  const dateInput = getEl('teacherAttDate');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  
  // Populate class filter with all assigned classes
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  
  const { classes } = await getTeacherClasses(user.id);
  const classSel = getEl('teacherAttClass');
  if (classSel) {
    if (classes.length > 0) {
      classSel.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    } else {
      classSel.innerHTML = '<option value="">— No classes assigned —</option>';
    }
  }
  
  // Hide stats
  getEl('teacherAttStats').style.display = 'none';
  const tbody = getEl('teacherAttBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Select date and click "Load Attendance" to begin.</td></tr>';
  // Hide report
  getEl('teacherAttReportSection').style.display = 'none';
}

async function loadTeacherAttendanceForDate() {
  const dateInput = getEl('teacherAttDate');
  const classFilter = getEl('teacherAttClass')?.value || '';
  const date = dateInput?.value;
  if (!date) { alert('Please select a date.'); return; }
  if (!classFilter) { alert('No class assigned to you.'); return; }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const schoolId = await getCurrentSchoolId();
  let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
  if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
  const { data: settings } = await settingsQuery.maybeSingle();
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  const { teacher } = await getTeacherClasses(user.id);

  let query = supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('status', 'admitted')
    .eq('class_applying', classFilter);
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('first_name', { ascending: true });
  const { data: apps, error: appsErr } = await query;
  if (appsErr) { console.error('Load apps error:', appsErr); return; }
  if (!apps || apps.length === 0) {
    getEl('teacherNoAttendance').style.display = 'block';
    getEl('teacherAttBody').innerHTML = '';
    return;
  }

  let existingAttQuery = supabaseClient.from('attendance').select('*').eq('date', date).eq('class_name', classFilter);
  if (schoolId) existingAttQuery = existingAttQuery.eq('school_id', schoolId);
  const { data: existingAtt } = await existingAttQuery;
  const attMap = new Map((existingAtt || []).map(a => [a.student_id, a]));

  teacherAttendanceCache = apps.map(app => {
    const existing = attMap.get(app.student_id);
    return {
      student_id: app.student_id,
      name: buildStudentName(app.first_name, app.middle_name, app.last_name),
      class_applying: app.class_applying,
      date: date,
      status: existing?.status || 'present',
      remarks: existing?.remarks || '',
      id: existing?.id || null,
      is_locked: !!existing?.id, // Lock if attendance was already marked
      academic_year: existing?.academic_year || academicYear,
      term: existing?.term || currentTerm,
    };
  });

  renderTeacherAttendanceTable();
}

function renderTeacherAttendanceTable() {
  const tbody = getEl('teacherAttBody');
  const stats = getEl('teacherAttStats');
  if (!tbody) return;

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  teacherAttendanceCache.forEach(a => { counts[a.status]++; });
  const total = teacherAttendanceCache.length;

  if (stats) {
    stats.style.display = 'flex';
    getEl('teacherAttPresent').textContent = counts.present;
    getEl('teacherAttAbsent').textContent = counts.absent;
    getEl('teacherAttLate').textContent = counts.late;
    getEl('teacherAttExcused').textContent = counts.excused;
    getEl('teacherAttTotal').textContent = total;
  }
  getEl('teacherNoAttendance').style.display = 'none';

  if (teacherAttendanceCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = teacherAttendanceCache.map((a, idx) => {
    const locked = a.is_locked;
    const statusBtns = ['present', 'absent', 'late', 'excused'].map(s => {
      const active = a.status === s ? ' active' : '';
      const icons = { present: '✓', absent: '✗', late: '⏰', excused: '🏥' };
      const disabled = locked ? ' disabled' : '';
      return `<button type="button" class="att-status-btn ${s}${active}${disabled}" data-student="${a.student_id}" data-status="${s}" ${locked ? 'title="Already marked - only admin can edit"' : ''}>${icons[s]}</button>`;
    }).join(' ');

    const lockBadge = locked 
      ? '<span style="display:inline-block;margin-left:0.35rem;font-size:0.65rem;padding:0.1rem 0.4rem;background:rgba(100,116,139,0.12);color:var(--secondary);border-radius:4px;white-space:nowrap;">🔒 Locked</span>' 
      : '';

    const remarksDisabled = locked ? ' disabled' : '';
    const remarksPlaceholder = locked ? 'Already marked - admin only' : 'Optional...';

    return `<tr>
      <td>${idx + 1}</td>
      <td><strong>${a.student_id}</strong></td>
      <td>${a.name}</td>
      <td>${a.class_applying}</td>
      <td class="att-status-cell">${statusBtns}${lockBadge}</td>
      <td><input type="text" class="att-remarks-input" data-student="${a.student_id}" value="${a.remarks}" placeholder="${remarksPlaceholder}" ${remarksDisabled} style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;font-family:inherit;${locked ? 'background:rgba(226,232,240,0.3);color:var(--text-muted);' : ''}" /></td>
    </tr>`;
  }).join('');

  // Attach event listeners (skip locked rows)
  tbody.querySelectorAll('.att-status-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const studentId = btn.dataset.student;
      const newStatus = btn.dataset.status;
      const row = teacherAttendanceCache.find(a => a.student_id === studentId);
      if (!row) return;
      row.status = newStatus;
      const parentCell = btn.closest('.att-status-cell');
      parentCell.querySelectorAll('.att-status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateTeacherAttStats();
    });
  });

  tbody.querySelectorAll('.att-remarks-input:not([disabled])').forEach(inp => {
    inp.addEventListener('input', () => {
      const studentId = inp.dataset.student;
      const row = teacherAttendanceCache.find(a => a.student_id === studentId);
      if (row) row.remarks = inp.value;
    });
  });

  // Show lock notice if any records are locked
  const hasLocked = teacherAttendanceCache.some(a => a.is_locked);
  const lockNotice = getEl('teacherAttLockNotice');
  if (lockNotice) {
    lockNotice.style.display = hasLocked ? 'block' : 'none';
  }
}

function updateTeacherAttStats() {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  teacherAttendanceCache.forEach(a => { counts[a.status]++; });
  getEl('teacherAttPresent').textContent = counts.present;
  getEl('teacherAttAbsent').textContent = counts.absent;
  getEl('teacherAttLate').textContent = counts.late;
  getEl('teacherAttExcused').textContent = counts.excused;
  getEl('teacherAttTotal').textContent = teacherAttendanceCache.length;
}

async function saveTeacherAttendance() {
  if (teacherAttendanceCache.length === 0) { alert('No attendance records to save.'); return; }
  const btn = getEl('teacherBtnSaveAttendance');
  setLoading(btn, true, 'Saving...');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    const settingsSchoolId = await getCurrentSchoolId();
    if (settingsSchoolId) settingsQuery = settingsQuery.eq('school_id', settingsSchoolId);
    const { data: settings } = await settingsQuery.maybeSingle();
    const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const currentTerm = settings?.current_term || 'First';

    // Get teacher's school_id so attendance records are properly linked
    const { data: teacherInfo } = await supabaseClient.from('teachers')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const schoolId = teacherInfo?.school_id || null;

    // First, look up ALL existing attendance records for this date
    // to find any records that might exist but weren't loaded due to RLS
    const studentIds = teacherAttendanceCache.map(r => r.student_id);
    const { data: allExisting } = await supabaseClient
      .from('attendance')
      .select('id, student_id')
      .eq('date', teacherAttendanceCache[0].date)
      .in('student_id', studentIds);
    const existingMap = new Map((allExisting || []).map(a => [a.student_id, a.id]));

    let saved = 0, updated = 0, skipped = 0;
    for (const record of teacherAttendanceCache) {
      // Skip locked records - already marked attendance can only be edited by admin
      if (record.is_locked) {
        skipped++;
        continue;
      }

      const payload = {
        student_id: record.student_id,
        date: record.date,
        status: record.status,
        class_name: record.class_applying,
        academic_year: academicYear,
        term: currentTerm,
        remarks: record.remarks || '',
        marked_by: user?.id || null,
        school_id: schoolId,
      };

      // Use the ID from the broader lookup if available
      const existingId = existingMap.get(record.student_id) || record.id;

      if (existingId) {
        const { error } = await supabaseClient.from('attendance').update(payload).eq('id', existingId);
        if (!error) {
          updated++;
          record.id = existingId;
        } else {
          console.error('Teacher update attendance error for', record.student_id, error);
          throw new Error(`Failed to update attendance for ${record.student_id}: ${error.message}`);
        }
      } else {
        const { data, error } = await supabaseClient.from('attendance').insert([payload]).select();
        if (!error && data && data.length > 0) {
          saved++;
          record.id = data[0].id;
        } else {
          console.error('Teacher insert attendance error for', record.student_id, error);
          throw new Error(`Failed to save attendance for ${record.student_id}: ${error?.message || 'Unknown error'}`);
        }
      }
    }

    const skipMsg = skipped > 0 ? ` (${skipped} locked records skipped - admin only)` : '';
    showMessage('teacherAttMessage', `✅ Attendance saved! ${saved} new, ${updated} updated.${skipMsg}`, 'success');
    try { await logStaffActivity(`Marked attendance for ${teacherAttendanceCache.length} students (${saved} new, ${updated} updated)`, { role: 'teacher', entityType: 'attendance', entityDetails: `${teacherAttendanceCache[0]?.date || ''} · ${teacherAttendanceCache[0]?.class_applying || ''}` }); } catch (e) { /* noop */ }

    // Show instant report after saving
    const savedDate = teacherAttendanceCache[0]?.date;
    if (savedDate) {
      setTimeout(async () => {
        const reportSection = getEl('teacherAttReportSection');
        if (reportSection) {
          reportSection.style.display = 'block';
          getEl('teacherAttReportDateFrom').value = savedDate;
          getEl('teacherAttReportDateTo').value = savedDate;
          getEl('teacherAttReportTerm').value = currentTerm;
          const dateLabel = getEl('teacherAttReportDateLabel');
          if (dateLabel) dateLabel.textContent = savedDate;
          await renderTeacherAttReport();
          reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
    }

  } catch (err) {
    showMessage('teacherAttMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Save Attendance');
  }
}

async function printTeacherAttDailyReport() {
  const dailyBody = getEl('teacherAttReportDailyBody');
  if (!dailyBody || !dailyBody.innerHTML.trim()) { alert('No daily report data to print. Please switch to Daily View and refresh first.'); return; }
  
  // Fetch school name from settings with fallbacks
  let schoolName = getEl('settingSchoolName')?.value || 'My School';
  try {
    const schoolId = await getCurrentSchoolId();
    let settingsQuery = supabaseClient.from('settings').select('school_name').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const { data: settingsData } = await settingsQuery.maybeSingle();
    if (settingsData?.school_name) {
      schoolName = settingsData.school_name;
    } else if (schoolId) {
      const { data: schoolData } = await supabaseClient.from('schools').select('name').eq('id', schoolId).maybeSingle();
      if (schoolData?.name) schoolName = schoolData.name;
    }
  } catch (e) { /* keep fallback school name */ }
  const dateFrom = getEl('teacherAttReportDateFrom')?.value || '';
  const dateTo = getEl('teacherAttReportDateTo')?.value || '';
  const dateLabel = dateFrom && dateTo ? (dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`) : 'All Dates';
  
  const tableEl = document.querySelector('#teacherAttReportDailyTable .app-table');
  const tableHtml = tableEl?.outerHTML || '';
  
  const content = `<div style="text-align:center;margin-bottom:1rem;">
    <h2>${schoolName}</h2>
    <h3>Attendance Report - Daily View</h3>
    <p>Date Range: <strong>${dateLabel}</strong></p>
    <p>Generated: ${new Date().toLocaleString()}</p>
  </div>${tableHtml}<div style="margin-top:1rem;font-size:0.8rem;color:#64748b;text-align:center;">Student Admission Portal</div>`;
  
  openPrintWindow(`<html><head>
    <title>Daily Attendance Report - ${schoolName}</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;padding:1rem;}
      table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #ccc;padding:0.5rem;text-align:left;font-size:0.85rem;}
      th{background:#1e293b;color:#fff;}
      @media print{body{padding:0;}}
    </style>
  </head><body>${content}</body></html>`, `Daily Attendance Report - ${schoolName}`, 900, 700);
}

// ================================================================
// TEACHER 30-DAY CHECKBOX MODE FUNCTIONS
// ================================================================

let teacherMonthlyCache = [];

function switchTeacherAttendanceMode(mode) {
  document.querySelectorAll('.att-mode-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'daily') {
    getEl('teacherAttModeDaily')?.classList.add('active');
    getEl('teacherAttModeDailyContent').style.display = '';
    getEl('teacherAttModeMonthlyContent').style.display = 'none';
  } else {
    getEl('teacherAttModeMonthly')?.classList.add('active');
    getEl('teacherAttModeDailyContent').style.display = 'none';
    getEl('teacherAttModeMonthlyContent').style.display = '';
    // Set default start date to 1st of current month
    const startInput = getEl('teacherAttMonthlyStart');
    if (startInput && !startInput.value) {
      const now = new Date();
      startInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    // Populate class filter
    populateTeacherMonthlyClassFilter();
  }
}

async function populateTeacherMonthlyClassFilter() {
  const sel = getEl('teacherAttMonthlyClass');
  if (!sel) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { classes } = await getTeacherClasses(user.id);
  if (classes.length > 0) {
    sel.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
  } else {
    sel.innerHTML = '<option value="">— No classes —</option>';
  }
}

async function loadTeacherMonthlyAttendance() {
  const startDateStr = getEl('teacherAttMonthlyStart')?.value;
  const classFilter = getEl('teacherAttMonthlyClass')?.value || '';

  if (!startDateStr) {
    alert('Please select a start date.');
    return;
  }
  if (!classFilter) {
    alert('Please select a class.');
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // Get teacher's school_id from teachers table (consistent with report filtering)
  const { data: teacherInfoForMonthly } = await supabaseClient.from('teachers')
    .select('school_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const schoolId = teacherInfoForMonthly?.school_id || await getCurrentSchoolId();

  // Generate 30 date strings from start date
  const startDate = new Date(startDateStr + 'T00:00:00');
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Load settings for academic year and term
  let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
  if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
  const { data: settings } = await settingsQuery.maybeSingle();
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  // Load students for the selected class
  let query = supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('status', 'admitted')
    .eq('class_applying', classFilter);
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('first_name', { ascending: true });
  const { data: apps, error: appsErr } = await query;
  if (appsErr) { console.error('Load teacher monthly apps error:', appsErr); return; }

  const noEl = getEl('teacherNoMonthlyAttendance');
  if (!apps || apps.length === 0) {
    if (noEl) noEl.style.display = 'block';
    getEl('teacherAttMonthlyBody').innerHTML = '';
    return;
  }
  if (noEl) noEl.style.display = 'none';

  // Load existing attendance records
  const studentIds = apps.map(a => a.student_id);
  let attQuery = supabaseClient.from('attendance')
    .select('*')
    .in('student_id', studentIds)
    .gte('date', dates[0])
    .lte('date', dates[dates.length - 1]);
  if (schoolId) attQuery = attQuery.eq('school_id', schoolId);
  const { data: existingAtt } = await attQuery;

  // Build a map: student_id -> { date: status } and track locked dates
  const attMap = new Map();
  const lockedDates = new Map(); // student_id -> Set(date) for cells already marked
  (existingAtt || []).forEach(rec => {
    if (!attMap.has(rec.student_id)) {
      attMap.set(rec.student_id, {});
      lockedDates.set(rec.student_id, new Set());
    }
    attMap.get(rec.student_id)[rec.date] = rec.status;
    lockedDates.get(rec.student_id).add(rec.date);
  });

  // Build teacher monthly cache
  teacherMonthlyCache = apps.map(app => {
    const name = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ');
    const days = {};
    const locked = {}; // Track which dates are locked (already marked)
    const studentAtt = attMap.get(app.student_id) || {};
    const studentLocked = lockedDates.get(app.student_id) || new Set();
    dates.forEach(date => {
      days[date] = studentAtt[date] || 'unmarked';
      locked[date] = studentLocked.has(date);
    });
    return {
      student_id: app.student_id,
      name: name,
      class_applying: app.class_applying,
      days: days,
      locked: locked,
      academic_year: academicYear,
      term: currentTerm,
    };
  });

  renderTeacherMonthlyGrid(dates);
}

function renderTeacherMonthlyGrid(dates) {
  const thead = getEl('teacherAttMonthlyHeaderRow');
  const tbody = getEl('teacherAttMonthlyBody');
  if (!thead || !tbody) return;

  // Build header row
  let headerHtml = '<th class="save-cell-header" style="min-width:50px;">Save</th>';
  headerHtml += '<th class="student-name-cell" style="min-width:140px;">Student Name</th>';
  headerHtml += '<th class="student-id-cell" style="min-width:80px;">ID</th>';
  headerHtml += '<th class="student-class-cell" style="min-width:80px;">Class</th>';
  dates.forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const dayNum = d.getDate();
    const dayName = d.toLocaleDateString('en', { weekday: 'short' }).charAt(0);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const weekendClass = isWeekend ? ' weekend' : '';
    headerHtml += `<th class="day-header${weekendClass}" data-date="${date}" title="${date} (${d.toLocaleDateString('en', { weekday: 'long' })})">${dayNum}<br><span style="font-size:0.55rem;opacity:0.7;">${dayName}</span></th>`;
  });
  headerHtml += '<th class="present-count-cell" style="min-width:45px;">✅</th>';
  thead.innerHTML = headerHtml;

  if (teacherMonthlyCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="36" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  const tbodyHtml = teacherMonthlyCache.map(student => {
    let presentCount = 0;
    let markedCount = 0;
    const dayCells = dates.map(date => {
      const status = student.days[date] || 'unmarked';
      const isLocked = student.locked?.[date] || false;
      if (status === 'present' || status === 'late') presentCount++;
      if (status !== 'unmarked') markedCount++;
      const d = new Date(date + 'T00:00:00');
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const weekendClass = isWeekend ? ' weekend' : '';
      const lockedClass = isLocked ? ' locked-cell' : '';
      const icons = { present: '✓', absent: '✗', late: '⏰', excused: '🏥' };
      const iconHtml = status !== 'unmarked' ? `<span class="day-status-icon">${icons[status] || '✗'}</span>` : '<span class="day-status-icon" style="opacity:0.3;">—</span>';
      const lockIcon = isLocked ? '<span style="font-size:0.55rem;opacity:0.6;margin-left:1px;">🔒</span>' : '';
      return `<td class="att-day-cell ${status}${weekendClass}${lockedClass}" data-student="${student.student_id}" data-date="${date}" data-status="${status}" ${isLocked ? 'data-locked="true" title="Already marked - admin only"' : ''}>
        ${iconHtml}${lockIcon}
      </td>`;
    }).join('');

    return `<tr>
      <td class="save-cell"><button type="button" class="btn-save-student" data-student="${student.student_id}" title="Save this student's attendance">💾</button></td>
      <td class="student-name-cell">${student.name}</td>
      <td class="student-id-cell">${student.student_id}</td>
      <td class="student-class-cell">${student.class_applying || '-'}</td>
      ${dayCells}
      <td class="present-count-cell">${presentCount}/${markedCount}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = tbodyHtml;

  // Add click handlers to individual save buttons
  tbody.querySelectorAll('.btn-save-student').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const studentId = btn.dataset.student;
      saveIndividualTeacherMonthlyAttendance(studentId);
    });
  });

  // Add click handlers to day cells (skip locked cells)
  tbody.querySelectorAll('.att-day-cell:not([data-locked="true"])').forEach(cell => {
    cell.addEventListener('click', () => {
      const studentId = cell.dataset.student;
      const date = cell.dataset.date;
      const student = teacherMonthlyCache.find(s => s.student_id === studentId);
      if (!student) return;

      const statusOrder = ['unmarked', 'present', 'late', 'excused', 'absent'];
      const currentStatus = student.days[date] || 'unmarked';
      const currentIdx = statusOrder.indexOf(currentStatus);
      const nextStatus = statusOrder[(currentIdx + 1) % statusOrder.length];
      student.days[date] = nextStatus;

      const icons = { present: '✓', absent: '✗', late: '⏰', excused: '🏥' };
      cell.className = `att-day-cell ${nextStatus}`;
      cell.dataset.status = nextStatus;
      const iconHtml = nextStatus !== 'unmarked' ? `<span class="day-status-icon">${icons[nextStatus]}</span>` : '<span class="day-status-icon" style="opacity:0.3;">—</span>';
      cell.innerHTML = iconHtml;

      updateTeacherMonthlyStats(dates);
    });
  });

  // Add click handlers to column headers (only toggle unlocked cells)
  thead.querySelectorAll('.day-header').forEach(header => {
    header.addEventListener('click', () => {
      const date = header.dataset.date;
      if (!date) return;

      const cells = tbody.querySelectorAll(`.att-day-cell[data-date="${date}"]:not([data-locked="true"])`);
      const firstCell = cells[0];
      if (!firstCell) return;

      const allPresent = Array.from(cells).every(c => c.dataset.status === 'present');
      const newStatus = allPresent ? 'absent' : 'present';
      const icons = { present: '✓', absent: '✗', late: '⏰', excused: '🏥' };

      cells.forEach(cell => {
        const studentId = cell.dataset.student;
        const student = teacherMonthlyCache.find(s => s.student_id === studentId);
        if (student) {
          student.days[date] = newStatus;
        }
        cell.className = `att-day-cell ${newStatus}`;
        cell.dataset.status = newStatus;
        cell.innerHTML = `<span class="day-status-icon">${icons[newStatus]}</span>`;
      });

      updateTeacherMonthlyStats(dates);
    });
  });

  updateTeacherMonthlyStats(dates);
}

function updateTeacherMonthlyStats(dates) {
  let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalExcused = 0, totalUnmarked = 0;

  teacherMonthlyCache.forEach(student => {
    dates.forEach(date => {
      const status = student.days[date] || 'unmarked';
      if (status === 'present') totalPresent++;
      else if (status === 'absent') totalAbsent++;
      else if (status === 'late') totalLate++;
      else if (status === 'excused') totalExcused++;
      else if (status === 'unmarked') totalUnmarked++;
    });
  });
  const totalRecords = totalPresent + totalAbsent + totalLate + totalExcused;

  getEl('teacherAttMonthlyPresent').textContent = totalPresent;
  getEl('teacherAttMonthlyAbsent').textContent = totalAbsent;
  getEl('teacherAttMonthlyLate').textContent = totalLate;
  getEl('teacherAttMonthlyExcused').textContent = totalExcused;
  getEl('teacherAttMonthlyTotal').textContent = totalRecords;

  const stats = getEl('teacherAttMonthlyStats');
  if (stats) stats.style.display = 'flex';
}

function setTeacherAllMonthlyStatus(status) {
  if (teacherMonthlyCache.length === 0) {
    alert('No attendance data loaded. Load the 30-day grid first.');
    return;
  }

  const icons = { present: '✓', absent: '✗', late: '⏰', excused: '🏥' };
  const dates = Object.keys(teacherMonthlyCache[0]?.days || {});

  teacherMonthlyCache.forEach(student => {
    dates.forEach(date => {
      // Skip locked cells - already marked attendance can only be edited by admin
      if (student.locked?.[date]) return;
      student.days[date] = status;
    });
  });

  const tbody = getEl('teacherAttMonthlyBody');
  if (tbody) {
    tbody.querySelectorAll('.att-day-cell:not([data-locked="true"])').forEach(cell => {
      cell.className = `att-day-cell ${status}`;
      cell.dataset.status = status;
      cell.innerHTML = `<span class="day-status-icon">${icons[status]}</span>`;
    });
  }

  updateTeacherMonthlyStats(dates);
}

function resetTeacherAllMonthlyStatus() {
  if (teacherMonthlyCache.length === 0) {
    alert('No attendance data loaded. Load the 30-day grid first.');
    return;
  }

  if (!confirm('Are you sure you want to reset all attendance markings? This will clear all cells.')) {
    return;
  }

  const dates = Object.keys(teacherMonthlyCache[0]?.days || {});

  teacherMonthlyCache.forEach(student => {
    dates.forEach(date => {
      // Skip locked cells - already marked attendance can only be edited by admin
      if (student.locked?.[date]) return;
      student.days[date] = 'unmarked';
    });
  });

  const tbody = getEl('teacherAttMonthlyBody');
  if (tbody) {
    tbody.querySelectorAll('.att-day-cell:not([data-locked="true"])').forEach(cell => {
      cell.className = 'att-day-cell unmarked';
      cell.dataset.status = 'unmarked';
      cell.innerHTML = '<span class="day-status-icon" style="opacity:0.3;">—</span>';
    });
  }

  updateTeacherMonthlyStats(dates);
}

async function saveTeacherMonthlyAttendance() {
  if (teacherMonthlyCache.length === 0) {
    alert('No attendance data to save. Load the 30-day grid first.');
    return;
  }

  const btn = getEl('teacherBtnSaveMonthlyAttendance');
  setLoading(btn, true, 'Saving...');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    // Get teacher's school_id from teachers table (consistent with report filtering)
    const { data: teacherInfoForMonthlySave } = await supabaseClient.from('teachers')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const schoolId = teacherInfoForMonthlySave?.school_id || await getCurrentSchoolId();

    // Collect all records to save
    // - Marked cells (present/absent/late/excused) are inserted or updated
    // - Unmarked cells are tracked separately so existing records can be DELETED
    const recordsToSave = [];
    const unmarkedKeys = []; // "student_id|date" pairs for cells to clear
    let skippedLocked = 0;
    teacherMonthlyCache.forEach(student => {
      Object.entries(student.days).forEach(([date, status]) => {
        // Skip locked cells - already marked attendance can only be edited by admin
        if (student.locked?.[date]) {
          skippedLocked++;
          return;
        }
        if (status === 'unmarked') {
          unmarkedKeys.push(`${student.student_id}|${date}`);
          return; // Don't insert/update unmarked cells
        }
        recordsToSave.push({
          student_id: student.student_id,
          date: date,
          status: status,
          class_name: student.class_applying,
          academic_year: student.academic_year,
          term: student.term,
          remarks: '',
          marked_by: user?.id || null,
          school_id: schoolId,
        });
      });
    });

    // Get all existing records for these students and dates
    // (including unmarked keys so we can find their IDs to delete)
    const allKeys = [
      ...recordsToSave.map(r => `${r.student_id}|${r.date}`),
      ...unmarkedKeys
    ];
    const studentIds = [...new Set(allKeys.map(k => k.split('|')[0]))];
    const dates = [...new Set(allKeys.map(k => k.split('|')[1]))];

    const { data: existingRecords } = await supabaseClient
      .from('attendance')
      .select('id, student_id, date')
      .in('student_id', studentIds)
      .in('date', dates);

    // Build a lookup map: student_id + date -> id
    const existingMap = new Map();
    (existingRecords || []).forEach(rec => {
      existingMap.set(`${rec.student_id}|${rec.date}`, rec.id);
    });

    let saved = 0, updated = 0, deleted = 0;

    // Delete existing records for unmarked cells (teacher unmarked them)
    for (const key of unmarkedKeys) {
      const existingId = existingMap.get(key);
      if (existingId) {
        const { error } = await supabaseClient.from('attendance').delete().eq('id', existingId);
        if (!error) {
          deleted++;
        } else {
          console.error('Teacher delete monthly att error for', key, error);
        }
      }
    }

    for (const record of recordsToSave) {
      const key = `${record.student_id}|${record.date}`;
      const existingId = existingMap.get(key);

      if (existingId) {
        const { error } = await supabaseClient.from('attendance').update(record).eq('id', existingId);
        if (!error) {
          updated++;
        } else {
          console.error('Teacher update monthly att error for', record.student_id, record.date, error);
        }
      } else {
        const { error } = await supabaseClient.from('attendance').insert([record]);
        if (!error) {
          saved++;
        } else {
          console.error('Teacher insert monthly att error for', record.student_id, record.date, error);
        }
      }
    }

    const msgEl = getEl('teacherAttMonthlyMessage');
    if (msgEl) {
      const parts = [];
      if (saved > 0) parts.push(`${saved} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (deleted > 0) parts.push(`${deleted} removed`);
      showMessage(msgEl.id, `✅ 30-Day attendance saved! ${parts.join(', ') || 'No changes'}.`, 'success');
    try { await logStaffActivity('Marked 30-day attendance', { role: 'teacher', entityType: 'attendance', entityDetails: `${saved} new, ${updated} updated, ${deleted} removed` }); } catch (e) { /* noop */ }
    }

    // Auto-refresh the report so daily/summary views reflect the latest changes
    setTimeout(async () => {
      const reportSection = getEl('teacherAttReportSection');
      if (reportSection) {
        // Set date range to the 30-day period that was just saved
        const dateKeys = Object.keys(teacherMonthlyCache[0]?.days || {});
        if (dateKeys.length > 0) {
          const sortedDates = dateKeys.sort();
          const fromInput = getEl('teacherAttReportDateFrom');
          const toInput = getEl('teacherAttReportDateTo');
          if (fromInput) fromInput.value = sortedDates[0];
          if (toInput) toInput.value = sortedDates[sortedDates.length - 1];
        }
        // Set the term filter to match the saved records
        const termSelect = getEl('teacherAttReportTerm');
        const savedTerm = teacherMonthlyCache[0]?.term;
        if (termSelect && savedTerm) {
          termSelect.value = savedTerm;
        }
        reportSection.style.display = 'block';
        await renderTeacherAttReport();
        reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 500);

  } catch (err) {
    console.error('Save teacher monthly attendance error:', err);
    const msgEl = getEl('teacherAttMonthlyMessage');
    if (msgEl) {
      showMessage(msgEl.id, 'Error: ' + err.message, 'error');
    } else {
      alert('Error saving attendance: ' + err.message);
    }
  } finally {
    setLoading(btn, false, '💾 Save All Changes');
  }
}

/**
 * Save a single student's monthly attendance records to the database.
 * Skips locked cells - already marked attendance can only be edited by admin.
 */
async function saveIndividualTeacherMonthlyAttendance(studentId) {
  const student = teacherMonthlyCache.find(s => s.student_id === studentId);
  if (!student) {
    alert('Student not found in the loaded grid.');
    return;
  }

  const btn = document.querySelector(`.btn-save-student[data-student="${studentId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    // Get teacher's school_id from teachers table (consistent with report filtering)
    const { data: teacherInfoForIndividualSave } = await supabaseClient.from('teachers')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const schoolId = teacherInfoForIndividualSave?.school_id || await getCurrentSchoolId();

    // Collect records for this student (skip locked cells)
    const recordsToSave = [];
    const unmarkedKeys = []; // "student_id|date" pairs for cells to clear
    let skippedLocked = 0;
    Object.entries(student.days).forEach(([date, status]) => {
      // Skip locked cells - already marked attendance can only be edited by admin
      if (student.locked?.[date]) {
        skippedLocked++;
        return;
      }
      if (status === 'unmarked') {
        unmarkedKeys.push(`${student.student_id}|${date}`);
        return; // Don't insert/update unmarked cells
      }
      recordsToSave.push({
        student_id: student.student_id,
        date: date,
        status: status,
        class_name: student.class_applying,
        academic_year: student.academic_year,
        term: student.term,
        remarks: '',
        marked_by: user?.id || null,
        school_id: schoolId,
      });
    });

    // Get all existing records for this student and these dates
    const allKeys = [
      ...recordsToSave.map(r => `${r.student_id}|${r.date}`),
      ...unmarkedKeys
    ];
    const dates = [...new Set(allKeys.map(k => k.split('|')[1]))];

    const { data: existingRecords } = await supabaseClient
      .from('attendance')
      .select('id, student_id, date')
      .eq('student_id', student.student_id)
      .in('date', dates);

    // Build a lookup map: student_id + date -> id
    const existingMap = new Map();
    (existingRecords || []).forEach(rec => {
      existingMap.set(`${rec.student_id}|${rec.date}`, rec.id);
    });

    let saved = 0, updated = 0, deleted = 0;

    // Delete existing records for unmarked cells (teacher unmarked them)
    for (const key of unmarkedKeys) {
      const existingId = existingMap.get(key);
      if (existingId) {
        const { error } = await supabaseClient.from('attendance').delete().eq('id', existingId);
        if (!error) {
          deleted++;
        } else {
          console.error('Teacher delete individual monthly att error for', key, error);
        }
      }
    }

    for (const record of recordsToSave) {
      const key = `${record.student_id}|${record.date}`;
      const existingId = existingMap.get(key);

      if (existingId) {
        const { error } = await supabaseClient.from('attendance').update(record).eq('id', existingId);
        if (!error) {
          updated++;
        } else {
          console.error('Teacher update individual monthly att error for', record.student_id, record.date, error);
        }
      } else {
        const { error } = await supabaseClient.from('attendance').insert([record]);
        if (!error) {
          saved++;
        } else {
          console.error('Teacher insert individual monthly att error for', record.student_id, record.date, error);
        }
      }
    }

    const msgEl = getEl('teacherAttMonthlyMessage');
    if (msgEl) {
      const parts = [];
      if (saved > 0) parts.push(`${saved} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (deleted > 0) parts.push(`${deleted} removed`);
      const lockedMsg = skippedLocked > 0 ? ` (${skippedLocked} locked skipped)` : '';
      showMessage(msgEl.id, `✅ Attendance saved for <strong>${student.name}</strong>! ${parts.join(', ') || 'No changes'}${lockedMsg}.`, 'success');
    }

  } catch (err) {
    console.error('Save individual teacher monthly attendance error:', err);
    const msgEl = getEl('teacherAttMonthlyMessage');
    if (msgEl) {
      showMessage(msgEl.id, 'Error: ' + err.message, 'error');
    } else {
      alert('Error saving attendance: ' + err.message);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾';
    }
  }
}

// Attendance Report
async function loadTeacherAttReport() {
  const section = getEl('teacherAttReportSection');
  if (!section) {
    console.error('Teacher report section element not found');
    return;
  }
  section.style.display = 'block';
  // Set default date range if empty
  const dateFrom = getEl('teacherAttReportDateFrom');
  const dateTo = getEl('teacherAttReportDateTo');
  if (!dateFrom?.value && !dateTo?.value) {
    // Default to current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    if (dateFrom) dateFrom.value = firstDay.toISOString().slice(0, 10);
    if (dateTo) dateTo.value = now.toISOString().slice(0, 10);
  }
  await renderTeacherAttReport();
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderTeacherAttReport() {
  const tbody = getEl('teacherAttReportBody');
  const dailyBody = getEl('teacherAttReportDailyBody');
  const noEl = getEl('teacherNoAttReport');
  const dateLabel = getEl('teacherAttReportDateLabel');
  if (!tbody) return;

  const search = (getEl('teacherAttReportSearch')?.value || '').toLowerCase();
  const termFilter = getEl('teacherAttReportTerm')?.value || '';
  const dateFrom = getEl('teacherAttReportDateFrom')?.value || '';
  const dateTo = getEl('teacherAttReportDateTo')?.value || '';

  // Update date label
  if (dateLabel) {
    if (dateFrom && dateTo) {
      if (dateFrom === dateTo) {
        dateLabel.textContent = dateFrom;
      } else {
        dateLabel.textContent = `${dateFrom} to ${dateTo}`;
      }
    } else if (dateFrom) {
      dateLabel.textContent = `From ${dateFrom}`;
    } else if (dateTo) {
      dateLabel.textContent = `Up to ${dateTo}`;
    } else {
      dateLabel.textContent = 'All Dates';
    }
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { classes, teacher } = await getTeacherClasses(user.id);
    if (classes.length === 0) return;

    const schoolId = await getCurrentSchoolId();
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const { data: settings } = await settingsQuery.maybeSingle();
    const academicYear = settings?.academic_year || '';
    
    // Get attendance for ALL assigned classes
    let allAttRecords = [];
    for (const cls of classes) {
      let query;
      if (academicYear) {
        query = supabaseClient.from('attendance').select('*')
          .eq('class_name', cls)
          .eq('academic_year', academicYear);
      } else {
        query = supabaseClient.from('attendance').select('*')
          .eq('class_name', cls);
      }

      if (teacher?.school_id) query = query.eq('school_id', teacher.school_id);
      if (termFilter) query = query.eq('term', termFilter);
      if (dateFrom) query = query.gte('date', dateFrom);
      if (dateTo) query = query.lte('date', dateTo);
      query = query.order('date', { ascending: false }).order('student_id', { ascending: true });

      const { data: attRecords } = await query;
      if (attRecords) {
        allAttRecords = allAttRecords.concat(attRecords);
      }
    }

    if (!allAttRecords || allAttRecords.length === 0) { 
      tbody.innerHTML = ''; 
      if (dailyBody) dailyBody.innerHTML = '';
      if (noEl) noEl.style.display = 'block'; 
      return; 
    }
    if (noEl) noEl.style.display = 'none';

    // Determine which view is active
    const isSummaryVisible = getEl('teacherAttReportSummaryTable')?.style.display !== 'none';

    if (isSummaryVisible) {
      // === SUMMARY VIEW ===
      const studentStats = {};
      allAttRecords.forEach(r => {
        const sid = r.student_id;
        if (!studentStats[sid]) studentStats[sid] = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
        studentStats[sid].total++;
        studentStats[sid][r.status]++;
      });

      const { data: apps } = await supabaseClient.from('applications')
        .select('student_id, first_name, middle_name, last_name, class_applying')
        .in('student_id', Object.keys(studentStats));
      const appMap = new Map((apps || []).map(a => [a.student_id, a]));

      const rows = Object.entries(studentStats)
        .map(([sid, stats]) => {
          const app = appMap.get(sid);
          const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : sid;
          const pct = stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : '0.0';
          return { student_id: sid, name, class: app?.class_applying || '', ...stats, pct };
        })
        .filter(r => {
          if (search && !r.name.toLowerCase().includes(search) && !r.student_id.toLowerCase().includes(search)) return false;
          return true;
        })
        .sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));

      tbody.innerHTML = rows.map(r => {
        const pctColor = parseFloat(r.pct) >= 80 ? 'var(--success)' : parseFloat(r.pct) >= 50 ? 'var(--warning)' : 'var(--danger)';
        return `<tr>
          <td><strong>${r.student_id}</strong></td><td>${r.name}</td><td>${r.class || '-'}</td>
          <td style="text-align:center;">${r.total}</td>
          <td style="text-align:center;color:var(--success);font-weight:600;">${r.present}</td>
          <td style="text-align:center;color:var(--danger);font-weight:600;">${r.absent}</td>
          <td style="text-align:center;color:var(--warning);font-weight:600;">${r.late}</td>
          <td style="text-align:center;color:var(--purple);font-weight:600;">${r.excused}</td>
          <td style="text-align:center;"><strong style="color:${pctColor};">${r.pct}%</strong></td>
        </tr>`;
      }).join('');
    } else {
      // === DAILY VIEW ===
      const dateGroups = {};
      allAttRecords.forEach(r => {
        if (!dateGroups[r.date]) dateGroups[r.date] = [];
        dateGroups[r.date].push(r);
      });

      const sortedDates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));

      const { data: apps } = await supabaseClient.from('applications')
        .select('student_id, first_name, middle_name, last_name')
        .in('student_id', [...new Set(allAttRecords.map(r => r.student_id))]);
      const appMap = new Map((apps || []).map(a => [a.student_id, a]));

      let dailyHtml = '';
      sortedDates.forEach(date => {
        const records = dateGroups[date];
        const dayCounts = { present: 0, absent: 0, late: 0, excused: 0 };
        records.forEach(r => { dayCounts[r.status]++; });
        const dayTotal = records.length;
        const dayPct = dayTotal > 0 ? ((dayCounts.present / dayTotal) * 100).toFixed(1) : '0.0';

        dailyHtml += `<tr style="background:var(--bg);font-weight:700;">
          <td colspan="6" style="padding:0.5rem 1rem;font-size:0.9rem;">
            📅 <strong>${date}</strong>
            <span style="font-weight:400;font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem;">
              Present: ${dayCounts.present} | Absent: ${dayCounts.absent} | Late: ${dayCounts.late} | Excused: ${dayCounts.excused} | Total: ${dayTotal} |
            </span>
            <span style="font-weight:600;font-size:0.8rem;">${dayPct}%</span>
          </td>
        </tr>`;

        records.forEach(r => {
          const app = appMap.get(r.student_id);
          const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id;
          const statusIcons = { present: '✅', absent: '❌', late: '⏰', excused: '🏥' };
          const statusColors = { present: 'var(--success)', absent: 'var(--danger)', late: 'var(--warning)', excused: 'var(--purple)' };

          if (search && !name.toLowerCase().includes(search) && !r.student_id.toLowerCase().includes(search)) return;

          dailyHtml += `<tr>
            <td style="font-size:0.8rem;color:var(--text-muted);">${date}</td>
            <td><strong>${r.student_id}</strong></td>
            <td>${name}</td>
            <td>${r.class_name || '-'}</td>
            <td style="text-align:center;color:${statusColors[r.status] || 'inherit'};font-weight:600;">${statusIcons[r.status] || r.status} ${r.status}</td>
            <td style="font-size:0.8rem;">${r.remarks || '-'}</td>
          </tr>`;
        });
      });

      if (dailyBody) {
        dailyBody.innerHTML = dailyHtml || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No records found.</td></tr>';
      }
    }
  } catch (err) {
    console.error('Render teacher att report error:', err);
  }
}

// ================================================================
// EXAMS MANAGEMENT (Full score entry, rankings, report cards)
// ================================================================

async function loadTeacherExamsPage() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { classes, subjects, teacher } = await getTeacherClasses(user.id);
    if (classes.length === 0) {
      showMessage('teacherExamMessage', 'No classes assigned to you.', 'error');
      return;
    }

    // Populate class filter with all assigned classes
    const classSel = getEl('teacherExamClass');
    if (classSel) {
      classSel.innerHTML = '<option value="">— All Classes —</option>' +
        classes.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    // Show teacher's assigned subjects
    if (subjects.length > 0) {
      const subjectSel = getEl('teacherExamSubject');
      if (subjectSel) {
        subjectSel.innerHTML = '<option value="">— All Subjects —</option>' +
          subjects.map(s => `<option value="${s}">${s}</option>`).join('');
      }
    }

    // Populate exam select
    const examSel = getEl('teacherExamSelect');
    let examsQuery = supabaseClient.from('exams')
      .select('id, name, academic_year, term')
      .eq('is_active', true);
    
    if (teacher?.school_id) {
      examsQuery = examsQuery.eq('school_id', teacher.school_id);
    }
    
    const { data: exams } = await examsQuery.order('created_at', { ascending: false });

    if (examSel) {
      examSel.innerHTML = '<option value="">— Select Exam —</option>' +
        (exams || []).map(e => `<option value="${e.id}">${e.name} (${e.academic_year} - ${e.term})</option>`).join('');
    }

    // Clear score sheet
    getEl('teacherExamStudentsBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">Select an exam and subject, then click "Load Students".</td></tr>';

  } catch (err) {
    console.error('Failed to load teacher exams page:', err);
  }
}

export async function loadTeacherExamStudents() {
  const examId = getEl('teacherExamSelect')?.value;
  if (!examId) { alert('Please select an exam.'); return; }

  // Get selected class filter
  const classFilter = getEl('teacherExamClass')?.value || '';
  // Get selected subject filter
  const subjectFilter = getEl('teacherExamSubject')?.value || '';

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { classes, subjects, teacher } = await getTeacherClasses(user.id);
    if (classes.length === 0) {
      showMessage('teacherExamMessage', 'No classes assigned to you.', 'error');
      return;
    }

    // Get exam details
    const { data: exam, error: examErr } = await supabaseClient.from('exams').select('*').eq('id', examId).single();
    if (examErr || !exam) {
      showMessage('teacherExamMessage', 'Failed to load exam details. It may not exist or you may not have access.', 'error');
      return;
    }

    // Get exam subjects (filtered by class if selected)
    let examSubsQuery = supabaseClient.from('exam_subjects')
      .select('subject')
      .eq('exam_id', examId);
    if (classFilter) examSubsQuery = examSubsQuery.eq('class_name', classFilter);
    const { data: examSubjects, error: subjErr } = await examSubsQuery;
    if (subjErr) {
      console.error('Load exam subjects error:', subjErr);
      showMessage('teacherExamMessage', 'Failed to load exam subjects: ' + subjErr.message, 'error');
      return;
    }

    // Filter subjects to only show the teacher's assigned subject(s)
    let availableSubjects = (examSubjects || []).map(s => s.subject);
    
    // If teacher has specific subjects assigned, only allow those subjects
    if (subjects.length > 0) {
      availableSubjects = availableSubjects.filter(s => 
        subjects.some(ts => s.toLowerCase() === ts.toLowerCase())
      );
    }
    
    if (availableSubjects.length === 0) {
      showMessage('teacherExamMessage', `No exam subjects match your assigned subjects.`, 'error');
      return;
    }

    // Populate subject select with all available subjects
    const subjectSel = getEl('teacherExamSubject');
    if (subjectSel) {
      subjectSel.innerHTML = '<option value="">— All Subjects —</option>' +
        availableSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
      // Restore the previously selected subject if it's still valid
      if (subjectFilter && availableSubjects.some(s => s.toLowerCase() === subjectFilter.toLowerCase())) {
        subjectSel.value = availableSubjects.find(s => s.toLowerCase() === subjectFilter.toLowerCase());
      }
    }

    // Determine which classes to load students from
    let classesToLoad = classes;
    if (classFilter) {
      classesToLoad = classes.filter(c => c === classFilter);
    }

    // Get students from the selected class(es)
    let allStudents = [];
    for (const cls of classesToLoad) {
      let studentsQuery = supabaseClient.from('applications')
        .select('student_id, first_name, middle_name, last_name, class_applying')
        .eq('class_applying', cls)
        .eq('status', 'admitted');
      if (teacher?.school_id) {
        studentsQuery = studentsQuery.eq('school_id', teacher.school_id);
      }
      studentsQuery = studentsQuery.order('last_name', { ascending: true });
      const { data: students, error: studentsErr } = await studentsQuery;
      if (!studentsErr && students) {
        allStudents = allStudents.concat(students);
      }
    }

    if (allStudents.length === 0) {
      showMessage('teacherExamMessage', 'No admitted students in your classes.', 'error');
      return;
    }

    // Apply subject filter - if a specific subject is selected, only show that subject column
    let subjectsToShow = availableSubjects;
    if (subjectFilter) {
      subjectsToShow = availableSubjects.filter(s => s.toLowerCase() === subjectFilter.toLowerCase());
    }

    // Get existing results
    let resultsQuery = supabaseClient.from('exam_results')
      .select('*')
      .eq('exam_id', examId)
      .in('student_id', allStudents.map(s => s.student_id));
    if (teacher?.school_id) {
      resultsQuery = resultsQuery.eq('school_id', teacher.school_id);
    }
    const { data: existingResults, error: resultsErr } = await resultsQuery;
    if (resultsErr) {
      console.error('Load existing results error:', resultsErr);
      showMessage('teacherExamMessage', 'Failed to load existing scores: ' + resultsErr.message, 'error');
      return;
    }

    const resultsMap = new Map();
    (existingResults || []).forEach(r => {
      const key = r.student_id + '|' + r.subject;
      resultsMap.set(key, r);
    });

    // Build score cache
    teacherScoreCache = {
      examId,
      exam,
      class: classFilter || classes.join(', '),
      students: allStudents.map(s => ({
        student_id: s.student_id,
        name: buildStudentName(s.first_name, s.middle_name, s.last_name),
        class_applying: s.class_applying,
      })),
      subjects: subjectsToShow,
      results: resultsMap,
    };

    renderTeacherScoreSheet();
    showMessage('teacherExamMessage', `✅ Loaded ${allStudents.length} students with ${subjectsToShow.length} subject${subjectsToShow.length !== 1 ? 's' : ''}. Enter scores below.`, 'success');
  } catch (err) {
    console.error('Failed to load exam students:', err);
    showMessage('teacherExamMessage', 'Error: ' + err.message, 'error');
  }
}

function renderTeacherScoreSheet() {
  const tbody = getEl('teacherExamStudentsBody');
  if (!tbody) return;

  const { students, subjects, results } = teacherScoreCache;

  if (!students || students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No students loaded.</td></tr>';
    return;
  }

  // Build table with subjects as columns
  let html = '';
  students.forEach(s => {
    let subjectCells = '';
    subjects.forEach(sub => {
      const key = s.student_id + '|' + sub;
      const result = results.get(key);
      const classScore = result?.class_score || '';
      const examScore = result?.exam_score_input || '';
      const total = (Number(classScore) + (Number(examScore) / 2)) || 0;
      const grade = getSubjectGrade(total);

      subjectCells += `<td>
        <div style="display:flex;gap:2px;align-items:center;flex-wrap:nowrap;">
          <input type="number" class="teacher-class-score" data-student="${s.student_id}" data-subject="${sub}" value="${classScore}" min="0" max="50" step="0.5" style="width:50px;padding:0.25rem;text-align:center;border:1px solid var(--border);border-radius:4px;font-size:0.75rem;" />
          <span style="font-size:0.6rem;color:var(--text-muted);">/</span>
          <input type="number" class="teacher-exam-score" data-student="${s.student_id}" data-subject="${sub}" value="${examScore}" min="0" max="100" step="0.5" style="width:50px;padding:0.25rem;text-align:center;border:1px solid var(--border);border-radius:4px;font-size:0.75rem;" />
          <span class="teacher-total" style="font-size:0.7rem;font-weight:700;color:var(--primary);min-width:35px;text-align:center;">${total > 0 ? total : ''}</span>
          <span class="teacher-grade-badge" style="font-size:0.65rem;font-weight:700;${grade.grade === 'F' ? 'color:var(--danger);' : 'color:var(--success);'}"}>${total > 0 ? grade.grade : ''}</span>
        </div>
      </td>`;
    });

    html += `<tr>
      <td><strong>${s.student_id}</strong></td>
      <td>${s.name}</td>
      <td>${s.class_applying || '-'}</td>
      ${subjectCells}
    </tr>`;
  });

  // Update table header with subject columns
  const headerRow = document.querySelector('#teacherExamTable thead tr');
  if (headerRow) {
    headerRow.innerHTML = `<th style="min-width:100px;">Student ID</th><th style="min-width:120px;">Name</th><th style="min-width:80px;">Class</th>${subjects.map(sub => `<th style="min-width:160px;">${sub} <span style="font-weight:400;font-size:0.65rem;color:var(--text-muted);">(Class/Exam/Total/Grade)</span></th>`).join('')}`;
  }

  tbody.innerHTML = html;

  // Add auto-calc listeners - scope within current <td> so multiple subjects work independently
  tbody.querySelectorAll('.teacher-class-score, .teacher-exam-score').forEach(inp => {
    inp.addEventListener('input', function() {
      const td = this.closest('td');
      if (!td) return;
      const classScore = parseFloat(td.querySelector('.teacher-class-score')?.value) || 0;
      const examScore = parseFloat(td.querySelector('.teacher-exam-score')?.value) || 0;
      const total = Math.min(classScore + (examScore / 2), 100);
      const totalSpan = td.querySelector('.teacher-total');
      const gradeSpan = td.querySelector('.teacher-grade-badge');
      if (totalSpan) totalSpan.textContent = total > 0 ? total : '';
      if (gradeSpan) {
        const grade = getSubjectGrade(total);
        gradeSpan.textContent = total > 0 ? grade.grade : '';
        gradeSpan.style.color = grade.grade === 'F' ? 'var(--danger)' : grade.grade === 'E' ? 'var(--warning)' : 'var(--success)';
      }
    });
  });
}

async function saveTeacherExamScores() {
  const { examId, students, subjects } = teacherScoreCache;
  if (!examId || !students) { alert('No exam data loaded. Please load students first.'); return; }

  const btn = getEl('teacherBtnSaveScores');
  setLoading(btn, true, 'Saving...');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    let saved = 0, updated = 0;

    // Get teacher's school_id once (outside the loop for efficiency)
    const { data: teacher } = await supabaseClient.from('teachers')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const teacherSchoolId = teacher?.school_id || null;

    // Track per-student totals for overall position calculation
    const studentTotals = {};
    const studentSubjectCounts = {};

    for (const student of students) {
      for (const subject of subjects) {
        const classScoreInput = document.querySelector(`.teacher-class-score[data-student="${student.student_id}"][data-subject="${subject}"]`);
        const examScoreInput = document.querySelector(`.teacher-exam-score[data-student="${student.student_id}"][data-subject="${subject}"]`);
        
        const classScore = parseFloat(classScoreInput?.value) || 0;
        const examScoreInputVal = parseFloat(examScoreInput?.value) || 0;
        const examScore = examScoreInputVal / 2; // Exam score out of 50
        const total = Math.min(classScore + examScore, 100);
        const grade = getSubjectGrade(total);

        if (classScore === 0 && examScoreInputVal === 0) continue; // Skip empty entries

        // Track totals for overall position calculation
        if (!studentTotals[student.student_id]) {
          studentTotals[student.student_id] = 0;
          studentSubjectCounts[student.student_id] = 0;
        }
        studentTotals[student.student_id] += total;
        studentSubjectCounts[student.student_id]++;

        const existing = teacherScoreCache.results.get(student.student_id + '|' + subject);

        if (existing) {
          const { error } = await supabaseClient.from('exam_results')
            .update({
              class_score: classScore,
              exam_score_input: examScoreInputVal,
              exam_score: examScore,
              marks_obtained: total,
              grade: grade.grade,
            })
            .eq('id', existing.id);
          if (!error) updated++;
        } else {
          const { error } = await supabaseClient.from('exam_results')
            .insert([{
              exam_id: examId,
              student_id: student.student_id,
              subject: subject,
              class_score: classScore,
              exam_score_input: examScoreInputVal,
              exam_score: examScore,
              marks_obtained: total,
              grade: grade.grade,
              created_by: user?.id,
              school_id: teacherSchoolId,
            }]);
          if (!error) saved++;
        }
      }
    }

    // Calculate and save overall positions + remarks to exam_student_details
    // so the admin dashboard and report cards show correct data immediately
    const studentIds = Object.keys(studentTotals);
    if (studentIds.length > 0) {
      // Get all students' totals for this exam to compute relative positions
      const { data: allResults } = await supabaseClient.from('exam_results')
        .select('student_id, marks_obtained')
        .eq('exam_id', examId);
      
      // Build a map of all students' averages for this exam
      const allAverages = {};
      (allResults || []).forEach(r => {
        if (!allAverages[r.student_id]) allAverages[r.student_id] = { total: 0, count: 0 };
        allAverages[r.student_id].total += (r.marks_obtained || 0);
        allAverages[r.student_id].count++;
      });
      
      // Sort by average descending to determine positions
      const sortedStudents = Object.entries(allAverages)
        .map(([sid, data]) => ({ student_id: sid, avg: data.count > 0 ? data.total / data.count : 0 }))
        .sort((a, b) => b.avg - a.avg);
      
      // Assign positions and save details for each student with scores
      for (const sid of studentIds) {
        const avg = studentSubjectCounts[sid] > 0 ? (studentTotals[sid] / studentSubjectCounts[sid]) : 0;
        const position = sortedStudents.findIndex(s => s.student_id === sid) + 1;
        const remarks = getTeacherRemarks(avg);
        
        const { error: detailError } = await supabaseClient.from('exam_student_details')
          .upsert({
            exam_id: examId,
            student_id: sid,
            class_teacher_remarks: remarks,
            overall_position: position > 0 ? position : null,
          }, { onConflict: 'exam_id,student_id' });
        if (detailError) console.warn(`Failed to save details for ${sid}:`, detailError);
      }
    }

    showMessage('teacherExamMessage', `✅ Scores saved! ${saved} new, ${updated} updated.`, 'success');
    // Reload to refresh cache
    await loadTeacherExamStudents();
    try { await logStaffActivity(`Entered examination marks (${saved} new, ${updated} updated)`, { role: 'teacher', entityType: 'exam', entityDetails: `${examId}` }); } catch (e) { /* noop */ }
  } catch (err) {
    showMessage('teacherExamMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Save All Scores');
  }
}

async function autoRankTeacherSubjects() {
  const { examId, students, subjects } = teacherScoreCache;
  if (!examId || !students) { alert('Load students first.'); return; }

  try {
    // Get all results for this exam
    const { data: results } = await supabaseClient.from('exam_results')
      .select('*')
      .eq('exam_id', examId);

    if (!results || results.length === 0) {
      alert('No scores found to rank. Save scores first.');
      return;
    }

    // Calculate rankings per subject
    const rankingsHtml = subjects.map(subject => {
      const subjectResults = results.filter(r => r.subject === subject);
      const ranked = subjectResults
        .sort((a, b) => (b.marks_obtained || 0) - (a.marks_obtained || 0))
        .map((r, idx) => {
          const student = students.find(s => s.student_id === r.student_id);
          return { ...r, name: student?.name || r.student_id, rank: idx + 1 };
        });

      return `
        <div class="ranking-card">
          <div class="ranking-header">
            <h4>📖 ${subject}</h4>
            <span class="ranking-subtitle">${ranked.length} students</span>
          </div>
          <div class="table-wrapper">
            <table class="app-table">
              <thead><tr><th>Rank</th><th>Student</th><th>Score</th><th>Grade</th></tr></thead>
              <tbody>
                ${ranked.map(r => `
                  <tr>
                    <td><span class="rank-badge ${r.rank === 1 ? 'rank-1' : r.rank === 2 ? 'rank-2' : r.rank === 3 ? 'rank-3' : 'rank-other'}">#${r.rank}</span></td>
                    <td>${r.name}</td>
                    <td>${r.marks_obtained || 0}</td>
                    <td><span class="subject-grade ${getSubjectGrade(r.marks_obtained || 0).cls}">${getSubjectGrade(r.marks_obtained || 0).grade}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    getEl('teacherRankingsContainer').innerHTML = rankingsHtml;
    showMessage('teacherExamMessage', '🏆 Rankings generated successfully!', 'success');
  try { await logStaffActivity('Generated exam rankings & report card data', { role: 'teacher', entityType: 'exam', entityDetails: `${examId}` }); } catch (e) { /* noop */ }
  } catch (err) {
    showMessage('teacherExamMessage', 'Error generating rankings: ' + err.message, 'error');
  }
}

async function printTeacherReportCards() {
  const { examId, exam, students, subjects, results } = teacherScoreCache;
  if (!examId || !students) { alert('Load students first.'); return; }

  const schoolIdFromTeacher = await getCurrentSchoolId();
  let settings = null;
  let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
  if (schoolIdFromTeacher) settingsQuery = settingsQuery.eq('school_id', schoolIdFromTeacher);
  const settingsResult = await settingsQuery.maybeSingle();
  settings = settingsResult.data || settings;

  // Fallback: fetch school name from school_settings or schools table
  let schoolName = settings?.school_name || '';
  let schoolLogoUrl = '';
  if (!schoolName && schoolIdFromTeacher) {
    const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
      .select('school_name, logo_url')
      .eq('school_id', schoolIdFromTeacher)
      .maybeSingle();
    if (schoolSettingsData?.school_name) {
      schoolName = schoolSettingsData.school_name;
      schoolLogoUrl = schoolSettingsData.logo_url || '';
    }
  }
  if (!schoolName && schoolIdFromTeacher) {
    const { data: schoolData } = await supabaseClient.from('schools')
      .select('name, logo_url')
      .eq('id', schoolIdFromTeacher)
      .maybeSingle();
    if (schoolData?.name) {
      schoolName = schoolData.name;
      schoolLogoUrl = schoolData.logo_url || '';
    }
  }
  schoolName = schoolName || 'My School';

  // Generate report cards for all students
  const reportCardsHtml = students.map(student => {
    const studentResults = subjects.map(subject => {
      const r = results.get(student.student_id + '|' + subject);
      return {
        subject,
        classScore: r?.class_score || 0,
        examScore: r?.exam_score ?? ((r?.exam_score_input || 0) / 2),
        total: (r?.class_score || 0) + ((r?.exam_score_input || 0) / 2),
        grade: r?.grade || '-',
      };
    });

    const totalScore = studentResults.reduce((sum, r) => sum + r.total, 0);
    const average = subjects.length > 0 ? (totalScore / subjects.length) : 0;
    const gradeInfo = getGrade(average);
    const teacherRemarks = getTeacherRemarks(average);
    const headRemarks = getHeadTeacherRemarks(average);

    return `
      <div class="rc-container" style="page-break-after:always;margin-bottom:1rem;">
        <div class="rc-top-bar"></div>
        <div class="rc-header">
          ${schoolLogoUrl ? `<img src="${schoolLogoUrl}" alt="School Logo" style="width:44px;height:44px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;" />` : '<div class="rc-seal">📚</div>'}
          <div class="rc-school-info">
            <h2 class="rc-school-name">${schoolName}</h2>
            <p class="rc-school-address">Academic Excellence Through Discipline</p>
          </div>
          <div class="rc-header-badge">Report Card</div>
        </div>

        <div class="rc-student-section">
          <div class="rc-student-photo">
            <div class="rc-photo-placeholder">🎓</div>
          </div>
          <div class="rc-student-data">
            <table class="rc-info-table">
              <tr><td class="rc-label">Student</td><td class="rc-colon">:</td><td class="rc-value">${student.name}</td>
              <td class="rc-label">Class</td><td class="rc-colon">:</td><td class="rc-value">${exam?.class_applying || teacherScoreCache.class}</td></tr>
              <tr><td class="rc-label">Student ID</td><td class="rc-colon">:</td><td class="rc-value">${student.student_id}</td>
              <td class="rc-label">Term</td><td class="rc-colon">:</td><td class="rc-value">${exam?.term || ''} ${exam?.academic_year || ''}</td></tr>
            </table>
          </div>
        </div>

        <table class="rc-subjects-table">
          <thead><tr><th style="width:30%;">Subject</th><th style="width:12%;">Class Score (50)</th><th style="width:12%;">Exam Score (50)</th><th style="width:12%;">Total (100)</th><th style="width:8%;">Grade</th><th>Performance Level</th></tr></thead>
          <tbody>
            ${studentResults.map(r => `
              <tr>
                <td class="rc-subject-name">${r.subject}</td>
                <td class="rc-score">${r.classScore}</td>
                <td class="rc-score">${r.examScore}</td>
                <td class="rc-total">${r.total}</td>
                <td class="rc-grade-cell"><span class="rc-grade-badge ${getSubjectGrade(r.total).cls}">${r.grade}</span></td>
                <td class="rc-remark"><span class="rc-perf-text ${getPerformanceLevel(r.total).cls}">${getPerformanceLevel(r.total).text}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="rc-summary">
          <div class="rc-summary-item rc-summary-total"><span class="rc-summary-label">Total Score</span><span class="rc-summary-value">${totalScore}</span></div>
          <div class="rc-summary-item rc-summary-average"><span class="rc-summary-label">Average</span><span class="rc-summary-value">${average.toFixed(1)}</span></div>
          <div class="rc-summary-item rc-summary-grade"><span class="rc-summary-label">Grade</span><span class="rc-summary-value">${gradeInfo.grade}</span><span class="rc-summary-sub">${gradeInfo.desc}</span></div>
          <div class="rc-summary-item rc-summary-subjects"><span class="rc-summary-label">Subjects</span><span class="rc-summary-value">${subjects.length}</span></div>
        </div>

        <div class="rc-remarks">
          <div class="rc-remarks-box rc-remarks-teacher">
            <div class="rc-remarks-header">👨‍🏫 Teacher's Remarks</div>
            <div class="rc-remarks-text">${teacherRemarks}</div>
            <div style="text-align:right;font-size:0.6rem;color:#94a3b8;">_________________________<br>Class Teacher</div>
          </div>
          <div class="rc-remarks-box rc-remarks-head">
            <div class="rc-remarks-header">👑 Head Teacher's Remarks</div>
            <div class="rc-remarks-text">${headRemarks}</div>
            <div style="text-align:right;font-size:0.6rem;color:#94a3b8;">_________________________<br>Head Teacher</div>
          </div>
        </div>

        <div class="rc-footer">
          <span>Generated: ${new Date().toLocaleDateString()}</span>
          <span class="rc-footer-label">${schoolName} • Student Admission Portal</span>
        </div>
      </div>
    `;
  }).join('');

  // Open print window
  const printStyle = `
    <style>
      body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 0; margin: 0; background: #f5f5f5; }
      @media print { body { background: #fff; } @page { margin: 1cm; } }
      .rc-container { max-width: 210mm; margin: 1rem auto; background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1); position: relative; overflow: hidden; font-size: 11px; }
      .rc-top-bar { position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #10b981, #f59e0b); border-radius: 12px 12px 0 0; }
      .rc-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }
      .rc-seal { width: 44px; height: 44px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; color: #fff; flex-shrink: 0; }
      .rc-school-name { font-size: 1.1rem; font-weight: 800; color: #1e293b; margin: 0; }
      .rc-school-address { font-size: 0.65rem; color: #64748b; margin: 0; }
      .rc-header-badge { background: #1e293b; color: #fff; font-size: 0.6rem; font-weight: 800; letter-spacing: 1px; padding: 0.3rem 0.7rem; border-radius: 6px; white-space: nowrap; text-transform: uppercase; }
      .rc-student-section { display: flex; gap: 0.75rem; margin-bottom: 0.6rem; padding: 0.5rem; background: rgba(99,102,241,0.05); border: 1px solid rgba(99,102,241,0.12); border-radius: 8px; }
      .rc-photo-placeholder { width: 55px; height: 55px; border-radius: 50%; border: 2px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: #94a3b8; background: #f8fafc; flex-shrink: 0; }
      .rc-info-table { width: 100%; border-collapse: collapse; }
      .rc-info-table tr { border-bottom: 1px solid rgba(226,232,240,0.4); }
      .rc-info-table tr:last-child { border-bottom: none; }
      .rc-label { font-size: 0.6rem; font-weight: 700; color: #64748b; text-transform: uppercase; padding: 0.1rem 0.2rem; white-space: nowrap; width: 1%; }
      .rc-colon { font-size: 0.6rem; color: #94a3b8; padding: 0.1rem; width: 8px; text-align: center; }
      .rc-value { font-size: 0.68rem; font-weight: 600; color: #1e293b; padding: 0.1rem 0.2rem; }
      .rc-subjects-table { width: 100%; border-collapse: collapse; margin-bottom: 0.6rem; font-size: 0.7rem; border-radius: 8px; overflow: hidden; }
      .rc-subjects-table thead th { background: #1e293b; color: #fff; font-weight: 700; font-size: 0.6rem; text-transform: uppercase; padding: 0.4rem 0.5rem; text-align: left; }
      .rc-subjects-table tbody td { padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(226,232,240,0.5); }
      .rc-subjects-table tbody tr:nth-child(even) { background: rgba(99,102,241,0.03); }
      .rc-subject-name { font-weight: 600; }
      .rc-score, .rc-total { text-align: center; font-weight: 600; }
      .rc-grade-badge { display: inline-block; width: 22px; height: 22px; border-radius: 50%; text-align: center; line-height: 22px; font-weight: 800; font-size: 0.65rem; color: #fff; }
      .grade-a { background: #16a34a; } .grade-b { background: #2563eb; } .grade-c { background: #f59e0b; } .grade-d { background: #f97316; } .grade-e { background: #dc2626; } .grade-f { background: #991b1b; }
      .rc-summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.4rem; margin-bottom: 0.6rem; }
      .rc-summary-item { display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.3rem; border-radius: 8px; color: #fff; text-align: center; }
      .rc-summary-total { background: linear-gradient(135deg, #6366f1, #4f46e5); }
      .rc-summary-average { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
      .rc-summary-grade { background: linear-gradient(135deg, #f59e0b, #d97706); }
      .rc-summary-subjects { background: linear-gradient(135deg, #10b981, #059669); }
      .rc-summary-label { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.85; font-weight: 600; }
      .rc-summary-value { font-size: 0.95rem; font-weight: 800; line-height: 1.2; }
      .rc-summary-sub { font-size: 0.55rem; opacity: 0.8; }
      .rc-remarks { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.6rem; }
      .rc-remarks-box { padding: 0.5rem; border-radius: 8px; border: 1px solid rgba(226,232,240,0.6); }
      .rc-remarks-teacher { background: rgba(16,185,129,0.06); border-color: rgba(16,185,129,0.2); }
      .rc-remarks-head { background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.2); }
      .rc-remarks-header { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 0.25rem; }
      .rc-remarks-teacher .rc-remarks-header { color: #15803d; }
      .rc-remarks-head .rc-remarks-header { color: #4f46e5; }
      .rc-remarks-text { font-size: 0.68rem; line-height: 1.5; color: #1e293b; font-style: italic; min-height: 1.5em; }
      .rc-footer { display: flex; justify-content: space-between; padding-top: 0.4rem; border-top: 1px solid #e2e8f0; font-size: 0.55rem; color: #64748b; }
      .rc-perf-text { display: inline-block; font-size: 0.6rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 3px; }
      .rc-perf-text.excellent { background: #dcfce7; color: #15803d; }
      .rc-perf-text.good { background: #dbeafe; color: #1d4ed8; }
      .rc-perf-text.average { background: #fef3c7; color: #92400e; }
      .rc-perf-text.needs-improvement { background: #fee2e2; color: #dc2626; }
      @media print { .rc-container { box-shadow: none; margin: 0; page-break-after: always; } body { background: #fff; } }
    </style>
  `;

  openPrintWindow(`<html><head><title>Report Cards - ${schoolName}</title>${printStyle}</head><body>${reportCardsHtml}</body></html>`, `Report Cards - ${schoolName}`, 900, 700);
}

// ================================================================
// TEACHER PROFILE
// ================================================================

function autoCalculateTeacherAge() {
  const dob = getEl('teacherProfileDob')?.value;
  const ageInput = getEl('teacherProfileAge');
  if (!dob || !ageInput) return;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  ageInput.value = age > 0 ? age : '';
}

function previewTeacherPhoto() {
  const fileInput = getEl('teacherProfilePhoto');
  const file = fileInput?.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Please select an image file.'); fileInput.value = ''; return; }
  if (file.size > 2 * 1024 * 1024) { alert('Photo must be less than 2MB.'); fileInput.value = ''; return; }
  
  // Show preview in the circular frame
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = getEl('teacherProfilePhotoPreview');
    const placeholder = getEl('teacherProfilePhotoPlaceholder');
    if (preview) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function uploadTeacherFile(file, prefix) {
  if (!file) return null;
  // Append the teacher's school initials so the Cloudinary file name reads
  // e.g. "teacher_documents_photo_<uid>-SIS" — easy to identify duplicates in
  // the Media Library. Falls back to the un-suffixed prefix if not resolvable.
  const schoolInitials = await getCurrentSchoolInitials();
  const taggedPrefix = schoolInitials && schoolInitials !== 'SCH' ? `${prefix}-${schoolInitials}` : prefix;

  // Cloudinary is the primary store when configured (covers photos AND PDFs).
  if (isCloudinaryReady()) {
    const cloudinaryUrl = await uploadToCloudinary(file, {
      prefix: `teacher_documents_${taggedPrefix}`,
    });
    if (cloudinaryUrl) return cloudinaryUrl;
    console.warn('Cloudinary upload failed — falling back to Supabase Storage.');
  }
  const ext = file.name.split('.').pop();
  const fileName = `${taggedPrefix}_${Date.now()}.${ext}`;
  const { data: upData, error: upErr } = await supabaseClient.storage
    .from('teacher-documents')
    .upload(fileName, file, { cacheControl: '3600', upsert: false });
  if (upErr) {
    console.warn('Teacher file upload failed:', upErr.message);
    return null;
  }
  const { data: urlData } = supabaseClient.storage.from('teacher-documents').getPublicUrl(fileName);
  return urlData.publicUrl;
}

/**
 * Extract the storage file identifier from a public URL.
 * - Cloudinary:          returns the public_id (handled by the delete proxy).
 * - Supabase Storage:    e.g. https://xxx.supabase.co/storage/v1/object/public/
 *                        teacher-documents/cert_123.pdf → cert_123.pdf
 */
function extractStoragePathFromUrl(fileUrl) {
  if (!fileUrl) return null;
  // Cloudinary asset → return its public id so deleteOldTeacherDocuments can
  // remove it through /api/cloudinary-delete.
  const cloudinaryPublicId = getCloudinaryPublicIdFromUrl(fileUrl);
  if (cloudinaryPublicId) return cloudinaryPublicId;
  try {
    const marker = '/teacher-documents/';
    const idx = fileUrl.indexOf(marker);
    if (idx === -1) return null;
    return fileUrl.substring(idx + marker.length).split('?')[0];
  } catch (e) {
    return null;
  }
}

/**
 * Delete old teacher documents of a given type (certificate or appointment_letter)
 * from both the database (teacher_documents) and storage (teacher-documents bucket).
 * Called when a teacher uploads a new file of the same type.
 */
async function deleteOldTeacherDocuments(teacherId, documentType) {
  try {
    // Fetch existing documents of this type
    const { data: oldDocs } = await supabaseClient.from('teacher_documents')
      .select('id, file_url')
      .eq('teacher_id', teacherId)
      .eq('document_type', documentType);

    if (!oldDocs || oldDocs.length === 0) return;

    // Delete storage files first (best-effort)
    for (const doc of oldDocs) {
      const storagePath = extractStoragePathFromUrl(doc.file_url);
      if (!storagePath) continue;
      if (getCloudinaryPublicIdFromUrl(doc.file_url)) {
        // Cloudinary asset → best-effort removal via serverless proxy.
        await deleteCloudinaryFile(doc.file_url);
      } else {
        // Legacy Supabase Storage asset.
        try {
          await supabaseClient.storage
            .from('teacher-documents')
            .remove([storagePath]);
        } catch (storageErr) {
          console.warn(`Failed to delete old ${documentType} from storage:`, storageErr.message);
        }
      }
    }

    // Delete database records
    const { error: delErr } = await supabaseClient.from('teacher_documents')
      .delete()
      .eq('teacher_id', teacherId)
      .eq('document_type', documentType);

    if (delErr) {
      console.warn(`Failed to delete old ${documentType} records:`, delErr.message);
    }
  } catch (err) {
    console.warn(`Failed to clean up old ${documentType} documents:`, err.message);
  }
}

async function saveTeacherProfile(e) {
  e.preventDefault();
  clearMessage('teacherProfileMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Saving...');

  const firstName = getEl('teacherProfileFirstName').value.trim();
  const middleName = getEl('teacherProfileMiddleName').value.trim();
  const surname = getEl('teacherProfileSurname').value.trim();
  const dob = getEl('teacherProfileDob').value;
  const password = getEl('teacherProfilePassword').value;
  const confirmPw = getEl('teacherProfileConfirmPassword').value;

  if (!firstName || !surname) { showMessage('teacherProfileMessage', 'First Name and Surname are required.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
  if (!dob) { showMessage('teacherProfileMessage', 'Date of Birth is required.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Get teacher record (with fallback to registration_id for new-device login)
    let { data: teacher } = await supabaseClient.from('teachers')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!teacher) {
      const regId = user.user_metadata?.registration_id || null;
      if (regId) {
        const { data: byReg } = await supabaseClient.from('teachers')
          .select('*')
          .eq('registration_id', regId)
          .maybeSingle();
        if (byReg) {
          // Self-heal: link the teacher record to this user
          try {
            await supabaseClient.rpc('auto_approve_teacher_on_login', { 
              p_user_id: user.id, 
              p_registration_id: regId 
            });
          } catch (healErr) {
            console.warn('auto_approve_teacher_on_login RPC failed in saveTeacherProfile:', healErr.message);
            try {
              await supabaseClient.from('teachers')
                .update({ user_id: user.id })
                .eq('registration_id', regId);
            } catch (updateErr) {
              console.warn('Direct teacher link fallback failed in saveTeacherProfile:', updateErr.message);
            }
          }
          teacher = byReg;
        }
      }
    }

    if (!teacher) { showMessage('teacherProfileMessage', 'Teacher record not found. Please contact admin.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }

    // Upload photo if provided
    let photoUrl = teacher.photo_url || null;
    const photoFile = getEl('teacherProfilePhoto')?.files[0];
    if (photoFile) {
      photoUrl = await uploadTeacherFile(photoFile, `photo_${teacher.id}`);
    }

    // Upload certificate if provided
    const certFile = getEl('teacherProfileCertificateFile')?.files[0];
    if (certFile) {
      if (certFile.type !== 'application/pdf') { showMessage('teacherProfileMessage', 'Certificate must be a PDF file.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      if (certFile.size > 2 * 1024 * 1024) { showMessage('teacherProfileMessage', 'Certificate must be less than 2MB.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      // Delete old certificate files (database records + storage) before uploading new one
      await deleteOldTeacherDocuments(teacher.id, 'certificate');
      const certUrl = await uploadTeacherFile(certFile, `cert_${teacher.id}`);
      if (certUrl) {
        await supabaseClient.from('teacher_documents').insert([{
          teacher_id: teacher.id,
          document_type: 'certificate',
          file_url: certUrl,
          file_name: certFile.name,
          file_size: certFile.size,
          uploaded_by: user.id,
          school_id: teacher.school_id,
        }]);
      }
    }

    // Upload appointment letter if provided
    const apptFile = getEl('teacherProfileAppointmentFile')?.files[0];
    if (apptFile) {
      if (apptFile.type !== 'application/pdf') { showMessage('teacherProfileMessage', 'Appointment letter must be a PDF file.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      if (apptFile.size > 2 * 1024 * 1024) { showMessage('teacherProfileMessage', 'Appointment letter must be less than 2MB.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      // Delete old appointment letter files (database records + storage) before uploading new one
      await deleteOldTeacherDocuments(teacher.id, 'appointment_letter');
      const apptUrl = await uploadTeacherFile(apptFile, `appt_${teacher.id}`);
      if (apptUrl) {
        await supabaseClient.from('teacher_documents').insert([{
          teacher_id: teacher.id,
          document_type: 'appointment_letter',
          file_url: apptUrl,
          file_name: apptFile.name,
          file_size: apptFile.size,
          uploaded_by: user.id,
          school_id: teacher.school_id,
        }]);
      }
    }

    // Build full name
    const fullName = [firstName, middleName, surname].filter(Boolean).join(' ');

    // Build payload with all profile fields
    const payload = {
      full_name: fullName,
      first_name: firstName,
      middle_name: middleName || null,
      surname: surname,
      dob: dob || null,
      photo_url: photoUrl,
      gender: getEl('teacherProfileGender').value || null,
      region: getEl('teacherProfileRegion').value.trim() || null,
      marital_status: getEl('teacherProfileMaritalStatus').value || null,
      disability: getEl('teacherProfileDisability').value.trim() || null,
      place_of_birth: getEl('teacherProfilePlaceOfBirth').value.trim() || null,
      nationality: getEl('teacherProfileNationality').value.trim() || null,
      religion: getEl('teacherProfileReligion').value.trim() || null,
      staff_id: getEl('teacherProfileStaffId').value.trim() || null,
      mobile_number: getEl('teacherProfileMobile').value.trim() || null,
      ghana_card_number: getEl('teacherProfileGhanaCard').value.trim() || null,
      tin_number: getEl('teacherProfileTin').value.trim() || null,
      ntc_number: getEl('teacherProfileNtc').value.trim() || null,
      ssnit_number: getEl('teacherProfileSsnit').value.trim() || null,
      certificate_number: getEl('teacherProfileCertificate').value.trim() || null,
      emis_code: getEl('teacherProfileEmis').value.trim() || null,
      date_first_appointment_district: getEl('teacherProfileDateFirstAppointment').value || null,
      date_transfer_last_school: getEl('teacherProfileDateTransfer').value || null,
      date_promoted_present_rank: getEl('teacherProfileDatePromoted').value || null,
      date_last_upgrading: getEl('teacherProfileDateUpgrading').value || null,
      school_name: getEl('teacherProfileSchoolName').value.trim() || null,
      school_region: getEl('teacherProfileSchoolRegion').value.trim() || null,
      circuit: getEl('teacherProfileCircuit').value.trim() || null,
      district: getEl('teacherProfileDistrict').value.trim() || null,
      rank: getEl('teacherProfileRank').value.trim() || null,
      salary_scale: getEl('teacherProfileSalaryScale').value.trim() || null,
      salary_step: getEl('teacherProfileSalaryStep').value.trim() || null,
      date_assumption_district: getEl('teacherProfileDateAssumptionDistrict').value || null,
      date_assumption_present_station: getEl('teacherProfileDateAssumptionStation').value || null,
      college_attended: getEl('teacherProfileCollegeAttended').value.trim() || null,
      shs_attended: getEl('teacherProfileShsAttended').value.trim() || null,
      salary_level: getEl('teacherProfileSalaryLevel').value.trim() || null,
      bank_account_name: getEl('teacherProfileBankAccountName').value.trim() || null,
      bank_account_number: getEl('teacherProfileBankAccountNumber').value.trim() || null,
      account_branch: getEl('teacherProfileAccountBranch').value.trim() || null,
      home_town: getEl('teacherProfileHomeTown').value.trim() || null,
      area_of_specialization: getEl('teacherProfileAreaSpecialization').value.trim() || null,
      professional_qualification: getEl('teacherProfileProfessionalQualification').value.trim() || null,
      academic_qualification: getEl('teacherProfileAcademicQualification').value.trim() || null,
    };

    // Update teacher record
    const { error: teacherErr } = await supabaseClient.from('teachers').update(payload).eq('id', teacher.id);
    if (teacherErr) throw teacherErr;

    // Update profile name
    await supabaseClient.from('profiles').update({ full_name: fullName }).eq('id', user.id);

    // Update password if provided
    if (password) {
      if (password.length < 6) { showMessage('teacherProfileMessage', 'Password must be at least 6 characters.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      if (password !== confirmPw) { showMessage('teacherProfileMessage', 'Passwords do not match.', 'error'); setLoading(btn, false, '💾 Save Profile'); return; }
      await supabaseClient.auth.updateUser({ password });
    }

    showMessage('teacherProfileMessage', '✅ Profile saved successfully.', 'success');
    getEl('teacherProfilePassword').value = '';
    getEl('teacherProfileConfirmPassword').value = '';
    getEl('teacherProfilePhoto').value = '';
    getEl('teacherProfileCertificateFile').value = '';
    getEl('teacherProfileAppointmentFile').value = '';
    try { await logStaffActivity(`Updated teacher profile (${fullName})`, { role: 'teacher', entityType: 'profile', entityDetails: `${teacher.registration_id || fullName}` }); } catch (e) { /* noop */ }

    // Update sidebar name
    const sidebarName = getEl('teacherSidebarName');
    if (sidebarName) sidebarName.textContent = fullName;
  } catch (err) {
    showMessage('teacherProfileMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Save Profile');
  }
}

export async function loadTeacherProfileForm(teacher) {
  if (!teacher) return;
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val || '';
  };
  setVal('teacherProfileFirstName', teacher.first_name || '');
  setVal('teacherProfileMiddleName', teacher.middle_name || '');
  setVal('teacherProfileSurname', teacher.surname || '');
  setVal('teacherProfileEmail', teacher.email || '');
  setVal('teacherProfileDob', teacher.dob || '');
  setVal('teacherProfileAge', teacher.age || '');
  setVal('teacherProfileGender', teacher.gender || '');
  setVal('teacherProfileRegion', teacher.region || '');
  setVal('teacherProfileMaritalStatus', teacher.marital_status || '');
  setVal('teacherProfileDisability', teacher.disability || '');
  setVal('teacherProfilePlaceOfBirth', teacher.place_of_birth || '');
  setVal('teacherProfileNationality', teacher.nationality || '');
  setVal('teacherProfileReligion', teacher.religion || '');
  setVal('teacherProfileStaffId', teacher.staff_id || '');
  setVal('teacherProfileMobile', teacher.mobile_number || '');
  setVal('teacherProfileGhanaCard', teacher.ghana_card_number || '');
  setVal('teacherProfileTin', teacher.tin_number || '');
  setVal('teacherProfileNtc', teacher.ntc_number || '');
  setVal('teacherProfileSsnit', teacher.ssnit_number || '');
  setVal('teacherProfileCertificate', teacher.certificate_number || '');
  setVal('teacherProfileEmis', teacher.emis_code || '');
  setVal('teacherProfileDateFirstAppointment', teacher.date_first_appointment_district || '');
  setVal('teacherProfileDateTransfer', teacher.date_transfer_last_school || '');
  setVal('teacherProfileDatePromoted', teacher.date_promoted_present_rank || '');
  setVal('teacherProfileDateUpgrading', teacher.date_last_upgrading || '');
  setVal('teacherProfileSchoolName', teacher.school_name || '');
  setVal('teacherProfileSchoolRegion', teacher.school_region || '');
  setVal('teacherProfileCircuit', teacher.circuit || '');
  setVal('teacherProfileDistrict', teacher.district || '');
  setVal('teacherProfileRank', teacher.rank || '');
  setVal('teacherProfileSalaryScale', teacher.salary_scale || '');
  setVal('teacherProfileSalaryStep', teacher.salary_step || '');
  setVal('teacherProfileDateAssumptionDistrict', teacher.date_assumption_district || '');
  setVal('teacherProfileDateAssumptionStation', teacher.date_assumption_present_station || '');
  setVal('teacherProfileCollegeAttended', teacher.college_attended || '');
  setVal('teacherProfileShsAttended', teacher.shs_attended || '');
  setVal('teacherProfileSalaryLevel', teacher.salary_level || '');
  setVal('teacherProfileBankAccountName', teacher.bank_account_name || '');
  setVal('teacherProfileBankAccountNumber', teacher.bank_account_number || '');
  setVal('teacherProfileAccountBranch', teacher.account_branch || '');
  setVal('teacherProfileHomeTown', teacher.home_town || '');
  setVal('teacherProfileAreaSpecialization', teacher.area_of_specialization || '');
  setVal('teacherProfileProfessionalQualification', teacher.professional_qualification || '');
  setVal('teacherProfileAcademicQualification', teacher.academic_qualification || '');
  
  // Show existing photo in the preview frame
  const previewImg = getEl('teacherProfilePhotoPreview');
  const placeholder = getEl('teacherProfilePhotoPlaceholder');
  if (teacher.photo_url) {
    if (previewImg) {
      previewImg.src = teacher.photo_url;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
  } else {
    if (previewImg) previewImg.style.display = 'none';
    if (placeholder) placeholder.style.display = '';
  }
  
  // Load and display existing documents (certificate + appointment letter)
  try {
    const { data: documents } = await supabaseClient.from('teacher_documents')
      .select('*')
      .eq('teacher_id', teacher.id);
    
    const certContainer = getEl('teacherProfileCertificateDownload');
    const apptContainer = getEl('teacherProfileAppointmentDownload');
    
    const certDocs = (documents || []).filter(d => d.document_type === 'certificate');
    const apptDocs = (documents || []).filter(d => d.document_type === 'appointment_letter');
    
    if (certContainer) {
      if (certDocs.length > 0) {
        certContainer.innerHTML = certDocs.map(d => 
          `<a href="${d.file_url}" target="_blank" rel="noopener" style="display:inline-block;padding:0.25rem 0.5rem;background:var(--primary-light);border:1px solid var(--primary);border-radius:4px;color:var(--primary);text-decoration:none;font-size:0.75rem;margin-bottom:0.25rem;">📄 Download: ${d.file_name || 'Certificate.pdf'}</a>`
        ).join('<br>');
      } else {
        certContainer.innerHTML = '';
      }
    }
    
    if (apptContainer) {
      if (apptDocs.length > 0) {
        apptContainer.innerHTML = apptDocs.map(d => 
          `<a href="${d.file_url}" target="_blank" rel="noopener" style="display:inline-block;padding:0.25rem 0.5rem;background:var(--primary-light);border:1px solid var(--primary);border-radius:4px;color:var(--primary);text-decoration:none;font-size:0.75rem;margin-bottom:0.25rem;">📄 Download: ${d.file_name || 'Appointment.pdf'}</a>`
        ).join('<br>');
      } else {
        apptContainer.innerHTML = '';
      }
    }
  } catch (err) {
    console.error('Failed to load teacher documents:', err);
  }
}
