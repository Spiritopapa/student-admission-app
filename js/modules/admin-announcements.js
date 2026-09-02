/**
 * Admin Announcements Module
 */

import { getEl, showMessage, clearMessage, setLoading, formatDateTime, logSubAdminActivity, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initAdminAnnouncements(supabase) {
  supabaseClient = supabase;
}

export function setupAnnouncementForm() {
  getEl('addAnnouncementBtn')?.addEventListener('click', () => {
    getEl('announcementEditId').value = '';
    getEl('announcementForm').reset();
    getEl('announcementPriority').value = 'normal';
    getEl('announcementActive').value = 'true';
    getEl('announcementFormSection').open = true;
  });

  getEl('announcementForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('announcementMessage');
    const btn = getEl('announcementSubmitBtn');
    setLoading(btn, true, 'Saving...');
    const editId = getEl('announcementEditId').value;
    const schoolId = await getCurrentSchoolId();
    const payload = {
      title: getEl('announcementTitle').value.trim(),
      content: getEl('announcementContent').value.trim(),
      priority: getEl('announcementPriority').value,
      is_active: getEl('announcementActive').value === 'true',
      school_id: schoolId || undefined
    };
    try {
      if (editId) {
        const { error } = await supabaseClient.from('announcements').update(payload).eq('id', editId);
        if (error) throw error;
        showMessage('announcementMessage', 'Announcement updated.', 'success');
        logSubAdminActivity(`Updated announcement "${payload.title}"`, 'announcement', payload.title);
      } else {
        const { error } = await supabaseClient.from('announcements').insert([payload]);
        if (error) throw error;
        showMessage('announcementMessage', 'Announcement created.', 'success');
        logSubAdminActivity(`Created announcement "${payload.title}"`, 'announcement', payload.title);
      }
      getEl('announcementForm').reset();
      getEl('announcementEditId').value = '';
      await renderAnnouncementsList();
    } catch (err) { showMessage('announcementMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Announcement'); }
  });

  getEl('adminAnnouncementsSearch')?.addEventListener('input', renderAnnouncementsList);
}

window.editAnnouncement = function (id, title, content, priority, active) {
  getEl('announcementEditId').value = id;
  getEl('announcementTitle').value = title;
  getEl('announcementContent').value = content;
  getEl('announcementPriority').value = priority;
  getEl('announcementActive').value = active ? 'true' : 'false';
  getEl('announcementFormSection').open = true;
};

window.deleteAnnouncement = async function (id) {
  if (!confirm('Delete this announcement?')) return;
  const { data: ann } = await supabaseClient.from('announcements').select('title').eq('id', id).single();
  const { error } = await supabaseClient.from('announcements').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderAnnouncementsList();
  logSubAdminActivity(`Deleted announcement "${ann?.title || id}"`, 'announcement', ann?.title || id);
};

export async function renderAnnouncementsList() {
  const search = (getEl('adminAnnouncementsSearch')?.value || '').toLowerCase();
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('announcements').select('*');
  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) { console.error('Load announcements error:', error); return; }
  let items = data || [];
  if (search) items = items.filter((a) => a.title.toLowerCase().includes(search) || a.content.toLowerCase().includes(search));
  const listEl = getEl('adminAnnouncementsList');
  const noEl = getEl('adminNoAnnouncements');
  if (!listEl) return;
  if (items.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  listEl.innerHTML = items.map((a) => {
    const priorityCls = `priority-${a.priority}`;
    const statusCls = a.is_active ? 'status-active' : 'status-inactive';
    return `<div class="announcement-card">
      <div class="announcement-content">
        <div class="announcement-title-row">
          <span class="announcement-title">${a.title}</span>
          <span class="priority-badge ${priorityCls}">${a.priority}</span>
          <span class="priority-badge ${statusCls}">${a.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        <p class="announcement-text">${a.content}</p>
        <div class="announcement-meta"><span>${formatDateTime(a.created_at)}</span></div>
      </div>
      <div class="announcement-actions">
        <button class="action-btn confirm" onclick="editAnnouncement('${a.id}','${a.title.replace(/'/g, "\\'")}','${a.content.replace(/'/g, "\\'")}','${a.priority}',${a.is_active})">Edit</button>
        <button class="action-btn danger" onclick="deleteAnnouncement('${a.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}