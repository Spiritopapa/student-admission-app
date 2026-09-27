import { useEffect, useMemo, useState } from 'react';
import { Award, Plus, Pencil, Trash2, ClipboardEdit, ArrowLeft, Save, Download } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate, getSubjectGrade } from '../../lib/format';
import { TERMS, TERM_LABELS, currentAcademicYear } from '../../lib/constants';

export default function AdminExams() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);

  const [examOpen, setExamOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [examForm, setExamForm] = useState({ name: '', academic_year: currentAcademicYear(), term: 'First', start_date: '', end_date: '', closing_date: '', reopening_date: '' });
  const [examBusy, setExamBusy] = useState(false);
  const [examError, setExamError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const [subjects, setSubjects] = useState([]);
  const [workspace, setWorkspace] = useState(null); // exam object we're entering marks for
  const [examSubjects, setExamSubjects] = useState([]);
  const [subjectInput, setSubjectInput] = useState('');
  const [classes, setClasses] = useState([]);
  const [workspaceClass, setWorkspaceClass] = useState('');
  const [marksData, setMarksData] = useState([]); // { student, scores: {subject: {classScore, examScoreInput}} }
  const [grades, setGrades] = useState([]);
  const [savingMarks, setSavingMarks] = useState(false);
  const [resultsLoaded, setResultsLoaded] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: examRows }, { data: subjectRows }, { data: classRows }] = await Promise.all([
        supabase.from('exams').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setExams(examRows || []);
      setSubjects(subjectRows || []);
      setClasses(classRows || []);
    } catch (err) {
      toast.error('Could not load exams', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const set = (key) => (e) => setExamForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = () => {
    setEditing(null);
    setExamForm({ name: '', academic_year: currentAcademicYear(), term: 'First', start_date: '', end_date: '', closing_date: '', reopening_date: '' });
    setExamError('');
    setExamOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setExamForm({
      name: row.name,
      academic_year: row.academic_year,
      term: row.term || 'First',
      start_date: row.start_date || '',
      end_date: row.end_date || '',
      closing_date: row.closing_date || '',
      reopening_date: row.reopening_date || '',
    });
    setExamError('');
    setExamOpen(true);
  };

  const saveExam = async () => {
    setExamError('');
    if (!examForm.name.trim()) {
      setExamError('Exam name is required.');
      return;
    }
    setExamBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = { ...examForm, name: examForm.name.trim(), school_id: schoolId, created_by: user?.id || null };
      if (editing) {
        const { error } = await supabase.from('exams').update(payload).eq('id', editing.id);
        if (error) throw new Error(error.message);
        toast.success('Exam updated', payload.name);
      } else {
        const { error } = await supabase.from('exams').insert([payload]);
        if (error) throw new Error(error.message);
        toast.success('Exam created', payload.name);
      }
      setExamOpen(false);
      load();
    } catch (err) {
      setExamError(err.message);
    } finally {
      setExamBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('exams').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete exam', error.message);
    else toast.success('Exam deleted', deleting.name);
    setDeleting(null);
    load();
  };

  const openWorkspace = async (exam) => {
    setWorkspace(exam);
    setWorkspaceClass('');
    setExamSubjects([]);
    setMarksData([]);
    setResultsLoaded(false);
    setSubjectInput('');
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', exam.id).order('subject');
    setExamSubjects(rows || []);
    const { data: gradeRows } = await supabase.from('grading_systems').select('*').eq('school_id', schoolId);
    setGrades(gradeRows || []);
  };

  const addExamSubject = async () => {
    if (!subjectInput.trim() || !workspace) return;
    const { error } = await supabase.from('exam_subjects').insert([{ exam_id: workspace.id, class_name: workspaceClass || null, subject: subjectInput.trim() }]);
    if (error) {
      toast.error('Could not add subject', error.message);
      return;
    }
    setSubjectInput('');
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', workspace.id).order('subject');
    setExamSubjects(rows || []);
    if (workspaceClass) loadMarks();
  };

  const removeExamSubject = async (id) => {
    await supabase.from('exam_subjects').delete().eq('id', id);
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', workspace.id).order('subject');
    setExamSubjects(rows || []);
    if (workspaceClass) loadMarks();
  };

  const loadMarks = async () => {
    if (!workspace || !workspaceClass) return;
    setResultsLoaded(false);
    const [{ data: students }, { data: results }] = await Promise.all([
      supabase
        .from('applications')
        .select('id, student_id, first_name, middle_name, last_name')
        .eq('school_id', schoolId)
        .eq('class_applying', workspaceClass)
        .order('last_name'),
      supabase.from('exam_results').select('*').eq('exam_id', workspace.id),
    ]);
    const resultMap = new Map((results || []).map((r) => [`${r.student_id}|${r.subject}`, r]));
    const data = (students || []).map((student) => ({
      student,
      scores: Object.fromEntries(
        examSubjects.map((sbj) => {
          const existing = resultMap.get(`${student.student_id}|${sbj.subject}`);
          return [
            sbj.subject,
            {
              classScore: existing?.class_score != null ? String(existing.class_score) : '',
              examScoreInput: existing?.exam_score_input != null ? String(existing.exam_score_input) : existing?.exam_score != null ? String(existing.exam_score * 2) : '',
            },
          ];
        })
      ),
    }));
    setMarksData(data);
    setResultsLoaded(true);
  };

  useEffect(() => {
    if (workspace && workspaceClass) loadMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceClass, workspace]);

  const gradeFor = (subject, marks) => {
    const row =
      grades.find((g) => g.subject_name === subject && marks >= g.min_score && marks <= (g.max_score ?? 100)) ||
      grades.find((g) => g.subject_name === null && marks >= g.min_score && marks <= (g.max_score ?? 100));
    return row?.grade_label || getSubjectGrade(marks).grade;
  };

  const setScore = (studentIndex, subject, field, value) => {
    setMarksData((prev) => {
      const next = [...prev];
      const score = { ...next[studentIndex].scores[subject], [field]: value };
      next[studentIndex] = { ...next[studentIndex], scores: { ...next[studentIndex].scores, [subject]: score } };
      return next;
    });
  };

  const saveAllResults = async () => {
    if (!workspace) return;
    setSavingMarks(true);
    try {
      const upserts = [];
      const detailUpserts = [];
      for (const row of marksData) {
        let totalMarks = 0;
        let count = 0;
        for (const sbj of examSubjects) {
          const sc = row.scores[sbj.subject];
          if (sc && (sc.classScore !== '' || sc.examScoreInput !== '')) {
            const cls = sc.classScore === '' ? null : Math.min(parseFloat(sc.classScore) || 0, 50);
            const esi = sc.examScoreInput === '' ? null : Math.min(parseFloat(sc.examScoreInput) || 0, 100);
            const es = esi !== null ? esi / 2 : null;
            const total = Math.min((cls || 0) + (es || 0), 100);
            totalMarks += total;
            count += 1;
            upserts.push({
              exam_id: workspace.id,
              student_id: row.student.student_id,
              subject: sbj.subject,
              class_score: cls,
              exam_score_input: esi,
              exam_score: es,
              marks_obtained: total,
              grade: gradeFor(sbj.subject, total),
              school_id: schoolId,
            });
          }
        }
        if (count > 0) {
          const average = totalMarks / count;
          const remarks =
            average >= 80 ? 'Excellent performance! Keep up the great work.' : average >= 70 ? 'Very good performance.' : average >= 60 ? 'Good performance.' : average >= 40 ? 'Satisfactory but needs improvement.' : 'Requires urgent attention.';
          detailUpserts.push({ exam_id: workspace.id, student_id: row.student.student_id, interest: 'mathematics', attitude: 'active', class_teacher_remarks: remarks });
        }
      }
      if (upserts.length) {
        const { error } = await supabase.from('exam_results').upsert(upserts, { onConflict: 'exam_id,student_id,subject' });
        if (error) throw new Error(error.message);
      }
      for (const d of detailUpserts) {
        await supabase.from('exam_student_details').upsert(d, { onConflict: 'exam_id,student_id' });
      }
      toast.success('Results saved', `${upserts.length} subject scores recorded.`);
    } catch (err) {
      toast.error('Could not save results', err.message);
    } finally {
      setSavingMarks(false);
    }
  };

  const exportCsv = () => {
    if (!marksData.length) return;
    const lines = [];
    lines.push(['Student ID', 'Name', ...examSubjects.map((s) => s.subject)].join(','));
    marksData.forEach((row) => {
      const totals = examSubjects.map((s) => {
        const sc = row.scores[s.subject];
        if (!sc || (sc.classScore === '' && sc.examScoreInput === '')) return '';
        return Math.min((parseFloat(sc.classScore) || 0) + (parseFloat(sc.examScoreInput) || 0) / 2, 100);
      });
      lines.push([row.student.student_id, buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name).replace(/,/g, ' '), ...totals].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam_scores_${workspace?.name || 'exam'}_${workspaceClass || 'class'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (workspace) {
    return (
      <div>
        <PageHeader
          title={`Enter Marks — ${workspace.name}`}
          subtitle={`${workspace.academic_year} · ${termLabel(workspace.term)}`}
          icon={ClipboardEdit}
          actions={
            <>
              <Button variant="secondary" onClick={exportCsv} disabled={!marksData.length}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export CSV
              </Button>
              <Button onClick={saveAllResults} loading={savingMarks}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Save results
              </Button>
              <Button variant="ghost" onClick={() => setWorkspace(null)}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to exams
              </Button>
            </>
          }
        />

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-xs">
            <Select label="Class *" value={workspaceClass} onChange={(e) => setWorkspaceClass(e.target.value)}>
              <option value="">Select class...</option>
              {classes.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex w-full gap-2 sm:max-w-sm">
            <Input label="Add subject to this exam" value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)} placeholder={examSubjects.length ? 'Another subject...' : 'e.g. Mathematics'} />
            <div className="flex items-end">
              <Button variant="secondary" onClick={addExamSubject} disabled={!subjectInput.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        {examSubjects.length ? (
          <div className="mb-5 flex flex-wrap gap-2">
            {examSubjects.map((sbj) => (
              <span key={sbj.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                {sbj.subject}
                <button type="button" onClick={() => removeExamSubject(sbj.id)} className="rounded-full bg-white p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${sbj.subject}`}>
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-400">Add at least one subject to this exam before entering marks.</p>
        )}

        {workspaceClass ? (
          !resultsLoaded ? (
            <Spinner label="Loading scoresheet..." />
          ) : marksData.length ? (
            <div className="space-y-4">
              {marksData.map((row, studentIndex) => (
                <Card key={row.student.id} className="p-4">
                  <div className="mb-3 border-b border-slate-50 pb-2">
                    <p className="text-sm font-bold text-slate-800">{buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)}</p>
                    <p className="font-mono text-xs text-slate-400">{row.student.student_id}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {examSubjects.map((sbj) => {
                      const sc = row.scores[sbj.subject] || { classScore: '', examScoreInput: '' };
                      const total = sc.classScore !== '' || sc.examScoreInput !== '' ? Math.min((parseFloat(sc.classScore) || 0) + (parseFloat(sc.examScoreInput) || 0) / 2, 100) : null;
                      return (
                        <div key={sbj.subject} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                          <p className="text-xs font-bold text-slate-600">{sbj.subject}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Input label="Class (≤50)" type="number" min="0" max="50" value={sc.classScore} onChange={(e) => setScore(studentIndex, sbj.subject, 'classScore', e.target.value)} />
                            <Input label="Exam (≤100)" type="number" min="0" max="100" value={sc.examScoreInput} onChange={(e) => setScore(studentIndex, sbj.subject, 'examScoreInput', e.target.value)} />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Total:{' '}
                            <b className={total != null ? (total >= 50 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400'}>
                              {total != null ? `${total.toFixed(2)}% · ${gradeFor(sbj.subject, total)}` : '—'}
                            </b>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState icon={ClipboardEdit} title="No students in this class" message="This class has no students to enter marks for." />
          )
        ) : (
          <EmptyState icon={ClipboardEdit} title="Pick a class" message="Select a class to begin entering marks." />
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Examinations"
        subtitle="Create exams, add subjects, and enter marks for report cards."
        icon={Award}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New exam
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading exams..." />
      ) : exams.length ? (
        <div className="space-y-3">
          {exams.map((exam) => (
            <Card key={exam.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-accent-600">
                  <Award className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{exam.name}</p>
                  <p className="text-xs text-slate-400">
                    {exam.academic_year} · {termLabel(exam.term)}
                    {exam.start_date ? ` · Starts ${formatDate(exam.start_date)}` : ''}
                    {exam.end_date ? ` · Ends ${formatDate(exam.end_date)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={exam.is_active ? 'green' : 'slate'}>{exam.is_active ? 'Active' : 'Inactive'}</Badge>
                <Button size="sm" onClick={() => openWorkspace(exam)}>
                  <ClipboardEdit className="h-3.5 w-3.5" aria-hidden="true" />
                  Enter marks
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openEdit(exam)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
                <button type="button" onClick={() => setDeleting(exam)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete exam">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Award} title="No exams yet" message="Create an exam to start recording report card scores." action={<Button onClick={openAdd}>New exam</Button>} />
      )}

      <Modal
        open={examOpen}
        onClose={() => setExamOpen(false)}
        title={editing ? 'Edit exam' : 'Create an exam'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setExamOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveExam} loading={examBusy} className="flex-1">
              {editing ? 'Save changes' : 'Create exam'}
            </Button>
          </div>
        }
      >
        {examError ? (
          <Alert tone="error" className="mb-4">
            {examError}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Exam name *" value={examForm.name} onChange={set('name')} placeholder="e.g. End of Term Exams" className="sm:col-span-2" />
          <Input label="Academic year" value={examForm.academic_year} onChange={set('academic_year')} />
          <Select label="Term" value={examForm.term} onChange={set('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {TERM_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input label="Start date" type="date" value={examForm.start_date} onChange={set('start_date')} />
          <Input label="End date" type="date" value={examForm.end_date} onChange={set('end_date')} />
          <Input label="Closing date" type="date" value={examForm.closing_date} onChange={set('closing_date')} />
          <Input label="Reopening date" type="date" value={examForm.reopening_date} onChange={set('reopening_date')} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete exam?"
        message="This permanently deletes the exam together with all its subject scores and student results."
        confirmLabel="Delete exam"
      />
    </div>
  );
}