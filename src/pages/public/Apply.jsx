import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Send, CheckCircle2, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath } from '../../lib/storage';
import { Button, Input, Select } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { Logo } from '../../components/Logo';
import { GENDERS, RELIGIONS } from '../../lib/constants';

const CLASS_OPTIONS = [
  'Creche',
  'Nursery 1',
  'Nursery 2',
  'KG 1',
  'KG 2',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6',
  'JHS 1',
  'JHS 2',
  'JHS 3',
];

const EMPTY = {
  school_id: '',
  first_name: '',
  middle_name: '',
  last_name: '',
  class_applying: '',
  date_of_birth: '',
  gender: 'Male',
  religion: 'Christian',
  parent_name: '',
  parent_contact: '',
  home_town: '',
  place_of_stay: '',
  previous_school: '',
};

export default function Apply() {
  const [schools, setSchools] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [photoFile, setPhotoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    supabase
      .rpc('get_public_schools')
      .then(({ data, error: rpcError }) => {
        if (rpcError) {
          return supabase
            .from('schools')
            .select('id, name, address')
            .eq('is_approved', true)
            .order('name')
            .then((fallback) => setSchools(fallback.data || []));
        }
        setSchools((data || []).map((s) => ({ id: s.id, name: s.name, location: s.address || s.location })));
      })
      .catch(() => {
        supabase
          .from('schools')
          .select('id, name, address')
          .eq('is_approved', true)
          .order('name')
          .then((fallback) => setSchools(fallback.data || []));
      });
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.school_id) {
      setError('Please select the school you are applying to.');
      return;
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First and last name are required.');
      return;
    }
    if (!form.class_applying) {
      setError('Please choose the class you are applying for.');
      return;
    }
    if (!form.date_of_birth) {
      setError('Date of birth is required.');
      return;
    }
    if (!form.parent_name.trim() || !form.parent_contact.trim()) {
      setError('Parent or guardian name and contact are required.');
      return;
    }
    setBusy(true);
    try {
      let photoPath = null;
      if (photoFile) {
        photoPath = await uploadFile(
          'applications',
          randomPath(`applications/${form.school_id}`, photoFile.name),
          photoFile
        );
      }
      const { data, error: rpcError } = await supabase.rpc('submit_admission_application', {
        p_school_id: form.school_id,
        p_first_name: form.first_name,
        p_middle_name: form.middle_name,
        p_last_name: form.last_name,
        p_class_applying: form.class_applying,
        p_date_of_birth: form.date_of_birth,
        p_gender: form.gender,
        p_religion: form.religion,
        p_parent_name: form.parent_name,
        p_parent_contact: form.parent_contact,
        p_home_town: form.home_town,
        p_place_of_stay: form.place_of_stay,
        p_previous_school: form.previous_school,
        p_photo_path: photoPath,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data || !data.success) throw new Error('The application could not be submitted.');
      setResult(data);
    } catch (err) {
      setError(err.message || 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mb-8 text-center"
      >
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blend text-white shadow-card">
          <GraduationCap className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Apply for admission
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
          Complete the application below. Your details are sent securely to the school and a Sub
          Administrator will confirm your admission.
        </p>
      </motion.div>

      {result ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center"
        >
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-card">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-emerald-900">Application submitted</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-emerald-800">
            Thank you. Your application has been received by{' '}
            {schools.find((s) => s.id === form.school_id)?.name || 'the school'}. Keep your
            tracking ID safe — the school will use it to admit you.
          </p>
          <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-5 py-3">
            <FileText className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <span className="text-sm font-mono font-bold text-emerald-900">
              {result.student_id}
            </span>
          </div>
          <p className="mt-5 text-xs text-emerald-700">
            Once admitted, use this ID to register for your student portal account.
          </p>
        </motion.div>
      ) : (
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          onSubmit={handleSubmit}
          className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-8"
        >
          {error ? (
            <Alert tone="error" className="mb-6">
              {error}
            </Alert>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Select label="School *" value={form.school_id} onChange={set('school_id')} className="sm:col-span-2">
              <option value="">Select the school...</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>

            <Input label="First name *" value={form.first_name} onChange={set('first_name')} placeholder="e.g. Ama" />
            <Input label="Middle name" value={form.middle_name} onChange={set('middle_name')} placeholder="(optional)" />
            <Input label="Last name *" value={form.last_name} onChange={set('last_name')} placeholder="e.g. Mensah" />
            <Select label="Class applying for *" value={form.class_applying} onChange={set('class_applying')}>
              <option value="">Select class...</option>
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input label="Date of birth *" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().split('T')[0]} />
            <Select label="Gender" value={form.gender} onChange={set('gender')}>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <Select label="Religion" value={form.religion} onChange={set('religion')}>
              {RELIGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Input label="Previous school" value={form.previous_school} onChange={set('previous_school')} placeholder="(optional)" className="sm:col-span-2" />
          </div>

          <div className="my-6 border-t border-slate-100" />

          <p className="mb-3 text-sm font-bold text-slate-800">Parent or Guardian</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="Parent / guardian name *" value={form.parent_name} onChange={set('parent_name')} placeholder="Full name" />
            <Input label="Mobile contact *" type="tel" value={form.parent_contact} onChange={set('parent_contact')} placeholder="e.g. 0244 000 000" />
            <Input label="Home town" value={form.home_town} onChange={set('home_town')} placeholder="(optional)" />
            <Input label="Place of stay" value={form.place_of_stay} onChange={set('place_of_stay')} placeholder="(optional)" />
          </div>

          <div className="my-6 border-t border-slate-100" />

          <p className="mb-3 text-sm font-bold text-slate-800">Student photo</p>
          <PhotoUpload value={photoFile} onChange={setPhotoFile} maxMb={1} circle />

          <div className="mt-8">
            <Button type="submit" loading={busy} size="lg" className="w-full">
              {!busy ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
              Submit application
            </Button>
            <p className="mt-3 text-center text-xs text-slate-400">
              Already have a Student ID?{' '}
              <a href="/register" className="font-semibold text-brand-600">
                Register for the student portal
              </a>
              .
            </p>
          </div>
        </motion.form>
      )}
    </div>
  );
}