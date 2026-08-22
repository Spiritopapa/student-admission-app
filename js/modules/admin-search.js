/**
 * Admin Deep Search Module
 * 
 * Comprehensive instant deep search bar for the admin dashboard.
 * Searches across:
 * - Students (by name or ID) → quick-action icons: view/print profile, fees, attendance, report card
 * - Teachers (by name or ID) → quick-action icons: view/print teacher profile
 * - Accountants (by name or ID) → quick-action icons: view accountant profile
 * - Other (classes, subjects, parents, announcements, exams)
 */

import { getEl, buildStudentName, formatDate, getCurrentSchoolId, getTermDisplay, getSubjectGrade, getPerformanceLevel, getGrade, getTeacherRemarks, getHeadTeacherRemarks, collectStyles, openPrintWindow } from './utils.js';

let supabaseClient = null;
let searchCache = {
  students: [],
  teachers: [],
  accountants: [],
  classes: [],
  subjects: [],
  parents: [],
  announcements: [],
  exams: []
};
let searchLoaded = false;
let activeContextMenu = null;

export function initAdminSearch(supabase) {
  supabaseClient = supabase;
}

// ================================================================
// Load All Search Data
// ================================================================

export async function loadSearchData(force = false) {
  if (searchLoaded && !force) return;
  const schoolId = await getCurrentSchoolId();

  // CRITICAL SECURITY: Fail closed. If we cannot determine the current
  // school_id, do NOT fetch any data. Fetching without a school_id filter
  // would leak data from ALL schools into the search results.
  // NOTE: Do NOT set searchLoaded = true here so we can retry once the
  // school_id becomes available (e.g., after profile loads).
  if (!schoolId) {
    console.warn('Search: No school_id available. Clearing search cache to prevent cross-school data leakage.');
    searchCache = {
      students: [],
      teachers: [],
      accountants: [],
      classes: [],
      subjects: [],
      parents: [],
      announcements: [],
      exams: []
    };
    return;
  }

  // Students
  try {
    const { data } = await supabaseClient.from('applications')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
    searchCache.students = data || [];
  } catch (e) { console.warn('Search: failed to load students', e); }

  // Teachers
  try {
    const { data } = await supabaseClient.from('teachers')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.teachers = data || [];
  } catch (e) { console.warn('Search: failed to load teachers', e); }

  // Accountants
  try {
    const { data } = await supabaseClient.from('accountants')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.accountants = data || [];
  } catch (e) { console.warn('Search: failed to load accountants', e); }

  // Classes
  try {
    const { data } = await supabaseClient.from('classes')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.classes = data || [];
  } catch (e) { console.warn('Search: failed to load classes', e); }

  // Subjects
  try {
    const { data } = await supabaseClient.from('subjects')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.subjects = data || [];
  } catch (e) { console.warn('Search: failed to load subjects', e); }

  // Parents
  try {
    const { data } = await supabaseClient.from('parent_links')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.parents = data || [];
  } catch (e) { console.warn('Search: failed to load parents', e); }

  // Announcements
  try {
    const { data } = await supabaseClient.from('announcements')
      .select('*')
      .eq('is_active', true)
      .eq('school_id', schoolId);
    searchCache.announcements = data || [];
  } catch (e) { console.warn('Search: failed to load announcements', e); }

  // Exams
  try {
    const { data } = await supabaseClient.from('exams')
      .select('*')
      .eq('school_id', schoolId);
    searchCache.exams = data || [];
  } catch (e) { console.warn('Search: failed to load exams', e); }

  searchLoaded = true;
}

// ================================================================
// Setup Search Bar
// ================================================================

export function setupAdminSearch() {
  const searchInput = getEl('adminDeepSearchInput');
  const searchResults = getEl('adminDeepSearchResults');
  if (!searchInput || !searchResults) return;

  // Debounced input handler
  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(searchInput.value);
    }, 150);
  });

  // Focus handler - show results if there's a query
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
      performSearch(searchInput.value);
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    const searchBar = getEl('adminDeepSearchBar');
    if (searchBar && !searchBar.contains(e.target)) {
      searchResults.style.display = 'none';
    }
    closeContextMenu();
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.deep-search-item');
    if (items.length === 0) return;
    const currentIndex = Array.from(items).findIndex(el => el.classList.contains('active'));
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items.forEach((el, i) => el.classList.toggle('active', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items.forEach((el, i) => el.classList.toggle('active', i === prev));
      items[prev].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = searchResults.querySelector('.deep-search-item.active');
      if (active) active.click();
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
      closeContextMenu();
    }
  });

  // Clear button
  const clearBtn = getEl('adminDeepSearchClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchResults.style.display = 'none';
      searchInput.focus();
    });
  }
}

// ================================================================
// Perform Search
// ================================================================

async function performSearch(query) {
  const searchResults = getEl('adminDeepSearchResults');
  if (!searchResults) return;
  
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    searchResults.style.display = 'none';
    return;
  }

  // Ensure data is loaded
  await loadSearchData();

  const results = [];
  const qLower = q;

  // --- Students ---
  searchCache.students.forEach(s => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
    const studentId = (s.student_id || '').toLowerCase();
    const parentContact = (s.parent_contact || '').toLowerCase();
    if (name.includes(qLower) || studentId.includes(qLower) || parentContact.includes(qLower)) {
      results.push({
        type: 'student',
        icon: '🎓',
        title: buildStudentName(s.first_name, s.middle_name, s.last_name),
        subtitle: `${s.student_id} · ${s.class_applying || 'No Class'} · ${s.status || ''}`,
        data: s
      });
    }
  });

  // --- Teachers ---
  searchCache.teachers.forEach(t => {
    const name = (t.full_name || '').toLowerCase();
    const staffId = (t.staff_id || '').toLowerCase();
    const regId = (t.registration_id || '').toLowerCase();
    const email = (t.email || '').toLowerCase();
    if (name.includes(qLower) || staffId.includes(qLower) || regId.includes(qLower) || email.includes(qLower)) {
      results.push({
        type: 'teacher',
        icon: '👨‍🏫',
        title: t.full_name || 'Unknown Teacher',
        subtitle: `${t.staff_id || t.registration_id || 'No ID'} · ${t.class_taught || 'No Class'} · ${t.subject || ''}`,
        data: t
      });
    }
  });

  // --- Accountants ---
  searchCache.accountants.forEach(a => {
    const name = (a.full_name || '').toLowerCase();
    const regId = (a.registration_id || '').toLowerCase();
    const email = (a.email || '').toLowerCase();
    if (name.includes(qLower) || regId.includes(qLower) || email.includes(qLower)) {
      results.push({
        type: 'accountant',
        icon: '🧾',
        title: a.full_name || 'Unknown Accountant',
        subtitle: `${a.registration_id || 'No ID'} · ${a.email || ''}`,
        data: a
      });
    }
  });

  // --- Classes ---
  searchCache.classes.forEach(c => {
    const name = (c.name || '').toLowerCase();
    if (name.includes(qLower)) {
      results.push({
        type: 'class',
        icon: '🏫',
        title: c.name || 'Unknown Class',
        subtitle: `Class · Level ${c.level || 'N/A'}`,
        data: c
      });
    }
  });

  // --- Subjects ---
  searchCache.subjects.forEach(s => {
    const name = (s.name || '').toLowerCase();
    if (name.includes(qLower)) {
      results.push({
        type: 'subject',
        icon: '📖',
        title: s.name || 'Unknown Subject',
        subtitle: 'Subject',
        data: s
      });
    }
  });

  // --- Parents ---
  searchCache.parents.forEach(p => {
    const name = (p.parent_name || '').toLowerCase();
    const contact = (p.parent_contact || '').toLowerCase();
    if (name.includes(qLower) || contact.includes(qLower)) {
      results.push({
        type: 'parent',
        icon: '👨‍👩‍👧',
        title: p.parent_name || 'Unknown Parent',
        subtitle: `${p.parent_contact || ''} · Ward: ${p.student_id || ''}`,
        data: p
      });
    }
  });

  // --- Announcements ---
  searchCache.announcements.forEach(a => {
    const title = (a.title || '').toLowerCase();
    const content = (a.content || '').toLowerCase();
    if (title.includes(qLower) || content.includes(qLower)) {
      results.push({
        type: 'announcement',
        icon: '📢',
        title: a.title || 'Untitled Announcement',
        subtitle: `${a.priority || 'normal'} · ${formatDate(a.created_at)}`,
        data: a
      });
    }
  });

  // --- Exams ---
  searchCache.exams.forEach(e => {
    const name = (e.name || '').toLowerCase();
    if (name.includes(qLower)) {
      results.push({
        type: 'exam',
        icon: '📝',
        title: e.name || 'Unknown Exam',
        subtitle: `${e.academic_year || ''} · ${getTermDisplay(e.term)}`,
        data: e
      });
    }
  });

  // Limit results
  const limited = results.slice(0, 30);

  if (limited.length === 0) {
    searchResults.innerHTML = `
      <div class="deep-search-empty">
        <span style="font-size:2rem;">🔍</span>
        <p>No results found for "<strong>${escapeHtml(query)}</strong>"</p>
        <small>Try searching by name, ID, class, subject, or parent contact.</small>
      </div>
    `;
  } else {
    // Group by type for better organization
    const grouped = {};
    limited.forEach(r => {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    });

    const typeLabels = {
      student: '🎓 Students',
      teacher: '👨‍🏫 Teachers',
      accountant: '🧾 Accountants',
      class: '🏫 Classes',
      subject: '📖 Subjects',
      parent: '👨‍👩‍👧 Parents',
      announcement: '📢 Announcements',
      exam: '📝 Exams'
    };

    searchResults.innerHTML = Object.entries(grouped).map(([type, items]) => `
      <div class="deep-search-group">
        <div class="deep-search-group-label">${typeLabels[type] || type} <span class="deep-search-count">${items.length}</span></div>
        ${items.map(item => {
          // For students, use student_id as the identifier
          // For teachers/accountants, use the id (UUID)
          // For others, use name or id
          const itemId = item.type === 'student'
            ? item.data.student_id || item.data.id || ''
            : item.data.id || item.data.name || '';
          // Quick-action icons (former context-menu items) shown beside each result
          const quickActions = getContextMenuItems(item.type, itemId);
          return `
          <div class="deep-search-item" data-type="${item.type}" data-id="${escapeHtml(String(itemId))}" tabindex="0">
            <span class="deep-search-item-icon">${item.icon}</span>
            <div class="deep-search-item-info">
              <span class="deep-search-item-title">${escapeHtml(item.title)}</span>
              <span class="deep-search-item-subtitle">${escapeHtml(item.subtitle)}</span>
            </div>
            <span class="deep-search-item-actions" role="group" aria-label="Quick actions">
              ${quickActions.map(a => `
                <button type="button" class="deep-search-action-btn" title="${escapeHtml(a.label)}" aria-label="${escapeHtml(a.label)}" data-action="${escapeHtml(a.label)}">${a.icon}</button>
              `).join('')}
            </span>
          </div>
        `;
        }).join('')}
      </div>
    `).join('');
  }

  searchResults.style.display = 'block';

  // Bind click and contextmenu handlers
  searchResults.querySelectorAll('.deep-search-item').forEach(item => {
    const type = item.getAttribute('data-type');
    const id = item.getAttribute('data-id');

    // Left click on the row - default action (ignores quick-action buttons)
    item.addEventListener('click', (e) => {
      if (e.target.closest('.deep-search-action-btn')) return;
      e.stopPropagation();
      handleSearchItemClick(type, id);
    });

    // Quick-action icon buttons (former context-menu items) - one-click access
    item.querySelectorAll('.deep-search-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const label = btn.getAttribute('data-action');
        const actionItem = getContextMenuItems(type, id).find(mi => mi.label === label);
        if (actionItem) {
          actionItem.action();
          closeContextMenu();
          getEl('adminDeepSearchResults').style.display = 'none';
        }
      });
    });

    // Right click - context menu (full list kept as a fallback)
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, type, id);
    });
  });
}

// ================================================================
// Handle Search Item Click (default action)
// ================================================================

function handleSearchItemClick(type, id) {
  switch (type) {
    case 'student':
      openStudentProfile(id);
      break;
    case 'teacher':
      viewTeacherProfile(id);
      break;
    case 'accountant':
      viewAccountantProfile(id);
      break;
    case 'class':
      alert(`Class: ${id}\n\nUse the Classes module to manage this class.`);
      break;
    case 'subject':
      alert(`Subject: ${id}\n\nUse the Subjects module to manage this subject.`);
      break;
    case 'parent':
      alert(`Parent: ${id}\n\nUse the Parents module to manage this parent.`);
      break;
    case 'announcement':
      alert(`Announcement: ${id}\n\nUse the Announcements module to manage this announcement.`);
      break;
    case 'exam':
      alert(`Exam: ${id}\n\nUse the Exams module to manage this exam.`);
      break;
  }
  getEl('adminDeepSearchResults').style.display = 'none';
}

// ================================================================
// Context Menu / Quick Actions
// ================================================================

/**
 * Shared source of truth for the actions available on a search result.
 * These are rendered BOTH as quick-action icon buttons beside each
 * search result AND as the items in the right-click context menu.
 */
function getContextMenuItems(type, id) {
  if (type === 'student') {
    return [
      { icon: '👁️', label: 'View Student Profile', action: () => openStudentProfile(id) },
      { icon: '🖨️', label: 'Print Student Profile', action: () => printStudentProfile(id) },
      { icon: '💰', label: 'View Fees Details', action: () => viewStudentFees(id) },
      { icon: '📋', label: 'View Attendance Records', action: () => viewStudentAttendance(id) },
      { icon: '📝', label: 'View Examination Report Card', action: () => viewStudentReportCard(id) },
    ];
  } else if (type === 'teacher') {
    return [
      { icon: '👁️', label: 'View Teacher Profile', action: () => viewTeacherProfile(id) },
      { icon: '🖨️', label: 'Print Teacher Profile', action: () => printTeacherProfile(id) },
    ];
  } else if (type === 'accountant') {
    return [
      { icon: '👁️', label: 'View Accountant Profile', action: () => viewAccountantProfile(id) },
    ];
  } else {
    return [
      { icon: '👁️', label: `View ${type.charAt(0).toUpperCase() + type.slice(1)}`, action: () => handleSearchItemClick(type, id) },
    ];
  }
}

function showContextMenu(x, y, type, id) {
  closeContextMenu();
  
  const menu = document.createElement('div');
  menu.className = 'deep-search-context-menu';
  menu.id = 'deepSearchContextMenu';

  const menuItems = getContextMenuItems(type, id);

  menu.innerHTML = `
    <div class="deep-search-context-header">
      <span>${type.charAt(0).toUpperCase() + type.slice(1)} Actions</span>
    </div>
    ${menuItems.map(item => `
      <div class="deep-search-context-item" data-action="${item.label}">
        <span class="deep-search-context-icon">${item.icon}</span>
        <span>${item.label}</span>
      </div>
    `).join('')}
  `;

  document.body.appendChild(menu);

  // Position menu
  const menuWidth = 260;
  const menuHeight = menuItems.length * 44 + 40;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = x;
  let top = y;
  if (left + menuWidth > viewportWidth) left = Math.max(0, viewportWidth - menuWidth - 8);
  if (top + menuHeight > viewportHeight) top = Math.max(0, viewportHeight - menuHeight - 8);
  
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.display = 'block';

  // Bind actions
  menu.querySelectorAll('.deep-search-context-item').forEach((item, idx) => {
    item.addEventListener('click', () => {
      menuItems[idx].action();
      closeContextMenu();
    });
  });

  activeContextMenu = menu;
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// ================================================================
// Student Actions
// ================================================================

function openStudentProfile(studentId) {
  const student = searchCache.students.find(s => s.student_id === studentId);
  if (!student) { alert('Student not found in search cache.'); return; }
  
  // Build and show a student profile modal directly from search cache data
  let modal = getEl('deepSearchStudentModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchStudentModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:700px;">
        <div class="modal-header">
          <h3 id="deepSearchStudentModalName">Student Profile</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchStudentModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body" id="deepSearchStudentModalContent"></div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchStudentModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
  getEl('deepSearchStudentModalName').textContent = name;
  
  const photoHtml = student.student_photo_url
    ? `<img src="${student.student_photo_url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;display:block;margin:0 auto 1rem;" />`
    : '<div style="font-size:3rem;text-align:center;margin-bottom:1rem;">🎓</div>';

  const field = (label, val) => `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;

  getEl('deepSearchStudentModalContent').innerHTML = `
    ${photoHtml}
    <div class="profile-detail">
      ${field('Student ID', student.student_id)}
      ${field('Full Name', name)}
      ${field('Class', student.class_applying)}
      ${field('Status', student.status)}
      ${field('Gender', student.gender || 'Male')}
      ${field('Date of Birth', formatDate(student.date_of_birth))}
      ${field('Religion', student.religion)}
      ${field('Parent / Guardian', student.parent_name)}
      ${field('Parent Contact', student.parent_contact)}
      ${field('Teacher', student.teacher)}
      ${field('Home Town', student.home_town)}
      ${field('Place of Stay', student.place_of_stay)}
      ${field('Admission Date', formatDate(student.admission_date))}
      ${field('Previous School', student.previous_school)}
      ${field('Portal Confirmed', student.portal_confirmed ? '✅ Yes' : '❌ No')}
    </div>
  `;

  modal.style.display = 'flex';
}

function printStudentProfile(studentId) {
  const student = searchCache.students.find(s => s.student_id === studentId);
  if (!student) { alert('Student not found.'); return; }
  
  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
  
  const photoHtml = student.student_photo_url
    ? `<img src="${student.student_photo_url}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;" />`
    : '<div style="font-size:3rem;">🎓</div>';

  const field = (label, val) => `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:200px;">${label}</td><td style="padding:6px;border:1px solid #e2e8f0;">${val || '-'}</td></tr>`;

  openPrintWindow(`<html><head><title>${name} - Student Profile</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 1.5rem; color: #1e293b; }
      .print-header { text-align: center; margin-bottom: 1.5rem; }
      .print-header h2 { font-size: 1.3rem; margin-bottom: 0.25rem; }
      .print-header p { color: #64748b; font-size: 0.85rem; }
      .profile-photo { text-align: center; margin-bottom: 1rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { border: 1px solid #e2e8f0; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
      th { background: #dbeafe; color: #1e293b; font-size: 0.75rem; text-transform: uppercase; }
      .print-footer { margin-top: 1.5rem; text-align: center; font-size: 0.75rem; color: #64748b; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>
    <div class="print-header">
      <h2>Student Profile</h2>
      <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    <div class="profile-photo">${photoHtml}</div>
    <h3 style="text-align:center;margin:0.5rem 0;">${name}</h3>
    <p style="text-align:center;color:#64748b;font-size:0.85rem;">${student.student_id}</p>
    <table>
      <tr><th colspan="2">Personal Information</th></tr>
      ${field('Student ID', student.student_id)}
      ${field('Full Name', name)}
      ${field('Class', student.class_applying)}
      ${field('Gender', student.gender || 'Male')}
      ${field('Date of Birth', formatDate(student.date_of_birth))}
      ${field('Religion', student.religion)}
      ${field('Status', student.status)}
      ${field('Portal Confirmed', student.portal_confirmed ? 'Yes' : 'No')}
      <tr><th colspan="2">Parent / Guardian</th></tr>
      ${field('Parent Name', student.parent_name)}
      ${field('Parent Contact', student.parent_contact)}
      ${field('Home Town', student.home_town)}
      ${field('Place of Stay', student.place_of_stay)}
      <tr><th colspan="2">Academic Information</th></tr>
      ${field('Teacher', student.teacher)}
      ${field('Admission Date', formatDate(student.admission_date))}
      ${field('Previous School', student.previous_school)}
      ${field('Term', student.term)}
    </table>
    <div class="print-footer"><p>Student Admission Portal &copy; ${new Date().getFullYear()}</p></div>
  </body></html>`, `${name} - Student Profile`, 900, 700);
}

async function viewStudentFees(studentId) {
  const student = searchCache.students.find(s => s.student_id === studentId);
  if (!student) { alert('Student not found.'); return; }
  
  const schoolId = await getCurrentSchoolId();
  if (!schoolId) { alert('Unable to determine your school. Please log out and log back in.'); return; }
  const { data: fees } = await supabaseClient.from('fees')
    .select('*')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .order('academic_year')
    .order('term');
  
  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
  
  // Build modal
  let modal = getEl('deepSearchFeesModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchFeesModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:800px;">
        <div class="modal-header">
          <h3>💰 Fee Details</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchFeesModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body" id="deepSearchFeesContent"></div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchFeesModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  const content = getEl('deepSearchFeesContent');
  
  if (!fees || fees.length === 0) {
    content.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">
      <span style="font-size:2rem;">💰</span>
      <p>No fee records found for <strong>${name}</strong> (${studentId}).</p>
    </div>`;
  } else {
    let totalAmount = 0, totalPaid = 0, totalDebt = 0;
    fees.forEach(f => {
      totalAmount += Number(f.total_amount) || 0;
      totalPaid += Number(f.amount_paid) || 0;
      totalDebt += Number(f.debt) || 0;
    });
    const totalBalance = totalAmount + totalDebt - totalPaid;

    const statusBadge = (status) => {
      const map = {
        paid: '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:0.75rem;">✅ Paid</span>',
        partial: '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:0.75rem;">⚠️ Partial</span>',
        unpaid: '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:0.75rem;">❌ Unpaid</span>'
      };
      return map[status] || status;
    };

    content.innerHTML = `
      <div style="margin-bottom:1rem;">
        <h4 style="margin:0 0 0.25rem 0;">${name} <small style="color:var(--text-muted);">(${studentId})</small></h4>
        <p style="color:var(--text-muted);font-size:0.85rem;margin:0;">${student.class_applying || ''}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.5rem;margin-bottom:1rem;">
        <div style="background:#f8fafc;border-radius:8px;padding:0.75rem;text-align:center;border:1px solid #e2e8f0;">
          <div style="font-size:1.2rem;font-weight:700;color:#1e293b;">GH₵ ${totalAmount.toFixed(2)}</div>
          <div style="font-size:0.75rem;color:#64748b;">Total Expected</div>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:0.75rem;text-align:center;border:1px solid #bbf7d0;">
          <div style="font-size:1.2rem;font-weight:700;color:#166534;">GH₵ ${totalPaid.toFixed(2)}</div>
          <div style="font-size:0.75rem;color:#166534;">Total Paid</div>
        </div>
        <div style="background:#fef2f2;border-radius:8px;padding:0.75rem;text-align:center;border:1px solid #fecaca;">
          <div style="font-size:1.2rem;font-weight:700;color:#991b1b;">GH₵ ${totalBalance.toFixed(2)}</div>
          <div style="font-size:0.75rem;color:#991b1b;">Outstanding Balance</div>
        </div>
        <div style="background:#fffbeb;border-radius:8px;padding:0.75rem;text-align:center;border:1px solid #fde68a;">
          <div style="font-size:1.2rem;font-weight:700;color:#92400e;">GH₵ ${totalDebt.toFixed(2)}</div>
          <div style="font-size:0.75rem;color:#92400e;">Carried Debt</div>
        </div>
      </div>
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
        <table class="app-table" style="min-width:700px;">
          <thead><tr><th>Academic Year</th><th>Term</th><th style="text-align:right;">Total Amount</th><th style="text-align:right;">Amount Paid</th><th style="text-align:right;">Debt</th><th style="text-align:right;">Balance</th><th style="text-align:center;">Status</th><th>Last Payment</th></tr></thead>
          <tbody>
            ${fees.map(f => {
              const amt = Number(f.total_amount) || 0;
              const paid = Number(f.amount_paid) || 0;
              const debt = Number(f.debt) || 0;
              const bal = amt + debt - paid;
              const lastPay = f.last_payment_date ? formatDate(f.last_payment_date) : '-';
              return `<tr>
                <td>${f.academic_year || '-'}</td>
                <td>${getTermDisplay(f.term)}</td>
                <td style="text-align:right;">GH₵ ${amt.toFixed(2)}</td>
                <td style="text-align:right;">GH₵ ${paid.toFixed(2)}</td>
                <td style="text-align:right;"><span style="color:${debt > 0 ? '#dc2626' : 'inherit'}">GH₵ ${debt.toFixed(2)}</span></td>
                <td style="text-align:right;"><span style="color:${bal > 0 ? '#dc2626' : '#16a34a'}">GH₵ ${bal.toFixed(2)}</span></td>
                <td style="text-align:center;">${statusBadge(f.payment_status)}</td>
                <td>${lastPay}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  modal.style.display = 'flex';
}

async function viewStudentAttendance(studentId) {
  const student = searchCache.students.find(s => s.student_id === studentId);
  if (!student) { alert('Student not found.'); return; }
  
  const schoolId = await getCurrentSchoolId();
  if (!schoolId) { alert('Unable to determine your school. Please log out and log back in.'); return; }
  let settings = null;
  const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
    .select('academic_year, current_term')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (schoolSettingsData) settings = schoolSettingsData;
  if (!settings) {
    const { data: legacySettings } = await supabaseClient.from('settings')
      .select('*')
      .eq('id', 'singleton')
      .eq('school_id', schoolId)
      .maybeSingle();
    settings = legacySettings || null;
  }
  const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  const { data: records } = await supabaseClient.from('attendance')
    .select('*')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .order('date', { ascending: false });

  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
  
  // Build modal
  let modal = getEl('deepSearchAttendanceModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchAttendanceModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:800px;">
        <div class="modal-header">
          <h3>📋 Attendance Records</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchAttendanceModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body" id="deepSearchAttendanceContent"></div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchAttendanceModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  const content = getEl('deepSearchAttendanceContent');
  
  if (!records || records.length === 0) {
    content.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">
      <span style="font-size:2rem;">📋</span>
      <p>No attendance records found for <strong>${name}</strong> (${studentId}).</p>
    </div>`;
  } else {
    // Stats
    const stats = { present: 0, absent: 0, late: 0, excused: 0 };
    records.forEach(r => { stats[r.status]++; });
    const total = records.length;
    const pct = total > 0 ? ((stats.present / total) * 100).toFixed(1) : '0';

    const statusBadge = (status) => {
      const map = {
        present: '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:0.75rem;">✅ Present</span>',
        absent: '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:0.75rem;">❌ Absent</span>',
        late: '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:0.75rem;">⏰ Late</span>',
        excused: '<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:12px;font-size:0.75rem;">📝 Excused</span>'
      };
      return map[status] || status;
    };

    content.innerHTML = `
      <div style="margin-bottom:1rem;">
        <h4 style="margin:0 0 0.25rem 0;">${name} <small style="color:var(--text-muted);">(${studentId})</small></h4>
        <p style="color:var(--text-muted);font-size:0.85rem;margin:0;">${student.class_applying || ''} · ${academicYear} · ${getTermDisplay(currentTerm)}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.5rem;margin-bottom:1rem;">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.75rem;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#166534;">${stats.present}</div>
          <div style="font-size:0.75rem;color:#166534;">Present</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:0.75rem;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#991b1b;">${stats.absent}</div>
          <div style="font-size:0.75rem;color:#991b1b;">Absent</div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.75rem;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#92400e;">${stats.late}</div>
          <div style="font-size:0.75rem;color:#92400e;">Late</div>
        </div>
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:0.75rem;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#3730a3;">${stats.excused}</div>
          <div style="font-size:0.75rem;color:#3730a3;">Excused</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:0.75rem;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#1e40af;">${pct}%</div>
          <div style="font-size:0.75rem;color:#1e40af;">Attendance Rate</div>
        </div>
      </div>
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
        <table class="app-table" style="min-width:600px;">
          <thead><tr><th>Date</th><th>Status</th><th>Term</th><th>Academic Year</th></tr></thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td>${formatDate(r.date)}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${getTermDisplay(r.term)}</td>
                <td>${r.academic_year || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:1rem;text-align:right;">
        <button class="btn btn-primary btn-sm" onclick="window.printDeepSearchAttendance()">🖨️ Print Attendance</button>
      </div>
    `;

    // Store data for printing
    window._deepSearchAttendanceData = { records, student, name, studentId };
  }
  
  modal.style.display = 'flex';
}

// Print attendance from deep search modal
window.printDeepSearchAttendance = function() {
  const data = window._deepSearchAttendanceData;
  if (!data) { alert('No attendance data to print.'); return; }
  
  const { records, student, name, studentId } = data;
  
  const statusMap = { present: '✅ Present', absent: '❌ Absent', late: '⏰ Late', excused: '📝 Excused' };
  const rows = records.map(r => `
    <tr>
      <td style="padding:6px;border:1px solid #e2e8f0;">${formatDate(r.date)}</td>
      <td style="padding:6px;border:1px solid #e2e8f0;">${statusMap[r.status] || r.status}</td>
      <td style="padding:6px;border:1px solid #e2e8f0;">${getTermDisplay(r.term)}</td>
      <td style="padding:6px;border:1px solid #e2e8f0;">${r.academic_year || '-'}</td>
    </tr>
  `).join('');
  
  openPrintWindow(`<html><head><title>${name} - Attendance Records</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 1.5rem; color: #1e293b; }
      .print-header { text-align: center; margin-bottom: 1.5rem; }
      .print-header h2 { font-size: 1.3rem; margin-bottom: 0.25rem; }
      .print-header p { color: #64748b; font-size: 0.85rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { border: 1px solid #e2e8f0; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
      th { background: #dbeafe; color: #1e293b; font-size: 0.75rem; text-transform: uppercase; }
      .print-footer { margin-top: 1.5rem; text-align: center; font-size: 0.75rem; color: #64748b; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>
    <div class="print-header">
      <h2>Attendance Records</h2>
      <p>${name} (${studentId}) · ${student.class_applying || ''}</p>
      <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    <table>
      <thead><tr><th style="padding:6px;border:1px solid #e2e8f0;">Date</th><th style="padding:6px;border:1px solid #e2e8f0;">Status</th><th style="padding:6px;border:1px solid #e2e8f0;">Term</th><th style="padding:6px;border:1px solid #e2e8f0;">Academic Year</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="print-footer"><p>Student Admission Portal &copy; ${new Date().getFullYear()}</p></div>
  </body></html>`, `${name} - Attendance Records`, 900, 700);
};

async function viewStudentReportCard(studentId) {
  const student = searchCache.students.find(s => s.student_id === studentId);
  if (!student) { alert('Student not found.'); return; }
  
  // Fetch exams for this student's class
  const schoolId = await getCurrentSchoolId();
  if (!schoolId) { alert('Unable to determine your school. Please log out and log back in.'); return; }
  const { data: exams } = await supabaseClient.from('exams')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  
  if (!exams || exams.length === 0) {
    alert('No exams available for this student.');
    return;
  }

  // Build modal with exam selector
  let modal = getEl('deepSearchReportCardModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchReportCardModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:900px;">
        <div class="modal-header">
          <h3>📝 Examination Report Card</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchReportCardModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <label style="font-weight:600;">Select Exam:</label>
            <select id="deepSearchExamSelect" style="flex:1;min-width:200px;padding:0.5rem;border:1px solid var(--border);border-radius:8px;">
              ${exams.map(e => `<option value="${e.id}">${e.name} (${e.academic_year} - ${getTermDisplay(e.term)})</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="deepSearchLoadReport">📊 Load Report</button>
            <button class="btn btn-secondary btn-sm" id="deepSearchPrintReport">🖨️ Print</button>
          </div>
          <div id="deepSearchReportCardContent" style="max-height:600px;overflow-y:auto;"></div>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchReportCardModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';

  const examSelect = getEl('deepSearchExamSelect');
  const loadBtn = getEl('deepSearchLoadReport');
  const printBtn = getEl('deepSearchPrintReport');
  const content = getEl('deepSearchReportCardContent');

  const loadReport = async () => {
    const examId = examSelect.value;
    if (!examId) return;
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Loading report card...</div>';
    await renderReportCard(examId, studentId, content);
  };

  loadBtn.onclick = loadReport;
  printBtn.onclick = () => {
    const reportEl = content.querySelector('.rc-container');
    if (!reportEl) { alert('No report card to print. Load a report first.'); return; }
    const styles = collectStyles();
    openPrintWindow(`<html><head><title>Report Card</title><style>${styles}</style></head><body>${reportEl.outerHTML}</body></html>`, 'Report Card', 900, 700);
  };
  examSelect.onchange = loadReport;

  // Auto-load first exam
  await loadReport();
}

async function renderReportCard(examId, studentId, container) {
  try {
    const schoolId = await getCurrentSchoolId();
    if (!schoolId) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Unable to determine your school. Please log out and log back in.</p>'; return; }
    const { data: app } = await supabaseClient.from('applications').select('*').eq('student_id', studentId).eq('school_id', schoolId).maybeSingle();
    if (!app) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Student not found.</p>'; return; }
    const { data: exam } = await supabaseClient.from('exams').select('*').eq('id', examId).eq('school_id', schoolId).maybeSingle();
    if (!exam) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Exam not found.</p>'; return; }
    
    let examSubsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId).eq('school_id', schoolId);
    if (app.class_applying) examSubsQuery = examSubsQuery.eq('class_name', app.class_applying);
    const { data: examSubs } = await examSubsQuery;
    const subjects = (examSubs || []).map(s => s.subject);
    if (subjects.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No subjects configured for this exam.</p>'; return; }
    
    const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId).eq('student_id', studentId).eq('school_id', schoolId);
    const resultMap = new Map((results || []).map(r => [r.subject, r]));
    
    let settings = null;
    const settingsResult = await supabaseClient.from('settings')
      .select('*')
      .eq('id', 'singleton')
      .eq('school_id', schoolId)
      .maybeSingle();
    settings = settingsResult.data || settings;

    let schoolName = settings?.school_name || '';
    let schoolLogoUrl = '';
    if (!schoolName && schoolId) {
      const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
        .select('school_name, academic_year, current_term, logo_url')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettingsData) {
        schoolName = schoolSettingsData.school_name || '';
        schoolLogoUrl = schoolSettingsData.logo_url || '';
      }
    }
    if (!schoolName && schoolId) {
      const { data: schoolData } = await supabaseClient.from('schools').select('name, logo_url').eq('id', schoolId).maybeSingle();
      if (schoolData?.name) {
        schoolName = schoolData.name;
        schoolLogoUrl = schoolData.logo_url || '';
      }
    }
    schoolName = schoolName || 'My School';
    const schoolLogoHtml = schoolLogoUrl
      ? `<img src="${schoolLogoUrl}" alt="School Logo" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;" />`
      : '<div class="rc-seal">🏫</div>';
    
    const academicYear = exam.academic_year || '';
    const term = exam.term || '';
    const { data: studentDetails } = await supabaseClient.from('exam_student_details').select('*').eq('exam_id', examId).eq('student_id', studentId).eq('school_id', schoolId).maybeSingle();
    
    const yearForAtt = settings?.academic_year || exam.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const termForAtt = settings?.current_term || exam.term || 'First';
    let { data: attRecords } = await supabaseClient.from('attendance')
      .select('*')
      .eq('student_id', studentId)
      .eq('school_id', schoolId)
      .eq('academic_year', yearForAtt)
      .eq('term', termForAtt);
    if (!attRecords || attRecords.length === 0) {
      const fallbackYear = exam.academic_year;
      const fallbackTerm = exam.term;
      if (fallbackYear && (fallbackYear !== yearForAtt || fallbackTerm !== termForAtt)) {
        const { data: fallbackAtt } = await supabaseClient.from('attendance')
          .select('*')
          .eq('student_id', studentId)
          .eq('school_id', schoolId)
          .eq('academic_year', fallbackYear)
          .eq('term', fallbackTerm);
        if (fallbackAtt && fallbackAtt.length > 0) attRecords = fallbackAtt;
      }
    }
    const attStats = { present: 0, absent: 0, late: 0, excused: 0 };
    (attRecords || []).forEach(r => { attStats[r.status]++; });
    const attTotal = (attRecords || []).length;
    const attPct = attTotal > 0 ? ((attStats.present / attTotal) * 100).toFixed(1) : 'N/A';

    let total = 0, maxTotal = subjects.length * 100;
    const rows = subjects.map(sub => {
      const r = resultMap.get(sub);
      const marks = r ? (r.marks_obtained || 0) : 0;
      total += marks;
      const classScore = r ? (r.class_score || 0) : 0;
      const examScore = r ? (r.exam_score || 0) : 0;
      const grade = getSubjectGrade(marks);
      const perf = getPerformanceLevel(marks);
      return `<tr>
        <td class="rc-subject-name">${sub}</td>
        <td class="rc-score">${classScore.toFixed(1)}</td>
        <td class="rc-score">${examScore.toFixed(1)}</td>
        <td class="rc-total">${marks.toFixed(1)}</td>
        <td class="rc-grade-cell"><span class="rc-grade-badge ${grade.cls}">${grade.grade}</span></td>
        <td class="rc-remark"><span class="rc-perf-text ${perf.cls}">${perf.text}</span></td>
      </tr>`;
    }).join('');

    const avg = subjects.length > 0 ? (total / subjects.length).toFixed(1) : '0.0';
    const overallGrade = getGrade(parseFloat(avg));
    const overallPerf = getPerformanceLevel(parseFloat(avg));
    const teacherRemark = getTeacherRemarks(parseFloat(avg));
    const headRemark = getHeadTeacherRemarks(parseFloat(avg));
    const name = buildStudentName(app.first_name, app.middle_name, app.last_name);

    container.innerHTML = `
      <div class="rc-container" style="background:#fff;border-radius:12px;padding:1.5rem;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <div class="rc-header" style="display:flex;align-items:center;gap:1rem;border-bottom:2px solid #6366f1;padding-bottom:1rem;margin-bottom:1rem;">
          ${schoolLogoHtml}
          <div style="flex:1;text-align:center;">
            <h2 style="margin:0;font-size:1.4rem;color:#1e293b;">${schoolName}</h2>
            <p style="margin:0.25rem 0 0 0;color:#64748b;font-size:0.85rem;">${exam.name} · ${academicYear} · ${getTermDisplay(term)}</p>
          </div>
          <div class="rc-seal" style="font-size:2rem;">🏅</div>
        </div>
        <div class="rc-student-info" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.5rem;margin-bottom:1rem;">
          <div><strong>Name:</strong> ${name}</div>
          <div><strong>Student ID:</strong> ${app.student_id}</div>
          <div><strong>Class:</strong> ${app.class_applying}</div>
          <div><strong>Gender:</strong> ${app.gender || 'Male'}</div>
          <div><strong>Attendance:</strong> ${attPct}% (${attStats.present}/${attTotal})</div>
          <div><strong>Position:</strong> ${studentDetails?.position || '-'}</div>
        </div>
        <div style="overflow-x:auto;">
          <table class="rc-table" style="width:100%;border-collapse:collapse;margin-bottom:1rem;">
            <thead>
              <tr style="background:#6366f1;color:#fff;">
                <th style="padding:8px;text-align:left;">Subject</th>
                <th style="padding:8px;text-align:center;">Class Score</th>
                <th style="padding:8px;text-align:center;">Exam Score</th>
                <th style="padding:8px;text-align:center;">Total</th>
                <th style="padding:8px;text-align:center;">Grade</th>
                <th style="padding:8px;text-align:left;">Remark</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="rc-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.5rem;margin-bottom:1rem;">
          <div style="background:#f8fafc;border-radius:8px;padding:0.75rem;text-align:center;">
            <div style="font-size:0.75rem;color:#64748b;">Total Marks</div>
            <div style="font-size:1.2rem;font-weight:700;color:#1e293b;">${total.toFixed(1)} / ${maxTotal}</div>
          </div>
          <div style="background:#f8fafc;border-radius:8px;padding:0.75rem;text-align:center;">
            <div style="font-size:0.75rem;color:#64748b;">Average</div>
            <div style="font-size:1.2rem;font-weight:700;color:#1e293b;">${avg}%</div>
          </div>
          <div style="background:#f8fafc;border-radius:8px;padding:0.75rem;text-align:center;">
            <div style="font-size:0.75rem;color:#64748b;">Grade</div>
            <div style="font-size:1.2rem;font-weight:700;color:#6366f1;">${overallGrade.grade}</div>
          </div>
          <div style="background:#f8fafc;border-radius:8px;padding:0.75rem;text-align:center;">
            <div style="font-size:0.75rem;color:#64748b;">Performance</div>
            <div style="font-size:1.2rem;font-weight:700;color:#16a34a;">${overallPerf.text}</div>
          </div>
        </div>
        <div class="rc-remarks" style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div style="background:#f0fdf4;border-radius:8px;padding:0.75rem;">
            <strong style="color:#166534;">👨‍🏫 Teacher's Remark:</strong>
            <p style="margin:0.25rem 0 0 0;color:#166534;font-size:0.85rem;">${teacherRemark}</p>
          </div>
          <div style="background:#eff6ff;border-radius:8px;padding:0.75rem;">
            <strong style="color:#1e40af;">🏫 Head Teacher's Remark:</strong>
            <p style="margin:0.25rem 0 0 0;color:#1e40af;font-size:0.85rem;">${headRemark}</p>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Failed to render report card:', err);
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Error loading report card.</p>';
  }
}

// ================================================================
// Teacher Actions
// ================================================================

async function viewTeacherProfile(teacherId) {
  const teacher = searchCache.teachers.find(t => t.id === teacherId);
  if (!teacher) { alert('Teacher not found in search cache.'); return; }
  
  // Build and show a teacher profile modal directly from search cache data
  let modal = getEl('deepSearchTeacherModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchTeacherModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:700px;">
        <div class="modal-header">
          <h3 id="deepSearchTeacherModalName">Teacher Profile</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchTeacherModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body" id="deepSearchTeacherModalContent"></div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchTeacherModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  getEl('deepSearchTeacherModalName').textContent = teacher.full_name || 'Teacher';
  
  const photoHtml = teacher.photo_url
    ? `<img src="${teacher.photo_url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;display:block;margin:0 auto 1rem;" />`
    : '<div style="font-size:3rem;text-align:center;margin-bottom:1rem;">👨‍🏫</div>';

  const field = (label, val) => `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;

  getEl('deepSearchTeacherModalContent').innerHTML = `
    ${photoHtml}
    <div class="profile-detail">
      ${field('Full Name', teacher.full_name)}
      ${field('Staff ID', teacher.staff_id)}
      ${field('Registration ID', teacher.registration_id)}
      ${field('Email', teacher.email)}
      ${field('Phone', teacher.phone)}
      ${field('Class Taught', teacher.class_taught)}
      ${field('Subject', teacher.subject)}
      ${field('Qualification', teacher.qualification)}
      ${field('Gender', teacher.gender)}
      ${field('Date of Birth', formatDate(teacher.dob))}
      ${field('Nationality', teacher.nationality)}
      ${field('Religion', teacher.religion)}
      ${field('Home Town', teacher.home_town)}
      ${field('Status', teacher.is_active ? '✅ Active' : '❌ Inactive')}
    </div>
  `;

  modal.style.display = 'flex';
}

function printTeacherProfile(teacherId) {
  const teacher = searchCache.teachers.find(t => t.id === teacherId);
  if (!teacher) { alert('Teacher not found.'); return; }
  
  const photoHtml = teacher.photo_url
    ? `<img src="${teacher.photo_url}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;" />`
    : '<div style="font-size:3rem;">👨‍🏫</div>';

  const field = (label, val) => `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:200px;">${label}</td><td style="padding:6px;border:1px solid #e2e8f0;">${val || '-'}</td></tr>`;

  openPrintWindow(`<html><head><title>${teacher.full_name || 'Teacher'} - Teacher Profile</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 1.5rem; color: #1e293b; }
      .print-header { text-align: center; margin-bottom: 1.5rem; }
      .print-header h2 { font-size: 1.3rem; margin-bottom: 0.25rem; }
      .print-header p { color: #64748b; font-size: 0.85rem; }
      .profile-photo { text-align: center; margin-bottom: 1rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { border: 1px solid #e2e8f0; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
      th { background: #dbeafe; color: #1e293b; font-size: 0.75rem; text-transform: uppercase; }
      .print-footer { margin-top: 1.5rem; text-align: center; font-size: 0.75rem; color: #64748b; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>
    <div class="print-header">
      <h2>Teacher Profile</h2>
      <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    <div class="profile-photo">${photoHtml}</div>
    <h3 style="text-align:center;margin:0.5rem 0;">${teacher.full_name || 'Teacher'}</h3>
    <p style="text-align:center;color:#64748b;font-size:0.85rem;">${teacher.staff_id || teacher.registration_id || ''}</p>
    <table>
      <tr><th colspan="2">Personal Information</th></tr>
      ${field('Full Name', teacher.full_name)}
      ${field('Staff ID', teacher.staff_id)}
      ${field('Registration ID', teacher.registration_id)}
      ${field('Email', teacher.email)}
      ${field('Phone', teacher.phone)}
      ${field('Gender', teacher.gender)}
      ${field('Date of Birth', formatDate(teacher.dob))}
      ${field('Nationality', teacher.nationality)}
      ${field('Religion', teacher.religion)}
      ${field('Home Town', teacher.home_town)}
      <tr><th colspan="2">Academic Information</th></tr>
      ${field('Class Taught', teacher.class_taught)}
      ${field('Subject', teacher.subject)}
      ${field('Qualification', teacher.qualification)}
      ${field('Status', teacher.is_active ? 'Active' : 'Inactive')}
    </table>
    <div class="print-footer"><p>Student Admission Portal &copy; ${new Date().getFullYear()}</p></div>
  </body></html>`, `${teacher.full_name || 'Teacher'} - Teacher Profile`, 900, 700);
}

// ================================================================
// Accountant Actions
// ================================================================

async function viewAccountantProfile(accountantId) {
  const accountant = searchCache.accountants.find(a => a.id === accountantId);
  if (!accountant) { alert('Accountant not found.'); return; }

  // Build modal
  let modal = getEl('deepSearchAccountantModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'deepSearchAccountantModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:600px;">
        <div class="modal-header">
          <h3>🧾 Accountant Profile</h3>
          <button class="modal-close" onclick="document.getElementById('deepSearchAccountantModal').style.display='none'">✖</button>
        </div>
        <div class="modal-body" id="deepSearchAccountantContent"></div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'deepSearchAccountantModal') modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  const content = getEl('deepSearchAccountantContent');
  const field = (label, val) => `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;

  content.innerHTML = `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:3rem;">🧾</div>
      <h3 style="margin:0.5rem 0 0.25rem 0;">${accountant.full_name}</h3>
      <p style="color:var(--text-muted);font-size:0.85rem;">${accountant.registration_id || ''}</p>
    </div>
    <div class="profile-detail">
      ${field('Full Name', accountant.full_name)}
      ${field('Registration ID', accountant.registration_id)}
      ${field('Email', accountant.email)}
      ${field('Phone', accountant.phone)}
      ${field('Status', accountant.is_approved ? '✅ Approved' : '⏳ Pending Approval')}
      ${field('Registered', accountant.user_id ? '✅ Registered' : '🔗 Not Registered')}
      ${field('Created', formatDate(accountant.created_at))}
    </div>
  `;

  modal.style.display = 'flex';
}

// ================================================================
// Helpers
// ================================================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Expose refresh function for realtime updates
export function refreshSearchCache() {
  // CRITICAL SECURITY: Purge cached data immediately BEFORE reloading so
  // stale data from a previous user/school can never survive in memory.
  searchCache = {
    students: [],
    teachers: [],
    accountants: [],
    classes: [],
    subjects: [],
    parents: [],
    announcements: [],
    exams: []
  };
  searchLoaded = false;
  loadSearchData(true);
}
