/**
 * Teacher Assessments Module - Question bank, assessments, results
 * Scaffolded for the teacher's assigned subjects/classes.
 */

import { getEl, showMessage, clearMessage, setLoading, openPrintWindow, logStaffActivity } from './utils.js';
import { esc, parseBulkQuestions, insertRowsChunked, buildPrintShell } from './assessment-shared.js';

let supabaseClient = null;
let _teacherRows = [];
let _teacherTeacher = null;
let _teacherAttemptCache = [];
let _teacherAttemptMeta = null;

export function initTeacherAssessments(supabase) {
  supabaseClient = supabase;
}

export function setupTeacherAssessments() {
  document.querySelectorAll('#teacherAssessTabs button[data-tatab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#teacherAssessTabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tatab');
      document.querySelectorAll('.assess-tab-content[id^="teacherAssessTab-"]').forEach((el) => el.style.display = 'none');
      const target = getEl('teacherAssessTab-' + tab);
      if (target) target.style.display = 'block';
      if (tab === 'assessments') loadTeacherAssessments();
      if (tab === 'attempts') loadTeacherAttempts();
    });
  });

  getEl('btnTeacherAddQuestion')?.addEventListener('click', () => {
    getEl('teacherQuestionEditId').value = '';
    getEl('teacherQuestionForm').reset();
    setTeacherQuestionDefaults();
    getEl('teacherQuestionFormSection').open = true;
    getEl('teacherQuestionFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  getEl('teacherQuestionForm')?.addEventListener('submit', saveTeacherQuestion);
  getEl('teacherQuestionSearch')?.addEventListener('input', renderTeacherQuestionList);
  getEl('teacherQuestionSubjectFilter')?.addEventListener('change', renderTeacherQuestionList);
  getEl('teacherQuestionClassFilter')?.addEventListener('change', renderTeacherQuestionList);

  getEl('btnTeacherBulkImport')?.addEventListener('click', () => {
    getEl('teacherBulkImportSection').open = true;
    getEl('teacherBulkImportSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  getEl('teacherBulkImportFile')?.addEventListener('change', handleTeacherBulkFile);
  getEl('btnTeacherPreviewBulk')?.addEventListener('click', previewTeacherBulk);
  getEl('btnTeacherRunBulk')?.addEventListener('click', runTeacherBulk);

  getEl('teacherAssessmentConfigForm')?.addEventListener('submit', saveTeacherAssessment);
  getEl('btnPrintTeacherAttempts')?.addEventListener('click', printTeacherAttempts);
  getEl('btnTeacherCreateAssessment')?.addEventListener('click', () => {
    getEl('teacherAssessmentConfigId').value = '';
    getEl('teacherAssessmentConfigForm').reset();
    getEl('teacherShuffleQuestions').checked = true;
    getEl('teacherShuffleOptions').checked = true;
    getEl('teacherAssessmentActive').checked = true;
    getEl('teacherAssessmentPublished').checked = false;
    getEl('teacherPassPercentage').value = 50;
    getEl('teacherAssessmentQuestionCount').value = 10;
    getEl('teacherAssessmentDuration').value = 30;
    setTeacherQuestionDefaults();
    getEl('teacherAssessmentConfigSection').open = true;
    getEl('teacherAssessmentConfigSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function resolveTeacher() {
  if (_teacherTeacher) return _teacherTeacher;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  let { data: teacher } = await supabaseClient.from('teachers').select('*').eq('user_id', user.id).maybeSingle();
  if (!teacher) {
    const regId = user.user_metadata?.registration_id;
    if (regId) {
      const { data: byReg } = await supabaseClient.from('teachers').select('*').eq('registration_id', regId).maybeSingle();
      if (byReg) {
        try { await supabaseClient.rpc('auto_approve_teacher_on_login', { p_user_id: user.id, p_registration_id: regId }); } catch (e) {}
        teacher = byReg;
      }
    }
  }
  if (!teacher) return null;

  // Assigned subjects/classes
  const { data: assignments } = await supabaseClient.from('teacher_classes_subjects')
    .select('class_name, subject_name').eq('teacher_id', teacher.id);
  let subjects = [], classes = [];
  if (assignments && assignments.length) {
    subjects = [...new Set(assignments.map((a) => a.subject_name))].sort();
    classes = [...new Set(assignments.map((a) => a.class_name))].sort();
  } else {
    subjects = (teacher.subject || '').split(',').map((s) => s.trim()).filter(Boolean);
    classes = (teacher.class_taught || '').split(',').map((c) => c.trim()).filter(Boolean);
  }
  _teacherTeacher = { ...teacher, assignedSubjects: subjects, assignedClasses: classes };
  return _teacherTeacher;
}
// ================================================================
// Page loader
// ================================================================
export async function loadTeacherAssessmentsPage() {
  _teacherTeacher = null; // re-resolve each load to avoid cross-session cache
  const teacher = await resolveTeacher();
  if (!teacher) { showMessage('teacherAssessMessage', 'Could not find your teacher profile.', 'error'); return; }
  clearMessage('teacherAssessMessage');
  populateTeacherSubjectClass(teacher);
  await loadTeacherQuestions();
}

function populateTeacherSubjectClass(teacher) {
  const assignedSubjects = teacher.assignedSubjects || [];
  const assignedClasses = teacher.assignedClasses || [];
  const fill = (id, prefix, values) => {
    const el = getEl(id);
    if (!el) return;
    el.innerHTML = `<option value="">${prefix}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  };
  fill('teacherQuestionSubject', '— Select Subject —', assignedSubjects);
  fill('teacherQuestionClass', '— Select Class —', assignedClasses);
  fill('teacherQuestionSubjectFilter', '— All Subjects —', assignedSubjects);
  fill('teacherQuestionClassFilter', '— All Classes —', assignedClasses);
  fill('teacherAssessmentSubject', '— Select Subject —', assignedSubjects);
  fill('teacherAssessmentClass', '— Select Class —', assignedClasses);
}

function setTeacherQuestionDefaults() {
  const subFilter = getEl('teacherQuestionSubjectFilter');
  const clsFilter = getEl('teacherQuestionClassFilter');
  if (subFilter && subFilter.options.length === 2) {
    const v = subFilter.options[1].value;
    getEl('teacherQuestionSubject').value = v;
    getEl('teacherQuestionSubjectFilter').value = v;
  }
  if (clsFilter && clsFilter.options.length === 2) {
    const v = clsFilter.options[1].value;
    getEl('teacherQuestionClass').value = v;
    getEl('teacherQuestionClassFilter').value = v;
  }
}
// ================================================================
// Question Bank (teacher)
// ================================================================
async function loadTeacherQuestions() {
  const teacher = _teacherTeacher || (await resolveTeacher());
  if (!teacher) return;
  const schoolId = teacher.school_id;
  let q = supabaseClient.from('assessment_questions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data } = await q;
  _teacherRows = data || [];
  renderTeacherQuestionList();
}

function getTeacherQAView() {
  const search = (getEl('teacherQuestionSearch')?.value || '').toLowerCase();
  const subj = getEl('teacherQuestionSubjectFilter')?.value || '';
  const cls = getEl('teacherQuestionClassFilter')?.value || '';
  return _teacherRows.filter((row) => {
    if (subj && row.subject !== subj) return false;
    if (cls && row.class_name !== cls) return false;
    if (search) {
      const hay = [row.question_text, row.topic, row.subject, row.class_name].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function renderTeacherQuestionList() {
  const listEl = getEl('teacherQuestionList');
  const noEl = getEl('teacherNoQuestions');
  if (!listEl) return;
  const view = getTeacherQAView();
  if (view.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  listEl.innerHTML = `<div class="assessment-toolbar" style="justify-content:space-between;"><span style="font-size:0.85rem;color:var(--text-muted);">${view.length} question${view.length === 1 ? '' : 's'} in your bank</span></div>` +
    view.slice(0, 200).map((q, i) =>
      `<div class="qa-card"><div class="qa-card-header"><div><strong>Q${i + 1}.</strong> <span class="qa-meta" style="display:inline;margin-top:0;">${esc(q.subject)}${q.class_name ? ' • ' + esc(q.class_name) : ''}${q.topic ? ' • ' + esc(q.topic) : ''}</span></div><div style="display:flex;gap:0.35rem;"><button class="action-btn confirm" onclick="editTeacherQuestion('${q.id}')">Edit</button><button class="action-btn danger" onclick="deleteTeacherQuestion('${q.id}')">Delete</button></div></div><div class="qa-card-body"><div class="question-text" style="font-size:0.9rem;">${esc(q.question_text)}</div><div class="qa-meta"><span class="correct-tag">✓ ${esc(q.correct_option)}</span>${q.explanation ? ' 💡 ' + esc(q.explanation) : ''}</div></div></div>`
    ).join('');
}

window.editTeacherQuestion = async function (id) {
  const { data: q, error } = await supabaseClient.from('assessment_questions').select('*').eq('id', id).single();
  if (error || !q) { alert('Question not found.'); return; }
  getEl('teacherQuestionEditId').value = q.id;
  getEl('teacherQuestionSubject').value = q.subject || '';
  getEl('teacherQuestionClass').value = q.class_name || '';
  getEl('teacherQuestionTopic').value = q.topic || '';
  getEl('teacherQuestionText').value = q.question_text;
  getEl('teacherQuestionA').value = q.option_a;
  getEl('teacherQuestionB').value = q.option_b;
  getEl('teacherQuestionC').value = q.option_c;
  getEl('teacherQuestionD').value = q.option_d;
  getEl('teacherQuestionCorrect').value = q.correct_option;
  getEl('teacherQuestionExplanation').value = q.explanation || '';
  getEl('teacherQuestionFormSection').open = true;
  getEl('teacherQuestionFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteTeacherQuestion = async function (id) {
  if (!confirm('Delete this question?')) return;
  const { error } = await supabaseClient.from('assessment_questions').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadTeacherQuestions();
};
async function saveTeacherQuestion(e) {
  e.preventDefault();
  clearMessage('teacherQuestionFormMessage');
  const btn = getEl('teacherQuestionSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const editId = getEl('teacherQuestionEditId').value;
  const teacher = _teacherTeacher;
  const payload = {
    subject: getEl('teacherQuestionSubject').value,
    class_name: getEl('teacherQuestionClass').value || null,
    topic: getEl('teacherQuestionTopic').value.trim() || null,
    question_text: getEl('teacherQuestionText').value.trim(),
    option_a: getEl('teacherQuestionA').value.trim(),
    option_b: getEl('teacherQuestionB').value.trim(),
    option_c: getEl('teacherQuestionC').value.trim(),
    option_d: getEl('teacherQuestionD').value.trim(),
    correct_option: getEl('teacherQuestionCorrect').value,
    explanation: getEl('teacherQuestionExplanation').value.trim() || null,
    school_id: teacher.school_id,
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from('assessment_questions').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('teacherQuestionFormMessage', '✅ Question updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('assessment_questions').insert([payload]);
      if (error) throw error;
      showMessage('teacherQuestionFormMessage', '✅ Question added.', 'success');
    }
    getEl('teacherQuestionForm').reset();
    getEl('teacherQuestionEditId').value = '';
    await loadTeacherQuestions();
  } catch (err) { showMessage('teacherQuestionFormMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '💾 Save Question'); }
}

// ================================================================
// Bulk import (teacher)
// ================================================================
async function handleTeacherBulkFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    getEl('teacherBulkImportText').value = text;
    previewTeacherBulk();
  } catch (err) { alert('Could not read file: ' + err.message); }
}

function previewTeacherBulk() {
  const text = getEl('teacherBulkImportText')?.value || '';
  const previewEl = getEl('teacherBulkImportPreview');
  clearMessage('teacherAssessMessage');
  try {
    const rows = parseBulkQuestions(text);
    const valid = rows.filter((r) => r.question_text && ['A', 'B', 'C', 'D'].includes(r.correct_option));
    if (valid.length === 0) { previewEl.innerHTML = ''; showMessage('teacherAssessMessage', 'No valid question rows found.', 'error'); window._teacherBulkRows = null; return; }
    const invalid = rows.length - valid.length;
    previewEl.innerHTML = `<div class="assessment-instructions">✅ ${valid.length} question${valid.length === 1 ? '' : 's'} ready${invalid ? ` (${invalid} skipped)` : ''}.</div>` +
      valid.slice(0, 5).map((r) => `<div class="qa-card" style="margin-bottom:0.4rem;padding:0.6rem 0.8rem;"><strong>${esc(r.subject)}</strong>${r.class_name ? ' • ' + esc(r.class_name) : ''} — ${esc(r.question_text).slice(0, 80)} <span class="correct-tag">${esc(r.correct_option)}</span></div>`).join('');
    window._teacherBulkRows = valid;
  } catch (err) {
    previewEl.innerHTML = '';
    showMessage('teacherAssessMessage', 'Error parsing rows: ' + err.message, 'error');
    window._teacherBulkRows = null;
  }
}

async function runTeacherBulk() {
  if (!window._teacherBulkRows || window._teacherBulkRows.length === 0) previewTeacherBulk();
  const rows = window._teacherBulkRows;
  if (!rows || rows.length === 0) return;
  if (!confirm(`Import ${rows.length} question${rows.length === 1 ? '' : 's'}?`)) return;
  const btn = getEl('btnTeacherRunBulk');
  setLoading(btn, true, 'Importing...');
  clearMessage('teacherAssessMessage');
  const teacher = _teacherTeacher;
  const payload = rows.map((r) => ({ ...r, school_id: teacher.school_id }));
  try {
    const inserted = await insertRowsChunked(supabaseClient, 'assessment_questions', payload);
    showMessage('teacherAssessMessage', `✅ Imported ${inserted} question${inserted === 1 ? '' : 's'}.`, 'success');
    getEl('teacherBulkImportText').value = '';
    getEl('teacherBulkImportFile').value = '';
    getEl('teacherBulkImportPreview').innerHTML = '';
    window._teacherBulkRows = null;
    getEl('teacherBulkImportSection').open = false;
    await loadTeacherQuestions();
  } catch (err) { showMessage('teacherAssessMessage', 'Import error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '🚀 Import'); }
}
// ================================================================
// Assessments (teacher)
// ================================================================
async function loadTeacherAssessments() {
  const teacher = _teacherTeacher;
  const listEl = getEl('teacherAssessmentList');
  const noEl = getEl('teacherNoAssessments');
  if (!listEl) return;
  let q = supabaseClient.from('assessments').select('*').order('created_at', { ascending: false });
  if (teacher?.school_id) q = q.eq('school_id', teacher.school_id);
  const { data } = await q;
  const items = (data || []).filter((a) => {
    if (teacher?.assignedSubjects?.length && !teacher.assignedSubjects.includes(a.subject)) return false;
    if (teacher?.assignedClasses?.length && a.class_name && !teacher.assignedClasses.includes(a.class_name)) return false;
    return true;
  });
  if (items.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  const badge = (a) => !a.is_active ? '<span class="pub-badge disabled">Disabled</span>' : (a.is_published ? '<span class="pub-badge published">Published</span>' : '<span class="pub-badge draft">Draft</span>');
  listEl.innerHTML = items.map((a) => `<div class="qa-card assessment-item">
    <div class="qa-card-header">
      <div><strong>${esc(a.title)}</strong> ${badge(a)}
        <div class="qa-meta">${esc(a.subject)}${a.class_name ? ' • ' + esc(a.class_name) : ''} · 🎯 ${a.question_count} q · ⏱ ${a.duration_minutes || '—'} min · Pass ${a.pass_percentage}%</div>
      </div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
        <button class="action-btn confirm" onclick="editTeacherAssessment('${a.id}')">Edit</button>
        <button class="action-btn confirm" onclick="toggleTeacherPublish('${a.id}', ${!a.is_published})">${a.is_published ? 'Unpublish' : 'Publish'}</button>
        <button class="action-btn danger" onclick="deleteTeacherAssessment('${a.id}')">Delete</button>
      </div>
    </div>
  </div>`).join('');
}

window.editTeacherAssessment = async function (id) {
  const { data: a, error } = await supabaseClient.from('assessments').select('*').eq('id', id).single();
  if (error || !a) { alert('Assessment not found.'); return; }
  getEl('teacherAssessmentConfigId').value = a.id;
  getEl('teacherAssessmentTitle').value = a.title || '';
  getEl('teacherAssessmentSubject').value = a.subject || '';
  getEl('teacherAssessmentClass').value = a.class_name || '';
  getEl('teacherAssessmentTopic').value = a.topic || '';
  getEl('teacherAssessmentQuestionCount').value = a.question_count;
  getEl('teacherAssessmentDuration').value = a.duration_minutes || 0;
  getEl('teacherShuffleQuestions').checked = !!a.shuffle_questions;
  getEl('teacherShuffleOptions').checked = !!a.shuffle_options;
  getEl('teacherPassPercentage').value = a.pass_percentage;
  getEl('teacherAssessmentActive').checked = !!a.is_active;
  getEl('teacherAssessmentPublished').checked = !!a.is_published;
  getEl('teacherAssessmentDescription').value = a.description || '';
  getEl('teacherAssessmentConfigSection').open = true;
  getEl('teacherAssessmentConfigSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.toggleTeacherPublish = async function (id, publish) {
  const { error } = await supabaseClient.from('assessments').update({ is_published: publish }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadTeacherAssessments();
};

window.deleteTeacherAssessment = async function (id) {
  if (!confirm('Delete this assessment and its attempts?')) return;
  const { error } = await supabaseClient.from('assessments').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadTeacherAssessments();
};

async function saveTeacherAssessment(e) {
  e.preventDefault();
  clearMessage('teacherAssessmentConfigMessage');
  const btn = getEl('teacherAssessmentConfigSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const editId = getEl('teacherAssessmentConfigId').value;
  const teacher = _teacherTeacher;
  const payload = {
    title: getEl('teacherAssessmentTitle').value.trim(),
    subject: getEl('teacherAssessmentSubject').value,
    class_name: getEl('teacherAssessmentClass').value || null,
    topic: getEl('teacherAssessmentTopic').value.trim() || null,
    question_count: parseInt(getEl('teacherAssessmentQuestionCount').value, 10) || 10,
    duration_minutes: parseInt(getEl('teacherAssessmentDuration').value, 10) || 0,
    shuffle_questions: getEl('teacherShuffleQuestions').checked,
    shuffle_options: getEl('teacherShuffleOptions').checked,
    pass_percentage: parseFloat(getEl('teacherPassPercentage').value) || 50,
    is_active: getEl('teacherAssessmentActive').checked,
    is_published: getEl('teacherAssessmentPublished').checked,
    description: getEl('teacherAssessmentDescription').value.trim() || null,
    school_id: teacher.school_id,
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from('assessments').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('teacherAssessmentConfigMessage', '✅ Assessment updated.', 'success');
      try { await logStaffActivity(`Updated assessment "${payload.title}"`, { role: 'teacher', entityType: 'assessment', entityDetails: `${payload.subject} · ${payload.class_name || 'All classes'}` }); } catch (e) { /* noop */ }
    } else {
      const { error } = await supabaseClient.from('assessments').insert([payload]);
      if (error) throw error;
      showMessage('teacherAssessmentConfigMessage', '✅ Assessment saved.', 'success');
      try { await logStaffActivity(`Conducted assessment "${payload.title}"`, { role: 'teacher', entityType: 'assessment', entityDetails: `${payload.subject} · ${payload.class_name || 'All classes'} · ${payload.question_count} questions` }); } catch (e) { /* noop */ }
    }
    getEl('teacherAssessmentConfigForm').reset();
    getEl('teacherAssessmentConfigId').value = '';
    await loadTeacherAssessments();
  } catch (err) { showMessage('teacherAssessmentConfigMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '💾 Save Assessment'); }
}
// ================================================================
// Attempts (teacher)
// ================================================================
async function loadTeacherAttempts() {
  const teacher = _teacherTeacher;
  const tbody = getEl('teacherAttemptsBody');
  const noEl = getEl('teacherNoAttempts');
  if (!tbody) return;

  let aq = supabaseClient.from('assessments').select('id, title, class_name, subject');
  if (teacher?.school_id) aq = aq.eq('school_id', teacher.school_id);
  const { data: scopedAssessments } = await aq;
  const scoped = (scopedAssessments || []).filter((a) =>
    (!teacher?.assignedSubjects?.length || teacher.assignedSubjects.includes(a.subject || '')) &&
    (!teacher?.assignedClasses?.length || !a.class_name || teacher.assignedClasses.includes(a.class_name))
  );
  if (!scoped.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No assessments for your subjects yet.</td></tr>'; return; }
  const ids = scoped.map((a) => a.id);
  const { data: attempts } = await supabaseClient.from('assessment_attempts')
    .select('*').in('assessment_id', ids).order('started_at', { ascending: false });
  if (!attempts || !attempts.length) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  const assMap = Object.fromEntries(scoped.map((a) => [a.id, a]));
  const stuIds = [...new Set(attempts.map((a) => a.student_id))];
  let stuMap = {};
  if (stuIds.length) {
    const { data: apps } = await supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').in('student_id', stuIds);
    stuMap = Object.fromEntries((apps || []).map((s) => [s.student_id, s]));
  }
  const name = (s) => { const a = stuMap[s]; return a ? [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ') : s; };
  _teacherAttemptCache = attempts;
  _teacherAttemptMeta = { assMap, stuMap };
  const statusChip = (a) => !a.is_submitted ? '<span class="score-chip untaken">In progress</span>' : (a.status === 'passed' ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>');
  tbody.innerHTML = attempts.map((a) => `<tr>
    <td>${esc(a.student_id)}</td>
    <td><strong>${esc(name(a.student_id))}</strong></td>
    <td>${esc(assMap[a.assessment_id]?.title || a.assessment_id)}</td>
    <td>${esc(a.student_id && (stuMap[a.student_id]?.class_applying || assMap[a.assessment_id]?.class_name) || '—')}</td>
    <td>${a.score}<span style="color:var(--text-muted);">/${a.total_marks}</span></td>
    <td>${a.score_percentage != null ? a.score_percentage + '%' : '—'}</td>
    <td>${statusChip(a)}</td>
    <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
  </tr>`).join('');
}
// ================================================================
// Print teacher attempts & results table
// ================================================================
function printTeacherAttempts() {
  if (!_teacherAttemptCache || _teacherAttemptCache.length === 0) { alert('No results to print. Load the Results tab first.'); return; }
  const { assMap = {}, stuMap = {} } = _teacherAttemptMeta || {};

  const name = (s) => {
    const a = stuMap[s];
    return a ? [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ') : s;
  };
  const classOf = (att) => (stuMap[att.student_id]?.class_applying || assMap[att.assessment_id]?.class_name || '—');
  const statusText = (a) => {
    if (!a.is_submitted) return 'In progress';
    return a.status === 'passed' ? 'Passed' : 'Failed';
  };

  const rows = _teacherAttemptCache.map((a) => `<tr>
    <td>${esc(a.student_id)}</td>
    <td>${esc(name(a.student_id))}</td>
    <td>${esc(assMap[a.assessment_id]?.title || a.assessment_id)}</td>
    <td>${esc(classOf(a))}</td>
    <td>${a.score} / ${a.total_marks}</td>
    <td>${a.score_percentage != null ? a.score_percentage + '%' : '—'}</td>
    <td>${statusText(a)}</td>
    <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
  </tr>`).join('');

  const body = `<div class="ph"><h2>Assessment Results</h2><p>${_teacherAttemptCache.length} attempt${_teacherAttemptCache.length === 1 ? '' : 's'} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p></div>
    <table><thead><tr><th>Student ID</th><th>Name</th><th>Assessment</th><th>Class</th><th>Score</th><th>%</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${rows}</tbody></table>`;

  const title = 'Assessment Results - My Students';
  const win = openPrintWindow(buildPrintShell(title, body), title, 1100, 700);
  if (win && typeof win.focus === 'function') { try { win.focus(); } catch (e) { /* noop */ } }
}