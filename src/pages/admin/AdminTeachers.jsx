import { useEffect, useState } from 'react';
import { UserRound, Plus, Trash2, BadgeCheck } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Spinner, EmptyState, Switch } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';

export default function AdminTeachers() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', class_taught: '', subject: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    supabase
      .from('teachers')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error('Could not load teachers', error.message);
        else setRows(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setError('');
    if (!form.full_name.trim()) {
      setError('Full name is required.');
      return;
    }
    setBusy(true);
    try {
      const { data: regId, error: idError } = await supabase.rpc('generate_teacher_id', {
        p_school_id: schoolId,
      });
      if (idError || !regId) throw new Error('Could not generate a Teacher ID.');
      const { error: insertError } = await supabase.from('teachers').insert([
        {
          registration_id: regId,
          full_name: form.full_name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          class_taught: form.class_taught.trim() || null,
          subject: form.subject.trim() || null,
          school_id: schoolId,
          is_active: true,
          is_approved: false,
        },
      ]);
      if (insertError) throw new Error(insertError.message);
      toast.success(
        'Teacher added',
        `${form.full_name.trim()} (${regId}) created. They can register when approved.`
      );
      setOpen(false);
      setForm({ full_name: '', email: '', phone: '', class_taught: '', subject: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleApproval = async (teacher, approved) => {
    const { error } = await supabase
      .from('teachers')
      .update({ is_approved: approved })
      .eq('id', teacher.id);
    if (error) toast.error('Could not update approval', error.message);
    else {
      toast.success(approved ? 'Teacher approved' : 'Approval removed', teacher.full_name);
      load();
    }
  };

  const toggleCollector = async (teacher, value) => {
    const { error } = await supabase
      .from('teachers')
      .update({ is_transport_collector: value })
      .eq('id', teacher.id);
    if (error) toast.error('Could not update flag', error.message);
    else {
      toast.success('Transport collector flag updated', teacher.full_name);
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc('delete_teacher_completely', { p_teacher_id: deleting.id });
    if (error) toast.error('Could not delete teacher', error.message);
    else toast.success('Teacher deleted', deleting.full_name);
    setDeleteBusy(false);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Teachers"
        subtitle="Teaching staff and their portal access."
        icon={UserRound}
        actions={
          <Button onClick={() => { setError(''); setOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add teacher
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading teachers..." />
      ) : rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((teacher) => (
            <Card key={teacher.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blend-soft text-white">
                  <UserRound className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{teacher.full_name}</p>
                  <p className="font-mono text-xs text-slate-400">{teacher.registration_id}</p>
                </div>
                <button type="button" onClick={() => setDeleting(teacher)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete teacher">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <p>Class: {teacher.class_taught || '-'}</p>
                <p>Subject: {teacher.subject || '-'}</p>
                {teacher.phone ? <p>Phone: {teacher.phone}</p> : null}
              </div>
              <div className="mt-4 space-y-2.5 border-t border-slate-50 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Portal access</span>
                  <Switch checked={!!teacher.is_approved} onChange={(v) => toggleApproval(teacher, v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                    <BadgeCheck className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                    Transport collector
                  </span>
                  <Switch checked={!!teacher.is_transport_collector} onChange={(v) => toggleCollector(teacher, v)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={UserRound}
          title="No teachers yet"
          message="Add teachers so they can register for the portal."
          action={<Button onClick={() => setOpen(true)}>Add teacher</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a teacher"
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              Save teacher
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
          <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
          <Input label="Class taught" value={form.class_taught} onChange={set('class_taught')} />
          <Input label="Subject" value={form.subject} onChange={set('subject')} className="sm:col-span-2" />
        </div>
        <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800">
          A Teacher ID will be generated automatically. The teacher uses it to register and their
          account is approved here.
        </p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete teacher?"
        message={`This permanently removes ${deleting?.full_name || 'this teacher'} and their related records.`}
      />
    </div>
  );
}