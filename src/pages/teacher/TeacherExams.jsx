import { useEffect, useMemo, useState } from 'react';
import { Award, Save, RefreshCw, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Button, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { fetchTeacherClassSet } from '../../lib/queries';
import { buildStudentName, getSubjectGrade } from '../../lib/format';
import { openPrintWindow, escapeHtml } from '../../lib/print';

const esc = escapeHtml;

export default function TeacherExams() {
  const { user } = useAuth();
  const [teacher, setTeacher] = useState(null);
  const [classes, setClasses] = useState([]);
  const [subjectByClass, setSubjectByClass] = useState({});
  const [exams, setExams] = useState([]);
  const [ready, setReady] = useState(false);

  const [examId, setExamId] = useState('');
  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectOptions, setSubjectOptions] = useState([]);

  const [rows, setRows] = useState([]); // { student, classScore, examScoreInput }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: t } = await supabase.from('teachers').select('*').eq('user_id', user.id).maybeSingle();
        setTeacher(t || null);
        if (!t) return;
        const classNames = await fetchTeacherClassSet(t.id, t.class_taught);
        setClasses(classNames);
        const [{ data: asigns }, { data: examsData }] = await Promise.all([
          supabase.from('teacher_classes_subjects').select('class_name, subject_name').eq('teacher_id', t.id),
          supabase.from('exams').select('*').eq('school_id', t.school_id).eq('is_active', true).order('created_at', { ascending: false }),
        ]);
        const sbc = {};
        (asigns || []).forEach((a) => {
          if (!a.class_name || !a.subject_name) return;
          if (!sbc[a.class_name]) sbc[a.class_name] = [];
          if (!sbc[a.class_name].includes(a.subject_name)) sbc[a.class_name].push(a.subject_name);
        });
        // Legacy fallback: distribute the flat subject list across class_taught.
        if (!Object.keys(sbc).length) {
          const legacyClasses = String(t.class_taught || '').split(',').map((c) => c.trim()).filter(Boolean);
          const legacySubjects = String(t.subject || '').split(',').map((s) => s.trim()).filter(Boolean);
          legacyClasses.forEach((c) => {
            sbc[c] = legacySubjects.slice();
          });
        }
        setSubjectByClass(sbc);
        setExams(examsData || []);
      } catch (err) {
        setNotice('Could not load your exam workspace: ' + err.message);
      } finally {
        setReady(true);
      }
    })();
  }, [user]);

  // Subjects available for the chosen exam + class (only the ones the teacher teaches).
  useEffect(() => {
    if (!examId || !className) {
      setSubjectOptions([]);
      setSubject('');
      return;
    }
    (async () => {
      try {
        const { data: esRows } = await supabase
          .from('exam_subjects')
          .select('subject')
          .eq('exam_id', examId)
          .eq('class_name', className);
        const taught = (subjectByClass[className] || []).map((s) => s.toLowerCase());
        const examSubs = (esRows || []).map((r) => r.subject);
        const available = [...new Set(examSubs.filter((s) => taught.includes(s.toLowerCase())))];
        setSubjectOptions(available);
        if (!subject || !available.includes(subject)) setSubject(available[0] || '');
      } catch (err) {
        setSubjectOptions([]);
      }
    })();
  }, [examId, className, subjectByClass]);
useEffect(() => {
    if (!examId || !className || !subject || !teacher) {
      setRows([]);
      return;
    }
    setLoading(true);
    setNotice('');
    (async () => {
      try {
        const [{ data: students }, { data: results }] = await Promise.all([
          supabase
            .from('applications')
            .select('id, student_id, first_name, middle_name, last_name, class_applying, gender')
            .eq('school_id', teacher.school_id)
            .eq('class_applying', className)
            .order('last_name'),
          supabase
            .from('exam_results')
            .select('*')
            .eq('exam_id', examId)
            .eq('subject', subject)
            .eq('school_id', teacher.school_id),
        ]);
        const seen = new Set();
        const uniqueStudents = (students || []).filter((s) => {
          if (seen.has(s.student_id)) return false;
          seen.add(s.student_id);
          return true;
        });
        const resMap = new Map((results || []).map((r) => [r.student_id, r]));
        setRows(
          uniqueStudents.map((st) => {
            const r = resMap.get(st.student_id);
            return {
              student: st,
              classScore: r?.class_score != null ? String(r.class_score) : '',
              examScoreInput: r?.exam_score_input != null ? String(r.exam_score_input) : r?.exam_score != null ? String(r.exam_score * 2) : '',
            };
          })
        );
      } catch (err) {
        setNotice('Could not load students: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [examId, className, subject, teacher]);

  const setRow = (index, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const totalsOf = (r) => {
    const cls = r.classScore === '' ? null : Math.min(parseFloat(r.classScore) || 0, 50);
    const esi = r.examScoreInput === '' ? null : Math.min(parseFloat(r.examScoreInput) || 0, 100);
    const total = cls !== null || esi !== null ? Math.min((cls || 0) + (esi || 0) / 2, 100) : null;
    return { cls, esi, total, perf: total != null ? getSubjectGrade(total) : null };
  };

  const enteredCount = useMemo(() => rows.filter((r) => r.classScore !== '' || r.examScoreInput !== '').length, [rows]);

  const save = async () => {
    if (!rows.length || !teacher) return;
    setSaving(true);
    setNotice('');
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      const upserts = [];
      for (const row of rows) {
        const t = totalsOf(row);
        if (t.cls === null && t.esi === null) continue;
        upserts.push({
          exam_id: examId,
          student_id: row.student.student_id,
          subject,
          class_score: t.cls,
          exam_score_input: t.esi,
          exam_score: t.esi !== null ? t.esi / 2 : null,
          marks_obtained: t.total,
          grade: t.perf?.grade || null,
          school_id: teacher.school_id,
          created_by: u?.id,
        });
      }
      if (!upserts.length) {
        setNotice('Enter at least one score before saving.');
        return;
      }
      const seenKeys = new Set();
      const unique = upserts.filter((u) => {
        const key = `${u.exam_id}|${u.student_id}|${u.subject.toLowerCase()}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      const { error } = await supabase.from('exam_results').upsert(unique, { onConflict: 'exam_id,student_id,subject' });
      if (error) throw new Error(error.message);
      setNotice(`Saved ${unique.length} score record(s) for ${subject}.`);
    } catch (err) {
      setNotice('Could not save results: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const printSheet = () => {
    if (!rows.length) return;
    const exam = exams.find((e) => e.id === examId);
    const body = rows
      .map((r) => {
        const t = totalsOf(r);
        return `<tr>
          <td>${esc(r.student.student_id)}</td>
          <td>${esc(buildStudentName(r.student.first_name, r.student.middle_name, r.student.last_name))}</td>
          <td class="right">${t.cls != null ? t.cls.toFixed(2) : '&mdash;'}</td>
          <td class="right">${t.esi != null ? t.esi.toFixed(2) : '&mdash;'}</td>
          <td class="right">${t.total != null ? t.total.toFixed(2) : '&mdash;'}</td>
          <td>${esc(t.perf?.grade || '—')}</td>
        </tr>`;
      })
      .join('');
    openPrintWindow(`Exam Scores — ${subject}`, `
      <h1>${esc(exam?.name || 'Exam')} — ${esc(subject)}</h1>
      <p>Class: ${esc(className)} · ${esc((exam?.academic_year || '') + ' ' + (exam?.term || ''))}</p>
      <table>
        <thead><tr><th>ID</th><th>Student</th><th class="right">Class (50)</th><th class="right">Exam (100)</th><th class="right">Total</th><th>Grade</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `);
  };
return (
    <div>
      <PageHeader
        title="Examinations"
        subtitle="Enter exam marks for your classes and subjects."
        icon={Award}
        actions={
          <>
            <Button variant="secondary" onClick={printSheet} disabled={!rows.length}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print sheet
            </Button>
            <Button onClick={save} loading={saving} disabled={!rows.length}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save results
            </Button>
          </>
        }
      />

      {!ready ? (
        <Spinner label="Loading your exam workspace..." />
      ) : !teacher ? (
        <EmptyState
          icon={Award}
          title="Not registered as a teacher"
          message="Your account is not linked to a teacher record. Ask the administrator to resolve it."
        />
      ) : !classes.length ? (
        <EmptyState
          icon={Award}
          title="No classes assigned"
          message="The administrator has not assigned you any class yet, so there is nothing to examine."
        />
      ) : !exams.length ? (
        <EmptyState
          icon={Award}
          title="No active exams"
          message="The administrator has not created an active exam for this school year yet."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Select label="Exam *" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Select exam...</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} ({ex.academic_year} · {ex.term} Term)
                </option>
              ))}
            </Select>
            <Select label="Class *" value={className} onChange={(e) => setClassName(e.target.value)}>
              <option value="">Select class...</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select label="Subject *" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Select subject...</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>

          {examId && className && subjectOptions.length === 0 ? (
            <Alert tone="warning" className="mb-4">
              No exam subjects match the subjects you teach in {className} for this exam. Contact the administrator to
              add the subject to the exam, or to assign the subject to you for this class.
            </Alert>
          ) : null}

          {notice ? (
            <Alert tone={notice.startsWith('Could') || notice.startsWith('Enter') ? 'error' : 'success'} className="mb-4">
              {notice}
            </Alert>
          ) : null}
{loading ? (
            <Spinner label="Loading students..." />
          ) : rows.length ? (
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
                <Badge tone="blue">{className}</Badge>
                <Badge tone="teal">{subject}</Badge>
                <span className="text-xs text-slate-500">
                  {enteredCount} of {rows.length} student(s) have scores · total = class score (max 50) + exam score ÷ 2 (max 50)
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-3 py-2">No.</th>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2 text-right">Class score (0–50)</th>
                    <th className="px-3 py-2 text-right">Exam score (0–100)</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const t = totalsOf(r);
                    return (
                      <tr key={r.student.student_id} className="border-b border-slate-100 text-sm">
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800">{buildStudentName(r.student.first_name, r.student.middle_name, r.student.last_name)}</p>
                          <p className="font-mono text-[11px] text-slate-400">{r.student.student_id}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ScoreInput value={r.classScore} onChange={(v) => setRow(i, 'classScore', v)} max="50" />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ScoreInput value={r.examScoreInput} onChange={(v) => setRow(i, 'examScoreInput', v)} max="100" />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">
                          {t.total != null ? t.total.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {t.total != null ? <Badge tone="blue">{t.perf?.grade || '—'}</Badge> : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ) : examId && className && subject ? (
            <EmptyState icon={Award} title="No students" message="There are no students admitted in this class yet." />
          ) : null}
        </>
      )}
    </div>
  );
}

function ScoreInput({ value, onChange, max }) {
  return (
    <input
      type="number"
      min="0"
      max={max}
      step="0.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm"
      placeholder="—"
    />
  );
}