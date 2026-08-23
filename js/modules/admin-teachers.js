/**
 * Admin Teachers Module - Teacher management, teacher registration ID generation
 * Updated to support multiple class and subject assignments per teacher
 */

import { getEl, showMessage, clearMessage, setLoading, logSubAdminActivity, getCurrentSchoolId, parseCSVLine, openPrintWindow } from './utils.js';

let supabaseClient = null;

export function initAdminTeachers(supabase) {
  supabaseClient = supabase;
}

export function setupTeacherForm() {
  // Teacher ID generation
  getEl('btnGenerateTeacherId')?.addEventListener('click', generateTeacherId);
  getEl('newTeacherForm')?.addEventListener('submit', saveNewTeacher);

  // Existing teacher CRUD
  getEl('addTeacherBtn')?.addEventListener('click', async () => {
    getEl('teacherEditId').value = '';
    getEl('teacherForm').reset();
    getEl('teacherFormSection').open = true;
    await populateTeacherFormDropdowns();
  });

  getEl('teacherForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('teacherMessage');
    const btn = getEl('teacherSubmitBtn');
    setLoading(btn, true, 'Saving...');
    const editId = getEl('teacherEditId').value;
    
    // Get selected classes and subjects from multi-select
    const classSelect = getEl('teacherClass');
    const subjectSelect = getEl('teacherSubject');
    const selectedClasses = Array.from(classSelect.selectedOptions).map(o => o.value);
    const selectedSubjects = Array.from(subjectSelect.selectedOptions).map(o => o.value);
    
    const payload = {
      full_name: getEl('teacherFullName').value.trim(),
      email: getEl('teacherEmail').value.trim() || null,
      phone: getEl('teacherPhone').value.trim() || null,
      class_taught: selectedClasses.join(', ') || null,
      subject: selectedSubjects.join(', ') || null,
      qualification: getEl('teacherQualification').value.trim() || null,
      is_active: getEl('teacherActive').value === 'true',
      first_name: getEl('teacherFirstName')?.value.trim() || null,
      middle_name: getEl('teacherMiddleName')?.value.trim() || null,
      surname: getEl('teacherSurname')?.value.trim() || null,
      dob: getEl('teacherDob')?.value || null,
      gender: getEl('teacherGender')?.value || null,
      region: getEl('teacherRegion')?.value.trim() || null,
      marital_status: getEl('teacherMaritalStatus')?.value || null,
      disability: getEl('teacherDisability')?.value.trim() || null,
      place_of_birth: getEl('teacherPlaceOfBirth')?.value.trim() || null,
      nationality: getEl('teacherNationality')?.value.trim() || null,
      religion: getEl('teacherReligion')?.value.trim() || null,
      staff_id: getEl('teacherStaffId')?.value.trim() || null,
      mobile_number: getEl('teacherMobileNumber')?.value.trim() || null,
      ghana_card_number: getEl('teacherGhanaCard')?.value.trim() || null,
      tin_number: getEl('teacherTin')?.value.trim() || null,
      ntc_number: getEl('teacherNtc')?.value.trim() || null,
      ssnit_number: getEl('teacherSsnit')?.value.trim() || null,
      certificate_number: getEl('teacherCertificate')?.value.trim() || null,
      emis_code: getEl('teacherEmis')?.value.trim() || null,
      date_first_appointment_district: getEl('teacherDateFirstAppointment')?.value || null,
      date_transfer_last_school: getEl('teacherDateTransfer')?.value || null,
      date_promoted_present_rank: getEl('teacherDatePromoted')?.value || null,
      date_last_upgrading: getEl('teacherDateUpgrading')?.value || null,
      school_name: getEl('teacherSchoolName')?.value.trim() || null,
      school_region: getEl('teacherSchoolRegion')?.value.trim() || null,
      circuit: getEl('teacherCircuit')?.value.trim() || null,
      district: getEl('teacherDistrict')?.value.trim() || null,
      rank: getEl('teacherRank')?.value.trim() || null,
      salary_scale: getEl('teacherSalaryScale')?.value.trim() || null,
      salary_step: getEl('teacherSalaryStep')?.value.trim() || null,
      date_assumption_district: getEl('teacherDateAssumptionDistrict')?.value || null,
      date_assumption_present_station: getEl('teacherDateAssumptionStation')?.value || null,
      college_attended: getEl('teacherCollegeAttended')?.value.trim() || null,
      shs_attended: getEl('teacherShsAttended')?.value.trim() || null,
      salary_level: getEl('teacherSalaryLevel')?.value.trim() || null,
      bank_account_name: getEl('teacherBankAccountName')?.value.trim() || null,
      bank_account_number: getEl('teacherBankAccountNumber')?.value.trim() || null,
      account_branch: getEl('teacherAccountBranch')?.value.trim() || null,
      home_town: getEl('teacherHomeTown')?.value.trim() || null,
      area_of_specialization: getEl('teacherAreaSpecialization')?.value.trim() || null,
      professional_qualification: getEl('teacherProfessionalQualification')?.value.trim() || null,
      academic_qualification: getEl('teacherAcademicQualification')?.value.trim() || null,
    };
    
    try {
      if (editId) {
        const { error } = await supabaseClient.from('teachers').update(payload).eq('id', editId);
        if (error) throw error;
        
        // Update class-subject assignments
        await saveTeacherClassSubjects(editId, selectedClasses, selectedSubjects);
        
        showMessage('teacherMessage', '✅ Teacher updated successfully.', 'success');
        logSubAdminActivity(`Updated teacher "${payload.full_name}"`, 'teacher', payload.full_name);
      } else {
        const { data, error } = await supabaseClient.from('teachers').insert([payload]).select();
        if (error) throw error;
        
        if (data && data.length > 0) {
          // Save class-subject assignments
          await saveTeacherClassSubjects(data[0].id, selectedClasses, selectedSubjects);
        }
        
        showMessage('teacherMessage', '✅ Teacher added successfully.', 'success');
        logSubAdminActivity(`Created teacher "${payload.full_name}"`, 'teacher', payload.full_name);
      }
      getEl('teacherForm').reset();
      getEl('teacherEditId').value = '';
      await renderTeachersTable();
    } catch (err) { showMessage('teacherMessage', 'Error: ' + err.message, 'error'); }
    finally { setLoading(btn, false, 'Save Teacher'); }
  });

  getEl('adminTeachersSearch')?.addEventListener('input', renderTeachersTable);
  
  // CSV Export/Import
  getEl('btnExportTeachersCSV')?.addEventListener('click', exportTeachersCSV);
  getEl('btnImportTeachersCSV')?.addEventListener('click', () => getEl('csvTeachersImportInput')?.click());
  getEl('csvTeachersImportInput')?.addEventListener('change', importTeachersCSV);
}

/**
 * Save teacher class-subject assignments to the junction table
 */
async function saveTeacherClassSubjects(teacherId, classes, subjects) {
  if (!teacherId) return;
  
  try {
    const schoolId = await getCurrentSchoolId();
    
    // Delete existing assignments
    await supabaseClient.from('teacher_classes_subjects').delete().eq('teacher_id', teacherId);
    
    // Insert new assignments
    const assignments = [];
    classes.forEach(cls => {
      subjects.forEach(sub => {
        assignments.push({
          teacher_id: teacherId,
          class_name: cls,
          subject_name: sub,
          school_id: schoolId
        });
      });
    });
    
    if (assignments.length > 0) {
      const { error } = await supabaseClient.from('teacher_classes_subjects').insert(assignments);
      if (error) console.error('Error saving teacher class-subject assignments:', error);
    }
  } catch (err) {
    console.error('Failed to save teacher class-subject assignments:', err);
  }
}

// ================================================================
// Teacher ID Generation
// ================================================================

async function generateTeacherId() {
  try {
    const schoolId = await getCurrentSchoolId();
    const { data: regId, error } = await supabaseClient.rpc('generate_teacher_id', { p_school_id: schoolId });
    if (error) { alert('Error generating ID: ' + error.message); return; }
    getEl('newTeacherRegId').value = regId || 'TCH-0001';
    getEl('newTeacherSection').style.display = 'block';
    getEl('newTeacherSection').open = true;
  } catch (err) { alert('Error: ' + err.message); }
}

async function saveNewTeacher(e) {
  e.preventDefault();
  clearMessage('newTeacherMessage');
  const btn = getEl('saveTeacherBtn');
  setLoading(btn, true, 'Creating...');
  const fullName = getEl('newTeacherName').value.trim();
  
  const regId = getEl('newTeacherRegId').value.trim();
  if (!fullName || !regId) { showMessage('newTeacherMessage', 'Name and Registration ID are required.', 'error'); setLoading(btn, false, '✅ Create Teacher & Generate ID'); return; }
  
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const schoolId = await getCurrentSchoolId();
    const { data, error } = await supabaseClient.from('teachers').insert([{
      registration_id: regId, full_name: fullName, school_id: schoolId,
      created_by: user?.id || null, is_approved: true,
    }]).select();
    
    if (error) { showMessage('newTeacherMessage', 'Error: ' + error.message, 'error'); setLoading(btn, false, '✅ Create Teacher & Generate ID'); return; }
    
    showMessage('newTeacherMessage', `✅ Teacher "${fullName}" created with ID: ${regId}. Provide this ID to them for registration.`, 'success');
    getEl('newTeacherName').value = '';
    getEl('newTeacherRegId').value = '';
    getEl('newTeacherSection').style.display = 'none';
    await renderTeachersTable();
  } catch (err) { showMessage('newTeacherMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, '✅ Create Teacher & Generate ID'); }
}

// ================================================================
// Teacher CRUD
// ================================================================

window.editTeacher = async function (id) {
  try {
    // Fetch the full teacher record from the database
    const { data: teacher, error } = await supabaseClient.from('teachers').select('*').eq('id', id).single();
    if (error || !teacher) { alert('Error loading teacher: ' + (error?.message || 'Teacher not found.')); return; }
    
    // Basic fields
    getEl('teacherEditId').value = teacher.id;
    getEl('teacherFullName').value = teacher.full_name || '';
    getEl('teacherEmail').value = teacher.email || '';
    getEl('teacherPhone').value = teacher.phone || '';
    getEl('teacherQualification').value = teacher.qualification || '';
    getEl('teacherActive').value = teacher.is_active ? 'true' : 'false';
    
    // Personal Information
    getEl('teacherFirstName').value = teacher.first_name || '';
    getEl('teacherMiddleName').value = teacher.middle_name || '';
    getEl('teacherSurname').value = teacher.surname || '';
    getEl('teacherDob').value = teacher.dob || '';
    getEl('teacherGender').value = teacher.gender || '';
    getEl('teacherRegion').value = teacher.region || '';
    getEl('teacherMaritalStatus').value = teacher.marital_status || '';
    getEl('teacherDisability').value = teacher.disability || '';
    getEl('teacherPlaceOfBirth').value = teacher.place_of_birth || '';
    getEl('teacherNationality').value = teacher.nationality || '';
    getEl('teacherReligion').value = teacher.religion || '';
    
    // Identification
    getEl('teacherStaffId').value = teacher.staff_id || '';
    getEl('teacherMobileNumber').value = teacher.mobile_number || '';
    getEl('teacherGhanaCard').value = teacher.ghana_card_number || '';
    getEl('teacherTin').value = teacher.tin_number || '';
    getEl('teacherNtc').value = teacher.ntc_number || '';
    getEl('teacherSsnit').value = teacher.ssnit_number || '';
    getEl('teacherCertificate').value = teacher.certificate_number || '';
    getEl('teacherEmis').value = teacher.emis_code || '';
    
    // Appointment & School
    getEl('teacherDateFirstAppointment').value = teacher.date_first_appointment_district || '';
    getEl('teacherDateTransfer').value = teacher.date_transfer_last_school || '';
    getEl('teacherDatePromoted').value = teacher.date_promoted_present_rank || '';
    getEl('teacherDateUpgrading').value = teacher.date_last_upgrading || '';
    getEl('teacherSchoolName').value = teacher.school_name || '';
    getEl('teacherSchoolRegion').value = teacher.school_region || '';
    getEl('teacherCircuit').value = teacher.circuit || '';
    getEl('teacherDistrict').value = teacher.district || '';
    
    // Rank & Salary
    getEl('teacherRank').value = teacher.rank || '';
    getEl('teacherSalaryScale').value = teacher.salary_scale || '';
    getEl('teacherSalaryStep').value = teacher.salary_step || '';
    
    // Education & Additional Info
    getEl('teacherDateAssumptionDistrict').value = teacher.date_assumption_district || '';
    getEl('teacherDateAssumptionStation').value = teacher.date_assumption_present_station || '';
    getEl('teacherCollegeAttended').value = teacher.college_attended || '';
    getEl('teacherShsAttended').value = teacher.shs_attended || '';
    getEl('teacherSalaryLevel').value = teacher.salary_level || '';
    getEl('teacherBankAccountName').value = teacher.bank_account_name || '';
    getEl('teacherBankAccountNumber').value = teacher.bank_account_number || '';
    getEl('teacherAccountBranch').value = teacher.account_branch || '';
    getEl('teacherHomeTown').value = teacher.home_town || '';
    getEl('teacherAreaSpecialization').value = teacher.area_of_specialization || '';
    getEl('teacherProfessionalQualification').value = teacher.professional_qualification || '';
    getEl('teacherAcademicQualification').value = teacher.academic_qualification || '';
    
    // Populate dropdowns
    await populateTeacherFormDropdowns();
    
    // Select the assigned classes and subjects
    const classSelect = getEl('teacherClass');
    const subjectSelect = getEl('teacherSubject');
    
    if (teacher.class_taught) {
      const assignedClasses = teacher.class_taught.split(',').map(c => c.trim());
      Array.from(classSelect.options).forEach(opt => {
        if (assignedClasses.includes(opt.value)) {
          opt.selected = true;
        }
      });
    }
    
    if (teacher.subject) {
      const assignedSubjects = teacher.subject.split(',').map(s => s.trim());
      Array.from(subjectSelect.options).forEach(opt => {
        if (assignedSubjects.includes(opt.value)) {
          opt.selected = true;
        }
      });
    }
    
    getEl('teacherFormSection').open = true;
  } catch (err) {
    alert('Error loading teacher: ' + err.message);
  }
};

window.deleteTeacher = async function (id) {
  if (!confirm('Delete this teacher record?')) return;
  const { data: teacher } = await supabaseClient.from('teachers').select('full_name').eq('id', id).single();
  
  // Delete class-subject assignments
  await supabaseClient.from('teacher_classes_subjects').delete().eq('teacher_id', id);
  
  const { error } = await supabaseClient.from('teachers').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderTeachersTable();
  logSubAdminActivity(`Deleted teacher "${teacher?.full_name || id}"`, 'teacher', teacher?.full_name || id);
};

// Approve teacher (for teacher registration system)
window.approveTeacher = async function (teacherId) {
  try {
    const { error } = await supabaseClient.from('teachers').update({ is_approved: true }).eq('id', teacherId);
    if (error) { alert('Error: ' + error.message); return; }
    await renderTeachersTable();
  } catch (err) { alert('Error: ' + err.message); }
};

// Unlink teacher auth user
window.unlinkTeacherUser = async function (teacherId) {
  if (!confirm('Unlink the teacher\'s auth account? They will need to register again.')) return;
  try {
    const { error } = await supabaseClient.from('teachers').update({ user_id: null }).eq('id', teacherId);
    if (error) { alert('Error: ' + error.message); return; }
    await renderTeachersTable();
  } catch (err) { alert('Error: ' + err.message); }
};

async function populateTeacherFormDropdowns() {
  const classSelect = getEl('teacherClass');
  const subjectSelect = getEl('teacherSubject');
  if (!classSelect || !subjectSelect) return;
  try {
    const schoolId = await getCurrentSchoolId();
    let classesQuery = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    let subjectsQuery = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
    if (schoolId) {
      classesQuery = classesQuery.eq('school_id', schoolId);
      subjectsQuery = subjectsQuery.eq('school_id', schoolId);
    }
    const [classesRes, subjectsRes] = await Promise.all([
      classesQuery,
      subjectsQuery
    ]);
    if (classesRes.data && classesRes.data.length > 0) {
      classSelect.innerHTML = classesRes.data.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
    }
    if (subjectsRes.data && subjectsRes.data.length > 0) {
      subjectSelect.innerHTML = subjectsRes.data.map((s) => `<option value="${s.name}">${s.name}</option>`).join('');
    }
  } catch (err) { console.error('Failed to load class/subject lists:', err); }
}

export async function renderTeachersTable() {
  const search = (getEl('adminTeachersSearch')?.value || '').toLowerCase();
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('teachers').select('*');
  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) { console.error('Load teachers error:', error); return; }
  let items = data || [];
  if (search) items = items.filter((t) => {
    const searchable = [
      t.full_name, t.first_name, t.middle_name, t.surname, t.email, t.phone,
      t.class_taught, t.subject, t.registration_id, t.staff_id, t.mobile_number, t.ghana_card_number,
      t.tin_number, t.ntc_number, t.ssnit_number, t.certificate_number, t.emis_code,
      t.gender, t.region, t.district, t.school_name, t.circuit, t.rank,
      t.salary_scale, t.salary_step, t.nationality, t.religion, t.marital_status,
      t.place_of_birth, t.disability
    ].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(search);
  });
  const tbody = getEl('adminTeachersBody');
  const noEl = getEl('adminNoTeachers');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';

  // Check if we're in the new teacher system (with registration_id) or old system
  tbody.innerHTML = items.map((t) => {
    const statusBadge = t.is_active ? '<span class="badge-confirmed">Active</span>' : '<span class="badge-unconfirmed">Inactive</span>';
    const regIdDisplay = t.registration_id
      ? `<strong style="font-size:0.85rem;color:var(--primary-dark);letter-spacing:0.5px;">${t.registration_id}</strong>`
      : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';
    const regStatus = t.registration_id
      ? (t.user_id
        ? '<span style="color:var(--success);font-size:0.75rem;">✅ Registered</span>'
        : '<span style="color:var(--text-muted);font-size:0.75rem;">🔗 Not registered</span>')
      : '';
    const approveBtn = t.registration_id
      ? (t.is_approved
        ? '<span class="action-btn" style="background:var(--bg);color:var(--text-muted);cursor:default;">Done</span>'
        : `<button class="action-btn confirm" onclick="approveTeacher('${t.id}')">✅ Approve</button>`)
      : '';
    const unlinkBtn = (t.registration_id && t.user_id)
      ? `<button class="action-btn" onclick="unlinkTeacherUser('${t.id}')">🔗 Unlink</button>`
      : '';
    
    const photoHtml = t.photo_url
      ? `<img src="${t.photo_url}" class="dash-photo" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`
      : '<span class="dash-photo-placeholder">👨‍🏫</span>';
    const resetPwBtn = `<button class="action-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;" onclick="openAdminResetPassword('teacher','${t.id}','${t.full_name.replace(/'/g, "\\'")}')">🔑 Password</button>`;
    const actionBtns = `<button class="action-btn confirm" onclick="viewTeacherDetails('${t.id}')">👁 View</button><button class="action-btn confirm" onclick="editTeacher('${t.id}')">Edit</button>${resetPwBtn}<button class="action-btn danger" onclick="deleteTeacher('${t.id}')">Delete</button>`;
    const hasRegistration = !!t.registration_id;
    return `<tr>
      <td>${photoHtml}</td>
      <td><strong>${t.full_name}</strong></td>
      <td>${t.email || '-'}</td>
      <td>${t.phone || '-'}</td>
      <td>${t.class_taught || '-'}</td>
      <td>${t.subject || '-'}</td>
      <td>${t.qualification || '-'}</td>
      <td>${statusBadge}</td>
      <td>${regIdDisplay}${regStatus ? '<br>' + regStatus : ''}</td>
      <td>${hasRegistration ? approveBtn : '-'}</td>
      <td>${actionBtns}${unlinkBtn ? ' ' + unlinkBtn : ''}</td>
    </tr>`;
  }).join('');
}

// ================================================================
// View Teacher Details Modal
// ================================================================

window.viewTeacherDetails = async function (teacherId) {
  try {
    const { data: teacher } = await supabaseClient.from('teachers').select('*').eq('id', teacherId).single();
    if (!teacher) { alert('Teacher not found.'); return; }
    
    // Get documents
    const { data: documents } = await supabaseClient.from('teacher_documents')
      .select('*')
      .eq('teacher_id', teacherId);
    
    const docHtml = (documents || []).map(d => `
      <div style="margin-bottom:0.5rem;">
        <a href="${d.file_url}" target="_blank" class="btn btn-sm btn-secondary">📄 ${d.document_type === 'certificate' ? 'Certificate' : 'Appointment Letter'}: ${d.file_name || 'View'}</a>
      </div>
    `).join('') || '<span style="color:var(--text-muted);">No documents uploaded.</span>';
    
    const photoHtml = teacher.photo_url
      ? `<img src="${teacher.photo_url}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid var(--primary);" />`
      : '<div style="font-size:3rem;">👨‍🏫</div>';
    
    const field = (label, val) => `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">${val || '-'}</span></div>`;
    
    const content = `
      <div style="text-align:center;margin-bottom:1.5rem;">
        ${photoHtml}
        <h3 style="margin:0.5rem 0 0.25rem 0;">${teacher.full_name}</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;">${teacher.registration_id || ''} ${teacher.staff_id ? '| Staff ID: ' + teacher.staff_id : ''}</p>
      </div>
      <div class="profile-detail" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">👤 Personal Information</h4>
        ${field('First Name', teacher.first_name)}
        ${field('Middle Name', teacher.middle_name)}
        ${field('Surname', teacher.surname)}
        ${field('Date of Birth', teacher.dob)}
        ${field('Age', teacher.age)}
        ${field('Gender', teacher.gender)}
        ${field('Region', teacher.region)}
        ${field('Marital Status', teacher.marital_status)}
        ${field('Disability', teacher.disability)}
        ${field('Place of Birth', teacher.place_of_birth)}
        ${field('Nationality', teacher.nationality)}
        ${field('Religion', teacher.religion)}
        
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">🆔 Identification</h4>
        ${field('Staff ID', teacher.staff_id)}
        ${field('Mobile Number', teacher.mobile_number)}
        ${field('Ghana Card Number', teacher.ghana_card_number)}
        ${field('TIN Number', teacher.tin_number)}
        ${field('NTC Number', teacher.ntc_number)}
        ${field('SSNIT Number', teacher.ssnit_number)}
        ${field('Certificate Number', teacher.certificate_number)}
        ${field('EMIS Code', teacher.emis_code)}
        
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">📅 Appointment & School</h4>
        ${field('Date of First Appointment', teacher.date_first_appointment_district)}
        ${field('Date of Transfer to Last School', teacher.date_transfer_last_school)}
        ${field('Date Promoted to Present Rank', teacher.date_promoted_present_rank)}
        ${field('Date of Last Upgrading', teacher.date_last_upgrading)}
        ${field('Name of School', teacher.school_name)}
        ${field('Region of School', teacher.school_region)}
        ${field('Circuit', teacher.circuit)}
        ${field('District', teacher.district)}
        
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">💼 Rank & Salary</h4>
        ${field('Rank', teacher.rank)}
        ${field('Salary Scale', teacher.salary_scale)}
        ${field('Salary Step', teacher.salary_step)}
        ${field('Salary Level', teacher.salary_level)}
        
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">📚 Education & Additional Info</h4>
        ${field('Date of Assumption in District', teacher.date_assumption_district)}
        ${field('Date of Assumption in Present Station', teacher.date_assumption_present_station)}
        ${field('College Attended', teacher.college_attended)}
        ${field('SHS Attended', teacher.shs_attended)}
        ${field('Bank Account Name', teacher.bank_account_name)}
        ${field('Bank Account Number', teacher.bank_account_number)}
        ${field('Account Branch', teacher.account_branch)}
        ${field('Home Town', teacher.home_town)}
        ${field('Area of Specialization', teacher.area_of_specialization)}
        ${field('Professional Qualification', teacher.professional_qualification)}
        ${field('Academic Qualification', teacher.academic_qualification)}
        
        <h4 style="grid-column:1/-1;margin:0.5rem 0;color:var(--primary);">📄 Documents</h4>
        <div style="grid-column:1/-1;">${docHtml}</div>
      </div>
    `;
    
    const modal = document.getElementById('teacherDetailModal');
    if (modal) {
      document.getElementById('teacherDetailModalName').textContent = teacher.full_name;
      document.getElementById('teacherDetailModalContent').innerHTML = content;
      modal.style.display = 'flex';
    }
  } catch (err) {
    alert('Error loading teacher details: ' + err.message);
  }
};

window.closeTeacherDetailModal = function () {
  const modal = document.getElementById('teacherDetailModal');
  if (modal) modal.style.display = 'none';
};

window.printTeacherProfile = function () {
  const modal = document.getElementById('teacherDetailModal');
  if (!modal) return;
  
  const modalName = document.getElementById('teacherDetailModalName')?.textContent || 'Teacher Details';
  const modalContent = document.getElementById('teacherDetailModalContent')?.innerHTML || '';
  if (!modalContent.trim()) { alert('No teacher profile data to print. Open a teacher first.'); return; }
  
  openPrintWindow(`<html><head>
    <title>${modalName} - Teacher Profile</title>
    <style>
      body{font-family:'Segoe UI',system-ui,sans-serif;padding:2rem;color:#1e293b;}
      h1{font-size:1.4rem;margin-bottom:0.25rem;color:#1e293b;}
      h2{font-size:1.2rem;margin:1.5rem 0 0.5rem 0;color:#4f46e5;border-bottom:2px solid #e2e8f0;padding-bottom:0.35rem;}
      h3{font-size:1.1rem;margin:1rem 0 0.5rem 0;color:#1e293b;}
      .profile-header{text-align:center;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:2px solid #e2e8f0;}
      .profile-header h1{margin-bottom:0.25rem;}
      .profile-header p{color:#64748b;font-size:0.85rem;margin:0;}
      .detail-item{display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:0.4rem 0;font-size:0.85rem;}
      .detail-label{font-weight:700;color:#64748b;min-width:180px;}
      .detail-value{color:#1e293b;text-align:right;font-weight:500;}
      .profile-detail{display:grid;grid-template-columns:1fr 1fr;gap:0 2rem;}
      .photo-area{margin-bottom:0.5rem;}
      .print-footer{margin-top:2rem;padding-top:0.75rem;border-top:1px solid #e2e8f0;font-size:0.75rem;color:#94a3b8;text-align:center;}
      .modal-body a{color:#4f46e5;text-decoration:underline;}
      @media print{body{padding:0.5cm;}}
    </style>
  </head><body>
    <div class="profile-header">
      <h1>${modalName}</h1>
      <p>Teacher Profile Report - Generated: ${new Date().toLocaleString()}</p>
    </div>
    <div class="profile-detail">${modalContent.replace(/<h4[^>]*>.*?<\/h4>/g, (m) => {
      // Convert h4 section headers to h2 for print
      const h4s = m.match(/<h4[^>]*>(.*?)<\/h4>/);
      return h4s ? '<h2>' + h4s[1] + '</h2>' : m;
    })}</div>
    <div class="print-footer">Student Admission Portal</div>
  </body></html>`, `${modalName} - Teacher Profile`, 900, 700);
};

// ================================================================
// CSV Export
// ================================================================

function escapeCSVCell(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function teachersToCSV(teachers) {
  const header = [
    'Full Name', 'First Name', 'Middle Name', 'Surname', 'Date of Birth', 'Age',
    'Gender', 'Region', 'Marital Status', 'Disability', 'Place of Birth', 'Nationality',
    'Religion', 'Staff ID', 'Mobile Number', 'Ghana Card Number', 'TIN Number', 'NTC Number', 'SSNIT Number',
    'Certificate Number', 'EMIS Code', 'Date of First Appointment', 'Date of Transfer',
    'Date Promoted', 'Date of Last Upgrading', 'School Name', 'School Region', 'Circuit',
    'District', 'Rank', 'Salary Scale', 'Salary Step', 'Salary Level',
    'Date of Assumption in District', 'Date of Assumption in Present Station',
    'College Attended', 'SHS Attended', 'Bank Account Name', 'Bank Account Number',
    'Account Branch', 'Home Town', 'Area of Specialization',
    'Professional Qualification', 'Academic Qualification',
    'Email', 'Phone', 'Class Taught', 'Subject', 'Qualification', 'Registration ID'
  ];
  const rows = teachers.map(t => [
    t.full_name, t.first_name, t.middle_name, t.surname, t.dob, t.age,
    t.gender, t.region, t.marital_status, t.disability, t.place_of_birth, t.nationality,
    t.religion, t.staff_id, t.mobile_number, t.ghana_card_number, t.tin_number, t.ntc_number, t.ssnit_number,
    t.certificate_number, t.emis_code, t.date_first_appointment_district, t.date_transfer_last_school,
    t.date_promoted_present_rank, t.date_last_upgrading, t.school_name, t.school_region, t.circuit,
    t.district, t.rank, t.salary_scale, t.salary_step, t.salary_level,
    t.date_assumption_district, t.date_assumption_present_station,
    t.college_attended, t.shs_attended, t.bank_account_name, t.bank_account_number,
    t.account_branch, t.home_town, t.area_of_specialization,
    t.professional_qualification, t.academic_qualification,
    t.email, t.phone, t.class_taught, t.subject, t.qualification, t.registration_id
  ]);
  return [header, ...rows].map(r => r.map(escapeCSVCell).join(',')).join('\n');
}

async function exportTeachersCSV() {
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('teachers').select('*');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data, error } = await query.order('full_name', { ascending: true });
  if (error) { alert('Error loading teachers: ' + error.message); return; }
  if (!data || data.length === 0) { alert('No teachers to export.'); return; }
  
  const csv = teachersToCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `teachers_export_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showMessage('teacherMessage', `✅ Exported ${data.length} teacher(s) to CSV.`, 'success');
}

// ================================================================
// CSV Import
// ================================================================

async function importTeachersCSV() {
  const fileInput = getEl('csvTeachersImportInput');
  const file = fileInput?.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      alert('CSV file must have a header row and at least one data row.');
      fileInput.value = '';
      return;
    }
    
    const header = parseCSVLine(lines[0]);
    const colMap = {};
    header.forEach((col, idx) => { colMap[col.trim()] = idx; });
    
    if (!('Full Name' in colMap)) {
      alert('CSV must have a "Full Name" column.');
      fileInput.value = '';
      return;
    }
    
    const schoolId = await getCurrentSchoolId();
    const { data: { user } } = await supabaseClient.auth.getUser();
    let imported = 0, skipped = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const getVal = (col) => (colMap[col] !== undefined ? vals[colMap[col]]?.trim() || '' : '');
      
      const fullName = getVal('Full Name');
      if (!fullName) { skipped++; continue; }
      
      const payload = {
        full_name: fullName,
        first_name: getVal('First Name') || null,
        middle_name: getVal('Middle Name') || null,
        surname: getVal('Surname') || null,
        dob: getVal('Date of Birth') || null,
        gender: getVal('Gender') || null,
        region: getVal('Region') || null,
        marital_status: getVal('Marital Status') || null,
        disability: getVal('Disability') || null,
        place_of_birth: getVal('Place of Birth') || null,
        nationality: getVal('Nationality') || null,
        religion: getVal('Religion') || null,
        staff_id: getVal('Staff ID') || null,
        mobile_number: getVal('Mobile Number') || null,
        ghana_card_number: getVal('Ghana Card Number') || null,
        tin_number: getVal('TIN Number') || null,
        ntc_number: getVal('NTC Number') || null,
        ssnit_number: getVal('SSNIT Number') || null,
        certificate_number: getVal('Certificate Number') || null,
        emis_code: getVal('EMIS Code') || null,
        date_first_appointment_district: getVal('Date of First Appointment') || null,
        date_transfer_last_school: getVal('Date of Transfer') || null,
        date_promoted_present_rank: getVal('Date Promoted') || null,
        date_last_upgrading: getVal('Date of Last Upgrading') || null,
        school_name: getVal('School Name') || null,
        school_region: getVal('School Region') || null,
        circuit: getVal('Circuit') || null,
        district: getVal('District') || null,
        rank: getVal('Rank') || null,
        salary_scale: getVal('Salary Scale') || null,
        salary_step: getVal('Salary Step') || null,
        salary_level: getVal('Salary Level') || null,
        date_assumption_district: getVal('Date of Assumption in District') || null,
        date_assumption_present_station: getVal('Date of Assumption in Present Station') || null,
        college_attended: getVal('College Attended') || null,
        shs_attended: getVal('SHS Attended') || null,
        bank_account_name: getVal('Bank Account Name') || null,
        bank_account_number: getVal('Bank Account Number') || null,
        account_branch: getVal('Account Branch') || null,
        home_town: getVal('Home Town') || null,
        area_of_specialization: getVal('Area of Specialization') || null,
        professional_qualification: getVal('Professional Qualification') || null,
        academic_qualification: getVal('Academic Qualification') || null,
        email: getVal('Email') || null,
        phone: getVal('Phone') || null,
        class_taught: getVal('Class Taught') || null,
        subject: getVal('Subject') || null,
        qualification: getVal('Qualification') || null,
        registration_id: getVal('Registration ID') || null,
        school_id: schoolId,
        created_by: user?.id || null,
        is_approved: true,
      };
      
      try {
        const { error } = await supabaseClient.from('teachers').insert([payload]);
        if (error) { skipped++; } else { imported++; }
      } catch (err) { skipped++; }
    }
    
    let msg = `✅ Imported ${imported} teacher(s) successfully.`;
    if (skipped > 0) msg += ` ⚠️ ${skipped} row(s) skipped.`;
    alert(msg);
    fileInput.value = '';
    await renderTeachersTable();
  } catch (err) {
    alert('Error importing CSV: ' + err.message);
    console.error('Import CSV error:', err);
  }
}
