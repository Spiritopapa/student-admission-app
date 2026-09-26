import { TERM_LABELS } from './constants';

export function formatCurrency(value) {
  return new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function cedi(value) {
  return `GHC ${formatCurrency(value)}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildStudentName(first, middle, last) {
  return [first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function termLabel(term) {
  return TERM_LABELS[term] || term || '-';
}

export function getSubjectGrade(marks) {
  const m = Number(marks || 0);
  if (m >= 80) return { grade: 'A', cls: 'grade-a' };
  if (m >= 70) return { grade: 'B', cls: 'grade-b' };
  if (m >= 60) return { grade: 'C', cls: 'grade-c' };
  if (m >= 50) return { grade: 'D', cls: 'grade-d' };
  if (m >= 40) return { grade: 'E', cls: 'grade-e' };
  return { grade: 'F', cls: 'grade-f' };
}

export function getPerformanceLevel(marks) {
  const m = Number(marks || 0);
  if (m >= 80) return { text: 'Excellent', cls: 'excellent' };
  if (m >= 70) return { text: 'Very Good', cls: 'very-good' };
  if (m >= 60) return { text: 'Good', cls: 'good' };
  if (m >= 50) return { text: 'Credit', cls: 'credit' };
  if (m >= 40) return { text: 'Pass', cls: 'pass' };
  return { text: 'Needs Improvement', cls: 'needs-improvement' };
}

export function getTeacherRemarks(average) {
  const a = Number(average || 0);
  if (a >= 80) return 'Excellent performance! Keep up the great work.';
  if (a >= 70) return 'Very good performance. Can do even better with more effort.';
  if (a >= 60) return 'Good performance. Needs to work harder to reach the top.';
  if (a >= 40) return 'Satisfactory but needs significant improvement in all subjects.';
  if (a >= 35) return 'Below average. Requires remedial classes and extra attention.';
  return 'Poor performance. Urgent intervention and parent-teacher meeting required.';
}

export function getHeadTeacherRemarks(average) {
  const a = Number(average || 0);
  if (a >= 80)
    return 'An outstanding performance worthy of commendation. The student has demonstrated excellence across all subjects. Keep nurturing this potential.';
  if (a >= 70)
    return 'A very good performance showing solid understanding of the curriculum. With continued dedication, the student can achieve even greater heights.';
  if (a >= 60)
    return 'Good effort has been shown this term. The student is progressing well but should focus more on challenging areas to improve further.';
  if (a >= 40)
    return 'The student is developing but needs to put in more effort across all subjects. Regular study and parental support are highly recommended.';
  if (a >= 35)
    return 'Performance is below expectations. The school recommends remedial classes and close monitoring. Parent-teacher collaboration is essential.';
  return 'Serious concern regarding academic progress. Immediate intervention is required. A meeting with parents and the class teacher is mandatory.';
}

export function initialsOf(name) {
  return String(name || 'S')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function truncate(text, length = 80) {
  const t = String(text || '');
  return t.length > length ? `${t.slice(0, length)}...` : t;
}