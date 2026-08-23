/**
 * Admin Students Module - Student management, admit, edit, delete
 */

import { getEl, showMessage, clearMessage, setLoading, buildStudentName, formatDate, formatDateTime, statusBadge, portalBadge, uploadPhoto, previewFile, validateImageFile, logSubAdminActivity, getCurrentSchoolId, parseCSVLine, openPrintWindow, getCurrentAcademicYear } from './utils.js';
import { deleteCloudinaryFile, getCloudinaryPublicIdFromUrl } from './cloudinary.js';

let supabaseClient = null;
let allStudents = [];
// Tracks the school_id the cached `allStudents` array belongs to so we can
// detect when a different school signs in and force a reload. This prevents a
// previously signed-in school's students from appearing in another school's list.
let allStudentsSchoolId = null;

export function initAdminStudents(supabase) {
  supabaseClient = supabase;
}

// Expose loadAllStudents globally so realtime subscriptions can trigger it
window.loadAllStudents = loadAllStudents;

export function getAllStudents() { return allStudents; }
export function setAllStudents(data) { allStudents = data || []; }

// Reset the students cache (used on sign-out so stale data from a previous
// school can never leak into the next signed-in school's lists).
export function resetAdminStudentsCache() {
  allStudents = [];
  allStudentsSchoolId = null;
}
// Expose globally so auth.js can reset the cache on logout.
window.resetAdminStudentsCache = resetAdminStudentsCache;

// ================================================================
// Load All Students
// ================================================================

export async function loadAllStudents() {
  const schoolId = await getCurrentSchoolId();
  // CRITICAL SECURITY: Fail closed. Never fetch without a school_id filter.
  if (!schoolId) { allStudents = []; allStudentsSchoolId = null; renderAdminTable(); syncClassFilters(); return; }
  const { data, error } = await supabaseClient.from('applications')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Load students error:', error); return; }
  // CRITICAL SECURITY (defense in depth): even if RLS / the query ever
  // returned rows from another school, never render them here. Only keep
  // students that belong to the authenticated admin's own school.
  allStudents = (data || []).filter((s) => s.school_id === schoolId);
  allStudentsSchoolId = schoolId;
  renderAdminTable();
  syncClassFilters();
  // Refresh the animated dashboard cards if the admin dashboard is active
  if (typeof window.loadAdminDashboardHome === 'function') {
    const dashPage = document.getElementById('page-admin-dashboard');
    if (dashPage && dashPage.classList.contains('active-page')) {
      window.loadAdminDashboardHome();
    }
  }
}

// ================================================================
// Admin Dashboard - Load
// ================================================================

export async function loadAdminDashboard() {
  const welcomeEl = getEl('adminWelcome');
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', (await supabaseClient.auth.getUser()).data.user?.id).single();
  if (welcomeEl) welcomeEl.textContent = `Welcome back, ${profile?.full_name || 'Admin'}!`;
  const sidebarName = getEl('sidebarAdminName');
  if (sidebarName) sidebarName.textContent = profile?.full_name || 'Admin';
  await loadAllStudents();
}

// ================================================================
// Render Admin Table (Dashboard)
// ================================================================

function renderAdminTable() {
  const search = (getEl('adminSearch')?.value || '').toLowerCase();
  const classFilter = getEl('adminClassFilter')?.value || '';

  const filtered = allStudents.filter((s) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
    const matchesSearch = !search || name.includes(search) ||
      s.student_id?.toLowerCase().includes(search) ||
      s.parent_contact?.toLowerCase().includes(search);
    const matchesClass = !classFilter || s.class_applying === classFilter;
    return matchesSearch && matchesClass;
  });

  const tbody = getEl('adminStudentsBody');
  if (!tbody) return;

  const total = allStudents.length;
  const pending = allStudents.filter((s) => s.status === 'pending' || (s.status === 'admitted' && !s.portal_confirmed)).length;
  const admitted = allStudents.filter((s) => s.status === 'admitted').length;
  const confirmed = allStudents.filter((s) => s.portal_confirmed).length;
  const totalMale = allStudents.filter((s) => (s.gender || 'Male') === 'Male').length;
  const totalFemale = allStudents.filter((s) => (s.gender || 'Male') === 'Female').length;

  getEl('statTotal').textContent = total;
  getEl('statPending').textContent = pending;
  getEl('statAdmitted').textContent = admitted;
  getEl('statPortalConfirmed').textContent = confirmed;
  const statTotalMaleEl = getEl('statTotalMale');
  const statTotalFemaleEl = getEl('statTotalFemale');
  if (statTotalMaleEl) statTotalMaleEl.textContent = totalMale;
  if (statTotalFemaleEl) statTotalFemaleEl.textContent = totalFemale;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    const noEl = getEl('adminNoResults');
    if (noEl) noEl.style.display = 'block';
    return;
  }
  const noEl = getEl('adminNoResults');
  if (noEl) noEl.style.display = 'none';

  tbody.innerHTML = filtered.map((s) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
    const genderDisplay = s.gender || 'Male';
    const photoHtml = s.student_photo_url
      ? `<img src="${s.student_photo_url}" class="dash-photo" onclick="openStudentModal('${s.student_id}')" alt="click to view details" />`
      : '<span class="dash-photo-placeholder">📷</span>';
    const confirmBtn = s.portal_confirmed
      ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
      : `<button class="action-btn confirm" onclick="confirmPortal('${s.student_id}')">Confirm Portal</button>`;
    return `<tr>
      <td><strong>${s.student_id}</strong></td>
      <td>${photoHtml}</td>
      <td>${name}</td>
      <td>${genderDisplay}</td>
      <td>${s.class_applying}</td>
      <td>${s.parent_name}</td>
      <td>${s.parent_contact}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${portalBadge(s.portal_confirmed)}</td>
      <td>
        <button class="action-btn view" onclick="openStudentModal('${s.student_id}')">View Profile</button>
        <button class="action-btn confirm" onclick="editStudent('${s.student_id}')">Edit</button>
        ${confirmBtn}
        <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">🔑 Password</button>
        <button class="action-btn danger" onclick="deleteStudent('${s.student_id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  const tbody2 = getEl('adminStudentsBody2');
  if (tbody2) {
    renderAdminSubStudentsTable();
  }
}

// ================================================================
// Event Listeners for Dashboard Search/Filter
// ================================================================

export function setupStudentSearchListeners() {
  getEl('adminSearch')?.addEventListener('input', renderAdminTable);
  getEl('adminClassFilter')?.addEventListener('change', renderAdminTable);
  getEl('adminStudentsSearch')?.addEventListener('input', renderAdminTable);
  getEl('adminStudentsClassFilter')?.addEventListener('change', renderAdminTable);
}

// ================================================================
// Delete Student
// ================================================================

window.deleteStudent = async function (studentId) {
  if (!confirm(`⚠️ PERMANENT DELETION\n\nDelete student ${studentId} and ALL associated records?\n\nThis will permanently remove:\n• Student profile\n• Auth account (student will NOT be able to sign in)\n• Fee records (all terms)\n• Receipts\n• Payment transactions\n• Exam results\n• Attendance records\n• Parent links\n\nThis action CANNOT be undone.`)) return;
  const studentName = buildStudentName(
    allStudents.find(s => s.student_id === studentId)?.first_name,
    allStudents.find(s => s.student_id === studentId)?.middle_name,
    allStudents.find(s => s.student_id === studentId)?.last_name
  );
  try {
    // Use the atomic database function to delete everything in one transaction
    const { data, error } = await supabaseClient.rpc('delete_student_completely', {
      p_student_id: studentId
    });

    if (error) {
      // Fallback: if the RPC function doesn't exist yet, try the old manual method
      console.warn('RPC delete_student_completely not available, falling back to manual deletion:', error.message);
      
      const { data: app } = await supabaseClient.from('applications').select('user_id').eq('student_id', studentId).maybeSingle();
      const userId = app?.user_id;

      if (userId) {
        try {
          const { error: adminError } = await supabaseClient.rpc('delete_auth_user', { p_user_id: userId });
          if (adminError) {
            try {
              const { error: delUserError } = await supabaseClient.auth.admin.deleteUser(userId);
              if (delUserError) console.warn('Could not delete auth user (admin API):', delUserError.message);
            } catch (e) {
              console.warn('Could not delete auth user:', e.message);
            }
          }
        } catch (e) {
          console.warn('Error deleting auth user:', e.message);
        }
      }

      // Delete from all related tables manually
      const tablesToClean = [
        { table: 'attendance', column: 'student_id', value: studentId },
        { table: 'exam_student_details', column: 'student_id', value: studentId },
        { table: 'exam_results', column: 'student_id', value: studentId },
        { table: 'payment_transactions', column: 'student_id', value: studentId },
        { table: 'receipts', column: 'student_id', value: studentId },
        { table: 'fees', column: 'student_id', value: studentId },
        { table: 'parent_links', column: 'student_id', value: studentId },
      ];

      for (const { table, column, value } of tablesToClean) {
        const { error: delErr } = await supabaseClient.from(table).delete().eq(column, value);
        if (delErr) console.warn(`Warning cleaning ${table}:`, delErr.message);
      }

      const { error: appErr } = await supabaseClient.from('applications').delete().eq('student_id', studentId);
      if (appErr) console.warn('Warning cleaning applications:', appErr.message);

      if (userId) {
        const { error: profileErr } = await supabaseClient.from('profiles').delete().eq('id', userId);
        if (profileErr) console.warn('Warning cleaning profiles:', profileErr.message);
      }

      allStudents = allStudents.filter(s => s.student_id !== studentId);
      renderAdminTable();

      alert(`✅ Student ${studentId} and all associated records permanently deleted.\nThe student can no longer sign in.`);
      logSubAdminActivity(`Deleted student "${studentName || studentId}"`, 'student', `${studentId} - ${studentName || ''}`);
      return;
    }

    // Success using the atomic RPC function
    const result = data;
    const counts = result?.deleted_counts || {};
    
    allStudents = allStudents.filter(s => s.student_id !== studentId);
    renderAdminTable();

    let summary = `✅ Student ${studentId} (${result?.student_name || studentName || ''}) permanently deleted.\n`;
    summary += `The student can no longer sign in.\n\n`;
    summary += `📋 Records removed:\n`;
    summary += `  • Application: ${counts.applications || 0}\n`;
    summary += `  • Profile: ${counts.profiles || 0}\n`;
    summary += `  • Auth account: ${result?.auth_deleted ? 'Yes' : 'No'}\n`;
    summary += `  • Parent links: ${counts.parent_links || 0}\n`;
    summary += `  • Attendance: ${counts.attendance || 0}\n`;
    summary += `  • Exam results: ${counts.exam_results || 0}\n`;
    summary += `  • Exam details: ${counts.exam_student_details || 0}\n`;
    summary += `  • Fee records: ${counts.fees || 0}\n`;
    summary += `  • Payments: ${counts.payment_transactions || 0}\n`;
    summary += `  • Receipts: ${counts.receipts || 0}`;

    alert(summary);
    logSubAdminActivity(`Deleted student "${result?.student_name || studentName || studentId}"`, 'student', `${studentId} - ${result?.student_name || studentName || ''}`);
  } catch (err) { alert('Error: ' + err.message); }
};

// ================================================================
// Confirm Portal
// ================================================================

window.confirmPortal = async function (studentId) {
  try {
    const { error } = await supabaseClient.from('applications')
      .update({ 
        portal_confirmed: true,
        sub_admin_approved: true 
      })
      .eq('student_id', studentId);
    if (error) { alert('Error: ' + error.message); return; }
    await loadAllStudents();
    logSubAdminActivity(`Approved and confirmed portal for student "${studentId}"`, 'student', studentId);
  } catch (err) { alert('Error: ' + err.message); }
};

// ================================================================
// Replace Student Photo (double-click a photo in the Students table)
// ================================================================

// Holds the student id whose photo is about to be replaced. Set when the
// photo is double-clicked, then consumed by the hidden file picker's change
// handler once the admin has chosen a replacement image.
let pendingPhotoStudentId = null;

window.replaceStudentPhoto = function (studentId) {
  const student = allStudents.find((s) => s.student_id === studentId);
  if (!student) { alert('Student not found in cache.'); return; }
  pendingPhotoStudentId = studentId;
  const input = getEl('replaceStudentPhotoInput');
  if (input) input.click();
};

/**
 * Best-effort removal of a student's previous photo asset. Cloudinary assets
 * are deleted through the /api/cloudinary-delete serverless proxy; legacy
 * Supabase Storage assets are removed from the student-photos bucket. Failing
 * to delete the old file is harmless — the database record is already updated,
 * so the app never breaks.
 */
async function deleteStudentPhotoAsset(oldUrl) {
  if (!oldUrl) return;
  // Cloudinary asset → remove via the serverless proxy.
  try {
    const publicId = getCloudinaryPublicIdFromUrl(oldUrl);
    if (publicId) {
      await deleteCloudinaryFile(oldUrl);
      return;
    }
  } catch (e) { console.warn('Cloudinary photo delete skipped:', e.message); }
  // Legacy Supabase Storage asset → remove from the student-photos bucket.
  try {
    const marker = '/student-photos/';
    const idx = oldUrl.indexOf(marker);
    if (idx === -1) return;
    const storagePath = oldUrl.substring(idx + marker.length).split('?')[0];
    await supabaseClient.storage.from('student-photos').remove([storagePath]);
  } catch (e) { console.warn('Storage photo delete skipped:', e.message); }
}

/**
 * Update a student's photo to a newly uploaded file. Returns the new public
 * URL on success, or null when the upload / update failed.
 */
async function replaceStudentPhotoFromFile(studentId, file) {
  const student = allStudents.find((s) => s.student_id === studentId);
  const oldUrl = student?.student_photo_url || null;

  const newUrl = await uploadPhoto(supabaseClient, 'student-photos', file, studentId);
  if (!newUrl) return null;

  const schoolId = await getCurrentSchoolId();
  const { error } = await supabaseClient.from('applications')
    .update({ student_photo_url: newUrl })
    .eq('student_id', studentId)
    .eq('school_id', schoolId);
  if (error) {
    console.warn('Replace photo DB update failed:', error.message);
    return null;
  }

  // Clean up the old photo after the row has been updated (best-effort).
  await deleteStudentPhotoAsset(oldUrl);
  logSubAdminActivity(`Replaced photo for student "${studentId}"`, 'student', studentId);
  return newUrl;
}

// ================================================================
// Admit New Student
// ================================================================

export function setupAdmitForm() {
  // Photo preview - restricted to 500KB (0.5MB) maximum
  const MAX_PHOTO_SIZE_MB = 0.5;
  getEl('admitPhoto')?.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const validation = validateImageFile(file, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) { showMessage('admitMessage', validation.error, 'error'); this.value = ''; return; }
    previewFile(file, getEl('admitPhotoPreviewImg'), getEl('admitPhotoPlaceholder'), getEl('admitClearPhoto'), MAX_PHOTO_SIZE_MB);
  });

  getEl('admitClearPhoto')?.addEventListener('click', () => {
    getEl('admitPhoto').value = '';
    getEl('admitPhotoPreviewImg').src = '#';
    getEl('admitPhotoPreviewImg').style.display = 'none';
    getEl('admitPhotoPlaceholder').style.display = 'block';
    getEl('admitClearPhoto').style.display = 'none';
  });

  getEl('admitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('admitMessage');
    const btn = getEl('admitBtn');
    setLoading(btn, true, 'Admitting...');

    try {
      const { data: idData, error: idError } = await supabaseClient.rpc('generate_student_id');
      if (idError) throw new Error('ID generation failed: ' + idError.message);
      const studentId = idData;

      let photoUrl = null;
      const photoFile = getEl('admitPhoto').files[0];
      if (photoFile) {
        // Enforce 500KB (0.5MB) maximum photo size before upload
        const validation = validateImageFile(photoFile, MAX_PHOTO_SIZE_MB);
        if (!validation.valid) {
          showMessage('admitMessage', validation.error, 'error');
          getEl('admitPhoto').value = '';
          getEl('admitPhotoPreviewImg').style.display = 'none';
          getEl('admitPhotoPlaceholder').style.display = 'block';
          getEl('admitClearPhoto').style.display = 'none';
          return;
        }
        photoUrl = await uploadPhoto(supabaseClient, 'student-photos', photoFile, studentId);
      }

      const schoolId = await getCurrentSchoolId();
      // Automatically use the academic year derived from today's date.
      const academicYear = getCurrentAcademicYear();
      const currentTerm = getEl('admitTerm').value;

      const { error: insertError } = await supabaseClient.from('applications').insert([{
        student_id: studentId,
        first_name: getEl('admitFirstName').value.trim(),
        middle_name: getEl('admitMiddleName').value.trim() || null,
        last_name: getEl('admitLastName').value.trim(),
        class_applying: getEl('admitClass').value,
        term: currentTerm,
        teacher: getEl('admitTeacher').value.trim() || null,
        previous_school: getEl('admitPrevSchool').value.trim() || null,
        admission_date: getEl('admitDate').value,
        date_of_birth: getEl('admitDOB').value,
        parent_name: getEl('admitParentName').value.trim(),
        parent_contact: getEl('admitParentContact').value.trim(),
        home_town: getEl('admitHomeTown').value.trim() || null,
        place_of_stay: getEl('admitPlaceOfStay').value.trim() || null,
        gender: getEl('admitGender').value,
        religion: getEl('admitReligion').value,
        student_photo_url: photoUrl,
        status: 'admitted',
        portal_confirmed: false,
      }]);

      if (insertError) throw new Error('Insert failed: ' + insertError.message);

      // Look up fee structure for this class, current academic year, and the selected term
      // so the correct term fee for that year is applied to the newly admitted student.
      const { data: classFee } = await supabaseClient.from('class_fees')
        .select('fee_amount, academic_year')
        .eq('class_name', getEl('admitClass').value)
        .eq('academic_year', academicYear)
        .eq('term', currentTerm)
        .maybeSingle();
      
      const feeYear = classFee?.academic_year || academicYear;
      const totalAmount = classFee?.fee_amount || 0;
      
      await supabaseClient.from('fees').upsert([{
        student_id: studentId,
        academic_year: feeYear,
        term: currentTerm,
        total_amount: totalAmount,
        amount_paid: 0,
        debt: 0,
        payment_status: totalAmount > 0 ? 'unpaid' : 'paid',
        last_payment_date: null,
        school_id: schoolId,
      }], { onConflict: 'student_id,academic_year,term' });

      showMessage('admitMessage', `✅ Student admitted! <strong>ID: ${studentId}</strong>`, 'success');
      logSubAdminActivity(`Admitted student "${buildStudentName(getEl('admitFirstName').value.trim(), getEl('admitMiddleName').value.trim(), getEl('admitLastName').value.trim())}"`, 'student', `${studentId}`);
      getEl('admitForm').reset();
      getEl('admitPhotoPreviewImg').style.display = 'none';
      getEl('admitPhotoPlaceholder').style.display = 'block';
      getEl('admitClearPhoto').style.display = 'none';
      await loadAllStudents();
    } catch (err) {
      showMessage('admitMessage', err.message, 'error');
    } finally {
      setLoading(btn, false, '✅ Admit Student & Generate ID');
    }
  });
}

// ================================================================
// Ensure Admit Class Dropdown
// ================================================================

export async function ensureAdmitClassDropdown() {
  const admitClassSelect = getEl('admitClass');
  if (!admitClassSelect) return;
  if (admitClassSelect.options.length > 1) return;
  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: classes, error } = await query;
    if (error) throw error;
    if (classes && classes.length > 0) {
      admitClassSelect.innerHTML = '<option value="">— Select —</option>' + classes.map((c) => `<option>${c.name}</option>`).join('');
    }
  } catch (err) { console.error('Failed to load classes for admit form:', err); }
}

// ================================================================
// Render Admin Sub Students Table (sidebar view)
// ================================================================

export async function renderAdminSubStudentsTable() {
  // Reload whenever the cached students don't belong to the current school
  // (e.g. after signing out of one school and into another). Otherwise a
  // stale list from the previous school would be shown here.
  const currentSchoolId = await getCurrentSchoolId();
  if (allStudentsSchoolId !== currentSchoolId) { await loadAllStudents(); }
  const searchEl = getEl('adminStudentsSearch');
  const classEl = getEl('adminStudentsClassFilter');
  const genderEl = getEl('adminStudentsGenderFilter');
  const tbody = getEl('adminStudentsBody2');
  const noResults = getEl('adminNoResults2');
  const welcomeEl = getEl('adminStudentsWelcome');
  const { data: profile } = await supabaseClient.from('profiles').select('full_name').eq('id', (await supabaseClient.auth.getUser()).data.user?.id).single();
  if (welcomeEl) welcomeEl.textContent = profile?.full_name ? `Managed by ${profile.full_name}` : '';
  let data = [...allStudents];
  if (searchEl) {
    const q = searchEl.value.toLowerCase();
    data = data.filter((s) => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
      return name.includes(q) || s.student_id?.toLowerCase().includes(q) || s.parent_contact?.toLowerCase().includes(q);
    });
  }
  if (classEl && classEl.value) data = data.filter((s) => s.class_applying === classEl.value);
  if (genderEl && genderEl.value) data = data.filter((s) => (s.gender || 'Male') === genderEl.value);
  if (!tbody) return;
  if (data.length === 0) { tbody.innerHTML = ''; if (noResults) noResults.style.display = 'block'; return; }
  if (noResults) noResults.style.display = 'none';

  const displayData = data.slice(0, 5);
  const hasMore = data.length > 5;

  tbody.innerHTML = displayData.map((s) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
    const genderDisplay = s.gender || 'Male';
    const photoHtml = s.student_photo_url
      ? `<img src="${s.student_photo_url}" class="dash-photo" ondblclick="replaceStudentPhoto('${s.student_id}')" alt="Student photo" title="Double-click to replace photo" />`
      : `<span class="dash-photo-placeholder" ondblclick="replaceStudentPhoto('${s.student_id}')" title="Double-click to add photo">📷</span>`;
    const confirmBtn = s.portal_confirmed
      ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
      : `<button class="action-btn confirm" onclick="confirmPortal('${s.student_id}')">Confirm Portal</button>`;
    return `<tr>
      <td><strong>${s.student_id}</strong></td>
      <td>${photoHtml}</td>
      <td>${name}</td>
      <td>${genderDisplay}</td>
      <td>${s.class_applying}</td>
      <td>${s.parent_name}</td>
      <td>${s.parent_contact}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${portalBadge(s.portal_confirmed)}</td>
      <td>
        <button class="action-btn view" onclick="openStudentModal('${s.student_id}')">View Profile</button>
        <button class="action-btn confirm" onclick="editStudent('${s.student_id}')">Edit</button>
        ${confirmBtn}
        <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">🔑 Password</button>
        <button class="action-btn danger" onclick="deleteStudent('${s.student_id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  if (hasMore) {
    const showMoreRow = document.createElement('tr');
    showMoreRow.className = 'show-more-row';
    showMoreRow.innerHTML = `<td colspan="10">🔽 Show all ${data.length} students</td>`;
    showMoreRow.addEventListener('click', () => {
      tbody.innerHTML = data.map((s) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
        const genderDisplay = s.gender || 'Male';
        const photoHtml = s.student_photo_url
          ? `<img src="${s.student_photo_url}" class="dash-photo" ondblclick="replaceStudentPhoto('${s.student_id}')" alt="Student photo" title="Double-click to replace photo" />`
          : `<span class="dash-photo-placeholder" ondblclick="replaceStudentPhoto('${s.student_id}')" title="Double-click to add photo">📷</span>`;
        const confirmBtn = s.portal_confirmed
          ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
          : `<button class="action-btn confirm" onclick="confirmPortal('${s.student_id}')">Confirm Portal</button>`;
        return `<tr>
          <td><strong>${s.student_id}</strong></td>
          <td>${photoHtml}</td>
          <td>${name}</td>
          <td>${genderDisplay}</td>
          <td>${s.class_applying}</td>
          <td>${s.parent_name}</td>
          <td>${s.parent_contact}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${portalBadge(s.portal_confirmed)}</td>
          <td>
            <button class="action-btn view" onclick="openStudentModal('${s.student_id}')">View Profile</button>
            <button class="action-btn confirm" onclick="editStudent('${s.student_id}')">Edit</button>
            ${confirmBtn}
            <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">🔑 Password</button>
            <button class="action-btn danger" onclick="deleteStudent('${s.student_id}')">Delete</button>
          </td>
        </tr>`;
      }).join('');
    });
    tbody.appendChild(showMoreRow);
  }
}

// ================================================================
// Sync Class Filters
// ================================================================

function syncClassFilters() {
  const classes = Array.from(new Set(allStudents.map((s) => s.class_applying).filter(Boolean))).sort();
  const opts = ['<option value="">All Classes</option>', ...classes.map((c) => `<option>${c}</option>`)].join('');
  const studentSub = getEl('adminStudentsClassFilter');
  if (studentSub) studentSub.innerHTML = opts;
  const adminClassFilter = getEl('adminClassFilter');
  if (adminClassFilter) adminClassFilter.innerHTML = opts;
}

// ================================================================
// Edit Student
// ================================================================

export function setupEditStudent() {
  // Photo preview - restricted to 500KB (0.5MB) maximum
  const MAX_PHOTO_SIZE_MB = 0.5;
  
  // Standard edit photo (Students page)
  getEl('editPhoto')?.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const validation = validateImageFile(file, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) { alert(validation.error); this.value = ''; return; }
    previewFile(file, getEl('editPhotoPreviewImg'), null, getEl('editClearPhoto'), MAX_PHOTO_SIZE_MB);
    getEl('editPhotoPlaceholder').textContent = 'New photo selected';
  });

  // Dashboard edit photo
  getEl('editPhotoDash')?.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const validation = validateImageFile(file, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) { alert(validation.error); this.value = ''; return; }
    previewFile(file, getEl('editPhotoPreviewImgDash'), null, getEl('editClearPhotoDash'), MAX_PHOTO_SIZE_MB);
    getEl('editPhotoPlaceholderDash').textContent = 'New photo selected';
  });

  getEl('editClearPhoto')?.addEventListener('click', () => {
    getEl('editPhoto').value = '';
    getEl('editPhotoPreviewImg').src = '#';
    getEl('editPhotoPreviewImg').style.display = 'none';
    getEl('editPhotoPlaceholder').textContent = 'Current photo will be kept';
    getEl('editClearPhoto').style.display = 'none';
  });

  getEl('editClearPhotoDash')?.addEventListener('click', () => {
    getEl('editPhotoDash').value = '';
    getEl('editPhotoPreviewImgDash').src = '#';
    getEl('editPhotoPreviewImgDash').style.display = 'none';
    getEl('editPhotoPlaceholderDash').textContent = 'Current photo will be kept';
    getEl('editClearPhotoDash').style.display = 'none';
  });

  // Dashboard edit form uses Dash-suffixed IDs, students page uses standard IDs
  ['editStudentForm', 'editStudentFormStudents'].forEach((formId) => {
    const form = getEl(formId);
    if (!form) return;
    const isDash = formId === 'editStudentForm';
    const msgId = isDash ? 'editStudentMessageDash' : 'editStudentMessage';
    const idSuffix = isDash ? 'Dash' : '';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage(msgId);
      const btn = form.querySelector('button[type="submit"]');
      setLoading(btn, true, 'Saving...');

      const studentId = form.querySelector('#editStudentId').value;
      const payload = {
        first_name: form.querySelector('#editFirstName').value.trim(),
        middle_name: form.querySelector('#editMiddleName').value.trim() || null,
        last_name: form.querySelector('#editLastName').value.trim(),
        class_applying: form.querySelector('#editClass').value,
        term: form.querySelector('#editTerm').value,
        date_of_birth: form.querySelector('#editDOB').value,
        parent_name: form.querySelector('#editParentName').value.trim(),
        parent_contact: form.querySelector('#editParentContact').value.trim(),
        home_town: form.querySelector('#editHomeTown').value.trim() || null,
        place_of_stay: form.querySelector('#editPlaceOfStay').value.trim() || null,
        gender: form.querySelector('#editGender').value,
        religion: form.querySelector('#editReligion').value,
        teacher: form.querySelector('#editTeacher').value.trim() || null,
        admission_date: form.querySelector('#editAdmissionDate').value,
        school_id: await getCurrentSchoolId(),
      };

      const editPhotoFile = form.querySelector('#editPhoto' + idSuffix).files[0];
      if (editPhotoFile) {
        // Enforce 500KB (0.5MB) maximum photo size before upload
        const validation = validateImageFile(editPhotoFile, MAX_PHOTO_SIZE_MB);
        if (!validation.valid) {
          showMessage(msgId, validation.error, 'error');
          form.querySelector('#editPhoto' + idSuffix).value = '';
          setLoading(btn, false, 'Update Student');
          return;
        }
        const photoUrl = await uploadPhoto(supabaseClient, 'student-photos', editPhotoFile, studentId);
        if (photoUrl) payload.student_photo_url = photoUrl;
      }

      try {
        const { error } = await supabaseClient.from('applications').update(payload).eq('student_id', studentId);
        if (error) throw error;
        showMessage('editStudentMessage', '✅ Student updated.', 'success');
        logSubAdminActivity(`Updated student "${studentId}"`, 'student', studentId);
        await loadAllStudents();
        // Close whichever edit section is open
        const dashEdit = getEl('editStudentSection');
        if (dashEdit) { dashEdit.style.display = 'none'; dashEdit.open = false; }
        const studentsEdit = getEl('editStudentSectionStudents');
        if (studentsEdit) { studentsEdit.style.display = 'none'; studentsEdit.open = false; }
      } catch (err) { showMessage('editStudentMessage', 'Error: ' + err.message, 'error'); }
      finally { setLoading(btn, false, 'Update Student'); }
    });
  });

  // Double-click photo replacement (Students module table). The hidden file
  // picker #replaceStudentPhotoInput is opened by window.replaceStudentPhoto.
  getEl('replaceStudentPhotoInput')?.addEventListener('change', async function () {
    const file = this.files[0];
    const studentId = pendingPhotoStudentId;
    pendingPhotoStudentId = null;
    if (!file || !studentId) { this.value = ''; return; }

    const validation = validateImageFile(file, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) { alert(validation.error); this.value = ''; return; }

    try {
      const newUrl = await replaceStudentPhotoFromFile(studentId, file);
      if (newUrl) {
        showMessage('editStudentMessage', '✅ Student photo updated.', 'success');
        await loadAllStudents();
      } else {
        alert('❌ Photo upload failed. Please try again.');
      }
    } catch (err) {
      console.error('Replace photo error:', err);
      alert('❌ Could not update photo: ' + err.message);
    } finally {
      this.value = '';
    }
  });
}

window.editStudent = async function (studentId) {
  const student = allStudents.find((s) => s.student_id === studentId);
  if (!student) { alert('Student not found in cache.'); return; }

  // Determine if we're on the Students tab page or the main dashboard
  const isStudentsPage = getEl('page-admin-students')?.classList.contains('active-page');
  const sectionId = isStudentsPage ? 'editStudentSectionStudents' : 'editStudentSection';
  const otherSectionId = isStudentsPage ? 'editStudentSection' : 'editStudentSectionStudents';

  // Get the active edit section
  const editSection = getEl(sectionId);
  if (!editSection) return;

  // Show this section, hide the other
  editSection.style.display = 'block';
  editSection.open = true;
  const otherSection = getEl(otherSectionId);
  if (otherSection) { otherSection.style.display = 'none'; otherSection.open = false; }

  // Determine which ID suffix to use based on the section
  const idSuffix = isStudentsPage ? '' : 'Dash';

  // Populate fields within the active section using querySelector
  const setField = (id, value) => {
    const el = editSection.querySelector('#' + id + idSuffix);
    if (el) el.value = value;
  };

  setField('editStudentId', student.student_id);
  setField('editFirstName', student.first_name || '');
  setField('editMiddleName', student.middle_name || '');
  setField('editLastName', student.last_name || '');
  setField('editClass', student.class_applying || '');
  setField('editTerm', student.term || 'First');
  setField('editDOB', student.date_of_birth || '');
  setField('editParentName', student.parent_name || '');
  setField('editParentContact', student.parent_contact || '');
  setField('editHomeTown', student.home_town || '');
  setField('editPlaceOfStay', student.place_of_stay || '');
  setField('editReligion', student.religion || 'Christian');
  setField('editGender', student.gender || 'Male');
  setField('editTeacher', student.teacher || '');
  setField('editAdmissionDate', student.admission_date || '');

  // Populate class dropdown in the active section
  const editClassSelect = editSection.querySelector('#editClass' + idSuffix);
  if (editClassSelect) {
    try {
      const schoolId = await getCurrentSchoolId();
      let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
      if (schoolId) query = query.eq('school_id', schoolId);
      const { data: classes } = await query;
      if (classes && classes.length > 0) editClassSelect.innerHTML = '<option value="">— Select —</option>' + classes.map((c) => `<option>${c.name}</option>`).join('');
      setField('editClass', student.class_applying || '');
    } catch (err) { console.error('Failed to load classes for edit form:', err); }
  }

  // Handle photo preview within the active section
  const editPhotoImg = editSection.querySelector('#editPhotoPreviewImg' + idSuffix);
  const editPhotoPlaceholder = editSection.querySelector('#editPhotoPlaceholder' + idSuffix);
  const editClearBtn = editSection.querySelector('#editClearPhoto' + idSuffix);
  const editPhotoInput = editSection.querySelector('#editPhoto' + idSuffix);
  if (student.student_photo_url) {
    editPhotoImg.src = student.student_photo_url;
    editPhotoImg.style.display = 'block';
    if (editPhotoPlaceholder) editPhotoPlaceholder.textContent = '';
    if (editClearBtn) editClearBtn.style.display = 'inline-block';
  } else {
    editPhotoImg.src = '#';
    editPhotoImg.style.display = 'none';
    if (editPhotoPlaceholder) editPhotoPlaceholder.textContent = 'No photo';
    if (editClearBtn) editClearBtn.style.display = 'none';
  }
  if (editPhotoInput) editPhotoInput.value = '';
};

// ================================================================
// Student Modal
// ================================================================

window.closeStudentModal = function () {
  const modal = getEl('studentDetailModal');
  if (modal) modal.style.display = 'none';
};

window.openStudentModal = function (studentId) {
  const student = allStudents.find((s) => s.student_id === studentId);
  if (!student) return;
  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
  getEl('modalStudentName').textContent = name;

  const photoHtml = student.student_photo_url
    ? `<div style="text-align:center;margin-bottom:1rem;"><img src="${student.student_photo_url}" class="student-profile-photo" alt="Student photo" /></div>`
    : '<div style="display:flex;justify-content:center;margin-bottom:1rem;"><span class="student-profile-photo-placeholder">🎓</span></div>';

  const section = (title, items) => `
    <h4 style="grid-column:1/-1;margin:0.6rem 0 0.2rem;color:var(--primary);font-size:0.85rem;letter-spacing:0.3px;">${title}</h4>
    ${items.join('')}`;
  const field = (label, val) =>
    `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;

  getEl('modalStudentContent').innerHTML = `
    ${photoHtml}
    <div style="text-align:center;margin-bottom:1rem;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="printStudentProfileModal('${student.student_id}')">🖨️ Print Profile</button>
    </div>
    <div class="profile-detail">
      ${section('👤 Personal Information', [
        field('Full Name', name),
        field('Gender', student.gender || 'Male'),
        field('Date of Birth', formatDate(student.date_of_birth)),
        field('Religion', student.religion),
        field('Home Town', student.home_town),
        field('Place of Stay', student.place_of_stay),
      ])}
      ${section('🎓 Academic Information', [
        field('Student ID', student.student_id),
        field('Class', student.class_applying),
        field('Term', student.term),
        field('Teacher', student.teacher),
        field('Previous School', student.previous_school),
        field('Admission Date', formatDate(student.admission_date)),
        field('Application Date', formatDateTime(student.created_at)),
      ])}
      ${section('👪 Guardian Information', [
        field('Parent / Guardian', student.parent_name),
        field('Parent Contact', student.parent_contact),
      ])}
      ${section('📌 Status & Portal', [
        field('Admission Status', statusBadge(student.status)),
        field('Portal Confirmed', student.portal_confirmed ? '✅ Yes' : '❌ No'),
        field('Sub-Admin Approved', student.sub_admin_approved ? '✅ Yes' : '❌ No'),
      ])}
    </div>`;
  getEl('studentDetailModal').style.display = 'flex';
};
window.printStudentProfileModal = function (studentId) {
  const student = allStudents.find((s) => s.student_id === studentId);
  if (!student) { alert('Student not found in cache.'); return; }
  const name = buildStudentName(student.first_name, student.middle_name, student.last_name);

  const photoHtml = student.student_photo_url
    ? `<img src="${student.student_photo_url}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;" />`
    : '<div style="font-size:3rem;text-align:center;">🎓</div>';

  const field = (label, val) => `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:200px;">${label}</td><td style="padding:6px;border:1px solid #e2e8f0;">${val || '-'}</td></tr>`;

  openPrintWindow(`<html><head><title>${name} - Student Profile</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 1.5rem; color: #1e293b; }
      .print-header { text-align: center; margin-bottom: 1.5rem; }
      .print-header h2 { font-size: 1.3rem; margin-bottom: 0.25rem; }
      .print-header p { color: #64748b; font-size: 0.85rem; }
      .profile-photo { text-align: center; margin-bottom: 1rem; }
      h3 { text-align: center; margin: 0.5rem 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { border: 1px solid #e2e8f0; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
      th { background: #dbeafe; color: #1e293b; font-size: 0.8rem; text-transform: uppercase; }
      .print-footer { margin-top: 1.5rem; text-align: center; font-size: 0.75rem; color: #64748b; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>
    <div class="print-header">
      <h2>Student Profile</h2>
      <p>Generated: ${new Date().toLocaleString()}</p>
    </div>
    <div class="profile-photo">${photoHtml}</div>
    <h3>${name}</h3>
    <p style="text-align:center;color:#64748b;font-size:0.85rem;margin-top:0;">${student.student_id}</p>
    <table>
      <tr><th colspan="2">👤 Personal Information</th></tr>
      ${field('Student ID', student.student_id)}
      ${field('Full Name', name)}
      ${field('Gender', student.gender || 'Male')}
      ${field('Date of Birth', formatDate(student.date_of_birth))}
      ${field('Religion', student.religion)}
      ${field('Home Town', student.home_town)}
      ${field('Place of Stay', student.place_of_stay)}
      <tr><th colspan="2">🎓 Academic Information</th></tr>
      ${field('Class', student.class_applying)}
      ${field('Term', student.term)}
      ${field('Teacher', student.teacher)}
      ${field('Previous School', student.previous_school)}
      ${field('Admission Date', formatDate(student.admission_date))}
      ${field('Application Date', formatDateTime(student.created_at))}
      <tr><th colspan="2">👪 Guardian Information</th></tr>
      ${field('Parent / Guardian', student.parent_name)}
      ${field('Parent Contact', student.parent_contact)}
      <tr><th colspan="2">📌 Status & Portal</th></tr>
      ${field('Admission Status', student.status)}
      ${field('Portal Confirmed', student.portal_confirmed ? '✅ Yes' : '❌ No')}
      ${field('Sub-Admin Approved', student.sub_admin_approved ? '✅ Yes' : '❌ No')}
    </table>
    <div class="print-footer"><p>Student Admission Portal &copy; ${new Date().getFullYear()}</p></div>
  </body></html>`, `${name} - Student Profile`, 900, 700);
};

getEl('studentDetailModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'studentDetailModal') closeStudentModal();
});

// ================================================================
// Print Class List helpers
// ================================================================

/**
 * Downscale an already-loaded image to a small JPEG data URL. Keeping the
 * raster small keeps the generated PDF small and fast on mobile devices.
 * Returns null if the image cannot be read (e.g. tainted canvas).
 */
function downscalePhotoToDataUrl(img, maxSize) {
  const max = maxSize || 160;
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const scale = Math.min(1, max / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    return null; // tainted canvas / unsupported — caller falls back to placeholder
  }
}

/**
 * Fetch a remote (cross-origin) image and convert it to a same-origin JPEG
 * data URL so it can be embedded in the html2canvas-generated PDF without
 * tainting the canvas (a tainted canvas makes mobile PDF generation throw a
 * SecurityError / fail mid-generation). Returns null on any failure so the
 * caller can gracefully fall back to a placeholder instead of aborting the
 * whole class-list PDF.
 */
async function photoToDataUrl(url, maxSize) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    if (!blob || !blob.size) return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = objectUrl;
      });
      return downscalePhotoToDataUrl(img, maxSize);
    } finally {
      try { URL.revokeObjectURL(objectUrl); } catch (e) { /* noop */ }
    }
  } catch (e) {
    return null;
  }
}

// ================================================================
// Print Class List - Mobile-optimized direct print (no modal preview)
// ================================================================

export function setupPrintClassList() {
  getEl('btnPrintPreview')?.addEventListener('click', printClassListDirect);
}

/**
 * Print class list directly using openPrintWindow.
 * On mobile this opens a native-style options sheet (Print / Save-as-PDF)
 * backed by the platform's own print preview dialog; on desktop it uses
 * iframe-based printing. No custom in-app preview panel is rendered.
 */
async function printClassListDirect() {
  const searchEl = getEl('adminStudentsSearch');
  const classEl = getEl('adminStudentsClassFilter');
  const genderEl = getEl('adminStudentsGenderFilter');
  const searchQ = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const classVal = classEl ? classEl.value : '';
  const genderVal = genderEl ? genderEl.value : '';
  
  let data = [...allStudents];
  if (searchQ) data = data.filter((s) => { 
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase(); 
    return name.includes(searchQ) || s.student_id?.toLowerCase().includes(searchQ) || s.parent_contact?.toLowerCase().includes(searchQ); 
  });
  if (classVal) data = data.filter((s) => s.class_applying === classVal);
  if (genderVal) data = data.filter((s) => (s.gender || 'Male') === genderVal);
  
  if (data.length === 0) { 
    alert('No students match the current filters.'); 
    return; 
  }
  
  // Fetch school name with fallbacks
  let schoolName = 'My School';
  try {
    const schoolId = await getCurrentSchoolId();
    let settingsQuery = supabaseClient.from('settings').select('school_name').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const { data: settingsData } = await settingsQuery.maybeSingle();
    if (settingsData?.school_name) {
      schoolName = settingsData.school_name;
    } else if (schoolId) {
      const { data: schoolData } = await supabaseClient.from('schools').select('name').eq('id', schoolId).maybeSingle();
      if (schoolData?.name) schoolName = schoolData.name;
    }
  } catch (e) { /* keep fallback school name */ }
  
  // Convert each student's photo to a same-origin data URL BEFORE building the
  // document. Remote (Supabase storage) images would otherwise taint the canvas
  // that html2canvas uses to generate the mobile PDF, which makes generation
  // fail (SecurityError / tainted canvas) or time out while images load.
  // Data URLs are same-origin, so the PDF always renders. Photos that can't be
  // fetched are replaced with a placeholder so a single bad image can never
  // break the whole list. Batched to avoid hammering the server with one huge
  // burst of simultaneous fetches on large classes.
  const photoUrls = new Array(data.length).fill(null);
  const PHOTO_BATCH = 6;
  for (let start = 0; start < data.length; start += PHOTO_BATCH) {
    const batch = data.slice(start, start + PHOTO_BATCH);
    const converted = await Promise.all(
      batch.map((s) => photoToDataUrl(s.student_photo_url, 160))
    );
    for (let k = 0; k < converted.length; k++) photoUrls[start + k] = converted[k];
  }

  const rows = data.map((s, idx) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
    const photo = photoUrls[idx];
    const photoHtml = photo
      ? `<img src="${photo}" class="print-photo" alt="Photo" />`
      : '<span class="print-no-photo">📷</span>';
    return `<tr><td style="text-align:center;">${idx + 1}</td><td>${photoHtml}</td><td><strong>${s.student_id}</strong></td><td>${name}</td><td>${formatDate(s.date_of_birth)}</td><td>${s.parent_contact || '-'}</td></tr>`;
  }).join('');
  
  const classFilterText = classVal || 'All Classes';
  const genderFilterText = genderVal || 'All Genders';
  
  const printHtml = `<html><head><title>Class List - ${schoolName}</title><style>body{padding:1.5rem;font-family:'Segoe UI',sans-serif;} @page{size:A4;margin:12mm 10mm;} .print-header{text-align:center;margin-bottom:1.5rem;} .print-header h2{font-size:1.3rem;margin-bottom:0.25rem;color:#1e293b;} .print-header p{color:#64748b;font-size:0.85rem;} .print-table{width:100%;border-collapse:collapse;margin-top:1rem;} .print-table th,.print-table td{border:1px solid #e2e8f0;padding:0.5rem;text-align:left;font-size:0.85rem;} .print-table th{background:#dbeafe;color:#1e293b;font-size:0.75rem;text-transform:uppercase;} .print-photo{width:48px;height:48px;object-fit:cover;border-radius:50%;border:1px solid #e2e8f0;} .print-no-photo{width:48px;height:48px;border-radius:50%;background:#f0f4f8;border:2px dashed #e2e8f0;display:inline-flex;align-items:center;justify-content:center;font-size:1rem;} .print-footer{margin-top:1.5rem;text-align:center;font-size:0.75rem;color:#64748b;} @media print{body{padding:0;margin:0;} .no-print,.btn,.action-btn{display:none!important;} table{page-break-inside:auto;} tr{page-break-inside:avoid;}}</style></head><body><div class="print-header"><h2>${schoolName}</h2><h3>Class List — ${classFilterText}</h3><p>Gender: ${genderFilterText} &nbsp;|&nbsp; Total Students: ${data.length} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p></div><table class="print-table"><thead><tr><th style="width:60px;text-align:center;">#</th><th style="width:70px;">Photo</th><th>Student ID</th><th>Name</th><th>Date of Birth</th><th>Parent Contact</th></tr></thead><tbody>${rows}</tbody></table><div class="print-footer"><p>${schoolName} &copy; ${new Date().getFullYear()}</p></div></body></html>`;
  
  openPrintWindow(printHtml, `Class List - ${schoolName}`, 900, 700);
}

// ================================================================
// Promote Class
// ================================================================

export function setupPromoteClass() {
  getEl('btnPromoteClass')?.addEventListener('click', async () => {
    const classFilter = getEl('adminStudentsClassFilter');
    const selectedClass = classFilter?.value;
    if (!selectedClass) { alert('Please select a class to promote.'); return; }
    if (!confirm(`Promote all students from ${selectedClass} to the next class?\n\nThis will:\n1. Move students to the next class\n2. Keep their existing fee balances intact\n\nNo new fee records will be created. Fee records for the new class will be generated when the fee structure is set via "Set / Update Class Fee".`)) return;
    try {
      const schoolIdForPromote = await getCurrentSchoolId();
      let classQuery = supabaseClient
        .from('classes').select('name, level').order('level', { ascending: true }).order('name', { ascending: true });
      if (schoolIdForPromote) classQuery = classQuery.eq('school_id', schoolIdForPromote);
      const { data: classes, error: classesError } = await classQuery;
      if (classesError) throw classesError;
      const currentIndex = classes.findIndex(c => c.name === selectedClass);
      if (currentIndex === -1) { alert('Selected class not found in classes list.'); return; }
      const nextClass = classes[currentIndex + 1];
      if (!nextClass) { alert(`No next class available after ${selectedClass}.`); return; }

      let studentsQuery = supabaseClient.from('applications').select('student_id').eq('class_applying', selectedClass);
      if (schoolIdForPromote) studentsQuery = studentsQuery.eq('school_id', schoolIdForPromote);
      const { data: students } = await studentsQuery;
      if (!students || students.length === 0) { alert('No students found in this class.'); return; }

      let promoted = 0;
      let errors = 0;

      for (const student of students) {
        try {
          // Only update the student's class — do NOT create or modify any fee records
          // Fee records for the new class will be created automatically when the admin
          // sets the fee structure via "Set / Update Class Fee" in the Fees section.
          // Existing fee balances from previous terms remain intact in the database.
          await supabaseClient.from('applications').update({ 
            class_applying: nextClass.name,
            updated_at: new Date().toISOString()
          }).eq('student_id', student.student_id);

          promoted++;
        } catch (e) {
          console.error('Error promoting student:', student.student_id, e);
          errors++;
        }
      }

      let msg = `✅ Successfully promoted ${promoted} student(s) from ${selectedClass} to ${nextClass.name}.\n\n`;
      msg += `📋 Students have been moved to ${nextClass.name} with their existing fee balances preserved.\n`;
      msg += `💰 To create fee records for the new class, go to Fees → "Set / Update Class Fee" and set the fee structure.`;
      if (errors > 0) msg += `\n\n⚠️ ${errors} student(s) had errors during promotion.`;
      alert(msg);
      await loadAllStudents();
    } catch (err) { alert('Error promoting class: ' + err.message); }
  });
}

// Helper needed for promote
function getNextTerm(term) {
  const terms = ['First', 'Second', 'Third'];
  const idx = terms.indexOf(term);
  return idx >= 0 && idx < 2 ? terms[idx + 1] : null;
}

function getNextAcademicYear(currentYear) {
  const parts = currentYear.split('/');
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  return (startYear + 1) + '/' + (endYear + 1);
}

// ================================================================
// CSV Export - Bulk Export Students Template
// ================================================================

function escapeCSVCell(val) {
  const str = String(val ?? '');
  return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
}

function studentsToCSV(students) {
  const header = [
    'Student ID',
    'First Name',
    'Middle Name',
    'Last Name',
    'Class',
    'Term',
    'Gender',
    'Date of Birth',
    'Religion',
    'Parent Name',
    'Parent Contact',
    'Home Town',
    'Place of Stay',
    'Teacher',
    'Previous School',
    'Admission Date',
    'Status',
    'Portal Confirmed'
  ];
  const rows = [header];
  students.forEach(s => {
    rows.push([
      s.student_id || '',
      s.first_name || '',
      s.middle_name || '',
      s.last_name || '',
      s.class_applying || '',
      s.term || '',
      s.gender || 'Male',
      s.date_of_birth || '',
      s.religion || 'Christian',
      s.parent_name || '',
      s.parent_contact || '',
      s.home_town || '',
      s.place_of_stay || '',
      s.teacher || '',
      s.previous_school || '',
      s.admission_date || '',
      s.status || 'admitted',
      s.portal_confirmed ? 'Yes' : 'No'
    ]);
  });
  return rows.map(r => r.map(escapeCSVCell).join(',')).join('\n');
}

async function exportStudentsCSV() {
  if (allStudents.length === 0) {
    alert('No students to export. Load students first.');
    return;
  }
  const classFilter = getEl('adminStudentsClassFilter')?.value || '';
  const genderFilter = getEl('adminStudentsGenderFilter')?.value || '';
  let data = [...allStudents];
  if (classFilter) data = data.filter(s => s.class_applying === classFilter);
  if (genderFilter) data = data.filter(s => (s.gender || 'Male') === genderFilter);

  const csv = studentsToCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const suffix = classFilter ? classFilter.replace(/\s+/g, '_') : 'all_students';
  link.download = `student_admission_template_${suffix}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showMessage('editStudentMessage', `✅ Exported ${data.length} student(s) to CSV.`, 'success');
}

// ================================================================
// CSV Import - Bulk Import Students
// ================================================================

async function importStudentsCSV() {
  const fileInput = getEl('csvStudentsImportInput');
  const file = fileInput?.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      alert('CSV file must have a header row and at least one data row.');
      fileInput.value = '';
      return;
    }
    const header = parseCSVLine(lines[0]);
    const colMap = {};
    const expectedCols = [
      'Student ID', 'First Name', 'Middle Name', 'Last Name', 'Class',
      'Term', 'Gender', 'Date of Birth', 'Religion', 'Parent Name',
      'Parent Contact', 'Home Town', 'Place of Stay', 'Teacher',
      'Previous School', 'Admission Date', 'Status', 'Portal Confirmed'
    ];
    expectedCols.forEach(col => {
      const idx = header.findIndex(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      if (idx >= 0) colMap[col] = idx;
    });

    if (!('First Name' in colMap) || !('Last Name' in colMap) || !('Class' in colMap)) {
      alert('CSV must have at least "First Name", "Last Name", and "Class" columns.\n\nExpected columns:\n' + expectedCols.join(', '));
      fileInput.value = '';
      return;
    }

    const schoolId = await getCurrentSchoolId();
    // Automatically use the academic year derived from today's date.
    const academicYear = getCurrentAcademicYear();

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const getVal = (col) => (colMap[col] !== undefined ? vals[colMap[col]]?.trim() || '' : '');

      const firstName = getVal('First Name');
      const lastName = getVal('Last Name');
      const className = getVal('Class');
      if (!firstName || !lastName || !className) {
        skipped++;
        continue;
      }

      try {
        // Generate student ID
        const { data: idData, error: idError } = await supabaseClient.rpc('generate_student_id');
        if (idError) throw new Error('ID generation failed: ' + idError.message);
        const studentId = idData;

        const term = getVal('Term') || 'First';
        const gender = getVal('Gender') || 'Male';
        const religion = getVal('Religion') || 'Christian';
        const status = getVal('Status') || 'admitted';
        const portalConfirmed = getVal('Portal Confirmed')?.toLowerCase() === 'yes';

        const { error: insertError } = await supabaseClient.from('applications').insert([{
          student_id: studentId,
          first_name: firstName,
          middle_name: getVal('Middle Name') || null,
          last_name: lastName,
          class_applying: className,
          term: term,
          gender: gender,
          date_of_birth: getVal('Date of Birth') || null,
          religion: religion,
          parent_name: getVal('Parent Name') || null,
          parent_contact: getVal('Parent Contact') || null,
          home_town: getVal('Home Town') || null,
          place_of_stay: getVal('Place of Stay') || null,
          teacher: getVal('Teacher') || null,
          previous_school: getVal('Previous School') || null,
          admission_date: getVal('Admission Date') || null,
          status: status,
          portal_confirmed: portalConfirmed,
          school_id: schoolId,
        }]);

        if (insertError) throw new Error('Insert failed: ' + insertError.message);

        // Create fee record - use the current academic year and the class/term fee structure
        const { data: classFee } = await supabaseClient.from('class_fees')
          .select('fee_amount, academic_year')
          .eq('class_name', className)
          .eq('academic_year', academicYear)
          .eq('term', term)
          .maybeSingle();
        const feeYear = classFee?.academic_year || academicYear;
        const totalAmount = classFee?.fee_amount || 0;
        await supabaseClient.from('fees').upsert([{
          student_id: studentId,
          academic_year: feeYear,
          term: term,
          total_amount: totalAmount,
          amount_paid: 0,
          debt: 0,
          payment_status: totalAmount > 0 ? 'unpaid' : 'paid',
          last_payment_date: null,
          school_id: schoolId,
        }], { onConflict: 'student_id,academic_year,term' });

        imported++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
        skipped++;
      }
    }

    await loadAllStudents();

    let msg = `✅ Imported ${imported} student(s) successfully.`;
    if (skipped > 0) msg += ` ⚠️ ${skipped} row(s) skipped.`;
    if (errors.length > 0) {
      msg += `\n\nErrors:\n${errors.slice(0, 5).join('\n')}`;
      if (errors.length > 5) msg += `\n...and ${errors.length - 5} more error(s).`;
    }
    alert(msg);
    logSubAdminActivity(`Imported ${imported} student(s) via CSV (${skipped} skipped)`, 'student', `CSV import`);
  } catch (err) {
    alert('Error importing CSV: ' + err.message);
    console.error('Import CSV error:', err);
  }
  fileInput.value = '';
}

// ================================================================
// Setup CSV Export/Import Listeners
// ================================================================

export function setupStudentCSVHandlers() {
  getEl('btnExportStudentsCSV')?.addEventListener('click', exportStudentsCSV);
  getEl('btnImportStudentsCSV')?.addEventListener('click', () => getEl('csvStudentsImportInput')?.click());
  getEl('csvStudentsImportInput')?.addEventListener('change', importStudentsCSV);
}
