import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button, Input } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';

export function SuccessPanel({ title, message, hint }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-card">
        <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-bold text-emerald-900">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-emerald-800">{message}</p>
      {hint ? <p className="mt-3 max-w-sm text-xs text-emerald-700">{hint}</p> : null}
      <Link to="/login" className="btn-primary mt-6 w-full max-w-xs">
        Go to sign in
      </Link>
    </motion.div>
  );
}

function FormShell({ title, subtitle, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-8"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blend text-white shadow-card">
        <UserPlus className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </motion.div>
  );
}

function useRegisterState(registerFn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const submit = async (payload, successTitle, successMessage) => {
    setError('');
    setBusy(true);
    try {
      const result = await registerFn(payload);
      setSuccess({
        title: successTitle,
        message: successMessage,
        hint: 'You can now sign in with the credentials you registered.',
        result,
      });
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, success, submit };
}

export function StudentForm() {
  const { registerStudent } = useAuth();
  const { busy, error, success, submit } = useRegisterState(registerStudent);
  const [form, setForm] = useState({ studentID: '', password: '', phone: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (success) {
    return (
      <SuccessPanel
        title="Student account created"
        message={`Account for ${success.result.id} is ready.`}
      />
    );
  }

  return (
    <FormShell
      title="Register as a Student"
      subtitle="Use the Student ID provided by your Sub Administrator after admission."
    >
      {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(
            form,
            'Student account created',
            'Your student portal account is ready to use.'
          );
        }}
        className="space-y-4"
      >
        <Input label="Student ID *" value={form.studentID} onChange={set('studentID')} placeholder="e.g. STU-ABC12" />
        <Input label="Mobile Number *" type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0244 000 000" />
        <Input label="Password *" type="password" minLength={6} value={form.password} onChange={set('password')} placeholder="Minimum 6 characters" />
        <Button type="submit" loading={busy} className="w-full">
          Create student account
        </Button>
      </form>
    </FormShell>
  );
}

export function ParentForm() {
  const { registerParent } = useAuth();
  const { busy, error, success, submit } = useRegisterState(registerParent);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', wardID: '', password: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (success) {
    return (
      <SuccessPanel
        title="Parent account created"
        message="You can now sign in to follow your ward's progress."
      />
    );
  }

  return (
    <FormShell
      title="Register as a Parent"
      subtitle="Link your account to your child using their Student ID."
    >
      {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(form, 'Parent account created', 'Your parent portal is ready.');
        }}
        className="space-y-4"
      >
        <Input label="Full Name *" value={form.fullName} onChange={set('fullName')} placeholder="Your full name" />
        <Input label="Email *" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
        <Input label="Mobile Number *" type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0244 000 000" />
        <Input label="Ward's Student ID *" value={form.wardID} onChange={set('wardID')} placeholder="e.g. STU-ABC12" />
        <Input label="Password *" type="password" minLength={6} value={form.password} onChange={set('password')} placeholder="Minimum 6 characters" />
        <Button type="submit" loading={busy} className="w-full">
          Create parent account
        </Button>
      </form>
    </FormShell>
  );
}

function RegistrationIdForm({ roleLabel, register, idPlaceholder, helper }) {
  const { busy, error, success, submit } = useRegisterState(register);
  const [form, setForm] = useState({ regId: '', password: '', phone: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (success) {
    return (
      <SuccessPanel
        title={`${roleLabel} account created`}
        message={`Registration ${success.result.id} is now linked to a portal account.`}
      />
    );
  }

  return (
    <FormShell title={`Register as a ${roleLabel}`} subtitle={helper}>
      {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(form, `${roleLabel} account created`, 'You can now sign in with your registration ID.');
        }}
        className="space-y-4"
      >
        <Input label={`${roleLabel} Registration ID *`} value={form.regId} onChange={set('regId')} placeholder={idPlaceholder} />
        <Input label="Mobile Number *" type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0244 000 000" />
        <Input label="Password *" type="password" minLength={6} value={form.password} onChange={set('password')} placeholder="Minimum 6 characters" />
        <Button type="submit" loading={busy} className="w-full">
          Create {roleLabel.toLowerCase()} account
        </Button>
      </form>
    </FormShell>
  );
}

export function SubAdminForm() {
  const { registerSubAdmin } = useAuth();
  return (
    <RegistrationIdForm
      roleLabel="Sub Admin"
      register={registerSubAdmin}
      idPlaceholder="e.g. SA-0001"
      helper="Use the Sub Admin ID generated by your School Administrator."
    />
  );
}

export function TeacherForm() {
  const { registerTeacher } = useAuth();
  return (
    <RegistrationIdForm
      roleLabel="Teacher"
      register={registerTeacher}
      idPlaceholder="e.g. TCH-SIN-0001"
      helper="Use the Teacher ID provided by your Sub Administrator."
    />
  );
}

export function AccountantForm() {
  const { registerAccountant } = useAuth();
  return (
    <RegistrationIdForm
      roleLabel="Accountant"
      register={registerAccountant}
      idPlaceholder="e.g. ACC-SIN-0001"
      helper="Use the Accountant ID provided by your Sub Administrator."
    />
  );
}

export function SuperAdminForm() {
  const { registerSuperAdmin } = useAuth();
  const { busy, error, success, submit } = useRegisterState(registerSuperAdmin);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (success) {
    return (
      <SuccessPanel
        title="Super Admin account created"
        message="You can now sign in with your email and password."
      />
    );
  }

  return (
    <FormShell
      title="Register as a Super Admin"
      subtitle="Creates the platform owner account. Only one can exist."
    >
      {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(form, 'Super Admin account created', 'The Super Administrator account is ready.');
        }}
        className="space-y-4"
      >
        <Input label="Full Name *" value={form.fullName} onChange={set('fullName')} placeholder="Your full name" />
        <Input label="Email *" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
        <Input label="Mobile Number *" type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0244 000 000" />
        <Input label="Password *" type="password" minLength={6} value={form.password} onChange={set('password')} placeholder="Minimum 6 characters" />
        <Button type="submit" loading={busy} className="w-full">
          Create super admin account
        </Button>
      </form>
    </FormShell>
  );
}

const SCHOOL_STEPS = [
  { n: 1, label: 'School ID' },
  { n: 2, label: 'Confirm' },
  { n: 3, label: 'Contact' },
  { n: 4, label: 'Password' },
];

export function SchoolWizard() {
  const { registerSchool } = useAuth();
  const { busy, error, success, submit } = useRegisterState(registerSchool);
  const [stage, setStage] = useState(1);
  const [regId, setRegId] = useState('');
  const [schoolInfo, setSchoolInfo] = useState(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  if (success) {
    return (
      <SuccessPanel
        title="School account created"
        message={`${schoolInfo?.name || schoolInfo?.school_name || ''} is now linked to a portal account for ${regId}.`}
      />
    );
  }

  const verifyId = async () => {
    setVerifyError('');
    if (!regId.trim()) {
      setVerifyError('Enter the School ID provided by your Super Administrator.');
      return;
    }
    setVerifying(true);
    try {
      const { data } = await supabase.rpc('get_school_registration_info', {
        p_registration_id: regId.trim().toUpperCase(),
      });
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) {
        setVerifyError('No school found with that ID. Please check with your Super Administrator.');
        return;
      }
      setSchoolInfo(row);
      setStage(2);
    } catch (err) {
      setVerifyError('Could not verify the School ID. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const submitAll = () => {
    if (password.length < 6) return;
    submit(
      { regId, password, phone, photoFile },
      'School account created',
      'The School Administrator account is ready to use.'
    );
  };

  return (
    <FormShell
      title="Register your School"
      subtitle="Complete the wizard to activate your school's portal account."
    >
      {error || verifyError ? (
        <Alert tone="error" className="mb-4">
          {error || verifyError}
        </Alert>
      ) : null}

      <ol className="mb-6 flex items-center gap-1">
        {SCHOOL_STEPS.map((step) => {
          const isDone = stage > step.n;
          const isActive = stage === step.n;
          return (
            <li key={step.n} className="flex flex-1 items-center gap-1">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isDone
                    ? 'bg-teal-500 text-white'
                    : isActive
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : step.n}
              </span>
              <span
                className={`hidden text-[11px] font-semibold sm:block ${isActive ? 'text-brand-700' : 'text-slate-400'}`}
              >
                {step.label}
              </span>
              {step.n < SCHOOL_STEPS.length ? <span className="h-px flex-1 bg-slate-200" /> : null}
            </li>
          );
        })}
      </ol>

      {stage === 1 ? (
        <div className="space-y-4">
          <Input
            label="School Registration ID *"
            value={regId}
            onChange={(e) => setRegId(e.target.value)}
            placeholder="e.g. SCH-SIS-0001"
            hint="Provided by your platform Super Administrator."
          />
          <Button type="button" onClick={verifyId} loading={verifying} className="w-full">
            Verify School ID
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {stage === 2 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
              {schoolInfo?.registration_id || regId}
            </p>
            <p className="mt-1 text-lg font-bold text-teal-900">
              {schoolInfo?.name || schoolInfo?.school_name || 'School'}
            </p>
            {schoolInfo?.location ? (
              <p className="mt-1 text-sm text-teal-800">{schoolInfo.location}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStage(1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button onClick={() => setStage(3)}>
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 3 ? (
        <div className="space-y-4">
          <PhotoUpload value={photoFile} onChange={setPhotoFile} maxMb={1} circle />
          <Input
            label="Administrator Mobile Number *"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0244 000 000"
            hint="Used for SMS notifications and password recovery."
          />
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStage(2)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button onClick={() => setStage(4)}>
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 4 ? (
        <div className="space-y-4">
          <Input
            label="Password *"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
          />
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStage(3)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button onClick={submitAll} loading={busy}>
              Create School Account
            </Button>
          </div>
        </div>
      ) : null}
    </FormShell>
  );
}