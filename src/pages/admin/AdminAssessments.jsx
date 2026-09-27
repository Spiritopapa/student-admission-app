import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Eye, BookOpenCheck, ListChecks } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, Switch } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate } from '../../lib/format';

export default function AdminAssessments() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [tab, setTab] = useState('assessments'); // assessments | bank

  const [assessments, setAssessments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [assessOpen, setAssessOpen] = useState(false);
  const [editingAssess, setEditingAssess] = useState(null);
  const [assessForm, setAssessForm] = useState({
    title: '',
    subject: '',
    class_name: '',
    topic: '',
    question_count: '10',
    duration_minutes: '30',
    shuffle_questions: true,
    shuffle_options: true,
    pass_percentage: '50',
  });
  const [assessBusy, setAssessBusy] = useState(false);
  const [assessError, setAssessError] = useState('');

  const [qOpen, setQOpen] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [qForm, setQForm] = useState({
    subject: '',
    class_name: '',
    topic: '',
    question_text: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_option: 'A',
    explanation: '',
  });
  const [qBusy, setQBusy] = useState(false);
  const [qError, setQError] = useState('');

  const [deletingAssess, setDeletingAssess] = useState(null);
  const [deletingQ, setDeletingQ] = useState(null);
  const [viewingScores, setViewingScores] = useState(null);
  const [scoreRows, setScoreRows] = useState([]);
  const [scoresBusy, setScoresBusy] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: a }, { data: q }, { data: s }, { data: c }] = await Promise.all([
        supabase.from('assessments').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
        supabase.from('assessment_questions').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(500),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setAssessments(a || []);
      setQuestions(q || []);
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

  const setAssess = (key) => (e) => setAssessForm((f) => ({ ...f, [key]: e.target.value }));
  const setQ = (key) => (e) => setQForm((f) => ({ ...f, [key]: e.target.value }));

  const openAddAssess = () => {
    setEditingAssess(null);
    setAssessForm({ title: '', subject: subjects[0]?.name || '', class_name: '', topic: '', question_count: '10', duration_minutes: '30', shuffle_questions: true, shuffle_options: true, pass_percentage: '50' });
    setAssessError('');
    setAssessOpen(true);
  };

  const openEditAssess = (row) => {
    setEditingAssess(row);
    setAssessForm({
      title: row.title,
      subject: row.subject,
      class_name: row.class_name || '',
      topic: row.topic || '',
      question_count: String(row.question_count || 10),
      duration_minutes: String(row.duration_minutes || 30),
      shuffle_questions: !!row.shuffle_questions,
      shuffle_options: !!row.shuffle_options,
      pass_percentage: String(row.pass_percentage ?? 50),
    });
    setAssessError('');
    setAssessOpen(true);
  };

  const saveAssess = async () => {
    setAssessError('');
    if (!assessForm.title.trim() || !assessForm.subject) {
      setAssessError('Title and subject are required.');
      return;
    }
    setAssessBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        title: assessForm.title.trim(),
        description: '',
        subject: assessForm.subject,
        class_name: assessForm.class_name || null,
        topic: assessForm.topic.trim() || null,
        question_count: parseInt(assessForm.question_count || '10', 10) || 10,
        duration_minutes: parseInt(assessForm.duration_minutes || '30', 10) || 30,
        shuffle_questions: !!assessForm.shuffle_questions,
        shuffle_options: !!assessForm.shuffle_options,
        pass_percentage: Math.min(Math.max(parseFloat(assessForm.pass_percentage) || 50, 0), 100),
        is_active: true,
        school_id: schoolId,
        created_by: user?.id || null,
      };
      if (editingAssess) {
        const { error } = await supabase.from('assessments').update(payload).eq('id', editingAssess.id);
        if (error) throw new Error(error.message);
        toast.success('Assessment updated', payload.title);
      } else {
        const { error } = await supabase.from('assessments').insert([payload]);
        if (error) throw new Error(error.message);
        toast.success('Assessment created', `${payload.title}. Add questions to the bank and publish it to students.`);
      }
      setAssessOpen(false);
      load();
    } catch (err) {
      setAssessError(err.message);
    } finally {
      setAssessBusy(false);
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

  const openAddQ = () => {
    setEditingQ(null);
    setQForm({ subject: subjects[0]?.name || '', class_name: '', topic: '', question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'A', explanation: '' });
    setQError('');
    setQOpen(true);
  };

  const openEditQ = (row) => {
    setEditingQ(row);
    setQForm({
      subject: row.subject,
      class_name: row.class_name || '',
      topic: row.topic || '',
      question_text: row.question_text,
      option_a: row.option_a,
      option_b: row.option_b,
      option_c: row.option_c,
      option_d: row.option_d,
      correct_option: row.correct_option,
      explanation: row.explanation || '',
    });
    setQError('');
    setQOpen(true);
  };

  const saveQ = async () => {
    setQError('');
    if (!qForm.subject || !qForm.question_text.trim() || !qForm.option_a.trim() || !qForm.option_b.trim()) {
      setQError('Subject, question text, option A and option B are required.');
      return;
    }
    setQBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        subject: qForm.subject,
        class_name: qForm.class_name || null,
        topic: qForm.topic.trim() || null,
        question_text: qForm.question_text.trim(),
        option_a: qForm.option_a.trim(),
        option_b: qForm.option_b.trim(),
        option_c: qForm.option_c.trim() || '—',
        option_d: qForm.option_d.trim() || '—',
        correct_option: qForm.correct_option,
        explanation: qForm.explanation.trim() || null,
        is_active: true,
        school_id: schoolId,
        created_by: user?.id || null,
      };
      if (editingQ) {
        const { error } = await supabase.from('assessment_questions').update(payload).eq('id', editingQ.id);
        if (error) throw new Error(error.message);
        toast.success('Question updated');
      } else {
        const { error } = await supabase.from('assessment_questions').insert([payload]);
        if (error) throw new Error(error.message);
        toast.success('Question added to the bank');
      }
      setQOpen(false);
      load();
    } catch (err) {
      setQError(err.message);
    } finally {
      setQBusy(false);
    }
  };

  const confirmDeleteAssess = async () => {
    if (!deletingAssess) return;
    const { error } = await supabase.from('assessments').delete().eq('id', deletingAssess.id);
    if (error) toast.error('Could not delete assessment', error.message);
    else toast.success('Assessment deleted', deletingAssess.title);
    setDeletingAssess(null);
    load();
  };

  const confirmDeleteQ = async () => {
    if (!deletingQ) return;
    const { error } = await supabase.from('assessment_questions').delete().eq('id', deletingQ.id);
    if (error) toast.error('Could not delete question', error.message);
    else toast.success('Question deleted');
    setDeletingQ(null);
    load();
  };

  const openScores = async (assessment) => {
    setViewingScores(assessment);
    setScoresBusy(true);
    try {
      const { data: attempts } = await supabase
        .from('assessment_attempts')
        .select('*')
        .eq('assessment_id', assessment.id)
        .order('submitted_at', { ascending: false });
      const ids = [...new Set((attempts || []).map((a) => a.student_id).filter(Boolean))];
      let appMap = {};
      if (ids.length) {
        const { data: apps } = await supabase.from('applications').select('student_id, first_name, middle_name, last_name').in('student_id', ids);
        appMap = Object.fromEntries((apps || []).map((a) => [a.student_id, a]));
      }
      const rows = (attempts || []).map((a) => ({
        ...a,
        studentName: appMap[a.student_id] ? buildStudentName(appMap[a.student_id].first_name, appMap[a.student_id].middle_name, appMap[a.student_id].last_name) : a.student_id,
      }));
      setScoreRows(rows);
    } catch (err) {
      toast.error('Could not load scores', err.message);
    } finally {
      setScoresBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Multi-Choice Assessments"
        subtitle="Build a question bank and run published quizzes for your classes."
        icon={ClipboardList}
        actions={
          tab === 'assessments' ? (
            <Button onClick={openAddAssess}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New assessment
            </Button>
          ) : (
            <Button onClick={openAddQ}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add question
            </Button>
          )
        }
      />

      <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
        {[
          { value: 'assessments', label: 'Assessments' },
          { value: 'bank', label: `Question bank (${questions.length})` },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${tab === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading assessments..." />
      ) : tab === 'assessments' ? (
        assessments.length ? (
          <div className="space-y-3">
            {assessments.map((a) => (
              <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
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
                  <Badge tone="blue">Pass {a.pass_percentage ?? 50}%</Badge>
                  <Button size="sm" variant="secondary" onClick={() => openScores(a)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    Scores
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEditAssess(a)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">Publish</span>
                    <Switch checked={!!a.is_published} onChange={() => togglePublish(a)} />
                  </div>
                  <button type="button" onClick={() => setDeletingAssess(a)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete assessment">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No assessments yet" message="Create an assessment, add questions to the bank, then publish it to your classes." action={<Button onClick={openAddAssess}>New assessment</Button>} />
        )
      ) : questions.length ? (
        <div className="space-y-3">
          {questions.map((q) => (
            <Card key={q.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{q.question_text}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {q.subject} · {q.class_name || 'All classes'} · {q.topic || 'General'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEditQ(q)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit question">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeletingQ(q)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete question">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                <span>A. {q.option_a}</span>
                <span>B. {q.option_b}</span>
                <span>C. {q.option_c}</span>
                <span>D. {q.option_d}</span>
              </div>
              <p className="mt-2 text-xs font-semibold text-emerald-600">Correct: {q.correct_option}</p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={ListChecks} title="No questions yet" message="Add questions to the bank so assessments can draw from them." action={<Button onClick={openAddQ}>Add question</Button>} />
      )}

      <Modal
        open={assessOpen}
        onClose={() => setAssessOpen(false)}
        title={editingAssess ? 'Edit assessment' : 'Create an assessment'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setAssessOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveAssess} loading={assessBusy} className="flex-1">
              {editingAssess ? 'Save changes' : 'Create assessment'}
            </Button>
          </div>
        }
      >
        {assessError ? (
          <Alert tone="error" className="mb-4">
            {assessError}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title *" value={assessForm.title} onChange={setAssess('title')} className="sm:col-span-2" placeholder="e.g. Mathematics Quiz 1" />
          <Select label="Subject *" value={assessForm.subject} onChange={setAssess('subject')}>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Class" value={assessForm.class_name} onChange={setAssess('class_name')}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Topic" value={assessForm.topic} onChange={setAssess('topic')} />
          <Input label="Question count" type="number" min="1" value={assessForm.question_count} onChange={setAssess('question_count')} />
          <Input label="Duration (minutes)" type="number" min="1" value={assessForm.duration_minutes} onChange={setAssess('duration_minutes')} />
          <Input label="Pass percentage" type="number" min="0" max="100" value={assessForm.pass_percentage} onChange={setAssess('pass_percentage')} />
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Shuffle questions</span>
              <Switch checked={!!assessForm.shuffle_questions} onChange={(v) => setAssessForm((f) => ({ ...f, shuffle_questions: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Shuffle answer options</span>
              <Switch checked={!!assessForm.shuffle_options} onChange={(v) => setAssessForm((f) => ({ ...f, shuffle_options: v }))} />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={qOpen}
        onClose={() => setQOpen(false)}
        title={editingQ ? 'Edit question' : 'Add a question'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setQOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveQ} loading={qBusy} className="flex-1">
              {editingQ ? 'Save changes' : 'Add question'}
            </Button>
          </div>
        }
      >
        {qError ? (
          <Alert tone="error" className="mb-4">
            {qError}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Subject *" value={qForm.subject} onChange={setQ('subject')}>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Class" value={qForm.class_name} onChange={setQ('class_name')}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Topic" value={qForm.topic} onChange={setQ('topic')} className="sm:col-span-2" />
          <Input label="Question *" value={qForm.question_text} onChange={setQ('question_text')} className="sm:col-span-2" placeholder="Type the question..." />
          <Input label="Option A *" value={qForm.option_a} onChange={setQ('option_a')} />
          <Input label="Option B *" value={qForm.option_b} onChange={setQ('option_b')} />
          <Input label="Option C" value={qForm.option_c} onChange={setQ('option_c')} />
          <Input label="Option D" value={qForm.option_d} onChange={setQ('option_d')} />
          <Select label="Correct option *" value={qForm.correct_option} onChange={setQ('correct_option')}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </Select>
          <Input label="Explanation" value={qForm.explanation} onChange={setQ('explanation')} />
        </div>
      </Modal>

      <Modal open={!!viewingScores} onClose={() => setViewingScores(null)} title={`Scores — ${viewingScores?.title || ''}`} size="lg">
        {scoresBusy ? (
          <Spinner label="Loading scores..." />
        ) : scoreRows.length ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {scoreRows.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.studentName}</p>
                  <p className="text-xs text-slate-400">
                    {a.status} · {formatDate(a.submitted_at || a.started_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-800">
                    {a.score ?? '-'}/{a.total_marks ?? '-'}
                  </p>
                  <p className={`text-xs font-semibold ${Number(a.score_percentage) >= Number(a.pass_percentage) ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {a.score_percentage ?? 0}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Eye} title="No attempts yet" message="Students who attempt this assessment will appear here." />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingAssess}
        onClose={() => setDeletingAssess(null)}
        onConfirm={confirmDeleteAssess}
        title="Delete assessment?"
        message="This deletes the assessment and all recorded student attempts for it."
      />

      <ConfirmDialog
        open={!!deletingQ}
        onClose={() => setDeletingQ(null)}
        onConfirm={confirmDeleteQ}
        title="Delete question?"
        message="This removes the question from the bank. Published assessments draw fresh questions, so this only affects future attempts."
      />
    </div>
  );
}