import { useState } from 'react';
import { motion } from 'framer-motion';
import { School, Send, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Input, Select, Textarea } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { Logo } from '../../components/Logo';

export default function SchoolOnboarding() {
  const [form, setForm] = useState({
    school_name: '',
    admin_name: '',
    admin_email: '',
    admin_phone: '',
    school_type: 'private',
    location: '',
    population: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.school_name.trim() || !form.admin_name.trim() || !form.admin_email.trim()) {
      setError('School name, administrator name and email are required.');
      return;
    }
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_school_application', {
        p_school_name: form.school_name,
        p_admin_name: form.admin_name,
        p_admin_email: form.admin_email,
        p_admin_phone: form.admin_phone,
        p_school_type: form.school_type,
        p_location: form.location,
        p_population: form.population ? Number(form.population) : null,
        p_message: form.message,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data) throw new Error('Your application could not be submitted.');
      setDone(true);
    } catch (err) {
      setError(err.message || 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blend text-white shadow-card">
          <School className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Bring your school on board
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
          Tell us about your school and our team will set you up on SchoolRunner. You will receive
          your School ID once approved.
        </p>
      </motion.div>

      {done ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center"
        >
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-card">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-emerald-900">Application received</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-emerald-800">
            Thank you. The Super Administrator will review your application and issue your School
            Registration ID. We will contact {form.admin_name || 'you'} at{' '}
            <strong>{form.admin_email}</strong>.
          </p>
        </motion.div>
      ) : (
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onSubmit={handleSubmit}
          className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-8"
        >
          {error ? (
            <Alert tone="error" className="mb-6">
              {error}
            </Alert>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="School name *" value={form.school_name} onChange={set('school_name')} placeholder="e.g. Sunshine International School" className="sm:col-span-2" />
            <Input label="Administrator name *" value={form.admin_name} onChange={set('admin_name')} placeholder="Full name" />
            <Input label="Administrator email *" type="email" value={form.admin_email} onChange={set('admin_email')} placeholder="admin@school.edu" />
            <Input label="Administrator phone" type="tel" value={form.admin_phone} onChange={set('admin_phone')} placeholder="e.g. 0244 000 000" />
            <Select label="School type" value={form.school_type} onChange={set('school_type')}>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </Select>
            <Input label="Location" value={form.location} onChange={set('location')} placeholder="Town or district" />
            <Input label="Student population" type="number" min="0" value={form.population} onChange={set('population')} placeholder="e.g. 450" />
            <Textarea label="Message" value={form.message} onChange={set('message')} placeholder="Anything else we should know?" className="sm:col-span-2" />
          </div>

          <div className="mt-8">
            <Button type="submit" loading={busy} size="lg" className="w-full">
              {!busy ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
              Submit school application
            </Button>
            <p className="mt-4 text-center text-xs text-slate-400">
              Already have a School ID?{' '}
              <a href="/register" className="font-semibold text-brand-600">
                Register your school account
              </a>
              .
            </p>
          </div>
        </motion.form>
      )}
    </div>
  );
}