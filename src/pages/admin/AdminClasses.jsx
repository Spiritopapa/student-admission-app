import { useEffect, useState } from 'react';
import { BookOpen, Plus, Pencil, Trash2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { CLASS_LEVELS, CLASS_LEVEL_LABELS } from '../../lib/constants';

export default function AdminClasses() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('primary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    supabase
      .from('classes')
      .select('*')
      .eq('school_id', schoolId)
      .order('name')
      .then(({ data, error }) => {
        if (error) toast.error('Could not load classes', error.message);
        else setRows(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setLevel('primary');
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setName(row.name);
    setLevel(row.level || 'primary');
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!name.trim()) {
      setError('Class name is required.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from('classes')
          .update({ name: name.trim(), level })
          .eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Class updated', name.trim());
      } else {
        const { error: insertError } = await supabase
          .from('classes')
          .insert([{ name: name.trim(), level, school_id: schoolId }]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Class added', name.trim());
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
    const { error } = await supabase.from('classes').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete class', error.message);
    else toast.success('Class deleted', deleting.name);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle="Organise students into class levels."
        icon={BookOpen}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add class
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading classes..." />
      ) : rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blend-soft text-white">
                  <BookOpen className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{row.name}</p>
                  <p className="text-xs text-slate-400">{CLASS_LEVEL_LABELS[row.level] || row.level}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit class">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete class">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No classes yet"
          message="Add a class to start organizing students."
          action={<Button onClick={openAdd}>Add class</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit class' : 'Add a class'}
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
        {error ? (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="space-y-4">
          <Input label="Class name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Primary 1" />
          <Select label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {CLASS_LEVELS.map((l) => (
              <option key={l} value={l}>
                {CLASS_LEVEL_LABELS[l]}
              </option>
            ))}
          </Select>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete class?"
        message={`This removes the class ${deleting?.name || ''}. Students already assigned to it are not removed.`}
      />
    </div>
  );
}