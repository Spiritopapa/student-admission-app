/**
 * Attendance Report — standalone page  (attendance-report.html)
 *
 * Generates a self-contained, printable attendance report. Because the page is
 * same-origin it shares the persisted Supabase session (localStorage), so it can
 * restore auth and read attendance like the inline dashboards.
 *
 * Security: scope (admin vs teacher) and school are derived from the signed-in
 * profile — never from the URL query params. Query params only carry FILTERS
 * (class, term, date range).
 */

import { initSchoolIdHelper, getCurrentSchoolId, buildStudentName } from './utils.js';
import supabaseClient from '../supabase-config.js';

initSchoolIdHelper(supabaseClient);

// ================================================================
// Read filters from the URL  (filters only — NOT scope)
// ================================================================
const params = new URLSearchParams(window.location.search);
const classFilter = params.get('class') || '';
const termFilter = params.get('term') || '';
const dateFrom = params.get('from') || '';
const dateTo = params.get('to') || '';

// Last fetched data is kept so the Summary/Daily toggle doesn't refetch.
let _records = [];
let _appMap = new Map();

// ================================================================
// Tiny DOM helpers
// ================================================================
function el(id) { return document.getElementById(id); }

function showMessage(text, type = 'info') {
  const box = el('reportMessage');
  if (!box) return;
  box.textContent = text;
  box.className = 'report-message ' + type;
  box.style.display = 'block';
}

function hideMessage() {
  const box = el('reportMessage');
  if (box) box.style.display = 'none';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================================================================
// Scope helpers
// ================================================================
async function getTeacherClasses(userId) {
  try {
    const { data: teacher } = await supabaseClient.from('teachers')
      .select('*').eq('user_id', userId).maybeSingle();
    if (!teacher) return [];
    const { data: assignments } = await supabaseClient.from('teacher_classes_subjects')
      .select('class_name').eq('teacher_id', teacher.id);
    if (assignments && assignments.length > 0) {
      return [...new Set(assignments.map(a => a.class_name))].sort();
    }
    return teacher.class_taught
      ? teacher.class_taught.split(',').map(c => c.trim()).filter(Boolean).sort()
      : [];
  } catch (err) {
    console.error('Failed to load teacher classes:', err);
    return [];
  }
}

async function fetchSchoolName(schoolId) {
  try {
    if (schoolId) {
      const { data: ss } = await supabaseClient.from('school_settings')
        .select('school_name').eq('school_id', schoolId).maybeSingle();
      if (ss?.school_name) return ss.school_name;
    }
    let q = supabaseClient.from('settings').select('school_name').eq('id', 'singleton');
    if (schoolId) q = q.eq('school_id', schoolId);
    const { data: settings } = await q.maybeSingle();
    if (settings?.school_name) return settings.school_name;
    if (schoolId) {
      const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).maybeSingle();
      if (school?.name) return school.name;
    }
  } catch (e) { /* ignore */ }
  return 'Attendance Report';
}

// ================================================================
// Fetch + render
// ================================================================
async function loadAndRender({ isTeacher, classes, schoolId }) {
  hideMessage();

  // --- settings for academic year + term default
  let settings = null;
  if (schoolId) {
    const { data: ss } = await supabaseClient.from('school_settings')
      .select('academic_year, current_term').eq('school_id', schoolId).maybeSingle();
    if (ss) settings = ss;
  }
  if (!settings) {
    let q = supabaseClient.from('settings').select('academic_year, current_term').eq('id', 'singleton');
    if (schoolId) q = q.eq('school_id', schoolId);
    const { data: legacy } = await q.maybeSingle();
    settings = legacy || null;
  }
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);

  // Resolve the requested class (teacher cannot view classes they don't teach)
  let effectiveClass = classFilter;
  if (isTeacher && effectiveClass && !classes.includes(effectiveClass)) effectiveClass = '';

  // --- Build the attendance query ---
  let query = supabaseClient.from('attendance').select('*').eq('academic_year', academicYear);
  if (schoolId) query = query.eq('school_id', schoolId);
  if (isTeacher) {
    query = classes.length ? query.in('class_name', classes) : query.eq('class_name', '__none__');
  } else if (effectiveClass) {
    query = query.eq('class_name', effectiveClass);
  }
  if (termFilter) query = query.eq('term', termFilter);
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  query = query.order('date', { ascending: false }).order('student_id', { ascending: true });

  const { data: records, error } = await query;
  if (error) { console.error('Attendance report error:', error); showMessage('Failed to load attendance: ' + error.message, 'error'); return; }

  _records = records || [];
  if (_records.length === 0) {
    el('reportStats').style.display = 'none';
    el('reportToggle').style.display = 'none';
    el('summaryWrap').style.display = 'none';
    el('dailyWrap').style.display = 'none';
    showMessage('No attendance records found for the selected filters.', 'info');
    return;
  }

  // --- Fetch student names ---
  const studentIds = [...new Set(_records.map(r => r.student_id))];
  const { data: apps } = await supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .in('student_id', studentIds);
  _appMap = new Map((apps || []).map(a => [a.student_id, a]));

  // --- Build metadata line ---
  const roleLabel = isTeacher ? 'Teacher' : 'Admin';
  const filterParts = ['Role: ' + roleLabel];
  if (effectiveClass) filterParts.push('Class: ' + effectiveClass);
  if (termFilter) filterParts.push('Term: ' + termFilter);
  if (dateFrom || dateTo) {
    filterParts.push(dateFrom === dateTo ? 'Date: ' + dateFrom : 'Dates: ' + (dateFrom || '…') + ' → ' + (dateTo || '…'));
  }
  filterParts.push('Academic Year: ' + academicYear);
  filterParts.push('Generated: ' + new Date().toLocaleString());
  el('reportMeta').innerHTML = filterParts.map(p => '<strong>' + esc(p) + '</strong>').join(' · ');

  renderSummary();
  renderDaily();
}

// ================================================================
// Rendering
// ================================================================
function renderSummary() {
  const body = el('summaryBody');
  const studentStats = {};
  _records.forEach(r => {
    const sid = r.student_id;
    if (!studentStats[sid]) studentStats[sid] = { present: 0, absent: 0, total: 0 };
    studentStats[sid].total++;
    if (r.status === 'present') studentStats[sid].present++;
    else if (r.status === 'absent') studentStats[sid].absent++;
  });

  const rows = Object.entries(studentStats).map(([sid, s]) => {
    const app = _appMap.get(sid);
    const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : sid;
    const cls = app?.class_applying || '';
    const pct = s.total > 0 ? (s.present / s.total) * 100 : 0;
    return { sid, name, cls, ...s, pct };
  }).sort((a, b) => b.pct - a.pct);

  const pctClass = p => p >= 80 ? 'pct-good' : p >= 50 ? 'pct-warn' : 'pct-bad';

  body.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(r.sid)}</strong></td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.cls || '-')}</td>
      <td class="num">${r.present}</td>
      <td class="num">${r.absent}</td>
      <td class="num">${r.total}</td>
      <td class="num ${pctClass(r.pct)}">${r.pct.toFixed(1)}%</td>
    </tr>`).join('');

  // Summary total row
  const tPresent = rows.reduce((s, r) => s + r.present, 0);
  const tAbsent = rows.reduce((s, r) => s + r.absent, 0);
  const tTotal = rows.reduce((s, r) => s + r.total, 0);
  const tPct = tTotal > 0 ? ((tPresent / tTotal) * 100).toFixed(1) : '0.0';
  const totalRow = `<tr class="summary-row-total">
    <td></td><td></td><td>ALL STUDENTS</td><td></td>
    <td class="num">${tPresent}</td><td class="num">${tAbsent}</td>
    <td class="num">${tTotal}</td>
    <td class="num ${pctClass(parseFloat(tPct))}">${tPct}%</td>
  </tr>`;
  body.insertAdjacentHTML('beforeend', totalRow);

  updateMiniStats();
}

function renderDaily() {
  const body = el('dailyBody');
  const grouped = {};
  _records.forEach(r => { (grouped[r.date] = grouped[r.date] || []).push(r); });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  let html = '';
  sortedDates.forEach(date => {
    const dayRecords = grouped[date];
    const present = dayRecords.filter(r => r.status === 'present').length;
    const absent = dayRecords.filter(r => r.status === 'absent').length;
    const total = dayRecords.length;
    const pct = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

    html += `<tr class="day-head"><td colspan="6">📅 <strong>${esc(date)}</strong>
      <span style="font-weight:400;color:var(--muted);margin-left:0.5rem;">
        Present: ${present} | Absent: ${absent} | Total: ${total} | ${pct}%</span>
    </td></tr>`;

    dayRecords.forEach(r => {
      const app = _appMap.get(r.student_id);
      const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id;
      const cls = app?.class_applying || r.class_name || '-';
      const statusCls = r.status === 'present' ? 'status-present' : 'status-absent';
      const statusLabel = r.status === 'present' ? '✅ Present' : '❌ Absent';
      html += `<tr>
        <td>${esc(r.date)}</td>
        <td><strong>${esc(r.student_id)}</strong></td>
        <td>${esc(name)}</td>
        <td>${esc(cls)}</td>
        <td class="${statusCls}">${statusLabel}</td>
        <td>${esc(r.remarks || '-')}</td>
      </tr>`;
    });
  });

  body.innerHTML = html;
}

function updateMiniStats() {
  const present = _records.filter(r => r.status === 'present').length;
  const absent = _records.filter(r => r.status === 'absent').length;
  const students = new Set(_records.map(r => r.student_id)).size;
  const days = new Set(_records.map(r => r.date)).size;
  el('statPresent').textContent = present;
  el('statAbsent').textContent = absent;
  el('statStudents').textContent = students;
  el('statDays').textContent = days;
  el('reportStats').style.display = 'flex';
}

// ================================================================
// Mode toggle (client-side, no refetch)
// ================================================================
function showSummaryView() {
  el('btnSummaryView').classList.add('active');
  el('btnDailyView').classList.remove('active');
  el('summaryWrap').style.display = 'block';
  el('dailyWrap').style.display = 'none';
  el('reportType').textContent = '📊 Summary Report';
}
function showDailyView() {
  el('btnDailyView').classList.add('active');
  el('btnSummaryView').classList.remove('active');
  el('summaryWrap').style.display = 'none';
  el('dailyWrap').style.display = 'block';
  el('reportType').textContent = '📅 Daily Report';
}

// ================================================================
// Boot
// ================================================================
async function initReport() {
  el('btnPrintReport')?.addEventListener('click', () => window.print());
  el('btnBack')?.addEventListener('click', () => {
    if (window.opener) { try { window.close(); } catch (e) { window.location.href = 'index.html'; } }
    else window.location.href = 'index.html';
  });
  el('btnSummaryView')?.addEventListener('click', showSummaryView);
  el('btnDailyView')?.addEventListener('click', showDailyView);

  // Same-origin popup shares the persisted Supabase session.
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData?.session) {
    showMessage('⚠️ You are not signed in. Please close this window and open the report from the app.', 'error');
    el('reportMeta').textContent = 'Not signed in';
    return;
  }
  const user = sessionData.session.user;

  const { data: profile } = await supabaseClient.from('profiles')
    .select('role, school_id').eq('id', user.id).maybeSingle();
  const role = profile?.role || '';

  const isAdmin = ['admin', 'sub_admin', 'school'].includes(role);
  const isTeacher = role === 'teacher';
  if (!isAdmin && !isTeacher) {
    showMessage('You do not have permission to view attendance reports.', 'error');
    return;
  }

  const schoolId = profile?.school_id || await getCurrentSchoolId();
  let classes = [];
  if (isTeacher) classes = await getTeacherClasses(user.id);

  // School name + title
  const schoolName = await fetchSchoolName(schoolId);
  el('reportSchoolName').textContent = schoolName;
  document.title = schoolName + ' - Attendance Report';

  el('reportType').textContent = isTeacher
    ? '📊 Teacher Attendance Report'
    : (classFilter ? '📊 ' + classFilter + ' Attendance Report' : '📊 School Attendance Report');
  el('reportToggle').style.display = 'flex';
  showSummaryView();

  await loadAndRender({ isTeacher, classes, schoolId });
}

initReport().catch(err => {
  console.error('Attendance report init error:', err);
  showMessage('Something went wrong while building the report. Please try again.', 'error');
});