/**
 * Admin Attendance Module
 * Enhanced with date-range filtering, daily view, and instant report after save.
 * Added 30-day checkbox mode for bulk attendance marking.
 */

import { getEl, showMessage, setLoading, formatDate, logSubAdminActivity, getCurrentSchoolId, openPrintWindow } from './utils.js';

let supabaseClient = null;
let attendanceCache = [];
let monthlyCache = []; // Stores { student_id, name, class_applying, days: { [date]: status } }

export function initAdminAttendance(supabase) {
  supabaseClient = supabase;
}

export function setupAttendanceListeners() {
  getEl('btnLoadAttendance')?.addEventListener('click', loadAttendanceForDate);
  getEl('btnSaveAttendance')?.addEventListener('click', saveAttendance);
  getEl('btnViewAttReport')?.addEventListener('click', loadAttendanceReport);
  getEl('attReportSearch')?.addEventListener('input', renderAttendanceReport);
  getEl('attReportClass')?.addEventListener('change', renderAttendanceReport);
  getEl('attReportTerm')?.addEventListener('change', renderAttendanceReport);
  getEl('attReportDateFrom')?.addEventListener('change', renderAttendanceReport);
  getEl('attReportDateTo')?.addEventListener('change', renderAttendanceReport);
  getEl('btnRefreshReport')?.addEventListener('click', renderAttendanceReport);
  getEl('btnPrintAttReport')?.addEventListener('click', printAttendanceReport);
  getEl('btnPrintAttDailyReport')?.addEventListener('click', printAttendanceDailyReport);
  
  // Report mode toggle
  getEl('btnAttReportSummary')?.addEventListener('click', () => switchReportMode('summary'));
  getEl('btnAttReportDaily')?.addEventListener('click', () => switchReportMode('daily'));

  // 30-Day Mode listeners
  getEl('adminAttModeDaily')?.addEventListener('click', () => switchAttendanceMode('daily'));
  getEl('adminAttModeMonthly')?.addEventListener('click', () => switchAttendanceMode('monthly'));
  getEl('btnLoadMonthlyAttendance')?.addEventListener('click', loadMonthlyAttendance);
  getEl('btnSaveMonthlyAttendance')?.addEventListener('click', saveMonthlyAttendance);
  getEl('btnSetAllPresent')?.addEventListener('click', () => setAllMonthlyStatus('present'));
  getEl('btnSetAllAbsent')?.addEventListener('click', () => setAllMonthlyStatus('absent'));
  getEl('btnResetMonthlyAttendance')?.addEventListener('click', resetAllMonthlyStatus);
  getEl('btnPrintMonthlyAttendance')?.addEventListener('click', printMonthlyAttendanceGrid);
}

function switchAttendanceMode(mode) {
  document.querySelectorAll('.att-mode-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'daily') {
    getEl('adminAttModeDaily')?.classList.add('active');
    getEl('adminAttModeDailyContent').style.display = '';
    getEl('adminAttModeMonthlyContent').style.display = 'none';
  } else {
    getEl('adminAttModeMonthly')?.classList.add('active');
    getEl('adminAttModeDailyContent').style.display = 'none';
    getEl('adminAttModeMonthlyContent').style.display = '';
    // Set default start date to 1st of current month
    const startInput = getEl('adminAttMonthlyStart');
    if (startInput && !startInput.value) {
      const now = new Date();
      startInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    // Populate class filter
    populateMonthlyClassFilter();
  }
}

async function populateMonthlyClassFilter() {
  const sel = getEl('adminAttMonthlyClass');
  if (!sel) return;
  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: classes } = await query;
    sel.innerHTML = '<option value="">All Classes</option>' + (classes || []).map(c => `<option>${c.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load monthly class filter:', err);
  }
}

function switchReportMode(mode) {
  document.querySelectorAll('.att-report-mode').forEach(b => b.classList.remove('active'));
  if (mode === 'summary') {
    getEl('btnAttReportSummary')?.classList.add('active');
    getEl('attReportSummaryTable').style.display = '';
    getEl('attReportDailyTable').style.display = 'none';
  } else {
    getEl('btnAttReportDaily')?.classList.add('active');
    getEl('attReportSummaryTable').style.display = 'none';
    getEl('attReportDailyTable').style.display = '';
  }
  // Re-render the report to populate the currently active view
  renderAttendanceReport();
}

export async function loadAttendancePage() {
  await populateAttendanceClassFilter();
  const dateInput = getEl('adminAttDate');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  const reportSection = getEl('attendanceReportSection');
  if (reportSection) reportSection.style.display = 'none';
  const stats = getEl('attendanceStats');
  if (stats) stats.style.display = 'none';
  const tbody = getEl('attendanceBody');
  const noEl = getEl('adminNoAttendance');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Select a date and class, then click "Load Attendance" to begin.</td></tr>';
  if (noEl) noEl.style.display = 'none';
  // Reset monthly mode
  monthlyCache = [];
  const monthlyBody = getEl('attMonthlyBody');
  if (monthlyBody) {
    monthlyBody.innerHTML = '<tr><td colspan="36" style="text-align:center;padding:2rem;color:var(--text-muted);">Select a start date and class, then click "Load 30-Day Grid" to begin.</td></tr>';
  }
  const monthlyStats = getEl('attMonthlyStats');
  if (monthlyStats) monthlyStats.style.display = 'none';
  const monthlyNo = getEl('adminNoMonthlyAttendance');
  if (monthlyNo) monthlyNo.style.display = 'none';
  const monthlyMsg = getEl('attMonthlyMessage');
  if (monthlyMsg) monthlyMsg.style.display = 'none';
}

async function populateAttendanceClassFilter() {
  const sel = getEl('adminAttClassFilter');
  if (!sel) return;
  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: classes } = await query;
    sel.innerHTML = '<option value="">All Classes</option>' + (classes || []).map(c => `<option>${c.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load attendance class filter:', err);
  }
}

async function loadAttendanceForDate() {
  const dateInput = getEl('adminAttDate');
  const classFilter = getEl('adminAttClassFilter')?.value || '';
  const search = (getEl('adminAttSearch')?.value || '').toLowerCase();
  const date = dateInput?.value;
  if (!date) { alert('Please select a date.'); return; }

  const schoolId = await getCurrentSchoolId();
  let settings = null;
  // PRIMARY: Use per-school `school_settings` table (correct per-school settings)
  if (schoolId) {
    const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
      .select('academic_year, current_term')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (schoolSettingsData) settings = schoolSettingsData;
  }
  // FALLBACK: Use legacy `settings` table
  if (!settings) {
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const { data: legacySettings } = await settingsQuery.maybeSingle();
    settings = legacySettings || null;
  }
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';
  let query = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('status', 'admitted');
  if (schoolId) query = query.eq('school_id', schoolId);
  if (classFilter) query = query.eq('class_applying', classFilter);
  query = query.order('first_name', { ascending: true });
  const { data: apps, error: appsErr } = await query;
  if (appsErr) { console.error('Load apps for attendance error:', appsErr); return; }
  if (!apps || apps.length === 0) {
    getEl('adminNoAttendance').style.display = 'block';
    getEl('attendanceBody').innerHTML = '';
    return;
  }

  let existingAttQuery = supabaseClient.from('attendance').select('*').eq('date', date);
  if (schoolId) existingAttQuery = existingAttQuery.eq('school_id', schoolId);
  const { data: existingAtt } = await existingAttQuery;
  const attMap = new Map((existingAtt || []).map(a => [a.student_id, a]));

  let filteredApps = apps;
  if (search) {
    filteredApps = apps.filter(a => {
      const name = [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ').toLowerCase();
      return name.includes(search) || a.student_id.toLowerCase().includes(search);
    });
  }

  const tbody = getEl('attendanceBody');
  const noEl = getEl('adminNoAttendance');
  if (!tbody) return;

  if (filteredApps.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';

  attendanceCache = filteredApps.map(app => {
    const existing = attMap.get(app.student_id);
    return {
      student_id: app.student_id,
      name: [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' '),
      class_applying: app.class_applying,
      date: date,
      status: existing?.status || 'present',
      remarks: existing?.remarks || '',
      id: existing?.id || null,
      academic_year: existing?.academic_year || academicYear,
      term: existing?.term || currentTerm,
    };
  });

  renderAttendanceTable();
}

function renderAttendanceTable() {
  const tbody = getEl('attendanceBody');
  const stats = getEl('attendanceStats');
  if (!tbody) return;

  const counts = { present: 0, absent: 0 };
  attendanceCache.forEach(a => { counts[a.status]++; });
  const total = attendanceCache.length;

  if (stats) {
    stats.style.display = 'flex';
    getEl('attStatPresent').textContent = counts.present;
    getEl('attStatAbsent').textContent = counts.absent;
    getEl('attStatTotal').textContent = total;
  }

  if (attendanceCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = attendanceCache.map((a, idx) => {
    const statusBtns = ['present', 'absent'].map(s => {
      const active = a.status === s ? ' active' : '';
      const icons = { present: '✓', absent: '✗' };
      return `<button type="button" class="att-status-btn ${s}${active}" data-student="${a.student_id}" data-status="${s}">${icons[s]}</button>`;
    }).join(' ');

    return `<tr>
      <td>${idx + 1}</td>
      <td><strong>${a.student_id}</strong></td>
      <td>${a.name}</td>
      <td>${a.class_applying}</td>
      <td class="att-status-cell">${statusBtns}</td>
      <td><input type="text" class="att-remarks-input" data-student="${a.student_id}" value="${a.remarks}" placeholder="Optional..." style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;font-family:inherit;" /></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.att-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const studentId = btn.dataset.student;
      const newStatus = btn.dataset.status;
      const row = attendanceCache.find(a => a.student_id === studentId);
      if (!row) return;
      row.status = newStatus;
      const parentCell = btn.closest('.att-status-cell');
      parentCell.querySelectorAll('.att-status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateAttStats();
    });
  });

  tbody.querySelectorAll('.att-remarks-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const studentId = inp.dataset.student;
      const row = attendanceCache.find(a => a.student_id === studentId);
      if (row) row.remarks = inp.value;
    });
  });
}

function updateAttStats() {
  const counts = { present: 0, absent: 0 };
  attendanceCache.forEach(a => { counts[a.status]++; });
  getEl('attStatPresent').textContent = counts.present;
  getEl('attStatAbsent').textContent = counts.absent;
  getEl('attStatTotal').textContent = attendanceCache.length;
}

async function saveAttendance() {
  if (attendanceCache.length === 0) { alert('No attendance records to save. Load attendance first.'); return; }
  const btn = getEl('btnSaveAttendance');
  setLoading(btn, true, 'Saving...');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const schoolId = await getCurrentSchoolId();
    let settings = null;
    // PRIMARY: Use per-school `school_settings` table (correct per-school settings)
    if (schoolId) {
      const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
        .select('academic_year, current_term')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettingsData) settings = schoolSettingsData;
    }
    // FALLBACK: Use legacy `settings` table
    if (!settings) {
      let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
      if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
      const { data: legacySettings } = await settingsQuery.maybeSingle();
      settings = legacySettings || null;
    }
    const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const currentTerm = settings?.current_term || 'First';

    // First, look up ALL existing attendance records for this date (without school_id filter)
    // to find any records that might exist but weren't loaded due to RLS/school_id mismatch
    const studentIds = attendanceCache.map(r => r.student_id);
    const { data: allExisting } = await supabaseClient
      .from('attendance')
      .select('id, student_id')
      .eq('date', attendanceCache[0].date)
      .in('student_id', studentIds);
    const existingMap = new Map((allExisting || []).map(a => [a.student_id, a.id]));

    let saved = 0, updated = 0;
    for (const record of attendanceCache) {
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
          console.error('Update attendance error for', record.student_id, error);
          throw new Error(`Failed to update attendance for ${record.student_id}: ${error.message}`);
        }
      } else {
        const { data, error } = await supabaseClient.from('attendance').insert([payload]).select();
        if (!error && data && data.length > 0) {
          saved++;
          record.id = data[0].id;
        } else {
          console.error('Insert attendance error for', record.student_id, error);
          throw new Error(`Failed to save attendance for ${record.student_id}: ${error?.message || 'Unknown error'}`);
        }
      }
    }

    const msgEl = getEl('attendanceMessage') || getEl('payMessage');
    if (msgEl) {
      showMessage(msgEl.id, `✅ Attendance saved! ${saved} new, ${updated} updated.`, 'success');
    } else {
      alert(`✅ Attendance saved! ${saved} new, ${updated} updated.`);
    }

    // Show instant report for today's date after saving
    const savedDate = attendanceCache[0]?.date;
    if (savedDate) {
      setTimeout(async () => {
        const reportSection = getEl('attendanceReportSection');
        if (reportSection) {
          reportSection.style.display = 'block';
          // Set date range to the saved date for instant report
          getEl('attReportDateFrom').value = savedDate;
          getEl('attReportDateTo').value = savedDate;
          getEl('attReportTerm').value = currentTerm;
          const dateLabel = getEl('attReportDateLabel');
          if (dateLabel) dateLabel.textContent = savedDate;
          await populateAttReportFilters();
          await renderAttendanceReport();
          // Scroll to report
          reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
    }

  } catch (err) {
    console.error('Save attendance error:', err);
    const msgEl = getEl('attendanceMessage') || getEl('payMessage');
    if (msgEl) {
      showMessage(msgEl.id, 'Error: ' + err.message, 'error');
    } else {
      alert('Error saving attendance: ' + err.message);
    }
  } finally {
    setLoading(btn, false, '💾 Save Attendance');
    logSubAdminActivity(`Saved attendance for ${attendanceCache.length} students`, 'attendance', `${attendanceCache.length} records`);
  }
}

// ================================================================
// 30-DAY CHECKBOX MODE FUNCTIONS
// ================================================================

/**
 * Load the 30-day attendance grid for the selected start date and class.
 */
async function loadMonthlyAttendance() {
  const startDateStr = getEl('adminAttMonthlyStart')?.value;
  const classFilter = getEl('adminAttMonthlyClass')?.value || '';

  if (!startDateStr) {
    alert('Please select a start date.');
    return;
  }

  const schoolId = await getCurrentSchoolId();

  // Generate 30 date strings from start date
  const startDate = new Date(startDateStr + 'T00:00:00');
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Load settings for academic year and term
  let settings = null;
  // PRIMARY: Use per-school `school_settings` table (correct per-school settings)
  if (schoolId) {
    const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
      .select('academic_year, current_term')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (schoolSettingsData) settings = schoolSettingsData;
  }
  // FALLBACK: Use legacy `settings` table
  if (!settings) {
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const { data: legacySettings } = await settingsQuery.maybeSingle();
    settings = legacySettings || null;
  }
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  // Load students
  let query = supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('status', 'admitted');
  if (schoolId) query = query.eq('school_id', schoolId);
  if (classFilter) query = query.eq('class_applying', classFilter);
  query = query.order('first_name', { ascending: true });
  const { data: apps, error: appsErr } = await query;
  if (appsErr) { console.error('Load monthly apps error:', appsErr); return; }

  const noEl = getEl('adminNoMonthlyAttendance');
  if (!apps || apps.length === 0) {
    if (noEl) noEl.style.display = 'block';
    getEl('attMonthlyBody').innerHTML = '';
    return;
  }
  if (noEl) noEl.style.display = 'none';

  // Load existing attendance records for these dates and students
  const studentIds = apps.map(a => a.student_id);
  let attQuery = supabaseClient.from('attendance')
    .select('*')
    .in('student_id', studentIds)
    .gte('date', dates[0])
    .lte('date', dates[dates.length - 1]);
  if (schoolId) attQuery = attQuery.eq('school_id', schoolId);
  const { data: existingAtt } = await attQuery;

  // Build a map: student_id -> { date: status }
  const attMap = new Map();
  (existingAtt || []).forEach(rec => {
    if (!attMap.has(rec.student_id)) {
      attMap.set(rec.student_id, {});
    }
    attMap.get(rec.student_id)[rec.date] = rec.status;
  });

  // Build monthly cache
  monthlyCache = apps.map(app => {
    const name = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ');
    const days = {};
    const studentAtt = attMap.get(app.student_id) || {};
    dates.forEach(date => {
      days[date] = studentAtt[date] || 'unmarked';
    });
    return {
      student_id: app.student_id,
      name: name,
      class_applying: app.class_applying,
      days: days,
      academic_year: academicYear,
      term: currentTerm,
    };
  });

  renderMonthlyGrid(dates);
}

/**
 * Render the 30-day attendance grid table.
 */
function renderMonthlyGrid(dates) {
  const thead = getEl('attMonthlyHeaderRow');
  const tbody = getEl('attMonthlyBody');
  if (!thead || !tbody) return;

  // Build header row
  let headerHtml = '<th class="save-cell-header" style="min-width:50px;">Save</th>';
  headerHtml += '<th class="student-name-cell" style="min-width:140px;">Student Name</th>';
  headerHtml += '<th class="student-id-cell" style="min-width:80px;">ID</th>';
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

  // Build body rows
  if (monthlyCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="36" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  const tbodyHtml = monthlyCache.map(student => {
    let presentCount = 0;
    let markedCount = 0;
    const dayCells = dates.map(date => {
      const status = student.days[date] || 'unmarked';
      if (status === 'present') presentCount++;
      if (status !== 'unmarked') markedCount++;
      const d = new Date(date + 'T00:00:00');
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const weekendClass = isWeekend ? ' weekend' : '';
      const icons = { present: '✓', absent: '✗' };
      const iconHtml = status !== 'unmarked' ? `<span class="day-status-icon">${icons[status] || '✗'}</span>` : '<span class="day-status-icon" style="opacity:0.3;">—</span>';
      return `<td class="att-day-cell ${status}${weekendClass}" data-student="${student.student_id}" data-date="${date}" data-status="${status}">
        ${iconHtml}
      </td>`;
    }).join('');

    return `<tr>
      <td class="save-cell"><button type="button" class="btn-save-student" data-student="${student.student_id}" title="Save this student's attendance">💾</button></td>
      <td class="student-name-cell">${student.name}</td>
      <td class="student-id-cell">${student.student_id}</td>
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
      saveIndividualMonthlyAttendance(studentId);
    });
  });

  // Add click handlers to day cells
  tbody.querySelectorAll('.att-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const studentId = cell.dataset.student;
      const date = cell.dataset.date;
      const student = monthlyCache.find(s => s.student_id === studentId);
      if (!student) return;

      // Cycle through statuses: unmarked -> present -> absent -> unmarked
      const statusOrder = ['unmarked', 'present', 'absent'];
      const currentStatus = student.days[date] || 'unmarked';
      const currentIdx = statusOrder.indexOf(currentStatus);
      const nextStatus = statusOrder[(currentIdx + 1) % statusOrder.length];
      student.days[date] = nextStatus;

      // Update cell appearance
      const icons = { present: '✓', absent: '✗' };
      cell.className = `att-day-cell ${nextStatus}`;
      cell.dataset.status = nextStatus;
      const iconHtml = nextStatus !== 'unmarked' ? `<span class="day-status-icon">${icons[nextStatus]}</span>` : '<span class="day-status-icon" style="opacity:0.3;">—</span>';
      cell.innerHTML = iconHtml;

      updateMonthlyStats(dates);
    });
  });

  // Add click handlers to column headers (toggle all students for that day)
  thead.querySelectorAll('.day-header').forEach(header => {
    header.addEventListener('click', () => {
      const date = header.dataset.date;
      if (!date) return;

      // Determine current status for this day
      const cells = tbody.querySelectorAll(`.att-day-cell[data-date="${date}"]`);
      const firstCell = cells[0];
      if (!firstCell) return;

      // Toggle: if all present, set all absent; otherwise set all present
      const allPresent = Array.from(cells).every(c => c.dataset.status === 'present');
      const newStatus = allPresent ? 'absent' : 'present';
      const icons = { present: '✓', absent: '✗' };

      cells.forEach(cell => {
        const studentId = cell.dataset.student;
        const student = monthlyCache.find(s => s.student_id === studentId);
        if (student) {
          student.days[date] = newStatus;
        }
        cell.className = `att-day-cell ${newStatus}`;
        cell.dataset.status = newStatus;
        cell.innerHTML = `<span class="day-status-icon">${icons[newStatus]}</span>`;
      });

      updateMonthlyStats(dates);
    });
  });

  updateMonthlyStats(dates);
}

/**
 * Update the monthly stats summary bar.
 */
function updateMonthlyStats(dates) {
  let totalPresent = 0, totalAbsent = 0, totalUnmarked = 0;

  monthlyCache.forEach(student => {
    dates.forEach(date => {
      const status = student.days[date] || 'unmarked';
      if (status === 'present') totalPresent++;
      else if (status === 'absent') totalAbsent++;
      else if (status === 'unmarked') totalUnmarked++;
    });
  });
  const totalRecords = totalPresent + totalAbsent;

  getEl('attMonthlyPresent').textContent = totalPresent;
  getEl('attMonthlyAbsent').textContent = totalAbsent;
  getEl('attMonthlyTotal').textContent = totalRecords;

  const stats = getEl('attMonthlyStats');
  if (stats) stats.style.display = 'flex';
}

/**
 * Set all cells in the monthly grid to a specific status.
 */
function setAllMonthlyStatus(status) {
  if (monthlyCache.length === 0) {
    alert('No attendance data loaded. Load the 30-day grid first.');
    return;
  }

  const icons = { present: '✓', absent: '✗' };
  const dates = Object.keys(monthlyCache[0]?.days || {});

  monthlyCache.forEach(student => {
    dates.forEach(date => {
      student.days[date] = status;
    });
  });

  // Update all cells in the grid
  const tbody = getEl('attMonthlyBody');
  if (tbody) {
    tbody.querySelectorAll('.att-day-cell').forEach(cell => {
      cell.className = `att-day-cell ${status}`;
      cell.dataset.status = status;
      cell.innerHTML = `<span class="day-status-icon">${icons[status]}</span>`;
    });
  }

  updateMonthlyStats(dates);
}

/**
 * Reset all cells in the monthly grid back to unmarked (clear attendance).
 */
function resetAllMonthlyStatus() {
  if (monthlyCache.length === 0) {
    alert('No attendance data loaded. Load the 30-day grid first.');
    return;
  }

  if (!confirm('Are you sure you want to reset all attendance markings? This will clear all cells.')) {
    return;
  }

  const dates = Object.keys(monthlyCache[0]?.days || {});

  monthlyCache.forEach(student => {
    dates.forEach(date => {
      student.days[date] = 'unmarked';
    });
  });

  // Update all cells in the grid
  const tbody = getEl('attMonthlyBody');
  if (tbody) {
    tbody.querySelectorAll('.att-day-cell').forEach(cell => {
      cell.className = 'att-day-cell unmarked';
      cell.dataset.status = 'unmarked';
      cell.innerHTML = '<span class="day-status-icon" style="opacity:0.3;">—</span>';
    });
  }

  updateMonthlyStats(dates);
}

/**
 * Save all monthly attendance records to the database.
 */
async function saveMonthlyAttendance() {
  if (monthlyCache.length === 0) {
    alert('No attendance data to save. Load the 30-day grid first.');
    return;
  }

  const btn = getEl('btnSaveMonthlyAttendance');
  setLoading(btn, true, 'Saving...');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const schoolId = await getCurrentSchoolId();

    // Collect all records to save
    // - Marked cells (present/absent) are inserted or updated
    // - Unmarked cells are tracked separately so existing records can be DELETED
    const recordsToSave = [];
    const unmarkedKeys = []; // "student_id|date" pairs for cells to clear
    monthlyCache.forEach(student => {
      Object.entries(student.days).forEach(([date, status]) => {
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

    // Delete existing records for unmarked cells (admin unmarked them)
    for (const key of unmarkedKeys) {
      const existingId = existingMap.get(key);
      if (existingId) {
        const { error } = await supabaseClient.from('attendance').delete().eq('id', existingId);
        if (!error) {
          deleted++;
        } else {
          console.error('Admin delete monthly att error for', key, error);
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
          console.error('Update monthly att error for', record.student_id, record.date, error);
        }
      } else {
        const { error } = await supabaseClient.from('attendance').insert([record]);
        if (!error) {
          saved++;
        } else {
          console.error('Insert monthly att error for', record.student_id, record.date, error);
        }
      }
    }

    const msgEl = getEl('attMonthlyMessage');
    if (msgEl) {
      const parts = [];
      if (saved > 0) parts.push(`${saved} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (deleted > 0) parts.push(`${deleted} removed`);
      showMessage(msgEl.id, `✅ 30-Day attendance saved! ${parts.join(', ') || 'No changes'}.`, 'success');
    }

    logSubAdminActivity(`Saved 30-day attendance for ${monthlyCache.length} students`, 'attendance', `${saved} new, ${updated} updated`);

  } catch (err) {
    console.error('Save monthly attendance error:', err);
    const msgEl = getEl('attMonthlyMessage');
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
 */
async function saveIndividualMonthlyAttendance(studentId) {
  const student = monthlyCache.find(s => s.student_id === studentId);
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
    const schoolId = await getCurrentSchoolId();

    // Collect records for this student
    const recordsToSave = [];
    const unmarkedKeys = []; // "student_id|date" pairs for cells to clear
    Object.entries(student.days).forEach(([date, status]) => {
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

    // Delete existing records for unmarked cells (admin unmarked them)
    for (const key of unmarkedKeys) {
      const existingId = existingMap.get(key);
      if (existingId) {
        const { error } = await supabaseClient.from('attendance').delete().eq('id', existingId);
        if (!error) {
          deleted++;
        } else {
          console.error('Admin delete individual monthly att error for', key, error);
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
          console.error('Admin update individual monthly att error for', record.student_id, record.date, error);
        }
      } else {
        const { error } = await supabaseClient.from('attendance').insert([record]);
        if (!error) {
          saved++;
        } else {
          console.error('Admin insert individual monthly att error for', record.student_id, record.date, error);
        }
      }
    }

    const msgEl = getEl('attMonthlyMessage');
    if (msgEl) {
      const parts = [];
      if (saved > 0) parts.push(`${saved} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (deleted > 0) parts.push(`${deleted} removed`);
      showMessage(msgEl.id, `✅ Attendance saved for <strong>${student.name}</strong>! ${parts.join(', ') || 'No changes'}.`, 'success');
    }

    logSubAdminActivity(`Saved 30-day attendance for student ${student.name}`, 'attendance', `${saved} new, ${updated} updated`);

  } catch (err) {
    console.error('Save individual monthly attendance error:', err);
    const msgEl = getEl('attMonthlyMessage');
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

/**
 * Print the 30-day attendance grid as a print-ready page.
 */
async function printMonthlyAttendanceGrid() {
  if (monthlyCache.length === 0) {
    alert('No attendance data loaded. Load the 30-day grid first.');
    return;
  }

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

  const startDateStr = getEl('adminAttMonthlyStart')?.value || '';
  const classFilter = getEl('adminAttMonthlyClass')?.value || 'All Classes';
  const dates = Object.keys(monthlyCache[0]?.days || {});

  // Build print-friendly table
  let tableHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.7rem;">';
  tableHtml += '<thead><tr>';
  tableHtml += '<th style="border:1px solid #ccc;padding:0.3rem;background:#1e293b;color:#fff;text-align:left;">Student Name</th>';
  tableHtml += '<th style="border:1px solid #ccc;padding:0.3rem;background:#1e293b;color:#fff;text-align:left;">ID</th>';
  dates.forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const dayNum = d.getDate();
    const dayName = d.toLocaleDateString('en', { weekday: 'short' }).charAt(0);
    tableHtml += `<th style="border:1px solid #ccc;padding:0.2rem;background:#1e293b;color:#fff;text-align:center;min-width:22px;">${dayNum}<br><span style="font-size:0.5rem;opacity:0.7;">${dayName}</span></th>`;
  });
  tableHtml += '<th style="border:1px solid #ccc;padding:0.3rem;background:#1e293b;color:#fff;text-align:center;">✅</th>';
  tableHtml += '</tr></thead><tbody>';

  const statusIcons = { present: '✓', absent: '✗' };
  const statusColors = { present: '#d1fae5', absent: '#fee2e2' };

  monthlyCache.forEach(student => {
    let presentCount = 0;
    let markedCount = 0;
    tableHtml += '<tr>';
    tableHtml += `<td style="border:1px solid #ccc;padding:0.3rem;font-weight:600;">${student.name}</td>`;
    tableHtml += `<td style="border:1px solid #ccc;padding:0.3rem;">${student.student_id}</td>`;
    dates.forEach(date => {
      const status = student.days[date] || 'unmarked';
      if (status === 'present') presentCount++;
      if (status !== 'unmarked') markedCount++;
      const bgColor = statusColors[status] || 'transparent';
      const icon = status !== 'unmarked' ? (statusIcons[status] || '✗') : '—';
      tableHtml += `<td style="border:1px solid #ccc;padding:0.2rem;text-align:center;background:${bgColor};">${icon}</td>`;
    });
    tableHtml += `<td style="border:1px solid #ccc;padding:0.3rem;text-align:center;font-weight:700;">${presentCount}/${markedCount}</td>`;
    tableHtml += '</tr>';
  });

  tableHtml += '</tbody></table>';

  // Build legend
  const legend = `
    <div style="margin-top:0.75rem;font-size:0.7rem;display:flex;gap:1rem;flex-wrap:wrap;">
      <span><span style="display:inline-block;width:12px;height:12px;background:#d1fae5;border:1px solid #065f46;border-radius:2px;vertical-align:middle;"></span> Present (✓)</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:#fee2e2;border:1px solid #991b1b;border-radius:2px;vertical-align:middle;"></span> Absent (✗)</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:transparent;border:1px solid #ccc;border-radius:2px;vertical-align:middle;"></span> Unmarked (—)</span>
    </div>
  `;

  const content = `
    <div style="text-align:center;margin-bottom:1rem;">
      <h2 style="margin:0;font-size:1.4rem;">${schoolName}</h2>
      <h3 style="margin:0.25rem 0;font-size:1.1rem;">30-Day Attendance Grid</h3>
      <p style="margin:0.25rem 0;font-size:0.8rem;">
        Start Date: <strong>${startDateStr}</strong> | Class: <strong>${classFilter}</strong>
      </p>
      <p style="margin:0.25rem 0;font-size:0.75rem;color:#64748b;">Generated: ${new Date().toLocaleString()}</p>
    </div>
    ${tableHtml}
    ${legend}
    <div style="margin-top:1rem;font-size:0.75rem;color:#64748b;text-align:center;">Student Admission Portal</div>
  `;

  openPrintWindow(`<html><head>
    <title>30-Day Attendance Grid - ${schoolName}</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;padding:1rem;}
      table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #ccc;padding:0.3rem;text-align:left;font-size:0.7rem;}
      th{background:#1e293b;color:#fff;}
      @media print{
        body{padding:0;}
        table{font-size:0.65rem;}
        th,td{padding:0.2rem;}
      }
      @page { size: landscape; margin: 0.5in; }
    </style>
  </head><body>${content}</body></html>`, `30-Day Attendance Grid - ${schoolName}`, 1200, 800);
}

// ================================================================
// REPORT FUNCTIONS (unchanged)
// ================================================================

async function loadAttendanceReport() {
  const reportSection = getEl('attendanceReportSection');
  if (!reportSection) return;
  reportSection.style.display = 'block';
  await populateAttReportFilters();
  await renderAttendanceReport();
}

async function populateAttReportFilters() {
  const classSel = getEl('attReportClass');
  if (classSel) {
    try {
      const schoolId = await getCurrentSchoolId();
      let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
      if (schoolId) query = query.eq('school_id', schoolId);
      const { data: classes } = await query;
      if (classes) classSel.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option>${c.name}</option>`).join('');
    } catch (err) { console.error(err); }
  }
}

async function renderAttendanceReport() {
  const search = (getEl('attReportSearch')?.value || '').toLowerCase();
  const classFilter = getEl('attReportClass')?.value || '';
  const termFilter = getEl('attReportTerm')?.value || '';
  const dateFrom = getEl('attReportDateFrom')?.value || '';
  const dateTo = getEl('attReportDateTo')?.value || '';
  const tbody = getEl('attReportBody');
  const dailyBody = getEl('attReportDailyBody');
  const noEl = getEl('noAttReport');
  const dateLabel = getEl('attReportDateLabel');
  if (!tbody) return;

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
    const schoolId = await getCurrentSchoolId();
    let settings = null;
    // PRIMARY: Use per-school `school_settings` table (correct per-school settings)
    if (schoolId) {
      const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
        .select('academic_year')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettingsData) settings = schoolSettingsData;
    }
    // FALLBACK: Use legacy `settings` table
    if (!settings) {
      let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
      if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
      const { data: legacySettings } = await settingsQuery.maybeSingle();
      settings = legacySettings || null;
    }
    const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    let query = supabaseClient.from('attendance').select('*').eq('academic_year', academicYear);
    if (schoolId) query = query.eq('school_id', schoolId);
    if (termFilter) query = query.eq('term', termFilter);
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    query = query.order('date', { ascending: false }).order('student_id', { ascending: true });
    const { data: attRecords } = await query;
    if (!attRecords || attRecords.length === 0) { 
      tbody.innerHTML = ''; 
      if (dailyBody) dailyBody.innerHTML = '';
      if (noEl) noEl.style.display = 'block'; 
      return; 
    }
    if (noEl) noEl.style.display = 'none';

    const studentIds = [...new Set(attRecords.map(r => r.student_id))];
    let appsQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').in('student_id', studentIds);
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    if (classFilter) appsQuery = appsQuery.eq('class_applying', classFilter);
    const { data: apps } = await appsQuery;
    const appMap = new Map((apps || []).map(a => [a.student_id, a]));

    // Filter records by class if classFilter is set
    let filteredRecords = attRecords;
    if (classFilter) {
      filteredRecords = attRecords.filter(r => {
        const app = appMap.get(r.student_id);
        return app?.class_applying === classFilter || r.class_name === classFilter;
      });
    }

    if (filteredRecords.length === 0) {
      tbody.innerHTML = '';
      if (dailyBody) dailyBody.innerHTML = '';
      if (noEl) noEl.style.display = 'block';
      return;
    }
    if (noEl) noEl.style.display = 'none';

    // Determine which view is active
    const isSummaryVisible = getEl('attReportSummaryTable')?.style.display !== 'none';

    if (isSummaryVisible) {
      // === SUMMARY VIEW ===
      const studentStats = {};
      filteredRecords.forEach(r => {
        const sid = r.student_id;
        if (!studentStats[sid]) studentStats[sid] = { total: 0, present: 0, absent: 0 };
        studentStats[sid].total++;
        studentStats[sid][r.status]++;
      });

      const rows = Object.entries(studentStats)
        .map(([sid, stats]) => {
          const app = appMap.get(sid);
          const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : sid;
          const cls = app?.class_applying || '-';
          const pct = stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : '0.0';
          return { student_id: sid, name, class: cls, ...stats, pct };
        })
        .filter(r => {
          if (search && !r.name.toLowerCase().includes(search) && !r.student_id.toLowerCase().includes(search)) return false;
          if (classFilter && r.class !== classFilter) return false;
          return true;
        })
        .sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));

      tbody.innerHTML = rows.map(r => {
        const pctColor = parseFloat(r.pct) >= 80 ? 'var(--success)' : parseFloat(r.pct) >= 50 ? 'var(--warning)' : 'var(--danger)';
        return `<tr>
          <td><strong>${r.student_id}</strong></td><td>${r.name}</td><td>${r.class}</td>
          <td style="text-align:center;">${r.total}</td>
          <td style="text-align:center;color:var(--success);">${r.present}</td>
          <td style="text-align:center;color:var(--danger);">${r.absent}</td>
          <td style="text-align:center;"><strong style="color:${pctColor};">${r.pct}%</strong></td>
        </tr>`;
      }).join('');
    } else {
      // === DAILY VIEW ===
      // Group records by date
      const dateGroups = {};
      filteredRecords.forEach(r => {
        if (!dateGroups[r.date]) dateGroups[r.date] = [];
        dateGroups[r.date].push(r);
      });

      // Sort dates descending
      const sortedDates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));

      let dailyHtml = '';
      sortedDates.forEach(date => {
        const records = dateGroups[date];
        const dayCounts = { present: 0, absent: 0 };
        records.forEach(r => { dayCounts[r.status]++; });
        const dayTotal = records.length;
        const dayPct = dayTotal > 0 ? ((dayCounts.present / dayTotal) * 100).toFixed(1) : '0.0';

        // Date header row
        dailyHtml += `<tr style="background:var(--bg);font-weight:700;">
          <td colspan="6" style="padding:0.5rem 1rem;font-size:0.9rem;">
            📅 <strong>${date}</strong> 
            <span style="font-weight:400;font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem;">
              Present: ${dayCounts.present} | Absent: ${dayCounts.absent} | Total: ${dayTotal} | 
            </span>
            <span style="font-weight:600;font-size:0.8rem;">${dayPct}%</span>
          </td>
        </tr>`;

        // Individual records
        records.forEach((r, idx) => {
          const app = appMap.get(r.student_id);
          const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : r.student_id;
          const cls = app?.class_applying || r.class_name || '-';
          const statusIcons = { present: '✅', absent: '❌' };
          const statusColors = { present: 'var(--success)', absent: 'var(--danger)' };

          if (search && !name.toLowerCase().includes(search) && !r.student_id.toLowerCase().includes(search)) return;
          if (classFilter && cls !== classFilter) return;

          dailyHtml += `<tr>
            <td style="font-size:0.8rem;color:var(--text-muted);">${date}</td>
            <td><strong>${r.student_id}</strong></td>
            <td>${name}</td>
            <td>${cls}</td>
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
    console.error('Render attendance report error:', err);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--danger);">Error loading report.</td></tr>';
  }
}

async function printAttendanceReport() {
  // Determine which table to print
  let tbody, title;
  const isSummaryVisible = getEl('attReportSummaryTable')?.style.display !== 'none';
  
  if (isSummaryVisible) {
    tbody = getEl('attReportBody');
    title = 'Attendance Report - Summary';
  } else {
    tbody = getEl('attReportDailyBody');
    title = 'Attendance Report - Daily View';
  }
  
  if (!tbody || !tbody.innerHTML.trim()) { alert('No report data to print.'); return; }
  
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
  
  // Get the visible table
  const tableEl = isSummaryVisible 
    ? document.querySelector('#attReportSummaryTable .app-table')
    : document.querySelector('#attReportDailyTable .app-table');
  const tableHtml = tableEl?.outerHTML || '';
  
  const content = `<div style="text-align:center;margin-bottom:1rem;"><h2>${schoolName}</h2><h3>${title}</h3><p>Generated: ${new Date().toLocaleString()}</p></div>${tableHtml}<div style="margin-top:1rem;font-size:0.8rem;color:#64748b;text-align:center;">Student Admission Portal</div>`;
  openPrintWindow(`<html><head><title>${title} - ${schoolName}</title><style>body{font-family:'Segoe UI',sans-serif;padding:1rem;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:0.5rem;text-align:left;font-size:0.85rem;} th{background:#1e293b;color:#fff;} @media print{body{padding:0;}}</style></head><body>${content}</body></html>`, `${title} - ${schoolName}`, 900, 700);
}

async function printAttendanceDailyReport() {
  const dailyBody = getEl('attReportDailyBody');
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
  const dateFrom = getEl('attReportDateFrom')?.value || '';
  const dateTo = getEl('attReportDateTo')?.value || '';
  const dateLabel = dateFrom && dateTo ? (dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`) : 'All Dates';
  
  // Get the daily table element
  const tableEl = document.querySelector('#attReportDailyTable .app-table');
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

export { attendanceCache, monthlyCache };