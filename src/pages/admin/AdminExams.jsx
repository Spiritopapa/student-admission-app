import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Award, Plus, Pencil, Trash2, ClipboardEdit, ArrowLeft, Save, Download, Upload, Trophy, FileText, GraduationCap, Printer } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate, getSubjectGrade, termLabel } from '../../lib/format';
import { TERMS, TERM_LABELS, currentAcademicYear } from '../../lib/constants';
import { buildCSV, parseCSV } from '../../lib/csv';
import { buildReportCardHTML, buildTranscriptHTML, computeExamRankings } from '../../lib/examReports';

export default function AdminExams() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
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

  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const [rankExam, setRankExam] = useState(null);
  const [rankData, setRankData] = useState(null);
  const [rankBusy, setRankBusy] = useState(false);

  const [reportExam, setReportExam] = useState(null);
  const [reportStudents, setReportStudents] = useState([]);
  const [reportStudentId, setReportStudentId] = useState('');
  const [reportHtml, setReportHtml] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportBatchBusy, setReportBatchBusy] = useState(false);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptStudents, setTranscriptStudents] = useState([]);
  const [transcriptStudentId, setTranscriptStudentId] = useState('');
  const [transcriptHtml, setTranscriptHtml] = useState('');
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptBatchBusy, setTranscriptBatchBusy] = useState(false);

  const [classSubjectRows, setClassSubjectRows] = useState([]);
  const [subjectSelect, setSubjectSelect] = useState('');
  const [reportClassFilter, setReportClassFilter] = useState('');
  const [transcriptClassFilter, setTranscriptClassFilter] = useState('');

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: examRows }, { data: subjectRows }, { data: classRows }, { data: classSubjectData }] = await Promise.all([
        supabase.from('exams').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
        supabase.from('class_subjects').select('class_name, subject_name').eq('school_id', schoolId),
      ]);
      setExams(examRows || []);
      setSubjects(subjectRows || []);
      setClasses(classRows || []);
      setClassSubjectRows(classSubjectData || []);
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
    setExamForm({ name: '', academic_year: settings?.academic_year || currentAcademicYear(), term: 'First', start_date: '', end_date: '', closing_date: '', reopening_date: '' });
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
    setSubjectSelect('');
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', exam.id).order('subject');
    setExamSubjects(rows || []);
    const { data: gradeRows } = await supabase.from('grading_systems').select('*').eq('school_id', schoolId);
    setGrades(gradeRows || []);
  };

  const addExamSubject = async () => {
    const subjectName = subjectSelect.trim();
    if (!subjectName || !workspace) return;
    try {
      // Keep the per-class subject map (Subjects module) in sync so every class
      // has its own subject set, then attach it to this exam.
      if (workspaceClass) {
        await supabase.from('class_subjects').upsert(
          { class_name: workspaceClass, subject_name: subjectName, school_id: schoolId },
          { onConflict: 'school_id,class_name,subject_name' }
        );
      }
      const { error } = await supabase.from('exam_subjects').insert([
        { exam_id: workspace.id, class_name: workspaceClass || null, subject: subjectName },
      ]);
      if (error) throw new Error(error.message);
      setSubjectSelect('');
      const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', workspace.id).order('subject');
      setExamSubjects(rows || []);
      if (workspaceClass) {
        refreshClassSubjects();
        loadMarks();
      }
    } catch (err) {
      toast.error('Could not add subject', err.message);
    }
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

  const subjectOptions = useMemo(() => {
    const classSubjects = classSubjectRows
      .filter((r) => !workspaceClass || r.class_name === workspaceClass)
      .map((r) => r.subject_name);
    const fallback = subjects.map((s) => s.name);
    const names = classSubjects.length ? classSubjects : fallback;
    const added = new Set(examSubjects.map((s) => s.subject.toLowerCase()));
    return [...new Set(names)].filter((n) => !added.has(n.toLowerCase()));
  }, [workspaceClass, classSubjectRows, subjects, examSubjects]);

  const refreshClassSubjects = async () => {
    const { data } = await supabase.from('class_subjects').select('class_name, subject_name').eq('school_id', schoolId);
    setClassSubjectRows(data || []);
  };

  const reportStudentList = reportClassFilter
    ? reportStudents.filter((s) => s.class_applying === reportClassFilter)
    : reportStudents;
  const transcriptStudentList = transcriptClassFilter
    ? transcriptStudents.filter((s) => s.class_applying === transcriptClassFilter)
    : transcriptStudents;

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
    const header = ['Student ID', 'Name'];
    examSubjects.forEach((s) => {
      header.push(`${s.subject} - Class`, `${s.subject} - Exam`, `${s.subject} - Total`);
    });
    const rows = [[...header]];
    marksData.forEach((row) => {
      const cells = [row.student.student_id, buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)];
      examSubjects.forEach((s) => {
        const sc = row.scores[s.subject] || {};
        const cls = sc.classScore !== '' ? String(sc.classScore) : '';
        const esi = sc.examScoreInput !== '' ? String(sc.examScoreInput) : '';
        const tot = cls !== '' || esi !== '' ? Math.min((parseFloat(cls) || 0) + (parseFloat(esi) || 0) / 2, 100).toFixed(2) : '';
        cells.push(cls, esi, tot);
      });
      rows.push(cells);
    });
    downloadBlob(`exam_scores_${(workspace?.name || 'exam').replace(/\s+/g, '_')}_${workspaceClass || 'all'}.csv`, buildCSV(rows));
    toast.success('Scores exported', `${marksData.length} student(s) exported.`);
  };

  const importCsvFile = async (file) => {
    if (!workspace) return;
    try {
      const text = await file.text();
      const parsed = parseCSV(text).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      if (parsed.length < 2) throw new Error('The file must have a header row and at least one data row.');
      const header = parsed[0].map((h) => String(h ?? '').trim());
      const idIdx = header.findIndex((h) => /student\s*id/i.test(h));
      if (idIdx === -1) throw new Error('The CSV must have a "Student ID" column.');
      const subjectCols = new Map();
      header.forEach((h, idx) => {
        const dash = h.indexOf(' - ');
        if (dash > 0) {
          const base = h.slice(0, dash).trim();
          const suffix = h.slice(dash + 3).toLowerCase();
          const entry = subjectCols.get(base.toLowerCase()) || { subject: base, classIdx: -1, examIdx: -1 };
          if (suffix.includes('class')) entry.classIdx = idx;
          else if (suffix.includes('exam')) entry.examIdx = idx;
          subjectCols.set(base.toLowerCase(), entry);
        }
      });
      let updated = 0;
      setMarksData((prev) =>
        prev.map((row) => {
          const match = parsed.find((cells) => String(cells[idIdx] ?? '').trim() === row.student.student_id);
          if (!match) return row;
          const scores = { ...row.scores };
          subjectCols.forEach((entry) => {
            const dbSub = examSubjects
              .map((s) => s.subject)
              .find((s) => s.toLowerCase() === entry.subject.toLowerCase());
            if (!dbSub) return;
            const clsVal = entry.classIdx >= 0 ? String(match[entry.classIdx] ?? '').trim() : '';
            const esiVal = entry.examIdx >= 0 ? String(match[entry.examIdx] ?? '').trim() : '';
            const cur = scores[dbSub] || { classScore: '', examScoreInput: '' };
            if (clsVal !== '') cur.classScore = clsVal.replace(/['"]/g, '');
            if (esiVal !== '') cur.examScoreInput = esiVal.replace(/['"]/g, '');
            scores[dbSub] = cur;
          });
          updated += 1;
          return { ...row, scores };
        })
      );
      toast.success('CSV imported', `Updated scores for ${updated} student(s). Click "Save results" to persist.`);
    } catch (err) {
      toast.error('Could not import CSV', err.message);
    }
  };

  const printHtmlDoc = (title, fullHtml) => {
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) {
      toast.error('Pop-up blocked', 'Allow pop-ups to print report cards.');
      return;
    }
    win.document.write(fullHtml);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch (err) {
        // ignore
      }
    }, 600);
  };

  const downloadBlob = (filename, text) => {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fetchAdmittedStudents = async () => {
    const { data } = await supabase
      .from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying')
      .eq('school_id', schoolId)
      .eq('status', 'admitted')
      .order('first_name');
    return data || [];
  };

  const openRankings = async (exam) => {
    setRankExam(exam);
    setRankData(null);
    setRankBusy(true);
    try {
      const data = await computeExamRankings({ examId: exam.id, schoolId });
      setRankData(data);
    } catch (err) {
      toast.error('Could not load rankings', err.message);
    } finally {
      setRankBusy(false);
    }
  };

  const openReports = async (exam) => {
    setReportExam(exam);
    setReportStudentId('');
    setReportHtml('');
    setReportStudents(await fetchAdmittedStudents());
  };

  const previewReport = async () => {
    if (!reportExam || !reportStudentId) {
      toast.error('Select a student', 'Choose a student from the list to preview.');
      return;
    }
    setReportBusy(true);
    try {
      const html = await buildReportCardHTML({ examId: reportExam.id, studentId: reportStudentId, schoolId });
      setReportHtml(html);
    } catch (err) {
      toast.error('Could not build report card', err.message);
    } finally {
      setReportBusy(false);
    }
  };

  const printReport = () => {
    if (!reportHtml) return;
    printHtmlDoc('Report Card', reportHtml);
  };

  const batchPrintReports = async () => {
    if (!reportExam) return;
    const list = reportClassFilter
      ? reportStudents.filter((s) => s.class_applying === reportClassFilter)
      : reportStudents;
    if (!list.length) return;
    setReportBatchBusy(true);
    try {
      const docs = [];
      for (const s of list) {
        try {
          const html = await buildReportCardHTML({ examId: reportExam.id, studentId: s.student_id, schoolId });
          if (html.includes('class="rc"')) docs.push(html);
        } catch (err) {
          // skip students without data
        }
      }
      if (!docs.length) throw new Error('No report cards could be generated.');
      printHtmlDoc('Report Cards - All Students', docs.join('<div style="page-break-after:always;"></div>'));
    } catch (err) {
      toast.error('Batch print failed', err.message);
    } finally {
      setReportBatchBusy(false);
    }
  };

  const openTranscripts = async () => {
    setTranscriptOpen(true);
    setTranscriptStudentId('');
    setTranscriptHtml('');
    setTranscriptStudents(await fetchAdmittedStudents());
  };

  const previewTranscript = async () => {
    if (!transcriptStudentId) {
      toast.error('Select a student', 'Choose a student from the list to preview.');
      return;
    }
    setTranscriptBusy(true);
    try {
      const html = await buildTranscriptHTML({ studentId: transcriptStudentId, schoolId });
      setTranscriptHtml(html);
    } catch (err) {
      toast.error('Could not build transcript', err.message);
    } finally {
      setTranscriptBusy(false);
    }
  };

  const printTranscript = () => {
    if (!transcriptHtml) return;
    printHtmlDoc('Academic Transcript', transcriptHtml);
  };

  const batchPrintTranscripts = async () => {
    const list = transcriptClassFilter
      ? transcriptStudents.filter((s) => s.class_applying === transcriptClassFilter)
      : transcriptStudents;
    if (!list.length) return;
    setTranscriptBatchBusy(true);
    try {
      const docs = [];
      for (const s of list) {
        try {
          const html = await buildTranscriptHTML({ studentId: s.student_id, schoolId });
          if (html.includes('class="rc"')) docs.push(html);
        } catch (err) {
          // skip
        }
      }
      if (!docs.length) throw new Error('No transcripts could be generated.');
      printHtmlDoc('Academic Transcripts - All Students', docs.join('<div style="page-break-after:always;"></div>'));
    } catch (err) {
      toast.error('Batch print failed', err.message);
    } finally {
      setTranscriptBatchBusy(false);
    }
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
              <Button variant="secondary" onClick={() => importInputRef.current?.click()} loading={importing}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Import CSV
              </Button>
              <input hidden ref={importInputRef} type="file" accept=".csv,text/csv" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) importCsvFile(file);
              }} />
              <Button variant="secondary" onClick={exportCsv} disabled={!marksData.length}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export CSV
              </Button>
              <Button variant="secondary" onClick={() => openRankings(workspace)}>
                <Trophy className="h-4 w-4" aria-hidden="true" />
                Rankings
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
            <Select label="Class *" value={workspaceClass} onChange={(e) => { setWorkspaceClass(e.target.value); setSubjectSelect(''); }}>
              <option value="">Select class...</option>
              {classes.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:flex-1">
            <Select label="Add a subject to this exam" value={subjectSelect} onChange={(e) => setSubjectSelect(e.target.value)}>
              <option value="">{subjectOptions.length ? 'Select a subject...' : 'No subjects available - add them in the Subjects module first.'}</option>
              {subjectOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-400">
              {workspaceClass
                ? `Showing the subjects assigned to ${workspaceClass} (Subjects module). Adding one also assigns it to this class.`
                : 'Select a class to show that class\'s subjects, or pick from all school subjects.'}
            </p>
          </div>
          <div className="flex items-end">
            <Button variant="secondary" onClick={addExamSubject} disabled={!subjectSelect}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
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
          ) : marksData.length && examSubjects.length ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="min-w-[190px] px-3 py-2.5 text-left">Student</th>
                    {examSubjects.map((s) => (
                      <th key={s.subject} colSpan={2} className="min-w-[118px] border-l border-slate-100 px-2 py-2.5 text-center font-bold text-slate-700">
                        {s.subject}
                      </th>
                    ))}
                    <th className="min-w-[80px] border-l border-slate-100 px-2 py-2.5 text-center">Average</th>
                    <th className="min-w-[72px] px-2 py-2.5 text-center">Grade</th>
                  </tr>
                  <tr>
                    <th />
                    {examSubjects.map((s) => (
                      <Fragment key={s.subject}>
                        <th className="border-l border-slate-100 px-1 py-1 text-center font-normal text-slate-400">Class (50)</th>
                        <th className="px-1 py-1 text-center font-normal text-slate-400">Exam (100)</th>
                      </Fragment>
                    ))}
                    <th colSpan={2} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marksData.map((row, studentIndex) => {
                    let sum = 0;
                    let count = 0;
                    examSubjects.forEach((sbj) => {
                      const sc = row.scores[sbj.subject] || {};
                      const tot =
                        sc.classScore !== '' || sc.examScoreInput !== ''
                          ? Math.min((parseFloat(sc.classScore) || 0) + (parseFloat(sc.examScoreInput) || 0) / 2, 100)
                          : null;
                      if (tot != null) {
                        sum += tot;
                        count += 1;
                      }
                    });
                    const avg = count ? sum / count : null;
                    const avgGrade = getSubjectGrade(avg || 0).grade;
                    return (
                      <tr key={row.student.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-slate-800">
                            {buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)}
                          </p>
                          <p className="font-mono text-xs text-slate-400">{row.student.student_id}</p>
                        </td>
                        {examSubjects.map((sbj) => {
                          const sc = row.scores[sbj.subject] || { classScore: '', examScoreInput: '' };
                          return (
                            <Fragment key={sbj.subject}>
                              <td className="border-l border-slate-100 px-1 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  max="50"
                                  value={sc.classScore}
                                  onChange={(e) => setScore(studentIndex, sbj.subject, 'classScore', e.target.value)}
                                  className="input h-8 w-full rounded-lg px-1.5 text-center text-xs"
                                  placeholder="0-50"
                                />
                              </td>
                              <td className="px-1 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={sc.examScoreInput}
                                  onChange={(e) => setScore(studentIndex, sbj.subject, 'examScoreInput', e.target.value)}
                                  className="input h-8 w-full rounded-lg px-1.5 text-center text-xs"
                                  placeholder="0-100"
                                />
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className="border-l border-slate-100 px-2 py-2 text-center font-bold text-slate-700">
                          {avg != null ? avg.toFixed(1) : '—'}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <Badge tone={avg != null && avg >= 50 ? 'green' : 'amber'}>{avgGrade}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : marksData.length === 0 ? (
            <EmptyState icon={ClipboardEdit} title="No students in this class" message="This class has no students to enter marks for." />
          ) : (
            <EmptyState icon={ClipboardEdit} title="No subjects yet" message="Add at least one subject above to start entering scores." />
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
                <Button size="sm" variant="secondary" onClick={() => openRankings(exam)}>
                  <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                  Rankings
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openReports(exam)}>
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Report cards
                </Button>
                <Button size="sm" variant="secondary" onClick={openTranscripts}>
                  <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                  Transcripts
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

      <Modal
        open={!!rankExam}
        onClose={() => setRankExam(null)}
        title={rankExam ? `Rankings - ${rankExam.name}` : 'Rankings'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setRankExam(null)} className="flex-1">
              Close
            </Button>
          </div>
        }
      >
        {rankBusy ? (
          <Spinner label="Computing rankings..." />
        ) : rankData && (rankData.overall.length || rankData.subjects.length) ? (
          <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
            {rankData.overall.length ? (
              <div>
                <h4 className="text-sm font-bold text-slate-800">Overall ranking by class</h4>
                {rankData.overall.map((group) => (
                  <div key={group.cls} className="mt-3 rounded-xl border border-slate-100 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.cls}</p>
                    <table className="mt-2 w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="py-1 pr-2">Pos</th>
                          <th className="py-1 pr-2">Student</th>
                          <th className="py-1 pr-2 text-right">Average</th>
                          <th className="py-1 text-center">Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {group.rows.map((r) => (
                          <tr key={r.student_id}>
                            <td className="py-1.5 pr-2 font-semibold text-slate-500">
                              {r.position === 1 ? '🥇' : r.position === 2 ? '🥈' : r.position === 3 ? '🥉' : `${r.position}th`}
                            </td>
                            <td className="py-1.5 pr-2 font-semibold text-slate-700">{r.name}</td>
                            <td className="py-1.5 pr-2 text-right font-bold text-slate-700">{r.avg.toFixed(1)}%</td>
                            <td className="py-1.5 text-center">
                              <Badge tone={r.grade >= 'B' ? 'green' : 'amber'}>{r.grade}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : null}
            {rankData.subjects.length ? (
              <div>
                <h4 className="text-sm font-bold text-slate-800">Subject rankings</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {rankData.subjects.map((sub) => (
                    <div key={sub.subject} className="rounded-xl border border-slate-100 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{sub.subject}</p>
                      <table className="mt-2 w-full text-left text-sm">
                        <thead className="text-xs text-slate-400">
                          <tr>
                            <th className="py-1 pr-2">Pos</th>
                            <th className="py-1 pr-2">Student</th>
                            <th className="py-1 text-right">Marks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {sub.rows.slice(0, 8).map((r) => (
                            <tr key={r.student_id}>
                              <td className="py-1 pr-2 font-semibold text-slate-500">
                                {r.position === 1 ? '🥇' : r.position === 2 ? '🥈' : r.position === 3 ? '🥉' : `${r.position}th`}
                              </td>
                              <td className="truncate py-1 pr-2 font-medium text-slate-700" title={r.name}>{r.name}</td>
                              <td className="py-1 text-right font-bold text-slate-700">{r.marks.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Alert tone="info">No results recorded for this exam yet.</Alert>
        )}
      </Modal>
<Modal
        open={!!reportExam}
        onClose={() => setReportExam(null)}
        title={reportExam ? `Report Cards - ${reportExam.name}` : 'Report Cards'}
        size="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={reportBatchBusy} onClick={batchPrintReports} disabled={!reportStudentList.length}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {reportClassFilter ? reportClassFilter : 'all'} ({reportStudentList.length})
            </Button>
            <Button onClick={printReport} disabled={!reportHtml}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
            <Button variant="secondary" onClick={() => setReportExam(null)}>
              Close
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Class filter (bulk print)"
            value={reportClassFilter}
            onChange={(e) => {
              setReportClassFilter(e.target.value);
              setReportStudentId('');
              setReportHtml('');
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Student"
            value={reportStudentId}
            onChange={(e) => {
              setReportStudentId(e.target.value);
              setReportHtml('');
            }}
          >
            <option value="">Select student...</option>
            {reportStudentList.map((s) => (
              <option key={s.student_id} value={s.student_id}>
                {buildStudentName(s.first_name, s.middle_name, s.last_name)} · {s.class_applying}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button onClick={previewReport} loading={reportBusy} className="w-full">
              Preview report card
            </Button>
          </div>
        </div>
        {reportHtml ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <iframe title="Report preview" srcDoc={reportHtml} className="h-[65vh] w-full bg-white" />
          </div>
        ) : null}
      </Modal>
<Modal
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        title="Academic Transcripts"
        size="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={transcriptBatchBusy} onClick={batchPrintTranscripts} disabled={!transcriptStudentList.length}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {transcriptClassFilter ? transcriptClassFilter : 'all'} ({transcriptStudentList.length})
            </Button>
            <Button onClick={printTranscript} disabled={!transcriptHtml}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
            <Button variant="secondary" onClick={() => setTranscriptOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Class filter (bulk print)"
            value={transcriptClassFilter}
            onChange={(e) => {
              setTranscriptClassFilter(e.target.value);
              setTranscriptStudentId('');
              setTranscriptHtml('');
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Student"
            value={transcriptStudentId}
            onChange={(e) => {
              setTranscriptStudentId(e.target.value);
              setTranscriptHtml('');
            }}
          >
            <option value="">Select student...</option>
            {transcriptStudentList.map((s) => (
              <option key={s.student_id} value={s.student_id}>
                {buildStudentName(s.first_name, s.middle_name, s.last_name)} · {s.class_applying}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button onClick={previewTranscript} loading={transcriptBusy} className="w-full">
              Preview transcript
            </Button>
          </div>
        </div>
        {transcriptHtml ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <iframe title="Transcript preview" srcDoc={transcriptHtml} className="h-[65vh] w-full bg-white" />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}