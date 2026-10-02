import { supabase } from './supabase';
import { currentAcademicYear } from './constants';
import { openPrintWindow, escapeHtml } from './print';

export const EVENT_TYPE_LABELS = { holiday: 'Holiday', manual: 'Manual / Special Day' };
export const STATUS_ICONS = { present: '✓', absent: '✗' };
export const WEEKDAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function weekdayName(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en', { weekday: 'long' });
}

/** Build `days` date strings starting at startDateStr (defaults to today). */
export function buildDateRange(startDateStr, days = 30) {
  const start = new Date(`${startDateStr}T00:00:00`);
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function buildEventDayMap(eventDays) {
  const map = {};
  (eventDays || []).forEach((e) => {
    map[e.date] = e;
  });
  return map;
}

/** Academic year + term from per-school settings (with sane fallbacks). */
export async function fetchSchoolSettings(schoolId) {
  if (schoolId) {
    const { data } = await supabase
      .from('school_settings')
      .select('academic_year, current_term')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (data) return data;
  }
  return { academic_year: currentAcademicYear(), current_term: 'First' };
}

/** Event days for a school, newest first. */
export async function fetchEventDays(schoolId) {
  let q = supabase.from('attendance_event_days').select('*').order('date', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data } = await q;
  return data || [];
}

/** Present / absent / unmarked totals across a monthly grid. */
export function monthlyStats(rows, dates) {
  let present = 0;
  let absent = 0;
  let unmarked = 0;
  rows.forEach((s) => {
    dates.forEach((date) => {
      const status = s.days[date] || 'unmarked';
      if (status === 'present') present += 1;
      else if (status === 'absent') absent += 1;
      else unmarked += 1;
    });
  });
  const total = present + absent;
  return { present, absent, unmarked, total, pct: total ? Math.round((present / total) * 100) : 0 };
}
/**
 * Persist a batch of attendance rows (upsert on UNIQUE(student_id, date)) and
 * delete any rows for "unmarked" cells. Mirrors the legacy 30-day save flow.
 *
 * @param rows - full attendance record objects (student_id, date, status, ...)
 * @param unmarkedKeys - ["student_id|date"] pairs whose existing rows should be deleted
 */
export async function saveAttendanceBatch({ rows, unmarkedKeys = [], schoolId }) {
  let saved = 0;
  let updated = 0;
  let deleted = 0;

  const allKeys = [...rows.map((r) => `${r.student_id}|${r.date}`), ...unmarkedKeys];
  const studentIds = [...new Set(allKeys.map((k) => k.split('|')[0]))];
  const dates = [...new Set(allKeys.map((k) => k.split('|')[1]))];

  const { data: existing, error: existingError } = await supabase
    .from('attendance')
    .select('id, student_id, date')
    .in('student_id', studentIds.length ? studentIds : ['__none__'])
    .in('date', dates.length ? dates : ['__none__']);
  if (existingError) throw new Error(existingError.message);

  const existingMap = new Map((existing || []).map((r) => [`${r.student_id}|${r.date}`, r.id]));

  for (const key of unmarkedKeys) {
    const id = existingMap.get(key);
    if (!id) continue;
    const { error } = await supabase.from('attendance').delete().eq('id', id);
    if (error) throw new Error(`Could not clear attendance for ${key}: ${error.message}`);
    deleted += 1;
    existingMap.delete(key);
  }

  const toInsert = [];
  const toUpdate = [];
  rows.forEach((r) => {
    const key = `${r.student_id}|${r.date}`;
    const id = existingMap.get(key);
    if (id) toUpdate.push({ id, row: r });
    else toInsert.push(r);
  });

  for (const { id, row } of toUpdate) {
    const { error } = await supabase.from('attendance').update(row).eq('id', id);
    if (error) throw new Error(`Could not update attendance for ${row.student_id}: ${error.message}`);
    updated += 1;
  }
  if (toInsert.length) {
    const { error } = await supabase.from('attendance').insert(toInsert);
    if (error) throw new Error(`Could not save attendance: ${error.message}`);
    saved = toInsert.length;
  }
  return { saved, updated, deleted };
}

export async function fetchSchoolName(schoolId) {
  try {
    if (schoolId) {
      const { data: ss } = await supabase
        .from('school_settings')
        .select('school_name')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (ss?.school_name) return ss.school_name;
      const { data: school } = await supabase
        .from('schools')
        .select('name')
        .eq('id', schoolId)
        .maybeSingle();
      if (school?.name) return school.name;
    }
  } catch (err) {
    // fall through to default
  }
  return 'My School';
}
/** Build + open a print-ready 30-day attendance grid. */
export function printMonthlyGrid({
  schoolName,
  startDate,
  classFilter,
  gender,
  dates,
  rows,
  eventDays,
}) {
  const eventMap = buildEventDayMap(eventDays);
  let head = '<tr><th style="min-width:150px;">Student Name</th><th style="min-width:70px;">ID</th>';
  dates.forEach((date) => {
    const d = new Date(`${date}T00:00:00`);
    const ev = eventMap[date];
    const evMark = ev
      ? `<br><span style="font-size:0.55rem;color:#fbbf24;">${ev.event_type === 'holiday' ? '☀' : '★'}</span>`
      : '';
    head += `<th class="tc" style="min-width:22px;">${d.getDate()}<br><span style="font-size:0.55rem;opacity:0.8;">${WEEKDAYS_SHORT[d.getDay()]}</span>${evMark}</th>`;
  });
  head += '<th class="tc">✓ / ✗</th></tr>';

  let body = '';
  rows.forEach((s) => {
    let present = 0;
    let marked = 0;
    let cells = '';
    dates.forEach((date) => {
      const status = s.days[date] || 'unmarked';
      if (status === 'present') present += 1;
      if (status !== 'unmarked') marked += 1;
      const symbol =
        status === 'present' ? '✓' : status === 'absent' ? '✗' : '<span style="opacity:0.35;">—</span>';
      const cellStyle =
        status === 'present'
          ? 'background:#dcfce7;color:#14532d;text-align:center;'
          : status === 'absent'
            ? 'background:#fee2e2;color:#7f1d1d;text-align:center;'
            : 'text-align:center;';
      cells += `<td style="${cellStyle}">${symbol}</td>`;
    });
    body += `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.student_id)}</td>${cells}<td class="tc">${present}/${marked}</td></tr>`;
  });

  const eventDaysInRange = dates.map((d) => ({ d, ev: eventMap[d] })).filter((x) => x.ev);
  const eventLine =
    eventDaysInRange.length > 0
      ? `<p class="meta" style="color:#92400e;">Event days: ${eventDaysInRange
          .map(
            (x) =>
              `${x.d} (${EVENT_TYPE_LABELS[x.ev.event_type] || x.ev.event_type}${x.ev.label ? ' — ' + escapeHtml(x.ev.label) : ''})`
          )
          .join('; ')}</p>`
      : '';

  const content = `
    <h2>${escapeHtml(schoolName)}</h2>
    <h3>30-Day Attendance Grid</h3>
    <div class="meta">Start date: <strong>${startDate}</strong> | Class: <strong>${escapeHtml(classFilter)}</strong>${gender ? ` | Gender: <strong>${escapeHtml(gender)}</strong>` : ''}</div>
    ${eventLine}
    <div class="meta">Generated: ${new Date().toLocaleString()}</div>
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="legend">
      <span><span class="swatch sw-present"></span> Present (✓)</span>
      <span><span class="swatch sw-absent"></span> Absent (✗)</span>
      <span><span class="swatch"></span> Unmarked (—)</span>
      <span><span class="swatch sw-event"></span> Event day (☀ Holiday / ★ Special)</span>
    </div>
    <footer>Student Admission Portal</footer>`;

  openPrintWindow(`30-Day Attendance Grid — ${schoolName}`, content);
  return true;
}

/** Build + open a print-ready attendance report from rendered table HTML. */
export function printReport({ schoolName, title, subtitle, tableHtml }) {
  const content = `
    <h2>${escapeHtml(schoolName)}</h2>
    <h3>${escapeHtml(title)}</h3>
    ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ''}
    <div class="meta">Generated: ${new Date().toLocaleString()}</div>
    ${tableHtml}
    <footer>Student Admission Portal</footer>`;
  openPrintWindow(`${title} — ${schoolName}`, content);
  return true;
}