/**
 * Admin Classes Module
 */

import { getEl, showMessage, clearMessage, setLoading, logSubAdminActivity, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initAdminClasses(supabase) {
  supabaseClient = supabase;
}

export function setupClassForm() {
  getEl('addClassBtn')?.addEventListener('click', () => {
    getEl('classEditId').value = '';
    getEl('classForm').reset();
    getEl('classFormSection').open = true;
  });

  getEl('classForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('classMessage');
    const btn = getEl('classSubmitBtn');
    setLoading(btn, true, 'Saving...');
    const editId = getEl('classEditId').value;
    const schoolId = await getCurrentSchoolId();
    const payload = { name: getEl('className').value.trim(), level: getEl('classLevel').value, school_id: schoolId };
    try {
      if (editId) {
        const { error } = await supabaseClient.from('classes').update(payload).eq('id', editId);
        if (error) throw error;
        showMessage('classMessage', '✅ Class updated.', 'success');
        logSubAdminActivity(`Updated class "${payload.name}"`, 'class', payload.name);
      } else {
        const { error } = await supabaseClient.from('classes').insert([payload]);
        if (error) throw error;
        showMessage('classMessage', '✅ Class added.', 'success');
        logSubAdminActivity(`Created class "${payload.name}"`, 'class', payload.name);
      }
      getEl('classForm').reset();
      getEl('classEditId').value = '';
      await renderClassesTable();
    } catch (err) { showMessage('classMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Class'); }
  });

  getEl('adminClassesSearch')?.addEventListener('input', renderClassesTable);
}

window.editClass = function (id, name, level) {
  getEl('classEditId').value = id;
  getEl('className').value = name || '';
  getEl('classLevel').value = level || 'primary';
  getEl('classFormSection').open = true;
};

window.deleteClass = async function (id) {
  if (!confirm('Delete this class?')) return;
  const { data: cls } = await supabaseClient.from('classes').select('name').eq('id', id).single();
  const { error } = await supabaseClient.from('classes').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderClassesTable();
  logSubAdminActivity(`Deleted class "${cls?.name || id}"`, 'class', cls?.name || id);
};

export async function renderClassesTable() {
  const search = (getEl('adminClassesSearch')?.value || '').toLowerCase();
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('classes').select('*');
  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) { console.error('Load classes error:', error); return; }
  let items = data || [];
  if (search) items = items.filter((c) => c.name.toLowerCase().includes(search) || c.level.toLowerCase().includes(search));
  const tbody = getEl('adminClassesBody');
  const noEl = getEl('adminNoClasses');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  tbody.innerHTML = items.map((c) => `<tr><td><strong>${c.name}</strong></td><td>${c.level}</td><td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}</td><td><button class="action-btn confirm" onclick="editClass('${c.id}','${c.name.replace(/'/g, "\\'")}','${c.level}')">Edit</button><button class="action-btn danger" onclick="deleteClass('${c.id}')">Delete</button></td></tr>`).join('');
}