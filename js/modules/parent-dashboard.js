/**
 * Parent Dashboard Module
 */

import { getEl, showMessage, buildStudentName, formatDate, getRoleDisplay, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initParentDashboard(supabase) {
  supabaseClient = supabase;
}

export async function loadParentDashboard(user) {
  const welcomeEl = getEl('parentWelcome');
  const content = getEl('parentProfileContent');
  if (!user) { content.innerHTML = '<p>Please log in.</p>'; return; }
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  welcomeEl.textContent = `Welcome, ${profile?.full_name || 'Parent'} | ${getRoleDisplay('parent')}`;
  const { data: links, error: linkErr } = await supabaseClient.from('parent_links').select('student_id').eq('parent_user_id', user.id);
  if (linkErr) { content.innerHTML = `<p class="message error">Error: ${linkErr.message}</p>`; return; }
  if (!links || links.length === 0) { content.innerHTML = '<p>No ward linked to your account. Contact the administrator.</p>'; return; }
  const studentIds = links.map((l) => l.student_id);
  const schoolId = await getCurrentSchoolId();
  let appsQuery = supabaseClient.from('applications').select('*').in('student_id', studentIds);
  if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
  const { data: apps, error: appErr } = await appsQuery;
  if (appErr) { content.innerHTML = `<p class="message error">Error: ${appErr.message}</p>`; return; }
  if (!apps || apps.length === 0) { content.innerHTML = '<p>No ward records found.</p>'; return; }

  let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
  if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
  const { data: settings } = await settingsQuery.maybeSingle();
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  // Apply school logo to parent sidebar
  if (schoolId) {
    try {
      const { data: schoolSettings } = await supabaseClient.from('school_settings')
        .select('logo_url')
        .eq('school_id', schoolId)
        .maybeSingle();
      const logoUrl = schoolSettings?.logo_url || '';
      if (logoUrl) {
        const parentSidebarLogo = document.querySelector('#parentSidebar .sidebar-logo-circle');
        if (parentSidebarLogo) {
          parentSidebarLogo.innerHTML = `<img src="${logoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
        }
      }
    } catch (e) { /* ignore logo fetch errors */ }
  }

  const { data: allAttendance } = await supabaseClient.from('attendance')
    .select('*').in('student_id', studentIds).eq('academic_year', academicYear).eq('term', currentTerm);

  const attMap = new Map();
  (allAttendance || []).forEach(r => {
    if (!attMap.has(r.student_id)) attMap.set(r.student_id, []);
    attMap.get(r.student_id).push(r);
  });

  const wardCards = await Promise.all(apps.map(async (app) => {
    const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
    const photoHtml = app.student_photo_url ? `<img src="${app.student_photo_url}" class="dash-photo" />` : '<span class="dash-photo-placeholder">📷</span>';
    const statusBadge = `<span class="status-badge status-${app.status}">${app.status.toUpperCase()}</span>`;
    const confirmedBadge = app.portal_confirmed ? '<span class="badge-confirmed">✅ Portal Active</span>' : '<span class="badge-unconfirmed">⏳ Pending</span>';

    const records = attMap.get(app.student_id) || [];
    const attStats = { present: 0, absent: 0 };
    records.forEach(r => { attStats[r.status]++; });
    const attTotal = records.length;
    const attPct = attTotal > 0 ? ((attStats.present / attTotal) * 100).toFixed(1) : 'N/A';
    const pctColor = attTotal > 0 ? (parseFloat(attPct) >= 80 ? 'var(--success)' : parseFloat(attPct) >= 50 ? 'var(--warning)' : 'var(--danger)') : 'var(--text-muted)';
    const recentRecords = records.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    return `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;">
        ${photoHtml}
        <div><h3 style="margin:0;">${name}</h3><span class="id-display" style="font-size:0.85rem;">${app.student_id}</span></div>
        <div style="margin-left:auto;display:flex;gap:0.5rem;align-items:center;">${statusBadge} ${confirmedBadge}</div>
      </div>
      <div class="profile-detail" style="margin-bottom:0.75rem;">
        <div class="detail-item"><span class="detail-label">Class</span><span class="detail-value">${app.class_applying}</span></div>
        <div class="detail-item"><span class="detail-label">Gender</span><span class="detail-value">${app.gender || 'Male'}</span></div>
        <div class="detail-item"><span class="detail-label">Date of Birth</span><span class="detail-value">${formatDate(app.date_of_birth)}</span></div>
        <div class="detail-item"><span class="detail-label">Teacher</span><span class="detail-value">${app.teacher || '-'}</span></div>
        <div class="detail-item"><span class="detail-label">Religion</span><span class="detail-value">${app.religion}</span></div>
        <div class="detail-item"><span class="detail-label">Attendance</span><span class="detail-value"><strong style="color:${pctColor};">${attPct}%</strong> (${attStats.present}✓ ${attStats.absent}✗)</span></div>
      </div>
      ${recentRecords.length > 0 ? `
      <div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">
        <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;">Recent Attendance</span>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;">
          ${recentRecords.map(r => {
            const icons = { present: '✅', absent: '❌' };
            const colors = { present: 'var(--success)', absent: 'var(--danger)' };
            return `<span style="font-size:0.8rem;color:${colors[r.status] || 'inherit'};">${icons[r.status] || ''} ${formatDate(r.date)}</span>`;
          }).join('<span style="color:var(--border);">|</span>')}
        </div>
      </div>` : ''}
    </div>`;
  }));

  content.innerHTML = wardCards.join('');
}