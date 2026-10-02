import { useEffect, useState } from 'react';
import { Settings, Save, Plus, Trash2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, resolveFileUrl } from '../../lib/storage';
import { fetchAdmissionItems } from '../../lib/queries';
import { formatCurrency, formatDate } from '../../lib/format';
import { TERMS, TERM_LABELS, currentAcademicYear, academicYearList } from '../../lib/constants';

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

  // --- Admission Items (additional fees shown on the Admit Student form) ---
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsError, setItemsError] = useState('');

  const loadItems = async () => {
    if (!schoolId) return;
    setItemsLoading(true);
    try {
      const data = await fetchAdmissionItems(schoolId);
      setItems(data || []);
    } catch (err) {
      setItemsError(err.message);
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const addItem = async () => {
    setItemsError('');
    const name = itemName.trim();
    const amount = Number(itemAmount || 0);
    if (!name) {
      setItemsError('Enter an item name (e.g. Development Levy).');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setItemsError('Enter a valid amount (0 or more).');
      return;
    }
    setItemsBusy(true);
    try {
      const { error } = await supabase.from('admission_items').insert([{ school_id: schoolId, name, amount }]);
      if (error) throw new Error(error.message);
      toast.success('Admission item added', `"${name}" will now appear on the Admit Student form.`);
      setItemName('');
      setItemAmount('');
      await loadItems();
    } catch (err) {
      setItemsError(err.message);
    } finally {
      setItemsBusy(false);
    }
  };

  const deleteItem = async (item) => {
    setItemsError('');
    if (!window.confirm(`Delete "${item.name}"? It will be removed from the Admit Student form. Already admitted students keep their saved fee breakdown.`)) return;
    setItemsBusy(true);
    try {
      const { error } = await supabase.from('admission_items').delete().eq('id', item.id);
      if (error) throw new Error(error.message);
      toast.success('Admission item deleted', `"${item.name}" was removed.`);
      await loadItems();
    } catch (err) {
      setItemsError(err.message);
    } finally {
      setItemsBusy(false);
    }
  };

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
            academic_year: data.academic_year || currentAcademicYear(),
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
          <PhotoUpload value={resolveFileUrl(logoUrl)} onChange={setLogoFile} maxMb={1} circle />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input label="School name" value={form.school_name} onChange={set('school_name')} />
          <Select label="Academic year" value={form.academic_year || currentAcademicYear()} onChange={set('academic_year')}>
            {academicYearList(6, [form.academic_year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
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
        <h2 className="text-base font-bold text-slate-800">Admission Items (Additional Fees)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Items added here appear on the <strong>Admit Student</strong> form with an amount input.
          On admission the class (term) fee plus the entered item amounts are saved as the student's term fee.
        </p>
        {itemsError ? (
          <Alert tone="error" className="mt-4">
            {itemsError}
          </Alert>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            label="Item name"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. Development Levy"
          />
          <Input
            label="Default amount (GHC)"
            type="number"
            min="0"
            step="0.01"
            value={itemAmount}
            onChange={(e) => setItemAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <Button onClick={addItem} loading={itemsBusy} variant="teal" className="mt-4">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add item
        </Button>

        <div className="mt-5 overflow-x-auto">
          <table className="table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Item name</th>
                <th className="px-3 py-2">Default amount</th>
                <th className="px-3 py-2">Added on</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {itemsLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    Loading admission items...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    No admission items yet. Add one above — it will appear on the Admit Student form.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">{item.name}</td>
                    <td className="px-3 py-2 text-slate-600">GHC {formatCurrency(item.amount)}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(item.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="danger" size="sm" onClick={() => deleteItem(item)} disabled={itemsBusy}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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