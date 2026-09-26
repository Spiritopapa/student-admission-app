import { useEffect, useState } from 'react';
import { School, Search, KeyRound, BadgeCheck, Users } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, SearchInput, Badge, Button, Input, Switch } from '../../components/ui';
import { Modal, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';

export default function SuperAdminSchools() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [resetSchool, setResetSchool] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    supabase
      .from('schools')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setRows(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = rows.filter(
    (row) =>
      !query ||
      row.name.toLowerCase().includes(query.toLowerCase()) ||
      (row.registration_id || '').toLowerCase().includes(query.toLowerCase())
  );

  const toggleApproval = async (row, approved) => {
    const { error } = await supabase.from('schools').update({ is_approved: approved }).eq('id', row.id);
    if (error) toast.error('Could not update school', error.message);
    else {
      toast.success(approved ? 'School approved' : 'School unapproved', row.name);
      load();
    }
  };

  const doReset = async () => {
    if (!resetSchool || !newPassword || newPassword.length < 6) {
      toast.error('Enter a password', 'The new password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('reset_school_password', {
        p_school_id: resetSchool.id,
        p_new_password: newPassword,
      });
      if (error) throw new Error(error.message);
      if (data && data.success === false) throw new Error(data.error || 'Could not reset the password.');
      toast.success('Password reset', `The school administrator can now sign in with the new password.`);
      setResetSchool(null);
      setNewPassword('');
    } catch (err) {
      toast.error('Could not reset password', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Schools" subtitle="All schools registered on the platform." icon={School} />
      <SearchInput value={query} onChange={setQuery} placeholder="Search schools..." className="mb-5 max-w-sm" />

      {loading ? (
        <Spinner label="Loading schools..." />
      ) : filtered.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex items-start justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blend text-white">
                  <School className="h-6 w-6" aria-hidden="true" />
                </span>
                <Badge tone={row.is_approved ? 'green' : 'amber'}>
                  {row.is_approved ? 'Approved' : 'Pending'}
                </Badge>
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-800">{row.name}</h3>
              <p className="font-mono text-xs text-slate-400">{row.registration_id}</p>
              <p className="mt-2 text-xs text-slate-500">
                {row.email || 'No email on file'} · {row.phone || 'No phone'}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3">
                <span className="text-xs text-slate-400">Joined {formatDate(row.created_at)}</span>
                <button
                  type="button"
                  onClick={() => setResetSchool(row)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50"
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset password
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Approved</span>
                <Switch checked={!!row.is_approved} onChange={(v) => toggleApproval(row, v)} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={School} title="No schools found" message="Schools registered by the super admin appear here." />
      )}

      <Modal
        open={!!resetSchool}
        onClose={() => setResetSchool(null)}
        title={`Reset password for ${resetSchool?.name || 'school'}`}
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setResetSchool(null)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={doReset} loading={busy} className="flex-1">
              Reset password
            </Button>
          </div>
        }
      >
        <Alert tone="warning" className="mb-4">
          The administrator of this school will be signed out and must use the new password.
        </Alert>
        <Input label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
      </Modal>
    </div>
  );
}