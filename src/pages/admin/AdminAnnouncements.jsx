import { useEffect, useState } from 'react';
import { Megaphone, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Textarea, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { PRIORITIES, PRIORITY_LABELS } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';

export default function AdminAnnouncements() {
  const schoolId = useSchoolId();
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', priority: 'normal' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    supabase
      .from('announcements')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error('Could not load announcements', error.message);
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
    setForm({ title: '', content: '', priority: 'normal' });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({ title: row.title, content: row.content, priority: row.priority });
    setError('');
    setOpen(true);
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setError('');
    if (!form.title.trim() || !form.content.trim()) {
      setError('Title and content are required.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from('announcements')
          .update({ title: form.title.trim(), content: form.content.trim(), priority: form.priority })
          .eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Announcement updated', form.title.trim());
      } else {
        const { error: insertError } = await supabase.from('announcements').insert([
          {
            title: form.title.trim(),
            content: form.content.trim(),
            priority: form.priority,
            school_id: schoolId,
            created_by: user?.id,
            is_active: true,
          },
        ]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Announcement posted', form.title.trim());
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    const { error } = await supabase
      .from('announcements')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (error) toast.error('Could not update announcement', error.message);
    else load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('announcements').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete announcement', error.message);
    else toast.success('Announcement deleted', deleting.title);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Keep students and parents informed."
        icon={Megaphone}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New announcement
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading announcements..." />
      ) : rows.length ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.priority === 'urgent' ? 'red' : row.priority === 'high' ? 'amber' : 'blue'} className="uppercase">
                      {row.priority}
                    </Badge>
                    {!row.is_active ? <Badge tone="slate">Hidden</Badge> : null}
                  </div>
                  <h3 className="mt-2 text-base font-bold text-slate-800">{row.title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{row.content}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatDateTime(row.created_at)}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => toggleActive(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={row.is_active ? 'Hide announcement' : 'Show announcement'}>
                    {row.is_active ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit announcement">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete announcement">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          message="Post your first announcement to reach students and parents."
          action={<Button onClick={openAdd}>New announcement</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit announcement' : 'New announcement'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Post announcement'}
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
          <Input label="Title *" value={form.title} onChange={set('title')} placeholder="e.g. Mid-term break" />
          <Textarea label="Content *" value={form.content} onChange={set('content')} placeholder="Write the announcement..." />
          <Select label="Priority" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete announcement?"
        message={`This removes ${deleting?.title || 'this announcement'} permanently.`}
      />
    </div>
  );
}