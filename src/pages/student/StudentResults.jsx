import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Printer, FileText } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { useSchoolSettings } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, Select, Button, Badge } from '../../components/ui';
import {
  fetchExamsForStudent,
  fetchResultsForExam,
  fetchStudentDetailsForExam,
  fetchStudentAttendance,
  fetchSchoolName,
} from '../../lib/queries';
import {
  buildStudentName,
  formatDate,
  getSubjectGrade,
  getPerformanceLevel,
  getTeacherRemarks,
  getHeadTeacherRemarks,
  termLabel,
} from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function StudentResults() {
  const { application, loading } = useStudentApplication();
  const { settings } = useSchoolSettings();
  const [exams, setExams] = useState([]);
  const [selected, setSelected] = useState('');
  const [results, setResults] = useState([]);
  const [details, setDetails] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [busy, setBusy] = useState(false);
  const [schoolName, setSchoolName] = useState('My School');

  useEffect(() => {
    if (!application) return;
    fetchSchoolName(application.school_id).then(setSchoolName).catch(() => {});
    fetchExamsForStudent(application.school_id)
      .then((list) => {
        setExams(list);
        const withResults = list.filter((e) => e.id);
        if (withResults.length) setSelected(withResults[0].id);
      })
      .catch(() => {});
  }, [application]);

  useEffect(() => {
    if (!selected || !application) return;
    let cancelled = false;
    setBusy(true);
    Promise.all([
      fetchResultsForExam(application.student_id, selected),
      fetchStudentDetailsForExam(application.student_id, selected),
      fetchStudentAttendance(application.student_id),
    ])
      .then(([r, d, a]) => {
        if (cancelled) return;
        setResults(r);
        setDetails(d);
        setAttendance(a);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [selected, application]);

  const report = useMemo(() => {
    if (!results.length) return null;
    let total = 0;
    const rows = results
      .sort((a, b) => a.subject.localeCompare(b.subject))
      .map((r) => {
        const marks = Number(r.marks_obtained || 0);
        total += marks;
        return { ...r, marks, grade: getSubjectGrade(marks), level: getPerformanceLevel(marks) };
      });
    const average = total / rows.length || 0;
    return {
      rows,
      total,
      max: rows.length * 100,
      average: Math.round(average),
      level: getPerformanceLevel(average),
      teacherRemarks: getTeacherRemarks(average),
      headRemarks: getHeadTeacherRemarks(average),
    };
  }, [results]);

  const exam = exams.find((e) => e.id === selected);
  const att = useMemo(() => {
    const yearForAtt = settings?.academic_year || exam?.academic_year;
    const termForAtt = settings?.current_term || exam?.term;
    const filtered = attendance.filter((r) => r.academic_year === yearForAtt && r.term === termForAtt);
    const present = filtered.filter((r) => r.status === 'present').length;
    const absent = filtered.filter((r) => r.status === 'absent').length;
    return { present, absent, total: filtered.length, pct: filtered.length ? Math.round((present / filtered.length) * 100) : 0 };
  }, [attendance, settings, exam]);

  if (loading) return <Spinner label="Loading report cards..." />;
  if (!application) return <EmptyState title="No student record" />;

  const name = buildStudentName(application.first_name, application.middle_name, application.last_name);
  const photo = application.student_photo_url ? photoUrl(application.student_photo_url) : null;

  const print = () => {
    window.print();
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Exam Report Cards"
          subtitle="Your examination results by term."
          icon={Award}
          actions={
            report ? (
              <Button variant="secondary" onClick={print}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print report
              </Button>
            ) : null
          }
        />

        {exams.length ? (
          <Select label="Select an examination" value={selected} onChange={(e) => setSelected(e.target.value)} className="max-w-sm">
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} - {e.academic_year} ({termLabel(e.term)})
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      <div className="mt-5">
        {busy ? (
          <Spinner label="Loading report..." />
        ) : !report ? (
          <EmptyState
            icon={FileText}
            title="No results published yet"
            message="When your school publishes results for this examination, your report card will appear here."
          />
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div id="report-card" className="card overflow-hidden bg-white">
              <div className="flex items-center justify-between gap-4 bg-blend px-6 py-5 text-white">
                <div>
                  <p className="text-lg font-extrabold">{schoolName}</p>
                  <p className="text-xs text-white/75">Academic Report</p>
                </div>
              </div>

              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  {photo ? (
                    <img src={photo} alt="Student" className="h-16 w-14 rounded-xl object-cover ring-2 ring-brand-100" />
                  ) : (
                    <span className="flex h-16 w-14 items-center justify-center rounded-xl bg-brand-50 text-xl font-extrabold text-brand-600">
                      {name.charAt(0)}
                    </span>
                  )}
                  <div>
                    <p className="text-base font-bold text-slate-900">{name}</p>
                    <p className="text-xs text-slate-400">{application.student_id}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge tone="blue">{application.class_applying}</Badge>
                      <Badge tone="teal">{exam?.name}</Badge>
                      <Badge tone="slate">
                        {exam?.academic_year} - {termLabel(exam?.term)}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto px-6 py-4">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-3 font-semibold">Subject</th>
                      <th className="pb-2 pr-3 font-semibold">Class Score</th>
                      <th className="pb-2 pr-3 font-semibold">Exam Score</th>
                      <th className="pb-2 pr-3 font-semibold">Total Marks</th>
                      <th className="pb-2 pr-3 font-semibold">Grade</th>
                      <th className="pb-2 font-semibold">Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {report.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3 font-semibold text-slate-800">{row.subject}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{Number(row.class_score || 0).toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{Number(row.exam_score || 0).toFixed(2)}</td>
                        <td className="py-2.5 pr-3 font-bold text-slate-800">{row.marks.toFixed(2)}</td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`badge ${
                              ['A', 'B'].includes(row.grade.grade)
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                : ['C', 'D'].includes(row.grade.grade)
                                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                                  : 'bg-accent-500/10 text-accent-600 ring-1 ring-accent-500/30'
                            }`}
                          >
                            {row.grade.grade}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-600">{row.level.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
                <div className="rounded-xl bg-brand-50 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Total</p>
                  <p className="mt-1 text-lg font-extrabold text-brand-800">
                    {report.total.toFixed(2)} / {report.max}
                  </p>
                </div>
                <div className="rounded-xl bg-teal-50 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Average</p>
                  <p className="mt-1 text-lg font-extrabold text-teal-800">{report.average}%</p>
                </div>
                <div className="rounded-xl bg-accent-500/10 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">Performance</p>
                  <p className="mt-1 text-lg font-extrabold text-accent-700">{report.level.text}</p>
                </div>
              </div>

              {att.total ? (
                <div className="flex flex-wrap items-center gap-3 px-6 pb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attendance</span>
                  <Badge tone="green">{att.present} present</Badge>
                  <Badge tone="red">{att.absent} absent</Badge>
                  <Badge tone="blue">{att.pct}%</Badge>
                </div>
              ) : null}

              <div className="space-y-3 px-6 py-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Class Teacher's Remarks</p>
                  <p className="mt-1 text-sm text-slate-700">{report.teacherRemarks}</p>
                </div>
                <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-brand-500">Head Teacher's Remarks</p>
                  <p className="mt-1 text-sm text-slate-700">{report.headRemarks}</p>
                </div>
              </div>

              <div className="flex items-center justify-between px-6 py-5">
                <div className="text-center">
                  <div className="h-px w-36 bg-slate-300" />
                  <p className="mt-1 text-xs text-slate-400">Class Teacher's Signature</p>
                </div>
                <div className="text-center">
                  <div className="h-px w-36 bg-slate-300" />
                  <p className="mt-1 text-xs text-slate-400">Head Teacher's Signature</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}