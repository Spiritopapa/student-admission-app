import { useEffect, useState } from 'react';
import { FileText, Plus, Pencil, Trash2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Spinner, EmptyState } from '../../components/ui';
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