/**
 * Transport Workspace — shared daily bus-fee collection module
 * ================================================================
 * Renders a self-contained transport fee-collection workspace into any
 * container. Used by two dashboards with different permissions:
 *
 *   MODE 'manage'  (staff flagged as Transport Fees Collector):
 *                  - mark students PAID / UNPAID on the daily sheet
 *                  - mark an entire route paid / reset a route
 *                  - view + remove entries in the payments history
 *                  - print the daily sheet and the history ledger
 *
 *   MODE 'view'    (Accountant):
 *                  - read-only daily sheet + history (no edit buttons)
 *                  - print the daily sheet and the history ledger
 *
 * The Admin keeps FULL access via the dedicated Transport module page
 * (js/modules/admin-transport.js) — routes & fees CRUD, student
 * enrollment, daily collection and history.
 *
 * Mobile friendly: route cards replace wide tables, big tap targets,
 * stacked-card tables via the shared applyTableLabels helper.
 */

import { getEl, showMessage, clearMessage, getCurrentSchoolId, formatCurrency, logSubAdminActivity, logStaffActivity, openPrintWindow, buildStudentName } from './utils.js';
import { normalizeGhanaPhone, isSmsEnabledForSchool, getAdminContactForSchool, buildAssistanceLine } from './sms-gateway.js';
import { svgIcon } from './icons.js';

let supabaseClient = null;

// ================================================================
// Workspace state (one active workspace per page at a time)
// ================================================================

const W = {
  containerId: null,
  mode: 'view',          // 'manage' | 'view'
  schoolId: null,
  schoolName: 'School',
  routes: [],            // transport_routes
  enrollments: [],       // transport_enrollments
  students: [],          // applications
  studentMap: {},        // student_id -> application
  payments: [],          // transport_fee_payments for date
  paymentsByKey: {},     // "studentId|routeId" -> payment row
  date: '',
  tab: 'daily',          // 'daily' | 'history'
  // daily filter state
  routeFilter: '',
  classFilter: '',
  search: '',
  method: 'Cash',
  collapsedRoutes: new Set(), // route IDs collapsed in Today's Collection
  // history filter state
  hFrom: '',
  hTo: '',
  hRoute: '',
  hClass: '',
  hSearch: '',
};

export function initTransportWorkspace(supabase) {
  supabaseClient = supabase;
}

// ================================================================
// Small helpers
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

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

function manageMode() {
  return W.mode === 'manage';
}
// ================================================================
// Public API
// ================================================================

/**
 * Load (or reload) the transport workspace into a container.
 * @param {string} containerId The element id to render into.
 * @param {string} mode        'manage' (staff collectors) | 'view' (accountant)
 */
export async function loadTransportWorkspace(containerId, mode = 'view') {
  W.containerId = containerId;
  W.mode = mode;
  W.tab = 'daily';
  W.schoolId = await getCurrentSchoolId();
  if (!W.schoolId) {
    renderError(containerId, 'Could not determine your school ID. Please re-login and try again.');
    return;
  }
  W.date = W.date || todayISO();
  try {
    await loadRefData();
    await loadDailyPayments();
    renderWorkspace();
  } catch (err) {
    console.error('[TransportWS] load failed:', err);
    renderError(containerId, `Failed to load transport data: ${err.message}`);
  }
}

/**
 * Re-run the workspace keeping the current tab, date and filters.
 * Used by the real-time refresher so the collector/accountant isn't
 * bounced back to the Daily tab when data changes elsewhere.
 */
export async function refreshTransportWorkspace() {
  if (!W.containerId) return;
  try {
    const dateInput = getEl('tsDailyDate');
    if (dateInput && dateInput.value) W.date = dateInput.value;
    await loadRefData();
    await loadDailyPayments();
    renderWorkspace();
  } catch (err) {
    console.error('[TransportWS] refresh failed:', err);
  }
}

// ================================================================
// Data loading
// ================================================================

async function loadRefData() {
  // School name (cache)
  if (!W.schoolName || W.schoolName === 'School') {
    try {
      const { data: school } = await supabaseClient.from('schools').select('name').eq('id', W.schoolId).maybeSingle();
      W.schoolName = school?.name || 'School';
    } catch (e) { /* non-critical */ }
  }

  const { data: routes, error: routesErr } = await supabaseClient
    .from('transport_routes')
    .select('*')
    .eq('school_id', W.schoolId)
    .order('name', { ascending: true });
  if (routesErr) throw routesErr;
  W.routes = routes || [];

  const { data: enrollments, error: enrErr } = await supabaseClient
    .from('transport_enrollments')
    .select('*')
    .eq('school_id', W.schoolId);
  if (enrErr) throw enrErr;
  W.enrollments = enrollments || [];

  const { data: students, error: stuErr } = await supabaseClient
    .from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying, status, parent_contact')
    .eq('school_id', W.schoolId);
  if (stuErr) throw stuErr;
  W.students = students || [];
  W.studentMap = {};
  W.students.forEach((s) => { W.studentMap[s.student_id] = s; });
}

async function loadDailyPayments() {
  if (!W.date) { W.payments = []; W.paymentsByKey = {}; return; }
  const { data, error } = await supabaseClient
    .from('transport_fee_payments')
    .select('*')
    .eq('school_id', W.schoolId)
    .eq('collection_date', W.date);
  if (error) throw error;
  W.payments = data || [];
  W.paymentsByKey = {};
  W.payments.forEach((p) => { W.paymentsByKey[`${p.student_id}|${p.route_id}`] = p; });
}

function enrolledStudentIdsForRoute(routeId) {
  const set = new Set();
  W.enrollments.forEach((e) => {
    if (e.route_id === routeId && e.is_active) set.add(e.student_id);
  });
  return set;
}

function renderError(containerId, message) {
  const el = getEl(containerId);
  if (!el) { alert(message); return; }
  el.innerHTML = `<div class="tr-empty-state"><strong>Transport</strong><br/>${esc(message)}</div>`;
}
// ================================================================
// Workspace shell
// ================================================================

function renderWorkspace() {
  const container = getEl(W.containerId);
  if (!container) return;

  const modeChip = manageMode()
    ? '<span class="tr-chip">Collection manager</span>'
    : '<span class="tr-chip">View · Print only</span>';

  const methodOptions = '<option>Cash</option><option>Mobile Money</option><option>Bank Transfer</option><option>Cheque</option><option>Other</option>';
  const methodSelect = manageMode()
    ? `<label>Method</label><select id="tsMethod" class="filter-select" style="max-width:150px;">${methodOptions}</select>`
    : '';

  const routeOptions = '<option value="">All Destinations</option>'
    + W.routes.map((r) => `<option value="${r.id}">${esc(r.name)} (GHC ${formatCurrency(r.fee)})</option>`).join('');

  container.innerHTML = `
    <div class="transport-workspace">
      <div class="transport-tabs" style="margin-bottom:1rem;">
        <button type="button" class="transport-tab ${W.tab === 'daily' ? 'active' : ''}" data-ts-tab="daily" onclick="tsWorkspaceTab('daily')">Today's Collection</button>
        <button type="button" class="transport-tab ${W.tab === 'history' ? 'active' : ''}" data-ts-tab="history" onclick="tsWorkspaceTab('history')">Payments History</button>
        ${modeChip}
      </div>

      <div id="tsTab-daily" style="${W.tab === 'daily' ? '' : 'display:none;'}">
        <div class="transport-daily-toolbar">
          <label>Date</label>
          <input type="date" id="tsDailyDate" class="search-input" style="max-width:150px;" value="${esc(W.date)}" />
          <select id="tsRouteFilter" class="filter-select"><option value="">All Destinations</option></select>
          <select id="tsClassFilter" class="filter-select"><option value="">All Classes</option></select>
          <input type="text" id="tsDailySearch" placeholder="Search student..." class="search-input" style="max-width:170px;" />
          ${methodSelect}
          <button type="button" class="btn btn-primary" id="tsRefreshBtn">Refresh</button>
          <button type="button" class="btn btn-secondary" id="tsPrintDailyBtn">Print Sheet</button>
        </div>

        <div id="tsDailyMsg" class="message" style="display:none;margin-bottom:0.75rem;"></div>

        <div class="tr-summary-cards" id="tsSummaryCards"></div>
        <div id="tsRouteCards"></div>
        <p id="tsDailyEmpty" style="display:none;text-align:center;color:var(--text-muted);padding:1.75rem;border:1px dashed var(--border);border-radius:12px;">
          No bus students to collect from for this date / filters.<br/>
          <strong>Tip:</strong> the Admin manages destinations (Routes &amp; Fees) and bus enrollment (Enroll Students) in the Transport module.
        </p>
      </div>

      <div id="tsTab-history" style="${W.tab === 'history' ? '' : 'display:none;'}">
        <div class="tr-history-filters">
          <label>From</label><input type="date" id="tsHistFrom" class="search-input" style="max-width:150px;" value="${esc(W.hFrom)}" />
          <label>To</label><input type="date" id="tsHistTo" class="search-input" style="max-width:150px;" value="${esc(W.hTo)}" />
          <select id="tsHistRoute" class="filter-select">${routeOptions}</select>
          <select id="tsHistClass" class="filter-select"><option value="">All Classes</option></select>
          <input type="text" id="tsHistSearch" placeholder="Search student..." class="search-input" style="max-width:160px;" />
          <button type="button" class="btn btn-primary" id="tsHistRefresh">Refresh</button>
          <button type="button" class="btn btn-secondary" id="tsPrintLedgerBtn">Print Ledger</button>
        </div>
        <div id="tsHistTotals" style="margin-bottom:0.5rem;"></div>
        <div id="tsHistMsg" class="message" style="display:none;margin-bottom:0.75rem;"></div>
        <div class="table-wrapper">
          <table class="app-table" id="tsHistTable">
            <thead><tr><th>Date</th><th>Student</th><th>Destination</th><th>Amount (GHC)</th><th>Method</th><th>Reference</th></tr></thead>
            <tbody id="tsHistBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  // Pre-populate route + class filters (preserve selection state)
  const routeSel = getEl('tsRouteFilter');
  if (routeSel && W.routes.length) {
    routeSel.innerHTML = routeOptions;
    if (W.routeFilter) routeSel.value = W.routeFilter;
  }
  const histRouteSel = getEl('tsHistRoute');
  if (histRouteSel && W.routes.length) {
    histRouteSel.innerHTML = routeOptions;
    if (W.hRoute) histRouteSel.value = W.hRoute;
  }
  populateClassSelects();

  // Re-apply input values from workspace state
  getEl('tsDailyDate').value = W.date;
  getEl('tsDailySearch').value = W.search;
  getEl('tsHistFrom').value = W.hFrom;
  getEl('tsHistTo').value = W.hTo;
  getEl('tsHistSearch').value = W.hSearch;
  if (manageMode()) getEl('tsMethod').value = W.method;

  attachWorkspaceListeners();

  if (W.tab === 'daily') renderDailyCards();
  else renderHistory();
}
function populateClassSelects() {
  const classes = [...new Set(W.students.map((s) => s.class_applying).filter(Boolean))].sort();
  const classOptions = '<option value="">All Classes</option>' + classes.map((c) => `<option>${esc(c)}</option>`).join('');
  const dailySel = getEl('tsClassFilter');
  if (dailySel) { dailySel.innerHTML = classOptions; if (W.classFilter) dailySel.value = W.classFilter; }
  const histSel = getEl('tsHistClass');
  if (histSel) { histSel.innerHTML = classOptions; if (W.hClass) histSel.value = W.hClass; }
}

function attachWorkspaceListeners() {
  getEl('tsDailyDate').addEventListener('change', onDateChange);
  getEl('tsRouteFilter').addEventListener('change', () => { W.routeFilter = getEl('tsRouteFilter').value; renderDailyCards(); });
  getEl('tsClassFilter').addEventListener('change', () => { W.classFilter = getEl('tsClassFilter').value; renderDailyCards(); });
  getEl('tsDailySearch').addEventListener('input', () => { W.search = getEl('tsDailySearch').value.trim().toLowerCase(); renderDailyCards(); });
  if (manageMode()) getEl('tsMethod').addEventListener('change', () => { W.method = getEl('tsMethod').value; });
  getEl('tsRefreshBtn').addEventListener('click', refreshWorkspaceData);
  getEl('tsPrintDailyBtn').addEventListener('click', () => printDailySheet());

  getEl('tsHistFrom').addEventListener('change', () => { W.hFrom = getEl('tsHistFrom').value; renderHistory(); });
  getEl('tsHistTo').addEventListener('change', () => { W.hTo = getEl('tsHistTo').value; renderHistory(); });
  getEl('tsHistRoute').addEventListener('change', () => { W.hRoute = getEl('tsHistRoute').value; renderHistory(); });
  getEl('tsHistClass').addEventListener('change', () => { W.hClass = getEl('tsHistClass').value; renderHistory(); });
  getEl('tsHistSearch').addEventListener('input', () => { W.hSearch = getEl('tsHistSearch').value.trim().toLowerCase(); renderHistory(); });
  getEl('tsHistRefresh').addEventListener('click', renderHistory);
  getEl('tsPrintLedgerBtn').addEventListener('click', () => printLedger());
}

async function onDateChange() {
  W.date = getEl('tsDailyDate').value || todayISO();
  try {
    await loadDailyPayments();
  } catch (err) {
    console.error('[TransportWS] date change failed:', err);
  }
  if (W.tab === 'daily') renderDailyCards();
}

/** Full re-fetch of reference data + payments then re-render. */
async function refreshWorkspaceData() {
  try {
    W.date = getEl('tsDailyDate')?.value || W.date || todayISO();
    await loadRefData();
    await loadDailyPayments();
    renderWorkspace();
  } catch (err) {
    console.error('[TransportWS] refresh failed:', err);
    const msgEl = getEl('tsDailyMsg');
    if (msgEl) { msgEl.textContent = err.message; msgEl.className = 'message error'; msgEl.style.display = 'block'; }
  }
}

/** Tab toggle used by the workspace buttons. */
window.tsWorkspaceTab = function (tab) {
  W.tab = tab;
  document.querySelectorAll(`#${W.containerId} .transport-tab`).forEach((b) => b.classList.remove('active'));
  const b = document.querySelector(`#${W.containerId} .transport-tab[data-ts-tab="${tab}"]`);
  if (b) b.classList.add('active');
  const dailyEl = document.getElementById('tsTab-daily');
  const histEl = document.getElementById('tsTab-history');
  if (dailyEl) dailyEl.style.display = tab === 'daily' ? '' : 'none';
  if (histEl) histEl.style.display = tab === 'history' ? '' : 'none';
  if (tab === 'daily') renderDailyCards();
  else renderHistory();
};
// ================================================================
// Today's Collection (daily sheet grouped by destination)
// ================================================================

function renderDailyCards() {
  clearMessage('tsDailyMsg');
  const routeId = W.routeFilter || '';
  const classFilter = W.classFilter || '';
  const search = W.search || '';

  const routesShown = W.routes.filter((r) => (!routeId ? r.is_active : r.id === routeId));

  let expected = 0;
  let collected = 0;
  let studentCount = 0;
  const routeCards = [];

  routesShown.forEach((route) => {
    const enrolledSet = enrolledStudentIdsForRoute(route.id);
    let students = W.students.filter((s) => enrolledSet.has(s.student_id));
    students = students
      .filter((s) => !classFilter || s.class_applying === classFilter)
      .filter((s) => !search || (s.student_id + ' ' + fullName(s)).toLowerCase().includes(search))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));

    if (!students.length) return;

    const routeExpected = students.length * Number(route.fee || 0);
    const routePaidRows = students.filter((s) => W.paymentsByKey[`${s.student_id}|${route.id}`]);
    const routeCollected = routePaidRows.reduce((sum, s) => {
      const p = W.paymentsByKey[`${s.student_id}|${route.id}`];
      return sum + Number(p.fee_amount || 0);
    }, 0);
    const pct = routeExpected > 0 ? Math.round((routeCollected / routeExpected) * 100) : 0;

    expected += routeExpected;
    collected += routeCollected;
    studentCount += students.length;

    const studentRows = students.map((s) => {
      const pay = W.paymentsByKey[`${s.student_id}|${route.id}`];
      const paid = Boolean(pay);
      const name = fullName(s);
      const avatar = esc(initialsOf(name));
      const sub = `${esc(s.student_id)} · ${esc(s.class_applying || '—')}`;
      if (paid) {
        // Only the Admin can undo / delete a recorded collection — collectors
        // and the accountant simply see the PAID badge.
        return `<div class="tr-student-row">
          <span class="tr-student-avatar">${avatar}</span>
          <span class="tr-student-info"><span class="tr-student-name">${esc(name)}</span><small>${sub}</small></span>
          <span class="tr-student-paid-badge">✓ Paid · GHC ${formatCurrency(pay.fee_amount)}</span>
        </div>`;
      }
      const payBtn = manageMode()
        ? `<button type="button" class="tr-mark-paid-btn" onclick="tsMarkPaid('${s.student_id}','${route.id}')">Pay · GHC ${formatCurrency(route.fee)}</button>`
        : '<span style="font-size:0.75rem;color:var(--danger,#dc2626);font-weight:700;">Unpaid</span>';
      return `<div class="tr-student-row">
        <span class="tr-student-avatar">${avatar}</span>
        <span class="tr-student-info"><span class="tr-student-name">${esc(name)}</span><small>${sub}</small></span>
        ${payBtn}
      </div>`;
    }).join('');

    const routeDesc = route.description ? `<small>${esc(route.description)}</small>` : '';
    const progressLabel = `${routePaidRows.length} of ${students.length} paid · GHC ${formatCurrency(routeCollected)} of GHC ${formatCurrency(routeExpected)} · ${pct}%`;

    // Collectors can only ADD collections — deleting / resetting stays with the Admin.
    const actionsHtml = manageMode()
      ? `<div class="tr-route-actions">
          <button type="button" class="tr-bulk-paid" onclick="tsMarkAllRoutePaid('${route.id}')">✓ Mark all paid</button>
        </div>`
      : '';

    const isCollapsed = W.collapsedRoutes.has(route.id);

    routeCards.push(`<div class="tr-route-card" data-route-id="${route.id}" data-collapsed="${isCollapsed}">
      <div class="tr-route-card-header" title="Click to expand / collapse" onclick="tsToggleCollapse('${route.id}')">
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
      ${actionsHtml}
    </div>`);
  });

  const cardsEl = getEl('tsSummaryCards');
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="tr-stat-card"><span class="tr-stat-label">Expected</span><span class="tr-stat-value tr-expected">GHC ${formatCurrency(expected)}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Collected</span><span class="tr-stat-value tr-collected">GHC ${formatCurrency(collected)}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Outstanding</span><span class="tr-stat-value tr-outstanding">GHC ${formatCurrency(Math.max(expected - collected, 0))}</span></div>
      <div class="tr-stat-card"><span class="tr-stat-label">Bus Students</span><span class="tr-stat-value tr-students">${studentCount}</span></div>`;
  }

  const routesEl = getEl('tsRouteCards');
  if (routesEl) routesEl.innerHTML = routeCards.length ? routeCards.join('') : '';

  const emptyEl = getEl('tsDailyEmpty');
  if (emptyEl) emptyEl.style.display = routeCards.length ? 'none' : '';
}
// ================================================================
// Collection actions (manage mode only — guarded in the UI)
// ================================================================

/** Expand / collapse a destination card in the Today's Collection sheet. */
window.tsToggleCollapse = function (routeId) {
  const card = document.querySelector(`.tr-route-card[data-route-id="${routeId}"]`);
  if (!card) return;
  const collapsed = card.getAttribute('data-collapsed') === 'true';
  card.setAttribute('data-collapsed', String(!collapsed));
  if (!collapsed) W.collapsedRoutes.add(routeId);
  else W.collapsedRoutes.delete(routeId);
};

/**
 * Mark a single student's transport fee as PAID for the shown date.
 * Collectors can only ADD collections — they cannot delete a payment.
 * Deleting / undoing a collection is restricted to the Admin.
 */
window.tsMarkPaid = async function (studentId, routeId) {
  if (!manageMode()) return;
  const student = W.studentMap[studentId];
  const route = W.routes.find((r) => r.id === routeId);
  const existing = W.paymentsByKey[`${studentId}|${routeId}`];
  const date = W.date;

  if (existing) {
    showMessage('tsDailyMsg', `${fullName(student)} is already recorded as PAID for ${date}. Only the school Admin can delete a transport payment.`, 'info');
    return;
  }

  try {
    const fee = Number(route?.fee || 0);
    if (fee <= 0) {
      showMessage('tsDailyMsg', `"${route?.name || 'This route'}" has no daily fee set. Contact the admin to set it in Transport → Routes & Fees.`, 'error');
      return;
    }
    const method = getEl('tsMethod')?.value || 'Cash';
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data, error } = await supabaseClient.from('transport_fee_payments').insert({
      school_id: W.schoolId,
      student_id: studentId,
      route_id: routeId,
      fee_amount: fee,
      collection_date: date,
      payment_method: method,
      collected_by: user?.id || null,
    }).select('id, created_at').single();
    if (error) throw error;
    await logStaffActivity(`Collected transport fee GHC ${formatCurrency(fee)} for ${fullName(student)} (${studentId}) on ${date} — ${route?.name}`, { role: 'teacher', entityType: 'transport', entityDetails: `${studentId} · ${date} · GHC ${formatCurrency(fee)}` });
    await logSubAdminActivity(`Collected transport fee GHC ${formatCurrency(fee)} for ${fullName(student)} (${studentId}) on ${date} — ${route?.name}`, 'transport');
    sendTransportFeeSms(studentId, fee, date, route?.name); // fire-and-forget
    await loadDailyPayments();
    renderDailyCards();
  } catch (err) {
    console.error('[TransportWS] mark paid error:', err);
    showMessage('tsDailyMsg', `Failed to record payment: ${err.message}`, 'error');
  }
};

/** Mark every unpaid student on a route as PAID for the shown date. */
window.tsMarkAllRoutePaid = async function (routeId) {
  if (!manageMode()) return;
  const route = W.routes.find((r) => r.id === routeId);
  if (!route) return;

  const enrolledSet = enrolledStudentIdsForRoute(routeId);
  const pending = W.students.filter((s) => enrolledSet.has(s.student_id))
    .filter((s) => !W.paymentsByKey[`${s.student_id}|${routeId}`]);

  if (!pending.length) {
    showMessage('tsDailyMsg', `All students on "${route.name}" have already paid for ${W.date}.`, 'info');
    return;
  }
  if (!confirm(`Mark ${pending.length} student(s) on "${route.name}" as PAID for ${W.date}? Each pays the route fee of GHC ${formatCurrency(route.fee)}.`)) return;

  const method = getEl('tsMethod')?.value || 'Cash';
  const { data: { user } } = await supabaseClient.auth.getUser();
  const rows = pending.map((s) => ({
    school_id: W.schoolId,
    student_id: s.student_id,
    route_id: routeId,
    fee_amount: Number(route.fee || 0),
    collection_date: W.date,
    payment_method: method,
    collected_by: user?.id || null,
  }));

  try {
    const { error } = await supabaseClient.from('transport_fee_payments').insert(rows);
    if (error) throw error;
    await logStaffActivity(`Bulk-collected transport fees for ${pending.length} student(s) on "${route.name}" for ${W.date}`, { role: 'teacher', entityType: 'transport', entityDetails: `${route.name} · ${W.date}` });
    await logSubAdminActivity(`Bulk-collected transport fees for ${pending.length} student(s) on "${route.name}" for ${W.date}`, 'transport');
    pending.forEach((s) => sendTransportFeeSms(s.student_id, Number(route.fee || 0), W.date, route.name));
    await loadDailyPayments();
    renderDailyCards();
  } catch (err) {
    console.error('[TransportWS] mark all error:', err);
    showMessage('tsDailyMsg', `Failed to mark all as paid: ${err.message}`, 'error');
  }
};
/** Delete / reset is ADMIN ONLY. Kept as a guard so any stale buttons don't silently fail. */
window.tsMarkAllRouteUnpaid = async function () {
  if (!manageMode()) return;
  showMessage('tsDailyMsg', 'Only the school Admin can delete / reset transport payments.', 'error');
};

/** Remove a single history entry — ADMIN ONLY. Guard kept for stale DOM safety. */
window.tsDeleteHistoryEntry = async function () {
  showMessage('tsHistMsg', 'Only the school Admin can delete transport payment records.', 'error');
};

// ================================================================
// Parent SMS notification (best-effort, never blocks the flow)
// ================================================================

async function sendTransportFeeSms(studentId, amount, date, routeName) {
  try {
    const smsOn = await isSmsEnabledForSchool(W.schoolId);
    if (!smsOn) return;
    const app = W.studentMap[studentId];
    if (!app) return;
    const phone = normalizeGhanaPhone(app.parent_contact);
    if (!phone) return;
    const adminPhone = await getAdminContactForSchool(W.schoolId);
    const school = String(W.schoolName || 'School').trim().slice(0, 45);
    let msg = `${school}: Transport fee received GHC${formatCurrency(amount)} for ${fullName(app)}${routeName ? ' (' + routeName + ')' : ''} on ${date}. Thank you.`;
    msg += buildAssistanceLine(adminPhone);
    await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg }),
    });
  } catch (err) {
    console.warn('[TransportWS] SMS notification failed:', err.message);
  }
}
// ================================================================
// Payments History (date-range ledger)
// ================================================================

async function renderHistory() {
  const tbody = getEl('tsHistBody');
  if (!tbody) return;
  clearMessage('tsHistMsg');

  try {
    let q = supabaseClient
      .from('transport_fee_payments')
      .select('*')
      .eq('school_id', W.schoolId)
      .order('collection_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (W.hFrom) q = q.gte('collection_date', W.hFrom);
    if (W.hTo) q = q.lte('collection_date', W.hTo);
    if (W.hRoute) q = q.eq('route_id', W.hRoute);

    const { data, error } = await q;
    if (error) throw error;

    let payments = data || [];
    if (W.hClass || W.hSearch) {
      payments = payments.filter((p) => {
        const s = W.studentMap[p.student_id];
        if (!s) return false;
        if (W.hClass && s.class_applying !== W.hClass) return false;
        if (W.hSearch) {
          const hay = `${p.student_id} ${fullName(s)}`.toLowerCase();
          if (!hay.includes(W.hSearch)) return false;
        }
        return true;
      });
    }

    renderHistoryRows(payments);
  } catch (err) {
    console.error('[TransportWS] history error:', err);
    tbody.innerHTML = `<tr><td colspan="6">Failed to load history: ${esc(err.message)}</td></tr>`;
  }
}

function renderHistoryRows(payments) {
  const tbody = getEl('tsHistBody');
  const totalsEl = getEl('tsHistTotals');
  if (!tbody) return;

  const totalAmount = payments.reduce((sum, p) => sum + Number(p.fee_amount || 0), 0);
  if (totalsEl) {
    totalsEl.innerHTML = payments.length
      ? `<span class="tr-history-total">${payments.length} payment(s)</span> <span class="tr-history-total">Total: GHC ${formatCurrency(totalAmount)}</span>`
      : '';
  }

  if (!payments.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No transport fee payments found for the selected filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = payments.map((p) => {
    const s = W.studentMap[p.student_id];
    const route = W.routes.find((r) => r.id === p.route_id);
    const time = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<tr>
      <td data-label="Date">${esc(p.collection_date)}<br/><small style="color:var(--text-muted);font-size:0.72rem;">${esc(time)}</small></td>
      <td data-label="Student">${esc(fullName(s))}<br/><small style="color:var(--text-muted);font-size:0.72rem;">${esc(p.student_id)}${s?.class_applying ? ' · ' + esc(s.class_applying) : ''}</small></td>
      <td data-label="Destination">${route ? esc(route.name) : '<span style="color:var(--text-muted);">(deleted)</span>'}</td>
      <td data-label="Amount" style="text-align:right;font-weight:700;color:var(--success);">GHC ${formatCurrency(p.fee_amount)}</td>
      <td data-label="Method">${esc(p.payment_method || 'Cash')}</td>
      <td data-label="Reference">${p.reference ? esc(p.reference) : '—'}</td>
    </tr>`;
  }).join('');
}
// ================================================================
// Printing
// ================================================================

/** A4-ready daily collection summary (grouped by destination). */
function printDailySheet() {
  const date = getEl('tsDailyDate')?.value || W.date;
  const method = manageMode() ? (getEl('tsMethod')?.value || 'Cash') : 'All methods';

  let expected = 0;
  let collected = 0;
  let totalStudents = 0;
  const rows = [];

  W.routes.filter((r) => r.is_active).forEach((route) => {
    const enrolledSet = enrolledStudentIdsForRoute(route.id);
    const students = W.students
      .filter((s) => enrolledSet.has(s.student_id))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    if (!students.length) return;

    totalStudents += students.length;
    expected += students.length * Number(route.fee || 0);

    rows.push(`<tr><td colspan="4" style="background:#eef2ff;font-weight:700;">Bus: ${esc(route.name)} — GHC ${formatCurrency(route.fee)}/day</td></tr>`);
    students.forEach((s) => {
      const pay = W.paymentsByKey[`${s.student_id}|${route.id}`];
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
    <h2 style="margin:0 0 0.25rem 0;">${esc(W.schoolName)}</h2>
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

/** A4-ready ledger for the current history filters. */
function printLedger() {
  const tbody = getEl('tsHistBody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')].filter((tr) => !tr.querySelector('td[colspan]'));
  if (!rows.length) { showMessage('tsHistMsg', 'Nothing to print — the history is empty.', 'info'); return; }

  const from = W.hFrom || 'start';
  const to = W.hTo || 'today';
  let html = `<table width="100%" cellpadding="6" border="1" style="border-collapse:collapse;font-size:12px;">
    <thead><tr style="background:#5448e4;color:#fff;"><th>Date</th><th>Student</th><th>Destination</th><th>Amount (GHC)</th><th>Method</th><th>Reference</th></tr></thead><tbody>`;
  rows.forEach((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    const text = (td) => td.textContent.replace(/\(deleted\)/gi, '').trim();
    const amount = text(tds[3]).replace(/[^0-9.]/g, '');
    html += `<tr><td>${esc(text(tds[0]))}</td><td>${esc(text(tds[1]))}</td><td>${esc(text(tds[2]))}</td><td align="right">${esc(amount)}</td><td>${esc(text(tds[4]))}</td>${tds.length > 5 ? `<td>${esc(text(tds[5]))}</td>` : '<td>—</td>'}</tr>`;
  });
  html += `</tbody></table>`;
  const body = `<div style="max-width:760px;margin:0 auto;font-family:Arial,sans-serif;">
    <h2>${esc(W.schoolName)} — Transport Collections Ledger</h2>
    <p>Period: <strong>${esc(from)}</strong> → <strong>${esc(to)}</strong></p>
    ${html}
    <p style="margin-top:0.8rem;"><strong>Total entries: ${rows.length}</strong></p>
  </div>`;
  openPrintWindow(`<html><head><meta charset="utf-8"><title>Transport Collections Ledger</title></head><body>${body}</body></html>`, 'Transport Collections Ledger');
}

// ================================================================
// Window wiring (onclick targets used by rendered rows)
// ================================================================
window.tsPrintDaily = printDailySheet;
window.tsPrintLedger = printLedger;