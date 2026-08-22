/**
 * Forgot Password Module — SMS OTP via Nalo Solutions
 * =====================================================
 * Self-service password reset from the sign-in page.
 *
 * Flow (3 steps inside the #forgotPasswordModal):
 *   1. User enters the email/ID they use to sign in.
 *      → lookup_forgot_password_account() reveals ONLY the last 3 digits
 *        of the registered mobile number as a hint.
 *   2. User types the FULL mobile number.
 *      → request_forgot_password_otp() verifies it matches, generates a
 *        6-digit OTP (hashed in the DB), and returns it so this module
 *        can send it by SMS through /api/send-sms (Nalo gateway).
 *   3. User enters the OTP + a new password.
 *      → verify_forgot_password_otp() checks the code and sets the password.
 *
 * Students must use the parent/guardian mobile number that is on record
 * (applications.parent_contact), which is what the OTP is sent to.
 */

import supabaseClient from '../supabase-config.js';

const SMS_ENDPOINT = '/api/send-sms';

let state = { identifier: '', role: '', phoneLast3: '' };

function showMsg(text, type) {
  const el = document.getElementById('forgotPasswordMessage');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = 'block';
}

function clearMsg() {
  const el = document.getElementById('forgotPasswordMessage');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function setLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? 'Processing…' : text;
}

function fpGoStep(n) {
  ['fpStep1', 'fpStep2', 'fpStep3'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.style.display = idx === n - 1 ? 'block' : 'none';
  });
  clearMsg();
}
window.fpGoStep = fpGoStep;

window.openForgotPasswordModal = function () {
  state = { identifier: '', role: '', phoneLast3: '' };
  ['fpIdentifier', 'fpPhone', 'fpOtp', 'fpNewPassword', 'fpConfirmPassword'].forEach((id) => {
    const i = document.getElementById(id);
    if (i) i.value = '';
  });
  fpGoStep(1);
  const m = document.getElementById('forgotPasswordModal');
  if (m) m.style.display = 'flex';
  setTimeout(() => document.getElementById('fpIdentifier')?.focus(), 50);
};

window.closeForgotPasswordModal = function () {
  const m = document.getElementById('forgotPasswordModal');
  if (m) m.style.display = 'none';
};

export function setupForgotPassword() {
  const openLink = document.getElementById('forgotPasswordLink');
  if (openLink) {
    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.openForgotPasswordModal();
    });
  }

  const continueBtn = document.getElementById('fpContinueBtn');
  if (continueBtn) continueBtn.addEventListener('click', onContinue);
  document.getElementById('fpIdentifier')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onContinue();
  });

  const sendBtn = document.getElementById('fpSendOtpBtn');
  if (sendBtn) sendBtn.addEventListener('click', onSendOtp);
  document.getElementById('fpPhone')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSendOtp();
  });

  const resetBtn = document.getElementById('fpResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', onReset);
  document.getElementById('fpOtp')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onReset();
  });

  // Close when clicking the dimmed backdrop
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'forgotPasswordModal') window.closeForgotPasswordModal();
  });
}

async function onContinue() {
  const identifier = document.getElementById('fpIdentifier')?.value.trim();
  if (!identifier) { showMsg('Please enter the email or ID you use to sign in.', 'error'); return; }
  clearMsg();
  setLoading(document.getElementById('fpContinueBtn'), true, 'Checking…');
  try {
    const { data, error } = await supabaseClient.rpc('lookup_forgot_password_account', {
      p_identifier: identifier,
    });
    if (error) throw error;
    if (!data || !data.found) {
      showMsg('No account was found with that email or ID.', 'error');
      return;
    }
    if (!data.has_phone) {
      showMsg('No mobile number is on file for this account. Please contact your administrator to add one, then try again.', 'error');
      return;
    }
    state.identifier = identifier;
    state.role = data.role || '';
    state.phoneLast3 = data.phone_last3 || '';

    const hint = document.getElementById('fpPhoneLast3');
    if (hint) hint.textContent = state.phoneLast3;

    const studentNote = document.getElementById('fpStudentNote');
    if (studentNote) studentNote.style.display = state.role === 'student' ? 'block' : 'none';

    fpGoStep(2);
  } catch (err) {
    showMsg('Something went wrong: ' + err.message, 'error');
  } finally {
    setLoading(document.getElementById('fpContinueBtn'), false, 'Continue →');
  }
}

async function onSendOtp() {
  const phone = document.getElementById('fpPhone')?.value.trim();
  if (!phone) { showMsg('Please enter your full mobile number.', 'error'); return; }
  clearMsg();
  setLoading(document.getElementById('fpSendOtpBtn'), true, 'Sending code…');
  try {
    const { data, error } = await supabaseClient.rpc('request_forgot_password_otp', {
      p_identifier: state.identifier,
      p_phone: phone,
    });
    if (error) throw error;
    if (!data || !data.success) { showMsg(data?.error || 'Could not send the verification code.', 'error'); return; }

    // Deliver the OTP by SMS through the Nalo gateway.
    const smsOk = await sendOtpSms(phone, data.otp);
    if (!smsOk) {
      showMsg('The verification code could not be delivered by SMS. Please try again or contact your administrator.', 'error');
      return;
    }

    showMsg(`Verification code sent to the mobile number ending in ${data.phone_last3}. Enter it to continue.`, 'success');
    fpGoStep(3);
  } catch (err) {
    showMsg('Something went wrong: ' + err.message, 'error');
  } finally {
    setLoading(document.getElementById('fpSendOtpBtn'), false, 'Send Verification Code (SMS)');
  }
}

async function sendOtpSms(phone, otp) {
  const message = `Your password reset code is ${otp}. It expires in 10 minutes. Do not share it with anyone.`;
  try {
    const res = await fetch(SMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data && data.success);
  } catch (err) {
    console.error('[ForgotPassword] SMS send failed:', err.message);
    return false;
  }
}

async function onReset() {
  const otp = document.getElementById('fpOtp')?.value.trim();
  const pw = document.getElementById('fpNewPassword')?.value;
  const confirmPw = document.getElementById('fpConfirmPassword')?.value;
  if (!otp) { showMsg('Enter the 6-digit verification code.', 'error'); return; }
  if (!pw || pw.length < 6) { showMsg('New password must be at least 6 characters.', 'error'); return; }
  if (pw !== confirmPw) { showMsg('Passwords do not match.', 'error'); return; }
  clearMsg();
  setLoading(document.getElementById('fpResetBtn'), true, 'Resetting…');
  try {
    const { data, error } = await supabaseClient.rpc('verify_forgot_password_otp', {
      p_identifier: state.identifier,
      p_otp: otp,
      p_new_password: pw,
    });
    if (error) throw error;
    if (!data || !data.success) { showMsg(data?.error || 'Verification failed.', 'error'); return; }
    showMsg(data.message || 'Password reset successfully! You can now sign in with your new password.', 'success');
    setTimeout(() => window.closeForgotPasswordModal(), 2200);
  } catch (err) {
    showMsg('Something went wrong: ' + err.message, 'error');
  } finally {
    setLoading(document.getElementById('fpResetBtn'), false, 'Reset Password');
  }
}

