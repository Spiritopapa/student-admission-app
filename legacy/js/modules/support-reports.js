/**
 * Support Reports — Bug Reports & Suggestions
 * ============================================================
 * Lets any signed-in user submit a bug report or an app suggestion from
 * their dashboard. Reports are stored in the `support_reports` table via
 * the SECURITY DEFINER RPC `submit_support_report()` and are displayed on
 * the Super Admin dashboard for review.
 *
 * Used by: admin / teacher / accountant dashboards (report-issue-btn).
 */

import { getEl, showMessage, setLoading } from './utils.js';

let supabaseClient = null;

export function initSupportReports(supabase) {
  supabaseClient = supabase;
}

export function setupSupportReports() {
  // Open the report modal from every "Report Bug or Suggestion" button.
  document.querySelectorAll('.report-issue-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openSupportReportModal();
    });
  });

  const modal = getEl('supportReportModal');
  if (!modal) return;

  // Close via the modal card's close button + clicking the dimmed backdrop.
  getEl('supportReportForm')?.addEventListener('submit', submitSupportReport);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSupportReportModal();
  });
}

export function openSupportReportModal() {
  const modal = getEl('supportReportModal');
  if (!modal) return;
  clearSupportReportForm();
  modal.style.display = 'flex';
  setTimeout(() => getEl('supportReportType')?.focus(), 50);
}
window.openSupportReportModal = openSupportReportModal;

export function closeSupportReportModal() {
  const modal = getEl('supportReportModal');
  if (modal) modal.style.display = 'none';
}
window.closeSupportReportModal = closeSupportReportModal;

function clearSupportReportForm() {
  getEl('supportReportSubject') && (getEl('supportReportSubject').value = '');
  getEl('supportReportDetails') && (getEl('supportReportDetails').value = '');
  const msg = getEl('supportReportMessage');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  const btn = getEl('supportReportSubmitBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Submit Report'; }
}

async function submitSupportReport(e) {
  e.preventDefault();
  const btn = getEl('supportReportSubmitBtn');
  const type = getEl('supportReportType').value;
  const subject = getEl('supportReportSubject').value.trim();
  const details = getEl('supportReportDetails').value.trim();

  if (!type || !subject || !details) {
    showMessage('supportReportMessage', 'Please complete the type, subject and message fields.', 'error');
    return;
  }

  setLoading(btn, true, 'Submitting...');
  try {
    const { error } = await supabaseClient.rpc('submit_support_report', {
      p_type: type,
      p_subject: subject,
      p_message: details,
    });
    if (error) throw error;

    const kindLabel = type === 'bug' ? 'bug report' : 'suggestion';
    showMessage('supportReportMessage',
      `Thank you! Your ${kindLabel} has been sent to the Super Admin dashboard for review.`,
      'success');
    setLoading(btn, false, 'Submit Report');
    getEl('supportReportSubject').value = '';
    getEl('supportReportDetails').value = '';
    setTimeout(closeSupportReportModal, 2200);
  } catch (err) {
    showMessage('supportReportMessage', 'Failed to submit: ' + err.message, 'error');
    setLoading(btn, false, 'Submit Report');
  }
}