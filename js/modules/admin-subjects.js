/**
 * Admin Subjects Module
 */

import { getEl, showMessage, clearMessage, setLoading, logSubAdminActivity, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initAdminSubjects(supabase) {
  supabaseClient = supabase;
}

export function setupSubjectForm() {
  getEl('addSubjectBtn')?.addEventListener('click', () => {
    getEl('subjectEditId').value = '';
    getEl('subjectForm').reset();
    getEl('subjectFormSection').open = true;
  });

  getEl('subjectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('subjectMessage');
    const btn = getEl('subjectSubmitBtn');
    setLoading(btn, true, 'Saving...');
    const editId = getEl('subjectEditId').value;
    const schoolId = await getCurrentSchoolId();
    const payload = { name: getEl('subjectName').value.trim(), school_id: schoolId };
    try {
      if (editId) {
        const { error } = await supabaseClient.from('subjects').update(payload).eq('id', editId);
        if (error) throw error;
        showMessage('subjectMessage', 'Subject updated.', 'success');
        logSubAdminActivity(`Updated subject "${payload.name}"`, 'subject', payload.name);
      } else {
        const { error } = await supabaseClient.from('subjects').insert([payload]);
        if (error) throw error;
        showMessage('subjectMessage', 'Subject added.', 'success');
        logSubAdminActivity(`Created subject "${payload.name}"`, 'subject', payload.name);
      }
      getEl('subjectForm').reset();
      getEl('subjectEditId').value = '';
      await renderSubjectsTable();
      await populateClassSubjectSelectors();
    } catch (err) { showMessage('subjectMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Subject'); }
  });

  getEl('adminSubjectsSearch')?.addEventListener('input', renderSubjectsTable);

  // ============================================================
  // Assign Subjects to Classes (canonical class → subject mapping)
  // ============================================================
  getEl('classSubjectClass')?.addEventListener('change', renderClassSubjectsTable);
  getEl('btnAddClassSubject')?.addEventListener('click', addClassSubject);

  populateClassSubjectSelectors();
}

window.editSubject = function (id, name) {
  getEl('subjectEditId').value = id;
  getEl('subjectName').value = name || '';
  getEl('subjectFormSection').open = true;
};

window.deleteSubject = async function (id) {
  if (!confirm('Delete this subject?')) return;
  const { data: subj } = await supabaseClient.from('subjects').select('name').eq('id', id).single();
  const { error } = await supabaseClient.from('subjects').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderSubjectsTable();
  await populateClassSubjectSelectors();
  logSubAdminActivity(`Deleted subject "${subj?.name || id}"`, 'subject', subj?.name || id);
};

export async function renderSubjectsTable() {
  const search = (getEl('adminSubjectsSearch')?.value || '').toLowerCase();
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('subjects').select('*');
  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) { console.error('Load subjects error:', error); return; }
  let items = data || [];
  if (search) items = items.filter((s) => s.name.toLowerCase().includes(search));
  const tbody = getEl('adminSubjectsBody');
  const noEl = getEl('adminNoSubjects');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  tbody.innerHTML = items.map((s) => `<tr><td><strong>${s.name}</strong></td><td>${s.created_at ? new Date(s.created_at).toLocaleDateString() : '-'}</td><td><button class="action-btn confirm" onclick="editSubject('${s.id}','${s.name.replace(/'/g, "\\'")}')">Edit</button><button class="action-btn danger" onclick="deleteSubject('${s.id}')">Delete</button></td></tr>`).join('');
}
// ============================================================
// Assign Subjects to Classes — UI helpers
// ============================================================

// Canonical class → subject mapping loaded from public.class_subjects
let classSubjectsCache = [];

/**
 * Load the canonical class → subject mapping and populate the selectors
 * used by the "Assign Subjects to Classes" section.
 */
export async function populateClassSubjectSelectors() {
  const classSel = getEl('classSubjectClass');
  const subjSel = getEl('classSubjectAdd');
  if (!classSel && !subjSel) return;
  try {
    const schoolId = await getCurrentSchoolId();

    // Load classes
    let classesQuery = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) classesQuery = classesQuery.eq('school_id', schoolId);
    const classesRes = await classesQuery;

    // Load global subject list
    let subjectsQuery = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
    if (schoolId) subjectsQuery = subjectsQuery.eq('school_id', schoolId);
    const subjectsRes = await subjectsQuery;

    // Load canonical class → subject mapping
    let csQuery = supabaseClient.from('class_subjects').select('*');
    if (schoolId) csQuery = csQuery.eq('school_id', schoolId);
    const csRes = await csQuery;
    classSubjectsCache = csRes.data || [];

    const currentClass = classSel?.value || '';
    if (classSel) {
      classSel.innerHTML = '<option value="">— Select Class —</option>' +
        (classesRes.data || []).map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
      if (currentClass) classSel.value = currentClass;
    }

    // Subject add-dropdown: only subjects not yet assigned to the selected class
    if (subjSel) {
      const assigned = classSubjectsCache
        .filter((cs) => cs.class_name === (classSel?.value || ''))
        .map((cs) => cs.subject_name);
      const selected = subjSel.value;
      subjSel.innerHTML = '<option value="">— Select Subject —</option>' +
        (subjectsRes.data || [])
          .filter((s) => !assigned.includes(s.name))
          .map((s) => `<option value="${s.name}">${s.name}</option>`)
          .join('');
      if (selected && !assigned.includes(selected)) subjSel.value = selected;
    }

    await renderClassSubjectsTable();
  } catch (err) {
    console.error('Failed to load class-subject selectors:', err);
  }
}

/**
 * Render the class → subject assignment table (filtered by the selected class).
 */
export async function renderClassSubjectsTable() {
  const tbody = getEl('classSubjectsBody');
  const noEl = getEl('noClassSubjects');
  if (!tbody) return;

  const classVal = getEl('classSubjectClass')?.value || '';
  const subjSel = getEl('classSubjectAdd');

  let items = classSubjectsCache;
  if (classVal) items = items.filter((cs) => cs.class_name === classVal);
  items = [...items].sort((a, b) =>
    (a.class_name || '').localeCompare(b.class_name || '') ||
    (a.subject_name || '').localeCompare(b.subject_name || '')
  );

  if (items.length === 0) {
    tbody.innerHTML = '';
    if (noEl) {
      noEl.style.display = 'block';
      noEl.textContent = classVal
        ? `No subjects assigned to ${classVal} yet. Select a subject above and click "Add Subject to Class".`
        : 'No subjects assigned yet. Select a class and add a subject above.';
    }
  } else {
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map((cs) => `<tr><td><strong>${cs.class_name}</strong></td><td>${cs.subject_name}</td><td><button class="action-btn danger" onclick="removeClassSubject('${cs.id}')">Remove</button></td></tr>`).join('');
  }

  // Refresh the subject add-dropdown so already-assigned subjects disappear
  if (subjSel && classVal) {
    const currentSelected = subjSel.value;
    const assigned = items.map((cs) => cs.subject_name);
    const schoolId = await getCurrentSchoolId();
    let subjectsQuery = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
    if (schoolId) subjectsQuery = subjectsQuery.eq('school_id', schoolId);
    const subjectsRes = await subjectsQuery;
    subjSel.innerHTML = '<option value="">— Select Subject —</option>' +
      (subjectsRes.data || [])
        .filter((s) => !assigned.includes(s.name))
        .map((s) => `<option value="${s.name}">${s.name}</option>`)
        .join('');
    if (currentSelected && (subjectsRes.data || []).some((s) => s.name === currentSelected)) {
      subjSel.value = currentSelected;
    }
  }
}

async function addClassSubject() {
  clearMessage('classSubjectMessage');
  const classVal = getEl('classSubjectClass')?.value || '';
  const subjectVal = getEl('classSubjectAdd')?.value || '';
  if (!classVal) { showMessage('classSubjectMessage', 'Please select a class first.', 'error'); return; }
  if (!subjectVal) { showMessage('classSubjectMessage', 'Please select a subject to add.', 'error'); return; }

  // Avoid duplicate insert
  if (classSubjectsCache.some((cs) => cs.class_name === classVal && cs.subject_name === subjectVal)) {
    showMessage('classSubjectMessage', `"${subjectVal}" is already assigned to ${classVal}.`, 'error');
    return;
  }

  const schoolId = await getCurrentSchoolId();
  try {
    const { error } = await supabaseClient.from('class_subjects').insert([
      { class_name: classVal, subject_name: subjectVal, school_id: schoolId },
    ]);
    if (error) { showMessage('classSubjectMessage', 'Error: ' + error.message, 'error'); return; }
    showMessage('classSubjectMessage', `"${subjectVal}" added to ${classVal}.`, 'success');
    logSubAdminActivity(`Assigned subject "${subjectVal}" to class ${classVal}`, 'subject', subjectVal);
    await populateClassSubjectSelectors();
  } catch (err) {
    showMessage('classSubjectMessage', 'Error: ' + err.message, 'error');
  }
}

window.removeClassSubject = async function (id) {
  const target = classSubjectsCache.find((cs) => cs.id === id);
  if (!confirm(`Remove "${target?.subject_name || id}" from ${target?.class_name || 'this class'}?`)) return;
  const { error } = await supabaseClient.from('class_subjects').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  if (target) logSubAdminActivity(`Removed subject "${target.subject_name}" from class ${target.class_name}`, 'subject', target.subject_name);
  await populateClassSubjectSelectors();
};