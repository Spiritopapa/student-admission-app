/**
 * Admin Parents Module
 */

import { getEl, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initAdminParents(supabase) {
  supabaseClient = supabase;
}

export function setupParentListeners() {
  getEl('adminParentsSearch')?.addEventListener('input', renderParentsTable);
  getEl('adminParentsFilter')?.addEventListener('change', renderParentsTable);
}

export async function renderParentsTable() {
  const search = (getEl('adminParentsSearch')?.value || '').toLowerCase();
  const filter = getEl('adminParentsFilter')?.value || '';
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('profiles').select('*').eq('role', 'parent');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) { console.error('Load parents error:', error); return; }
  let parents = data || [];
  if (search) parents = parents.filter((p) => `${p.full_name} ${p.email}`.toLowerCase().includes(search));
  const enriched = await Promise.all(parents.map(async (p) => {
    const { data: links } = await supabaseClient.from('parent_links').select('student_id').eq('parent_user_id', p.id);
    return { ...p, wardCount: links?.length || 0 };
  }));
  // FIX: Actually filter the array (original bug: filter result not assigned)
  let filtered = enriched;
  if (filter === 'hasWards') filtered = enriched.filter((x) => x.wardCount > 0);
  else if (filter === 'noWards') filtered = enriched.filter((x) => x.wardCount === 0);
  const tbody = getEl('adminParentsBody');
  const noEl = getEl('adminNoParents');
  if (!tbody) return;
  if (filtered.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  tbody.innerHTML = filtered.map((p) => `<tr><td><strong>${p.full_name}</strong></td><td>${p.email}</td><td>${p.wardCount}</td><td>${new Date(p.created_at).toLocaleDateString()}</td></tr>`).join('');
}