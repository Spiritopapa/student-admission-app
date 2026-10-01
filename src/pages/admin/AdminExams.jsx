import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Award, Plus, Pencil, Trash2, ClipboardEdit, ArrowLeft, Save, Download, Upload,
  Trophy, FileText, GraduationCap, Printer, CheckCircle2, Users, RefreshCw,
} from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, StatCard, SearchInput } from '../../components/ui';
import { Modal, ConfirmDialog, Alert, Tabs } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate, getSubjectGrade, termLabel } from '../../lib/format';
import { TERMS, TERM_LABELS, currentAcademicYear } from '../../lib/constants';
import { buildCSV, parseCSV } from '../../lib/csv';
import { buildReportCardHTML, buildTranscriptHTML, computeExamRankings } from '../../lib/examReports';

const GRADE_CLASSES = {
  'grade-a': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  'grade-b': 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  'grade-c': 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  'grade-d': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'grade-e': 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  'grade-f': 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const EMPTY_META = { subjectCount: 0, classCoverage: 0, classNames: [], results: 0, recordedSlots: 0, expectedSlots: 0, students: 0 };

function examStatus(exam, meta) {
  const today = new Date().toISOString().slice(0, 10);
  if (exam.is_active === false) return { label: 'Archived', tone: 'slate' };
  if (!meta.subjectCount) return { label: 'Draft', tone: 'slate' };
  if (exam.start_date && exam.start_date > today) return { label: 'Scheduled', tone: 'blue' };
  if (exam.end_date && exam.end_date < today) return { label: 'Results closed', tone: 'amber' };
  return { label: 'In progress', tone: 'teal' };
}

function completionPct(meta) {
  if (!meta.expectedSlots) return meta.results ? 100 : 0;
  return Math.round(Math.min((meta.recordedSlots / meta.expectedSlots) * 100, 100));
}

export default function AdminExams() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [exams, setExams] = useState([]);
  const [examMeta, setExamMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [examOpen, setExamOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [examForm, setExamForm] = useState({ name: '', academic_year: currentAcademicYear(), term: 'First', start_date: '', end_date: '', closing_date: '', reopening_date: '' });
  const [examBusy, setExamBusy] = useState(false);
  const [examError, setExamError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [examSubjects, setExamSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [workspaceClass, setWorkspaceClass] = useState('');
  const [marksData, setMarksData] = useState([]);
  const [grades, setGrades] = useState([]);
  const [savingMarks, setSavingMarks] = useState(false);
  const [resultsLoaded, setResultsLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [marksQuery, setMarksQuery] = useState('');
  const [displaySubject, setDisplaySubject] = useState('');
  const [syncing, setSyncing] = useState(false);
  const sheetRef = useRef(null);
  const namesRef = useRef(null);
  const headerRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);
  const [rankExam, setRankExam] = useState(null);
  const [rankData, setRankData] = useState(null);
  const [rankBusy, setRankBusy] = useState(false);
  const [rankClass, setRankClass] = useState('');
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
  const [reportClassFilter, setReportClassFilter] = useState('');
  const [transcriptClassFilter, setTranscriptClassFilter] = useState('');

  // Subjects that apply to the selected class: class-specific rows plus
  // legacy rows with no class ("applies to all classes").
  const visibleSubjectsForWorkspace = () => {
    if (!workspace || !workspaceClass) return examSubjects;
    return examSubjects.filter((s) => !s.class_name || s.class_name === workspaceClass);
  };

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [
        { data: examRows },
        { data: classRows },
        { data: resultRows },
        { data: examSubjectRows },
        { data: appRows },
      ] = await Promise.all([
        supabase.from('exams').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
        supabase.from('exam_results').select('exam_id, student_id, subject').eq('school_id', schoolId),
        supabase.from('exam_subjects').select('exam_id, class_name, subject'),
        supabase.from('applications').select('class_applying').eq('school_id', schoolId).eq('status', 'admitted'),
      ]);
      setExams(examRows || []);
      setClasses(classRows || []);

      // Completion / coverage metrics per exam (read-only workload analysis).
      const studentsByClass = {};
      (appRows || []).forEach((a) => {
        studentsByClass[a.class_applying] = (studentsByClass[a.class_applying] || 0) + 1;
      });
      const byExam = {};
      (examRows || []).forEach((ex) => {
        byExam[ex.id] = { subjects: new Set(), classes: new Set(), coversAll: false, results: 0, recorded: new Set() };
      });
      (examSubjectRows || []).forEach((es) => {
        const m = byExam[es.exam_id];
        if (!m) return;
        m.subjects.add(es.subject);
        if (es.class_name) m.classes.add(es.class_name);
        else m.coversAll = true;
      });
      (resultRows || []).forEach((r) => {
        const m = byExam[r.exam_id];
        if (!m) return;
        m.results += 1;
        m.recorded.add(`${r.student_id}|${r.subject}`);
      });
      const meta = {};
      (examRows || []).forEach((ex) => {
        const m = byExam[ex.id];
        const subjectCount = m.subjects.size;
        const covered = m.coversAll ? new Set(Object.keys(studentsByClass)) : m.classes;
        let students = 0;
        covered.forEach((c) => {
          students += studentsByClass[c] || 0;
        });
        meta[ex.id] = {
          subjectCount,
          classCoverage: covered.size,
          classNames: [...covered],
          results: m.results,
          recordedSlots: subjectCount ? m.recorded.size : 0,
          expectedSlots: subjectCount * students,
          students,
        };
      });
      setExamMeta(meta);
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
    setDirty(false);
    setLastSavedAt(null);
    setMarksQuery('');
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', exam.id).order('subject');
    setExamSubjects(rows || []);
    const { data: gradeRows } = await supabase.from('grading_systems').select('*').eq('school_id', schoolId);
    setGrades(gradeRows || []);
  };

  const syncClassSubjects = async (cls) => {
    if (!workspace || !cls) return;
    try {
      // Pull subjects straight from the Subjects module (class_subjects) so the
      // exam workspace mirrors class assignments without manual re-adding.
      const [{ data: classSubs }, { data: current }] = await Promise.all([
        supabase.from('class_subjects').select('subject_name').eq('school_id', schoolId).eq('class_name', cls),
        supabase.from('exam_subjects').select('subject, class_name').eq('exam_id', workspace.id),
      ]);
      const existing = new Set((current || []).map((r) => `${r.class_name ?? '*'}|${r.subject}`.toLowerCase()));
      const missing = (classSubs || [])
        .map((r) => r.subject_name)
        .filter((s) => s && !existing.has(`${cls}|${s}`.toLowerCase()));
      if (missing.length) {
        const { error } = await supabase.from('exam_subjects').insert(
          missing.map((subject) => ({ exam_id: workspace.id, class_name: cls, subject }))
        );
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      toast.error('Could not sync subjects', err.message);
    }
    const { data: rows } = await supabase.from('exam_subjects').select('*').eq('exam_id', workspace.id).order('subject');
    setExamSubjects(rows || []);
  };

  const syncForClass = async () => {
    if (!workspaceClass) return;
    setSyncing(true);
    try {
      await syncClassSubjects(workspaceClass);
      loadMarks();
    } catch (err) {
      toast.error('Could not sync subjects', err.message);
    } finally {
      setSyncing(false);
    }
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
    if (workspace && workspaceClass) {
      setSyncing(true);
      Promise.resolve(syncClassSubjects(workspaceClass))
        .then(() => {
          setSyncing(false);
          loadMarks();
        })
        .catch(() => setSyncing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceClass, workspace]);

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

  const scoreTotals = (sc) => {
    const cls = sc.classScore === '' ? null : Math.min(parseFloat(sc.classScore) || 0, 50);
    const esi = sc.examScoreInput === '' ? null : Math.min(parseFloat(sc.examScoreInput) || 0, 100);
    const tot = cls !== null || esi !== null ? Math.min((cls || 0) + (esi || 0) / 2, 100) : null;
    return { cls, esi, tot, perf: tot != null ? getSubjectGrade(tot) : null };
  };

  const setScore = (studentIndex, subject, field, value) => {
    setMarksData((prev) => {
      const next = [...prev];
      const score = { ...next[studentIndex].scores[subject], [field]: value };
      next[studentIndex] = { ...next[studentIndex], scores: { ...next[studentIndex].scores, [subject]: score } };
      return next;
    });
    setDirty(true);
  };

  const handleScoreKeyDown = (e) => {
    if (e.key !== 'Enter' && e.keyCode !== 13) return;
    const el = e.target;
    if (el?.dataset?.score === undefined) return;
    e.preventDefault();
    const inputs = Array.from(sheetRef.current?.querySelectorAll('input[data-score]') || []);
    const idx = inputs.indexOf(el);
    if (idx >= 0 && idx + 1 < inputs.length) inputs[idx + 1].focus();
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
      setDirty(false);
      setLastSavedAt(new Date());
      toast.success('Results saved', `${upserts.length} subject scores recorded.`);
    } catch (err) {
      toast.error('Could not save results', err.message);
    } finally {
      setSavingMarks(false);
    }
  };

  const exportCsv = () => {
    if (!marksData.length) return;
    const exportSubjects = visibleSubjectsForWorkspace();
    const header = ['Student ID', 'Name'];
    exportSubjects.forEach((s) => {
      header.push(`${s.subject} - Class`, `${s.subject} - Exam`, `${s.subject} - Total`);
    });
    const rows = [[...header]];
    marksData.forEach((row) => {
      const cells = [row.student.student_id, buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)];
      exportSubjects.forEach((s) => {
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
            const dbSub = visibleSubjectsForWorkspace().map((s) => s.subject).find((s) => s.toLowerCase() === entry.subject.toLowerCase());
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
      setDirty(true);
      toast.success('CSV imported', `Updated scores for ${updated} student(s). Click "Save results" to persist.`);
    } catch (err) {
      toast.error('Could not import CSV', err.message);
    }
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
    setRankClass('');
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
    const list = reportClassFilter ? reportStudents.filter((s) => s.class_applying === reportClassFilter) : reportStudents;
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
    const list = transcriptClassFilter ? transcriptStudents.filter((s) => s.class_applying === transcriptClassFilter) : transcriptStudents;
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
    const wmeta = examMeta[workspace.id] || EMPTY_META;
    const wstatus = examStatus(workspace, wmeta);
    const q = marksQuery.trim().toLowerCase();
    const visibleRows = q
      ? marksData.filter((row) => {
          const name = buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name).toLowerCase();
          return name.includes(q) || row.student.student_id.toLowerCase().includes(q);
        })
      : marksData;
    const colSubjects = visibleSubjectsForWorkspace();
    const displayValid = !displaySubject || colSubjects.some((s) => s.subject === displaySubject);
    const columnSubjects = displayValid && displaySubject ? colSubjects.filter((s) => s.subject === displaySubject) : colSubjects;
    const singleSubject = displayValid && !!displaySubject && columnSubjects.length === 1;
    const filledCells = marksData.reduce((sum, row) => {
      let n = 0;
      colSubjects.forEach((sbj) => {
        const sc = row.scores[sbj.subject];
        if (sc && (sc.classScore !== '' || sc.examScoreInput !== '')) n += 1;
      });
      return sum + n;
    }, 0);
    const expectedCells = marksData.length * colSubjects.length;

    return (
      <div>
        <PageHeader
          title={`Enter Marks — ${workspace.name}`}
          subtitle={`${workspace.academic_year} · ${termLabel(workspace.term)} · ${wstatus.label}`}
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

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Students</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{marksData.length || '—'}</p>
            <p className="mt-0.5 text-xs text-slate-400">Admitted · {workspaceClass || 'no class selected'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Subjects</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{examSubjects.length || '—'}</p>
            <p className="mt-0.5 text-xs text-slate-400">Configured for this exam</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Scores entered</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {filledCells}<span className="text-slate-400"> / {expectedCells || '—'}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{expectedCells ? `${Math.round((filledCells / expectedCells) * 100)}% complete` : 'Add subjects to begin'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Save status</p>
              {dirty ? <Badge tone="amber">Unsaved</Badge> : lastSavedAt ? <Badge tone="green">Saved</Badge> : <Badge tone="slate">Idle</Badge>}
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{dirty ? '•' : lastSavedAt ? 'OK' : '—'}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {dirty ? 'Changes not persisted yet' : lastSavedAt ? `Saved ${formatDate(lastSavedAt.toISOString())}` : 'No changes made yet'}
            </p>
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-xs">
            <label className="label">Class *</label>
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => {
                const active = workspaceClass === c.name;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setWorkspaceClass(active ? '' : c.name); setDisplaySubject(''); setMarksQuery(''); }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-700'}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-400">Select a class to open its scoresheet.</p>
          </div>
          <div className="w-full sm:flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Subject assignments</p>
            <p className="mt-1 text-xs text-slate-400">
              The examination module reads the subjects assigned to each class in the Subjects module — nothing needs to be added here.
            </p>
          </div>
          <div className="flex items-end">
            <Button variant="secondary" loading={syncing} onClick={syncForClass}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Sync subjects
            </Button>
          </div>
        </div>

        {colSubjects.length ? (
          <div className="mb-5 flex flex-wrap gap-2">
            {colSubjects.map((sbj) => (
              <span key={sbj.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                {sbj.subject}
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-400">
            {workspaceClass
              ? `No subjects assigned to ${workspaceClass} yet. Add them in the Subjects module, then press "Sync subjects".`
              : 'Select a class to see its assigned subjects.'}
          </p>
        )}
        {workspaceClass ? (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-72">
              <SearchInput value={marksQuery} onChange={setMarksQuery} placeholder="Search students..." />
            </div>
            {marksQuery ? <Badge tone="blue">Showing {visibleRows.length} of {marksData.length}</Badge> : null}
            <p className="text-xs text-slate-400">
              <span className="font-mono">Enter</span> moves to the next score field · totals and grades update live
            </p>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject view</span>
            <button
              type="button"
              onClick={() => setDisplaySubject('')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${!displaySubject || !displayValid ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-700'}`}
            >
              All ({colSubjects.length})
            </button>
            {colSubjects.map((s) => {
              const active = displayValid && displaySubject === s.subject;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDisplaySubject(active ? '' : s.subject)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-700'}`}
                >
                  {s.subject}
                </button>
              );
            })}
          </div>
          </>
        ) : null}
        {workspaceClass ? (
          !resultsLoaded ? (
            <Spinner label="Loading scoresheet..." />
          ) : visibleRows.length && columnSubjects.length ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {/* Frozen header row */}
              <div className="flex border-b border-slate-100">
                <div className="w-52 shrink-0 border-r border-slate-100 bg-slate-50 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Student
                </div>
                <div ref={headerRef} className="flex-1 overflow-hidden bg-slate-50">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      {columnSubjects.flatMap((s) => [
                        <col key={`h-${s.id}-c`} className="w-16" />,
                        <col key={`h-${s.id}-e`} className="w-16" />,
                        <col key={`h-${s.id}-t`} className="w-20" />,
                      ])}
                      {singleSubject ? null : <col className="w-24" />}
                      {singleSubject ? null : <col className="w-20" />}
                    </colgroup>
                    <thead>
                      <tr>
                        {columnSubjects.map((s) => (
                          <th key={s.subject} colSpan={3} className="border-l border-slate-100 px-1 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">
                            {s.subject}
                          </th>
                        ))}
                        {singleSubject ? null : <th className="border-l border-slate-100 px-1 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Average</th>}
                        {singleSubject ? null : <th className="px-1 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-slate-600">Grade</th>}
                      </tr>
                      <tr>
                        {columnSubjects.map((s) => (
                          <Fragment key={s.subject}>
                            <th className="border-l border-slate-100 px-1 py-1 text-center font-normal text-slate-400">Class (50)</th>
                            <th className="px-1 py-1 text-center font-normal text-slate-400">Exam (100)</th>
                            <th className="px-1 py-1 text-center font-normal text-slate-400">Total</th>
                          </Fragment>
                        ))}
                        {singleSubject ? null : <th colSpan={2} />}
                      </tr>
                    </thead>
                  </table>
                </div>
              </div>
              {/* Scrollable body: names stay frozen on the left, only marks scroll */}
              <div className="flex max-h-[560px]">
                <div ref={namesRef} className="w-52 shrink-0 overflow-hidden border-r border-slate-100 bg-white">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-52" />
                    </colgroup>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.student.id}>
                          <td className="h-11 border-b border-slate-100 bg-white px-3 align-middle">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)}
                            </p>
                            <p className="font-mono text-xs text-slate-400">{row.student.student_id}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div
                  ref={sheetRef}
                  onKeyDown={handleScoreKeyDown}
                  onScroll={(e) => {
                    if (namesRef.current) namesRef.current.scrollTop = e.target.scrollTop;
                    if (headerRef.current) headerRef.current.scrollLeft = e.target.scrollLeft;
                  }}
                  className="flex-1 overflow-auto bg-white"
                >
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      {columnSubjects.flatMap((s) => [
                        <col key={`b-${s.id}-c`} className="w-16" />,
                        <col key={`b-${s.id}-e`} className="w-16" />,
                        <col key={`b-${s.id}-t`} className="w-20" />,
                      ])}
                      {singleSubject ? null : <col className="w-24" />}
                      {singleSubject ? null : <col className="w-20" />}
                    </colgroup>
                    <tbody className="divide-y divide-slate-100">{visibleRows.map((row) => {
                    const rowIndex = marksData.indexOf(row);
                    let sum = 0;
                    let count = 0;
                    columnSubjects.forEach((sbj) => {
                      const t = scoreTotals(row.scores[sbj.subject] || { classScore: '', examScoreInput: '' });
                      if (t.tot != null) {
                        sum += t.tot;
                        count += 1;
                      }
                    });
                    const avg = count ? sum / count : null;
                    const avgPerf = avg != null ? getSubjectGrade(avg) : null;
                    const complete =
                      examSubjects.length > 0 &&
                      columnSubjects.every((sbj) => {
                        const sc = row.scores[sbj.subject];
                        return sc && (sc.classScore !== '' || sc.examScoreInput !== '');
                      });
                    return (
                      <tr key={row.student.id} className="hover:bg-slate-50/60">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2">
                          <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                            {buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)}
                            {complete ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Complete" /> : null}
                          </p>
                          <p className="font-mono text-xs text-slate-400">{row.student.student_id}</p>
                        </td>
                        {columnSubjects.map((sbj) => {
                          const sc = row.scores[sbj.subject] || { classScore: '', examScoreInput: '' };
                          const t = scoreTotals(sc);
                          return (
                            <Fragment key={sbj.subject}>
                              <td className="border-l border-slate-100 px-1 py-1.5">
                                <input
                                  type="number" min="0" max="50" data-score="1"
                                  value={sc.classScore}
                                  onChange={(e) => setScore(rowIndex, sbj.subject, 'classScore', e.target.value)}
                                  className="input h-8 w-full rounded-lg px-1.5 text-center text-xs"
                                  placeholder="0-50"
                                />
                              </td>
                              <td className="px-1 py-1.5">
                                <input
                                  type="number" min="0" max="100" data-score="1"
                                  value={sc.examScoreInput}
                                  onChange={(e) => setScore(rowIndex, sbj.subject, 'examScoreInput', e.target.value)}
                                  className="input h-8 w-full rounded-lg px-1.5 text-center text-xs"
                                  placeholder="0-100"
                                />
                              </td>
                              <td className="px-1 py-1.5 text-center">
                                {t.tot != null && t.perf ? (
                                  <span className={`badge ${GRADE_CLASSES[t.perf.cls]}`}>
                                    {t.tot.toFixed(0)}% · {t.perf.grade}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </Fragment>
                          );
                        })}
                        {singleSubject ? null : (
                          <td className="border-l border-slate-100 px-2 py-2 text-center">
                            {avg != null ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-sm font-bold text-slate-700">{avg.toFixed(1)}%</span>
                                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-1.5 rounded-full ${avg >= 50 ? 'bg-teal-500' : 'bg-rose-400'}`}
                                    style={{ width: `${Math.min(avg, 100)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        {singleSubject ? null : (
                          <td className="px-2 py-2 text-center">
                            {avgPerf ? (
                              <span className={`badge ${GRADE_CLASSES[avgPerf.cls]}`}>{avgPerf.grade}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
            </div>
          ) : visibleRows.length === 0 && marksData.length ? (
            <EmptyState icon={Users} title="No students match your search" message="Try a different name or Student ID." />
          ) : marksData.length === 0 ? (
            <EmptyState icon={Users} title="No students in this class" message="This class has no students to enter marks for." />
          ) : (
            <EmptyState icon={ClipboardEdit} title="No subjects yet" message="Assign subjects to this class in the Subjects module, then press Sync subjects." />
          )
        ) : (
          <EmptyState icon={ClipboardEdit} title="Pick a class" message="Select a class to open its scoresheet." />
        )}
      </div>
    );
  }

  const totalResults = exams.reduce((s, ex) => s + (examMeta[ex.id]?.results || 0), 0);
  const activeCount = exams.filter((ex) => ex.is_active !== false).length;
  const inProgressCount = exams.filter((ex) => examStatus(ex, examMeta[ex.id] || EMPTY_META).label === 'In progress').length;
  const classesAssessed = new Set(exams.flatMap((ex) => examMeta[ex.id]?.classNames || [])).size;

  return (
    <div>
      <PageHeader
        title="Examinations"
        subtitle="Plan assessment sessions, record scores and publish report-card ready results."
        icon={Award}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New exam
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Award} tone="blue" label="Total exams" value={exams.length} sub={`${activeCount} active`} index={0} />
        <StatCard icon={Trophy} tone="teal" label="In progress" value={inProgressCount} sub="Results being recorded" index={1} />
        <StatCard icon={GraduationCap} tone="amber" label="Classes assessed" value={classesAssessed} sub={`Across ${exams.length} exam session(s)`} index={2} />
        <StatCard icon={FileText} tone="green" label="Scores recorded" value={totalResults} sub="Subject results in the system" index={3} />
      </div>

      {loading ? (
        <Spinner label="Loading exams..." />
      ) : exams.length ? (
        <div className="grid gap-5">
          {exams.map((exam) => {
            const meta = examMeta[exam.id] || EMPTY_META;
            const status = examStatus(exam, meta);
            const pct = completionPct(meta);
            return (
              <Card key={exam.id} className="overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-1 bg-blend" />
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-accent-600">
                      <Award className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-bold text-slate-900">{exam.name}</h3>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {exam.academic_year} · {termLabel(exam.term)}
                        {exam.start_date ? ` · ${formatDate(exam.start_date)}` : ''}
                        {exam.end_date ? ` → ${formatDate(exam.end_date)}` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="blue">{meta.subjectCount} subject{meta.subjectCount === 1 ? '' : 's'}</Badge>
                        <Badge tone="teal">{meta.classCoverage} class{meta.classCoverage === 1 ? '' : 'es'}</Badge>
                        <Badge tone="amber">{meta.results} result{meta.results === 1 ? '' : 's'}</Badge>
                        {meta.students ? <Badge tone="slate">{meta.students} student{meta.students === 1 ? '' : 's'}</Badge> : null}
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-teal-500' : 'bg-brand-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-11 text-right font-mono text-xs font-semibold text-slate-500">{pct}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Award} title="No exams yet" message="Create an exam to start recording report card scores." action={<Button onClick={openAdd}>New exam</Button>} />
      )}<Modal
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
              <option key={t} value={t}>{TERM_LABELS[t]}</option>
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
        message="This permanently deletes the exam together with all its subjects, results and student details. This cannot be undone."
        confirmLabel="Delete exam"
      />

      <Modal
        open={!!rankExam}
        onClose={() => setRankExam(null)}
        title={rankExam ? `Rankings — ${rankExam.name}` : 'Rankings'}
        size="xl"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setRankExam(null)} className="flex-1">
              Close
            </Button>
          </div>
        }
      >
        {rankBusy ? (
          <Spinner label="Calculating rankings..." />
        ) : rankData && (rankData.overall.length || rankData.subjects.length) ? (
          <>
            {rankData.overall.length > 1 ? (
              <Tabs
                className="mb-4"
                active={rankClass}
                onChange={setRankClass}
                tabs={[{ value: '', label: 'All classes' }, ...rankData.overall.map((g) => ({ value: g.cls, label: g.cls }))]}
              />
            ) : null}
            {(() => {
              const groups = rankClass ? rankData.overall.filter((g) => g.cls === rankClass) : rankData.overall;
              return groups.map((group) => {
                const top3 = group.rows.slice(0, 3);
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div key={group.cls} className="rounded-2xl border border-slate-200/80 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-accent-600" aria-hidden="true" />
                      <h4 className="text-sm font-bold text-slate-800">Class {group.cls}</h4>
                      <span className="text-xs text-slate-400">· {group.rows.length} student{group.rows.length === 1 ? '' : 's'}</span>
                    </div>
                    {top3.length ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {top3.map((r, i) => (
                          <div key={r.student_id} className={`rounded-xl border p-3 ${i === 0 ? 'border-amber-300 bg-amber-50' : i === 1 ? 'border-slate-300 bg-slate-50' : 'border-orange-300 bg-orange-50'}`}>
                            <p className="text-center text-2xl" aria-hidden="true">{medals[i]}</p>
                            <p className="mt-1 truncate text-center text-sm font-bold text-slate-800" title={r.name}>{r.name}</p>
                            <p className="mt-1 flex items-center justify-center gap-1.5 text-xs">
                              <span className="font-mono font-semibold text-slate-600">{r.avg.toFixed(1)}%</span>
                              <span className={`badge ${GRADE_CLASSES[getSubjectGrade(r.avg).cls]}`}>{r.grade}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <table className="mt-3 w-full text-left text-sm">
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
                              <span className={`badge ${GRADE_CLASSES[getSubjectGrade(r.avg).cls]}`}>{r.grade}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              });
            })()}{rankData.subjects.length ? (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-slate-800">Subject leaderboards</h4>
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
          </>
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
              Print {reportClassFilter ? reportClassFilter : 'all'}
            </Button>
            <Button onClick={printReport} disabled={!reportHtml}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print current
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
              <option key={c.id} value={c.name}>{c.name}</option>
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
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-400">
            Select a student and preview their report card. Bulk-print sends every student in the filter to the printer.
          </div>
        )}
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
              Print {transcriptClassFilter ? transcriptClassFilter : 'all'}
            </Button>
            <Button onClick={printTranscript} disabled={!transcriptHtml}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print current
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
              <option key={c.id} value={c.name}>{c.name}</option>
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
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-400">
            Transcripts compile all exam sessions on record for the selected student.
          </div>
        )}
      </Modal>

    </div>
  );
}