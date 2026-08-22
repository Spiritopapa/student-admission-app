/**
 * Nalo Solutions SMS Gateway — Client Module
 * ==========================================
 * Sends an SMS to a student's parent/guardian the moment a fee payment is
 * recorded. The message is actually delivered by the Vercel serverless
 * function at /api/send-sms, which holds the Nalo credentials server-side.
 *
 * This module:
 *  - normalizes Ghana phone numbers to 233XXXXXXXXX
 *  - builds a short receipt-confirmation message
 *  - fire-and-forget — NEVER blocks or fails the payment flow
 *  - records every attempt in the `sms_logs` table (audit / duplicate guard)
 */

import supabaseClient from '../supabase-config.js';
import { formatCurrency, getCurrentSchoolId } from './utils.js';

const SMS_ENDPOINT = '/api/send-sms';

/**
 * Normalize a Ghana phone number to international 233XXXXXXXXX form.
 * Accepts "0244...", "+23324...", "23324...", dashes/spaces stripped.
 * Returns null when the number does not look like a Ghana number.
 */
export function normalizeGhanaPhone(raw) {
  if (raw == null) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('233')) return digits.length === 12 ? digits : null;
  if (digits.startsWith('0') && digits.length === 10) return '233' + digits.slice(1);
  return null;
}

/**
 * Build the SMS that goes to the parent when a fee payment is recorded.
 * Kept compact (~160 chars max) so it stays a single SMS credit whenever
 * possible and skips the balance line once the term is fully paid.
 */
export function buildPaymentSmsMessage(info) {
  const school = String(info.schoolName || 'School').trim().slice(0, 45);
  const student = info.studentName || info.studentId || 'student';
  const termYear = `${info.term || ''} Term ${info.academicYear || ''}`.trim();

  let msg = `${school}: Paid GH\u20b5${formatCurrency(info.amount)} for ${student}${termYear ? ' (' + termYear + ')' : ''}.`;
  if (info.receiptNumber) msg += ` Receipt: ${info.receiptNumber}.`;
  if (Number(info.remainingBalance) > 0) {
    msg += ` Balance: GH\u20b5${formatCurrency(info.remainingBalance)}.`;
  }
  msg += ' Thank you.';
  return msg;
}

/**
 * Insert an audit row into sms_logs (best-effort, never throws).
 */
async function logSms(info) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser().catch(() => ({ data: { user: null } }));
    const schoolId = info.schoolId || (await getCurrentSchoolId());
    await supabaseClient.from('sms_logs').insert({
      school_id: schoolId || null,
      student_id: info.studentId || null,
      receipt_number: info.receiptNumber || null,
      recipient: info.recipient || null,
      message: info.message || null,
      sender_id: info.senderId || null,
      status: info.status || null,
      success: Boolean(info.success),
      provider_response: info.providerRaw || null,
      error: info.error || null,
      created_by: user?.id || null,
    });
  } catch (err) {
    console.warn('[SMS] Failed to write sms_logs row:', err.message);
  }
}

/**
 * Send the "fees received" SMS to the parent/guardian right after a payment.
 *
 * @param {object} info
 * @param {string} info.studentId   student ID the payment was recorded for
 * @param {string} info.receiptNumber  receipt number returned by process_fee_payment
 * @param {number} info.amount      amount paid (GH\u20b5)
 * @param {string} info.term        "First" | "Second" | "Third"
 * @param {string} info.academicYear  e.g. "2025/2026"
 * @param {string} info.method      payment method (optional, informational)
 * @param {string} info.studentName full student name from the RPC payload
 * @param {string} info.className   class (optional)
 * @param {string} info.schoolName  school name from the RPC payload
 * @param {number} info.remainingBalance outstanding balance after this payment
 *
 * @returns {Promise<object|null>} gateway response, or null when skipped/failed.
 */
export async function sendFeePaymentSms(info) {
  try {
    if (!info || !info.studentId || !info.receiptNumber || !info.amount) return null;

    // Duplicate guard: only one successful SMS per receipt.
    const { data: existing } = await supabaseClient
      .from('sms_logs')
      .select('id')
      .eq('receipt_number', info.receiptNumber)
      .eq('success', true)
      .limit(1);
    if (existing && existing.length > 0) return null;

    // Load the parent contact from the student's application record.
    const { data: app, error: appErr } = await supabaseClient
      .from('applications')
      .select('parent_name, parent_contact')
      .eq('student_id', info.studentId)
      .maybeSingle();
    if (appErr) throw appErr;

    const phone = normalizeGhanaPhone(app?.parent_contact);
    if (!phone) {
      console.warn('[SMS] No valid parent phone for', info.studentId);
      await logSms({
        ...info,
        recipient: app?.parent_contact || '',
        success: false,
        error: 'No valid parent phone number on record',
      });
      return null;
    }

    const message = buildPaymentSmsMessage({ ...info, parentName: app?.parent_name });

    // Send through the serverless gateway (must exist on the deployed site).
    let resp = null;
    let sendError = null;
    try {
      const res = await fetch(SMS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message }),
      });
      resp = await res.json().catch(() => null);
      if (!res.ok || !resp?.success) {
        sendError = (resp && (resp.error || resp.message)) || 'Gateway returned HTTP ' + res.status;
      }
    } catch (err) {
      sendError = err.message;
    }

    // Audit the outcome.
    await logSms({
      ...info,
      recipient: phone,
      message,
      success: Boolean(resp && resp.success),
      status: resp && resp.status ? resp.status : null,
      providerRaw: resp && resp.providerRaw ? resp.providerRaw : null,
      error: sendError,
    });

    if (sendError) console.warn('[SMS] Fee payment SMS failed:', sendError);
    return resp;
  } catch (err) {
    console.error('[SMS] Fee payment SMS unexpected error:', err.message);
    return null;
  }
}