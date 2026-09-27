import { useEffect, useState } from 'react';
import { Gauge, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Spinner, EmptyState, Badge, Select, SearchInput } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';

const DEFAULT_GRADES = [
  { grade_label: 'A', min_score: 80, max_score: 100, description: 'Advance', color_class: 'grade-a', sort_order: 1 },
  { grade_label: 'B', min_score: 70, max_score: 79.99, description: 'Proficient', color_class: 'grade-b', sort_order: 2 },
  { grade_label: 'C', min_score: 60, max_score: 69.99, description: 'Approaching Proficient', color_class: 'grade-c', sort_order: 3 },
  { grade_label: 'D', min_score: 50, max_score: 59.99, description: 'Developing', color_class: 'grade-d', sort_order: 4 },
  { grade_label: 'E', min_score: 40, max_score: 49.99, description: 'Beginning', color_class: 'grade-e', sort_order: 5 },
  { grade_label: 'F', min_score: 0, max_score: 39.99, description: 'Fail', color_class: 'grade-f', sort_order: 6 },
];

const emptyForm = {
  subject_name: '',
  grade_label: '',
  min_score: '',
  max_score: '',
  description: '',
  color_class: 'grade-b',
  sort_order: '',
};

export default function AdminGrading() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: grades }, { data: subjectRows }] = await Promise.all([
        supabase
          .from('grading_systems')
          .select('*')
          .eq('school_id', schoolId)
          .order('sort_order', { ascending: true })
          .order('min_score', { ascending: false }),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
      ]);
      setRows(grades || []);
      setSubjects(subjectRows || []);
    } catch (err) {
      toast.error('Could not load grading systems', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, subject_name: subjectFilter });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      subject_name: row.subject_name || '',
      grade_label: row.grade_label,
      min_score: String(row.min_score),
      max_score: row.max_score != null ? String(row.max_score) : '100',
      description: row.description || '',
      color_class: row.color_class || 'grade-b',
      sort_order: String(row.sort_order || 0),
    });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.grade_label.trim() || form.min_score === '') {
      setError('Grade label and minimum score are required.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        school_id: schoolId,
        subject_name: form.subject_name.trim() || null,
        grade_label: form.grade_label.trim(),
        min_score: parseFloat(form.min_score) || 0,
        max_score: form.max_score !== '' ? parseFloat(form.max_score) : 100,
        description: form.description.trim(),
        color_class: form.color_class,
        sort_order: parseInt(form.sort_order || '0', 10) || 0,
      };
      if (editing) {
        const { error: updateError } = await supabase.from('grading_systems').update(payload).eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Grade updated', `${payload.grade_label} (${payload.subject_name || 'Overall'})`);
      } else {
        const { error: insertError } = await supabase.from('grading_systems').insert([payload]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Grade added', `${payload.grade_label} (${payload.subject_name || 'Overall'})`);
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
    const { error } = await supabase.from('grading_systems').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete grade', error.message);
    else toast.success('Grade deleted', deleting.grade_label);
    setDeleting(null);
    load();
  };

  const resetDefaults = async () => {
    setResetBusy(true);
    try {
      await supabase.from('grading_systems').delete().eq('school_id', schoolId);
      const { error } = await supabase
        .from('grading_systems')
        .insert(DEFAULT_GRADES.map((g) => ({ ...g, school_id: schoolId })));
      if (error) throw new Error(error.message);
      toast.success('Grading reset', 'Restored the default A–F grading system.');
      load();
    } catch (err) {
      toast.error('Could not reset grading', err.message);
    } finally {
      setResetBusy(false);
    }
  };

  const visible = rows.filter((r) => !subjectFilter || r.subject_name === subjectFilter || (r.subject_name === null && !subjectFilter));

  return (
    <div>
      <PageHeader
        title="Grading System"
        subtitle="Configure the grade boundaries used on report cards, per school and per subject."
        icon={Gauge}
        actions={
          <>
            <Button variant="secondary" onClick={resetDefaults} loading={resetBusy}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to defaults
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add grade
            </Button>
          </>
        }
      />

      <div className="mb-5 max-w-xs">
        <Select label="Apply to subject" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
          <option value="">— Overall grading (all subjects) —</option>
          {subjects.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner label="Loading grading systems..." />
      ) : visible.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-extrabold ${GRADE_CLASSES[row.color_class] || 'bg-brand-50 text-brand-700'}`}
                  >
                    {row.grade_label}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{row.grade_label}</p>
                    <p className="text-xs text-slate-400">
                      {row.subject_name ? row.subject_name : 'Overall'} · {row.min_score}–{row.max_score ?? 100}%
                    </p>
                    {row.description ? <p className="mt-0.5 text-xs text-slate-500">{row.description}</p> : null}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit grade">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete grade">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Gauge}
          title="No grades configured"
          message="Add grade boundaries, or reset to the default A–F system."
          action={<Button onClick={resetDefaults}>Reset to defaults</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit grade' : 'Add a grade'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Add grade'}
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
          <Select label="Subject (blank = overall)" value={form.subject_name} onChange={set('subject_name')}>
            <option value="">— Overall —</option>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input label="Grade label *" value={form.grade_label} onChange={set('grade_label')} placeholder="e.g. A" />
          <Input label="Minimum score (%) *" type="number" min="0" max="100" value={form.min_score} onChange={set('min_score')} />
          <Input label="Maximum score (%)" type="number" min="0" max="100" value={form.max_score} onChange={set('max_score')} />
          <Input label="Description" value={form.description} onChange={set('description')} placeholder="e.g. Advance" />
          <Input label="Sort order" type="number" value={form.sort_order} onChange={set('sort_order')} placeholder="1 = highest" />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete grade?"
        message={`This removes grade ${deleting?.grade_label || ''}. Existing results keep their recorded grades.`}
      />
    </div>
  );
}

const GRADE_CLASSES = {
  'grade-a': 'bg-emerald-50 text-emerald-700',
  'grade-b': 'bg-brand-50 text-brand-700',
  'grade-c': 'bg-sky-50 text-sky-700',
  'grade-d': 'bg-amber-50 text-amber-700',
  'grade-e': 'bg-orange-50 text-orange-700',
  'grade-f': 'bg-rose-50 text-rose-700',
};