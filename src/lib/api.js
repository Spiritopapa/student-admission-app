import { supabase } from './supabase';

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
  try {
    await supabase.from('sms_logs').insert([entry]);
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