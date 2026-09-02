/**
 * Admin SMS Monitoring Module
 * ============================
 * Lets school admins view every SMS attempt recorded in the `sms_logs`
 * audit table (Nalo Solutions gateway). Shows a summary dashboard plus a
 * filterable table of SENT and UNSENT/FAILED messages.
 *
 * Features:
 *  - Live summary counts (total / sent / failed / sent today)
 *  - Tab filter: All · Sent · Unsent/Failed
 *  - Search by recipient, student ID, receipt number or message text
 *  - Date-range filter + manual refresh
 *  - Full message / provider response detail modal
 *  - One-click retry for failed SMS (re-sends via /api/send-sms and logs a new row)
 *
 * Security: relies on the existing sms_logs RLS policies
 * ("School staff manage sms logs" / "School staff view sms logs"), and
 * further scopes every query with the current school_id (fail-closed).
 */

import { getEl, showMessage, clearMessage, formatDateTime, getCurrentSchoolId } from './utils.js';
import { isSmsEnabledForSchool } from './sms-gateway.js';

let supabaseClient = null;

// ================================================================
// State
// ================================================================

let _logs = [];
let _studentMap = {};
let _activeTab = 'all'; // all | sent | failed
let _limit = 200;
let _smsEnabled = true; // per-school SMS control (set on loadSmsMonitorPage)

// ================================================================
// Init
// ================================================================

export function initSmsMonitor(supabase) {
  supabaseClient = supabase;
}

// ================================================================
// Helpers
// ================================================================

/** Escape a value for safe injection into innerHTML templates. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build a student display name from an applications row. */
function studentDisplay(app) {
  return [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ');
}

/** "Failed / unsent" = any sms_logs row where success is false. */
function isFailed(log) {
  return !log.success;
}

/** Truncate a string for preview cells. */
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Fetch sms_logs for the current school (newest first, capped at _limit)
 * and build a student_id → applications row map for display.
 */
async function _fetchLogs() {
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient
    .from('sms_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(_limit);
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data, error } = await query;
  if (error) throw error;

  const logs = (data || []).filter((l) => !schoolId || l.school_id === schoolId);

  // Student-name lookup (best-effort; rows still show without a name).
  const ids = [...new Set(logs.map((l) => l.student_id).filter(Boolean))];
  _studentMap = {};
  if (ids.length > 0) {
    let appsQuery = supabaseClient
      .from('applications')
      .select('student_id, first_name, middle_name, last_name')
      .in('student_id', ids);
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    const { data: apps } = await appsQuery;
    if (apps) {
      _studentMap = Object.fromEntries(apps.map((a) => [a.student_id, a]));
    }
  }
  return logs;
}

/** Filter the in-memory list by the active tab + filter inputs. */
function _filteredLogs() {
  const search = (getEl('smsMonitorSearch')?.value || '').toLowerCase().trim();
  const from = getEl('smsMonitorFrom')?.value;
  const to = getEl('smsMonitorTo')?.value;

  return _logs.filter((log) => {
    // Tab filter.
    if (_activeTab === 'sent' && isFailed(log)) return false;
    if (_activeTab === 'failed' && !isFailed(log)) return false;

    // Date-range filter (compare the date-only portion).
    const created = log.created_at ? String(log.created_at).slice(0, 10) : '';
    if (from && created < from) return false;
    if (to && created > to) return false;

    // Search filter.
    if (search) {
      const haystack = [
        log.recipient,
        log.student_id,
        log.receipt_number,
        log.message,
        log.error,
        log.sender_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
// ================================================================
// Page loader
// ================================================================

export async function loadSmsMonitorPage(containerId = 'smsMonitorContainer') {
  const container = getEl(containerId);
  if (!container) return;

  container.innerHTML = `
    <div id="smsDisabledBanner" style="display:none;margin-bottom:0.75rem;padding:0.75rem 1rem;border-radius:var(--radius-sm);background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);color:#b91c1c;font-size:0.85rem;font-weight:600;line-height:1.5;">
      📵 SMS is currently <strong>disabled</strong> for this school by the Super Admin. No new SMS can be sent and the Resend buttons are inactive. Contact the Super Administrator to re-enable SMS.
    </div>

    <div class="sms-stat-cards">
      <div class="sms-stat-card">
        <div class="sms-stat-label">Total SMS</div>
        <div class="sms-stat-value" id="smsStatTotal">…</div>
      </div>
      <div class="sms-stat-card stat-sent">
        <div class="sms-stat-label">Sent ✅</div>
        <div class="sms-stat-value stat-sent-value" id="smsStatSent">…</div>
      </div>
      <div class="sms-stat-card stat-failed">
        <div class="sms-stat-label">Unsent / Failed ❌</div>
        <div class="sms-stat-value stat-failed-value" id="smsStatFailed">…</div>
      </div>
      <div class="sms-stat-card stat-today">
        <div class="sms-stat-label">Sent Today</div>
        <div class="sms-stat-value" id="smsStatToday">…</div>
      </div>
    </div>

    <div class="sms-filter-row">
      <button type="button" class="btn btn-secondary sms-tab active" data-sms-tab="all">🗂️ All SMS</button>
      <button type="button" class="btn btn-secondary sms-tab" data-sms-tab="sent">✅ Sent</button>
      <button type="button" class="btn btn-secondary sms-tab" data-sms-tab="failed">❌ Unsent / Failed</button>
    </div>

    <div class="sms-filter-row">
      <input type="text" id="smsMonitorSearch" placeholder="🔍 Search phone, student ID, receipt or message…" class="search-input" style="flex:1;min-width:200px;" />
      <input type="date" id="smsMonitorFrom" class="search-input" style="max-width:150px;" title="From date" />
      <input type="date" id="smsMonitorTo" class="search-input" style="max-width:150px;" title="To date" />
      <button type="button" class="btn btn-secondary" id="smsMonitorRefreshBtn">🔄 Refresh</button>
    </div>

    <div id="smsMonitorMessage" class="message" style="display:none;margin-bottom:0.75rem;"></div>

    <div class="table-wrapper" style="max-height:calc(100vh - 320px);overflow-y:auto;">
      <table class="app-table">
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Student</th>
            <th>Recipient</th>
            <th>Receipt</th>
            <th>Status</th>
            <th>Message</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="smsMonitorBody">
          <tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-muted);">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  `;

  // Wire up tab clicks (delegated so re-renders keep working).
  container.querySelectorAll('.sms-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeTab = btn.getAttribute('data-sms-tab');
      container.querySelectorAll('.sms-tab').forEach((b) => b.classList.toggle('active', b === btn));
      renderSmsMonitorTable();
    });
  });

  // Wire up filters.
  getEl('smsMonitorSearch')?.addEventListener('input', renderSmsMonitorTable);
  getEl('smsMonitorFrom')?.addEventListener('change', renderSmsMonitorTable);
  getEl('smsMonitorTo')?.addEventListener('change', renderSmsMonitorTable);
  getEl('smsMonitorRefreshBtn')?.addEventListener('click', () => {
    renderSmsMonitorDashboard(true);
  });

  // Per-school SMS control: show a banner + disable resending when SMS is off.
  const schoolId = await getCurrentSchoolId();
  _smsEnabled = await isSmsEnabledForSchool(schoolId);
  const banner = getEl('smsDisabledBanner');
  if (banner) banner.style.display = _smsEnabled ? 'none' : 'block';

  await renderSmsMonitorDashboard();
}
// ================================================================
// Dashboard render
// ================================================================

export async function renderSmsMonitorDashboard(showRefreshSpinner = false) {
  clearMessage('smsMonitorMessage');
  const btn = getEl('smsMonitorRefreshBtn');
  if (btn && showRefreshSpinner) {
    btn.disabled = true;
    btn.textContent = '⏳ Refreshing…';
  }
  try {
    _logs = await _fetchLogs();
    renderSmsMonitorStats();
    renderSmsMonitorTable();
  } catch (err) {
    console.error('[SMS Monitor] Failed to load logs:', err);
    showMessage('smsMonitorMessage', '❌ Failed to load SMS logs: ' + err.message, 'error');
    const body = getEl('smsMonitorBody');
    if (body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--danger);">Could not load SMS logs.</td></tr>';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Refresh';
    }
  }
}

/** Update the four summary stat cards. */
function renderSmsMonitorStats() {
  const totalEl = getEl('smsStatTotal');
  const sentEl = getEl('smsStatSent');
  const failedEl = getEl('smsStatFailed');
  const todayEl = getEl('smsStatToday');
  if (!totalEl) return;

  const total = _logs.length;
  const sent = _logs.filter((l) => !isFailed(l)).length;
  const failed = total - sent;
  const todayStr = new Date().toISOString().slice(0, 10);
  const sentToday = _logs.filter((l) => !isFailed(l) && String(l.created_at || '').slice(0, 10) === todayStr).length;

  totalEl.textContent = total;
  sentEl.textContent = sent;
  failedEl.textContent = failed;
  todayEl.textContent = sentToday;
}

/** Render the filtered table body. */
function renderSmsMonitorTable() {
  const body = getEl('smsMonitorBody');
  if (!body) return;

  const rows = _filteredLogs();
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-muted);">No SMS records match your filters.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((log) => {
    const failed = isFailed(log);
    const studentName = _studentMap[log.student_id] ? studentDisplay(_studentMap[log.student_id]) : '';
    const badge = failed
      ? '<span class="sms-badge failed">✗ Unsent</span>'
      : '<span class="sms-badge sent">✓ Sent</span>';
    const errorNote = failed && log.error
      ? `<div class="sms-error-note" title="${escapeHtml(log.error)}">${escapeHtml(truncate(log.error, 60))}</div>`
      : '';
    const resendBtn = failed && _smsEnabled
      ? `<button type="button" class="action-btn" onclick="smsResend('${log.id}')">↻ Resend</button>`
      : '';

    return `
      <tr>
        <td>${escapeHtml(formatDateTime(log.created_at))}</td>
        <td>
          ${studentName ? `<strong>${escapeHtml(studentName)}</strong><br />` : ''}
          <span style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(log.student_id || '—')}</span>
        </td>
        <td>${escapeHtml(log.recipient || '—')}</td>
        <td>${escapeHtml(log.receipt_number || '—')}</td>
        <td>${badge}${errorNote}</td>
        <td><span class="sms-msg-preview" title="${escapeHtml(log.message || '')}">${escapeHtml(truncate(log.message || '—', 70))}</span></td>
        <td>
          <div class="sms-row-actions">
            <button type="button" class="action-btn confirm" onclick="smsViewDetail('${log.id}')">👁 View</button>
            ${resendBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}
// ================================================================
// Details modal
// ================================================================

/** Open the SMS details modal for a given log id. */
window.smsViewDetail = function (id) {
  const log = _logs.find((l) => l.id === id);
  if (!log) return;

  const existing = getEl('smsDetailModal');
  if (existing) existing.remove();

  const studentName = _studentMap[log.student_id] ? studentDisplay(_studentMap[log.student_id]) : '';
  const nameCell = studentName
    ? `${escapeHtml(studentName)}${log.student_id ? ` <span style="color:var(--text-muted);font-size:0.75rem;">(${escapeHtml(log.student_id)})</span>` : ''}`
    : escapeHtml(log.student_id || '—');

  const modal = document.createElement('div');
  modal.id = 'smsDetailModal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:620px;max-height:90vh;overflow-y:auto;">
      <div class="modal-header">
        <h3>📨 SMS Details</h3>
        <button type="button" class="modal-close" onclick="document.getElementById('smsDetailModal').style.display='none'">✖</button>
      </div>
      <div class="modal-body" style="padding:1.25rem;">
        <div class="sms-detail-grid">
          <div class="sms-detail-item">
            <label>Status</label>
            <div>
              ${isFailed(log) ? '<span class="sms-badge failed">✗ Unsent / Failed</span>' : '<span class="sms-badge sent">✓ Sent</span>'}
              ${log.status ? ` <span style="font-size:0.72rem;color:var(--text-muted);">code: ${escapeHtml(log.status)}</span>` : ''}
            </div>
          </div>
          <div class="sms-detail-item"><label>Date &amp; Time</label><div>${escapeHtml(formatDateTime(log.created_at))}</div></div>
          <div class="sms-detail-item"><label>Recipient</label><div>${escapeHtml(log.recipient || '—')}</div></div>
          <div class="sms-detail-item"><label>Student</label><div>${nameCell}</div></div>
          <div class="sms-detail-item"><label>Receipt Number</label><div>${escapeHtml(log.receipt_number || '—')}</div></div>
          <div class="sms-detail-item"><label>Sender ID</label><div>${escapeHtml(log.sender_id || 'default')}</div></div>
        </div>

        <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:0.3rem;">Message</div>
        <div class="sms-detail-message">${escapeHtml(log.message || 'No message recorded.')}</div>

        ${isFailed(log) && log.error ? `
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#b91c1c;margin-bottom:0.3rem;">Error</div>
          <div class="sms-detail-error">${escapeHtml(log.error)}</div>
        ` : ''}

        ${log.provider_response ? `
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin:0.9rem 0 0.3rem;">Provider Response</div>
          <div class="sms-detail-message">${escapeHtml(log.provider_response)}</div>
        ` : ''}

        ${isFailed(log) && _smsEnabled ? `
          <div style="margin-top:1rem;">
            <button type="button" class="btn btn-primary" onclick="smsResend('${log.id}')">↻ Resend SMS</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

// ================================================================
// Retry a failed SMS
// ================================================================

window.smsResend = async function (id) {
  const log = _logs.find((l) => l.id === id);
  if (!log) return;
  if (!confirm('Resend this SMS to ' + (log.recipient || 'the recipient') + '?')) return;

  const schoolId = await getCurrentSchoolId();
  // Per-school SMS control: refuse to resend when the Super Admin disabled SMS.
  if (!(await isSmsEnabledForSchool(schoolId))) {
    showMessage('smsMonitorMessage', '⛔ SMS is disabled for this school by the Super Admin. Resending is not allowed until SMS is re-enabled.', 'error');
    return;
  }

  clearMessage('smsMonitorMessage');
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: log.recipient, message: log.message || '' }),
    });
    const resp = await res.json().catch(() => null);
    const success = Boolean(resp && resp.success);

    // Audit the retry attempt as a NEW row in sms_logs.
    const { data: { user } } = await supabaseClient.auth.getUser().catch(() => ({ data: { user: null } }));
    await supabaseClient.from('sms_logs').insert({
      school_id: schoolId || log.school_id || null,
      student_id: log.student_id || null,
      receipt_number: log.receipt_number || null,
      recipient: log.recipient || null,
      message: log.message || null,
      sender_id: (resp && resp.sender_id) || log.sender_id || null,
      status: (resp && resp.status) || null,
      success,
      provider_response: (resp && resp.providerRaw) || null,
      error: success ? null : ((resp && (resp.error || resp.message)) || 'Gateway error'),
      created_by: user?.id || null,
    });

    // Refresh the list so the new attempt shows immediately.
    await renderSmsMonitorDashboard();
    showMessage('smsMonitorMessage', success ? '✅ SMS resent successfully.' : '❌ Resend failed — see the new row in the list.', success ? 'success' : 'error');
    if (!success) {
      getEl('smsDetailModal')?.remove();
    }
  } catch (err) {
    console.error('[SMS Monitor] Resend error:', err.message);
    showMessage('smsMonitorMessage', '❌ Resend error: ' + err.message, 'error');
  }
};

// ================================================================
// Realtime refresh helper
// ================================================================

/** Called by js/modules/realtime.js when a new/updated sms_logs row arrives. */
window.refreshSmsMonitor = async function () {
  const page = document.getElementById('page-admin-sms-monitoring');
  if (page && page.classList.contains('active-page')) {
    const { renderSmsMonitorDashboard } = await import('./admin-sms-monitor.js');
    await renderSmsMonitorDashboard();
  }
};