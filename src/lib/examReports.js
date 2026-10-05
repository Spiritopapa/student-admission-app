/**
 * examReports.js - Print-ready examination documents and ranking helpers
 * for the admin dashboard (port of the legacy admin-exams report card &
 * transcript builders to the React app).
 */
import { supabase } from './supabase';
import {
  buildStudentName,
  formatDate,
  getSubjectGrade,
  getPerformanceLevel,
  getTeacherRemarks,
  getHeadTeacherRemarks,
} from './format';
import { resolveScale, gradeForScale } from './gradingScale';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '-';
  const m100 = num % 100;
  if (m100 >= 11 && m100 <= 13) return `${num}th`;
  const m10 = num % 10;
  if (m10 === 1) return `${num}st`;
  if (m10 === 2) return `${num}nd`;
  if (m10 === 3) return `${num}rd`;
  return `${num}th`;
}

async function getSchoolIdentity(schoolId) {
  let schoolName = 'My School';
  let schoolLogoUrl = '';
  let address = '';
  let motto = '';
  let academicYear = '';
  let currentTerm = '';
  if (schoolId) {
    const { data } = await supabase
      .from('school_settings')
      .select('school_name, school_address, school_motto, logo_url, academic_year, current_term')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (data) {
      if (data.school_name) schoolName = data.school_name;
      address = data.school_address || '';
      motto = data.school_motto || '';
      schoolLogoUrl = data.logo_url || '';
      academicYear = data.academic_year || '';
      currentTerm = data.current_term || '';
    }
    if (!schoolName || schoolName === 'My School') {
      const { data: sch } = await supabase
        .from('schools')
        .select('name, logo_url')
        .eq('id', schoolId)
        .maybeSingle();
      if (sch?.name) schoolName = sch.name;
      if (!schoolLogoUrl && sch?.logo_url) schoolLogoUrl = sch.logo_url;
    }
  }
  return { schoolName, schoolLogoUrl, address, motto, academicYear, currentTerm };
}

async function getGradingScale(schoolId, className = '') {
  if (!schoolId) return null;
  // Fetch every school row once, then resolve the EFFECTIVE scale for the
  // student's class: class override -> school-wide -> system defaults.
  const { data } = await supabase.from('grading_systems').select('*').eq('school_id', schoolId);
  return resolveScale(data || [], className).rows || null;
}

// Position (1-based) of a student among classmates by average marks in an exam.
function computeClassPosition(allResults, classStudentIds, studentId) {
  const avgs = {};
  (allResults || []).forEach((r) => {
    if (!classStudentIds.has(r.student_id)) return;
    if (!avgs[r.student_id]) avgs[r.student_id] = { total: 0, count: 0 };
    avgs[r.student_id].total += Number(r.marks_obtained) || 0;
    avgs[r.student_id].count += 1;
  });
  const sorted = Object.entries(avgs)
    .map(([sid, d]) => ({ sid, avg: d.count ? d.total / d.count : 0 }))
    .sort((a, b) => b.avg - a.avg);
  const idx = sorted.findIndex((s) => s.sid === studentId);
  return idx >= 0 ? idx + 1 : null;
}
const REPORT_CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;}
.rc{max-width:794px;margin:0 auto;padding:18px 0;}
.rc-top{height:8px;background:linear-gradient(90deg,#4f46e5,#818cf8);border-radius:6px 6px 0 0;}
.rc-head{display:flex;align-items:center;gap:12px;padding:14px 18px 10px;border-bottom:3px double #4f46e5;page-break-inside:avoid;}
.rc-logo{width:58px;height:58px;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:2px;}
.rc-seal{width:58px;height:58px;border-radius:8px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:9px;color:#6366f1;text-align:center;font-weight:700;}
.rc-school h1{font-size:19px;margin:0;color:#1e1b4b;}
.rc-school p{margin:2px 0;font-size:10.5px;color:#64748b;}
.rc-title{margin-left:auto;text-align:right;font-weight:800;color:#4f46e5;letter-spacing:1px;font-size:12px;}
.rc-student{display:flex;gap:12px;padding:10px 18px;align-items:flex-start;page-break-inside:avoid;}
.rc-photo{width:64px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #c7d2fe;}
.rc-photo-ph{width:64px;height:80px;border-radius:8px;background:#f1f5f9;border:1px dashed #cbd5e1;}
.rc-info{flex:1;}
.rc-info table{width:100%;border-collapse:collapse;font-size:11.5px;}
.rc-info td{padding:2px 3px;vertical-align:top;}
.rc-info .lbl{color:#64748b;width:104px;font-weight:600;}
.rc-pos{display:inline-block;background:#4f46e5;color:#fff;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;}
table.rc-scores{width:calc(100% - 36px);margin:6px 18px;border-collapse:collapse;font-size:10.5px;}
.rc-scores th{background:#eef2ff;color:#312e81;text-align:left;padding:6px;border:1px solid #c7d2fe;font-size:9.5px;text-transform:uppercase;}
.rc-scores td{border:1px solid #e2e8f0;padding:4px 6px;}
.rc-scores .num{text-align:center;}
.rc-scores .tot{font-weight:700;}
.rc-grade{font-weight:800;}
.rc-att{margin:4px 18px;font-size:10.5px;color:#334155;page-break-inside:avoid;}
.rc-att b{color:#0f172a;}
.rc-summary{display:flex;gap:10px;margin:8px 18px;page-break-inside:avoid;}
.rc-summary>div{flex:1;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 6px;}
.rc-summary span{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;display:block;}
.rc-summary b{font-size:15px;display:block;margin-top:2px;color:#1e1b4b;}
.rc-key{margin:8px 18px;font-size:9.5px;color:#64748b;page-break-inside:avoid;}
.rc-remarks{display:flex;gap:16px;margin:12px 18px;page-break-inside:avoid;}
.rc-remarks>div{flex:1;border-top:1px solid #cbd5e1;padding-top:6px;font-size:10.5px;min-height:64px;}
.rc-remarks .role{font-weight:700;color:#334155;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;}
.rc-sig{display:flex;justify-content:space-between;margin:20px 18px 8px;font-size:10.5px;color:#334155;page-break-inside:avoid;}
.rc-sig div{text-align:center;width:30%;}
.rc-sig .line{border-bottom:1px solid #94a3b8;height:16px;margin-bottom:2px;}
.rc-foot{display:flex;justify-content:space-between;margin:0 18px;font-size:9px;color:#94a3b8;page-break-inside:avoid;}
`;

function reportHeaderHtml(school, exam, app, name, positionDisplay) {
  const logo = school.schoolLogoUrl
    ? `<img class="rc-logo" src="${esc(school.schoolLogoUrl)}" alt="logo" />`
    : '<div class="rc-seal">SCHOOL</div>';
  return `
<div class="rc">
  <div class="rc-top"></div>
  <div class="rc-head">
    ${logo}
    <div class="rc-school">
      <h1>${esc(school.schoolName)}</h1>
      <p>${esc(school.address || 'Excellence in Education')}</p>
      <p>${esc(school.motto || 'Knowledge, Character, Service')}</p>
    </div>
    <div class="rc-title">ACADEMIC REPORT CARD</div>
  </div>
  <div class="rc-student">
    <div class="rc-info">
      <table>
        <tr><td class="lbl">Student Name</td><td>${esc(name)}</td></tr>
        <tr><td class="lbl">Student ID</td><td>${esc(app.student_id)}</td></tr>
        <tr><td class="lbl">Class / Grade</td><td>${esc(app.class_applying || '-')}</td></tr>
        <tr><td class="lbl">Academic Year</td><td>${esc(exam.academic_year || '')}</td></tr>
        <tr><td class="lbl">Term</td><td>${esc(exam.term || '')} Term</td></tr>
        <tr><td class="lbl">Exam</td><td>${esc(exam.name || '')}</td></tr>
      </table>
    </div>
    <div class="rc-info">
      <table>
        <tr><td class="lbl">Gender</td><td>${esc(app.gender || '-')}</td></tr>
        <tr><td class="lbl">Date of Birth</td><td>${esc(formatDate(app.date_of_birth))}</td></tr>
        <tr><td class="lbl">Interest</td><td>${esc(app.interest_display || '-')}</td></tr>
        <tr><td class="lbl">Attitude</td><td>${esc(app.attitude_display || '-')}</td></tr>
        <tr><td class="lbl">Position in Class</td><td><span class="rc-pos">${esc(positionDisplay)}</span></td></tr>
      </table>
    </div>
  </div>`;
}
export async function buildReportCardHTML({ examId, studentId, schoolId }) {
  const { data: app } = await supabase.from('applications').select('*').eq('student_id', studentId).maybeSingle();
  if (!app) return '<p>Student not found.</p>';
  const { data: exam } = await supabase.from('exams').select('*').eq('id', examId).maybeSingle();
  if (!exam) return '<p>Exam not found.</p>';

  let subsQuery = supabase.from('exam_subjects').select('subject').eq('exam_id', examId);
  if (app.class_applying) subsQuery = subsQuery.eq('class_name', app.class_applying);
  const { data: examSubs } = await subsQuery;
  const subjects = (examSubs || []).map((s) => s.subject) || [];
  if (!subjects.length) return '<p>No subjects configured for this exam.</p>';

  const school = await getSchoolIdentity(schoolId);
  const gradingScale = await getGradingScale(schoolId, app.class_applying);

  const [{ data: results }, { data: allResults }, { data: details }] = await Promise.all([
    supabase.from('exam_results').select('*').eq('exam_id', examId).eq('student_id', studentId),
    supabase.from('exam_results').select('student_id, subject, marks_obtained').eq('exam_id', examId),
    supabase.from('exam_student_details').select('*').eq('exam_id', examId).eq('student_id', studentId).maybeSingle(),
  ]);
  const { data: classApps } = await supabase
    .from('applications')
    .select('student_id')
    .eq('class_applying', app.class_applying || '');
  const classIds = new Set((classApps || []).map((a) => a.student_id));

  const resultMap = new Map((results || []).map((r) => [String(r.subject).toLowerCase(), r]));

  // Attendance for the matching academic year + term.
  const yearForAtt = school.academicYear || exam.academic_year || '';
  const termForAtt = school.currentTerm || exam.term || 'First';
  let present = 0;
  let absent = 0;
  if (yearForAtt) {
    const { data: attRecords } = await supabase
      .from('attendance')
      .select('status')
      .eq('student_id', studentId)
      .eq('academic_year', yearForAtt)
      .eq('term', termForAtt);
    (attRecords || []).forEach((r) => {
      if (r.status === 'present') present += 1;
      else if (r.status === 'absent') absent += 1;
    });
  }
  const attTotal = present + absent;

  // Subject marks map for per-subject rank positions.
  const subjectStats = {};
  (allResults || []).forEach((r) => {
    if (!classIds.has(r.student_id)) return;
    if (!subjectStats[r.subject]) subjectStats[r.subject] = {};
    subjectStats[r.subject][r.student_id] = Number(r.marks_obtained) || 0;
  });

  let total = 0;
  let entered = 0;
  const rowsHtml = subjects
    .map((sub) => {
      const r = resultMap.get(sub.toLowerCase());
      const marks = r && r.marks_obtained != null ? Number(r.marks_obtained) : null;
      const classScore = r && r.class_score != null ? Number(r.class_score) : 0;
      const examScore = r && r.exam_score != null ? Number(r.exam_score) : 0;
      if (marks != null) {
        total += marks;
        entered += 1;
      }
      const stats = subjectStats[sub] || {};
      const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
      let pos = null;
      sorted.forEach(([sid], idx) => {
        if (sid === studentId) pos = idx + 1;
      });
      const g = gradeForScale(gradingScale || [], marks ?? 0, sub);
      const perf = getPerformanceLevel(marks ?? 0);
      return `<tr>
        <td>${esc(sub)}</td>
        <td class="num">${r ? classScore.toFixed(1) : '-'}</td>
        <td class="num">${r ? examScore.toFixed(1) : '-'}</td>
        <td class="num tot">${marks != null ? marks.toFixed(1) : '-'}</td>
        <td class="num">${pos ? ordinal(pos) : '-'}</td>
        <td class="num rc-grade">${g.grade}</td>
        <td class="rc-perf">${esc(perf.text)}</td>
      </tr>`;
    })
    .join('');

  const average = entered ? total / entered : 0;
  const avgGrade = gradeForScale(gradingScale || [], average, '');
  const overallPosition = details?.overall_position || computeClassPosition(allResults, classIds, studentId);
  const positionDisplay = overallPosition ? ordinal(overallPosition) : '-';
  const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
  const remarks = details?.class_teacher_remarks || getTeacherRemarks(average);
  const headRemarks = details?.head_teacher_remarks || getHeadTeacherRemarks(average);
  const interest = details?.interest || app.interest || 'mathematics';
  const attitude = details?.attitude || app.attitude || 'active';
  const toTitle = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '-');
  const gradingKey = (gradingScale || [])
    .filter((g) => !g.subject_name)
    .slice(0, 4)
    .map((g) => `${esc(g.grade_label)} (${g.min_score}-${g.max_score ?? 100})`)
    .join(' · ');
  const photoHtml = app.student_photo_url
    ? `<img class="rc-photo" src="${esc(app.student_photo_url)}" alt="student" />`
    : '<div class="rc-photo-ph"></div>';
  const attPct = attTotal ? Math.round((present / attTotal) * 100) : 0;
return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${esc(name)} - Report Card</title><style>${REPORT_CSS}</style></head><body>
${reportHeaderHtml(
    school,
    exam,
    { ...app, interest_display: toTitle(interest), attitude_display: toTitle(attitude) },
    name,
    positionDisplay
  )}
  <div class="rc-student">${photoHtml}</div>
  ${attTotal > 0 ? `<div class="rc-att">Attendance: <b>${present} present</b> / ${absent} absent (${attPct}%)</div>` : ''}
  <table class="rc-scores">
    <thead><tr>
      <th>Subject</th><th class="num">Class (50)</th><th class="num">Exam (50)</th><th class="num">Total (100)</th><th class="num">Rank</th><th class="num">Grade</th><th>Remark</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="rc-summary">
    <div><span>Total Score</span><b>${total.toFixed(1)}</b></div>
    <div><span>Average</span><b>${average.toFixed(1)}%</b></div>
    <div><span>Grade</span><b>${avgGrade.grade}</b></div>
    <div><span>Position</span><b>${esc(positionDisplay)}</b></div>
  </div>
  ${gradingKey ? `<div class="rc-key"><b>Grading Key:</b> ${gradingKey}</div>` : ''}
  <div class="rc-remarks">
    <div><div class="role">Class Teacher's Remarks</div><div>${esc(remarks)}</div></div>
    <div><div class="role">Head Teacher's Remarks</div><div>${esc(headRemarks)}</div></div>
  </div>
  <div class="rc-sig">
    <div><div class="line"></div>Class Teacher</div>
    <div><div class="line"></div>Head Teacher</div>
    <div><div class="line"></div>Parent / Guardian</div>
  </div>
  <div class="rc-foot">
    <span>Closing Date: ${esc(formatDate(exam.closing_date))}</span>
    <span>Generated: ${esc(formatDate(new Date().toISOString()))}</span>
    <span>Reopening Date: ${esc(formatDate(exam.reopening_date))}</span>
  </div>
</div>
</body></html>`;
}
const TERM_ORDER = { First: 1, Second: 2, Third: 3 };

export async function buildTranscriptHTML({ studentId, schoolId }) {
  const { data: app } = await supabase.from('applications').select('*').eq('student_id', studentId).maybeSingle();
  if (!app) return '<p>Student not found.</p>';
  const school = await getSchoolIdentity(schoolId);
  const gradingScale = await getGradingScale(schoolId, app.class_applying);
  const { data: allExams } = await supabase.from('exams').select('id, name, academic_year, term').eq('school_id', schoolId);
  const { data: allStudentResults } = await supabase.from('exam_results').select('*').eq('student_id', studentId);

  const exams = (allExams || [])
    .filter((ex) => (allStudentResults || []).some((r) => r.exam_id === ex.id))
    .sort(
      (a, b) =>
        String(a.academic_year).localeCompare(String(b.academic_year)) ||
        (TERM_ORDER[a.term] || 9) - (TERM_ORDER[b.term] || 9)
    );
  if (!exams.length) return '<p>No examination history found for this student.</p>';

  const examIds = exams.map((ex) => ex.id);
  const [{ data: rawSubs }, { data: detailsRows }] = await Promise.all([
    supabase.from('exam_subjects').select('exam_id, subject, class_name').in('exam_id', examIds),
    supabase.from('exam_student_details').select('*').in('exam_id', examIds).eq('student_id', studentId),
  ]);
  const subsByExam = new Map();
  (rawSubs || []).forEach((s) => {
    if (app.class_applying && s.class_name && s.class_name !== app.class_applying) return;
    if (!subsByExam.has(s.exam_id)) subsByExam.set(s.exam_id, []);
    if (
      !subsByExam
        .get(s.exam_id)
        .some((x) => String(x).toLowerCase() === String(s.subject).toLowerCase())
    ) {
      subsByExam.get(s.exam_id).push(s.subject);
    }
  });
  const detailsByExam = new Map((detailsRows || []).map((d) => [d.exam_id, d]));
  const resultsByExam = new Map();
  (allStudentResults || []).forEach((r) => {
    if (!subsByExam.has(r.exam_id)) return;
    if (!resultsByExam.has(r.exam_id)) resultsByExam.set(r.exam_id, new Map());
    resultsByExam.get(r.exam_id).set(String(r.subject).toLowerCase(), r);
  });

  const termRecords = [];
  let grandTotal = 0;
  let grandCount = 0;
  for (const exam of exams) {
    const subjects = subsByExam.get(exam.id) || [];
    const results = resultsByExam.get(exam.id) || new Map();
    let total = 0;
    let count = 0;
    const rows = subjects
      .map((sub) => {
        const r = results.get(String(sub).toLowerCase());
        if (!r) return null;
        const marks = Number(r.marks_obtained) || 0;
        const cls = Number(r.class_score) || 0;
        const exm = Number(r.exam_score) || 0;
        total += marks;
        count += 1;
        grandTotal += marks;
        grandCount += 1;
        const g = gradeForScale(gradingScale || [], marks, sub);
        const perf = getPerformanceLevel(marks);
        return { sub, cls, exm, marks, grade: g.grade, perf: perf.text };
      })
      .filter(Boolean);
    const avg = count ? total / count : 0;
    const details = detailsByExam.get(exam.id);
    const avgGrade = gradeForScale(gradingScale || [], avg, '');
    termRecords.push({
      exam,
      rows,
      avg,
      grade: avgGrade.grade,
      position: details?.overall_position || null,
    });
  }

  const overallAvg = grandCount ? grandTotal / grandCount : 0;
  const overallGrade = gradeForScale(gradingScale || [], overallAvg, '');
  const overallName = buildStudentName(app.first_name, app.middle_name, app.last_name);
  const verdicts = [
    { verdict: 'Excellent', min: 80 },
    { verdict: 'Very Good', min: 70 },
    { verdict: 'Good', min: 60 },
    { verdict: 'Fair', min: 50 },
    { verdict: 'Developing', min: 40 },
  ];
  const verdict = verdicts.find((v) => overallAvg >= v.min)?.verdict || 'At Risk';
  const promotion =
    overallAvg >= 60
      ? { decision: 'PROMOTED', note: 'Recommended to progress to the next class without conditions.' }
      : overallAvg >= 50
        ? { decision: 'PROMOTED WITH SUPPORT', note: 'Progresses with a remedial support plan for weaker subjects.' }
        : overallAvg >= 40
          ? { decision: 'PROBATIONARY PROMOTION', note: 'Progresses conditionally; must show clear improvement.' }
          : { decision: 'REPEAT CLASS', note: 'Strongly recommended to repeat the current class.' };
const key = (gradingScale) => (gradingScale || [])
    .filter((g) => !g.subject_name)
    .slice(0, 3)
    .map((g) => `${esc(g.grade_label)} (${g.min_score}-${g.max_score ?? 100})`)
    .join(' · ');

  const termHtml = termRecords
    .map((rec) => {
      const rows = rec.rows
        .map(
          (r) => `<tr>
            <td>${esc(r.sub)}</td>
            <td class="num">${r.cls.toFixed(1)}</td>
            <td class="num">${r.exm.toFixed(1)}</td>
            <td class="num tot">${r.marks.toFixed(1)}</td>
            <td class="num rc-grade">${r.grade}</td>
            <td>${esc(r.perf)}</td>
          </tr>`
        )
        .join('');
      return `
      <div class="tr-card">
        <div class="tr-card-head">
          <b>${esc(rec.exam.name)}</b>
          <span>${esc(rec.exam.academic_year)} · ${esc(rec.exam.term)} Term</span>
        </div>
        <table class="rc-scores">
          <thead><tr><th>Subject</th><th class="num">Class (50)</th><th class="num">Exam (50)</th><th class="num">Total (100)</th><th class="num">Grade</th><th>Remark</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="rc-summary">
          <div><span>Average</span><b>${rec.avg.toFixed(1)}%</b></div>
          <div><span>Grade</span><b>${rec.grade}</b></div>
          <div><span>Position</span><b>${rec.position ? ordinal(rec.position) : '-'}</b></div>
          <div><span>Subjects</span><b>${rec.rows.length}</b></div>
        </div>
      </div>`;
    })
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${esc(overallName)} - Academic Transcript</title>
<style>${REPORT_CSS}
.tr-card{page-break-inside:avoid;margin:14px 0;border:1px solid #e2e8f0;border-radius:10px;padding:10px;}
.tr-card-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eef2ff;padding-bottom:6px;margin-bottom:6px;font-size:11.5px;}
.tr-card-head span{color:#64748b;font-size:10px;}
.tr-verdict{text-align:center;border:2px solid #4f46e5;border-radius:12px;padding:10px;margin:10px 18px;}
.tr-verdict .verdict{font-size:20px;font-weight:800;color:#1e1b4b;}
.tr-verdict .decision{font-weight:700;color:#4f46e5;margin-top:4px;font-size:12px;}
.tr-verdict .note{color:#64748b;font-size:10.5px;margin-top:4px;}
</style></head><body>
<div class="rc">
  <div class="rc-top"></div>
  <div class="rc-head">
    <div class="rc-seal">TRANSCRIPT</div>
    <div class="rc-school">
      <h1>${esc(school.schoolName)}</h1>
      <p>${esc(school.address || 'Academic Transcript')}</p>
      <p>${esc(school.motto || '')}</p>
    </div>
    <div class="rc-title">ACADEMIC TRANSCRIPT</div>
  </div>
  <div class="rc-student">
    <div class="rc-info">
      <table>
        <tr><td class="lbl">Student Name</td><td>${esc(overallName)}</td></tr>
        <tr><td class="lbl">Student ID</td><td>${esc(app.student_id)}</td></tr>
        <tr><td class="lbl">Class / Grade</td><td>${esc(app.class_applying || '-')}</td></tr>
        <tr><td class="lbl">Gender</td><td>${esc(app.gender || '-')}</td></tr>
      </table>
    </div>
    <div class="rc-info">
      <table>
        <tr><td class="lbl">Date of Birth</td><td>${esc(formatDate(app.date_of_birth))}</td></tr>
        <tr><td class="lbl">Exam Sessions</td><td>${termRecords.length}</td></tr>
        <tr><td class="lbl">Cumulative Average</td><td><b>${overallAvg.toFixed(1)}%</b></td></tr>
        <tr><td class="lbl">Overall Grade</td><td><b>${overallGrade.grade}</b></td></tr>
      </table>
    </div>
  </div>

  ${termHtml}

  <div class="tr-verdict">
    <div class="verdict">${esc(verdict)} (${overallAvg.toFixed(1)}%)</div>
    <div class="decision">Recommendation: ${esc(promotion.decision)}</div>
    <div class="note">${esc(promotion.note)}</div>
  </div>
  ${key(gradingScale) ? `<div class="rc-key"><b>Grading Key:</b> ${key(gradingScale)}</div>` : ''}
  <div class="rc-sig">
    <div><div class="line"></div>Class Teacher</div>
    <div><div class="line"></div>Head Teacher</div>
    <div><div class="line"></div>School Seal</div>
  </div>
  <div class="rc-foot">
    <span>Generated: ${esc(formatDate(new Date().toISOString()))}</span>
    <span>${esc(school.schoolName)}</span>
    <span>Official Academic Record</span>
  </div>
</div>
</body></html>`;
  return html;
}
export async function computeExamRankings({ examId, schoolId, classVal = '' }) {
  let subsQuery = supabase.from('exam_subjects').select('subject').eq('exam_id', examId);
  if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
  const { data: examSubs } = await subsQuery;
  const subjects = (examSubs || []).map((s) => s.subject) || [];
  if (!subjects.length) return { overall: [], subjects: [] };

  let appsQuery = supabase
    .from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('status', 'admitted');
  if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
  if (classVal) appsQuery = appsQuery.eq('class_applying', classVal);
  const { data: apps } = await appsQuery;
  const appMap = new Map((apps || []).map((a) => [a.student_id, a]));

  const { data: results } = await supabase
    .from('exam_results')
    .select('student_id, subject, marks_obtained')
    .eq('exam_id', examId);

  const overallByClass = {};
  (results || []).forEach((r) => {
    const app = appMap.get(r.student_id);
    const cls = app?.class_applying || 'Unknown';
    if (!overallByClass[cls]) overallByClass[cls] = {};
    if (!overallByClass[cls][r.student_id]) {
      overallByClass[cls][r.student_id] = {
        student_id: r.student_id,
        name: app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id,
        total: 0,
        count: 0,
      };
    }
    overallByClass[cls][r.student_id].total += Number(r.marks_obtained) || 0;
    overallByClass[cls][r.student_id].count += 1;
  });
  const overall = Object.keys(overallByClass)
    .sort()
    .map((cls) => {
      const list = Object.values(overallByClass[cls]).sort((a, b) => b.total / b.count - a.total / a.count);
      return {
        cls,
        rows: list.map((item, idx) => ({
          position: idx + 1,
          student_id: item.student_id,
          name: item.name,
          avg: item.count ? +((item.total / item.count) * 10).toFixed(1) / 10 : 0,
          grade: getSubjectGrade(item.total / (item.count || 1)).grade,
        })),
      };
    });

  const bySubject = {};
  (results || []).forEach((r) => {
    const app = appMap.get(r.student_id);
    if (!app) return;
    if (!bySubject[r.subject]) bySubject[r.subject] = [];
    bySubject[r.subject].push({
      student_id: r.student_id,
      name: buildStudentName(app.first_name, app.middle_name, app.last_name),
      marks: Number(r.marks_obtained) || 0,
    });
  });
  const subjectRanks = subjects
    .map((sub) => {
      const list = (bySubject[sub] || []).sort((a, b) => b.marks - a.marks);
      return {
        subject: sub,
        rows: list.map((item, idx) => ({
          position: idx + 1,
          student_id: item.student_id,
          name: item.name,
          marks: item.marks,
        })),
      };
    })
    .filter((s) => s.rows.length);

  return { overall, subjects: subjectRanks };
}