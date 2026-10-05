/**
 * gradingScale.js - Shared, class-aware grading-scale helpers for the React app.
 *
 * The grading_systems table supports per-school, per-class and per-subject grade
 * bands. Scope rules on each row:
 *   class_name   NULL      -> school-wide scale (applies to every class)
 *   class_name   "Class 1" -> per-class override for that class
 *   subject_name NULL      -> overall band (all subjects)
 *   subject_name "Maths"   -> subject-specific band for an exact subject
 *
 * When a score is resolved the MOST SPECIFIC scope wins:
 * class+subject -> class+overall -> school+subject -> school+overall ->
 * system default overall (the seeded A-F scale).
 *
 * Consumers (AdminGrading, AdminExams, TeacherExams, examReports, StudentResults)
 * all go through fetchGradingScale() + gradeForScale() so one source of truth
 * drives the score sheet, rankings, report cards and transcripts.
 */
import { supabase } from './supabase';

// System default A-F scale (subject_name/class_name NULL rows seeded by sql/013).
export const DEFAULT_GRADES = [
  { subject_name: null, class_name: null, grade_label: 'A', min_score: 80, max_score: 100, description: 'Advance', color_class: 'grade-a', sort_order: 1 },
  { subject_name: null, class_name: null, grade_label: 'B', min_score: 70, max_score: 79.99, description: 'Proficient', color_class: 'grade-b', sort_order: 2 },
  { subject_name: null, class_name: null, grade_label: 'C', min_score: 60, max_score: 69.99, description: 'Approaching Proficient', color_class: 'grade-c', sort_order: 3 },
  { subject_name: null, class_name: null, grade_label: 'D', min_score: 50, max_score: 59.99, description: 'Developing', color_class: 'grade-d', sort_order: 4 },
  { subject_name: null, class_name: null, grade_label: 'E', min_score: 40, max_score: 49.99, description: 'Beginning', color_class: 'grade-e', sort_order: 5 },
  { subject_name: null, class_name: null, grade_label: 'F', min_score: 0, max_score: 39.99, description: 'Fail', color_class: 'grade-f', sort_order: 6 },
];

// Badge chip colours for each grade-* colour_class (shared by every screen).
export const GRADE_CLASSES = {
  'grade-a': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  'grade-b': 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  'grade-c': 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  'grade-d': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'grade-e': 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  'grade-f': 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

// <Badge> tone mapped from a grade-* colour_class.
export const GRADE_TONES = {
  'grade-a': 'green',
  'grade-b': 'blue',
  'grade-c': 'blue',
  'grade-d': 'amber',
  'grade-e': 'amber',
  'grade-f': 'red',
};

// Colour choices offered in the AdminGrading add/edit form.
export const GRADE_OPTIONS = Object.keys(GRADE_CLASSES);

export function gradeTone(colorClass) {
  return GRADE_TONES[colorClass] || 'blue';
}

// Sort by display order (sort_order asc) then highest boundary first.
export function sortScaleRows(rows = []) {
  return [...rows].sort((a, b) => {
    const sa = Number(a.sort_order) || 0;
    const sb = Number(b.sort_order) || 0;
    if (sa !== sb) return sa - sb;
    return (Number(b.min_score) || 0) - (Number(a.min_score) || 0);
  });
}

/**
 * Resolve the effective scale for one class from every school grading row.
 * Class-specific rows win; otherwise school-wide (class_name NULL) rows;
 * otherwise the synthetic system default A-F scale.
 * Returns { rows, source: 'class'|'school'|'default', hasOverride }.
 */
export function resolveScale(rows = [], className = '') {
  const cls = String(className || '').trim();
  const custom = sortScaleRows(rows.filter((r) => String(r.class_name || '').trim() === cls));
  if (custom.length) return { rows: custom, source: 'class', hasOverride: true };
  const school = sortScaleRows(rows.filter((r) => !String(r.class_name || '').trim()));
  if (school.length) return { rows: school, source: 'school', hasOverride: false };
  return { rows: sortScaleRows(DEFAULT_GRADES), source: 'default', hasOverride: false };
}
// Small module-level cache per (school, class) so the score sheet / previews
// don't refetch on every keystroke.
const scaleCache = new Map();

export async function fetchGradingScale(schoolId, className = '') {
  if (!schoolId) return resolveScale([], className);
  const key = `${schoolId}|${String(className || '').trim()}`;
  if (scaleCache.has(key)) return scaleCache.get(key);
  const { data, error } = await supabase.from('grading_systems').select('*').eq('school_id', schoolId);
  const scale = error ? resolveScale([], className) : resolveScale(data || [], className);
  scaleCache.set(key, scale);
  return scale;
}

export function clearGradingScaleCache() {
  scaleCache.clear();
}

/**
 * Grade a mark against the effective scale (array of rows).
 * Subject-specific bands win over the overall band when a subject match exists;
 * falls back to the lowest band when the score is below every minimum.
 */
export function gradeForScale(rows, marks, subject = '') {
  const score = Number(marks);
  const list = rows || [];
  if (!list.length || !Number.isFinite(score)) return { grade: 'F', desc: 'Fail', cls: 'grade-f' };
  const subj = String(subject || '').trim();
  const subjectRows = subj
    ? list.filter((r) => String(r.subject_name || '').trim().toLowerCase() === subj.toLowerCase())
    : [];
  const overallPool = list.filter((r) => !String(r.subject_name || '').trim());
  const matchIn = (pool) =>
    [...pool].sort((a, b) => (Number(b.min_score) || 0) - (Number(a.min_score) || 0))
      .find((b) => score >= Number(b.min_score) && score <= Number(b.max_score ?? 100));
  // Highest priority: a matching subject-specific band.
  let row = matchIn(subjectRows);
  // Subject bands never cover a score -> fall back to the overall scale.
  if (!row) row = matchIn(overallPool);
  // Below every boundary: use the lowest band of whichever pool provided bands.
  if (!row) {
    const pool = subjectRows.length ? subjectRows : overallPool;
    row = [...pool].sort((a, b) => (Number(a.min_score) || 0) - (Number(b.min_score) || 0))[0];
  }
  if (!row) return { grade: 'F', desc: 'Fail', cls: 'grade-f' };
  return {
    grade: row.grade_label,
    desc: row.description || '',
    cls: row.color_class || 'grade-f',
  };
}

/**
 * Resolve a grade object for a (school, class, score, subject) without the
 * caller having to manage the scale. Convenience over fetchGradingScale.
 */
export async function gradeForScore(schoolId, className, marks, subject = '') {
  const scale = await fetchGradingScale(schoolId, className);
  return gradeForScale(scale.rows, marks, subject);
}

// Group rows for the AdminGrading editor: overall bands + subject groups.
export function groupScaleRows(rows = []) {
  const overall = sortScaleRows(rows.filter((r) => !String(r.subject_name || '').trim()));
  const bySubject = {};
  rows.forEach((r) => {
    const s = String(r.subject_name || '').trim();
    if (!s) return;
    (bySubject[s] = bySubject[s] || []).push(r);
  });
  Object.keys(bySubject).forEach((k) => {
    bySubject[k] = sortScaleRows(bySubject[k]);
  });
  return { overall, bySubject };
}