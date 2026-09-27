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

export async function submitSupportReport({ type, subject, details }) {
  const { error } = await supabase.rpc('submit_support_report', {
    p_type: type,
    p_subject: subject,
    p_message: details,
  });
  if (error) throw new Error(error.message);
  return true;
}