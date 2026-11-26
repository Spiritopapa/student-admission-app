import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Printer, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useStudentApplication } from '../../hooks/useSchool';
import { useSchoolSettings } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, Select, Button, Badge } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import {
  fetchExamsForStudent,
  fetchResultsForExam,
  fetchStudentDetailsForExam,
  fetchStudentAttendance,
} from '../../lib/queries';
import {
  buildStudentName,
  formatDate,
  getPerformanceLevel,
  getTeacherRemarks,
  getHeadTeacherRemarks,
  termLabel,
} from '../../lib/format';
import { fetchGradingScale, gradeForScale, GRADE_CLASSES } from '../../lib/gradingScale';
import { ordinal } from '../../lib/examReports';
import { photoUrl } from '../../lib/storage';
import { openPrintWindow, escapeHtml } from '../../lib/print';
import { isMobileShell } from '../../lib/mobileHost';

const SCORE_REFRESH_INTERVAL_MS = 5_000;
let reportPositionsWarningShown = false;

async function fetchReportCardPositions(examId) {
  const { data, error } = await supabase.rpc('get_student_exam_report_positions', {
    p_exam_id: examId,
  });
  if (error) {
    if (!reportPositionsWarningShown) {
      console.error('Could not load student report-card positions.', error);
      reportPositionsWarningShown = true;
    }
    return [];
  }
  reportPositionsWarningShown = false;
  return data || [];
}

export default function StudentResults() {
  const { application, loading } = useStudentApplication();
  const { settings } = useSchoolSettings();
  const [exams, setExams] = useState([]);
  const [selected, setSelected] = useState('');
  const [results, setResults] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [positions, setPositions] = useState([]);
  const [details, setDetails] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [busy, setBusy] = useState(false);
  const [schoolName, setSchoolName] = useState('My School');
  const [schoolAddress, setSchoolAddress] = useState('');
  const [schoolPhone, setSchoolPhone] = useState('');
  const [scale, setScale] = useState(null); // class-aware grading scale
  const [reportError, setReportError] = useState('');
  const [setupError, setSetupError] = useState('');

  useEffect(() => {
    if (!application) return;
    let active = true;
    setReportError('');
    setSetupError('');
    setExams([]);
    setSelected('');
    setScale(null);
    (async () => {
      try {
        const [
          { data: schoolSettings, error: settingsError },
          { data: school, error: schoolError },
        ] = await Promise.all([
          supabase
            .from('school_settings')
            .select('school_name, school_address')
            .eq('school_id', application.school_id)
            .maybeSingle(),
          supabase.from('schools').select('name, phone').eq('id', application.school_id).maybeSingle(),
        ]);
        if (settingsError) throw new Error(settingsError.message);
        if (schoolError) throw new Error(schoolError.message);
        if (!active) return;
        setSchoolName(schoolSettings?.school_name || school?.name || 'My School');
        setSchoolAddress(schoolSettings?.school_address || '');
        setSchoolPhone(school?.phone || '');
      } catch (err) {
        if (active) setSetupError(`Could not load school contact details: ${err.message}`);
      }

      try {
        const nextScale = await fetchGradingScale(application.school_id, application.class_applying);
        if (active) setScale(nextScale);
      } catch (err) {
        if (active) setSetupError(`Could not load grading scale: ${err.message}`);
      }

      try {
        const list = await fetchExamsForStudent(application.school_id);
        if (!active) return;
        setExams(list);
        setSelected(list[0]?.id || '');
      } catch (err) {
        if (active) setSetupError(`Could not load examinations: ${err.message}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [application]);

  useEffect(() => {
    if (!selected || !application) {
      setBusy(false);
      setResults([]);
      setSubjects([]);
      setPositions([]);
      setDetails(null);
      setAttendance([]);
      return undefined;
    }

    let cancelled = false;
    let refreshing = false;
    const refreshReport = async (initialLoad = false) => {
      if (refreshing) return;
      refreshing = true;
      if (initialLoad) setBusy(true);
      try {
        if (initialLoad) {
          const [
            nextResults,
            nextDetails,
            nextAttendance,
            { data: subjectRows, error: subjectsError },
            nextPositions,
          ] = await Promise.all([
            fetchResultsForExam(application.student_id, selected),
            fetchStudentDetailsForExam(application.student_id, selected),
            fetchStudentAttendance(application.student_id),
            supabase
              .from('exam_subjects')
              .select('subject, class_name')
              .eq('exam_id', selected),
            fetchReportCardPositions(selected),
          ]);
          if (cancelled) return;
          if (subjectsError) throw new Error(subjectsError.message);
          setResults(nextResults);
          setSubjects(
            [...new Set(
              (subjectRows || [])
                .filter((row) => !row.class_name || row.class_name === application.class_applying)
                .map((row) => row.subject)
            )]
          );
          setPositions(nextPositions);
          setDetails(nextDetails);
          setAttendance(nextAttendance);
        } else {
          const [nextResults, nextDetails, nextPositions] = await Promise.all([
            fetchResultsForExam(application.student_id, selected),
            fetchStudentDetailsForExam(application.student_id, selected),
            fetchReportCardPositions(selected),
          ]);
          if (cancelled) return;
          setResults(nextResults);
          setDetails(nextDetails);
          setPositions(nextPositions);
        }
        setReportError('');
      } catch (err) {
        if (!cancelled) {
          setReportError(`Could not ${initialLoad ? 'load' : 'refresh'} the report card: ${err.message}`);
          console.error(
            initialLoad ? 'Could not load the student report card.' : 'Could not refresh the student report card.',
            err
          );
        }
      } finally {
        refreshing = false;
        if (initialLoad && !cancelled) setBusy(false);
      }
    };

    refreshReport(true);
    const intervalId = setInterval(
      () => refreshReport(false),
      SCORE_REFRESH_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selected, application]);

  const report = useMemo(() => {
    if (!results.length) return null;
    let total = 0;
    let entered = 0;
    const resultMap = new Map(results.map((result) => [result.subject.toLowerCase(), result]));
    const positionsBySubject = new Map(
      positions.map((position) => [position.subject.toLowerCase(), position.subject_rank])
    );
    const reportSubjects = subjects.length
      ? [...subjects]
      : [...new Set(results.map((result) => result.subject))];
    const rows = reportSubjects
      .sort((a, b) => a.localeCompare(b))
      .map((subject) => {
        const result = resultMap.get(subject.toLowerCase());
        const marks = result?.marks_obtained != null ? Number(result.marks_obtained) : null;
        if (marks != null) {
          total += marks;
          entered += 1;
        }
        return {
          id: result?.id || subject,
          subject,
          hasResult: Boolean(result),
          class_score: result?.class_score != null ? Number(result.class_score) : null,
          exam_score: result?.exam_score != null ? Number(result.exam_score) : null,
          marks,
          rank: positionsBySubject.get(subject.toLowerCase()) || null,
          grade: marks == null ? { grade: '-', cls: '' } : gradeForScale(scale?.rows || [], marks, subject),
          level: marks == null ? { text: '-' } : getPerformanceLevel(marks),
        };
      });
    const average = entered ? total / entered : 0;
    const overallPosition = details?.overall_position || positions[0]?.overall_position || null;
    const gradingKey = (scale?.rows || [])
      .filter((row) => !row.subject_name)
      .slice(0, 4)
      .map((row) => `${row.grade_label} (${row.min_score}-${row.max_score ?? 100})`)
      .join(' · ');
    const interest = details?.interest || application.interest || 'mathematics';
    const attitude = details?.attitude || application.attitude || 'active';
    const conduct = details?.conduct || '-';
    return {
      rows,
      total,
      average,
      averageGrade: gradeForScale(scale?.rows || [], average, ''),
      position: overallPosition ? ordinal(overallPosition) : '-',
      level: getPerformanceLevel(average),
      gradingKey,
      interest: interest ? interest.charAt(0).toUpperCase() + interest.slice(1) : '-',
      attitude: attitude ? attitude.charAt(0).toUpperCase() + attitude.slice(1) : '-',
      conduct: conduct === '-' ? conduct : conduct.charAt(0).toUpperCase() + conduct.slice(1),
      teacherRemarks: details?.class_teacher_remarks || getTeacherRemarks(average),
      headRemarks: details?.head_teacher_remarks || getHeadTeacherRemarks(average),
    };
  }, [results, subjects, positions, details, application, scale]);

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
    // Inside the Android app window.print() is a no-op in the WebView, so
    // hand the report to the native print sheet (Print / Save as PDF).
    if (isMobileShell()) {
      const rowsHtml = report.rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.subject)}</td>
            <td class="right">${row.hasResult ? Number(row.class_score || 0).toFixed(1) : '-'}</td>
            <td class="right">${row.hasResult ? Number(row.exam_score || 0).toFixed(1) : '-'}</td>
            <td class="right"><b>${row.marks == null ? '-' : row.marks.toFixed(1)}</b></td>
            <td class="right">${row.rank ? ordinal(Number(row.rank)) : '-'}</td>
            <td class="right">${escapeHtml(row.grade.grade)}</td>
            <td>${escapeHtml(row.level.text)}</td>
          </tr>`
        )
        .join('');
      openPrintWindow(`Report Card - ${name}`, `
        <div style="text-align:center;">
          <h1>${escapeHtml(schoolName)}</h1>
          <p>Academic Report - ${escapeHtml(exam?.name || '')}</p>
          ${photo ? `<img src="${escapeHtml(photo)}" alt="" style="height:100px;" />` : ''}
          <p><b>${escapeHtml(name)}</b> (${escapeHtml(application.student_id)})</p>
          <p>Class: ${escapeHtml(application.class_applying || '-')} · ${escapeHtml(exam?.academic_year || '')} ${escapeHtml(termLabel(exam?.term))}</p>
        </div>
        <p>Gender: ${escapeHtml(application.gender || '-')} · Date of Birth: ${escapeHtml(formatDate(application.date_of_birth))} · Conduct: ${escapeHtml(report.conduct)} · Interest: ${escapeHtml(report.interest)} · Attitude: ${escapeHtml(report.attitude)} · Position in Class: ${escapeHtml(report.position)}</p>
        <p>Closing Date: ${escapeHtml(formatDate(exam?.closing_date))} · Reopening Date: ${escapeHtml(formatDate(exam?.reopening_date))}</p>
        <table>
          <thead>
            <tr><th>Subject</th><th>Class (50)</th><th>Exam (50)</th><th>Total (100)</th><th>Rank</th><th>Grade</th><th>Remark</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <h2>Summary</h2>
        <p>Total Score: <b>${report.total.toFixed(1)}</b> · Average: <b>${report.average.toFixed(1)}%</b> · Grade: <b>${escapeHtml(report.averageGrade.grade)}</b> · Position: <b>${escapeHtml(report.position)}</b></p>
        ${report.gradingKey ? `<p><b>Grading Key:</b> ${escapeHtml(report.gradingKey)}</p>` : ''}
        ${att.total ? `<p>Attendance: ${att.present} present, ${att.absent} absent (${att.pct}%)</p>` : ''}
        <h2>Remarks</h2>
        <p><b>Class Teacher:</b> ${escapeHtml(report.teacherRemarks)}</p>
        <p><b>Head Teacher:</b> ${escapeHtml(report.headRemarks)}</p>
      `);
      return;
    }
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
          <>
            <Select label="Select an examination" value={selected} onChange={(e) => setSelected(e.target.value)} className="max-w-sm">
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} - {e.academic_year} ({termLabel(e.term)})
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-slate-400">Report card scores refresh automatically every 5 seconds.</p>
          </>
        ) : null}
        {setupError ? <Alert tone="error" className="mt-4">{setupError}</Alert> : null}
        {reportError ? <Alert tone="error" className="mt-4">{reportError}</Alert> : null}
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
                  {schoolAddress || schoolPhone ? (
                    <p className="mt-1 text-xs text-white/80">
                      {[schoolAddress, schoolPhone ? `Mobile: ${schoolPhone}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  {photo ? (
                    <img src={photo} alt="Student" className="img-zoom h-16 w-14 rounded-xl object-cover ring-2 ring-brand-100" />
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

              <div className="grid gap-x-6 gap-y-2 border-b border-slate-100 px-6 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <p><span className="font-semibold text-slate-500">Gender:</span> {application.gender || '-'}</p>
                <p><span className="font-semibold text-slate-500">Date of Birth:</span> {formatDate(application.date_of_birth)}</p>
                <p><span className="font-semibold text-slate-500">Conduct:</span> {report.conduct}</p>
                <p><span className="font-semibold text-slate-500">Interest:</span> {report.interest}</p>
                <p><span className="font-semibold text-slate-500">Attitude:</span> {report.attitude}</p>
                <p><span className="font-semibold text-slate-500">Position in Class:</span> {report.position}</p>
                <p><span className="font-semibold text-slate-500">Closing Date:</span> {formatDate(exam?.closing_date)}</p>
                <p><span className="font-semibold text-slate-500">Reopening Date:</span> {formatDate(exam?.reopening_date)}</p>
              </div>

              <div className="overflow-x-auto px-6 py-4">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-3 font-semibold">Subject</th>
                      <th className="pb-2 pr-3 font-semibold">Class (50)</th>
                      <th className="pb-2 pr-3 font-semibold">Exam (50)</th>
                      <th className="pb-2 pr-3 font-semibold">Total (100)</th>
                      <th className="pb-2 pr-3 font-semibold">Rank</th>
                      <th className="pb-2 pr-3 font-semibold">Grade</th>
                      <th className="pb-2 font-semibold">Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {report.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3 font-semibold text-slate-800">{row.subject}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{row.hasResult ? Number(row.class_score || 0).toFixed(1) : '-'}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{row.hasResult ? Number(row.exam_score || 0).toFixed(1) : '-'}</td>
                        <td className="py-2.5 pr-3 font-bold text-slate-800">{row.marks == null ? '-' : row.marks.toFixed(1)}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{row.rank ? ordinal(Number(row.rank)) : '-'}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`badge ${GRADE_CLASSES[row.grade.cls] || 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
                            {row.grade.grade}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-600">{row.level.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-brand-50 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Total Score</p>
                  <p className="mt-1 text-lg font-extrabold text-brand-800">{report.total.toFixed(1)}</p>
                </div>
                <div className="rounded-xl bg-teal-50 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Average</p>
                  <p className="mt-1 text-lg font-extrabold text-teal-800">{report.average.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl bg-accent-500/10 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">Grade</p>
                  <p className="mt-1 text-lg font-extrabold text-accent-700">{report.averageGrade.grade}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Position</p>
                  <p className="mt-1 text-lg font-extrabold text-slate-800">{report.position}</p>
                </div>
              </div>

              {report.gradingKey ? (
                <p className="px-6 pb-3 text-xs text-slate-500"><strong>Grading Key:</strong> {report.gradingKey}</p>
              ) : null}

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