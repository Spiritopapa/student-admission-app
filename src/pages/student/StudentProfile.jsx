import { useState } from 'react';
import { User, KeyRound, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useStudentApplication } from '../../hooks/useSchool';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath } from '../../lib/storage';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { buildStudentName, formatDate } from '../../lib/format';
import { GENDERS, RELIGIONS } from '../../lib/constants';

export default function StudentProfile() {
  const { user } = useAuth();
  const toast = useToast();
  const { application, loading, reload } = useStudentApplication();
  const [form, setForm] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  if (!form && application) {
    setForm({
      parent_name: application.parent_name || '',
      parent_contact: application.parent_contact || '',
      home_town: application.home_town || '',
      place_of_stay: application.place_of_stay || '',
      gender: application.gender || 'Male',
      religion: application.religion || 'Christian',
      photo_url: application.student_photo_url || '',
    });
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const name = application ? buildStudentName(application.first_name, application.middle_name, application.last_name) : '';

  const saveProfile = async () => {
    setError('');
    if (!form?.parent_name.trim() || !form?.parent_contact.trim()) {
      setError('Parent name and contact are required.');
      return;
    }
    setSaving(true);
    try {
      let photoUrlValue = application.student_photo_url;
      if (photoFile) {
        const stored = await uploadFile(
          'student-photos',
          randomPath(`students/${application.student_id}`, photoFile.name),
          photoFile
        );
        photoUrlValue = stored;
      }
      const { error: updateError } = await supabase
        .from('applications')
        .update({
          parent_name: form.parent_name.trim(),
          parent_contact: form.parent_contact.trim(),
          home_town: form.home_town || null,
          place_of_stay: form.place_of_stay || null,
          gender: form.gender,
          religion: form.religion,
          student_photo_url: photoUrlValue,
        })
        .eq('student_id', application.student_id);
      if (updateError) throw new Error(updateError.message);
      toast.success('Profile updated', 'Your student details have been saved.');
      await reload();
      setForm((f) => ({ ...f, photo_url: photoUrlValue }));
      setPhotoFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPasswordError('');
    if (!oldPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setChanging(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw new Error(authError.message);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed', 'Use your new password next time you sign in.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setChanging(false);
    }
  };

  if (loading) return <Spinner label="Loading profile..." />;
  if (!application) return <EmptyState title="No student record" />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My Profile" subtitle="Student record and account settings." icon={User} />

      <Card className="p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <PhotoUpload
            value={form?.photo_url || application.student_photo_url}
            onChange={setPhotoFile}
            maxMb={1}
            circle
          />
          <div className="text-center sm:text-left">
            <h2 className="text-lg font-bold text-slate-900">{name}</h2>
            <p className="font-mono text-xs text-slate-400">{application.student_id}</p>
            <p className="text-xs text-slate-400">
              {application.class_applying} · Born {formatDate(application.date_of_birth)}
            </p>
          </div>
        </div>

        {error ? (
          <Alert tone="error" className="mt-5">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Input label="Parent / guardian name *" value={form?.parent_name || ''} onChange={set('parent_name')} />
          <Input label="Parent / guardian contact *" type="tel" value={form?.parent_contact || ''} onChange={set('parent_contact')} />
          <Input label="Home town" value={form?.home_town || ''} onChange={set('home_town')} />
          <Input label="Place of stay" value={form?.place_of_stay || ''} onChange={set('place_of_stay')} />
          <Select label="Gender" value={form?.gender || 'Male'} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label="Religion" value={form?.religion || 'Christian'} onChange={set('religion')}>
            {RELIGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>

        <Button onClick={saveProfile} loading={saving} className="mt-6 w-full sm:w-auto">
          <Save className="h-4 w-4" aria-hidden="true" />
          Save changes
        </Button>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-bold text-slate-800">Change password</h2>
        {passwordError ? (
          <Alert tone="error" className="mt-4">
            {passwordError}
          </Alert>
        ) : null}
        <div className="mt-5 space-y-5">
          <Input
            label="Current password"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete="new-password"
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <Button onClick={changePassword} loading={changing} variant="teal" className="mt-5">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Update password
        </Button>
      </Card>
    </div>
  );
}