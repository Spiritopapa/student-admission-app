/**
 * Admin Assessments Module - Question bank, assessments, attempts
 */

import { getEl, showMessage, clearMessage, setLoading, getCurrentSchoolId, openPrintWindow } from './utils.js';
import { esc, parseBulkQuestions, insertRowsChunked, downloadTemplate, buildPrintShell } from './assessment-shared.js';

let supabaseClient = null;
let _adminQARows = [];
let _adminQAPage = 0;
const ADMIN_PAGE_SIZE = 50;
let _adminAttemptCache = []; // filtered rows for printing
let _adminAttemptMeta = null; // { assMap, stuMap }

export function initAdminAssessments(supabase) {
  supabaseClient = supabase;
}

export function setupAdminAssessments() {
  // Tabs
  document.querySelectorAll('#adminAssessTabs button[data-atab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#adminAssessTabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-atab');
      document.querySelectorAll('.assess-tab-content[id^="adminAssessTab-"]').forEach((el) => el.style.display = 'none');
      const target = getEl('adminAssessTab-' + tab);
      if (target) target.style.display = 'block';
      if (tab === 'assessments') loadAdminAssessments();
      if (tab === 'attempts') loadAdminAttempts();
    });
  });

  // Question form
  getEl('btnAddAssessmentQuestion')?.addEventListener('click', () => {
    getEl('assessmentQuestionEditId').value = '';
    getEl('assessmentQuestionForm').reset();
    getEl('assessmentQuestionFormSection').open = true;
    getEl('assessmentQuestionFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  getEl('assessmentQuestionForm')?.addEventListener('submit', saveAdminQuestion);
  getEl('adminQuestionSearch')?.addEventListener('input', () => { _adminQAPage = 0; renderAdminQuestionList(); });
  getEl('adminQuestionSubjectFilter')?.addEventListener('change', () => { _adminQAPage = 0; renderAdminQuestionList(); });
  getEl('adminQuestionClassFilter')?.addEventListener('change', () => { _adminQAPage = 0; renderAdminQuestionList(); });

  // Bulk import
  getEl('btnBulkImportQuestions')?.addEventListener('click', () => {
    getEl('adminBulkImportSection').open = true;
    getEl('adminBulkImportSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  getEl('btnDownloadQuestionTemplate')?.addEventListener('click', () => downloadTemplate('assessment-questions'));
  getEl('adminBulkImportFile')?.addEventListener('change', handleAdminBulkFile);
  getEl('btnPreviewBulkImport')?.addEventListener('click', previewAdminBulkImport);
  getEl('btnRunBulkImport')?.addEventListener('click', runAdminBulkImport);

  // Assessments
  getEl('btnAddAssessment')?.addEventListener('click', () => {
    getEl('assessmentConfigId').value = '';
    getEl('assessmentConfigForm').reset();
    getEl('assessmentShuffleQuestions').checked = true;
    getEl('assessmentShuffleOptions').checked = true;
    getEl('assessmentActive').checked = true;
    getEl('assessmentPassPercentage').value = 50;
    getEl('assessmentQuestionCount').value = 10;
    getEl('assessmentDuration').value = 30;
    getEl('assessmentConfigSection').open = true;
    getEl('assessmentConfigSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  getEl('assessmentConfigForm')?.addEventListener('submit', saveAdminAssessment);

  // Attempts
  getEl('adminAttemptAssessmentFilter')?.addEventListener('change', loadAdminAttempts);
  getEl('adminAttemptClassFilter')?.addEventListener('change', loadAdminAttempts);
  getEl('btnRefreshAdminAttempts')?.addEventListener('click', loadAdminAttempts);
  getEl('btnPrintAdminAttempts')?.addEventListener('click', printAdminAttempts);
}

// ================================================================
// Subject / Class dropdowns
// ================================================================
async function populateAdminSubjectClass() {
  const schoolId = await getCurrentSchoolId();
  let q = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data: subjects } = await q;

  let cq = supabaseClient.from('classes').select('name').order('name', { ascending: true });
  if (schoolId) cq = cq.eq('school_id', schoolId);
  const { data: classes } = await cq;

  const subjectNames = (subjects || []).map((s) => s.name);
  const classNames = (classes || []).map((c) => c.name);

  const fill = (id, prefix, values) => {
    const el = getEl(id);
    if (!el) return;
    el.innerHTML = `<option value="">${prefix}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  };
  fill('assessmentQuestionSubject', '— Select Subject —', subjectNames);
  fill('assessmentQuestionClass', '— Select Class —', classNames);
  fill('assessmentSubject', '— Select Subject —', subjectNames);
  fill('assessmentClass', '— Select Class —', classNames);
  fill('adminQuestionSubjectFilter', '— All Subjects —', subjectNames);
  fill('adminQuestionClassFilter', '— All Classes —', classNames);
  fill('adminAttemptClassFilter', '— All Classes —', classNames);
}
// ================================================================
// Question Bank
// ================================================================
export async function loadAdminAssessmentsPage() {
  await populateAdminSubjectClass();
  _adminQAPage = 0;
  await loadAdminQuestions();
}

async function loadAdminQuestions() {
  const schoolId = await getCurrentSchoolId();
  let q = supabaseClient.from('assessment_questions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data } = await q;
  _adminQARows = data || [];
  _adminQAPage = 0;
  renderAdminQuestionList();
}

function getAdminQAView() {
  const search = (getEl('adminQuestionSearch')?.value || '').toLowerCase();
  const subj = getEl('adminQuestionSubjectFilter')?.value || '';
  const cls = getEl('adminQuestionClassFilter')?.value || '';
  return _adminQARows.filter((row) => {
    if (subj && row.subject !== subj) return false;
    if (cls && row.class_name !== cls) return false;
    if (search) {
      const hay = [row.question_text, row.topic, row.subject, row.class_name].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function renderAdminQuestionList() {
  const listEl = getEl('adminQuestionList');
  const noEl = getEl('adminNoQuestions');
  if (!listEl) return;
  const view = getAdminQAView();
  if (view.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  const start = _adminQAPage * ADMIN_PAGE_SIZE;
  const slice = view.slice(start, start + ADMIN_PAGE_SIZE);
  const totalHtml = `<div class="assessment-toolbar" style="justify-content:space-between;"><span style="font-size:0.85rem;color:var(--text-muted);">Showing <strong>${Math.min(start + 1, view.length)}–${Math.min(start + ADMIN_PAGE_SIZE, view.length)}</strong> of <strong>${view.length}</strong> question${view.length === 1 ? '' : 's'}</span></div>`;
  listEl.innerHTML = totalHtml + slice.map((q, i) => {
    const idx = start + i + 1;
    const opts = btnList(q);
    return `<div class="qa-card"><div class="qa-card-header"><div><strong>Q${idx}.</strong> <span class="qa-meta" style="display:inline;margin-top:0;">${esc(q.subject)}${q.class_name ? ' • ' + esc(q.class_name) : ''}${q.topic ? ' • ' + esc(q.topic) : ''}</span></div><div style="display:flex;gap:0.35rem;flex-wrap:wrap;"><button class="action-btn confirm" onclick="editAdminQuestion('${q.id}')">Edit</button><button class="action-btn danger" onclick="deleteAdminQuestion('${q.id}')">Delete</button></div></div><div class="qa-card-body"><div class="question-text" style="font-size:0.95rem;">${esc(q.question_text)}</div><div class="qa-options">${opts}</div><div class="qa-meta"><span class="correct-tag">✓ ${esc(q.correct_option)}</span>${q.explanation ? '<span>' + esc(q.explanation) + '</span>' : ''}</div></div></div>`;
  }).join('');

  if (start + ADMIN_PAGE_SIZE < view.length) {
    listEl.insertAdjacentHTML('beforeend', `<div style="text-align:center;margin:0.5rem;"><button type="button" class="btn btn-secondary" id="btnAdminMoreQuestions">Load more…</button></div>`);
    getEl('btnAdminMoreQuestions')?.addEventListener('click', () => { _adminQAPage++; renderAdminQuestionList(); });
  }
}

function btnList(q) {
  return ['A', 'B', 'C', 'D'].map((k) =>
    `<div class="qa-option-pill"><span class="option-tag">${k}</span>${esc(q['option_' + k.toLowerCase()])}</div>`
  ).join('');
}

window.editAdminQuestion = async function (id) {
  const { data: q, error } = await supabaseClient.from('assessment_questions').select('*').eq('id', id).single();
  if (error || !q) { alert('Question not found: ' + (error?.message || '')); return; }
  getEl('assessmentQuestionEditId').value = q.id;
  getEl('assessmentQuestionSubject').value = q.subject || '';
  getEl('assessmentQuestionClass').value = q.class_name || '';
  getEl('assessmentQuestionTopic').value = q.topic || '';
  getEl('assessmentQuestionText').value = q.question_text;
  getEl('assessmentQuestionA').value = q.option_a;
  getEl('assessmentQuestionB').value = q.option_b;
  getEl('assessmentQuestionC').value = q.option_c;
  getEl('assessmentQuestionD').value = q.option_d;
  getEl('assessmentQuestionCorrect').value = q.correct_option;
  getEl('assessmentQuestionExplanation').value = q.explanation || '';
  getEl('assessmentQuestionFormSection').open = true;
  getEl('assessmentQuestionFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteAdminQuestion = async function (id) {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('assessment_questions').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  showMessage('adminQuestionMessage', 'Question deleted.', 'success');
  await loadAdminQuestions();
};
async function saveAdminQuestion(e) {
  e.preventDefault();
  clearMessage('assessmentQuestionFormMessage');
  const btn = getEl('assessmentQuestionSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const editId = getEl('assessmentQuestionEditId').value;
  const schoolId = await getCurrentSchoolId();
  const payload = {
    subject: getEl('assessmentQuestionSubject').value,
    class_name: getEl('assessmentQuestionClass').value || null,
    topic: getEl('assessmentQuestionTopic').value.trim() || null,
    question_text: getEl('assessmentQuestionText').value.trim(),
    option_a: getEl('assessmentQuestionA').value.trim(),
    option_b: getEl('assessmentQuestionB').value.trim(),
    option_c: getEl('assessmentQuestionC').value.trim(),
    option_d: getEl('assessmentQuestionD').value.trim(),
    correct_option: getEl('assessmentQuestionCorrect').value,
    explanation: getEl('assessmentQuestionExplanation').value.trim() || null,
    school_id: schoolId,
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from('assessment_questions').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('assessmentQuestionFormMessage', 'Question updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('assessment_questions').insert([payload]);
      if (error) throw error;
      showMessage('assessmentQuestionFormMessage', 'Question added to the bank.', 'success');
    }
    getEl('assessmentQuestionForm').reset();
    getEl('assessmentQuestionEditId').value = '';
    await loadAdminQuestions();
  } catch (err) { showMessage('assessmentQuestionFormMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Save Question'); }
}

// ================================================================
// Bulk Import
// ================================================================
function readAdminBulkSource() {
  let text = getEl('adminBulkImportText')?.value || '';
  const file = getEl('adminBulkImportFile')?.files?.[0];
  return { text, file };
}

async function handleAdminBulkFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    getEl('adminBulkImportText').value = text;
    previewAdminBulkImport(text);
  } catch (err) { alert('Could not read file: ' + err.message); }
}

function previewAdminBulkImport(overrideText) {
  const { text } = readAdminBulkSource();
  const src = overrideText || text;
  clearMessage('adminBulkImportMessage');
  const previewEl = getEl('adminBulkImportPreview');
  try {
    const rows = parseBulkQuestions(src);
    if (rows.length === 0) { showMessage('adminBulkImportMessage', 'No valid question rows found.', 'error'); return; }
    const valid = rows.filter((r) => r.question_text && ['A', 'B', 'C', 'D'].includes(r.correct_option));
    const invalid = rows.length - valid.length;
    previewEl.innerHTML = `<div class="assessment-instructions">Ready to import <strong>${valid.length}</strong> question${valid.length === 1 ? '' : 's'}${invalid ? ` (${invalid} skipped)` : ''}. First 5 preview:</div>` +
      valid.slice(0, 5).map((r) => `<div class="qa-card" style="margin-bottom:0.4rem;padding:0.6rem 0.8rem;"><strong>${esc(r.subject)}</strong>${r.class_name ? ' • ' + esc(r.class_name) : ''}${r.topic ? ' • ' + esc(r.topic) : ''} — ${esc(r.question_text).slice(0, 80)} <span class="correct-tag">${esc(r.correct_option)}</span></div>`).join('');
    window._adminBulkRows = valid;
  } catch (err) {
    previewEl.innerHTML = '';
    showMessage('adminBulkImportMessage', 'Error parsing rows: ' + err.message, 'error');
    window._adminBulkRows = null;
  }
}

async function runAdminBulkImport() {
  if (!window._adminBulkRows || window._adminBulkRows.length === 0) {
    previewAdminBulkImport();
  }
  const rows = window._adminBulkRows;
  if (!rows || rows.length === 0) return;
  if (!confirm(`Import ${rows.length} question${rows.length === 1 ? '' : 's'} into the bank?`)) return;
  const btn = getEl('btnRunBulkImport');
  setLoading(btn, true, 'Importing...');
  clearMessage('adminBulkImportMessage');
  const schoolId = await getCurrentSchoolId();
  const payload = rows.map((r) => ({ ...r, school_id: schoolId }));
  try {
    const inserted = await insertRowsChunked(supabaseClient, 'assessment_questions', payload);
    showMessage('adminBulkImportMessage', `Imported ${inserted} question${inserted === 1 ? '' : 's'} successfully.`, 'success');
    getEl('adminBulkImportText').value = '';
    getEl('adminBulkImportFile').value = '';
    getEl('adminBulkImportPreview').innerHTML = '';
    window._adminBulkRows = null;
    getEl('adminBulkImportSection').open = false;
    await loadAdminQuestions();
  } catch (err) { showMessage('adminBulkImportMessage', 'Import error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Import Questions'); }
}
// ================================================================
// Assessments (papers)
// ================================================================
async function loadAdminAssessments() {
  const schoolId = await getCurrentSchoolId();
  let q = supabaseClient.from('assessments').select('*').order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data } = await q;
  const items = data || [];
  const listEl = getEl('adminAssessmentList');
  const noEl = getEl('adminNoAssessments');
  if (!listEl) return;
  if (items.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  const badge = (a) => {
    if (!a.is_active) return '<span class="pub-badge disabled">Disabled</span>';
    if (a.is_published) return '<span class="pub-badge published">Published</span>';
    return '<span class="pub-badge draft">Draft</span>';
  };
  listEl.innerHTML = items.map((a) => `<div class="qa-card assessment-item">
    <div class="qa-card-header">
      <div>
        <strong style="font-size:1rem;">${esc(a.title)}</strong> ${badge(a)}
        <div class="qa-meta">${esc(a.subject)}${a.class_name ? ' • ' + esc(a.class_name) : ''}${a.topic ? ' • Topic: ' + esc(a.topic) : ''}</div>
        <div class="qa-meta">${a.question_count} questions · ${a.duration_minutes || '—'} min · Pass ${a.pass_percentage}%</div>
        ${a.description ? `<div class="qa-meta">${esc(a.description)}</div>` : ''}
      </div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
        <button class="action-btn confirm" onclick="editAdminAssessment('${a.id}')">Edit</button>
        <button class="action-btn confirm" onclick="togglePublishAdminAssessment('${a.id}', ${!a.is_published})">${a.is_published ? 'Unpublish' : 'Publish'}</button>
        <button class="action-btn danger" onclick="deleteAdminAssessment('${a.id}')">Delete</button>
      </div>
    </div>
  </div>`).join('');
}

window.editAdminAssessment = async function (id) {
  const { data: a, error } = await supabaseClient.from('assessments').select('*').eq('id', id).single();
  if (error || !a) { alert('Assessment not found.'); return; }
  getEl('assessmentConfigId').value = a.id;
  getEl('assessmentTitle').value = a.title || '';
  getEl('assessmentSubject').value = a.subject || '';
  getEl('assessmentClass').value = a.class_name || '';
  getEl('assessmentTopic').value = a.topic || '';
  getEl('assessmentQuestionCount').value = a.question_count;
  getEl('assessmentDuration').value = a.duration_minutes || 0;
  getEl('assessmentShuffleQuestions').checked = !!a.shuffle_questions;
  getEl('assessmentShuffleOptions').checked = !!a.shuffle_options;
  getEl('assessmentPassPercentage').value = a.pass_percentage;
  getEl('assessmentActive').checked = !!a.is_active;
  getEl('assessmentDescription').value = a.description || '';
  getEl('assessmentConfigSection').open = true;
  getEl('assessmentConfigSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.togglePublishAdminAssessment = async function (id, publish) {
  const { error } = await supabaseClient.from('assessments').update({ is_published: publish }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  showMessage('adminQuestionMessage', publish ? 'Assessment published to students.' : 'Assessment unpublished.', 'success');
  await loadAdminAssessments();
};

window.deleteAdminAssessment = async function (id) {
  if (!confirm('Delete this assessment and all its attempts?')) return;
  const { error } = await supabaseClient.from('assessments').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadAdminAssessments();
};

async function saveAdminAssessment(e) {
  e.preventDefault();
  clearMessage('assessmentConfigMessage');
  const btn = getEl('assessmentConfigSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const editId = getEl('assessmentConfigId').value;
  const schoolId = await getCurrentSchoolId();
  const payload = {
    title: getEl('assessmentTitle').value.trim(),
    subject: getEl('assessmentSubject').value,
    class_name: getEl('assessmentClass').value || null,
    topic: getEl('assessmentTopic').value.trim() || null,
    question_count: parseInt(getEl('assessmentQuestionCount').value, 10) || 10,
    duration_minutes: parseInt(getEl('assessmentDuration').value, 10) || 0,
    shuffle_questions: getEl('assessmentShuffleQuestions').checked,
    shuffle_options: getEl('assessmentShuffleOptions').checked,
    pass_percentage: parseFloat(getEl('assessmentPassPercentage').value) || 50,
    is_active: getEl('assessmentActive').checked,
    description: getEl('assessmentDescription').value.trim() || null,
    school_id: schoolId,
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from('assessments').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('assessmentConfigMessage', 'Assessment updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('assessments').insert([payload]);
      if (error) throw error;
      showMessage('assessmentConfigMessage', 'Assessment created. Edit it to publish when ready.', 'success');
    }
    getEl('assessmentConfigForm').reset();
    getEl('assessmentConfigId').value = '';
    await loadAdminAssessments();
  } catch (err) { showMessage('assessmentConfigMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Save Assessment'); }
}
// ================================================================
// Attempts / Results
// ================================================================
async function loadAdminAttempts() {
  const schoolId = await getCurrentSchoolId();
  const tbody = getEl('adminAttemptsBody');
  const noEl = getEl('adminNoAttempts');
  if (!tbody) return;

  // Populate assessment filter once
  const asFilter = getEl('adminAttemptAssessmentFilter');
  if (asFilter && asFilter.options.length <= 1) {
    let q = supabaseClient.from('assessments').select('id, title').order('title', { ascending: true });
    if (schoolId) q = q.eq('school_id', schoolId);
    const { data: ars } = await q;
    asFilter.innerHTML = '<option value="">— All Assessments —</option>' + (ars || []).map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
  }

  let aq = supabaseClient.from('assessment_attempts').select('*').order('started_at', { ascending: false });
  if (schoolId) aq = aq.eq('school_id', schoolId);
  const selAssess = asFilter?.value;
  if (selAssess) aq = aq.eq('assessment_id', selAssess);

  const { data: attempts } = await aq;
  if (!attempts || attempts.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';

  // Batch fetch assessment titles and student names
  const assIds = [...new Set(attempts.map((a) => a.assessment_id))];
  const stuIds = [...new Set(attempts.map((a) => a.student_id))];
  let assMap = {};
  let stuMap = {};
  if (assIds.length) {
    const { data: ars } = await supabaseClient.from('assessments').select('id, title, class_name').in('id', assIds);
    assMap = Object.fromEntries((ars || []).map((a) => [a.id, a]));
  }
  if (stuIds.length) {
    const { data: apps } = await supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').in('student_id', stuIds);
    stuMap = Object.fromEntries((apps || []).map((s) => [s.student_id, s]));
  }

  const classFilter = getEl('adminAttemptClassFilter')?.value;
  const rows = attempts.filter((a) => {
    if (classFilter && (assMap[a.assessment_id]?.class_name || stuMap[a.student_id]?.class_applying) !== classFilter) return false;
    return true;
  });
  _adminAttemptCache = rows;
  _adminAttemptMeta = { assMap, stuMap };
  if (rows.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';

  const name = (s) => {
    const a = stuMap[s];
    return a ? [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ') : s;
  };
  const statusChip = (a) => {
    if (!a.is_submitted) return '<span class="score-chip untaken">In progress</span>';
    return a.status === 'passed' ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>';
  };

  tbody.innerHTML = rows.map((a) => `<tr>
    <td>${esc(a.student_id)}</td>
    <td><strong>${esc(name(a.student_id))}</strong></td>
    <td>${esc(assMap[a.assessment_id]?.title || a.assessment_id)}</td>
    <td>${esc(assMap[a.assessment_id]?.class_name || stuMap[a.student_id]?.class_applying || '—')}</td>
    <td>${a.score}<span style="color:var(--text-muted);">/${a.total_marks}</span></td>
    <td>${a.score_percentage != null ? a.score_percentage + '%' : '—'}</td>
    <td>${statusChip(a)}</td>
    <td>${a.started_at ? new Date(a.started_at).toLocaleString() : '—'}</td>
    <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
  </tr>`).join('');
}
// ================================================================
// Print admin attempts & results table
// ================================================================
function printAdminAttempts() {
  if (!_adminAttemptCache || _adminAttemptCache.length === 0) { alert('No results to print. Load the Attempts & Results tab first.'); return; }
  const { assMap = {}, stuMap = {} } = _adminAttemptMeta || {};

  const name = (s) => {
    const a = stuMap[s];
    return a ? [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ') : s;
  };
  const classOf = (att) => assMap[att.assessment_id]?.class_name || stuMap[att.student_id]?.class_applying || '—';
  const statusText = (a) => {
    if (!a.is_submitted) return 'In progress';
    return a.status === 'passed' ? 'Passed' : 'Failed';
  };

  const rows = _adminAttemptCache.map((a) => `<tr>
    <td>${esc(a.student_id)}</td>
    <td>${esc(name(a.student_id))}</td>
    <td>${esc(assMap[a.assessment_id]?.title || a.assessment_id)}</td>
    <td>${esc(classOf(a))}</td>
    <td>${a.score} / ${a.total_marks}</td>
    <td>${a.score_percentage != null ? a.score_percentage + '%' : '—'}</td>
    <td>${statusText(a)}</td>
    <td>${a.started_at ? new Date(a.started_at).toLocaleString() : '—'}</td>
    <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
  </tr>`).join('');

  const body = `<div class="ph"><h2>Assessment Results</h2><p>${_adminAttemptCache.length} attempt${_adminAttemptCache.length === 1 ? '' : 's'} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p></div>
    <table><thead><tr><th>Student ID</th><th>Name</th><th>Assessment</th><th>Class</th><th>Score</th><th>%</th><th>Status</th><th>Started</th><th>Submitted</th></tr></thead><tbody>${rows}</tbody></table>`;

  const title = 'Assessment Results';
  const win = openPrintWindow(buildPrintShell(title, body), title, 1200, 700);
  if (win && typeof win.focus === 'function') { try { win.focus(); } catch (e) { /* noop */ } }
}