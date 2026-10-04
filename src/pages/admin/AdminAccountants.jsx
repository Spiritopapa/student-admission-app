import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, Trash2, BadgeCheck, KeyRound, Activity, Unlink, Lock } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import ActivityLogModal from '../../components/ActivityLogModal';
import { supabase } from '../../lib/supabase';

export default function AdminAccountants() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [activityTarget, setActivityTarget] = useState(null);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    supabase
      .from('accountants')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error('Could not load accountants', error.message);
        else setRows(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.full_name} ${r.email || ''} ${r.registration_id || ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = () => {
    setEditing(null);
    setForm({ full_name: '', email: '', phone: '' });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({ full_name: row.full_name, email: row.email || '', phone: row.phone || '' });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.full_name.trim()) {
      setError('Full name is required.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from('accountants')
          .update({
            full_name: form.full_name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
          })
          .eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
        // Keep the accountant's linked portal profile in sync so their own
        // header / dashboards reflect the change (the accountant cannot change
        // their own name due to the name-lock trigger; the admin is the only
        // one who can). RLS allows school admins/sub_admins to update profiles
        // in their own school. Email is intentionally not synced because the
        // accountant signs in with a generated @accountant.local address.
        if (editing.user_id) {
          try {
            const { error: profileErr } = await supabase
              .from('profiles')
              .update({ full_name: form.full_name.trim(), phone: form.phone.trim() || null })
              .eq('id', editing.user_id);
            if (profileErr) console.warn('Could not sync accountant profile:', profileErr.message);
          } catch (profileSyncErr) {
            console.warn('Could not sync accountant profile:', profileSyncErr.message);
          }
        }
        toast.success('Accountant updated', form.full_name.trim());
      } else {
        const { data: regId, error: idError } = await supabase.rpc('generate_accountant_id', {
          p_school_id: schoolId,
        });
        if (idError || !regId) throw new Error('Could not generate an Accountant ID.');
        const { data: { user } } = await supabase.auth.getUser();
        const { error: insertError } = await supabase.from('accountants').insert([
          {
            registration_id: regId,
            full_name: form.full_name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            school_id: schoolId,
            created_by: user?.id || null,
            is_approved: true,
          },
        ]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Accountant created', `${form.full_name.trim()} (${regId}). They can now register.`);
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleApproval = async (acc, approved) => {
    const { error } = await supabase.from('accountants').update({ is_approved: approved }).eq('id', acc.id);
    if (error) toast.error('Could not update approval', error.message);
    else {
      toast.success(approved ? 'Accountant approved' : 'Approval removed', acc.full_name);
      load();
    }
  };

  const unlink = async (acc) => {
    const { error } = await supabase.from('accountants').update({ user_id: null }).eq('id', acc.id);
    if (error) toast.error('Could not unlink account', error.message);
    else {
      toast.success('Account unlinked', `${acc.full_name} can register again.`);
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_accountant_completely', {
        p_accountant_id: deleting.id,
      });
      if (error) {
        // Fallback manual deletion
        let userId = deleting.user_id || null;
        if (!userId && deleting.registration_id) {
          const { data: linked } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', deleting.registration_id.toLowerCase() + '@accountant.local')
            .maybeSingle();
          userId = linked?.id || null;
        }
        if (userId) {
          try {
            await supabase.rpc('delete_auth_user', { p_user_id: userId });
          } catch (innerErr) {
            // best effort
          }
        }
        await supabase.from('accountants').delete().eq('id', deleting.id);
      }
      toast.success('Accountant deleted', deleting.full_name);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete accountant', err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const changePassword = async () => {
    if (!passwordTarget || newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await supabase.rpc('reset_accountant_password', {
        p_accountant_id: passwordTarget.id,
        p_new_password: newPassword,
      });
      if (error) throw new Error(error.message);
      toast.success('Password reset', `New password set for ${passwordTarget.full_name}.`);
      setPasswordTarget(null);
      setNewPassword('');
    } catch (err) {
      toast.error('Could not reset password', err.message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const openActivities = (acc) => setActivityTarget(acc);

  return (
    <div>
      <PageHeader
        title="Accountants"
        subtitle="Manage the staff who collect fees and issue receipts."
        icon={Users}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add accountant
          </Button>
        }
      />

      <div className="mb-5 max-w-sm">
        <SearchInput value={query} onChange={setQuery} placeholder="Search accountants..." />
      </div>

      {loading ? (
        <Spinner label="Loading accountants..." />
      ) : filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((acc) => (
            <Card key={acc.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 font-bold text-accent-600">
                    {(acc.full_name || 'A').charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{acc.full_name}</p>
                    <p className="font-mono text-xs text-slate-400">{acc.registration_id || '—'}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEdit(acc)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit accountant">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeleting(acc)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete accountant">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <p>Email: {acc.email || '-'}</p>
                <p>Phone: {acc.phone || '-'}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {acc.user_id ? (
                  <Badge tone="green">Registered</Badge>
                ) : (
                  <Badge tone="slate">Not registered</Badge>
                )}
                {acc.is_approved ? (
                  <Badge tone="blue">Approved</Badge>
                ) : (
                  <Badge tone="amber">Pending approval</Badge>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-50 pt-3">
                <Button size="sm" variant="teal" onClick={() => toggleApproval(acc, !acc.is_approved)}>
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {acc.is_approved ? 'Revoke' : 'Approve'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setPasswordTarget(acc); setNewPassword(''); setError(''); }}>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  Password
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openActivities(acc)}>
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  Activity
                </Button>
                {acc.user_id ? (
                  <Button size="sm" variant="ghost" onClick={() => unlink(acc)}>
                    <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                    Unlink
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No accountants yet"
          message="Add accountants so they can register for the portal and collect fees."
          action={<Button onClick={openAdd}>Add accountant</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit accountant' : 'Add an accountant'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Create accountant'}
            </Button>
          </div>
        }
      >
        {error ? (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name *" value={form.full_name} onChange={set('full_name')} />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
          <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} className="sm:col-span-2" />
        </div>
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          An Accountant ID (e.g. ACC-0001) is generated automatically when creating a new accountant.
        </p>
      </Modal>

      <Modal open={!!passwordTarget} onClose={() => setPasswordTarget(null)} title={`Reset password: ${passwordTarget?.full_name || ''}`} size="sm">
        <Input
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Minimum 6 characters"
          autoComplete="new-password"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setPasswordTarget(null)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={changePassword} loading={passwordBusy} className="flex-1">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Set password
          </Button>
        </div>
      </Modal>

      <ActivityLogModal
        open={!!activityTarget}
        person={activityTarget ? { id: activityTarget.id, display: activityTarget.full_name, sub: activityTarget.registration_id, role: 'accountant' } : null}
        onClose={() => setActivityTarget(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete accountant?"
        message="This permanently removes the accountant and their auth account (they will no longer be able to sign in). This cannot be undone."
        confirmLabel="Delete accountant"
      />
    </div>
  );
}