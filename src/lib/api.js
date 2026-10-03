import { supabase } from './supabase';

/**
 * Fetch a school's public contact details (display name + phone) for SMS
 * branding. The phone is the number captured at registration/onboarding and
 * is used as the "call us" line on parent-facing messages.
 */
export async function fetchSchoolContact(schoolId) {
  if (!schoolId) return { name: '', phone: '' };
  try {
    const { data } = await supabase
      .from('schools')
      .select('name, phone')
      .eq('id', schoolId)
      .maybeSingle();
    return { name: data?.name || '', phone: data?.phone || '' };
  } catch (err) {
    return { name: '', phone: '' };
  }
}

export async function sendStudentPaymentSms({ schoolId, studentId, receiptNumber, phone, message }) {
  if (!phone) return { success: false, skipped: true };
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, sender_id: undefined }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      await logSms({
        schoolId,
        studentId,
        receiptNumber,
        recipient: phone,
        message,
        success: true,
        status: data.status,
        providerResponse: data.providerRaw,
      });
      return { success: true };
    }
    await logSms({
      schoolId,
      studentId,
      receiptNumber,
      recipient: phone,
      message,
      success: false,
      status: data.status,
      error: data.error,
    });
    return { success: false, error: data.error };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function logSms(entry) {
  // Map every caller convention (camelCase and snake_case) onto the actual
  // sms_logs columns. PostgREST rejects unknown/aliased keys, and before this
  // normalisation fee-payment / reminder logs were silently dropped, leaving
  // the SMS Monitor with no rows to fetch.
  const row = {
    school_id: entry.school_id ?? entry.schoolId ?? null,
    student_id: entry.student_id ?? entry.studentId ?? null,
    receipt_number: entry.receipt_number ?? entry.receiptNumber ?? null,
    recipient: entry.recipient ?? null,
    message: entry.message ?? null,
    sender_id: entry.sender_id ?? entry.senderId ?? null,
    status: entry.status ?? null,
    success: Boolean(entry.success),
    provider_response: entry.provider_response ?? entry.providerResponse ?? entry.providerRaw ?? null,
    error: entry.error ?? null,
    created_by: entry.created_by ?? entry.createdBy ?? null,
  };
  try {
    const { error } = await supabase.from('sms_logs').insert([row]);
    if (error) console.warn('SMS log insert failed:', error.message);
  } catch (err) {
    console.warn('SMS log insert failed:', err.message);
  }
}

/**
 * Sends an arbitrary SMS (e.g. debtor reminders) through /api/send-sms and
 * records the attempt in sms_logs. Mirrors the legacy sms-gateway send path,
 * including the local +233 normalization used by Ghanaian phone numbers.
 */
export function normalizeGhanaPhone(phone) {
  const p = String(phone || '').replace(/[\s()-]/g, '');
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('2')) return `233${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('233')) return digits;
  return digits;
}

export async function sendPlainSms({ schoolId, studentId = null, receiptNumber = null, phone, message }) {
  const normalized = normalizeGhanaPhone(phone);
  if (!normalized) return { ok: false, skipped: true, error: 'No valid phone number' };
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalized, message }),
    });
    const data = await res.json().catch(() => null);
    const success = Boolean(res.ok && data && data.success);
    await logSms({
      schoolId,
      studentId,
      receiptNumber,
      recipient: normalized,
      message,
      success,
      status: data?.status || null,
      sender_id: data?.sender_id || null,
      provider_response: data?.providerRaw || null,
      error: success ? null : (data?.error || data?.message || 'Gateway error'),
    });
    return { ok: success, error: success ? null : (data?.error || data?.message || 'Gateway error') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function submitSupportReport({ type, subject, details }) {
  const { error } = await supabase.rpc('submit_support_report', {
    p_type: type,
    p_subject: subject,
    p_message: details,
  });
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Outstanding school-fee balance for a student AFTER a payment processed via
 * `process_fee_payment`. That RPC returns the paid term's remaining balance
 * (`remaining_balance`); other terms are untouched by the payment, so their
 * pre-payment balances are added on top. Used to include the balance in the
 * fee-payment SMS sent to the parent.
 *
 * @param {object} options
 * @param {object} options.data - the RPC result (uses remaining_balance)
 * @param {Array}  options.feeRecords - the student's `fees` rows
 * @param {string} options.year - academic year that was paid (e.g. "2025/2026")
 * @param {string} options.term - term that was paid ("First" | "Second" | "Third")
 * @returns {number} the student's total remaining balance (never negative)
 */
export function outstandingBalanceAfterPayment({ data, feeRecords = [], year, term }) {
  const paidTermBalance = Math.max(Number(data?.remaining_balance) || 0, 0);
  const otherTerms = (feeRecords || [])
    .filter((f) => !(f.academic_year === year && f.term === term))
    .reduce((sum, f) => sum + Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0), 0);
  return paidTermBalance + otherTerms;
}