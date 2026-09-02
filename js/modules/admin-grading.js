/**
 * Admin Grading System Module
 * Per-school configurable grading system with custom grade labels, score ranges, and descriptions.
 * Supports both overall grading (subject_name IS NULL) and per-subject grading.
 */

import { getEl, showMessage, clearMessage, setLoading, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;
let _cachedGrades = null;
let _cachedSchoolId = null;

export function initAdminGrading(supabase) {
  supabaseClient = supabase;
}

export function setupGradingListeners() {
  getEl('gradingForm')?.addEventListener('submit', saveGrade);
  getEl('btnAddGradeRow')?.addEventListener('click', addGradeRow);
  getEl('btnResetDefaultGrades')?.addEventListener('click', resetToDefaultGrades);
  getEl('gradingSubjectFilter')?.addEventListener('change', () => {
    renderGradingTable();
    updateGradingFormSubject();
  });
}

// ================================================================
// Load Grading Page
// ================================================================

export async function loadGradingPage() {
  clearMessage('gradingMessage');
  await populateGradingSubjectDropdown();
  await renderGradingTable();
}

// ================================================================
// Populate subject dropdown
// ================================================================

async function populateGradingSubjectDropdown() {
  const sel = getEl('gradingSubjectFilter');
  if (!sel) return;
  
  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data } = await query;
    
    sel.innerHTML = '<option value="">— Overall Grading (All Subjects) —</option>' + 
      (data || []).map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load subjects for grading:', err);
  }
}

function updateGradingFormSubject() {
  const filterVal = getEl('gradingSubjectFilter')?.value || '';
  const subjectField = getEl('gradeSubjectName');
  if (subjectField) {
    subjectField.value = filterVal;
    subjectField.readOnly = !!filterVal;
  }
}

// ================================================================
// Fetch grades for current school (with caching)
// ================================================================

export async function fetchSchoolGrades(forceRefresh = false, subjectName = null) {
  const schoolId = await getCurrentSchoolId();
  if (!forceRefresh && _cachedGrades && _cachedSchoolId === schoolId) {
    // Filter by subject if specified
    if (subjectName) {
      return _cachedGrades.filter(g => g.subject_name === subjectName || g.subject_name === null);
    }
    return _cachedGrades;
  }

  try {
    // Get school-specific grades
    let query = supabaseClient
      .from('grading_systems')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('min_score', { ascending: false });

    if (schoolId) {
      query = query.eq('school_id', schoolId);
    } else {
      query = query.is('school_id', null).eq('is_default', true);
    }

    const { data, error } = await query;
    
    if (error) throw error;

    if (data && data.length > 0) {
      _cachedGrades = data;
      _cachedSchoolId = schoolId;
      if (subjectName) {
        return data.filter(g => g.subject_name === subjectName || g.subject_name === null);
      }
      return data;
    }

    // Fallback to default grades
    const { data: defaults } = await supabaseClient
      .from('grading_systems')
      .select('*')
      .is('school_id', null)
      .eq('is_default', true)
      .order('sort_order', { ascending: true })
      .order('min_score', { ascending: false });

    _cachedGrades = defaults || [];
    _cachedSchoolId = schoolId;
    if (subjectName) {
      return _cachedGrades.filter(g => g.subject_name === subjectName || g.subject_name === null);
    }
    return _cachedGrades;
  } catch (err) {
    console.error('Failed to fetch grading systems:', err);
    return getDefaultGrades();
  }
}

/**
 * Clear cached grades (e.g., after saving)
 */
export function clearGradingCache() {
  _cachedGrades = null;
  _cachedSchoolId = null;
}

/**
 * Get the grade info for a given score using the school's grading system.
 * Supports per-subject grading: if subjectName is provided, it will look for
 * subject-specific grades first, then fall back to overall grades.
 */
export async function getGradeForScore(score, subjectName = null) {
  const grades = await fetchSchoolGrades();
  if (!grades || grades.length === 0) {
    return { grade: 'F', desc: 'Fail', cls: 'grade-f' };
  }

  // If subject specified, try subject-specific grades first
  if (subjectName) {
    const subjectGrades = grades.filter(g => g.subject_name === subjectName);
    if (subjectGrades.length > 0) {
      const sorted = [...subjectGrades].sort((a, b) => b.min_score - a.min_score);
      for (const g of sorted) {
        if (score >= Number(g.min_score) && score <= Number(g.max_score || 100)) {
          return {
            grade: g.grade_label,
            desc: g.description || '',
            cls: g.color_class || 'grade-f'
          };
        }
      }
    }
  }

  // Fallback to overall grades (subject_name IS NULL)
  const overallGrades = grades.filter(g => !g.subject_name);
  if (overallGrades.length > 0) {
    const sorted = [...overallGrades].sort((a, b) => b.min_score - a.min_score);
    for (const g of sorted) {
      if (score >= Number(g.min_score) && score <= Number(g.max_score || 100)) {
        return {
          grade: g.grade_label,
          desc: g.description || '',
          cls: g.color_class || 'grade-f'
        };
      }
    }
  }

  // Fallback to lowest grade
  const allSorted = [...grades].sort((a, b) => b.min_score - a.min_score);
  const lowest = allSorted[allSorted.length - 1];
  return {
    grade: lowest?.grade_label || 'F',
    desc: lowest?.description || 'Fail',
    cls: lowest?.color_class || 'grade-f'
  };
}

/**
 * Get performance level text based on score
 */
export async function getPerformanceLevel(score) {
  const pct = score;
  if (pct >= 80) return { text: 'Excellent', cls: 'excellent' };
  if (pct >= 70) return { text: 'Very Good', cls: 'very good' };
  if (pct >= 60) return { text: 'Good', cls: 'good' };
  if (pct >= 50) return { text: 'Credit', cls: 'credit' };
  if (pct >= 40) return { text: 'Pass', cls: 'pass' };
  return { text: 'Needs Improvement', cls: 'needs-improvement' };
}

/**
 * Get teacher remarks based on average score
 */
export async function getTeacherRemarks(average) {
  if (average >= 80) return 'Excellent performance! Keep up the great work.';
  if (average >= 70) return 'Very good performance. Can do even better with more effort.';
  if (average >= 60) return 'Good performance. Needs to work harder to reach the top.';
  if (average >= 40) return 'Satisfactory but needs significant improvement in all subjects.';
  if (average >= 35) return 'Below average. Requires remedial classes and extra attention.';
  return 'Poor performance. Urgent intervention and parent-teacher meeting required.';
}

/**
 * Get head teacher remarks based on average score
 */
export async function getHeadTeacherRemarks(average) {
  if (average >= 80) return 'An outstanding performance worthy of commendation. The student has demonstrated excellence across all subjects. Keep nurturing this potential.';
  if (average >= 70) return 'A very good performance showing solid understanding of the curriculum. With continued dedication, the student can achieve even greater heights.';
  if (average >= 60) return 'Good effort has been shown this term. The student is progressing well but should focus more on challenging areas to improve further.';
  if (average >= 40) return 'The student is developing but needs to put in more effort across all subjects. Regular study and parental support are highly recommended.';
  if (average >= 35) return 'Performance is below expectations. The school recommends remedial classes and close monitoring. Parent-teacher collaboration is essential.';
  return 'Serious concern regarding academic progress. Immediate intervention is required. A meeting with parents and the class teacher is mandatory.';
}

/**
 * Get the grading scale HTML for report cards
 * If subjectName is provided, shows subject-specific grading; otherwise shows overall
 */
export async function getGradingScaleHTML(subjectName = null) {
  const grades = await fetchSchoolGrades();
  if (!grades || grades.length === 0) {
    return '<span class="rc-key-title">Grading Scale:</span><span class="rc-key-item">Standard grading applied</span>';
  }

  // Filter: if subject specified, show subject-specific + overall; otherwise show overall only
  let relevantGrades;
  if (subjectName) {
    const subjectSpecific = grades.filter(g => g.subject_name === subjectName);
    const overall = grades.filter(g => !g.subject_name);
    relevantGrades = subjectSpecific.length > 0 ? subjectSpecific : overall;
  } else {
    relevantGrades = grades.filter(g => !g.subject_name);
  }

  if (relevantGrades.length === 0) {
    relevantGrades = grades.filter(g => !g.subject_name);
  }

  const sorted = [...relevantGrades].sort((a, b) => b.min_score - a.min_score);
  
  return sorted.map(g => {
    const cls = g.color_class || 'grade-f';
    const label = g.grade_label;
    const desc = g.description || '';
    const range = `${g.min_score}${g.max_score && g.max_score < 100 ? `-${g.max_score}%` : g.max_score >= 100 ? '+%' : ''}`;
    return `<span class="rc-key-item"><span class="rc-grade-badge ${cls}">${label}</span> ${range}${desc ? ` (${desc})` : ''}</span>`;
  }).join('');
}

// ================================================================
// Default grades (fallback)
// ================================================================

function getDefaultGrades() {
  return [
    { subject_name: null, grade_label: 'A', min_score: 80, max_score: 100, description: 'Advance', color_class: 'grade-a', sort_order: 1 },
    { subject_name: null, grade_label: 'B', min_score: 70, max_score: 79.99, description: 'Proficient', color_class: 'grade-b', sort_order: 2 },
    { subject_name: null, grade_label: 'C', min_score: 60, max_score: 69.99, description: 'Approaching Proficient', color_class: 'grade-c', sort_order: 3 },
    { subject_name: null, grade_label: 'D', min_score: 50, max_score: 59.99, description: 'Developing', color_class: 'grade-d', sort_order: 4 },
    { subject_name: null, grade_label: 'E', min_score: 40, max_score: 49.99, description: 'Beginning', color_class: 'grade-e', sort_order: 5 },
    { subject_name: null, grade_label: 'F', min_score: 0, max_score: 39.99, description: 'Fail', color_class: 'grade-f', sort_order: 6 },
  ];
}

// ================================================================
// Render Grading Table
// ================================================================

async function renderGradingTable() {
  const container = getEl('gradingTableBody');
  const noEl = getEl('noGradingConfig');
  if (!container) return;

  const subjectFilter = getEl('gradingSubjectFilter')?.value || null;
  const grades = await fetchSchoolGrades(true, subjectFilter);
  
  if (!grades || grades.length === 0) {
    container.innerHTML = '';
    if (noEl) noEl.style.display = 'block';
    return;
  }
  if (noEl) noEl.style.display = 'none';

  const sorted = [...grades].sort((a, b) => a.sort_order - b.sort_order);

  container.innerHTML = sorted.map((g, idx) => {
    const range = `${g.min_score}${g.max_score && g.max_score < 100 ? ` - ${g.max_score}` : g.max_score >= 100 ? ' - 100' : ''}`;
    const cls = g.color_class || 'grade-f';
    const subjectLabel = g.subject_name ? `<span style="font-size:0.75rem;color:var(--text-muted);">${g.subject_name}</span>` : '<span style="font-size:0.75rem;color:var(--text-muted);">Overall</span>';
    return `<tr>
      <td>${subjectLabel}</td>
      <td><span class="rc-grade-badge ${cls}" style="font-size:0.9rem;padding:0.25rem 0.75rem;">${g.grade_label}</span></td>
      <td>${range}%</td>
      <td>${g.description || '-'}</td>
      <td>
        <button type="button" class="action-btn confirm" onclick="editGradeRow('${g.id}','${g.grade_label.replace(/'/g, "\\'")}','${g.min_score}','${g.max_score || 100}','${(g.description || '').replace(/'/g, "\\'")}','${g.color_class || ''}','${g.sort_order}','${(g.subject_name || '').replace(/'/g, "\\'")}')"></button>
        <button type="button" class="action-btn danger" onclick="deleteGradeRow('${g.id}')"></button>
      </td>
    </tr>`;
  }).join('');
}

// ================================================================
// Add Grade Row (UI)
// ================================================================

function addGradeRow() {
  const form = getEl('gradingForm');
  if (form) form.reset();
  getEl('gradeEditId').value = '';
  getEl('gradeLabel').value = '';
  getEl('gradeMinScore').value = '';
  getEl('gradeMaxScore').value = '100';
  getEl('gradeDescription').value = '';
  getEl('gradeColorClass').value = 'grade-a';
  getEl('gradeSortOrder').value = '';
  getEl('gradeSubjectName').value = getEl('gradingSubjectFilter')?.value || '';
  getEl('gradingFormSection').open = true;
  getEl('gradeSubmitBtn').textContent = 'Add Grade';
}

// Expose globally for onclick
window.addGradeRow = addGradeRow;

window.editGradeRow = function(id, label, minScore, maxScore, desc, colorClass, sortOrder, subjectName) {
  getEl('gradeEditId').value = id;
  getEl('gradeLabel').value = label;
  getEl('gradeMinScore').value = minScore;
  getEl('gradeMaxScore').value = maxScore;
  getEl('gradeDescription').value = desc;
  getEl('gradeColorClass').value = colorClass || 'grade-a';
  getEl('gradeSortOrder').value = sortOrder;
  getEl('gradeSubjectName').value = subjectName || '';
  getEl('gradingFormSection').open = true;
  getEl('gradeSubmitBtn').textContent = 'Update Grade';
};

window.deleteGradeRow = async function(id) {
  if (!confirm('Delete this grade level?')) return;
  try {
    const { error } = await supabaseClient.from('grading_systems').delete().eq('id', id);
    if (error) throw error;
    clearGradingCache();
    showMessage('gradingMessage', 'Grade deleted.', 'success');
    await renderGradingTable();
  } catch (err) {
    showMessage('gradingMessage', 'Error: ' + err.message, 'error');
  }
};

// ================================================================
// Save Grade
// ================================================================

async function saveGrade(e) {
  e.preventDefault();
  clearMessage('gradingMessage');
  const btn = getEl('gradeSubmitBtn');
  setLoading(btn, true, 'Saving...');

  const editId = getEl('gradeEditId').value;
  const schoolId = await getCurrentSchoolId();
  const subjectName = getEl('gradeSubjectName').value.trim() || null;
  
  const payload = {
    grade_label: getEl('gradeLabel').value.trim(),
    min_score: parseFloat(getEl('gradeMinScore').value) || 0,
    max_score: getEl('gradeMaxScore').value ? parseFloat(getEl('gradeMaxScore').value) : 100,
    description: getEl('gradeDescription').value.trim(),
    color_class: getEl('gradeColorClass').value,
    sort_order: parseInt(getEl('gradeSortOrder').value) || 0,
    school_id: schoolId,
    subject_name: subjectName,
  };

  try {
    if (editId) {
      const { error } = await supabaseClient.from('grading_systems').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('gradingMessage', 'Grade updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('grading_systems').insert([payload]);
      if (error) throw error;
      showMessage('gradingMessage', 'Grade added.', 'success');
    }

    getEl('gradingForm').reset();
    getEl('gradeEditId').value = '';
    getEl('gradingFormSection').open = false;
    clearGradingCache();
    await renderGradingTable();
  } catch (err) {
    showMessage('gradingMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, editId ? 'Update Grade' : 'Add Grade');
  }
}

// ================================================================
// Reset to Default Grades
// ================================================================

async function resetToDefaultGrades() {
  if (!confirm('Reset grading system to default values? This will replace all your current grade levels with the system defaults.')) return;
  
  const btn = getEl('btnResetDefaultGrades');
  setLoading(btn, true, 'Resetting...');
  
  try {
    const schoolId = await getCurrentSchoolId();
    
    // Delete existing school-specific grades
    if (schoolId) {
      const { error: delError } = await supabaseClient.from('grading_systems')
        .delete()
        .eq('school_id', schoolId);
      if (delError) throw delError;
    }

    // Insert defaults for this school (overall only)
    const defaults = [
      { school_id: schoolId, subject_name: null, grade_label: 'A', min_score: 80, max_score: 100, description: 'Advance', color_class: 'grade-a', sort_order: 1 },
      { school_id: schoolId, subject_name: null, grade_label: 'B', min_score: 70, max_score: 79.99, description: 'Proficient', color_class: 'grade-b', sort_order: 2 },
      { school_id: schoolId, subject_name: null, grade_label: 'C', min_score: 60, max_score: 69.99, description: 'Approaching Proficient', color_class: 'grade-c', sort_order: 3 },
      { school_id: schoolId, subject_name: null, grade_label: 'D', min_score: 50, max_score: 59.99, description: 'Developing', color_class: 'grade-d', sort_order: 4 },
      { school_id: schoolId, subject_name: null, grade_label: 'E', min_score: 40, max_score: 49.99, description: 'Beginning', color_class: 'grade-e', sort_order: 5 },
      { school_id: schoolId, subject_name: null, grade_label: 'F', min_score: 0, max_score: 39.99, description: 'Fail', color_class: 'grade-f', sort_order: 6 },
    ];

    const { error: insError } = await supabaseClient.from('grading_systems').insert(defaults);
    if (insError) throw insError;

    clearGradingCache();
    showMessage('gradingMessage', 'Grading system reset to defaults.', 'success');
    await renderGradingTable();
  } catch (err) {
    showMessage('gradingMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Reset to Defaults');
  }
}