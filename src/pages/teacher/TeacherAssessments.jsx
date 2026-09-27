import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Eye } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Switch, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate } from '../../lib/format';

const emptyForm = {
  title: '',
  subject: '',
  class_name: '',
  topic: '',
  question_count: '10',
  duration_minutes: '30',
  pass_percentage: '50',
};

export default function TeacherAssessments() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [assessments, setAssessments] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [scores, setScores] = useState(null);
  const [scoresBusy, setScoresBusy] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: a }, { data: s }, { data: c }] = await Promise.all([
        supabase.from('assessments').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setAssessments(a || []);
      setSubjects(s || []);
      setClasses(c || []);
    } catch (err) {
      toast.error('Could not load assessments', err.message);
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
    setForm({ ...emptyForm, subject: subjects[0]?.name || '', class_name: classes[0]?.name || '' });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      title: row.title,
      subject: row.subject,
      class_name: row.class_name || '',
      topic: row.topic || '',
      question_count: String(row.question_count || 10),
      duration_minutes: String(row.duration_minutes || 30),
      pass_percentage: String(row.pass_percentage ?? 50),
    });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.title.trim() || !form.subject) {
      setError('Title and subject are required.');
      return;
    }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        title: form.title.trim(),
        description: '',
        subject: form.subject,
        class_name: form.class_name || null,
        topic: form.topic.trim() || null,
        question_count: parseInt(form.question_count || '10', 10) || 10,
        duration_minutes: parseInt(form.duration_minutes || '30', 10) || 30,
        shuffle_questions: true,
        shuffle_options: true,
        pass_percentage: Math.min(Math.max(parseFloat(form.pass_percentage) || 50, 0), 100),
        is_active: true,
        school_id: schoolId,
        created_by: user?.id || null,
      };
      if (editing) {
        const { error: e } = await supabase.from('assessments').update(payload).eq('id', editing.id);
        if (e) throw new Error(e.message);
        toast.success('Assessment updated', payload.title);
      } else {
        const { error: e } = await supabase.from('assessments').insert([payload]);
        if (e) throw new Error(e.message);
        toast.success('Assessment created', payload.title);
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (row) => {
    const { error } = await supabase.from('assessments').update({ is_published: !row.is_published }).eq('id', row.id);
    if (error) toast.error('Could not update assessment', error.message);
    else {
      toast.success(row.is_published ? 'Assessment unpublished' : 'Assessment published', row.title);
      load();
    }
  };

  const openScores = async (assessment) => {
    setScoresBusy(true);
    try {
      const { data: attempts } = await supabase.from('assessment_attempts').select('*').eq('assessment_id', assessment.id).order('submitted_at', { ascending: false });
      const ids = [...new Set((attempts || []).map((a) => a.student_id).filter(Boolean))];
      let map = {};
      if (ids.length) {
        const { data: apps } = await supabase.from('applications').select('student_id, first_name, middle_name, last_name').in('student_id', ids);
        map = Object.fromEntries((apps || []).map((a) => [a.student_id, a]));
      }
      setScores({
        assessment,
        rows: (attempts || []).map((a) => ({
          ...a,
          studentName: map[a.student_id] ? buildStudentName(map[a.student_id].first_name, map[a.student_id].middle_name, map[a.student_id].last_name) : a.student_id,
        })),
      });
    } catch (err) {
      toast.error('Could not load scores', err.message);
    } finally {
      setScoresBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="My Assessments"
        subtitle="Create and publish multi-choice quizzes for your class."
        icon={ClipboardList}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New assessment
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading assessments..." />
      ) : assessments.length ? (
        <div className="space-y-3">
          {assessments.map((a) => (
            <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <ClipboardList className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{a.title}</p>
                  <p className="text-xs text-slate-400">
                    {a.subject} · {a.class_name || 'All classes'} · {a.question_count} questions · {a.duration_minutes} min
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.is_published ? 'green' : 'slate'}>{a.is_published ? 'Published' : 'Draft'}</Badge>
                <Button size="sm" variant="secondary" onClick={() => openScores(a)}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Scores
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Publish</span>
                  <Switch checked={!!a.is_published} onChange={() => togglePublish(a)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No assessments yet"
          message="Create an assessment for your class. Ask your School Administrator to add questions to the shared question bank."
          action={<Button onClick={openAdd}>New assessment</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit assessment' : 'Create an assessment'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Create assessment'}
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
          <Input label="Title *" value={form.title} onChange={set('title')} className="sm:col-span-2" />
          <Select label="Subject *" value={form.subject} onChange={set('subject')}>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Class" value={form.class_name} onChange={set('class_name')}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Topic" value={form.topic} onChange={set('topic')} />
          <Input label="Question count" type="number" min="1" value={form.question_count} onChange={set('question_count')} />
          <Input label="Duration (minutes)" type="number" min="1" value={form.duration_minutes} onChange={set('duration_minutes')} />
          <Input label="Pass percentage" type="number" min="0" max="100" value={form.pass_percentage} onChange={set('pass_percentage')} />
        </div>
      </Modal>

      <Modal open={!!scores} onClose={() => setScores(null)} title={`Scores — ${scores?.assessment?.title || ''}`} size="lg">
        {scoresBusy ? (
          <Spinner label="Loading scores..." />
        ) : scores?.rows?.length ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {scores.rows.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.studentName}</p>
                  <p className="text-xs text-slate-400">{a.status} · {formatDate(a.submitted_at || a.started_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-800">{a.score ?? '-'}/{a.total_marks ?? '-'}</p>
                  <p className={`text-xs font-semibold ${Number(a.score_percentage) >= Number(a.pass_percentage) ? 'text-emerald-600' : 'text-rose-600'}`}>{a.score_percentage ?? 0}%</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Eye} title="No attempts yet" message="Students who attempt this assessment will appear here." />
        )}
      </Modal>
    </div>
  );
}