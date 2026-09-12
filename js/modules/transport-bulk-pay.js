/**
 * Transport Bulk Payment modal
 * ================================================================
 * Shared by the Admin Transport module (admin-transport.js) and the
 * shared Transport Workspace (transport-shared.js).
 *
 * When a collector taps a student's "Pay" button on the Today's
 * Collection sheet, this modal opens so they can select MULTIPLE
 * specific days to collect for that ONE student in a single go.
 *
 * Every selected day is recorded as its own transport_fee_payments row
 * with the route fee snapshotted per day. Days that already have a
 * payment for that student + route are shown "Paid" and locked, so the
 * UNIQUE(student_id, collection_date, route_id) constraint is never hit.
 */

import { getEl, showMessage, formatCurrency, buildStudentName } from './utils.js';

const MAX_DAYS = 31;

let busy = false;

const state = {
  supabase: null,
  schoolId: null,
  student: null,
  route: null,
  defaultDate: '',
  collectedBy: null,
  getMethod: null,      // () => current payment-method string from the toolbar
  onSaved: null,        // async ({ inserted, skipped, totalAmount, message }) => void
  onPageMessage: null,  // (msg, type) => void — shown AFTER the sheet refreshes
  paidDates: new Set(), // ISO dates already paid for this student+route in range
  rangeFrom: '',
  rangeTo: '',
};

// ----------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function todayISO() {
  return toISODate(new Date());
}

function fmtDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  const weekday = d.toLocaleDateString([], { weekday: 'short' });
  const date = d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  return `${weekday} · ${date}`;
}

function fullName(s) {
  if (!s) return 'Unknown Student';
  return buildStudentName(s.first_name, s.middle_name, s.last_name) || s.student_id || 'Unknown Student';
}

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

function rangeDates(from, to) {
  const out = [];
  if (!from || !to || to < from) return out;
  let cursor = from;
  while (cursor <= to && out.length < MAX_DAYS) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
// ----------------------------------------------------------------
// Modal shell
// ----------------------------------------------------------------

function ensureModal() {
  if (getEl('trBulkPayModal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'trBulkPayModal';
  overlay.className = 'modal-overlay tr-bulkpay-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal-card tr-bulkpay-card">
      <div class="modal-header">
        <h3>Bulk Transport Payment</h3>
        <button type="button" class="modal-close" onclick="trCloseBulkPay()" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="tr-bulkpay-student" id="trBulkPayStudent"></div>
        <p class="tr-bulkpay-hint">Tick the specific days to collect for this student. Already-paid days are locked so they cannot be double-charged. Up to 31 days at a time.</p>
        <div class="tr-bulkpay-range">
          <label>From</label>
          <input type="date" id="trBulkPayFrom" class="search-input" />
          <label>To</label>
          <input type="date" id="trBulkPayTo" class="search-input" />
        </div>
        <div class="tr-bulkpay-day-actions">
          <button type="button" class="btn btn-secondary" onclick="trBulkPaySelectAll()">Select all unpaid</button>
          <button type="button" class="btn btn-secondary" onclick="trBulkPayClear()">Clear</button>
        </div>
        <div class="tr-bulkpay-day-list" id="trBulkPayDayList"></div>
        <div class="tr-bulkpay-summary" id="trBulkPaySummary"></div>
        <div id="trBulkPayMsg" class="message" style="display:none;margin-top:0.5rem;"></div>
        <div class="tr-bulkpay-footer">
          <button type="button" class="btn btn-secondary" onclick="trCloseBulkPay()">Cancel</button>
          <button type="button" class="btn btn-primary" id="trBulkPayGo" onclick="trBulkPayConfirm()">Confirm Payment</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  getEl('trBulkPayFrom').addEventListener('change', onRangeChange);
  getEl('trBulkPayTo').addEventListener('change', onRangeChange);
  getEl('trBulkPayDayList').addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('tr-bulkpay-check')) renderSummary();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) trCloseBulkPay();
  });
}

function showModalMsg(text, type) {
  showMessage('trBulkPayMsg', text, type || 'error');
}

function hideModalMsg() {
  getEl('trBulkPayMsg').style.display = 'none';
}

function setStudentInfo() {
  const el = getEl('trBulkPayStudent');
  if (!el || !state.student) return;
  const name = fullName(state.student);
  el.innerHTML = `
    <span class="tr-bulkpay-student-avatar">${esc(initialsOf(name))}</span>
    <span class="tr-bulkpay-student-text">
      <span class="tr-bulkpay-student-name">${esc(name)}</span>
      <small>${esc(state.student.student_id || '')} · ${esc(state.student.class_applying || '—')} · ${esc(state.route?.name || 'Route')}</small>
    </span>
    <span class="tr-bulkpay-student-fee">GHC ${formatCurrency(state.route?.fee)}<small>per day</small></span>`;
}
// ----------------------------------------------------------------
// Range + paid-date loading
// ----------------------------------------------------------------

async function loadPaidDates() {
  state.paidDates = new Set();
  try {
    const { data, error } = await state.supabase
      .from('transport_fee_payments')
      .select('collection_date')
      .eq('school_id', state.schoolId)
      .eq('student_id', state.student.student_id)
      .eq('route_id', state.route.id)
      .gte('collection_date', state.rangeFrom)
      .lte('collection_date', state.rangeTo);
    if (error) throw error;
    (data || []).forEach((p) => state.paidDates.add(p.collection_date));
  } catch (err) {
    console.error('[BulkPay] load paid dates error:', err);
  }
}

function onRangeChange() {
  const from = getEl('trBulkPayFrom').value || state.defaultDate;
  let to = getEl('trBulkPayTo').value || addDays(from, 6);
  if (to < from) to = from;
  const maxTo = addDays(from, MAX_DAYS - 1);
  if (to > maxTo) to = maxTo;
  state.rangeFrom = from;
  state.rangeTo = to;
  getEl('trBulkPayFrom').value = from;
  getEl('trBulkPayTo').value = to;
  hideModalMsg();
  loadPaidDates().then(renderDays);
}

// ----------------------------------------------------------------
// Day list rendering
// ----------------------------------------------------------------

function renderDays() {
  const listEl = getEl('trBulkPayDayList');
  if (!listEl) return;
  const dates = rangeDates(state.rangeFrom, state.rangeTo);
  if (!dates.length) {
    listEl.innerHTML = '<p class="tr-bulkpay-empty">Pick a valid date range above — up to 31 days.</p>';
    renderSummary();
    return;
  }
  const fee = Number(state.route?.fee || 0);
  listEl.innerHTML = dates.map((iso) => {
    const paid = state.paidDates.has(iso);
    const isDefault = iso === state.defaultDate;
    const todayTag = iso === todayISO() ? ' <em class="tr-bulkpay-today">today</em>' : '';
    return `<label class="tr-bulkpay-day ${paid ? 'is-paid' : ''}">
      <input type="checkbox" class="tr-bulkpay-check" data-date="${iso}" ${paid ? 'disabled' : ''} ${!paid && isDefault ? 'checked' : ''} />
      <span class="tr-bulkpay-day-label">${esc(fmtDay(iso))}${todayTag}</span>
      <span class="tr-bulkpay-day-fee">GHC ${formatCurrency(fee)}</span>
      ${paid ? '<span class="tr-bulkpay-day-paid">✓ Paid</span>' : ''}
    </label>`;
  }).join('');
  renderSummary();
}

function selectedDates() {
  const listEl = getEl('trBulkPayDayList');
  if (!listEl) return [];
  return [...listEl.querySelectorAll('input[type="checkbox"].tr-bulkpay-check')]
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => cb.getAttribute('data-date'));
}

function renderSummary() {
  const summaryEl = getEl('trBulkPaySummary');
  const goBtn = getEl('trBulkPayGo');
  if (!summaryEl) return;
  const selected = selectedDates();
  const fee = Number(state.route?.fee || 0);
  const total = selected.length * fee;
  summaryEl.innerHTML = `<span class="tr-bulkpay-summary-count">${selected.length} day(s) selected</span>
    <span class="tr-bulkpay-summary-total">Total: GHC ${formatCurrency(total)}</span>`;
  if (goBtn) goBtn.textContent = `Confirm & Pay GHC ${formatCurrency(total)}`;
}
// ----------------------------------------------------------------
// Window wiring (onclick targets used by the modal)
// ----------------------------------------------------------------

/** Tick every unpaid day shown in the list. */
window.trBulkPaySelectAll = function () {
  const listEl = getEl('trBulkPayDayList');
  if (!listEl) return;
  listEl.querySelectorAll('input[type="checkbox"].tr-bulkpay-check').forEach((cb) => {
    if (!cb.disabled) cb.checked = true;
  });
  renderSummary();
};

/** Untick every day in the list. */
window.trBulkPayClear = function () {
  const listEl = getEl('trBulkPayDayList');
  if (!listEl) return;
  listEl.querySelectorAll('input[type="checkbox"].tr-bulkpay-check').forEach((cb) => {
    if (!cb.disabled) cb.checked = false;
  });
  renderSummary();
};

window.trCloseBulkPay = function () {
  const modal = getEl('trBulkPayModal');
  if (modal) modal.style.display = 'none';
};

window.trBulkPayConfirm = async function () {
  if (busy) return;
  const dates = selectedDates();
  if (!dates.length) {
    showModalMsg('Select at least one day to pay for.', 'error');
    return;
  }

  const insertDates = dates.filter((d) => !state.paidDates.has(d));
  const skipped = dates.filter((d) => state.paidDates.has(d));
  if (!insertDates.length) {
    showModalMsg('The selected day(s) are already paid.', 'info');
    return;
  }

  const fee = Number(state.route?.fee || 0);
  const totalAmount = fee * insertDates.length;
  const method = (state.getMethod ? state.getMethod() : 'Cash') || 'Cash';

  const rows = insertDates.map((date) => {
    const row = {
      school_id: state.schoolId,
      student_id: state.student.student_id,
      route_id: state.route.id,
      fee_amount: fee,
      collection_date: date,
      payment_method: method,
    };
    if (state.collectedBy) row.collected_by = state.collectedBy;
    return row;
  });

  busy = true;
  setGoBusy(true);
  try {
    const { error } = await state.supabase.from('transport_fee_payments').insert(rows);
    if (error) throw error;
    const msg = `Bulk payment recorded for ${fullName(state.student)} — ${insertDates.length} day(s) · GHC ${formatCurrency(totalAmount)}${skipped.length ? ` · ${skipped.length} day(s) skipped (already paid)` : ''}.`;
    if (state.onSaved) {
      try {
        await state.onSaved({ inserted: insertDates, skipped, totalAmount, message: msg });
      } catch (e) {
        console.error('[BulkPay] onSaved error:', e);
      }
    }
    window.trCloseBulkPay();
    if (state.onPageMessage) state.onPageMessage(msg, 'success');
  } catch (err) {
    console.error('[BulkPay] insert error:', err);
    showModalMsg(`Failed to record the bulk payment: ${err.message}`, 'error');
  } finally {
    busy = false;
    setGoBusy(false);
  }
};

function setGoBusy(b) {
  const btn = getEl('trBulkPayGo');
  if (!btn) return;
  btn.disabled = b;
  btn.textContent = b ? 'Saving…' : `Confirm & Pay GHC ${formatCurrency(Number(state.route?.fee || 0) * selectedDates().length)}`;
}
// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Open the bulk-payment modal for a single student on a route.
 * @param {object} opts
 * @param {object} opts.supabase          Supabase client
 * @param {string} opts.schoolId          School id (owner of every inserted row)
 * @param {object} opts.student           applications record being paid
 * @param {object} opts.route             transport_routes record (fee + name)
 * @param {string} opts.defaultDate       ISO date pre-checked in the modal
 * @param {string} [opts.collectedBy]     auth user id stored on each row
 * @param {function} [opts.getMethod]     () => payment method string
 * @param {function} [opts.onSaved]       async ({inserted,skipped,totalAmount,message}) => void
 * @param {function} [opts.onPageMessage] (msg, type) => void
 */
export async function openTransportBulkPay(opts) {
  state.supabase = opts.supabase;
  state.schoolId = opts.schoolId;
  state.student = opts.student;
  state.route = opts.route;
  state.defaultDate = opts.defaultDate || todayISO();
  state.collectedBy = opts.collectedBy || null;
  state.getMethod = opts.getMethod || (() => 'Cash');
  state.onSaved = opts.onSaved || null;
  state.onPageMessage = opts.onPageMessage || null;

  const fee = Number(state.route?.fee || 0);
  if (fee <= 0) {
    if (state.onPageMessage) {
      state.onPageMessage(`"${state.route?.name || 'This route'}" has no daily fee set — set it in Transport → Routes & Fees first.`, 'error');
    }
    return;
  }

  ensureModal();
  setStudentInfo();

  // Default range: the sheet's shown date → one week later.
  state.rangeFrom = state.defaultDate;
  state.rangeTo = addDays(state.defaultDate, 6);
  getEl('trBulkPayFrom').value = state.rangeFrom;
  getEl('trBulkPayTo').value = state.rangeTo;

  hideModalMsg();
  getEl('trBulkPayModal').style.display = 'flex';
  await loadPaidDates();
  renderDays();
}