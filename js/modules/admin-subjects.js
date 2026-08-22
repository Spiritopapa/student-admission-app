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
        showMessage('subjectMessage', '✅ Subject updated.', 'success');
        logSubAdminActivity(`Updated subject "${payload.name}"`, 'subject', payload.name);
      } else {
        const { error } = await supabaseClient.from('subjects').insert([payload]);
        if (error) throw error;
        showMessage('subjectMessage', '✅ Subject added.', 'success');
        logSubAdminActivity(`Created subject "${payload.name}"`, 'subject', payload.name);
      }
      getEl('subjectForm').reset();
      getEl('subjectEditId').value = '';
      await renderSubjectsTable();
    } catch (err) { showMessage('subjectMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Subject'); }
  });

  getEl('adminSubjectsSearch')?.addEventListener('input', renderSubjectsTable);
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