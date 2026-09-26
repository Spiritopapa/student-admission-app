import { useState } from 'react';
import { User, KeyRound, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, resolveFileUrl } from '../../lib/storage';
import { Button, Input, Card, PageHeader } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { ROLE_LABELS } from '../../lib/constants';

export default function ProfilePage() {
  const { profile, user, updateProfile } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(
    profile?.photo_url ? resolveFileUrl(profile.photo_url) : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const saveProfile = async () => {
    setError('');
    if (!fullName.trim()) {
      setError('Your name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      let photoUrlValue = profile?.photo_url || null;
      if (photoFile) {
        const stored = await uploadFile(
          'student-photos',
          randomPath(`staff/${user.id}`, photoFile.name),
          photoFile
        );
        photoUrlValue = stored;
      }
      await updateProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        photo_url: photoUrlValue,
      });
      if (photoFile) setCurrentPhoto(resolveFileUrl(photoUrlValue));
      setPhotoFile(null);
      toast.success('Profile updated', 'Your profile has been saved.');
    } catch (err) {
      setError(err.message || 'Could not update your profile.');
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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My Profile"
        subtitle={`${ROLE_LABELS[profile?.role] || 'Member'} account settings`}
        icon={User}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-base font-bold text-slate-800">Personal information</h2>
          <p className="mt-1 text-sm text-slate-500">
            Update your display name, photo and contact details.
          </p>

          {error ? (
            <Alert tone="error" className="mt-4">
              {error}
            </Alert>
          ) : null}

          <div className="mt-5">
            <PhotoUpload value={currentPhoto} onChange={setPhotoFile} maxMb={1} circle />
          </div>

          <div className="mt-5 space-y-4">
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input label="Email" value={user?.email || profile?.email || ''} disabled />
            <Input label="Mobile number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button onClick={saveProfile} loading={saving} className="w-full">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save changes
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-bold text-slate-800">Change password</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose a strong password you have not used before.
          </p>

          {passwordError ? (
            <Alert tone="error" className="mt-4">
              {passwordError}
            </Alert>
          ) : null}

          <div className="mt-5 space-y-4">
            <Input
              label="Current password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
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
            <Button onClick={changePassword} loading={changing} variant="teal" className="w-full">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Update password
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}