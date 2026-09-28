import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Pencil, Trash2, Layers } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';

export default function AdminSubjects() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    supabase
      .from('subjects')
      .select('*')
      .eq('school_id', schoolId)
      .order('name')
      .then(({ data, error }) => {
        if (error) toast.error('Could not load subjects', error.message);
        else setRows(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const [classes, setClasses] = useState([]);
  const [classFilter, setClassFilter] = useState('');
  const [classSubjects, setClassSubjects] = useState([]);
  const [subjectToAdd, setSubjectToAdd] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);

  const loadClassData = async () => {
    if (!schoolId) return;
    setAssignLoading(true);
    try {
      const [{ data: cls }, { data: assigned }] = await Promise.all([
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
        supabase.from('class_subjects').select('*').eq('school_id', schoolId).order('subject_name'),
      ]);
      setClasses(cls || []);
      setClassSubjects(assigned || []);
    } finally {
      setAssignLoading(false);
    }
  };

  useEffect(() => {
    loadClassData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const assignedForClass = useMemo(
    () => classSubjects.filter((r) => !classFilter || r.class_name === classFilter),
    [classSubjects, classFilter]
  );
  const assignableSubjects = useMemo(() => {
    const assignedNames = new Set(
      classSubjects.filter((r) => r.class_name === classFilter).map((r) => r.subject_name.toLowerCase())
    );
    return rows.filter((r) => !assignedNames.has(r.name.toLowerCase()));
  }, [rows, classSubjects, classFilter]);

  const addAssignment = async () => {
    if (!classFilter || !subjectToAdd) return;
    setAssignBusy(true);
    try {
      const { error } = await supabase.from('class_subjects').upsert(
        { class_name: classFilter, subject_name: subjectToAdd, school_id: schoolId },
        { onConflict: 'school_id,class_name,subject_name' }
      );
      if (error) throw new Error(error.message);
      toast.success('Subject assigned', `${subjectToAdd} added to ${classFilter}.`);
      setSubjectToAdd('');
      await loadClassData();
    } catch (err) {
      toast.error('Could not assign subject', err.message);
    } finally {
      setAssignBusy(false);
    }
  };

  const removeAssignment = async (id) => {
    const { error } = await supabase.from('class_subjects').delete().eq('id', id);
    if (error) toast.error('Could not remove subject', err.message);
    else {
      toast.success('Assignment removed', 'Subject removed from this class.');
      await loadClassData();
    }
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setName(row.name);
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!name.trim()) {
      setError('Subject name is required.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: updateError } = await supabase.from('subjects').update({ name: name.trim() }).eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Subject updated', name.trim());
      } else {
        const { error: insertError } = await supabase.from('subjects').insert([{ name: name.trim(), school_id: schoolId }]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Subject added', name.trim());
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('subjects').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete subject', error.message);
    else toast.success('Subject deleted', deleting.name);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Subjects"
        subtitle="The subjects offered by your school."
        icon={FileText}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add subject
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading subjects..." />
      ) : rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="text-sm font-bold text-slate-800">{row.name}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit subject">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete subject">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={FileText} title="No subjects yet" message="Add the subjects taught in your school." action={<Button onClick={openAdd}>Add subject</Button>} />
      )}

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Assign subjects to classes</h3>
            <p className="text-xs text-slate-400">Each class can have its own subjects, which the examination module loads when a class is selected.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select label="Class" value={classFilter} onChange={(e) => { setClassFilter(e.target.value); setSubjectToAdd(''); }}>
            <option value="">Select a class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="flex items-end gap-2">
            <div className="w-full">
              <Select label="Subject" value={subjectToAdd} onChange={(e) => setSubjectToAdd(e.target.value)} disabled={!classFilter}>
                <option value="">
                  {!classFilter ? 'Pick a class first' : assignableSubjects.length ? 'Select a subject...' : 'All subjects assigned'}
                </option>
                {assignableSubjects.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={addAssignment} disabled={!classFilter || !subjectToAdd} loading={assignBusy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Assign
            </Button>
          </div>
        </div>

        {assignLoading ? (
          <div className="mt-4">
            <Spinner label="Loading assignments..." />
          </div>
        ) : classFilter ? (
          assignedForClass.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {assignedForClass.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                  {r.subject_name}
                  <button type="button" onClick={() => removeAssignment(r.id)} className="rounded-full bg-white p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${r.subject_name}`}>
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No subjects assigned to {classFilter} yet.</p>
          )
        ) : (
          <p className="mt-4 text-sm text-slate-400">Select a class to view or change its subjects.</p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit subject' : 'Add a subject'}
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              Save
            </Button>
          </div>
        }
      >
        {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}
        <Input label="Subject name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mathematics" autoFocus />
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete subject?"
        message={`This removes the subject ${deleting?.name || ''}.`}
      />
    </div>
  );
}