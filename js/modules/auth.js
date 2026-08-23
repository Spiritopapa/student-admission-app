/**
 * Authentication Module - Login, Register, Logout, Session Management
 * 
 * ID Hierarchy:
 *   super_admin → schools (school admin registers)
 *   school admin → sub_admins (sub admin registers)
 *   sub_admin → students, teachers, accountants, parents (each registers with their ID)
 */

import { getEl, showMessage, clearMessage, getRoleDisplay, clearSchoolIdCache } from './utils.js';

// ================================================================
// State
// ================================================================

let supabaseClient = null;

// School registration wizard state
let _schoolWizard = { regId: '', schoolName: '', schoolId: null, stage: 1 };

export function initAuth(supabase) {
  supabaseClient = supabase;
}

// ================================================================
// Navigation UI Helpers
// ================================================================

export function updateUIForAuth(user, profile) {
  const role = profile?.role || 'student';
  const authLink = getEl('authLink');
  const logoutBtn = getEl('logoutBtn');
  const adminDashLink = getEl('adminDashLink');
  const adminStudentLink = getEl('adminStudentLink');
  const studentDashLink = getEl('studentDashLink');
  const parentDashLink = getEl('parentDashLink');
  const homeLink = getEl('homeLink');

  if (authLink) authLink.style.display = user ? 'none' : 'block';
  if (logoutBtn) logoutBtn.style.display = user ? 'inline-block' : 'none';
  if (adminDashLink) adminDashLink.style.display = (user && (role === 'admin' || role === 'sub_admin')) ? 'block' : 'none';
  if (adminStudentLink) adminStudentLink.style.display = (user && (role === 'admin' || role === 'sub_admin')) ? 'block' : 'none';
  if (studentDashLink) studentDashLink.style.display = (user && role === 'student') ? 'block' : 'none';
  if (parentDashLink) parentDashLink.style.display = (user && role === 'parent') ? 'block' : 'none';
  // Home link is always visible, but ensure it's explicitly shown when logged in
  if (homeLink) homeLink.style.display = 'block';

  // Show/hide the mobile bottom nav based on auth state
  if (window.__setBottomNavVisible) {
    window.__setBottomNavVisible(!!user);
  }
}

// ================================================================
// Register - Super Admin (one-time registration, only if none exists)
// ================================================================

// ================================================================
// Super Admin Registration Guard — hide tab if one already exists
// ================================================================

export async function checkAndGuardSuperAdminRegistration() {
  try {
    const { data: exists } = await supabaseClient.rpc('super_admin_exists');
    const superAdminTab = document.querySelector('.role-tab[data-role="super_admin"]');
    const superAdminForm = document.getElementById('registerSuperAdminForm');
    if (exists) {
      // Hide the Super Admin tab and its form
      if (superAdminTab) {
        superAdminTab.style.display = 'none';
        // If it was active, activate the next available tab
        if (superAdminTab.classList.contains('active')) {
          const firstVisibleTab = document.querySelector('.role-tab:not([style*="display: none"])');
          if (firstVisibleTab) {
            firstVisibleTab.click();
          }
        }
      }
      if (superAdminForm) {
        superAdminForm.style.display = 'none';
        superAdminForm.classList.remove('active-form');
      }
    } else {
      // Show the Super Admin tab and form
      if (superAdminTab) superAdminTab.style.display = '';
      if (superAdminForm) superAdminForm.style.display = '';
    }
  } catch (err) {
    console.error('Error checking super admin existence:', err);
  }
}

export function setupRegisterSuperAdminForm() {
  const form = getEl('registerSuperAdminForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const fullName = getEl('regSuperAdminName').value.trim();
    const email = getEl('regSuperAdminEmail').value.trim();
    const password = getEl('regSuperAdminPassword').value;
    const phone = getEl('regSuperAdminPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      // Check if super admin already exists
      const { data: exists } = await supabaseClient.rpc('super_admin_exists');
      if (exists) {
        showMessage('registerMessage', 'A Super Administrator already exists. Contact your existing Super Admin for access.', 'error');
        return;
      }
      const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, role: 'super_admin', phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: fullName, email, role: 'super_admin', phone,
        });
      }
      showMessage('registerMessage', 'Super Admin account created! You can now sign in with your email and password.', 'success');
      form.reset();
      // Re-check guard after successful registration to hide the tab
      await checkAndGuardSuperAdminRegistration();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - School (via Super Admin generated ID)
// Multi-stage wizard:
//   1) Enter School ID  2) Auto-show School Name  3) School Info
//   4) Set Password
// ================================================================

function schoolWizardRenderSteps() {
  [1, 2, 3, 4].forEach(n => {
    const dot = document.querySelector(`.school-step-dot[data-wstep="${n}"]`);
    if (!dot) return;
    dot.classList.remove('active', 'done');
    if (n < _schoolWizard.stage) dot.classList.add('done');
    else if (n === _schoolWizard.stage) dot.classList.add('active');
  });
}

function schoolWizardShow(stage) {
  ['regSchoolStage1', 'regSchoolStage2', 'regSchoolStage3', 'regSchoolStage4'].forEach(id => {
    const el = getEl(id);
    if (el) el.style.display = 'none';
  });
  getEl('regSchoolStage' + stage).style.display = 'block';
  _schoolWizard.stage = stage;
  schoolWizardRenderSteps();
}

// Stage 1 -> validate ID + fetch & auto-show the school name (Stage 2)
window.schoolWizardGoNext = async function () {
  const regIdInput = getEl('regSchoolID');
  const regId = (regIdInput?.value || '').trim().toUpperCase();
  if (!regId) { schoolWizardSetMsg('Enter the School ID provided by your Super Administrator.', 'error'); regIdInput?.focus(); return; }
  schoolWizardSetMsg('Checking School ID...');
  try {
    const { data: info, error } = await supabaseClient.rpc('get_school_registration_info', { p_registration_id: regId });
    if (error) throw error;
    const row = (info && info.length > 0) ? info[0] : null;
    if (!row) { schoolWizardSetMsg('No school found with that ID. Please check with your Super Administrator.', 'error'); return; }
    _schoolWizard = { regId, schoolName: row.name || regId, schoolId: row.id, stage: 2 };
    const nameEl = getEl('regSchoolNameAuto');
    if (nameEl) nameEl.textContent = row.name || regId;
    schoolWizardSetMsg('');
    schoolWizardShow(2);
  } catch (err) {
    schoolWizardSetMsg('Unable to verify School ID: ' + err.message, 'error');
  }
};

// Stage 3 -> validate school info and persist via anon-safe RPC, then Stage 4
window.schoolWizardGoNext2 = async function () {
  const adminName = getEl('regAdminName')?.value.trim();
  const schoolType = getEl('regSchoolType')?.value;
  const location = getEl('regSchoolLocation')?.value.trim();
  const populationRaw = getEl('regSchoolPopulation')?.value;
  const email = getEl('regSchoolEmail')?.value.trim();
  const phone = getEl('regSchoolPhone')?.value.trim();
  if (!adminName || !schoolType || !location || populationRaw === '' || !phone) {
    schoolWizardSetMsg('Please complete all required school information fields.', 'error');
    return;
  }
  const population = Number(populationRaw);
  if (!Number.isFinite(population) || population < 0) { schoolWizardSetMsg('Student population must be a valid number.', 'error'); return; }
  schoolWizardSetMsg('Saving school information...');
  try {
    const { data: ok, error: saveErr } = await supabaseClient.rpc('save_school_onboarding_info', {
      p_registration_id: _schoolWizard.regId,
      p_admin_name: adminName,
      p_school_type: schoolType,
      p_location: location,
      p_email: email || null,
      p_phone: phone,
      p_student_population: population,
    });
    if (saveErr) {
      // Never advance silently if the onboarding data could not be persisted —
      // otherwise the account may be created but the info never shows on the
      // Super Admin dashboard for this school.
      console.error('save_school_onboarding_info RPC error:', saveErr);
      schoolWizardSetMsg('Could not save school info: ' + saveErr.message, 'error');
      return;
    }
    if (ok === false) {
      schoolWizardSetMsg('This School ID has already been claimed by another account. Please sign in instead.', 'error');
      return;
    }
    schoolWizardSetMsg('');
    schoolWizardShow(4);
  } catch (err) {
    schoolWizardSetMsg('Could not save school info: ' + err.message, 'error');
  }
};

// Straightforward stage navigation (Back buttons + stage-2 Next)
window.schoolWizardGoTo = function (stage) {
  schoolWizardSetMsg('');
  if (stage === 1) {
    schoolWizardShow(1);
    return;
  }
  if (stage === 2) {
    // Re-verify the ID already entered on stage 1.
    if (!_schoolWizard.regId) { window.schoolWizardGoNext(); return; }
    schoolWizardShow(2);
    return;
  }
  if (stage === 3) {
    if (!_schoolWizard.regId) { window.schoolWizardGoNext(); return; }
    schoolWizardShow(3);
    return;
  }
  if (stage === 4) {
    window.schoolWizardGoNext2();
  }
};
window.schoolWizardCreateNext = window.schoolWizardGoNext;

function schoolWizardSetMsg(msg, cls) {
  const el = getEl('schoolRegisterMessage');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg || '';
  el.className = cls === 'error' ? 'message error' : (msg ? 'message' : 'message');
}

export function setupRegisterSchoolForm() {
  const form = getEl('registerSchoolForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('schoolRegisterMessage');
    const regId = getEl('regSchoolID').value.trim().toUpperCase();
    const password = getEl('regSchoolPassword').value;
    const phone = getEl('regSchoolPhone').value.trim();
    const adminName = getEl('regAdminName')?.value.trim() || _schoolWizard.schoolName;
    const schoolType = getEl('regSchoolType')?.value || '';
    const location = getEl('regSchoolLocation')?.value.trim() || '';
    const populationRaw = getEl('regSchoolPopulation')?.value ?? '';
    const schoolEmail = getEl('regSchoolEmail')?.value.trim() || '';
    if (password.length < 6) { showMessage('schoolRegisterMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: idExists } = await supabaseClient.rpc('check_school_id_exists', { target_id: regId });
      if (!idExists) {
        showMessage('schoolRegisterMessage', 'Invalid School Registration ID. Please check with your Super Administrator.', 'error');
        return;
      }

      // === PERSIST THE ONBOARDING INFO BEFORE THE ACCOUNT IS CREATED ===
      // The wizard may have reached this submit button without the earlier
      // stage-3 save succeeding (or with edited fields), so re-save all the
      // school/admin details right now. This guarantees the Super Admin
      // dashboard shows the provided information once the account exists.
      const population = Number(populationRaw);
      if (!adminName || !schoolType || !location || populationRaw === '' || !phone) {
        showMessage('schoolRegisterMessage', 'Please complete all required school information fields.', 'error');
        return;
      }
      if (!Number.isFinite(population) || population < 0) {
        showMessage('schoolRegisterMessage', 'Student population must be a valid number.', 'error');
        return;
      }
      const { data: onboardSaved, error: onboardErr } = await supabaseClient.rpc('save_school_onboarding_info', {
        p_registration_id: regId,
        p_admin_name: adminName,
        p_school_type: schoolType,
        p_location: location,
        p_email: schoolEmail || null,
        p_phone: phone,
        p_student_population: population,
      });
      if (onboardErr) {
        showMessage('schoolRegisterMessage', 'Could not save school info: ' + onboardErr.message, 'error');
        return;
      }
      if (onboardSaved === false) {
        showMessage('schoolRegisterMessage', 'This School ID is no longer available for registration. Please contact your Super Administrator.', 'error');
        return;
      }
      // Use the anon-safe registration RPC (schools table is no longer
      // publicly readable — see sql/035-data-isolation-closure.sql).
      let school = null;
      try {
        const { data: rpcSchool, error: rpcErr } = await supabaseClient.rpc('get_school_registration_info', { p_registration_id: regId });
        if (rpcErr) console.warn('get_school_registration_info failed:', rpcErr.message);
        else if (rpcSchool && rpcSchool.length > 0) school = rpcSchool[0];
      } catch (rpcException) {
        console.warn('get_school_registration_info threw:', rpcException.message);
      }
      const schoolName = _schoolWizard.schoolName || school?.name || regId;
      const schoolId = school?.id || _schoolWizard.schoolId;
      const displayName = adminName || schoolName;
      const { data, error } = await supabaseClient.auth.signUp({
        email: regId.toLowerCase() + '@school.local',
        password,
        options: { data: { full_name: displayName, role: 'admin', registration_id: regId, school_id: schoolId, phone } },
      });
      if (error) { showMessage('schoolRegisterMessage', error.message, 'error'); return; }
      if (data.user) {
        // Link the school record to the new auth user.
        // Self-claim should succeed; fall back to a direct self-claim update if needed.
        try {
          const { error: linkErr } = await supabaseClient.rpc('link_school_to_user', { p_registration_id: regId, p_user_id: data.user.id });
          if (linkErr) {
            console.warn('link_school_to_user RPC failed, applying direct self-claim fallback:', linkErr.message);
            await supabaseClient.from('schools')
              .update({ user_id: data.user.id })
              .eq('registration_id', regId);
          }
        } catch (linkException) {
          console.warn('link_school_to_user threw, applying direct self-claim fallback:', linkException.message);
          await supabaseClient.from('schools')
            .update({ user_id: data.user.id })
            .eq('registration_id', regId);
        }
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: displayName, email: regId.toLowerCase() + '@school.local', role: 'admin', school_id: schoolId, phone,
        });
        // Create default school_settings for this school
        // (The legacy `settings` table has a singleton PK and can only hold ONE global row,
        //  so we use the per-school `school_settings` table here.)
        if (schoolId) {
          await supabaseClient.from('school_settings').upsert({
            school_id: schoolId, school_name: schoolName, academic_year: '2025/2026', current_term: 'First',
          });
        }
      }
      showMessage('schoolRegisterMessage', 'School account created! You can now sign in with your School Registration ID.', 'success');
      form.reset();
      // Reset wizard to stage 1 for a fresh registration.
      _schoolWizard = { regId: '', schoolName: '', schoolId: null, stage: 1 };
      schoolWizardShow(1);
    } catch (err) {
      showMessage('schoolRegisterMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - Sub Admin (via School Admin generated ID)
// ================================================================

export function setupRegisterSubAdminForm() {
  const form = getEl('registerSubAdminForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const regId = getEl('regSubAdminID').value.trim();
    const password = getEl('regSubAdminPassword').value;
    const phone = getEl('regSubAdminPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: idExists } = await supabaseClient.rpc('check_sub_admin_id_exists', { target_id: regId });
      if (!idExists) {
        showMessage('registerMessage', 'Invalid Registration ID. Please check with your School Administrator.', 'error');
        return;
      }
      const { data: subAdmin } = await supabaseClient.from('sub_admins').select('full_name, school_id').eq('registration_id', regId).single();
      const fullName = subAdmin?.full_name || regId;
      const schoolId = subAdmin?.school_id;
      const { data, error } = await supabaseClient.auth.signUp({
        email: regId.toLowerCase() + '@subadmin.local',
        password,
        options: { data: { full_name: fullName, role: 'sub_admin', registration_id: regId, school_id: schoolId, phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        // Link the sub admin record to the new auth user.
        // Self-claim should succeed; fall back to a direct self-claim update if needed.
        try {
          const { error: linkErr } = await supabaseClient.rpc('link_sub_admin_to_user', { p_registration_id: regId, p_user_id: data.user.id });
          if (linkErr) {
            console.warn('link_sub_admin_to_user RPC failed, applying direct self-claim fallback:', linkErr.message);
            await supabaseClient.from('sub_admins')
              .update({ user_id: data.user.id, is_approved: true })
              .eq('registration_id', regId);
          }
        } catch (linkException) {
          console.warn('link_sub_admin_to_user threw, applying direct self-claim fallback:', linkException.message);
          await supabaseClient.from('sub_admins')
            .update({ user_id: data.user.id, is_approved: true })
            .eq('registration_id', regId);
        }
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: fullName, email: regId.toLowerCase() + '@subadmin.local', role: 'sub_admin', school_id: schoolId, phone,
        });
      }
      showMessage('registerMessage', 'Sub Admin account created! You can now sign in with your Registration ID and password.', 'success');
      form.reset();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - Student (via Sub Admin generated ID)
// ================================================================

export function setupRegisterStudentForm() {
  const form = getEl('registerStudentForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const studentID = getEl('regStudentID').value.trim();
    const password = getEl('regStudentPassword').value;
    const phone = getEl('regStudentPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: idExists, error: checkError } = await supabaseClient.rpc('check_student_id_exists', { target_id: studentID });
      if (checkError) {
        console.error('RPC check_student_id_exists error:', checkError);
        showMessage('registerMessage', 'Database function not found. Please re-run supabase-schema.sql in your Supabase SQL Editor.', 'error');
        return;
      }
      if (!idExists) {
        showMessage('registerMessage', 'Invalid Student ID. Please check with your Sub Administrator.', 'error');
        return;
      }
      // Lookup record info via anon-safe SECURITY DEFINER RPC so the
      // profile gets the correct school_id even before sign-up (RLS
      // blocks direct table reads for unauthenticated users). Fall back
      // to direct read for backwards compatibility if the RPC is absent.
      let studentInfo = null;
      try {
        const rpcRes = await supabaseClient.rpc('get_student_registration_info', { p_student_id: studentID }).single();
        if (!rpcRes.error && rpcRes.data) studentInfo = rpcRes.data;
      } catch (rpcErr) {
        console.warn('get_student_registration_info RPC failed:', rpcErr.message);
      }
      if (!studentInfo) {
        const directRes = await supabaseClient.from('applications').select('school_id').eq('student_id', studentID).maybeSingle();
        if (!directRes.error) studentInfo = directRes.data;
      }
      const schoolId = studentInfo?.school_id;
      const { data, error } = await supabaseClient.auth.signUp({
        email: studentID + '@student.local',
        password,
        options: { data: { full_name: studentID, role: 'student', student_id: studentID, school_id: schoolId, phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        // Link the student application record to the new auth user.
        // Self-claim should succeed; fall back to a direct self-claim update if needed.
        try {
          const { error: linkErr } = await supabaseClient.rpc('link_student_to_application', { p_student_id: studentID, p_user_id: data.user.id });
          if (linkErr) {
            console.warn('link_student_to_application RPC failed, applying direct self-claim fallback:', linkErr.message);
            await supabaseClient.from('applications')
              .update({ user_id: data.user.id })
              .eq('student_id', studentID);
          }
        } catch (linkException) {
          console.warn('link_student_to_application threw, applying direct self-claim fallback:', linkException.message);
          await supabaseClient.from('applications')
            .update({ user_id: data.user.id })
            .eq('student_id', studentID);
        }
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: studentID, email: studentID + '@student.local', role: 'student', school_id: schoolId, phone,
        });
      }
      showMessage('registerMessage', 'Student account created! You can now sign in with your Student ID.', 'success');
      form.reset();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - Teacher (via Sub Admin generated ID)
// ================================================================

export function setupRegisterTeacherForm() {
  const form = getEl('registerTeacherForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const regId = getEl('regTeacherID').value.trim();
    const password = getEl('regTeacherPassword').value;
    const phone = getEl('regTeacherPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: idExists } = await supabaseClient.rpc('check_teacher_id_exists', { target_id: regId });
      if (!idExists) {
        showMessage('registerMessage', 'Invalid Teacher Registration ID. Please check with your Sub Administrator.', 'error');
        return;
      }
      // Lookup record info via anon-safe SECURITY DEFINER RPC so the
      // profile gets the correct school_id even before sign-up (RLS
      // blocks direct table reads for unauthenticated users). Fall back
      // to direct read for backwards compatibility if the RPC is absent.
      let teacherInfo = null;
      try {
        const rpcRes = await supabaseClient.rpc('get_teacher_registration_info', { p_registration_id: regId }).single();
        if (!rpcRes.error && rpcRes.data) teacherInfo = rpcRes.data;
      } catch (rpcErr) {
        console.warn('get_teacher_registration_info RPC failed:', rpcErr.message);
      }
      if (!teacherInfo) {
        const directRes = await supabaseClient.from('teachers').select('full_name, school_id').eq('registration_id', regId).single();
        if (!directRes.error) teacherInfo = directRes.data;
      }
      const fullName = teacherInfo?.full_name || regId;
      const schoolId = teacherInfo?.school_id;
      const { data, error } = await supabaseClient.auth.signUp({
        email: regId.toLowerCase() + '@teacher.local',
        password,
        options: { data: { full_name: fullName, role: 'teacher', registration_id: regId, school_id: schoolId, phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        // Link the teacher record to the new auth user.
        // The link RPC may reject if cross-school, but self-claim should succeed.
        // If it fails for any reason, fall back to a direct self-claim update.
        try {
          const { error: linkErr } = await supabaseClient.rpc('link_teacher_to_user', { p_registration_id: regId, p_user_id: data.user.id });
          if (linkErr) {
            console.warn('link_teacher_to_user RPC failed, applying direct self-claim fallback:', linkErr.message);
            await supabaseClient.from('teachers')
              .update({ user_id: data.user.id, is_approved: true })
              .eq('registration_id', regId);
          }
        } catch (linkException) {
          console.warn('link_teacher_to_user threw, applying direct self-claim fallback:', linkException.message);
          await supabaseClient.from('teachers')
            .update({ user_id: data.user.id, is_approved: true })
            .eq('registration_id', regId);
        }
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: fullName, email: regId.toLowerCase() + '@teacher.local', role: 'teacher', school_id: schoolId, phone,
        });
      }
      showMessage('registerMessage', 'Teacher account created! You can now sign in with your Teacher ID.', 'success');
      form.reset();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - Accountant (via Sub Admin generated ID)
// ================================================================

export function setupRegisterAccountantForm() {
  const form = getEl('registerAccountantForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const regId = getEl('regAccountantID').value.trim();
    const password = getEl('regAccountantPassword').value;
    const phone = getEl('regAccountantPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: idExists } = await supabaseClient.rpc('check_accountant_id_exists', { target_id: regId });
      if (!idExists) {
        showMessage('registerMessage', 'Invalid Accountant Registration ID. Please check with your Sub Administrator.', 'error');
        return;
      }
      // Lookup record info via anon-safe SECURITY DEFINER RPC so the
      // profile gets the correct school_id even before sign-up (RLS
      // blocks direct table reads for unauthenticated users). Fall back
      // to direct read for backwards compatibility if the RPC is absent.
      let accountantInfo = null;
      try {
        const rpcRes = await supabaseClient.rpc('get_accountant_registration_info', { p_registration_id: regId }).single();
        if (!rpcRes.error && rpcRes.data) accountantInfo = rpcRes.data;
      } catch (rpcErr) {
        console.warn('get_accountant_registration_info RPC failed:', rpcErr.message);
      }
      if (!accountantInfo) {
        const directRes = await supabaseClient.from('accountants').select('full_name, school_id').eq('registration_id', regId).single();
        if (!directRes.error) accountantInfo = directRes.data;
      }
      const fullName = accountantInfo?.full_name || regId;
      const schoolId = accountantInfo?.school_id;
      const { data, error } = await supabaseClient.auth.signUp({
        email: regId.toLowerCase() + '@accountant.local',
        password,
        options: { data: { full_name: fullName, role: 'accountant', registration_id: regId, school_id: schoolId, phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        // Link the accountant record to the new auth user.
        // Self-claim should succeed; fall back to a direct self-claim update if needed.
        try {
          const { error: linkErr } = await supabaseClient.rpc('link_accountant_to_user', { p_registration_id: regId, p_user_id: data.user.id });
          if (linkErr) {
            console.warn('link_accountant_to_user RPC failed, applying direct self-claim fallback:', linkErr.message);
            await supabaseClient.from('accountants')
              .update({ user_id: data.user.id, is_approved: true })
              .eq('registration_id', regId);
          }
        } catch (linkException) {
          console.warn('link_accountant_to_user threw, applying direct self-claim fallback:', linkException.message);
          await supabaseClient.from('accountants')
            .update({ user_id: data.user.id, is_approved: true })
            .eq('registration_id', regId);
        }
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: fullName, email: regId.toLowerCase() + '@accountant.local', role: 'accountant', school_id: schoolId, phone,
        });
      }
      showMessage('registerMessage', 'Accountant account created! You can now sign in with your Accountant ID.', 'success');
      form.reset();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Register - Parent (via Sub Admin generated Student ID)
// ================================================================

export function setupRegisterParentForm() {
  const form = getEl('registerParentForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('registerMessage');
    const fullName = getEl('regParentName').value.trim();
    const email = getEl('regParentEmail').value.trim();
    const wardID = getEl('regParentWardID').value.trim();
    const password = getEl('regParentPassword').value;
    const phone = getEl('regParentPhone').value.trim();
    if (password.length < 6) { showMessage('registerMessage', 'Password must be at least 6 characters.', 'error'); return; }
    try {
      const { data: wardExists, error: wardError } = await supabaseClient.rpc('check_student_id_exists', { target_id: wardID });
      if (wardError) {
        console.error('RPC check_student_id_exists error:', wardError);
        showMessage('registerMessage', 'Database function not found. Please re-run supabase-schema.sql in your Supabase SQL Editor.', 'error');
        return;
      }
      if (!wardExists) {
        showMessage('registerMessage', 'Ward Student ID not found. Please check with your Sub Administrator.', 'error');
        return;
      }
      const { data: app } = await supabaseClient.from('applications').select('school_id').eq('student_id', wardID).maybeSingle();
      const schoolId = app?.school_id;
      const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, role: 'parent', school_id: schoolId, phone } },
      });
      if (error) { showMessage('registerMessage', error.message, 'error'); return; }
      if (data.user) {
        await supabaseClient.from('parent_links').insert({ parent_user_id: data.user.id, student_id: wardID, school_id: schoolId });
        await supabaseClient.from('profiles').upsert({
          id: data.user.id, full_name: fullName, email, role: 'parent', school_id: schoolId, phone,
        });
      }
      showMessage('registerMessage', 'Parent account created! You can now sign in with your email.', 'success');
      form.reset();
    } catch (err) {
      showMessage('registerMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Login
// ================================================================

/**
 * Map common Supabase Auth error codes to clear, actionable messages.
 * A raw 400 from POST /auth/v1/token (the "Bad Request" seen in the
 * browser console below) hides the real reason; this surfaces it.
 */
function friendlyLoginError(error) {
  const code = String(error.code || '').toLowerCase();
  const msg = String(error.message || '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Invalid login credentials. Check that you entered the correct ID/email and password.';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Your account has not been verified yet. Ask your administrator to confirm your account in the Supabase dashboard (Authentication → Users), then sign in again.';
  }
  if (code === 'user_banned' || msg.includes('user is banned')) {
    return 'This account has been disabled. Please contact your administrator.';
  }
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit')) {
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  return error.message;
}
export function setupLoginForm(loadDashboardCallbacks) {
  const form = getEl('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('loginMessage');
    const identifier = getEl('loginIdentifier').value.trim();
    const password = getEl('loginPassword').value;
    try {
      // Role registration IDs come in two formats depending on when the account
      // was onboarded, and BOTH must be accepted here:
      //   old: SCH-0001 / TCH-0001 / ACC-0001          (plain 4-digit serial)
      //   new: SCH-SIS-0001 / TCH-SIN-0001 / ACC-SIN-0001
      //        (up to 3 school-name initials + 4-digit serial;
      //         see sql/044-school-onboarding.sql & sql/046-per-school-staff-ids.sql)
      // Before this relaxed pattern, an admin/teacher/accountant whose printed
      // registration ID used the new initials format was not detected as a role
      // ID here, so the raw ID string (e.g. "SCH-SIS-0001") was submitted as the
      // "email" and Supabase rejected it with HTTP 400 invalid_credentials.
      const isStudentID = /^STU-[A-Z0-9]{5}$/i.test(identifier);
      const isSubAdminID = /^SA-\d{4}$/i.test(identifier);
      const isTeacherID = /^TCH-([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
      const isAccountantID = /^ACC-([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
      const isSchoolID = /^SCH-([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
      let email;
      if (isStudentID) {
        email = identifier + '@student.local';
      } else if (isSubAdminID) {
        email = identifier.toLowerCase() + '@subadmin.local';
      } else if (isTeacherID) {
        email = identifier.toLowerCase() + '@teacher.local';
      } else if (isAccountantID) {
        email = identifier.toLowerCase() + '@accountant.local';
      } else if (isSchoolID) {
        email = identifier.toLowerCase() + '@school.local';
      } else {
        // Check if this is a staff ID (not an email)
        if (!identifier.includes('@')) {
          // Look up the teacher by staff ID to find their registration ID
          try {
            const { data: staffTeacher } = await supabaseClient.rpc('get_teacher_info_by_staff_id', { p_staff_id: identifier });
            if (staffTeacher && staffTeacher.length > 0 && staffTeacher[0].registration_id) {
              email = staffTeacher[0].registration_id.toLowerCase() + '@teacher.local';
            } else {
              // Fallback: try direct query
              const { data: directTeacher } = await supabaseClient.from('teachers')
                .select('registration_id')
                .eq('staff_id', identifier)
                .maybeSingle();
              if (directTeacher?.registration_id) {
                email = directTeacher.registration_id.toLowerCase() + '@teacher.local';
              } else {
                email = identifier;
              }
            }
          } catch (staffErr) {
            // Fallback: try direct query
            const { data: directTeacher } = await supabaseClient.from('teachers')
              .select('registration_id')
              .eq('staff_id', identifier)
              .maybeSingle();
            if (directTeacher?.registration_id) {
              email = directTeacher.registration_id.toLowerCase() + '@teacher.local';
            } else {
              email = identifier;
            }
          }
        } else {
          email = identifier;
        }
      }
      // Clear cached school_id to ensure fresh fetch for the new user
      clearSchoolIdCache();

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) { showMessage('loginMessage', friendlyLoginError(error), 'error'); return; }
      const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', data.user.id).single();
      const role = profile?.role || 'student';

      // SCHOOL ADMIN GUARD: Check if school is linked to this user.
      // If not linked, try self-heal by registration_id from metadata.
      if (role === 'admin') {
        const regId = data.user.user_metadata?.registration_id || null;
        let { data: school } = await supabaseClient.from('schools')
          .select('id')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (!school && regId) {
          // Self-heal: look up by registration_id and auto-link
          const { data: byReg } = await supabaseClient.from('schools')
            .select('id')
            .eq('registration_id', regId)
            .maybeSingle();
          if (byReg) {
            try {
              await supabaseClient.rpc('auto_approve_school_on_login', { p_user_id: data.user.id, p_registration_id: regId });
            } catch (healErr) {
              console.warn('auto_approve_school_on_login RPC failed:', healErr.message);
              await supabaseClient.from('schools')
                .update({ user_id: data.user.id })
                .eq('registration_id', regId);
            }
            school = { id: byReg.id };
          }
        }
        if (!school) {
          await supabaseClient.auth.signOut();
          showMessage('loginMessage', 'School account not linked. Please contact the Super Administrator.', 'error');
          updateUIForAuth(null, null);
          return;
        }
      }

      // SUB ADMIN GUARD: Check if sub admin is approved.
      // If not found by user_id, try self-heal by registration_id from metadata.
      if (role === 'sub_admin') {
        const regId = data.user.user_metadata?.registration_id || null;
        let { data: subAdmin } = await supabaseClient.from('sub_admins')
          .select('is_approved')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (!subAdmin && regId) {
          // Self-heal: look up by registration_id and auto-link if pre-approved
          const { data: byReg } = await supabaseClient.from('sub_admins')
            .select('is_approved')
            .eq('registration_id', regId)
            .maybeSingle();
          if (byReg && byReg.is_approved) {
            try {
              await supabaseClient.rpc('auto_approve_sub_admin_on_login', { p_user_id: data.user.id, p_registration_id: regId });
            } catch (healErr) {
              console.warn('auto_approve_sub_admin_on_login RPC failed:', healErr.message);
              await supabaseClient.from('sub_admins')
                .update({ user_id: data.user.id })
                .eq('registration_id', regId)
                .eq('is_approved', true);
            }
            subAdmin = { is_approved: true };
          }
        }
        if (!subAdmin || !subAdmin.is_approved) {
          await supabaseClient.auth.signOut();
          showMessage('loginMessage', 'Your account is pending approval. Please wait for the School Administrator to approve your account.', 'error');
          updateUIForAuth(null, null);
          return;
        }
      }

      // TEACHER GUARD: Check if teacher is approved.
      // First try by linked user_id. If not found, fall back to the
      // registration_id from user metadata (self-heal for accounts whose
      // record was never linked due to the old link-function restriction).
      if (role === 'teacher') {
        const regId = data.user.user_metadata?.registration_id || null;
        let { data: teacher } = await supabaseClient.from('teachers')
          .select('is_approved')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (!teacher && regId) {
          // Self-heal: look up by registration_id and auto-link if pre-approved
          const { data: byReg } = await supabaseClient.from('teachers')
            .select('is_approved')
            .eq('registration_id', regId)
            .maybeSingle();
          if (byReg && byReg.is_approved) {
            try {
              await supabaseClient.rpc('auto_approve_teacher_on_login', { p_user_id: data.user.id, p_registration_id: regId });
            } catch (healErr) {
              console.warn('auto_approve_teacher_on_login RPC failed:', healErr.message);
              await supabaseClient.from('teachers')
                .update({ user_id: data.user.id })
                .eq('registration_id', regId)
                .eq('is_approved', true);
            }
            teacher = { is_approved: true };
          }
        }
        if (!teacher || !teacher.is_approved) {
          await supabaseClient.auth.signOut();
          showMessage('loginMessage', 'Your account is pending approval. Please wait for the Sub Administrator to approve your account.', 'error');
          updateUIForAuth(null, null);
          return;
        }
      }

      // ACCOUNTANT GUARD: Check if accountant is approved.
      // Same self-heal logic as teachers.
      if (role === 'accountant') {
        const regId = data.user.user_metadata?.registration_id || null;
        let { data: accountant } = await supabaseClient.from('accountants')
          .select('is_approved')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (!accountant && regId) {
          // Self-heal: look up by registration_id and auto-link if pre-approved
          const { data: byReg } = await supabaseClient.from('accountants')
            .select('is_approved')
            .eq('registration_id', regId)
            .maybeSingle();
          if (byReg && byReg.is_approved) {
            try {
              await supabaseClient.rpc('auto_approve_accountant_on_login', { p_user_id: data.user.id, p_registration_id: regId });
            } catch (healErr) {
              console.warn('auto_approve_accountant_on_login RPC failed:', healErr.message);
              await supabaseClient.from('accountants')
                .update({ user_id: data.user.id })
                .eq('registration_id', regId)
                .eq('is_approved', true);
            }
            accountant = { is_approved: true };
          }
        }
        if (!accountant || !accountant.is_approved) {
          await supabaseClient.auth.signOut();
          showMessage('loginMessage', 'Your account is pending approval. Please wait for the Sub Administrator to approve your account.', 'error');
          updateUIForAuth(null, null);
          return;
        }
      }

      updateUIForAuth(data.user, profile);
      form.reset();

      // Clear dismissed announcements so they reappear on next login
      try { localStorage.removeItem('_dismissedAnnouncements'); } catch (e) { /* ignore */ }

      if (loadDashboardCallbacks) {
        if (role === 'super_admin') {
          loadDashboardCallbacks.showPage('super-admin-dashboard');
          if (loadDashboardCallbacks.loadSuperAdminDashboard) loadDashboardCallbacks.loadSuperAdminDashboard();
        } else if (role === 'admin' || role === 'sub_admin') {
          loadDashboardCallbacks.showPage('admin-dashboard');
          if (loadDashboardCallbacks.loadAdminDashboard) loadDashboardCallbacks.loadAdminDashboard();
        } else if (role === 'student') {
          loadDashboardCallbacks.showPage('student-dashboard');
          if (loadDashboardCallbacks.loadStudentDashboard) loadDashboardCallbacks.loadStudentDashboard(data.user);
        } else if (role === 'parent') {
          loadDashboardCallbacks.showPage('parent-dashboard');
          if (loadDashboardCallbacks.loadParentDashboard) loadDashboardCallbacks.loadParentDashboard(data.user);
        } else if (role === 'teacher') {
          loadDashboardCallbacks.showPage('teacher-dashboard');
          if (loadDashboardCallbacks.loadTeacherDashboard) loadDashboardCallbacks.loadTeacherDashboard(data.user);
        } else if (role === 'accountant') {
          loadDashboardCallbacks.showPage('accountant-dashboard');
          if (loadDashboardCallbacks.loadAccountantDashboard) loadDashboardCallbacks.loadAccountantDashboard();
        } else {
          loadDashboardCallbacks.showPage('home');
        }
      }
    } catch (err) {
      showMessage('loginMessage', 'Unexpected error: ' + err.message, 'error');
    }
  });
}

// ================================================================
// Inactivity Auto-Logout (5 minutes)
// ================================================================

const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds
let inactivityTimer = null;
let inactivityEventsBound = false;

/**
 * Set up activity listeners that auto-logout the user after 5 minutes of inactivity.
 * The timer is only active when a user session exists.
 */
function setupInactivityLogout() {
  if (inactivityEventsBound) return;
  inactivityEventsBound = true;

  // Events that count as user activity
  const activityEvents = ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointerdown'];

  const activityHandler = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);

    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        inactivityTimer = setTimeout(triggerInactivityLogout, INACTIVITY_TIMEOUT);
      }
    });
  };

  activityEvents.forEach(evt => {
    document.addEventListener(evt, activityHandler, { passive: true });
  });

  // Start the timer immediately if a session exists
  activityHandler();
}

/**
 * Trigger the inactivity auto-logout.
 * Logs the user out immediately without any confirmation prompt.
 */
async function triggerInactivityLogout() {
  // Check if user is still logged in
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    return;
  }

  // Auto-logout immediately
  await handleLogout();
}

/**
 * Clear the inactivity timer (called on logout).
 */
function clearInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

// ================================================================
// Logout
// ================================================================

export async function handleLogout() {
  clearSchoolIdCache();
  // Reset the admin students cache so a previously signed-in school's student
  // list can never appear in the next signed-in school's dashboard/students module.
  if (typeof window.resetAdminStudentsCache === 'function') window.resetAdminStudentsCache();
  clearInactivityTimer();
  await supabaseClient.auth.signOut();
  updateUIForAuth(null, null);
  // Import showPage dynamically to avoid circular dependency
  const { showPage } = await import('./navigation.js');
  showPage('home');
}

// Make available globally for inline onclick handlers
window.handleLogout = handleLogout;

// ================================================================
// Session Management
// ================================================================

export async function initSession(loadDashboardCallbacks) {
  // Clear cached school_id to ensure fresh fetch for the current session user
  clearSchoolIdCache();

  // Set up inactivity auto-logout (5 minutes)
  setupInactivityLogout();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single();
    updateUIForAuth(session.user, profile);
    const role = profile?.role || 'student';
    if (loadDashboardCallbacks) {
      if (role === 'super_admin') {
        if (loadDashboardCallbacks.loadSuperAdminDashboard) loadDashboardCallbacks.loadSuperAdminDashboard();
      } else if (role === 'admin' || role === 'sub_admin') {
        if (loadDashboardCallbacks.loadAdminDashboard) loadDashboardCallbacks.loadAdminDashboard();
      } else if (role === 'student') {
        if (loadDashboardCallbacks.loadStudentDashboard) loadDashboardCallbacks.loadStudentDashboard(session.user);
      } else if (role === 'parent') {
        if (loadDashboardCallbacks.loadParentDashboard) loadDashboardCallbacks.loadParentDashboard(session.user);
      } else if (role === 'teacher') {
        if (loadDashboardCallbacks.loadTeacherDashboard) loadDashboardCallbacks.loadTeacherDashboard(session.user);
      } else if (role === 'accountant') {
        if (loadDashboardCallbacks.loadAccountantDashboard) loadDashboardCallbacks.loadAccountantDashboard();
      }
    }
  } else {
    updateUIForAuth(null, null);
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    if (!user) { updateUIForAuth(null, null); return; }
    setTimeout(async () => {
      const { data: p } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
      updateUIForAuth(user, p);
    }, 500);
  });
}
