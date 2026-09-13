/**
 * Admin Transport Module — Student School-Bus Daily Fee Collection
 * ================================================================
 * Tracks the daily transport collection fees of the selected students
 * who come to school with the school bus, grouped BY BUS DESTINATION
 * (route). Every destination carries its own fee payment.
 *
 * Tabs:
 *   1. Today's Collection — per-route daily sheet with paid/unpaid
 *      toggles, "mark all paid", live summary cards and printing.
 *   2. Routes & Fees      — CRUD for bus destinations + their own
 *      daily fee.
 *   3. Enroll Students    — pick which students ride the bus and on
 *      which destination.
 *   4. Payments History   — date-range ledger with filters, totals,
 *      single-entry delete and printing.
 *
 * Mobile friendly: route cards + big tap targets, no horizontal
 * scrolling needed; tables use the shared stacked-card layout.
 */

import { getEl, showMessage, clearMessage, getCurrentSchoolId, formatCurrency, logSubAdminActivity, openPrintWindow, buildStudentName, setLoading } from './utils.js';
import { svgIcon } from './icons.js';
import { openTransportBulkPay } from './transport-bulk-pay.js';

let supabaseClient = null;
let _schoolId = null;
let _schoolName = 'School';
let _routes = [];               // transport_routes
let _enrollments = [];          // transport_enrollments
let _students = [];             // applications (whole school)
let _studentMap = {};           // student_id -> application record
let _dailyPayments = [];        // transport_fee_payments for shown date
let _dailyPaymentsByKey = {};   // "studentId|routeId" -> payment row
let _dailyBulk = {};            // "studentId|routeId" -> { count, total } bulk group covering the shown date
let _activeTab = 'daily';
let _collapsedRoutes = new Set(); // route IDs collapsed in the Today's Collection sheet
let _collectorStaff = [];          // teachers flagged as transport collectors
let _collectorAssignments = [];    // transport_collector_routes mapping teachers → routes
let _coverageFrom = '';            // Destination Coverage date range (From)
let _coverageTo = '';              // Destination Coverage date range (To)
let _coveragePayments = [];        // transport_fee_payments within the coverage range

// ================================================================
// Init / Listeners
// ================================================================

export function initAdminTransport(supabase) {
  supabaseClient = supabase;
}

export function setupTransportListeners() {
  document.querySelectorAll('.transport-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTransportTab(btn.getAttribute('data-transport-tab')));
  });

  // ----- Daily tab -----
  getEl('trDailyDate')?.addEventListener('change', renderDailyTab);
  getEl('trDailyRouteFilter')?.addEventListener('change', renderDailyTab);
  getEl('trDailyClassFilter')?.addEventListener('change', renderDailyTab);
  getEl('trDailySearch')?.addEventListener('input', renderDailyTab);
  getEl('trDailyRefresh')?.addEventListener('click', loadTransportPage);
  getEl('trPrintDailyBtn')?.addEventListener('click', printTransportDaily);

  // ----- Routes tab -----
  getEl('trSaveRouteBtn')?.addEventListener('click', saveTransportRoute);
  getEl('trResetRouteBtn')?.addEventListener('click', resetTransportRouteForm);

  // ----- Enroll tab -----
  getEl('trEnrollRoute')?.addEventListener('change', loadEnrollTab);
  getEl('trEnrollClass')?.addEventListener('change', loadEnrollTab);
  getEl('trEnrollSearch')?.addEventListener('input', loadEnrollTab);
  getEl('trEnrollSaveBtn')?.addEventListener('click', saveEnrollments);
  getEl('trEnrollCheckAll')?.addEventListener('change', onEnrollCheckAll);

  // ----- History tab -----
  getEl('trHistoryRefresh')?.addEventListener('click', loadHistoryTab);

  // ----- Collector Destinations tab -----
  getEl('trCollectorStaff')?.addEventListener('change', renderCollectorRoutesChecklist);
  getEl('trAssignRoutesBtn')?.addEventListener('click', saveCollectorAssignments);
  getEl('trRefreshAssignmentsBtn')?.addEventListener('click', loadCollectorAssignmentsTab);

  // ----- Destination Coverage date filter -----
  getEl('trCoverageApply')?.addEventListener('click', loadCollectorCoverage);
  getEl('trCoverageFrom')?.addEventListener('change', loadCollectorCoverage);
  getEl('trCoverageTo')?.addEventListener('change', loadCollectorCoverage);

  // Close the collector collections modal when the overlay background is clicked
  getEl('collectorCollectionsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'collectorCollectionsModal') closeCollectorCollectionsModal();
  });
  getEl('trHistoryFrom')?.addEventListener('change', loadHistoryTab);
  getEl('trHistoryTo')?.addEventListener('change', loadHistoryTab);
  getEl('trHistoryRoute')?.addEventListener('change', loadHistoryTab);
  getEl('trHistoryClass')?.addEventListener('change', loadHistoryTab);
  getEl('trHistorySearch')?.addEventListener('input', loadHistoryTab);
  getEl('trHistoryPrint')?.addEventListener('click', printTransportLedger);
}

// ================================================================
// Small local helpers
// ================================================================

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fullName(student) {
  if (!student) return 'Unknown Student';
  return buildStudentName(student.first_name, student.middle_name, student.last_name) || student.student_id || 'Unknown Student';
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return toISODate(new Date());
}

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

/**
 * Student photo (applications.student_photo_url) rendered as a round
 * thumbnail, falling back to the initials avatar when the student has
 * no photo yet. Pass sm=true for the smaller 30px size (used in the
 * enrollment list and the payments-history table).
 */
function studentThumb(s, sm) {
  const photoCls = sm ? 'tr-student-photo tr-student-photo-sm' : 'tr-student-photo';
  const avatarCls = sm ? 'tr-student-avatar tr-student-photo-sm' : 'tr-student-avatar';
  if (s?.student_photo_url) {
    return `<img src="${esc(s.student_photo_url)}" class="${photoCls}" alt="" loading="lazy" />`;
  }
  return `<span class="${avatarCls}">${esc(initialsOf(fullName(s)))}</span>`;
}
// ================================================================
// Data loading
// ================================================================

/**
 * Main entry point — called whenever the Transport module page opens.
 * Defaults the date to today, loads reference data and shows the daily
 * collection sheet.
 */
export async function loadTransportPage() {
  _schoolId = await getCurrentSchoolId();
  if (!_schoolId) {
    showMessage('transportMessage', 'Could not determine your school ID. Please re-login and try again.', 'error');
    return;
  }
  const dateInput = getEl('trDailyDate');
  if (dateInput) dateInput.value = dateInput.value || todayISO();

  try {
    await loadTransportData(true);
    populateRouteFilters();
    populateDropdowns();
    switchTransportTab(_activeTab);
  } catch (err) {
    console.error('[Transport] load failed:', err);
    showMessage('transportMessage', `Failed to load transport data: ${err.message}`, 'error');
  }
}

async function loadTransportData(force = false) {
  if (!force && _routes.length && _enrollments.length && _students.length) return;

  // School name (cache)
  if (!_schoolName || _schoolName === 'School') {
    try {
      const { data: school } = await supabaseClient.from('schools').select('name').eq('id', _schoolId).maybeSingle();
      _schoolName = school?.name || 'School';
    } catch (e) { /* non-critical */ }
  }

  // Routes (bus destinations with their own fee)
  const { data: routes, error: routesErr } = await supabaseClient
    .from('transport_routes')
    .select('*')
    .eq('school_id', _schoolId)
    .order('name', { ascending: true });
  if (routesErr) throw routesErr;
  _routes = routes || [];

  // Enrollments (selected students on the bus)
  const { data: enrollments, error: enrErr } = await supabaseClient
    .from('transport_enrollments')
    .select('*')
    .eq('school_id', _schoolId);
  if (enrErr) throw enrErr;
  _enrollments = enrollments || [];

  // All application records for name/class lookup
  const { data: students, error: stuErr } = await supabaseClient
    .from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying, status, parent_contact, student_photo_url')
    .eq('school_id', _schoolId);
  if (stuErr) throw stuErr;
  _students = students || [];
  _studentMap = {};
  _students.forEach((s) => { _studentMap[s.student_id] = s; });
}

async function loadDailyPayments(date, routeId) {
  let q = supabaseClient
    .from('transport_fee_payments')
    .select('*')
    .eq('school_id', _schoolId)
    .eq('collection_date', date);
  if (routeId) q = q.eq('route_id', routeId);
  const { data, error } = await q;
  if (error) throw error;
  _dailyPayments = data || [];
  _dailyPaymentsByKey = {};
  _dailyPayments.forEach((p) => { _dailyPaymentsByKey[`${p.student_id}|${p.route_id}`] = p; });

  // Bulk-payment context: the rows of ONE bulk collection are written by a
  // single INSERT, so they share the exact same created_at (Postgres now()
  // is transaction-stable). For each shown-date payment, group the window of
  // payments around that date by created_at — if that group spans 2+ days,
  // record the bulk total so the sheet can show "✓ Paid · GHC X for N days".
  _dailyBulk = {};
  try {
    let wq = supabaseClient
      .from('transport_fee_payments')
      .select('student_id, route_id, collection_date, fee_amount, created_at')
      .eq('school_id', _schoolId)
      .gte('collection_date', addDaysISO(date, -40))
      .lte('collection_date', addDaysISO(date, 40));
    if (routeId) wq = wq.eq('route_id', routeId);
    const { data: windowRows, error: windowErr } = await wq;
    if (!windowErr && windowRows) {
      _dailyPayments.forEach((p) => {
        const key = `${p.student_id}|${p.route_id}`;
        if (!p.created_at) return;
        const group = windowRows.filter((r) =>
          r.student_id === p.student_id && r.route_id === p.route_id && r.created_at === p.created_at);
        const days = new Set(group.map((r) => r.collection_date));
        if (days.size >= 2) {
          const total = group.reduce((sum, r) => sum + Number(r.fee_amount || 0), 0);
          _dailyBulk[key] = { count: days.size, total };
        }
      });
    }
  } catch (bulkErr) {
    console.warn('[Transport] bulk context load error:', bulkErr.message);
  }
}

/** All active enrollments for a route → set of student_ids. */
function enrolledStudentIdsForRoute(routeId) {
  const set = new Set();
  _enrollments.forEach((e) => {
    if (e.route_id === routeId && e.is_active) set.add(e.student_id);
  });
  return set;
}

// ================================================================
// Tabs
// ================================================================

export function switchTransportTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.transport-tab').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.transport-tab[data-transport-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('#page-admin-transport .transport-tab-content').forEach((c) => c.classList.remove('active'));
  getEl(`transportTab-${tab}`)?.classList.add('active');

  if (tab === 'daily') renderDailyTab();
  else if (tab === 'routes') renderRoutesTab();
  else if (tab === 'enroll') loadEnrollTab();
  else if (tab === 'history') loadHistoryTab();
  else if (tab === 'collectors') loadCollectorAssignmentsTab();
}

/** Fill route / class filter dropdowns shared by several tabs. */
function populateRouteFilters() {
  const routeOptions = '<option value="">All Destinations</option>'
    + _routes.map((r) => `<option value="${r.id}">${esc(r.name)} (GHC ${formatCurrency(r.fee)})</option>`).join('');

  ['trDailyRouteFilter', 'trHistoryRoute'].forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = routeOptions;
    if (current && _routes.some((r) => r.id === current)) el.value = current;
  });

  const activeRouteOptions = _routes
    .filter((r) => r.is_active)
    .map((r) => `<option value="${r.id}">${esc(r.name)} (GHC ${formatCurrency(r.fee)}/day)</option>`)
    .join('');
  const enrollRouteEl = getEl('trEnrollRoute');
  if (enrollRouteEl) {
    const current = enrollRouteEl.value;
    enrollRouteEl.innerHTML = '<option value="">— Select Destination —</option>' + activeRouteOptions;
    if (current && _routes.some((r) => r.id === current)) enrollRouteEl.value = current;
  }
}

function populateDropdowns() {
  // Class filters (derived from admitted students)
  const classes = [...new Set(_students.map((s) => s.class_applying).filter(Boolean))].sort();
  const classOptions = '<option value="">All Classes</option>' + classes.map((c) => `<option>${esc(c)}</option>`).join('');
  ['trDailyClassFilter', 'trEnrollClass', 'trHistoryClass'].forEach((id) => {
    const el = getEl(id);
    if (!el || el.options.length > 1) return;
    el.innerHTML = classOptions;
  });
}
// ================================================================
// TAB 1 — Today's Collection (daily sheet grouped by destination)
// ================================================================

async function renderDailyTab() {
  const date = getEl('trDailyDate')?.value || todayISO();
  const routeId = getEl('trDailyRouteFilter')?.value || '';
  const classFilter = getEl('trDailyClassFilter')?.value || '';
  const search = (getEl('trDailySearch')?.value || '').trim().toLowerCase();

  clearMessage('transportMessage');

  try {
    await loadDailyPayments(date, routeId);
  } catch (err) {
    showMessage('transportMessage', `Failed to load payments: ${err.message}`, 'error');
    return;
  }

  // Which routes to show (all active ones with ≥1 enrolled student, or the filtered one)
  const routesShown = _routes.filter((r) => (!routeId ? r.is_active : r.id === routeId));

  let expected = 0;
  let collected = 0;
  let studentCount = 0;
  const routeCards = [];

  routesShown.forEach((route) => {
    const enrolledSet = enrolledStudentIdsForRoute(route.id);
    let students = _students.filter((s) => enrolledSet.has(s.student_id));
    students = students
      .filter((s) => !classFilter || s.class_applying === classFilter)
      .filter((s) => !search || (s.student_id + ' ' + fullName(s)).toLowerCase().includes(search))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));

    if (!students.length) return;

    const routeExpected = students.length * Number(route.fee || 0);
    const routePaidRows = students.filter((s) => _dailyPaymentsByKey[`${s.student_id}|${route.id}`]);
    const routeCollected = routePaidRows.reduce((sum, s) => {
      const p = _dailyPaymentsByKey[`${s.student_id}|${route.id}`];
      return sum + Number(p.fee_amount || 0);
    }, 0);
    const pct = routeExpected > 0 ? Math.round((routeCollected / routeExpected) * 100) : 0;

    expected += routeExpected;
    collected += routeCollected;
    studentCount += students.length;

    const studentRows = students.map((s) => {
      const pay = _dailyPaymentsByKey[`${s.student_id}|${route.id}`];
      const paid = Boolean(pay);
      const name = fullName(s);
      const sub = `${esc(s.student_id)} · ${esc(s.class_applying || '—')}`;
      if (paid) {
        const bulk = _dailyBulk[`${s.student_id}|${route.id}`];
        const paidBadge = bulk
          ? `✓ Paid · GHC ${formatCurrency(bulk.total)} for ${bulk.count} days`
          : `✓ Paid · GHC ${formatCurrency(pay.fee_amount)}`;
        return `<div class="tr-student-row">
          ${studentThumb(s)}
          <span class="tr-student-info"><span class="tr-student-name">${esc(name)}</span><small>${sub}</small></span>
          <span class="tr-student-paid-badge">${paidBadge}</span>
          <button type="button" class="tr-mark-unpaid-btn" onclick="trTogglePaid('${s.student_id}','${route.id}')" title="Mark as unpaid">✕</button>
        </div>`;
      }
      return `<div class="tr-student-row">
        ${studentThumb(s)}
        <span class="tr-student-info"><span class="tr-student-name">${esc(name)}</span><small>${sub}</small></span>
        <button type="button" class="tr-mark-paid-btn" onclick="trOpenBulkPay('${s.student_id}','${route.id}')">Pay · GHC ${formatCurrency(route.fee)}</button>
      </div>`;
    }).join('');

    const routeDesc = route.description ? `<small>${esc(route.description)}</small>` : '';
    const progressLabel = `${routePaidRows.length} of ${students.length} paid · GHC ${formatCurrency(routeCollected)} of GHC ${formatCurrency(routeExpected)} · ${pct}%`;

    const isCollapsed = _collapsedRoutes.has(route.id);

    routeCards.push(`<div class="tr-route-card" data-route-id="${route.id}" data-collapsed="${isCollapsed}">
      <div class="tr-route-card-header" title="Click to expand / collapse" onclick="trToggleCollapse('${route.id}')">
        <span class="tr-route-badge">${svgIcon('bus')}</span>
        <span class="tr-route-title">${esc(route.name)}${routeDesc}</span>
        <span class="tr-route-fee">Daily fee<strong>GHC ${formatCurrency(route.fee)}</strong></span>
        <span class="tr-chevron-holder" aria-hidden="true"><span class="tr-chevron"></span></span>
      </div>
      <div class="tr-route-progress-wrap">
        <div class="tr-route-progress"><div class="tr-route-progress-fill" style="width:${pct}%;"></div></div>
        <div class="tr-route-progress-label">${progressLabel}</div>
      </div>
      <div class="tr-student-list">${studentRows}</div>
      <div class="tr-route-actions">
        <button type="button" class="tr-bulk-paid" onclick="trMarkAllRoutePaid('${route.id}')">✓ Mark all paid</button>
        <button type="button" class="tr-bulk-unpaid" onclick="trMarkAllRouteUnpaid('${route.id}')">Reset all</button>
      </div>
    </div>`);
  });

  // Summary cards
  const cardsEl = getEl('trSummaryCards');
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="tr-stat-card"><span class="tr-stat-label">Expected</span><span class="tr-stat-value tr-expected">GHC ${formatCurrency(expected)}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Collected</span><span class="tr-stat-value tr-collected">GHC ${formatCurrency(collected)}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Outstanding</span><span class="tr-stat-value tr-outstanding">GHC ${formatCurrency(Math.max(expected - collected, 0))}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Bus Students</span><span class="tr-stat-value tr-students">${studentCount}</span></div>`;
  }

  const routesEl = getEl('trDailyRouteCards');
  if (routesEl) {
    routesEl.innerHTML = routeCards.length ? routeCards.join('') : '';
  }

  const emptyEl = getEl('trDailyEmpty');
  if (emptyEl) emptyEl.style.display = routeCards.length ? 'none' : '';
}

/** Expand / collapse a destination card in the Today's Collection sheet. */
window.trToggleCollapse = function (routeId) {
  const card = document.querySelector(`.tr-route-card[data-route-id="${routeId}"]`);
  if (!card) return;
  const collapsed = card.getAttribute('data-collapsed') === 'true';
  card.setAttribute('data-collapsed', String(!collapsed));
  if (!collapsed) _collapsedRoutes.add(routeId);
  else _collapsedRoutes.delete(routeId);
};

/**
 * Toggle a single student's transport fee for the shown date.
 * Unpaid → records the route's fee as collected. Paid → removes it.
 */
window.trTogglePaid = async function (studentId, routeId) {
  const date = getEl('trDailyDate')?.value || todayISO();
  const student = _studentMap[studentId];
  const route = _routes.find((r) => r.id === routeId);
  const existing = _dailyPaymentsByKey[`${studentId}|${routeId}`];

  try {
    if (existing) {
      if (!confirm(`Remove the transport fee collection for ${fullName(student)} (${studentId}) on ${date}?`)) return;
      const { error } = await supabaseClient.from('transport_fee_payments').delete().eq('id', existing.id);
      if (error) throw error;
      await logSubAdminActivity(`Removed transport fee for ${fullName(student)} (${studentId}) on ${date}`, 'transport');
    } else {
      const fee = Number(route?.fee || 0);
      if (fee <= 0) {
        showMessage('transportMessage', `"${route?.name || 'This route'}" has no daily fee set. Add the fee in the Routes & Fees tab first.`, 'error');
        return;
      }
      const method = getEl('trDailyMethod')?.value || 'Cash';
      const { data, error } = await supabaseClient.from('transport_fee_payments').insert({
        school_id: _schoolId,
        student_id: studentId,
        route_id: routeId,
        fee_amount: fee,
        collection_date: date,
        payment_method: method,
      }).select('id, created_at').single();
      if (error) throw error;
      await logSubAdminActivity(`Collected transport fee GHC ${formatCurrency(fee)} for ${fullName(student)} (${studentId}) on ${date} — ${route?.name}`, 'transport');
    }
    await renderDailyTab();
  } catch (err) {
    console.error('[Transport] toggle error:', err);
    showMessage('transportMessage', `Failed to update payment: ${err.message}`, 'error');
  }
};
/**
 * Open the bulk-payment modal for a single student — pick several days
 * to collect the route fee for at once (records one row per day).
 */
window.trOpenBulkPay = function (studentId, routeId) {
  const student = _studentMap[studentId];
  const route = _routes.find((r) => r.id === routeId);
  const date = getEl('trDailyDate')?.value || todayISO();
  if (!student || !route) return;
  openTransportBulkPay({
    supabase: supabaseClient,
    schoolId: _schoolId,
    student,
    route,
    defaultDate: date,
    getMethod: () => getEl('trDailyMethod')?.value || 'Cash',
    onSaved: async (info) => {
      await logSubAdminActivity(info.message, 'transport');
      await renderDailyTab();
    },
    onPageMessage: (msg, type) => showMessage('transportMessage', msg, type),
  });
};

/** Mark every unpaid student on a route as PAID for the shown date. */
window.trMarkAllRoutePaid = async function (routeId) {
  const date = getEl('trDailyDate')?.value || todayISO();
  const route = _routes.find((r) => r.id === routeId);
  if (!route) return;

  const enrolledSet = enrolledStudentIdsForRoute(routeId);
  const pending = _students.filter((s) => enrolledSet.has(s.student_id))
    .filter((s) => !_dailyPaymentsByKey[`${s.student_id}|${routeId}`]);

  if (!pending.length) {
    showMessage('transportMessage', `All students on "${route.name}" have already paid for ${date}.`, 'info');
    return;
  }
  if (!confirm(`Mark ${pending.length} student(s) on "${route.name}" as PAID for ${date}? Each pays the route fee of GHC ${formatCurrency(route.fee)}.`)) return;

  const method = getEl('trDailyMethod')?.value || 'Cash';
  const rows = pending.map((s) => ({
    school_id: _schoolId,
    student_id: s.student_id,
    route_id: routeId,
    fee_amount: Number(route.fee || 0),
    collection_date: date,
    payment_method: method,
  }));

  try {
    const { error } = await supabaseClient.from('transport_fee_payments').insert(rows);
    if (error) throw error;
    await logSubAdminActivity(`Bulk-collected transport fees for ${pending.length} student(s) on "${route.name}" for ${date}`, 'transport');
    await renderDailyTab();
  } catch (err) {
    console.error('[Transport] mark all error:', err);
    showMessage('transportMessage', `Failed to mark all as paid: ${err.message}`, 'error');
  }
};

/** Remove every payment recorded for a route on the shown date. */
window.trMarkAllRouteUnpaid = async function (routeId) {
  const date = getEl('trDailyDate')?.value || todayISO();
  const ids = _dailyPayments.filter((p) => p.route_id === routeId).map((p) => p.id);
  if (!ids.length) return;
  if (!confirm(`Reset ALL transport fee collections for this destination on ${date}? ${ids.length} payment(s) will be removed.`)) return;
  try {
    const { error } = await supabaseClient.from('transport_fee_payments').delete().in('id', ids);
    if (error) throw error;
    await logSubAdminActivity(`Reset ${ids.length} transport fee collection(s) on ${date}`, 'transport');
    await renderDailyTab();
  } catch (err) {
    console.error('[Transport] reset all error:', err);
    showMessage('transportMessage', `Failed to reset collections: ${err.message}`, 'error');
  }
};

// ================================================================
// TAB 2 — Routes & Fees (bus destinations with their own fee)
// ================================================================

function renderRoutesTab() {
  clearMessage('transportMessage');
  const tbody = getEl('transportRoutesBody');
  if (!tbody) return;

  if (!_routes.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No bus destinations yet. Add your first destination (e.g. Madina, East Legon...) below.</td></tr>';
    return;
  }

  const today = getEl('trDailyDate')?.value || todayISO();

  // Collect today's payments for the routes table (single fetch)
  loadDailyPayments(today, '').then(() => {
    tbody.innerHTML = _routes.map((r) => {
      const studentCount = _enrollments.filter((e) => e.route_id === r.id && e.is_active).length;
      const collected = _dailyPayments
        .filter((p) => p.route_id === r.id)
        .reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);
      const statusBadge = r.is_active
        ? '<span style="color:#065f46;background:rgba(5,150,105,0.12);padding:0.1rem 0.5rem;border-radius:999px;font-size:0.72rem;">Active</span>'
        : '<span style="color:#b45309;background:rgba(180,83,9,0.12);padding:0.1rem 0.5rem;border-radius:999px;font-size:0.72rem;">Inactive</span>';

      return `<tr>
        <td data-label="Destination">${esc(r.name)}<br/><small style="color:var(--text-muted);font-size:0.72rem;">${esc(r.description || '')}</small></td>
        <td data-label="Daily Fee" style="text-align:right;font-weight:700;color:var(--primary);">GHC ${formatCurrency(r.fee)}</td>
        <td data-label="Bus Students" style="text-align:center;">${studentCount}</td>
        <td data-label="Today Collected" style="text-align:right;font-weight:700;color:var(--success);">GHC ${formatCurrency(collected)}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Actions" style="white-space:nowrap;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="trEditRoute('${r.id}')">Edit</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="trToggleRouteActive('${r.id}')">${r.is_active ? 'Deactivate' : 'Activate'}</button>
          <button type="button" class="btn btn-sm btn-danger" onclick="trDeleteRoute('${r.id}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  }).catch((err) => {
    console.error('[Transport] routes tab error:', err);
    tbody.innerHTML = `<tr><td colspan="7">Failed to load routes: ${esc(err.message)}</td></tr>`;
  });
}

/** Load a route into the edit form. */
window.trEditRoute = function (id) {
  const route = _routes.find((r) => r.id === id);
  if (!route) return;
  getEl('trRouteId').value = route.id;
  getEl('trRouteName').value = route.name;
  getEl('trRouteDesc').value = route.description || '';
  getEl('trRouteFee').value = route.fee;
  getEl('trRouteActive').checked = route.is_active;
  getEl('trRouteFormTitle').textContent = 'Edit Destination';
  getEl('trSaveRouteBtn').textContent = 'Update Destination';
  showMessage('transportRoutesMessage', `Editing "${route.name}". Update the fee or details and click "Update Destination".`, 'info');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/** Toggle a route on/off (off = removed from the daily sheet). */
window.trToggleRouteActive = async function (id) {
  const route = _routes.find((r) => r.id === id);
  if (!route) return;
  const next = !route.is_active;
  if (!confirm(`Turn "${route.name}" ${next ? 'ON' : 'OFF'}? ${next ? 'It will reappear' : 'It will be hidden'} on the daily collection sheet.`)) return;
  try {
    const { error } = await supabaseClient.from('transport_routes').update({ is_active: next }).eq('id', id);
    if (error) throw error;
    await logSubAdminActivity(`${next ? 'Activated' : 'Deactivated'} transport destination "${route.name}"`, 'transport');
    await loadTransportData(true);
    populateRouteFilters();
    renderRoutesTab();
  } catch (err) {
    showMessage('transportMessage', `Failed to update route: ${err.message}`, 'error');
  }
};
/** Delete a destination (historic payments keep their amounts). */
window.trDeleteRoute = async function (id) {
  const route = _routes.find((r) => r.id === id);
  if (!route) return;
  const enrolledCount = _enrollments.filter((e) => e.route_id === id && e.is_active).length;
  if (!confirm(`Delete destination "${route.name}" entirely?\n\n${enrolledCount} student(s) are enrolled on this route and will also be removed from the bus list. Existing payment history is kept (the destination name is detached from old collections).`)) return;
  try {
    const { error } = await supabaseClient.from('transport_routes').delete().eq('id', id);
    if (error) throw error;
    await logSubAdminActivity(`Deleted transport destination "${route.name}"`, 'transport');
    if (getEl('trRouteId').value === id) resetTransportRouteForm();
    await loadTransportData(true);
    populateRouteFilters();
    renderRoutesTab();
  } catch (err) {
    showMessage('transportMessage', `Failed to delete route: ${err.message}`, 'error');
  }
};

async function saveTransportRoute() {
  const id = getEl('trRouteId').value;
  const name = getEl('trRouteName').value.trim();
  const description = getEl('trRouteDesc').value.trim();
  const fee = parseFloat(getEl('trRouteFee').value);
  const isActive = getEl('trRouteActive').checked;

  if (!name) { showMessage('transportRoutesMessage', 'Enter the bus destination / route name (e.g. Madina).', 'error'); return; }
  if (isNaN(fee) || fee < 0) { showMessage('transportRoutesMessage', 'Enter a valid daily fee (GHC).', 'error'); return; }

  try {
    if (id) {
      const { error } = await supabaseClient.from('transport_routes')
        .update({ name, description, fee, is_active: isActive })
        .eq('id', id);
      if (error) throw error;
      await logSubAdminActivity(`Updated transport destination "${name}" (GHC ${formatCurrency(fee)}/day)`, 'transport');
    } else {
      const { error } = await supabaseClient.from('transport_routes')
        .insert({ school_id: _schoolId, name, description, fee, is_active: isActive });
      if (error) throw error;
      await logSubAdminActivity(`Created transport destination "${name}" (GHC ${formatCurrency(fee)}/day)`, 'transport');
    }
    showMessage('transportRoutesMessage', `Destination "${name}" saved.`, 'success');
    resetTransportRouteForm();
    await loadTransportData(true);
    populateRouteFilters();
    renderRoutesTab();
  } catch (err) {
    console.error('[Transport] save route error:', err);
    showMessage('transportRoutesMessage', `Failed to save destination. ${err.message}`, 'error');
  }
}

export function resetTransportRouteForm() {
  getEl('trRouteId').value = '';
  getEl('trRouteName').value = '';
  getEl('trRouteDesc').value = '';
  getEl('trRouteFee').value = '';
  getEl('trRouteActive').checked = true;
  getEl('trRouteFormTitle').textContent = 'Add a Bus Destination';
  getEl('trSaveRouteBtn').textContent = 'Add Destination';
  clearMessage('transportRoutesMessage');
}

window.trResetRouteForm = resetTransportRouteForm;
// ================================================================
// TAB 3 — Enroll Students (select who rides the school bus)
// ================================================================

async function loadEnrollTab() {
  clearMessage('transportEnrollMessage');
  const routeId = getEl('trEnrollRoute')?.value || '';
  const classFilter = getEl('trEnrollClass')?.value || '';
  const search = (getEl('trEnrollSearch')?.value || '').trim().toLowerCase();
  const listEl = getEl('trEnrollStudentList');
  const infoEl = getEl('trEnrollInfo');
  if (!listEl) return;

  if (!_routes.length) {
    listEl.innerHTML = '<div class="tr-empty-state">Create a bus destination first in the <strong>Routes &amp; Fees</strong> tab, then come back to enroll students.</div>';
    if (infoEl) infoEl.innerHTML = '';
    return;
  }
  if (!routeId) {
    listEl.innerHTML = '<div class="tr-empty-state">Select a <strong>destination</strong> above to see the students who ride it.</div>';
    if (infoEl) infoEl.innerHTML = '';
    return;
  }

  // ---- One student = one bus destination ----
  // Map each student to the destination they are CURRENTLY (actively) on.
  // A student already on ANOTHER destination cannot be ticked for this one —
  // they must first be removed from their current destination.
  const routeNameById = new Map(_routes.map((r) => [r.id, r.name]));
  const activeRouteOfStudent = {};
  _enrollments.forEach((e) => {
    if (e.student_id && e.is_active && !activeRouteOfStudent[e.student_id]) {
      activeRouteOfStudent[e.student_id] = e.route_id;
    }
  });

  // Students actively riding THIS destination (checked + "On bus")
  const activeOnThisRoute = new Set(
    _enrollments
      .filter((e) => e.route_id === routeId && e.is_active)
      .map((e) => e.student_id)
  );

  // Only admitted students can be enrolled on the bus
  let students = _students.filter((s) => s.status === 'admitted');
  students = students
    .filter((s) => !classFilter || s.class_applying === classFilter)
    .filter((s) => !search || (s.student_id + ' ' + fullName(s)).toLowerCase().includes(search))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));

  if (!students.length) {
    listEl.innerHTML = '<div class="tr-empty-state">No admitted students match these filters.</div>';
    if (infoEl) infoEl.innerHTML = '';
    return;
  }

  const items = students.map((s) => {
    const onThisRoute = activeOnThisRoute.has(s.student_id);
    const otherRouteId = activeRouteOfStudent[s.student_id];
    const onOtherRoute = Boolean(otherRouteId) && otherRouteId !== routeId;
    const checked = onThisRoute ? 'checked' : '';
    // Students already on another destination cannot be picked here.
    const disabled = onOtherRoute ? 'disabled' : '';
    const tag = onThisRoute
      ? '<span class="tr-chip">On bus</span>'
      : onOtherRoute
        ? `<span class="tr-chip tr-chip-other" title="Already assigned to another destination">On ${esc(routeNameById.get(otherRouteId) || 'another destination')}</span>`
        : '';
    const itemClass = onOtherRoute ? 'tr-enroll-student-item is-other-route' : 'tr-enroll-student-item';
    return `<div class="${itemClass}">
      <input type="checkbox" class="tr-enroll-check" id="trEnrollCheck_${esc(s.student_id)}" value="${esc(s.student_id)}" ${checked} ${disabled} />
      ${studentThumb(s, true)}
      <span class="tr-student-name">${esc(fullName(s))}</span>
      <small>${esc(s.student_id)} · ${esc(s.class_applying || '—')}</small>
      ${tag}
    </div>`;
  }).join('');

  listEl.innerHTML = items;
  const otherRouteCount = students.filter((s) => {
    const rid = activeRouteOfStudent[s.student_id];
    return rid && rid !== routeId;
  }).length;
  if (infoEl) infoEl.innerHTML = `<span class="tr-chip">${students.length} admitted student(s) shown</span>`
    + ` <span class="tr-chip">${students.filter((s) => activeOnThisRoute.has(s.student_id)).length} already on this bus</span>`
    + (otherRouteCount ? ` <span class="tr-chip tr-chip-other" title="Remove them from their current destination first">${otherRouteCount} already on another destination</span>` : '');
}

window.onEnrollCheckAll = function () {
  const checkAll = getEl('trEnrollCheckAll');
  const all = checkAll.checked;
  listAllEnrollChecks().forEach((c) => {
    // Never tick students already assigned to another destination —
    // they are locked out of this destination until removed elsewhere.
    if (!c.disabled) c.checked = all;
  });
};

function listAllEnrollChecks() {
  return [...document.querySelectorAll('#trEnrollStudentList input.tr-enroll-check')];
}

async function saveEnrollments() {
  const routeId = getEl('trEnrollRoute')?.value || '';
  if (!routeId) { showMessage('transportEnrollMessage', 'Select a destination first.', 'error'); return; }
  const route = _routes.find((r) => r.id === routeId);
  if (!route) return;

  const wanted = listAllEnrollChecks().filter((c) => c.checked).map((c) => c.value);
  const existing = _enrollments.filter((e) => e.route_id === routeId);
  const existingIds = new Set(existing.map((e) => e.student_id));

  // One student = one bus destination. Guarded twice: the UI disables these
  // checkboxes, but also skip here defensively (stale DOM / tampered input)
  // so a student who is ACTIVE on another destination is never ADDED or
  // re-ACTIVATED here — the database unique index also rejects it.
  const activeRouteOfStudent = {};
  _enrollments.forEach((e) => {
    if (e.student_id && e.is_active && !activeRouteOfStudent[e.student_id]) {
      activeRouteOfStudent[e.student_id] = e.route_id;
    }
  });
  const isOnOtherRoute = (sid) => Boolean(activeRouteOfStudent[sid]) && activeRouteOfStudent[sid] !== routeId;

  const allAdded = wanted.filter((s) => !existingIds.has(s));
  const added = allAdded.filter((s) => !isOnOtherRoute(s));
  const skippedAdded = allAdded.filter((s) => isOnOtherRoute(s));

  const removed = existing.filter((e) => e.is_active && !wanted.includes(e.student_id));

  const allReactivated = existing.filter((e) => !e.is_active && wanted.includes(e.student_id));
  const reactivated = allReactivated.filter((e) => !isOnOtherRoute(e.student_id));
  const skippedReactivated = allReactivated.filter((e) => isOnOtherRoute(e.student_id));

  const skippedCount = skippedAdded.length + skippedReactivated.length;

  try {
    if (added.length) {
      const rows = added.map((sid) => ({ school_id: _schoolId, student_id: sid, route_id: routeId, is_active: true }));
      const { error } = await supabaseClient.from('transport_enrollments').insert(rows);
      if (error) throw error;
    }
    if (removed.length) {
      const ids = removed.map((e) => e.id);
      const { error } = await supabaseClient.from('transport_enrollments').delete().in('id', ids);
      if (error) throw error;
    }
    for (const e of reactivated) {
      const { error } = await supabaseClient.from('transport_enrollments').update({ is_active: true }).eq('id', e.id);
      if (error) throw error;
    }

    const msg = [];
    if (added.length) msg.push(`${added.length} student(s) added`);
    if (removed.length) msg.push(`${removed.length} student(s) removed`);
    if (msg.length === 0) msg.push('No changes');
    let result = `${msg.join(', ')} on "${route.name}".`;
    if (skippedCount > 0) {
      result = `${skippedCount} student(s) skipped — already assigned to another destination. Remove them from their current destination first. ${result}`;
      showMessage('transportEnrollMessage', result, 'info');
    } else {
      showMessage('transportEnrollMessage', `✔ ${result}`, 'success');
    }
    await logSubAdminActivity(`Updated bus enrollment for "${route.name}" (+${added.length} / -${removed.length} / skipped ${skippedCount})`, 'transport');

    // Refresh local data + re-render
    const { data, error: enrErr } = await supabaseClient.from('transport_enrollments').select('*').eq('school_id', _schoolId);
    if (!enrErr) _enrollments = data || [];
    if (enrErr) throw enrErr;
    await loadEnrollTab();
  } catch (err) {
    console.error('[Transport] save enrollments error:', err);
    showMessage('transportEnrollMessage', `Failed to save enrollment: ${err.message}`, 'error');
  }
}
// ================================================================
// TAB 4 — Payments History (date-range ledger)
// ================================================================

async function loadHistoryTab() {
  clearMessage('transportHistoryMessage');
  const from = getEl('trHistoryFrom')?.value || '';
  const to = getEl('trHistoryTo')?.value || '';
  const routeId = getEl('trHistoryRoute')?.value || '';
  const classFilter = getEl('trHistoryClass')?.value || '';
  const search = (getEl('trHistorySearch')?.value || '').trim().toLowerCase();
  const tbody = getEl('transportHistoryBody');
  if (!tbody) return;

  try {
    let q = supabaseClient
      .from('transport_fee_payments')
      .select('*')
      .eq('school_id', _schoolId)
      .order('collection_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (from) q = q.gte('collection_date', from);
    if (to) q = q.lte('collection_date', to);
    if (routeId) q = q.eq('route_id', routeId);

    const { data, error } = await q;
    if (error) throw error;

    let payments = data || [];
    if (classFilter || search) {
      payments = payments.filter((p) => {
        const s = _studentMap[p.student_id];
        if (!s) return false;
        if (classFilter && s.class_applying !== classFilter) return false;
        if (search) {
          const hay = `${p.student_id} ${fullName(s)}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
    }

    renderHistoryRows(payments);
    renderDailyTotalsRows(payments);
  } catch (err) {
    console.error('[Transport] history error:', err);
    tbody.innerHTML = `<tr><td colspan="8">Failed to load history: ${esc(err.message)}</td></tr>`;
  }
}

function renderHistoryRows(payments) {
  const tbody = getEl('transportHistoryBody');
  const totalsEl = getEl('trHistoryTotals');
  if (!tbody) return;

  const totalAmount = payments.reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);
  if (totalsEl) {
    totalsEl.innerHTML = payments.length
      ? `<span class="tr-history-total">${payments.length} payment(s)</span> <span class="tr-history-total">Total: GHC ${formatCurrency(totalAmount)}</span>`
      : '';
  }

  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No transport fee payments found for the selected filters.</td></tr>';
    return;
  }

  tbody.innerHTML = payments.map((p) => {
    const s = _studentMap[p.student_id];
    const route = _routes.find((r) => r.id === p.route_id);
    const studentName = fullName(s);
    const time = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<tr data-amount="${esc(p.fee_amount)}">
      <td data-label="Date">${esc(p.collection_date)}<br/><small style="color:var(--text-muted);font-size:0.72rem;">${esc(time)}</small></td>
      <td data-label="Student"><span class="tr-student-cell">${studentThumb(s, true)}<span class="tr-student-cell-text">${esc(studentName)}<br/><small style="color:var(--text-muted);font-size:0.72rem;">${esc(p.student_id)}${s?.class_applying ? ' · ' + esc(s.class_applying) : ''}</small></span></span></td>
      <td data-label="Destination">${route ? esc(route.name) : '<span style="color:var(--text-muted);">(deleted)</span>'}</td>
      <td data-label="Amount" style="text-align:right;font-weight:700;color:var(--success);">GHC ${formatCurrency(p.fee_amount)}</td>
      <td data-label="Method">${esc(p.payment_method || 'Cash')}</td>
      <td data-label="Reference">${p.reference ? esc(p.reference) : '—'}</td>
      <td data-label="Actions"><button type="button" class="btn btn-sm btn-danger" onclick="trDeletePayment('${p.id}')">Remove</button></td>
    </tr>`;
  }).join('');
}

/** Renders the "Collected by Date" summary — total amount collected per day. */
function renderDailyTotalsRows(payments) {
  const tbody = getEl('transportDailyTotalsBody');
  if (!tbody) return;

  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">No payments for the selected filters.</td></tr>';
    return;
  }

  // Group by collection_date respecting every active filter (dates, route, class, search)
  const perDate = {};
  payments.forEach((p) => {
    const d = p.collection_date;
    if (!perDate[d]) perDate[d] = { count: 0, total: 0 };
    perDate[d].count += 1;
    perDate[d].total += Number(p.fee_amount || 0);
  });

  const dates = Object.keys(perDate).sort().reverse(); // newest first
  const grandTotal = payments.reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);

  tbody.innerHTML = dates.map((d) => `
    <tr>
      <td data-label="Date"><strong>${esc(d)}</strong></td>
      <td data-label="Payments" style="text-align:center;">${perDate[d].count}</td>
      <td data-label="Total Amount" style="text-align:right;font-weight:700;color:var(--success);">GHC ${formatCurrency(perDate[d].total)}</td>
    </tr>`).join('')
    + `<tr style="background:rgba(255,255,255,0.35);">
         <td><strong>Total</strong></td>
         <td style="text-align:center;"><strong>${payments.length}</strong></td>
         <td style="text-align:right;font-weight:800;color:var(--success);">GHC ${formatCurrency(grandTotal)}</td>
       </tr>`;
}

/** Remove a single transport payment entry. */
window.trDeletePayment = async function (id) {
  const p = _dailyPayments.find((x) => x.id === id)
    || await supabaseClient.from('transport_fee_payments').select('*').eq('id', id).maybeSingle().then(({ data }) => data);
  if (!p) return;
  const s = _studentMap[p.student_id];
  if (!confirm(`Remove transport fee entry for ${fullName(s)} (${p.student_id}) on ${p.collection_date}?`)) return;
  try {
    const { error } = await supabaseClient.from('transport_fee_payments').delete().eq('id', id);
    if (error) throw error;
    await logSubAdminActivity(`Removed transport fee entry for ${fullName(s)} (${p.student_id}) on ${p.collection_date}`, 'transport');
    await loadHistoryTab();
  } catch (err) {
    showMessage('transportHistoryMessage', `Failed to remove entry: ${err.message}`, 'error');
  }
};
// ================================================================
// TAB 5 — Collector Destinations (assign bus destinations to staff)
// ================================================================

/** Load collector staff + their route assignments and render the tab. */
async function loadCollectorAssignmentsTab() {
  clearMessage('trCollectorMessage');
  try {
    const staffQ = supabaseClient.from('teachers')
      .select('id, full_name, registration_id, phone, email, user_id')
      .eq('school_id', _schoolId)
      .eq('is_transport_collector', true)
      .eq('is_active', true)
      .order('full_name', { ascending: true });
    const { data: staff, error: staffErr } = await staffQ;
    if (staffErr) throw staffErr;
    _collectorStaff = staff || [];

    const assignQ = supabaseClient.from('transport_collector_routes')
      .select('*')
      .eq('school_id', _schoolId);
    const { data: assigns, error: assignsErr } = await assignQ;
    if (assignsErr) throw assignsErr;
    _collectorAssignments = assigns || [];

    populateCollectorStaffSelect();
    renderCollectorRoutesChecklist();
    renderCollectorAssignmentsTable();
    await loadCollectorCoverage();
  } catch (err) {
    console.error('[Transport] collector assignments load error:', err);
    showMessage('trCollectorMessage', `Failed to load collector assignments: ${err.message}`, 'error');
  }
}

function populateCollectorStaffSelect() {
  const sel = getEl('trCollectorStaff');
  if (!sel) return;
  const current = sel.value;
  const options = _collectorStaff
    .map((s) => `<option value="${s.id}">${esc(s.full_name)}${s.registration_id ? ` (${esc(s.registration_id)})` : ''}</option>`)
    .join('');
  sel.innerHTML = '<option value="">— Select Staff —</option>' + options;
  if (current && _collectorStaff.some((s) => s.id === current)) sel.value = current;
}

/** Set of route_ids already assigned to the given teacher. */
function assignedRouteIdsForTeacher(teacherId) {
  return new Set(_collectorAssignments.filter((a) => a.teacher_id === teacherId).map((a) => a.route_id));
}

/** Renders the checklist of destinations for the selected staff member. */
function renderCollectorRoutesChecklist() {
  const staffEl = getEl('trCollectorStaff');
  const listEl = getEl('trCollectorRoutesList');
  if (!staffEl || !listEl) return;

  const teacherId = staffEl.value;
  if (!teacherId) {
    listEl.innerHTML = '<p class="tr-empty-state">Select a collection staff member above to assign destinations.</p>';
    return;
  }

  const assigned = assignedRouteIdsForTeacher(teacherId);
  const activeRoutes = _routes.filter((r) => r.is_active);
  if (!activeRoutes.length) {
    listEl.innerHTML = '<p class="tr-empty-state">No active destinations yet. Create one under <strong>Routes &amp; Fees</strong> first.</p>';
    return;
  }

  listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem;">Tick the destination(s) this staff member should collect for:</p>'
    + activeRoutes.map((r) => `
      <label class="checkbox-label" style="display:block;margin:0.35rem 0;">
        <input type="checkbox" class="tr-collector-route-cb" value="${r.id}" ${assigned.has(r.id) ? 'checked' : ''} />
        ${esc(r.name)} — GHC ${formatCurrency(r.fee)}/day
      </label>`).join('');
}

/** Replace the selected staff member's destination assignments. */
async function saveCollectorAssignments() {
  const staffEl = getEl('trCollectorStaff');
  if (!staffEl) return;
  const teacherId = staffEl.value;
  if (!teacherId) {
    showMessage('trCollectorMessage', 'Select the collection staff member first.', 'error');
    return;
  }
  const staff = _collectorStaff.find((s) => s.id === teacherId);
  if (!staff) return;

  const checked = [...document.querySelectorAll('.tr-collector-route-cb:checked')].map((cb) => cb.value);
  const assignBtn = getEl('trAssignRoutesBtn');
  setLoading(assignBtn, true, 'Saving...');

  try {
    // Replace all assignments for this teacher (delete then insert) so the
    // saved state exactly matches the ticked checkboxes.
    const { error: delErr } = await supabaseClient.from('transport_collector_routes')
      .delete()
      .eq('teacher_id', teacherId)
      .eq('school_id', _schoolId);
    if (delErr) throw delErr;

    if (checked.length) {
      const rows = checked.map((routeId) => ({
        school_id: _schoolId,
        teacher_id: teacherId,
        route_id: routeId,
      }));
      const { error: insErr } = await supabaseClient.from('transport_collector_routes').insert(rows);
      if (insErr) throw insErr;
    }

    const routeNames = checked.map((id) => _routes.find((r) => r.id === id)?.name).filter(Boolean);
    await logSubAdminActivity(
      checked.length
        ? `Assigned ${staff.full_name} to bus destination(s): ${routeNames.join(', ')}`
        : `Removed all bus destination assignments for ${staff.full_name}`,
      'transport');

    await loadCollectorAssignmentsTab();
    showMessage('trCollectorMessage', `Assignments saved for ${staff.full_name} — ${checked.length} destination(s).`, 'success');
  } catch (err) {
    console.error('[Transport] save assignments error:', err);
    showMessage('trCollectorMessage', `Failed to save assignments: ${err.message}`, 'error');
  } finally {
    setLoading(assignBtn, false, 'Save Assignments');
  }
}

/** Remove a single destination from a staff member. */
window.trRemoveCollectorAssignment = async function (teacherId, routeId) {
  const staff = _collectorStaff.find((s) => s.id === teacherId);
  const route = _routes.find((r) => r.id === routeId);
  if (!staff || !route) return;
  if (!confirm(`Remove "${route.name}" from ${staff.full_name}? They will no longer see or collect for this destination.`)) return;
  try {
    const { error } = await supabaseClient.from('transport_collector_routes')
      .delete()
      .eq('teacher_id', teacherId)
      .eq('route_id', routeId)
      .eq('school_id', _schoolId);
    if (error) throw error;
    await logSubAdminActivity(`Removed bus destination "${route.name}" from ${staff.full_name}`, 'transport');
    await loadCollectorAssignmentsTab();
  } catch (err) {
    showMessage('trCollectorMessage', `Failed to remove assignment: ${err.message}`, 'error');
  }
};

/** Load a staff member into the assignment form (from the table). */
window.selectCollectorForEdit = function (teacherId) {
  const sel = getEl('trCollectorStaff');
  if (!sel) return;
  sel.value = teacherId;
  renderCollectorRoutesChecklist();
  const formSection = document.querySelector('#transportTab-collectors .tr-route-form');
  if (formSection) formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function renderCollectorAssignmentsTable() {
  const tbody = getEl('transportCollectorAssignmentsBody');
  if (!tbody) return;
  if (!_collectorStaff.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">No collection staff yet. Flag a staff member as a <strong>Transport Fees Collector</strong> in Staff → Add / Edit Staff first.</td></tr>';
    return;
  }

  const routeName = (id) => _routes.find((r) => r.id === id)?.name || '(deleted destination)';
  tbody.innerHTML = _collectorStaff.map((s) => {
    const assigned = _collectorAssignments.filter((a) => a.teacher_id === s.id);
    const chips = assigned.length
      ? assigned.map((a) => `<span class="tr-chip" style="margin:0.15rem 0.35rem 0.15rem 0;">
          ${esc(routeName(a.route_id))}
          <button type="button" class="tr-chip-remove" onclick="trRemoveCollectorAssignment('${s.id}','${a.route_id}')" title="Remove destination">×</button>
        </span>`).join('')
      : '<span style="color:var(--text-muted);font-size:0.85rem;">No destinations assigned</span>';
    return `<tr>
      <td><strong>${esc(s.full_name)}</strong>${s.registration_id ? `<br/><small style="color:var(--text-muted);font-size:0.78rem;">${esc(s.registration_id)}</small>` : ''}</td>
      <td>${chips}</td>
      <td><button type="button" class="action-btn confirm" onclick="selectCollectorForEdit('${s.id}')">Edit</button></td>
    </tr>`;
  }).join('');
}

/**
 * Loads the transport payments for the Destination Coverage date range
 * (defaults to the last 30 days → today) and re-renders the coverage table.
 */
async function loadCollectorCoverage() {
  const fromInput = getEl('trCoverageFrom');
  const toInput = getEl('trCoverageTo');

  // Default range: last 30 days → today (only set once, then keep user choice)
  if (fromInput && toInput && !_coverageFrom) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    _coverageFrom = toISODate(from);
    _coverageTo = toISODate(now);
    fromInput.value = _coverageFrom;
    toInput.value = _coverageTo;
  }

  _coverageFrom = fromInput?.value || '';
  _coverageTo = toInput?.value || '';

  try {
    let q = supabaseClient.from('transport_fee_payments')
      .select('collected_by, collection_date, fee_amount')
      .eq('school_id', _schoolId);
    if (_coverageFrom) q = q.gte('collection_date', _coverageFrom);
    if (_coverageTo) q = q.lte('collection_date', _coverageTo);
    const { data, error } = await q;
    if (error) throw error;
    _coveragePayments = data || [];
  } catch (err) {
    console.error('[Transport] coverage payments load error:', err);
    _coveragePayments = [];
    showMessage('trCollectorMessage', `Failed to load collection amounts: ${err.message}`, 'error');
  }
  renderCollectorRouteDetailsTable();
}

/** Show the per-date collection detail for one collector in a modal. */
window.openCollectorCollections = function (teacherId) {
  const staff = _collectorStaff.find((s) => s.id === teacherId);
  const modal = getEl('collectorCollectionsModal');
  const infoEl = getEl('collectorCollectionsStaffInfo');
  const summaryEl = getEl('collectorCollectionsSummary');
  const bodyEl = getEl('collectorCollectionsBody');
  if (!modal || !staff) return;

  if (infoEl) {
    infoEl.innerHTML = `<strong>${esc(staff.full_name)}</strong>`
      + (staff.registration_id ? ` · <small>Staff ID: ${esc(staff.registration_id)}</small>` : '')
      + `<div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.2rem;">`
      + [staff.phone ? `Phone: ${esc(staff.phone)}` : '', staff.email ? `Email: ${esc(staff.email)}` : ''].filter(Boolean).join(' · ')
      + `</div>`;
  }

  const periodLabel = `Period: <strong>${esc(_coverageFrom || 'start')}</strong> → <strong>${esc(_coverageTo || 'today')}</strong>`;

  if (!staff.user_id) {
    if (summaryEl) summaryEl.innerHTML = `<span class="tr-history-total">${periodLabel}</span> <span class="tr-history-total">No login linked</span>`;
    if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">This staff member has no login account linked, so no collections can be attributed to them.</td></tr>';
    modal.style.display = 'flex';
    return;
  }

  const recs = _coveragePayments.filter((p) => p.collected_by === staff.user_id);
  const grandTotal = recs.reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);

  if (summaryEl) {
    summaryEl.innerHTML = `<span class="tr-history-total">${periodLabel}</span>`
      + `<span class="tr-history-total">${recs.length} payment(s)</span>`
      + `<span class="tr-history-total">Total: GHC ${formatCurrency(grandTotal)}</span>`;
  }
  if (!bodyEl) return;

  if (!recs.length) {
    bodyEl.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">No transport collections recorded for this staff member in the selected period.</td></tr>';
    modal.style.display = 'flex';
    return;
  }

  // Group by collection_date (newest first)
  const perDate = {};
  recs.forEach((p) => {
    const d = p.collection_date;
    if (!perDate[d]) perDate[d] = { count: 0, total: 0 };
    perDate[d].count += 1;
    perDate[d].total += Number(p.fee_amount || 0);
  });
  const dates = Object.keys(perDate).sort().reverse();

  bodyEl.innerHTML = dates.map((d) => `
    <tr>
      <td data-label="Date"><strong>${esc(d)}</strong></td>
      <td data-label="Payments" style="text-align:center;">${perDate[d].count}</td>
      <td data-label="Amount" style="text-align:right;font-weight:700;color:var(--success);">GHC ${formatCurrency(perDate[d].total)}</td>
    </tr>`).join('')
    + `<tr style="background:rgba(255,255,255,0.35);">
         <td><strong>Total</strong></td>
         <td style="text-align:center;"><strong>${recs.length}</strong></td>
         <td style="text-align:right;font-weight:800;color:var(--success);">GHC ${formatCurrency(grandTotal)}</td>
       </tr>`;

  modal.style.display = 'flex';
};

/** Close the collector collections modal. */
window.closeCollectorCollectionsModal = function () {
  const modal = getEl('collectorCollectionsModal');
  if (modal) modal.style.display = 'none';
};

/** Route-centric view: which collection staff handle each destination. */
function renderCollectorRouteDetailsTable() {
  const tbody = getEl('transportCollectorRouteDetailsBody');
  if (!tbody) return;

  const routesToShow = _routes.filter((r) => r.is_active);
  if (!routesToShow.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--text-muted);">No active destinations yet. Create one under <strong>Routes &amp; Fees</strong> first.</td></tr>';
    return;
  }

  const staffById = new Map(_collectorStaff.map((s) => [s.id, s]));
  const byRoute = {};
  _collectorAssignments.forEach((a) => {
    if (!byRoute[a.route_id]) byRoute[a.route_id] = [];
    if (staffById.has(a.teacher_id)) byRoute[a.route_id].push(staffById.get(a.teacher_id));
  });

  tbody.innerHTML = routesToShow.map((r) => {
    const staffList = (byRoute[r.id] || [])
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const cells = staffList.length
      ? staffList.map((s) => {
          const recs = _coveragePayments.filter((p) => p.collected_by === s.user_id);
          const total = recs.reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);
          return `
          <div style="padding:0.4rem 0;border-bottom:1px dashed var(--glass-border);">
            <strong>${esc(s.full_name)}</strong>
            ${s.registration_id ? `<div><small style="color:var(--text-muted);">Staff ID: ${esc(s.registration_id)}</small></div>` : ''}
            ${s.phone ? `<div><small>Phone: ${esc(s.phone)}</small></div>` : ''}
            ${s.email ? `<div><small>Email: ${esc(s.email)}</small></div>` : ''}
            <div style="margin-top:0.35rem;font-size:0.85rem;font-weight:700;color:var(--success);">Collected in range: GHC ${formatCurrency(total)} (${recs.length} payment(s))</div>
            <button type="button" class="action-btn confirm" style="margin-top:0.4rem;font-size:0.78rem;" onclick="openCollectorCollections('${s.id}')">View Collections by Date</button>
          </div>`;
        }).join('')
      : '<span style="color:var(--text-muted);font-size:0.85rem;">No collector assigned — assign one above.</span>';

    return `<tr>
      <td><strong>${esc(r.name)}</strong>${r.description ? `<br/><small style="color:var(--text-muted);font-size:0.78rem;">${esc(r.description)}</small>` : ''}</td>
      <td>GHC ${formatCurrency(r.fee)}/day</td>
      <td>${cells}</td>
    </tr>`;
  }).join('');
}

// ================================================================
// Printing
// ================================================================

/** A4-ready daily collection summary (grouped by destination). */
function printTransportDaily() {
  const date = getEl('trDailyDate')?.value || todayISO();
  const method = getEl('trDailyMethod')?.value || 'Cash';

  let expected = 0;
  let collected = 0;
  let totalStudents = 0;
  const rows = [];

  _routes.filter((r) => r.is_active).forEach((route) => {
    const enrolledSet = enrolledStudentIdsForRoute(route.id);
    const students = _students
      .filter((s) => enrolledSet.has(s.student_id))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    if (!students.length) return;

    totalStudents += students.length;
    expected += students.length * Number(route.fee || 0);

    rows.push(`<tr><td colspan="4" style="background:#eef2ff;font-weight:700;">Bus: ${esc(route.name)} — GHC ${formatCurrency(route.fee)}/day</td></tr>`);
    students.forEach((s) => {
      const pay = _dailyPaymentsByKey[`${s.student_id}|${route.id}`];
      const paid = Boolean(pay);
      if (paid) collected += Number(pay.fee_amount || 0);
      rows.push(`<tr>
        <td>${esc(s.student_id)}</td>
        <td>${esc(fullName(s))}</td>
        <td>${esc(s.class_applying || '—')}</td>
        <td>${paid ? `<strong>GHC ${formatCurrency(pay.fee_amount)}</strong> PAID` : '<em>UNPAID</em>'}</td>
      </tr>`);
    });
  });

  const body = `<div style="max-width:720px;margin:0 auto;font-family:Arial,sans-serif;line-height:1.45;">
    <h2 style="margin:0 0 0.25rem 0;">${esc(_schoolName)}</h2>
    <p style="margin:0;color:#555;">Student Transport — Daily Collection Sheet</p>
    <p style="margin:0 0 0.6rem 0;color:#555;">Date: <strong>${esc(date)}</strong> &nbsp;·&nbsp; Method: <strong>${esc(method)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#5448e4;color:#fff;">
          <th style="padding:8px;text-align:left;">Student ID</th>
          <th style="padding:8px;text-align:left;">Name</th>
          <th style="padding:8px;text-align:left;">Class</th>
          <th style="padding:8px;text-align:left;">Status</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
      <tr><td style="padding:6px;">Students on bus</td><td style="text-align:right;font-weight:700;">${totalStudents}</td></tr>
      <tr><td style="padding:6px;">Expected (GHC)</td><td style="text-align:right;font-weight:700;">${formatCurrency(expected)}</td></tr>
      <tr><td style="padding:6px;">Collected (GHC)</td><td style="text-align:right;font-weight:700;color:#059669;">${formatCurrency(collected)}</td></tr>
      <tr><td style="padding:6px;">Outstanding (GHC)</td><td style="text-align:right;font-weight:700;color:#d93025;">${formatCurrency(Math.max(expected - collected, 0))}</td></tr>
    </table>
    <p style="margin-top:1.4rem;">Collected by: ______________________ &nbsp;&nbsp; Signature: ______________________</p>
  </div>`;

  openPrintWindow(`<html><head><meta charset="utf-8"><title>Transport Daily Collection — ${esc(date)}</title></head><body>${body}</body></html>`, `Transport Daily Collection — ${date}`);
}

/** A4-ready ledger for the payments history filters. */
function printTransportLedger() {
  const tbody = getEl('transportHistoryBody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')].filter((tr) => !tr.querySelector('td[colspan]'));
  if (!rows.length) { showMessage('transportHistoryMessage', 'Nothing to print — the history is empty.', 'info'); return; }

  const from = getEl('trHistoryFrom')?.value || 'start';
  const to = getEl('trHistoryTo')?.value || 'today';
  let html = `<table width="100%" cellpadding="6" border="1" style="border-collapse:collapse;font-size:12px;">
    <thead><tr style="background:#5448e4;color:#fff;"><th>Date</th><th>Student</th><th>Destination</th><th>Amount (GHC)</th><th>Method</th><th>Reference</th></tr></thead><tbody>`;
  rows.forEach((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    if (tds.length < 6) return;
    const text = (td) => td.textContent.replace(/\(deleted\)/gi, '').trim();
    const amount = text(tds[3]).replace(/[^0-9.]/g, '');
    html += `<tr><td>${esc(text(tds[0]))}</td><td>${esc(text(tds[1]))}</td><td>${esc(text(tds[2]))}</td><td align="right">${esc(amount)}</td><td>${esc(text(tds[4]))}</td><td>${esc(text(tds[5]))}</td></tr>`;
  });
  html += `</tbody></table>`;
  const body = `<div style="max-width:760px;margin:0 auto;font-family:Arial,sans-serif;">
    <h2>${esc(_schoolName)} — Transport Collections Ledger</h2>
    <p>Period: <strong>${esc(from)}</strong> → <strong>${esc(to)}</strong></p>
    ${html}
    <p style="margin-top:0.8rem;"><strong>Total entries: ${rows.length}</strong></p>
  </div>`;
  openPrintWindow(`<html><head><meta charset="utf-8"><title>Transport Collections Ledger</title></head><body>${body}</body></html>`, 'Transport Collections Ledger');
}

// ================================================================
// Window wiring (onclick targets used by rendered rows)
// ================================================================
window.trPrintLedger = printTransportLedger;
window.trPrintDaily = printTransportDaily;