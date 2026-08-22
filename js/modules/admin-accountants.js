/**
 * Admin Accountants Module - Accountant management, registration ID generation
 */

import { getEl, showMessage, clearMessage, setLoading, logSubAdminActivity, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initAdminAccountants(supabase) {
  supabaseClient = supabase;
}

export function setupAccountantForm() {
  // Accountant ID generation
  getEl('btnGenerateAccountantId')?.addEventListener('click', generateAccountantId);
  getEl('newAccountantForm')?.addEventListener('submit', saveNewAccountant);

  // Existing accountant CRUD
  getEl('addAccountantBtn')?.addEventListener('click', async () => {
    getEl('accountantEditId').value = '';
    getEl('accountantForm').reset();
    getEl('accountantFormSection').open = true;
  });

  getEl('accountantForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('accountantMessage');
    const btn = getEl('accountantSubmitBtn');
    setLoading(btn, true, 'Saving...');
    const editId = getEl('accountantEditId').value;
    const payload = {
      full_name: getEl('accountantFullName').value.trim(),
      email: getEl('accountantEmail').value.trim() || null,
      phone: getEl('accountantPhone').value.trim() || null,
    };
    try {
      if (editId) {
        const { error } = await supabaseClient.from('accountants').update(payload).eq('id', editId);
        if (error) throw error;
        showMessage('accountantMessage', '✅ Accountant updated successfully.', 'success');
        logSubAdminActivity(`Updated accountant "${payload.full_name}"`, 'accountant', payload.full_name);
      } else {
        const { error } = await supabaseClient.from('accountants').insert([payload]);
        if (error) throw error;
        showMessage('accountantMessage', '✅ Accountant added successfully.', 'success');
        logSubAdminActivity(`Created accountant "${payload.full_name}"`, 'accountant', payload.full_name);
      }
      getEl('accountantForm').reset();
      getEl('accountantEditId').value = '';
      await renderAccountantsTable();
    } catch (err) { showMessage('accountantMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Accountant'); }
  });

  getEl('adminAccountantsSearch')?.addEventListener('input', renderAccountantsTable);
}

// ================================================================
// Accountant ID Generation
// ================================================================

async function generateAccountantId() {
  try {
    const { data: regId, error } = await supabaseClient.rpc('generate_accountant_id');
    if (error) { alert('Error generating ID: ' + error.message); return; }
    getEl('newAccountantRegId').value = regId || 'ACC-0001';
    getEl('newAccountantSection').style.display = 'block';
    getEl('newAccountantSection').open = true;
  } catch (err) { alert('Error: ' + err.message); }
}

async function saveNewAccountant(e) {
  e.preventDefault();
  clearMessage('newAccountantMessage');
  const btn = getEl('saveAccountantBtn');
  setLoading(btn, true, 'Creating...');
  const fullName = getEl('newAccountantName').value.trim();
  const email = getEl('newAccountantEmail').value.trim() || null;
  const phone = getEl('newAccountantPhone').value.trim() || null;
  const regId = getEl('newAccountantRegId').value.trim();
  if (!fullName || !regId) { showMessage('newAccountantMessage', 'Name and Registration ID are required.', 'error'); setLoading(btn, false, '✅ Create Accountant & Generate ID'); return; }
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from('accountants').insert([{
      registration_id: regId, full_name: fullName, email, phone,
      created_by: user?.id || null, is_approved: true,
    }]);
    if (error) { showMessage('newAccountantMessage', 'Error: ' + error.message, 'error'); setLoading(btn, false, '✅ Create Accountant & Generate ID'); return; }
    showMessage('newAccountantMessage', `✅ Accountant "${fullName}" created with ID: ${regId}. Provide this ID to them for registration.`, 'success');
    getEl('newAccountantName').value = '';
    getEl('newAccountantEmail').value = '';
    getEl('newAccountantPhone').value = '';
    getEl('newAccountantRegId').value = '';
    getEl('newAccountantSection').style.display = 'none';
    await renderAccountantsTable();
  } catch (err) { showMessage('newAccountantMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '✅ Create Accountant & Generate ID'); }
}

// ================================================================
// Accountant CRUD
// ================================================================

window.editAccountant = function (id, name, email, phone) {
  getEl('accountantEditId').value = id;
  getEl('accountantFullName').value = name || '';
  getEl('accountantEmail').value = email || '';
  getEl('accountantPhone').value = phone || '';
  getEl('accountantFormSection').open = true;
};

window.deleteAccountant = async function (id) {
  if (!confirm('Delete this accountant record?')) return;
  const { data: accountant } = await supabaseClient.from('accountants').select('full_name').eq('id', id).single();
  const { error } = await supabaseClient.from('accountants').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderAccountantsTable();
  logSubAdminActivity(`Deleted accountant "${accountant?.full_name || id}"`, 'accountant', accountant?.full_name || id);
};

// Approve accountant
window.approveAccountant = async function (accountantId) {
  try {
    const { error } = await supabaseClient.from('accountants').update({ is_approved: true }).eq('id', accountantId);
    if (error) { alert('Error: ' + error.message); return; }
    await renderAccountantsTable();
  } catch (err) { alert('Error: ' + err.message); }
};

// Unlink accountant auth user
window.unlinkAccountantUser = async function (accountantId) {
  if (!confirm('Unlink the accountant\'s auth account? They will need to register again.')) return;
  try {
    const { error } = await supabaseClient.from('accountants').update({ user_id: null }).eq('id', accountantId);
    if (error) { alert('Error: ' + error.message); return; }
    await renderAccountantsTable();
  } catch (err) { alert('Error: ' + err.message); }
};

export async function renderAccountantsTable() {
  const search = (getEl('adminAccountantsSearch')?.value || '').toLowerCase();
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('accountants').select('*');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) { console.error('Load accountants error:', error); return; }
  let items = data || [];
  if (search) items = items.filter((t) => `${t.full_name} ${t.email || ''} ${t.registration_id || ''}`.toLowerCase().includes(search));
  const tbody = getEl('adminAccountantsBody');
  const noEl = getEl('adminNoAccountants');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';

  tbody.innerHTML = items.map((t) => {
    const regInfo = t.registration_id ? `<br><small style="color:var(--text-muted);font-size:0.75rem;">🔑 ${t.registration_id}</small>` : '';
    const regStatus = t.registration_id
      ? (t.user_id
        ? '<span style="color:var(--success);font-size:0.75rem;">✅ Registered</span>'
        : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not registered</span>')
      : '';
    const approveBtn = t.registration_id
      ? (t.is_approved
        ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
        : `<button class="action-btn confirm" onclick="approveAccountant('${t.id}')">✅ Approve</button>`)
      : '';
    const unlinkBtn = (t.registration_id && t.user_id)
      ? `<button class="action-btn" onclick="unlinkAccountantUser('${t.id}')">🔗 Unlink</button>`
      : '';
    const resetPwBtn = `<button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('accountant','${t.id}','${t.full_name.replace(/'/g, "\\'")}')">🔑 Password</button>`;
    const actionBtns = `<button class="action-btn confirm" onclick="editAccountant('${t.id}','${t.full_name.replace(/'/g, "\\'")}','${(t.email || '').replace(/'/g, "\\'")}','${(t.phone || '').replace(/'/g, "\\'")}')">Edit</button>${resetPwBtn}<button class="action-btn danger" onclick="deleteAccountant('${t.id}')">Delete</button>`;
    return `<tr>
      <td><span class="dash-photo-placeholder">🧾</span></td>
      <td><strong>${t.full_name}</strong>${regInfo}</td>
      <td>${t.email || '-'}</td>
      <td>${t.phone || '-'}</td>
      <td>${regStatus}</td>
      <td>${approveBtn}</td>
      <td>${actionBtns} ${unlinkBtn}</td>
    </tr>`;
  }).join('');
}