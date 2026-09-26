import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, Smartphone, ShieldCheck, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Input } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { Logo } from '../../components/Logo';

const SMS_ENDPOINT = '/api/send-sms';

function normalizeGhanaPhone(raw) {
  if (raw == null) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('233')) return digits.length === 12 ? digits : null;
  if (digits.startsWith('0') && digits.length === 10) return '233' + digits.slice(1);
  return null;
}

async function sendOtpSms(phone, otp, assistancePhone) {
  const selfNumber =
    phone && assistancePhone && normalizeGhanaPhone(assistancePhone) === normalizeGhanaPhone(phone);
  const message =
    `Your password reset code is ${otp}. It expires in 10 minutes. Do not share it with anyone.` +
    (selfNumber ? '' : ` For help, call ${assistancePhone || 'your school administrator'}.`);
  try {
    const res = await fetch(SMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data && data.success);
  } catch (err) {
    return false;
  }
}

export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [phoneLast3, setPhoneLast3] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState(false);

  const onContinue = async () => {
    setError('');
    if (!identifier.trim()) {
      setError('Enter the email or ID you use to sign in.');
      return;
    }
    setBusy('check');
    try {
      const { data, error: rpcError } = await supabase.rpc('lookup_forgot_password_account', {
        p_identifier: identifier.trim(),
      });
      if (rpcError) throw rpcError;
      if (!data || !data.found) {
        setError('No account was found with that email or ID.');
        return;
      }
      if (!data.has_phone) {
        setError('No mobile number is on file for this account. Please contact your administrator.');
        return;
      }
      setRole(data.role || '');
      setPhoneLast3(data.phone_last3 || '');
      setStep(2);
    } catch (err) {
      setError('Something went wrong: ' + err.message);
    } finally {
      setBusy('');
    }
  };

  const onSendOtp = async () => {
    setError('');
    if (!phone.trim()) {
      setError('Enter your full mobile number.');
      return;
    }
    setBusy('otp');
    try {
      const { data, error: rpcError } = await supabase.rpc('request_forgot_password_otp', {
        p_identifier: identifier.trim(),
        p_phone: phone.trim(),
      });
      if (rpcError) throw rpcError;
      if (!data || !data.success) {
        setError(
          data?.otp_limit_exceeded
            ? data.error ||
                'You have used all 3 password-reset codes allowed in 30 days. Please contact the developer for a password reset.'
            : data?.error || 'Could not send the verification code.'
        );
        return;
      }
      const smsOk = await sendOtpSms(phone.trim(), data.otp, data.assistance_phone);
      if (!smsOk) {
        setError('The verification code could not be delivered by SMS. Please try again or contact your administrator.');
        return;
      }
      setNotice(
        `Verification code sent to the mobile number ending in ${data.phone_last3}. Enter it to continue.${
          data.otps_remaining === 0
            ? ' You have now used all 3 password-reset codes allowed in 30 days.'
            : ''
        }`
      );
      setStep(3);
    } catch (err) {
      setError('Something went wrong: ' + err.message);
    } finally {
      setBusy('');
    }
  };

  const onReset = async () => {
    setError('');
    if (!otp.trim()) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy('reset');
    try {
      const { data, error: rpcError } = await supabase.rpc('verify_forgot_password_otp', {
        p_identifier: identifier.trim(),
        p_otp: otp.trim(),
        p_new_password: newPassword,
      });
      if (rpcError) throw rpcError;
      if (!data || !data.success) {
        setError(data?.error || 'Verification failed.');
        return;
      }
      setDone(true);
    } catch (err) {
      setError('Something went wrong: ' + err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-14">
      <Logo size="md" />

      {done ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-8 w-full rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center"
        >
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-card">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-emerald-900">Password reset complete</h2>
          <p className="mt-2 text-sm text-emerald-800">
            You can now sign in with your new password.
          </p>
          <Link to="/login" className="btn-primary mt-6 w-full">
            Go to sign in
          </Link>
        </motion.div>
      ) : (
        <div className="mt-8 w-full rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-8">
          <div className="text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blend text-white shadow-card">
              <KeyRound className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              Reset your password
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              We will send a one-time verification code to your mobile number.
            </p>
          </div>

          {error ? (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          ) : null}
          {notice ? (
            <Alert tone="success" className="mt-5">
              {notice}
            </Alert>
          ) : null}

          <div className="mt-6">
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div
                  key="s1"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="space-y-4"
                >
                  <Input
                    label="Email or Registration ID"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g. you@school.com or TCH-SIN-0001"
                  />
                  <Button onClick={onContinue} loading={busy === 'check'} className="w-full">
                    Continue
                  </Button>
                  {role === 'student' ? (
                    <p className="text-xs text-slate-400">
                      Students must use the parent or guardian mobile number on record.
                    </p>
                  ) : null}
                </motion.div>
              ) : null}

              {step === 2 ? (
                <motion.div
                  key="s2"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="space-y-4"
                >
                  <Alert tone="info">
                    Account found. Your mobile number ends in <strong>{phoneLast3}</strong>.
                  </Alert>
                  <Input
                    label="Full Mobile Number *"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 0244 000 000"
                  />
                  <Button onClick={onSendOtp} loading={busy === 'otp'} className="w-full">
                    <Smartphone className="h-4 w-4" aria-hidden="true" />
                    Send Verification Code (SMS)
                  </Button>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-700"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </button>
                </motion.div>
              ) : null}

              {step === 3 ? (
                <motion.div
                  key="s3"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="space-y-4"
                >
                  <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                    <p className="text-xs leading-relaxed text-brand-800">
                      Enter the 6-digit code from the SMS. It expires in 10 minutes and can be used
                      once.
                    </p>
                  </div>
                  <Input
                    label="Verification Code *"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                  />
                  <Input
                    label="New Password *"
                    type="password"
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                  />
                  <Input
                    label="Confirm New Password *"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                  />
                  <Button onClick={onReset} loading={busy === 'reset'} className="w-full">
                    Reset Password
                  </Button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-700"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}