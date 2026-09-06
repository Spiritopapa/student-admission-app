/**
 * Admin Settings Module
 * ---------------------
 * Manages school-level admission options, including the "Admission Items"
 * (additional fees) that appear on the Admit Student form.
 *
 * When an admin adds an admission item here (name + default amount), every
 * Admit Student form shows that item with an amount input. On admission, the
 * class term fee + the entered item amounts are saved as the student's term
 * fee (total_amount + fee_breakdown snapshot on the fees table).
 */

import { getEl, showMessage, setLoading, getCurrentSchoolId, formatCurrency, formatDate, logSubAdminActivity } from './utils.js';

let supabaseClient = null;

export function initAdminSettings(supabase) {
  supabaseClient = supabase;
}

/** Escape a string for safe insertion into HTML. */
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================================================================
// Shared loader - used by the Settings page AND the Admit Student form
// ================================================================

/**
 * Fetch the active admission items for the current school.
 * Returns an array ordered by creation time (oldest first).
 */
export async function loadAdmissionItems() {
  const schoolId = await getCurrentSchoolId();
  if (!schoolId) return [];
  const { data, error } = await supabaseClient
    .from('admission_items')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Failed to load admission items:', error.message);
    return [];
  }
  return data || [];
}

// ================================================================
// Settings page - admission items management
// ================================================================

export async function loadSettingsPage() {
  await renderAdmissionItemsTable();
}

async function renderAdmissionItemsTable() {
  const tbody = getEl('settingsItemsBody');
  if (!tbody) return;
  const emptyHint = getEl('settingsEmptyHint');
  const items = await loadAdmissionItems();

  if (emptyHint) emptyHint.style.display = items.length === 0 ? 'block' : 'none';

  if (items.length === 0) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>GHC ${formatCurrency(item.amount)}</td>
      <td>${formatDate(item.created_at)}</td>
      <td>
        <button type="button" class="btn btn-danger btn-sm" data-delete-admission-item="${item.id}" data-item-name="${escapeHtml(item.name)}">Delete</button>
      </td>
    </tr>
  `).join('');

  // Attach delete handlers to the freshly rendered rows.
  tbody.querySelectorAll('button[data-delete-admission-item]').forEach((btn) => {
    btn.addEventListener('click', () => deleteAdmissionItem(btn));
  });
}

async function addAdmissionItem() {
  const nameEl = getEl('settingsItemName');
  const amountEl = getEl('settingsItemAmount');
  const name = nameEl ? nameEl.value.trim() : '';
  const amount = Number(amountEl ? amountEl.value : 0);

  if (!name) {
    showMessage('settingsMessage', 'Enter an item name (e.g. Development Levy).', 'error');
    return;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    showMessage('settingsMessage', 'Enter a valid amount (0 or more).', 'error');
    return;
  }

  const schoolId = await getCurrentSchoolId();
  if (!schoolId) {
    showMessage('settingsMessage', 'Could not determine your school. Please sign in again.', 'error');
    return;
  }

  const btn = getEl('settingsAddItemBtn');
  setLoading(btn, true, 'Adding...');
  try {
    const { error } = await supabaseClient.from('admission_items').insert([{
      school_id: schoolId,
      name,
      amount,
    }]);
    if (error) throw error;

    showMessage('settingsMessage', `Admission item "<strong>${escapeHtml(name)}</strong>" added. It will now appear on the Admit Student form.`, 'success');
    logSubAdminActivity(`Added admission item "${name}" (GHC ${formatCurrency(amount)})`, 'fees', 'settings');
    if (nameEl) nameEl.value = '';
    if (amountEl) amountEl.value = '';
    await renderAdmissionItemsTable();
  } catch (err) {
    showMessage('settingsMessage', 'Error adding item: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Add Item');
  }
}

async function deleteAdmissionItem(btn) {
  const itemId = btn.getAttribute('data-delete-admission-item');
  const itemName = btn.getAttribute('data-item-name') || 'this item';
  if (!itemId) return;
  if (!window.confirm(`Delete "${itemName}"? It will be removed from the Admit Student form. Already admitted students keep their saved fee breakdown.`)) return;

  setLoading(btn, true, 'Deleting...');
  try {
    const { error } = await supabaseClient.from('admission_items').delete().eq('id', itemId);
    if (error) throw error;

    showMessage('settingsMessage', `Admission item "<strong>${escapeHtml(itemName)}</strong>" deleted.`, 'success');
    logSubAdminActivity(`Deleted admission item "${itemName}"`, 'fees', 'settings');
    await renderAdmissionItemsTable();
  } catch (err) {
    showMessage('settingsMessage', 'Error deleting item: ' + err.message, 'error');
    setLoading(btn, false, 'Delete');
  }
}

// ================================================================
// Listener setup (called once at bootstrap)
// ================================================================

export function setupSettingsListeners() {
  getEl('settingsAddItemBtn')?.addEventListener('click', addAdmissionItem);
  // Enter key support inside the add-item form fields
  getEl('settingsItemName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAdmissionItem(); }
  });
  getEl('settingsItemAmount')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAdmissionItem(); }
  });
}