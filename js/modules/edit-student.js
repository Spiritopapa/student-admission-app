/**
 * Edit Student Window - standalone popup page (edit-student.html)
 *
 * Opens in its own browser window from the Admin Dashboard Students module.
 * Because the popup is same-origin it shares the persisted Supabase session
 * (localStorage), so it can restore auth, load the student, and save updates
 * exactly like the inline dashboard editors.
 */

import { showMessage, clearMessage, setLoading, initSchoolIdHelper, getCurrentSchoolId, getCurrentSchoolInitials, validateImageFile, previewFile, uploadPhoto, initActivityLogger, logSubAdminActivity } from './utils.js';
import { deleteCloudinaryFile, getCloudinaryPublicIdFromUrl } from './cloudinary.js';
import supabaseClient from '../supabase-config.js';

// Tag photo helpers with the popup's own supabase client
initSchoolIdHelper(supabaseClient);
initActivityLogger(supabaseClient);

const MAX_PHOTO_SIZE_MB = 0.5;
let pendingPhotoRemoval = false;

// Read the student to edit from the URL (?studentId=...).
const params = new URLSearchParams(window.location.search);
const studentId = params.get('studentId');

/** Single setter guarded so a missing field can never break the whole load. */
function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

/**
 * Populate every form field from the loaded student record.
 */
function populate(student) {
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
  setField('editTeacher', student.teacher || '');
  setField('editGender', student.gender || 'Male');
  setField('editPrevSchool', student.previous_school || '');
  setField('editAdmissionDate', student.admission_date || '');

  const subtitle = document.getElementById('editStudentWindowSubtitle');
  if (subtitle) subtitle.textContent = `${student.student_id} — ${student.first_name || ''} ${student.last_name || ''}`.trim();

  // Photo preview
  const img = document.getElementById('editPhotoPreviewImg');
  const placeholder = document.getElementById('editPhotoPlaceholder');
  const clearBtn = document.getElementById('editClearPhoto');
  if (student.student_photo_url) {
    img.src = student.student_photo_url;
    img.style.display = 'block';
    if (placeholder) placeholder.textContent = '';
    if (clearBtn) clearBtn.style.display = 'inline-block';
  } else {
    img.src = '#';
    img.style.display = 'none';
    if (placeholder) placeholder.textContent = 'No photo';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

/**
 * Fill the class dropdown, then restore the student's current class.
 */
async function populateClasses(selectedClass) {
  const select = document.getElementById('editClass');
  if (!select) return;
  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: classes, error } = await query;
    if (error) throw error;
    if (classes && classes.length > 0) {
      select.innerHTML = '<option value="">— Select —</option>' + classes.map((c) => `<option>${c.name}</option>`).join('');
    }
    select.value = selectedClass || '';
  } catch (err) {
    console.error('Failed to load classes for edit window:', err);
  }
}

/** Photo file input preview + remove handling. */
function setupPhotoHandlers() {
  document.getElementById('editPhoto')?.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const validation = validateImageFile(file, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) { alert(validation.error); this.value = ''; return; }
    previewFile(file, document.getElementById('editPhotoPreviewImg'), null, document.getElementById('editClearPhoto'), MAX_PHOTO_SIZE_MB);
    const placeholder = document.getElementById('editPhotoPlaceholder');
    if (placeholder) placeholder.textContent = 'New photo selected';
  });

  document.getElementById('editClearPhoto')?.addEventListener('click', () => {
    const input = document.getElementById('editPhoto');
    const newFileChosen = !!(input && input.files && input.files[0]);
    const img = document.getElementById('editPhotoPreviewImg');
    const placeholder = document.getElementById('editPhotoPlaceholder');
    const clearBtn = document.getElementById('editClearPhoto');
    if (newFileChosen) {
      // A replacement was just picked -> cancel it, keep the stored photo.
      input.value = '';
      if (img) { img.src = '#'; img.style.display = 'none'; }
      if (placeholder) placeholder.textContent = 'Current photo will be kept';
      if (clearBtn) clearBtn.style.display = 'none';
      pendingPhotoRemoval = false;
    } else {
      // No new file -> remove the stored photo on save.
      pendingPhotoRemoval = true;
      if (img) { img.src = '#'; img.style.display = 'none'; }
      if (placeholder) placeholder.textContent = 'Current photo will be removed on save';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  });
}
/** Build Cloudinary-style display prefix that tags the student + school. */
async function studentPhotoPrefix(id) {
  const initials = await getCurrentSchoolInitials();
  return initials && initials !== 'SCH' ? `${id}-${initials}` : id;
}

/** Best-effort deletion of the student's previous photo asset. */
async function deleteStudentPhotoAsset(oldUrl) {
  if (!oldUrl) return;
  try {
    const publicId = getCloudinaryPublicIdFromUrl(oldUrl);
    if (publicId) {
      await deleteCloudinaryFile(oldUrl);
      return;
    }
  } catch (e) { console.warn('Cloudinary photo delete skipped:', e.message); }
  try {
    const marker = '/student-photos/';
    const idx = oldUrl.indexOf(marker);
    if (idx === -1) return;
    const storagePath = oldUrl.substring(idx + marker.length).split('?')[0];
    await supabaseClient.storage.from('student-photos').remove([storagePath]);
  } catch (e) { console.warn('Storage photo delete skipped:', e.message); }
}

/** Save handler — mirrors the inline dashboard edit submit. */
async function handleSubmit(e) {
  e.preventDefault();
  clearMessage('editStudentWindowMessage');
  const btn = document.getElementById('editStudentWindowSubmitBtn');
  setLoading(btn, true, 'Saving...');

  const currentStudentId = document.getElementById('editStudentId').value;

  // Remember the stored photo URL so a replacement/removal can clean it up.
  let previousPhotoUrl = '';
  let photoBeingReplaced = false;
  try {
    const schoolId = await getCurrentSchoolId();
    let prevQuery = supabaseClient.from('applications').select('student_photo_url').eq('student_id', currentStudentId);
    if (schoolId) prevQuery = prevQuery.eq('school_id', schoolId);
    const { data: prevStudent } = await prevQuery.maybeSingle();
    if (prevStudent?.student_photo_url) previousPhotoUrl = prevStudent.student_photo_url;
  } catch (err) { /* best-effort */ }

  const payload = {
    first_name: document.getElementById('editFirstName').value.trim(),
    middle_name: document.getElementById('editMiddleName').value.trim() || null,
    last_name: document.getElementById('editLastName').value.trim(),
    class_applying: document.getElementById('editClass').value,
    term: document.getElementById('editTerm').value,
    date_of_birth: document.getElementById('editDOB').value,
    parent_name: document.getElementById('editParentName').value.trim(),
    parent_contact: document.getElementById('editParentContact').value.trim(),
    home_town: document.getElementById('editHomeTown').value.trim() || null,
    place_of_stay: document.getElementById('editPlaceOfStay').value.trim() || null,
    gender: document.getElementById('editGender').value,
    religion: document.getElementById('editReligion').value,
    teacher: document.getElementById('editTeacher').value.trim() || null,
    previous_school: document.getElementById('editPrevSchool').value.trim() || null,
    admission_date: document.getElementById('editAdmissionDate').value,
    school_id: await getCurrentSchoolId(),
  };
const photoFile = document.getElementById('editPhoto').files[0];
  if (photoFile) {
    const validation = validateImageFile(photoFile, MAX_PHOTO_SIZE_MB);
    if (!validation.valid) {
      showMessage('editStudentWindowMessage', validation.error, 'error');
      document.getElementById('editPhoto').value = '';
      setLoading(btn, false, '💾 Update Student');
      return;
    }
    pendingPhotoRemoval = false;
    const photoUrl = await uploadPhoto(supabaseClient, 'student-photos', photoFile, await studentPhotoPrefix(currentStudentId));
    if (photoUrl) {
      payload.student_photo_url = photoUrl;
      photoBeingReplaced = true;
    }
  } else if (pendingPhotoRemoval) {
    payload.student_photo_url = null;
    photoBeingReplaced = true;
  }

  try {
    const { error } = await supabaseClient.from('applications').update(payload).eq('student_id', currentStudentId);
    if (error) throw error;

    if (previousPhotoUrl && photoBeingReplaced) {
      await deleteStudentPhotoAsset(previousPhotoUrl);
    }
    pendingPhotoRemoval = false;

    showMessage('editStudentWindowMessage', '✅ Student updated.', 'success');
    logSubAdminActivity(`Updated student "${currentStudentId}"`, 'student', currentStudentId);

    // Tell the opener dashboard to refresh its table, then close this popup.
    if (window.opener && typeof window.opener.loadAllStudents === 'function') {
      try { window.opener.loadAllStudents(); } catch (err) { /* best-effort */ }
    }
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    showMessage('editStudentWindowMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Update Student');
  }
}
/**
 * Boot the popup: restore auth, load the student + classes, fill the form,
 * bind the submit handler.
 */
async function initEditStudentWindow() {
  const form = document.getElementById('editStudentWindowForm');
  if (!form) return;

  form.addEventListener('submit', handleSubmit);
  setupPhotoHandlers();

  // Same-origin popup shares the persisted Supabase session.
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData?.session) {
    showMessage('editStudentWindowMessage', '⚠️ Session expired. Close this window and use the app to sign back in.', 'error');
    const subtitle = document.getElementById('editStudentWindowSubtitle');
    if (subtitle) subtitle.textContent = 'Not signed in';
    return;
  }

  if (!studentId) {
    showMessage('editStudentWindowMessage', '⚠️ No student selected. Close this window and try again.', 'error');
    return;
  }

  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('applications').select('*').eq('student_id', studentId);
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: student, error } = await query.maybeSingle();
    if (error) throw error;
    if (!student) {
      showMessage('editStudentWindowMessage', '❌ Student not found.', 'error');
      return;
    }

    populate(student);
    await populateClasses(student.class_applying);
  } catch (err) {
    console.error('Failed to load student in edit window:', err);
    showMessage('editStudentWindowMessage', 'Error loading student: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', initEditStudentWindow);