import { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, publicUrl } from '../../lib/storage';
import { TERMS, TERM_LABELS } from '../../lib/constants';

export default function AdminSettings() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [form, setForm] = useState({ school_name: '', academic_year: '', current_term: 'First' });
  const [logoFile, setLogoFile] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    supabase
      .from('school_settings')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            school_name: data.school_name || '',
            academic_year: data.academic_year || '2025/2026',
            current_term: data.current_term || 'First',
          });
          setLogoUrl(data.logo_url || '');
        }
        setLoading(false);
      });
  }, [schoolId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setError('');
    if (!form.school_name.trim()) {
      setError('School name is required.');
      return;
    }
    setBusy(true);
    try {
      let logoUrlValue = logoUrl;
      if (logoFile) {
        const stored = await uploadFile('school-logos', randomPath(`logo_${schoolId}`, logoFile.name), logoFile);
        logoUrlValue = stored;
      }
      await supabase.from('school_settings').upsert({
        school_id: schoolId,
        school_name: form.school_name.trim(),
        academic_year: form.academic_year.trim(),
        current_term: form.current_term,
        logo_url: logoUrlValue,
      });
      toast.success('Settings saved', 'Your school settings were updated.');
      setLogoUrl(logoUrlValue);
      setLogoFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setError('');
    if (!password || password.length < 6) {
      setError('New school password must be at least 6 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw new Error(authError.message);
      setPassword('');
      toast.success('Password changed', 'Your administrator password was updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) return <Spinner label="Loading settings..." />;
  if (!schoolId) return <Spinner label="Loading school..." />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="School Settings" subtitle="School identity, academic calendar and account security." icon={Settings} />

      <Card className="p-6">
        <h2 className="text-base font-bold text-slate-800">School identity</h2>
        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <div className="mt-5">
          <PhotoUpload
            value={logoUrl ? publicUrl('school-logos', logoUrl.split('/').pop()) || logoUrl : null}
            onChange={setLogoFile}
            maxMb={1}
            circle
          />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input label="School name" value={form.school_name} onChange={set('school_name')} />
          <Input label="Academic year" value={form.academic_year} onChange={set('academic_year')} />
          <Select label="Current term" value={form.current_term} onChange={set('current_term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {TERM_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={save} loading={busy} className="mt-5">
          <Save className="h-4 w-4" aria-hidden="true" />
          Save settings
        </Button>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-bold text-slate-800">Administrator password</h2>
        <p className="mt-1 text-sm text-slate-500">Change the password you use to sign in to this account.</p>
        <div className="mt-4 max-w-md">
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
          />
        </div>
        <Button onClick={changePassword} loading={savingPassword} variant="teal" className="mt-4">
          Update password
        </Button>
      </Card>
    </div>
  );
}