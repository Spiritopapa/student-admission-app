import { useEffect, useMemo, useState } from 'react';
import {
  School, KeyRound, Plus, Pencil, Trash2, Eye, Lock, Unlock, Cog, Mail,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, SearchInput, Badge, Button, Input, Select, Switch } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, photoUrl } from '../../lib/storage';
import { currentAcademicYear } from '../../lib/constants';
import { formatDate, formatDateTime } from '../../lib/format';

const emptySchoolForm = {
  name: '',
  admin_name: '',
  email: '',
  phone: '',
  school_type: 'private',
  location: '',
  student_population: '',
  plan_version: 'full',
  trial_days: '14',
  show_on_homepage: true,
};

function trialEndsAtFor(version, days) {
  if (version !== 'trial') return null;
  const d = Math.max(1, parseInt(days || '14', 10) || 14);
  return new Date(Date.now() + d * 86400000).toISOString();
}

function remainingTrialDays(row) {
  if (row.plan_version !== 'trial' || !row.trial_ends_at) return 14;
  const remain = Math.max(Math.ceil((new Date(row.trial_ends_at) - new Date()) / 86400000), 1);
  return Number.isFinite(remain) ? remain : 14;
}

export default function SuperAdminSchools() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [resetSchool, setResetSchool] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptySchoolForm);
  const [logoFile, setLogoFile] = useState(null);
  const [formError, setFormError] = useState('');

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [viewing, setViewing] = useState(null);
  const [viewStats, setViewStats] = useState(null);

  const [modulesSchool, setModulesSchool] = useState(null);
  const [modulesList, setModulesList] = useState([]);
  const [modulesBusy, setModulesBusy] = useState(false);
  const [modulesError, setModulesError] = useState('');
  const [moduleBusyName, setModuleBusyName] = useState(null);

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [smsBusy, setSmsBusy] = useState(null);
  const [homepageBusy, setHomepageBusy] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from('schools').select('*').order('created_at', { ascending: false }),
      supabase.from('school_modules').select('school_id').eq('is_locked', true),
    ])
      .then(([{ data, error }, { data: locked }]) => {
        if (!error) {
          const counts = {};
          (locked || []).forEach((l) => {
            counts[l.school_id] = (counts[l.school_id] || 0) + 1;
          });
          setRows((data || []).map((s) => ({ ...s, locked_count: counts[s.id] || 0 })));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          !query ||
          row.name.toLowerCase().includes(query.toLowerCase()) ||
          (row.registration_id || '').toLowerCase().includes(query.toLowerCase()) ||
          (row.email || '').toLowerCase().includes(query.toLowerCase())
      ),
    [rows, query]
  );

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setEdit = (key) => (e) => setEditForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = () => {
    setForm(emptySchoolForm);
    setLogoFile(null);
    setFormError('');
    setOpen(true);
  };
const addSchool = async () => {
    setFormError('');
    const name = form.name.trim();
    if (!name) {
      setFormError('School name is required.');
      return;
    }
    const version = form.plan_version;
    const trialDays = Math.max(1, parseInt(form.trial_days || '14', 10) || 14);
    setBusy(true);
    try {
      const { data: regId, error: idError } = await supabase.rpc('generate_school_id', {
        p_school_name: name,
        p_version: version,
      });
      if (idError || !regId) throw new Error('Could not generate a school ID.');

      const { data: created, error: insertError } = await supabase
        .from('schools')
        .insert([
          {
            registration_id: regId,
            name,
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            address: form.location.trim() || null,
            location: form.location.trim() || null,
            admin_name: form.admin_name.trim() || null,
            school_type: form.school_type,
            student_population: form.student_population === '' ? null : Number(form.student_population),
            plan_version: version,
            trial_ends_at: trialEndsAtFor(version, trialDays),
            is_approved: true,
            show_on_homepage: form.show_on_homepage !== false,
            created_by: user?.id || null,
          },
        ])
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);

      let logoUrl = null;
      if (logoFile && created?.id) {
        logoUrl = await uploadFile('school-logos', randomPath(`school_${created.id}`, logoFile.name), logoFile);
      }
      if (created?.id) {
        await supabase
          .from('school_settings')
          .upsert(
            {
              school_id: created.id,
              school_name: name,
              academic_year: currentAcademicYear(),
              current_term: 'First',
              logo_url: logoUrl,
            },
            { onConflict: 'school_id' }
          );
        if (logoUrl) {
          await supabase.from('schools').update({ logo_url: logoUrl }).eq('id', created.id);
        }
      }

      toast.success(
        'School added',
        `${name} created with ID ${regId}. Provide this ID to the school administrator so they can register in the app.`
      );
      setOpen(false);
      setForm(emptySchoolForm);
      setLogoFile(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };
const openEdit = (row) => {
    setEditing(row);
    setEditForm({
      name: row.name || '',
      admin_name: row.admin_name || '',
      email: row.email || '',
      phone: row.phone || '',
      school_type: row.school_type || 'private',
      location: row.location || row.address || '',
      student_population: row.student_population != null ? String(row.student_population) : '',
      plan_version: row.plan_version || 'full',
      trial_days: String(remainingTrialDays(row)),
      show_on_homepage: row.show_on_homepage !== false,
    });
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditError('');
    const name = editForm.name.trim();
    if (!name) {
      setEditError('School name is required.');
      return;
    }
    const version = editForm.plan_version;
    const trialDays = Math.max(1, parseInt(editForm.trial_days || '14', 10) || 14);
    setEditBusy(true);
    try {
      const { error } = await supabase
        .from('schools')
        .update({
          name,
          admin_name: editForm.admin_name.trim() || null,
          email: editForm.email.trim() || null,
          phone: editForm.phone.trim() || null,
          school_type: editForm.school_type,
          location: editForm.location.trim() || null,
          address: editForm.location.trim() || null,
          student_population: editForm.student_population === '' ? null : Number(editForm.student_population),
          plan_version: version,
          trial_ends_at: trialEndsAtFor(version, trialDays),
          show_on_homepage: editForm.show_on_homepage !== false,
        })
        .eq('id', editing.id);
      if (error) throw new Error(error.message);
      toast.success('School updated', name);
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const toggleApproval = async (row, approved) => {
    const { error } = await supabase.from('schools').update({ is_approved: approved }).eq('id', row.id);
    if (error) toast.error('Could not update school', error.message);
    else {
      toast.success(approved ? 'School approved' : 'School unapproved', row.name);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_approved: approved } : r)));
    }
  };

  const toggleSms = async (row, enable) => {
    setSmsBusy(row.id);
    try {
      const { error } = await supabase.from('schools').update({ sms_enabled: enable }).eq('id', row.id);
      if (error) throw new Error(error.message);
      toast.success(enable ? 'SMS enabled' : 'SMS disabled', row.name);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, sms_enabled: enable } : r)));
    } catch (err) {
      toast.error('Could not update SMS', err.message);
    } finally {
      setSmsBusy(null);
    }
  };

  const toggleHomepage = async (row, visible) => {
    setHomepageBusy(row.id);
    try {
      const { error } = await supabase
        .from('schools')
        .update({ show_on_homepage: visible })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
      toast.success(
        visible ? 'School listed on public apply page' : 'School hidden from public apply page',
        row.name
      );
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, show_on_homepage: visible } : r)));
    } catch (err) {
      toast.error('Could not update public listing', err.message);
    } finally {
      setHomepageBusy(null);
    }
  };

  const openView = async (row) => {
    setViewing(row);
    setViewStats(null);
    try {
      const [{ count: students }, { count: teachers }, { count: accountants }] = await Promise.all([
        supabase.from('applications').select('id', { count: 'exact', head: true }).eq('school_id', row.id),
        supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', row.id),
        supabase.from('accountants').select('id', { count: 'exact', head: true }).eq('school_id', row.id),
      ]);
      setViewStats({ students, teachers, accountants });
    } catch (err) {
      setViewStats({ students: 0, teachers: 0, accountants: 0 });
    }
  };

  const openModules = async (row) => {
    setModulesSchool(row);
    setModulesList([]);
    setModulesError('');
    setModulesBusy(true);
    try {
      const { data, error } = await supabase.rpc('get_school_module_status', { p_school_id: row.id });
      if (error) {
        // Fallback: build the list manually from modules + school_modules.
        const [{ data: allModules }, { data: schoolMods }] = await Promise.all([
          supabase.from('modules').select('*').order('sort_order'),
          supabase.from('school_modules').select('*').eq('school_id', row.id),
        ]);
        const lockMap = {};
        (schoolMods || []).forEach((sm) => {
          lockMap[sm.module_name] = sm.is_locked;
        });
        setModulesList(
          (allModules || []).map((m) => ({
            module_name: m.name,
            label: m.label,
            icon: m.icon || '',
            is_core: m.is_core || false,
            is_locked: lockMap[m.name] || false,
            sort_order: m.sort_order || 0,
          }))
        );
      } else {
        setModulesList(data || []);
      }
    } catch (err) {
      setModulesError(err.message || 'Failed to load modules.');
    } finally {
      setModulesBusy(false);
    }
  };

  const toggleModule = async (mod) => {
    if (!modulesSchool) return;
    const nextLocked = !mod.is_locked;
    setModuleBusyName(mod.module_name);
    try {
      const { error } = await supabase.from('school_modules').upsert(
        { school_id: modulesSchool.id, module_name: mod.module_name, is_locked: nextLocked },
        { onConflict: 'school_id,module_name' }
      );
      if (error) throw new Error(error.message);
      setModulesList((list) =>
        list.map((m) => (m.module_name === mod.module_name ? { ...m, is_locked: nextLocked } : m))
      );
      toast.success(
        nextLocked ? 'Module locked' : 'Module unlocked',
        `${mod.label} is now ${nextLocked ? 'locked' : 'active'} for ${modulesSchool.name}.`
      );
    } catch (err) {
      toast.error('Could not toggle module', err.message);
    } finally {
      setModuleBusyName(null);
    }
  };
const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.from('schools').delete().eq('id', deleting.id);
      if (error) throw new Error(error.message);
      toast.success('School deleted', `${deleting.name} and its related data were removed.`);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete school', err.message);
    } finally {
      setDeleteBusy(false);
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
      toast.success('Password reset', 'The school administrator can now sign in with the new password.');
      setResetSchool(null);
      setNewPassword('');
    } catch (err) {
      toast.error('Could not reset password', err.message);
    } finally {
      setBusy(false);
    }
  };

  const planBadge = (row) => {
    if (row.plan_version !== 'trial') return <Badge tone="green">Full</Badge>;
    const end = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    const expired = end && end < new Date();
    return <Badge tone={expired ? 'red' : 'amber'}>Trial{expired ? ' · Expired' : end ? ` · ${formatDate(end)}` : ''}</Badge>;
  };
return (
    <div>
      <PageHeader
        title="Schools"
        subtitle={`${rows.length} schools registered on the platform.`}
        icon={School}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add school
          </Button>
        }
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Search by name, ID or email..." className="mb-5 max-w-sm" />

      {loading ? (
        <Spinner label="Loading schools..." />
      ) : filtered.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                {row.logo_url ? (
                  <img src={photoUrl(row.logo_url)} alt={`${row.name} logo`} className="h-12 w-12 rounded-2xl object-cover ring-2 ring-brand-100" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blend text-white">
                    <School className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Badge tone={row.is_approved ? 'green' : 'amber'}>{row.is_approved ? 'Approved' : 'Pending'}</Badge>
                  {planBadge(row)}
                  <Badge tone={row.sms_enabled === false ? 'slate' : 'blue'}>{row.sms_enabled === false ? 'SMS off' : 'SMS on'}</Badge>
                  <Badge tone={row.show_on_homepage === false ? 'slate' : 'green'}>{row.show_on_homepage === false ? 'Hidden' : 'On public list'}</Badge>
                  {row.locked_count > 0 ? <Badge tone="red">{row.locked_count} locked</Badge> : null}
                </div>
              </div>

              <h3 className="mt-3 text-base font-bold text-slate-800">{row.name}</h3>
              <p className="font-mono text-xs text-slate-400">{row.registration_id}</p>
              <p className="mt-2 text-xs text-slate-500">
                {row.admin_name || 'No admin name'} · {row.school_type || '—'} · {row.location || row.address || 'No location'}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {row.email || 'No email'} · {row.phone || 'No phone'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Students on record: {row.student_population != null ? row.student_population : '—'} · Joined {formatDate(row.created_at)}
              </p>
<div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-50 pt-3">
                <Button size="sm" variant="secondary" onClick={() => openView(row)} title="View school details">
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  View
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openEdit(row)} title="Edit school info">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openModules(row)} title="Lock / unlock modules">
                  <Cog className="h-3.5 w-3.5" aria-hidden="true" />
                  Modules
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setResetSchool(row)} title="Reset school admin password">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  Password
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(row)} title="Delete this school">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-50 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">Approved</span>
                  <Switch checked={!!row.is_approved} onChange={(v) => toggleApproval(row, v)} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">SMS</span>
                  <Switch
                    checked={row.sms_enabled !== false}
                    disabled={smsBusy === row.id}
                    onChange={(v) => toggleSms(row, v)}
                  />
                </div>
                <div
                  className="flex items-center justify-between gap-2"
                  title="Allow this school to appear in the public apply-for-admission list"
                >
                  <span className="text-xs font-medium text-slate-500">Public list</span>
                  <Switch
                    checked={row.show_on_homepage !== false}
                    disabled={homepageBusy === row.id}
                    onChange={(v) => toggleHomepage(row, v)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={School}
          title="No schools found"
          message={rows.length ? 'Try adjusting your search.' : 'Use "Add school" to register the first school on the platform.'}
          action={rows.length ? null : <Button onClick={openAdd}>Add school</Button>}
        />
      )}
<Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a school"
        size="lg"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addSchool} loading={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create school
            </Button>
          </div>
        }
      >
        {formError ? <Alert tone="error" className="mb-4">{formError}</Alert> : null}
        <Alert tone="info" className="mb-4">
          A unique School ID (e.g. <strong>SCH-SIS-0001</strong>) will be generated automatically. Give it to the school
          administrator - they enter it when registering an admin account in the app.
        </Alert>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="School name *" value={form.name} onChange={set('name')} placeholder="e.g. St. Mary's Senior High" />
          <Input label="Administrator name" value={form.admin_name} onChange={set('admin_name')} placeholder="Head teacher / admin" />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
          <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
          <Select label="School type" value={form.school_type} onChange={set('school_type')}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </Select>
          <Input label="Student population" type="number" min="0" value={form.student_population} onChange={set('student_population')} />
          <Input label="Location / address" value={form.location} onChange={set('location')} className="sm:col-span-2" placeholder="Town, district, region..." />
          <Select label="Plan version" value={form.plan_version} onChange={set('plan_version')}>
            <option value="full">Full version</option>
            <option value="trial">Trial version</option>
          </Select>
          {form.plan_version === 'trial' ? (
            <Input label="Trial duration (days)" type="number" min="1" value={form.trial_days} onChange={set('trial_days')} />
          ) : null}
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-600">Show on public apply list</span>
          <Switch
            checked={form.show_on_homepage !== false}
            onChange={(v) => setForm((f) => ({ ...f, show_on_homepage: v }))}
          />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-5">
          <PhotoUpload value={logoFile} onChange={setLogoFile} maxMb={1} circle />
        </div>
      </Modal>
<Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : 'Edit school'}
        size="lg"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={editBusy}>
              Save changes
            </Button>
          </div>
        }
      >
        {editError ? <Alert tone="error" className="mb-4">{editError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="School name *" value={editForm.name || ''} onChange={setEdit('name')} />
          <Input label="Administrator name" value={editForm.admin_name || ''} onChange={setEdit('admin_name')} />
          <Input label="Email" type="email" value={editForm.email || ''} onChange={setEdit('email')} />
          <Input label="Phone" type="tel" value={editForm.phone || ''} onChange={setEdit('phone')} />
          <Select label="School type" value={editForm.school_type || 'private'} onChange={setEdit('school_type')}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </Select>
          <Input label="Student population" type="number" min="0" value={editForm.student_population || ''} onChange={setEdit('student_population')} />
          <Input label="Location / address" value={editForm.location || ''} onChange={setEdit('location')} className="sm:col-span-2" />
          <Select label="Plan version" value={editForm.plan_version || 'full'} onChange={setEdit('plan_version')}>
            <option value="full">Full version</option>
            <option value="trial">Trial version</option>
          </Select>
          {editForm.plan_version === 'trial' ? (
            <Input label="Trial duration (days)" type="number" min="1" value={editForm.trial_days || '14'} onChange={setEdit('trial_days')} />
          ) : null}
        </div>
        <div
          className="mt-5 flex items-center justify-between gap-2"
          title="Allow this school to appear in the public apply-for-admission list"
        >
          <span className="text-sm font-medium text-slate-600">Show on public apply list</span>
          <Switch
            checked={editForm.show_on_homepage !== false}
            onChange={(v) => setEditForm((f) => ({ ...f, show_on_homepage: v }))}
          />
        </div>
      </Modal>
<Modal open={!!viewing} onClose={() => setViewing(null)} title="School details" size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setViewing(null)} className="flex-1">
              Close
            </Button>
          </div>
        }
      >
        {viewing ? (
          <div>
            <div className="flex items-center gap-4">
              {viewing.logo_url ? (
                <img src={photoUrl(viewing.logo_url)} alt="School logo" className="h-16 w-16 rounded-2xl object-cover ring-2 ring-brand-100" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blend text-white">
                  <School className="h-7 w-7" aria-hidden="true" />
                </span>
              )}
              <div>
                <p className="text-base font-bold text-slate-900">{viewing.name}</p>
                <p className="font-mono text-xs text-slate-400">{viewing.registration_id}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Badge tone={viewing.is_approved ? 'green' : 'amber'}>{viewing.is_approved ? 'Approved' : 'Pending'}</Badge>
                  {planBadge(viewing)}
                  <Badge tone={viewing.sms_enabled === false ? 'slate' : 'blue'}>{viewing.sms_enabled === false ? 'SMS off' : 'SMS on'}</Badge>
                  <Badge tone={viewing.user_id ? 'teal' : 'slate'}>{viewing.user_id ? 'Admin linked' : 'Not linked'}</Badge>
                </div>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Field label="Administrator" value={viewing.admin_name} />
              <Field label="School type" value={viewing.school_type} />
              <Field label="Location" value={viewing.location || viewing.address} />
              <Field label="Student population" value={viewing.student_population != null ? viewing.student_population : '—'} />
              <Field label="Email" value={viewing.email} />
              <Field label="Phone" value={viewing.phone} />
              <Field label="Plan" value={viewing.plan_version === 'trial' ? (viewing.trial_ends_at ? `Trial · ends ${formatDate(viewing.trial_ends_at)}` : 'Trial') : 'Full'} />
              <Field label="Joined" value={formatDateTime(viewing.created_at)} />
              <Field label="Created by" value={viewing.created_by || '—'} />
            </dl>

            {viewStats ? (
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-xl font-bold text-slate-800">{viewStats.students}</p>
                  <p className="text-xs text-slate-400">Students</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-xl font-bold text-slate-800">{viewStats.teachers}</p>
                  <p className="text-xs text-slate-400">Teachers</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <p className="text-xl font-bold text-slate-800">{viewStats.accountants}</p>
                  <p className="text-xs text-slate-400">Accountants</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
<Modal
        open={!!modulesSchool}
        onClose={() => setModulesSchool(null)}
        title={modulesSchool ? `Modules - ${modulesSchool.name}` : 'Modules'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setModulesSchool(null)} className="flex-1">
              Close
            </Button>
          </div>
        }
      >
        <Alert tone="info" className="mb-4">
          Lock a module to hide it from this school's dashboard. Core modules cannot be locked.
        </Alert>
        {modulesBusy ? (
          <Spinner label="Loading modules..." />
        ) : modulesError ? (
          <Alert tone="error">{modulesError}</Alert>
        ) : modulesList.length ? (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {modulesList.map((mod) => {
              const isLocked = !!mod.is_locked;
              const isCore = !!mod.is_core;
              const loading = moduleBusyName === mod.module_name;
              return (
                <div
                  key={mod.module_name}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      {mod.label}
                      {isCore ? <Badge tone="slate">core</Badge> : null}
                    </p>
                    <p className="font-mono text-xs text-slate-400">{mod.module_name}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isLocked ? 'danger' : 'secondary'}
                    disabled={isCore || loading}
                    loading={loading}
                    onClick={() => toggleModule(mod)}
                    title={isCore ? 'Core modules cannot be locked' : isLocked ? 'Click to unlock' : 'Click to lock'}
                  >
                    {isLocked ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : <Unlock className="h-3.5 w-3.5" aria-hidden="true" />}
                    {isCore ? 'Core' : isLocked ? 'Locked' : 'Active'}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Cog} title="No modules found" message="No modules are registered in the system." />
        )}
      </Modal>
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

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete school?"
        message={`PERMANENT DELETION: This removes ${deleting?.name || 'this school'} and all of its data (students, staff, fees, settings). This cannot be undone.`}
        confirmLabel="Delete school"
      />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-700">{value || '-'}</dd>
    </div>
  );
}