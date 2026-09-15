/**
 * Admin Students Module - Student management, admit, edit, delete
 */

import { getEl, showMessage, clearMessage, setLoading, buildStudentName, formatDate, formatDateTime, statusBadge, portalBadge, uploadPhoto, previewFile, validateImageFile, logSubAdminActivity, getCurrentSchoolId, getCurrentSchoolInitials, openPrintWindow, getCurrentAcademicYear } from './utils.js';
import { buildCSV, parseCSV, downloadCSV } from './csv-utils.js';
import { deleteCloudinaryFile, getCloudinaryPublicIdFromUrl } from './cloudinary.js';
import { loadAdmissionItems } from './admin-settings.js';
import { openAdmissionForm } from './admission-form.js';

let supabaseClient = null;
let allStudents = [];
// Tracks the school_id the cached `allStudents` array belongs to so we can
// detect when a different school signs in and force a reload. This prevents a
// previously signed-in school's students from appearing in another school's list.
let allStudentsSchoolId = null;
// Cache of the school's configured classes (Classes module) so class filters
// and the CSV import can reference them even before any student is admitted.
let configuredClasses = [];
let configuredClassesSchoolId = null;
let configuredClassesLoaded = false;

export function initAdminStudents(supabase) {
  supabaseClient = supabase;
  // Keyboard support for the mobile collapsible student cards: pressing
  // Enter / Space on a focused card header toggles it like a tap would.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target;
    if (!target || !target.classList || !target.classList.contains('stud-card-header')) return;
    e.preventDefault();
    window.toggleStudentCard(target);
  });
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
  configuredClasses = [];
  configuredClassesSchoolId = null;
  configuredClassesLoaded = false;
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
  // Show the administrator's framed picture in the sidebar avatar (if uploaded)
  try {
    const schoolRes = await supabaseClient.from('schools').select('admin_photo_url').eq('user_id', (await supabaseClient.auth.getUser()).data.user?.id).maybeSingle();
    const adminPhotoUrl = schoolRes?.data?.admin_photo_url;
    const avatarEl = document.querySelector('#adminSidebar .dash-avatar');
    if (adminPhotoUrl && avatarEl) {
      avatarEl.innerHTML = `<img src="${adminPhotoUrl}" alt="Administrator" />`;
    } else if (avatarEl && avatarEl.querySelector('img')) {
      avatarEl.innerHTML = '';
    }
  } catch (err) {
    console.warn('Could not load administrator picture for avatar:', err.message);
  }
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
      : '<span class="dash-photo-placeholder"></span>';
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
        <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">Password</button>
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
  if (!confirm(`PERMANENT DELETION\n\nDelete student ${studentId} and ALL associated records?\n\nThis will permanently remove:\n• Student profile\n• Auth account (student will NOT be able to sign in)\n• Fee records (all terms)\n• Receipts\n• Payment transactions\n• Exam results\n• Attendance records\n• Parent links\n\nThis action CANNOT be undone.`)) return;
  const studentName = buildStudentName(
    allStudents.find(s => s.student_id === studentId)?.first_name,
    allStudents.find(s => s.student_id === studentId)?.middle_name,
    allStudents.find(s => s.student_id === studentId)?.last_name
  );
  // Capture the student's photo URL BEFORE the DB record is deleted, so the
  // Cloudinary/Storage asset can be cleaned up after a successful deletion.
  const studentPhotoUrl = allStudents.find((s) => s.student_id === studentId)?.student_photo_url;
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

      // Best-effort cleanup of the student's Cloudinary / Storage photo asset.
      await deleteStudentPhotoAsset(studentPhotoUrl);

      alert(`Student ${studentId} and all associated records permanently deleted.\nThe student can no longer sign in.`);
      logSubAdminActivity(`Deleted student "${studentName || studentId}"`, 'student', `${studentId} - ${studentName || ''}`);
      return;
    }

    // Success using the atomic RPC function
    const result = data;
    const counts = result?.deleted_counts || {};
    
    allStudents = allStudents.filter(s => s.student_id !== studentId);
    renderAdminTable();

    // Best-effort cleanup of the student's Cloudinary / Storage photo asset.
    await deleteStudentPhotoAsset(studentPhotoUrl);

    let summary = `Student ${studentId} (${result?.student_name || studentName || ''}) permanently deleted.\n`;
    summary += `The student can no longer sign in.\n\n`;
    summary += `Records removed:\n`;
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
// True when the admin clicked “Remove” in an edit form for a student that has a
// stored photo, meaning the stored photo should be deleted when the update saves.
let pendingPhotoRemoval = false;

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
 * Build a Cloudinary display prefix for a student photo that includes BOTH the
 * student id and the current school's initials, e.g. "STU-KABP9Q-SIS". This
 * makes duplicated uploads for the same student easy to identify in the
 * Cloudinary Media Library. Falls back to the bare student id if the initials
 * cannot be resolved.
 */
async function studentPhotoPrefix(studentId) {
  const initials = await getCurrentSchoolInitials();
  return initials && initials !== 'SCH' ? `${studentId}-${initials}` : studentId;
}

/**
 * Update a student's photo to a newly uploaded file. Returns the new public
 * URL on success, or null when the upload / update failed.
 */
async function replaceStudentPhotoFromFile(studentId, file) {
  const student = allStudents.find((s) => s.student_id === studentId);
  const oldUrl = student?.student_photo_url || null;

  const newUrl = await uploadPhoto(supabaseClient, 'student-photos', file, await studentPhotoPrefix(studentId));
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
// Admit Form — Term Fees (class fee + additional admission items)
// ================================================================

/** Best-effort HTML escape for item names rendered into the admit form. */
function escapeAdmitHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Refresh the live "Total Term Fee" shown on the admit form:
 * class fee + every additional admission item amount.
 */
export function updateAdmitFeeTotal() {
  const classFee = Number(getEl('admitClassFeeAmount')?.value || 0) || 0;
  let total = classFee;
  document.querySelectorAll('#admitAdditionalFees .admit-item-amount').forEach((input) => {
    total += Number(input.value || 0) || 0;
  });
  const totalEl = getEl('admitFeeTotal');
  if (totalEl) totalEl.textContent = `GHC ${total.toFixed(2)}`;
}

/**
 * Load the class (term) fee and the additional admission items on the admit
 * form. Populates the Class (Term) Fee amount (from the class_fees fee
 * structure) and renders one amount input per admission item saved in
 * Settings. Re-run whenever class or term changes.
 */
export async function loadAdmitFeeItems() {
  const classFeeEl = getEl('admitClassFeeAmount');
  const container = getEl('admitAdditionalFees');
  const cls = getEl('admitClass')?.value || '';
  const term = getEl('admitTerm')?.value || '';
  const academicYear = getCurrentAcademicYear();

  // 1. Auto-fill the class term fee from the fee structure (class+year+term)
  let classFee = 0;
  if (cls && term) {
    try {
      const { data: cf } = await supabaseClient.from('class_fees')
        .select('fee_amount')
        .eq('class_name', cls)
        .eq('academic_year', academicYear)
        .eq('term', term)
        .maybeSingle();
      if (cf) classFee = Number(cf.fee_amount) || 0;
    } catch (err) {
      console.warn('Failed to auto-fill class fee for admit form:', err.message);
    }
  }
  if (classFeeEl) classFeeEl.value = classFee || 0;

  // 2. Render the additional admission items with amount inputs
  const items = await loadAdmissionItems();
  if (container) {
    if (!items || items.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 0.5rem 0;">No additional admission items configured. Add some in <strong>Settings</strong> &#8594; <strong>Admission Items</strong>.</p>';
    } else {
      container.innerHTML =
        '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 0.6rem 0;">Enter the amount charged to this student for each additional item. Defaults come from Settings.</p>' +
        items.map((it) => `
          <div class="form-row" style="flex-wrap:wrap;gap:0.75rem;margin-bottom:0.4rem;">
            <div class="form-group" style="flex:1;min-width:200px;">
              <label>${escapeAdmitHtml(it.name)}</label>
              <input type="number" class="admit-item-amount" data-item-name="${escapeAdmitHtml(it.name)}" step="0.01" min="0" value="${Number(it.amount) || 0}" style="width:100%;" />
            </div>
          </div>`).join('');
    }
  }

  updateAdmitFeeTotal();
}

/**
 * Resolve the school display name & logo for generated documents.
 * Mirrors getSchoolPrintInfo() in admin-fees.js.
 */
async function getSchoolPrintInfo(schoolId) {
  let schoolName = 'My School';
  let schoolLogoUrl = '';
  if (schoolId) {
    try {
      const { data: schoolSettings } = await supabaseClient.from('school_settings')
        .select('school_name, logo_url')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettings?.school_name) {
        schoolName = schoolSettings.school_name;
        schoolLogoUrl = schoolSettings.logo_url || '';
      } else {
        const { data: school } = await supabaseClient.from('schools').select('name, logo_url').eq('id', schoolId).single();
        if (school) {
          schoolName = school.name || 'My School';
          schoolLogoUrl = school.logo_url || '';
        }
      }
    } catch (e) { /* keep defaults */ }
  }
  return { schoolName, schoolLogoUrl };
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

  // --- Term fees: class fee + additional admission items ---
  // Reload the class fee and admission items when class or term changes.
  getEl('admitClass')?.addEventListener('change', loadAdmitFeeItems);
  getEl('admitTerm')?.addEventListener('change', loadAdmitFeeItems);
  // Recompute the live total whenever a fee amount changes.
  getEl('admitClassFeeAmount')?.addEventListener('input', updateAdmitFeeTotal);
  getEl('admitAdditionalFees')?.addEventListener('input', (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains('admit-item-amount')) {
      updateAdmitFeeTotal();
    }
  });
  // Initial render of the fee section (safe no-op when signed out).
  loadAdmitFeeItems();

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
        photoUrl = await uploadPhoto(supabaseClient, 'student-photos', photoFile, await studentPhotoPrefix(studentId));
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
      // Class (term) fee: use the amount entered on the admit form (auto-filled
      // from the fee structure), falling back to the stored fee structure record.
      const classFeeAmount = Number(getEl('admitClassFeeAmount')?.value || 0) || Number(classFee?.fee_amount) || 0;

      // Additional admission items (from Settings) entered on the admit form.
      const breakdownItems = [];
      let totalAmount = classFeeAmount;
      document.querySelectorAll('#admitAdditionalFees .admit-item-amount').forEach((input) => {
        const amt = Number(input.value || 0) || 0;
        if (amt > 0) {
          breakdownItems.push({ name: input.getAttribute('data-item-name') || 'Additional Fee', amount: amt });
        }
        totalAmount += amt;
      });
      const feeBreakdown = {
        class_fee: classFeeAmount,
        items: breakdownItems,
        academic_year: feeYear,
        term: currentTerm,
        generated_at: new Date().toISOString(),
      };

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
        fee_breakdown: feeBreakdown,
      }], { onConflict: 'student_id,academic_year,term' });

      showMessage('admitMessage', `Student admitted! <strong>ID: ${studentId}</strong>`, 'success');
      logSubAdminActivity(`Admitted student "${buildStudentName(getEl('admitFirstName').value.trim(), getEl('admitMiddleName').value.trim(), getEl('admitLastName').value.trim())}"`, 'student', `${studentId}`);

      // Auto-generate the modern standalone HTML Student Admission Form
      // containing all student information, term fees and additional items.
      try {
        const { data: admittedStudent } = await supabaseClient.from('applications')
          .select('*')
          .eq('student_id', studentId)
          .maybeSingle();
        if (admittedStudent) {
          const { schoolName, schoolLogoUrl } = await getSchoolPrintInfo(schoolId);
          const studentName = buildStudentName(admittedStudent.first_name, admittedStudent.middle_name, admittedStudent.last_name);
          openAdmissionForm({
            studentId,
            student: admittedStudent,
            schoolName,
            schoolLogoUrl,
            academicYear: feeYear,
            term: currentTerm,
            classFee: classFeeAmount,
            items: breakdownItems,
            totalAmount,
          }, `Admission Form - ${studentName}`);
        }
      } catch (genErr) {
        console.warn('Failed to auto-generate admission form:', genErr.message);
      }

      getEl('admitForm').reset();
      getEl('admitPhotoPreviewImg').style.display = 'none';
      getEl('admitPhotoPlaceholder').style.display = 'block';
      getEl('admitClearPhoto').style.display = 'none';
      // Re-populate the class term fee + admission item defaults for the next admission.
      await loadAdmitFeeItems();
      await loadAllStudents();
    } catch (err) {
      showMessage('admitMessage', err.message, 'error');
    } finally {
      setLoading(btn, false, 'Admit Student & Generate ID');
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

// Holds the full mobile-cards markup so the "Show all students" button can swap
// the 5-card preview for the complete list (mirrors the table's 5-row preview).
let mobileCardsAllHtml = '';

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
  if (data.length === 0) {
    tbody.innerHTML = '';
    mobileCardsAllHtml = '';
    const cardsEl0 = getEl('adminStudentsCards');
    if (cardsEl0) cardsEl0.innerHTML = '';
    if (noResults) noResults.style.display = 'block';
    return;
  }
  if (noResults) noResults.style.display = 'none';

  const displayData = data.slice(0, 5);
  const hasMore = data.length > 5;

  // Desktop / tablet: classic table rows (CSS shows the table only on wide
  // screens; on mobile it is hidden in favour of the collapsible cards).
  tbody.innerHTML = displayData.map(buildStudentTableRow).join('');

  if (hasMore) {
    const showMoreRow = document.createElement('tr');
    showMoreRow.className = 'show-more-row';
    showMoreRow.innerHTML = `<td colspan="10">Show all ${data.length} students</td>`;
    showMoreRow.addEventListener('click', () => {
      tbody.innerHTML = data.map(buildStudentTableRow).join('');
    });
    tbody.appendChild(showMoreRow);
  }

  // Mobile: collapsible student cards. Cards load collapsed; tapping a card
  // header expands it with a smooth height transition (see CSS).
  const cardsEl = getEl('adminStudentsCards');
  if (cardsEl) {
    mobileCardsAllHtml = data.map(buildStudentMobileCard).join('');
    cardsEl.innerHTML = displayData.map(buildStudentMobileCard).join('');
    if (hasMore) {
      const showAllBtn = document.createElement('button');
      showAllBtn.type = 'button';
      showAllBtn.className = 'stud-card-show-all';
      showAllBtn.textContent = `Show all ${data.length} students`;
      showAllBtn.addEventListener('click', () => {
        cardsEl.innerHTML = mobileCardsAllHtml;
      });
      cardsEl.appendChild(showAllBtn);
    }
  }
}

// Build a desktop / tablet table row for one student.
function buildStudentTableRow(s) {
  const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
  const genderDisplay = s.gender || 'Male';
  const photoHtml = s.student_photo_url
    ? `<img src="${s.student_photo_url}" class="dash-photo" ondblclick="replaceStudentPhoto('${s.student_id}')" alt="Student photo" title="Double-click to replace photo" />`
    : `<span class="dash-photo-placeholder" ondblclick="replaceStudentPhoto('${s.student_id}')" title="Double-click to add photo"></span>`;
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
      <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">Password</button>
      <button class="action-btn danger" onclick="deleteStudent('${s.student_id}')">Delete</button>
    </td>
  </tr>`;
}

// Build a mobile collapsible card for one student. Cards load collapsed;
// tapping the header calls toggleStudentCard(this) which flips data-collapsed
// and triggers the smooth height transition (see components.css).
function buildStudentMobileCard(s) {
  const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
  const genderDisplay = s.gender || 'Male';
  const photoHtml = s.student_photo_url
    ? `<img src="${s.student_photo_url}" class="stud-card-photo" alt="Student photo" />`
    : '<span class="stud-card-photo-placeholder" aria-hidden="true">&#128100;</span>';
  const confirmBtn = s.portal_confirmed
    ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
    : `<button class="action-btn confirm" onclick="confirmPortal('${s.student_id}')">Confirm Portal</button>`;
  const esc = (val) => String(val || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="stud-card" data-collapsed="true">
  <div class="stud-card-header" onclick="toggleStudentCard(this)" role="button" tabindex="0" aria-expanded="false" title="Tap to expand / collapse">
    ${photoHtml}
    <span class="stud-card-info">
      <strong>${esc(name)}</strong>
      <small>${esc(s.student_id)} &middot; ${esc(s.class_applying || 'No class')}</small>
    </span>
    <span class="stud-card-chevron-holder" aria-hidden="true"><span class="stud-card-chevron"></span></span>
  </div>
  <div class="stud-card-body">
    <div class="stud-card-body-inner">
      <div class="stud-card-details">
        <div><span class="stud-card-label">Gender</span><span class="stud-card-value">${esc(genderDisplay)}</span></div>
        <div><span class="stud-card-label">Class</span><span class="stud-card-value">${esc(s.class_applying || '—')}</span></div>
        <div><span class="stud-card-label">Parent</span><span class="stud-card-value">${esc(s.parent_name || '—')}</span></div>
        <div><span class="stud-card-label">Contact</span><span class="stud-card-value">${esc(s.parent_contact || '—')}</span></div>
        <div><span class="stud-card-label">Status</span><span class="stud-card-value">${statusBadge(s.status)}</span></div>
        <div><span class="stud-card-label">Portal</span><span class="stud-card-value">${portalBadge(s.portal_confirmed)}</span></div>
      </div>
      <div class="stud-card-actions">
        <button class="action-btn view" onclick="openStudentModal('${s.student_id}')">View Profile</button>
        <button class="action-btn confirm" onclick="editStudent('${s.student_id}')">Edit</button>
        ${confirmBtn}
        <button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('student','${s.student_id}','${name.replace(/'/g, "\\'")}')">Password</button>
        <button class="action-btn danger" onclick="deleteStudent('${s.student_id}')">Delete</button>
      </div>
    </div>
  </div>
</div>`;
}

// Toggle a mobile student card open / closed with a smooth transition.
window.toggleStudentCard = function (headerEl) {
  const card = headerEl && headerEl.closest ? headerEl.closest('.stud-card') : null;
  if (!card) return;
  const collapsed = card.getAttribute('data-collapsed') === 'true';
  card.setAttribute('data-collapsed', String(!collapsed));
  if (headerEl) headerEl.setAttribute('aria-expanded', String(!collapsed));
};

// ================================================================
// Sync Class Filters
// ================================================================

// Load the school's configured classes (from the Classes module). Results are
// cached per school so repeated calls don't fire extra queries; the cache is
// dropped on sign-out so class data can never leak between schools.
async function loadConfiguredClasses() {
  const schoolId = await getCurrentSchoolId();
  if (!schoolId) {
    configuredClasses = [];
    configuredClassesSchoolId = null;
    configuredClassesLoaded = false;
    return [];
  }
  if (configuredClassesSchoolId === schoolId && configuredClassesLoaded) {
    return configuredClasses;
  }
  try {
    let q = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) q = q.eq('school_id', schoolId);
    const { data, error } = await q;
    if (error) throw error;
    configuredClasses = (data || []).map((c) => c.name);
  } catch (err) {
    console.error('Failed to load configured classes:', err);
    configuredClasses = [];
  }
  configuredClassesSchoolId = schoolId;
  configuredClassesLoaded = true;
  return configuredClasses;
}

// Expose a way for realtime events (classes added/edited) to refresh the
// configured-classes cache so every class filter updates immediately.
window.refreshConfiguredClassesCache = async function () {
  configuredClassesLoaded = false;
  await syncClassFilters();
};

// Sync every class filter with BOTH the classes the school has configured in
// the Classes module AND classes that actually appear on student records. This
// guarantees the filters still show the configured classes before the first
// student is even admitted.
async function syncClassFilters() {
  const configured = await loadConfiguredClasses();
  const fromStudents = allStudents.map((s) => s.class_applying || '').filter(Boolean);
  const classes = Array.from(new Set([...configured, ...fromStudents])).sort((a, b) => a.localeCompare(b));
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

  // Shared handler for the “Remove” button on both edit forms. When a just-picked
  // replacement file is present, it clears that pending selection (keeping the
  // stored photo). When no new file is chosen and the student has a stored photo,
  // it marks the photo for removal so the old Cloudinary file is deleted on save.
  const wireRemovePhoto = (inputId, imgId, placeholderId, btnId) => {
    const input = getEl(inputId);
    getEl(btnId)?.addEventListener('click', () => {
      const newFileChosen = !!(input && input.files && input.files[0]);
      if (newFileChosen) {
        // A replacement file was just selected → clear it, keep the stored photo.
        input.value = '';
        const img = getEl(imgId);
        if (img) { img.src = '#'; img.style.display = 'none'; }
        if (getEl(placeholderId)) getEl(placeholderId).textContent = 'Current photo will be kept';
        if (getEl(btnId)) getEl(btnId).style.display = 'none';
        pendingPhotoRemoval = false;
      } else {
        // No new file → delete the stored photo on save (and its Cloudinary file).
        pendingPhotoRemoval = true;
        const img = getEl(imgId);
        if (img) { img.src = '#'; img.style.display = 'none'; }
        if (getEl(placeholderId)) getEl(placeholderId).textContent = 'Current photo will be removed on save';
        if (getEl(btnId)) getEl(btnId).style.display = 'none';
      }
    });
  };
  wireRemovePhoto('editPhoto', 'editPhotoPreviewImg', 'editPhotoPlaceholder', 'editClearPhoto');
  wireRemovePhoto('editPhotoDash', 'editPhotoPreviewImgDash', 'editPhotoPlaceholderDash', 'editClearPhotoDash');

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

      // Capture the photo currently stored on the student. If this update swaps
      // in a new photo (or removes it), the old asset is deleted afterwards so
      // replaced/removed photos don't keep piling up in the Cloudinary folder.
      let previousPhotoUrl = '';
      let photoBeingReplaced = false;
      try {
        const schoolId = await getCurrentSchoolId();
        let prevQuery = supabaseClient.from('applications').select('student_photo_url').eq('student_id', studentId);
        if (schoolId) prevQuery = prevQuery.eq('school_id', schoolId);
        const { data: prevStudent } = await prevQuery.maybeSingle();
        if (prevStudent?.student_photo_url) previousPhotoUrl = prevStudent.student_photo_url;
      } catch (e) { /* best-effort; leftover files are harmless */ }

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
        pendingPhotoRemoval = false;
        const photoUrl = await uploadPhoto(supabaseClient, 'student-photos', editPhotoFile, await studentPhotoPrefix(studentId));
        if (photoUrl) {
          payload.student_photo_url = photoUrl;
          photoBeingReplaced = true;
        }
      } else if (pendingPhotoRemoval) {
        // No replacement file, but the admin clicked “Remove” → clear the stored photo.
        payload.student_photo_url = null;
        photoBeingReplaced = true;
      }

      try {
        const { error } = await supabaseClient.from('applications').update(payload).eq('student_id', studentId);
        if (error) throw error;

        // Delete the OLD photo asset (Cloudinary or legacy Supabase Storage) once
        // the student row is updated with a replacement/removal. This prevents
        // replaced/removed photos from duplicating / orphan-filling our Cloudinary
        // folder, and is best-effort so a failure never breaks the update itself.
        if (previousPhotoUrl && photoBeingReplaced) {
          await deleteStudentPhotoAsset(previousPhotoUrl);
        }
        pendingPhotoRemoval = false;

        showMessage('editStudentMessage', 'Student updated.', 'success');
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
        showMessage('editStudentMessage', 'Student photo updated.', 'success');
        await loadAllStudents();
      } else {
        alert('Photo upload failed. Please try again.');
      }
    } catch (err) {
      console.error('Replace photo error:', err);
      alert('Could not update photo: ' + err.message);
    } finally {
      this.value = '';
    }
  });
}

window.editStudent = async function (studentId) {
  // Whether the click comes from the admin dashboard or the standalone
  // Students page, always open the dedicated edit window (separate browser
  // window) so the admin edits the student in its own window.
  openEditStudentWindow(studentId);
  return;
};

// ================================================================
// Edit Student Window (separate popup browser window)
// Opens edit-student.html in its own window, which restores the
// same-origin Supabase session from localStorage, loads the student,
// and lets the admin edit in a fully separate browser window.
// ================================================================

window.openEditStudentWindow = function (studentId) {
  const url = new URL('edit-student.html', window.location.href);
  url.searchParams.set('studentId', studentId);
  window.open(url.toString(), '_blank', 'width=960,height=900,scrollbars=yes,resizable=yes');
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
    : '<div style="display:flex;justify-content:center;margin-bottom:1rem;"><span class="student-profile-photo-placeholder"></span></div>';

  const section = (title, items) => `
    <h4 style="grid-column:1/-1;margin:0.6rem 0 0.2rem;color:var(--primary);font-size:0.85rem;letter-spacing:0.3px;">${title}</h4>
    ${items.join('')}`;
  const field = (label, val) =>
    `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;

  getEl('modalStudentContent').innerHTML = `
    ${photoHtml}
    <div style="text-align:center;margin-bottom:1rem;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="printStudentProfileModal('${student.student_id}')">Print Profile</button>
    </div>
    <div class="profile-detail">
      ${section('Personal Information', [
        field('Full Name', name),
        field('Gender', student.gender || 'Male'),
        field('Date of Birth', formatDate(student.date_of_birth)),
        field('Religion', student.religion),
        field('Home Town', student.home_town),
        field('Place of Stay', student.place_of_stay),
      ])}
      ${section('Academic Information', [
        field('Student ID', student.student_id),
        field('Class', student.class_applying),
        field('Term', student.term),
        field('Teacher', student.teacher),
        field('Previous School', student.previous_school),
        field('Admission Date', formatDate(student.admission_date)),
        field('Application Date', formatDateTime(student.created_at)),
      ])}
      ${section('Guardian Information', [
        field('Parent / Guardian', student.parent_name),
        field('Parent Contact', student.parent_contact),
      ])}
      ${section('Status & Portal', [
        field('Admission Status', statusBadge(student.status)),
        field('Portal Confirmed', student.portal_confirmed ? 'Yes' : 'No'),
        field('Sub-Admin Approved', student.sub_admin_approved ? 'Yes' : 'No'),
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
    : '<div style="font-size:3rem;text-align:center;"></div>';

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
      <tr><th colspan="2">Personal Information</th></tr>
      ${field('Student ID', student.student_id)}
      ${field('Full Name', name)}
      ${field('Gender', student.gender || 'Male')}
      ${field('Date of Birth', formatDate(student.date_of_birth))}
      ${field('Religion', student.religion)}
      ${field('Home Town', student.home_town)}
      ${field('Place of Stay', student.place_of_stay)}
      <tr><th colspan="2">Academic Information</th></tr>
      ${field('Class', student.class_applying)}
      ${field('Term', student.term)}
      ${field('Teacher', student.teacher)}
      ${field('Previous School', student.previous_school)}
      ${field('Admission Date', formatDate(student.admission_date))}
      ${field('Application Date', formatDateTime(student.created_at))}
      <tr><th colspan="2">Guardian Information</th></tr>
      ${field('Parent / Guardian', student.parent_name)}
      ${field('Parent Contact', student.parent_contact)}
      <tr><th colspan="2">Status & Portal</th></tr>
      ${field('Admission Status', student.status)}
      ${field('Portal Confirmed', student.portal_confirmed ? 'Yes' : 'No')}
      ${field('Sub-Admin Approved', student.sub_admin_approved ? 'Yes' : 'No')}
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
      : '<span class="print-no-photo"></span>';
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
  // Open the promote-class modal when the toolbar button is clicked.
  getEl('btnPromoteClass')?.addEventListener('click', openPromoteClassModal);

  // Promote action inside the modal.
  getEl('promoteClassSubmitBtn')?.addEventListener('click', submitPromoteClass);

  // "Select All" checkbox toggles every student checkbox in the list.
  getEl('promoteSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('#promoteStudentsBody .promote-student-check').forEach((cb) => {
      cb.checked = e.target.checked;
    });
    updatePromoteSelectedCount();
  });

  // Keep the running selection count in sync when individual checkboxes change,
  // and un-check "Select All" as soon as any single checkbox is un-ticked.
  getEl('promoteStudentsBody')?.addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('promote-student-check')) {
      updatePromoteSelectedCount();
      const all = document.querySelectorAll('#promoteStudentsBody .promote-student-check');
      const selectAll = getEl('promoteSelectAll');
      if (selectAll) selectAll.checked = all.length > 0 && Array.from(all).every((cb) => cb.checked);
    }
  });

  // Clicking the dimmed backdrop closes the modal.
  getEl('promoteClassModal')?.addEventListener('click', (e) => {
    if (e.target === getEl('promoteClassModal')) closePromoteClassModal();
  });
}

// Close the Promote Class modal (also wired to the modal's close button).
window.closePromoteClassModal = function () {
  const modal = getEl('promoteClassModal');
  if (modal) modal.style.display = 'none';
};

// Build and open the Promote Class modal with:
//  1. every student visible under the current class / gender / search filters,
//     each with its own checkbox (plus a "Select All" toggle), and
//  2. a dropdown to pick the class students should be promoted to (the "next"
//     class in the level order is pre-selected when a single source class is set).
async function openPromoteClassModal() {
  const modal = getEl('promoteClassModal');
  const body = getEl('promoteStudentsBody');
  const subtitle = getEl('promoteClassSubtitle');
  const targetSelect = getEl('promoteToClass');
  const selectAll = getEl('promoteSelectAll');
  const countEl = getEl('promoteSelectedCount');
  const submitBtn = getEl('promoteClassSubmitBtn');
  if (!modal || !body) return;

  const schoolId = await getCurrentSchoolId();
  const classFilter = getEl('adminStudentsClassFilter');
  const selectedClass = classFilter?.value || '';
  const genderFilter = getEl('adminStudentsGenderFilter')?.value || '';
  const searchQ = (getEl('adminStudentsSearch')?.value || '').toLowerCase().trim();

  // Reset modal state.
  body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--text-muted);">Loading students…</td></tr>';
  if (subtitle) subtitle.textContent = selectedClass ? `Source class: ${selectedClass}` : 'Source: All classes';
  if (selectAll) { selectAll.checked = false; selectAll.disabled = true; }
  if (submitBtn) submitBtn.disabled = true;
  if (countEl) countEl.textContent = '0';
  if (targetSelect) targetSelect.innerHTML = '<option value="">— Select class —</option>';

  try {
    // Ordered by level then name so the "next" class matches class progression.
    let classQuery = supabaseClient.from('classes').select('name, level')
      .order('level', { ascending: true }).order('name', { ascending: true });
    if (schoolId) classQuery = classQuery.eq('school_id', schoolId);
    const { data: classes, error: classesError } = await classQuery;
    if (classesError) throw classesError;
    const classNames = (classes || []).map((c) => c.name);

    // Fresh list of this school's students so the modal always reflects the DB.
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id, first_name, middle_name, last_name, gender, class_applying, parent_contact');
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students, error: studentsError } = await studentsQuery;
    if (studentsError) throw studentsError;

    let list = (students || []).filter((s) => s.student_id && s.class_applying);
    if (selectedClass) list = list.filter((s) => s.class_applying === selectedClass);
    if (genderFilter) list = list.filter((s) => (s.gender || 'Male') === genderFilter);
    if (searchQ) {
      list = list.filter((s) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
        return name.includes(searchQ)
          || (s.student_id || '').toLowerCase().includes(searchQ)
          || (s.parent_contact || '').toLowerCase().includes(searchQ);
      });
    }
    list.sort((a, b) => buildStudentName(a.first_name, a.middle_name, a.last_name)
      .localeCompare(buildStudentName(b.first_name, b.middle_name, b.last_name)));

    // Target classes: everything the school has configured. When a single
    // source class is set, exclude it so students can't be "promoted" to the
    // class they are already in.
    let targetOptions = classNames;
    if (selectedClass) targetOptions = classNames.filter((n) => n !== selectedClass);

    if (targetOptions.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--text-muted);">No target class available to promote to. Add more classes in the Classes module first.</td></tr>';
      modal.style.display = 'flex';
      return;
    }
    if (targetSelect) {
      targetSelect.innerHTML = '<option value="">— Select class —</option>'
        + targetOptions.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
      // Pre-select the immediate next class in level order when promoting a
      // single source class; otherwise leave it to the admin to choose.
      const currentIndex = selectedClass ? classNames.indexOf(selectedClass) : -1;
      const nextClass = currentIndex >= 0 ? classNames[currentIndex + 1] : null;
      if (nextClass && targetOptions.includes(nextClass)) targetSelect.value = nextClass;
    }

    if (list.length === 0) {
      let msg = 'No students found';
      if (selectedClass) msg += ` in ${selectedClass}`;
      msg += ' matching the current filters.';
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--text-muted);">${msg}</td></tr>`;
      modal.style.display = 'flex';
      return;
    }

    body.innerHTML = list.map((s) => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
      const esc = (val) => String(val || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<tr>
        <td style="text-align:center;"><input type="checkbox" class="promote-student-check" data-student-id="${esc(s.student_id)}" data-name="${esc(name)}" aria-label="Select ${esc(name)}" /></td>
        <td><strong>${esc(s.student_id)}</strong></td>
        <td>${esc(name)}</td>
        <td>${esc(s.gender || 'Male')}</td>
        <td>${esc(s.class_applying)}</td>
      </tr>`;
    }).join('');

    if (selectAll) selectAll.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    modal.style.display = 'flex';
  } catch (err) {
    console.error('Error preparing Promote Class:', err);
    alert('Error preparing Promote Class: ' + err.message);
    closePromoteClassModal();
  }
}

// Reflect the number of ticked checkboxes in the "N student(s) selected" label.
function updatePromoteSelectedCount() {
  const count = document.querySelectorAll('#promoteStudentsBody .promote-student-check:checked').length;
  const el = getEl('promoteSelectedCount');
  if (el) el.textContent = String(count);
}

// Promote only the manually-selected students to the chosen target class.
async function submitPromoteClass() {
  const targetClass = getEl('promoteToClass')?.value;
  if (!targetClass) { alert('Please select the class to promote to.'); return; }

  const selectedRows = Array.from(document.querySelectorAll('#promoteStudentsBody .promote-student-check:checked'));
  if (selectedRows.length === 0) { alert('Please select at least one student to promote.'); return; }

  const students = selectedRows.map((cb) => ({
    student_id: cb.getAttribute('data-student-id'),
    name: cb.getAttribute('data-name') || cb.getAttribute('data-student-id'),
  }));

  if (!confirm(`Promote ${students.length} student(s) to ${targetClass}?\n\nThis will:\n1. Move the selected students to ${targetClass}\n2. Keep their existing fee balances intact\n\nNo new fee records will be created. Fee records for the new class will be generated when the fee structure is set via "Set / Update Class Fee".`)) return;

  const submitBtn = getEl('promoteClassSubmitBtn');
  if (submitBtn) setLoading(submitBtn, true, 'Promoting...');

  let promoted = 0;
  let errors = 0;
  for (const student of students) {
    try {
      // Only update the student's class — do NOT create or modify any fee
      // records. Fee records for the new class are created when the admin
      // sets the fee structure via "Set / Update Class Fee" in the Fees
      // section. Existing fee balances from previous terms remain intact.
      const { error } = await supabaseClient.from('applications').update({
        class_applying: targetClass,
        updated_at: new Date().toISOString()
      }).eq('student_id', student.student_id);
      if (error) throw error;

      promoted++;
    } catch (e) {
      console.error('Error promoting student:', student.student_id, e);
      errors++;
    }
  }
  if (submitBtn) setLoading(submitBtn, false, 'Promote Selected Students');

  let msg = `Successfully promoted ${promoted} student(s) to ${targetClass}.\n\n`;
  msg += 'Students have been moved with their existing fee balances preserved.\n';
  msg += `To create fee records for the new class, go to Fees → "Set / Update Class Fee" and set the fee structure.`;
  if (errors > 0) msg += `\n\n${errors} student(s) had errors during promotion.`;
  alert(msg);

  await loadAllStudents();
  closePromoteClassModal();
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

// The canonical set of columns used by BOTH the export template and the import
// parser. Keeping them in sync guarantees that any file downloaded from the app
// can be edited and imported back without surprises.
const STUDENT_CSV_HEADERS = [
  'Student ID', 'First Name', 'Middle Name', 'Last Name', 'Class',
  'Term', 'Gender', 'Date of Birth', 'Religion', 'Parent Name',
  'Parent Contact', 'Home Town', 'Place of Stay', 'Teacher',
  'Previous School', 'Admission Date', 'Status', 'Portal Confirmed'
];

// Accepted synonyms for each column (case-insensitive). Excel users sometimes
// rename headers, so we normalise them instead of failing the import.
const STUDENT_CSV_ALIASES = {
  'Student ID': ['Student ID', 'student_id', 'Student_Id', 'StudentId', 'ID'],
  'First Name': ['First Name', 'first_name', 'Firstname'],
  'Middle Name': ['Middle Name', 'middle_name', 'Middlename'],
  'Last Name': ['Last Name', 'last_name', 'Lastname', 'Surname'],
  'Class': ['Class', 'Class Applying', 'Class/Form', 'Form/Class', 'Grade', 'class_applying'],
  'Term': ['Term'],
  'Gender': ['Gender'],
  'Date of Birth': ['Date of Birth', 'DOB', 'Birth Date', 'date_of_birth'],
  'Religion': ['Religion'],
  'Parent Name': ['Parent Name', 'Guardian Name', 'Parent/Guardian Name', 'parent_name'],
  'Parent Contact': ['Parent Contact', 'Parent Phone', 'Parent Telephone', 'Contact', 'parent_contact'],
  'Home Town': ['Home Town', 'Hometown', 'home_town'],
  'Place of Stay': ['Place of Stay', 'Residence', 'place_of_stay'],
  'Teacher': ['Teacher', 'Class Teacher', 'Form Teacher'],
  'Previous School': ['Previous School', 'PreviousSchool', 'previous_school'],
  'Admission Date': ['Admission Date', 'admission_date', 'Date Admitted'],
  'Status': ['Status'],
  'Portal Confirmed': ['Portal Confirmed', 'Portal', 'Portal Confirmed?']
};

const STUDENT_GENDERS = ['Male', 'Female', 'Other'];
const STUDENT_RELIGIONS = ['Christian', 'Muslim', 'Others'];
const STUDENT_TERMS = ['First', 'Second', 'Third'];
const STUDENT_STATUSES = ['pending', 'admitted'];
const PORTAL_YES = new Set(['yes', 'true', '1', 'y', 'confirmed', 'confirm']);
const PORTAL_NO = new Set(['no', 'false', '0', 'n', '', 'unconfirmed', 'not confirmed', 'pending']);

// Normalise an enum value (gender / religion / term / status) to its canonical
// spelling, falling back to `fallback` when the cell is blank.
function toCanonical(value, allowed, fallback) {
  const v = String(value ?? '').trim();
  if (!v) return { value: fallback, error: null };
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (hit) return { value: hit, error: null };
  return { value: v, error: `"${v}" is not valid. Use one of: ${allowed.join(', ')}.` };
}

// Normalise a date cell into YYYY-MM-DD. Handles Excel serial dates and the
// common DD/MM/YYYY style in addition to the canonical ISO form.
function normalizeDateCell(raw, label) {
  const v = String(raw ?? '').trim().replace(/\.0+$/, '');
  if (!v) return { value: null, error: null };
  // Excel serial date (days since 1899-12-30).
  if (/^\d{4,6}$/.test(v) && Number(v) >= 25569) {
    const dt = new Date(Math.round((Number(v) - 25569) * 86400000));
    if (!Number.isNaN(dt.getTime())) return { value: dt.toISOString().slice(0, 10), error: null };
  }
  // Canonical YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const dt = new Date(`${v}T00:00:00Z`);
    if (!Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === v) {
      return { value: v, error: null };
    }
  }
  // DD/MM/YYYY or DD-MM-YYYY.
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, error: null };
    }
  }
  return { value: v, error: `${label} "${v}" is not a valid date. Use YYYY-MM-DD.` };
}

function studentsToCSV(students) {
  const rows = [STUDENT_CSV_HEADERS];
  students.forEach((s) => {
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
  return buildCSV(rows);
}

async function exportStudentsCSV() {
  if (allStudents.length === 0) {
    alert('No students to export. Load students first.');
    return;
  }
  const classFilter = getEl('adminStudentsClassFilter')?.value || '';
  const genderFilter = getEl('adminStudentsGenderFilter')?.value || '';
  const searchQ = (getEl('adminStudentsSearch')?.value || '').toLowerCase().trim();
  let data = [...allStudents];
  if (searchQ) {
    data = data.filter((s) => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
      return name.includes(searchQ) || s.student_id?.toLowerCase().includes(searchQ) || s.parent_contact?.toLowerCase().includes(searchQ);
    });
  }
  if (classFilter) data = data.filter((s) => s.class_applying === classFilter);
  if (genderFilter) data = data.filter((s) => (s.gender || 'Male') === genderFilter);

  const csv = studentsToCSV(data);
  const suffix = classFilter ? classFilter.replace(/\s+/g, '_') : (searchQ ? 'search_results' : 'all_students');
  downloadCSV(`student_admission_template_${suffix}.csv`, csv);
  showMessage('editStudentMessage', `Exported ${data.length} student(s) to CSV.`, 'success');
}

// Download a blank, ready-to-fill import template (header row + one example
// row). Every column shown is understood by the import parser, so admins can
// simply open the file, replace the example with real students, and re-import.
function downloadStudentImportTemplate() {
  const example = [
    '', 'Ama', 'Akosua', 'Mensah', 'JHS 1A', 'First', 'Female', '2013-04-15', 'Christian',
    'Akosua Mensah', '0551234567', 'Kumasi', 'Deduako', '', "St. Mary's JHS", '2026-09-02',
    'admitted', 'No'
  ];
  const csv = buildCSV([STUDENT_CSV_HEADERS, example]);
  downloadCSV('student_import_template.csv', csv);
  showMessage('editStudentMessage', 'Import template downloaded. Fill in the rows (keep the header) and use Import CSV.', 'success');
}

// ================================================================
// CSV Import - Bulk Import Students
// ================================================================

// Build a normalised header → column index map, matching canonical column names
// or any of their synonyms case-insensitively.
function buildStudentColumnMap(headerRow) {
  const colMap = {};
  const normalizedHeaders = headerRow.map((h) =>
    String(h ?? '').replace(/\uFEFF/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
  );
  STUDENT_CSV_HEADERS.forEach((col) => {
    const names = (STUDENT_CSV_ALIASES[col] || [col]).map((n) => n.toLowerCase().replace(/\s+/g, ' '));
    const idx = normalizedHeaders.findIndex((h) => names.includes(h));
    if (idx >= 0) colMap[col] = idx;
  });
  return colMap;
}

// Run a bounded number of async operations at once (used to generate student
// IDs without flooding the server with hundreds of simultaneous RPC calls).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Some spreadsheet apps prefix text cells with an apostrophe (e.g. "'0551234567");
// strip it so phone numbers / IDs import cleanly.
function scrubCell(raw) {
  const v = String(raw ?? '');
  return v.startsWith("'") ? v.slice(1) : v;
}

async function importStudentsCSV() {
  const fileInput = getEl('csvStudentsImportInput');
  const file = fileInput?.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    // Parse robustly (UTF-8 BOM, CRLF/LF line endings, quoted fields) and drop
    // completely empty rows.
    const rows = parseCSV(text).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
    if (rows.length < 2) {
      alert(`"${file.name}" must have a header row and at least one data row.`);
      fileInput.value = '';
      return;
    }

    const colMap = buildStudentColumnMap(rows[0]);
    const requiredCols = ['First Name', 'Last Name', 'Class', 'Date of Birth', 'Parent Name', 'Parent Contact'];
    const missingRequiredCols = requiredCols.filter((col) => !(col in colMap));
    if (missingRequiredCols.length > 0) {
      alert(`"${file.name}" is missing required column(s): ${missingRequiredCols.join(', ')}.\n\nExpected columns:\n${STUDENT_CSV_HEADERS.join(', ')}\n\nDownload the CSV template and use it as a starting point.`);
      fileInput.value = '';
      return;
    }

    const schoolId = await getCurrentSchoolId();
    // Automatically use the academic year derived from today's date.
    const academicYear = getCurrentAcademicYear();

    // Load all existing students + the fee structure + the school's configured
    // classes ONCE so per-row processing below avoids an N+1 query pattern.
    const [{ data: existing }, { data: classFees }, configured] = await Promise.all([
      supabaseClient.from('applications').select('student_id, first_name, last_name, date_of_birth').eq('school_id', schoolId),
      supabaseClient.from('class_fees').select('class_name, term, fee_amount, academic_year').eq('school_id', schoolId),
      loadConfiguredClasses()
    ]);
    const existingIds = new Set((existing || []).map((s) => s.student_id));
    const existingKeys = new Map(
      (existing || [])
        .filter((s) => s.first_name && s.last_name && s.date_of_birth)
        .map((s) => [`${s.first_name.trim().toLowerCase()}|${s.last_name.trim().toLowerCase()}|${s.date_of_birth}`, true])
    );
    // Classes configured in the Classes module → canonical spelling used on
    // insert, so the import stays perfectly in sync with the add-class module.
    const configuredClassMap = new Map(
      (configured || []).map((name) => [String(name).trim().toLowerCase(), String(name).trim()])
    );
    const feeMap = new Map(
      (classFees || []).map((f) => [`${String(f.class_name).trim().toLowerCase()}|||${f.term}`, Number(f.fee_amount) || 0])
    );

    // --- Validate every data row in memory (no DB writes yet) --------------
    const rowsToCreate = [];
    const errors = [];

    rows.slice(1).forEach((vals, rowIndex) => {
      const fileRow = rowIndex + 2; // 1-based; row 1 is the header
      const getVal = (col) => (col in colMap && colMap[col] < vals.length ? scrubCell(vals[colMap[col]]).trim() : '');

      const firstName = getVal('First Name');
      const lastName = getVal('Last Name');
      let className = getVal('Class');
      const parentName = getVal('Parent Name');
      const parentContact = getVal('Parent Contact');
      const dob = normalizeDateCell(getVal('Date of Birth'), `Row ${fileRow} Date of Birth`);
      const admissionDate = normalizeDateCell(getVal('Admission Date'), `Row ${fileRow} Admission Date`);

      const problems = [];
      if (!firstName) problems.push('First Name is required');
      if (!lastName) problems.push('Last Name is required');
      if (className) {
        // The add-class module is the source of truth: only admit students into
        // classes the school actually configured.
        const canonicalClass = configuredClassMap.get(className.trim().toLowerCase());
        if (!canonicalClass) {
          const available = configured.length
            ? ` ${configured.slice(0, 12).join(', ')}${configured.length > 12 ? '…' : ''}`
            : ' none configured yet — add classes under Classes first.';
          problems.push(`Class "${className}" does not exist. Available classes:${available}`);
        } else {
          className = canonicalClass;
        }
      } else {
        problems.push('Class is required');
      }
      if (!parentName) problems.push('Parent Name is required');
      if (!parentContact) problems.push('Parent Contact is required');
      if (!dob.value) problems.push('Date of Birth is required');
      if (dob.error) problems.push(dob.error);
      if (admissionDate.error) problems.push(admissionDate.error);

      const gender = toCanonical(getVal('Gender'), STUDENT_GENDERS, 'Male');
      if (gender.error) problems.push(`Gender ${gender.error}`);
      const religion = toCanonical(getVal('Religion'), STUDENT_RELIGIONS, 'Christian');
      if (religion.error) problems.push(`Religion ${religion.error}`);
      const term = toCanonical(getVal('Term'), STUDENT_TERMS, 'First');
      if (term.error) problems.push(`Term ${term.error}`);
      const status = toCanonical(getVal('Status'), STUDENT_STATUSES, 'admitted');
      if (status.error) problems.push(`Status ${status.error}`);

      const portalRaw = getVal('Portal Confirmed').toLowerCase();
      let portal = false;
      if (PORTAL_YES.has(portalRaw)) portal = true;
      else if (!PORTAL_NO.has(portalRaw)) problems.push(`Portal Confirmed "${portalRaw}" must be Yes or No`);

      const providedId = getVal('Student ID');
      if (providedId && existingIds.has(providedId)) {
        problems.push(`Student ID "${providedId}" already exists`);
      }

      if (problems.length > 0) {
        errors.push(`Row ${fileRow} (${firstName || '?'} ${lastName || ''}): ${problems.join('; ')}`);
        return;
      }

      // Natural-key duplicate guard: a student with the same first name, last
      // name and date of birth is almost certainly the same person.
      if (dob.value) {
        const key = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}|${dob.value}`;
        if (existingKeys.has(key)) {
          errors.push(`Row ${fileRow} (${firstName} ${lastName}): looks like a duplicate of an existing student (same name & date of birth)`);
          return;
        }
      }

      rowsToCreate.push({
        student_id: providedId || null, // null → auto-generated below
        first_name: firstName.trim(),
        middle_name: getVal('Middle Name') || null,
        last_name: lastName.trim(),
        class_applying: className.trim(),
        term: term.value,
        gender: gender.value,
        religion: religion.value,
        date_of_birth: dob.value,
        parent_name: parentName.trim(),
        parent_contact: parentContact.trim(),
        home_town: getVal('Home Town') || null,
        place_of_stay: getVal('Place of Stay') || null,
        teacher: getVal('Teacher') || null,
        previous_school: getVal('Previous School') || null,
        admission_date: admissionDate.value || null,
        status: status.value,
        portal_confirmed: portal,
        school_id: schoolId,
        fileRow
      });
    });

    if (rowsToCreate.length === 0) {
      alert(`No rows from "${file.name}" could be imported.\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n...and ${errors.length - 10} more.` : ''}`);
      fileInput.value = '';
      return;
    }

    // --- Write phase ------------------------------------------------------
    let imported = 0;
    try {
      const providedRows = rowsToCreate.filter((r) => r.student_id);
      const autoRows = rowsToCreate.filter((r) => !r.student_id);
      // Generate IDs for the rows that didn't supply one (bounded concurrency).
      if (autoRows.length > 0) {
        const generatedIds = await mapWithConcurrency(autoRows, 8, async () => {
          const { data: idData, error: idError } = await supabaseClient.rpc('generate_student_id');
          if (idError) throw new Error('ID generation failed: ' + idError.message);
          if (!idData) throw new Error('ID generation returned an empty result.');
          return idData;
        });
        autoRows.forEach((r, i) => { r.student_id = generatedIds[i]; });
      }

      // Final duplicate pass (in-file duplicates + collisions with existing IDs).
      const seen = new Set();
      const insertRows = [];
      for (const r of [...providedRows, ...autoRows]) {
        const id = r.student_id;
        if (seen.has(id) || existingIds.has(id)) {
          errors.push(`Row ${r.fileRow} (${r.first_name} ${r.last_name}): Student ID "${id}" already exists`);
          continue;
        }
        seen.add(id);
        insertRows.push(r);
      }

      // Insert applications in chunks.
      for (let i = 0; i < insertRows.length; i += 100) {
        const chunk = insertRows.slice(i, i + 100).map((r) => ({
          student_id: r.student_id,
          first_name: r.first_name,
          middle_name: r.middle_name,
          last_name: r.last_name,
          class_applying: r.class_applying,
          term: r.term,
          gender: r.gender,
          religion: r.religion,
          date_of_birth: r.date_of_birth,
          parent_name: r.parent_name,
          parent_contact: r.parent_contact,
          home_town: r.home_town,
          place_of_stay: r.place_of_stay,
          teacher: r.teacher,
          previous_school: r.previous_school,
          admission_date: r.admission_date,
          status: r.status,
          portal_confirmed: r.portal_confirmed,
          sub_admin_approved: r.portal_confirmed,
          school_id: r.school_id
        }));
        const { error: insertError } = await supabaseClient.from('applications').insert(chunk);
        if (insertError) throw new Error('Bulk insert failed: ' + insertError.message);
      }

      // Create fee records for every imported student using the school's fee
      // structure for the current academic year + term.
      const feeRows = insertRows.map((r) => {
        const totalAmount = feeMap.get(`${r.class_applying.trim().toLowerCase()}|||${r.term}`) ?? 0;
        return {
          student_id: r.student_id,
          academic_year: academicYear,
          term: r.term,
          total_amount: totalAmount,
          amount_paid: 0,
          debt: 0,
          payment_status: totalAmount > 0 ? 'unpaid' : 'paid',
          last_payment_date: null,
          school_id: schoolId
        };
      });
      for (let i = 0; i < feeRows.length; i += 100) {
        const chunk = feeRows.slice(i, i + 100);
        const { error: feeError } = await supabaseClient.from('fees').upsert(chunk, { onConflict: 'student_id,academic_year,term' });
        if (feeError) throw new Error('Fee record creation failed: ' + feeError.message);
      }

      imported = insertRows.length;
    } catch (err) {
      errors.push(`Import stopped mid-way: ${err.message}`);
    }

    await loadAllStudents();

    let msg = `Imported ${imported} student(s) from "${file.name}".`;
    if (errors.length > 0) {
      msg += `\n\n${errors.length} row(s) skipped:\n${errors.slice(0, 8).join('\n')}`;
      if (errors.length > 8) msg += `\n...and ${errors.length - 8} more.`;
    }
    alert(msg);
    logSubAdminActivity(`Imported ${imported} student(s) via CSV (${errors.length} skipped)`, 'student', 'CSV import');
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
  getEl('btnDownloadStudentTemplate')?.addEventListener('click', downloadStudentImportTemplate);
  getEl('btnImportStudentsCSV')?.addEventListener('click', () => getEl('csvStudentsImportInput')?.click());
  getEl('csvStudentsImportInput')?.addEventListener('change', importStudentsCSV);
}
