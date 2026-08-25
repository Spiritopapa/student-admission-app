/**
 * Student Dashboard Module
 */

import { getEl, showMessage, clearMessage, setLoading, buildStudentName, formatDate, getTermDisplay, getGrade, getTeacherRemarks, getHeadTeacherRemarks, getSubjectGrade, getPerformanceLevel, collectStyles, openPrintWindow, getCurrentSchoolId } from './utils.js';
import { loadStudentAssessments } from './assessment-taking.js';
import { showReceiptModal, generateReceiptHTML, renderReceiptQR } from './admin-fees.js';

let supabaseClient = null;
let _studentPortalConfirmed = false;
let _studentApp = null;

export function initStudentDashboard(supabase) {
  supabaseClient = supabase;
}

export function setupStudentDashboard() {
  // Sidebar navigation with portal confirmation guard
  document.querySelectorAll('[data-student-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-student-page');
      
      // BLOCK ALL: If portal not confirmed, show locked message for ALL pages including profile
      if (!_studentPortalConfirmed) {
        const target = getEl(`studentPage-${page}`);
        if (target) {
          document.querySelectorAll('.student-subpage').forEach((p) => p.classList.remove('active-subpage'));
          target.classList.add('active-subpage');
          document.querySelectorAll('[data-student-page]').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const titles = { profile: '🎓 My Profile', attendance: '📋 My Attendance', announcements: '📢 Announcements', exams: '📝 My Exam Report Cards', assessments: '❓ My Assessments', fees: '💰 My Fee Details' };
          const titleEl = getEl('studentDashTitle');
          if (titleEl && titles[page]) titleEl.textContent = titles[page];
          // Show locked message
          target.innerHTML = getLockedPageHTML(page);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }
      
      document.querySelectorAll('[data-student-page]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.student-subpage').forEach((p) => p.classList.remove('active-subpage'));
      const target = getEl(`studentPage-${page}`);
      if (target) target.classList.add('active-subpage');
      const titles = { profile: '🎓 My Profile', attendance: '📋 My Attendance', announcements: '📢 Announcements', exams: '📝 My Exam Report Cards', assessments: '❓ My Assessments', fees: '💰 My Fee Details' };
      const titleEl = getEl('studentDashTitle');
      if (titleEl && titles[page]) titleEl.textContent = titles[page];
      if (page === 'attendance') loadStudentAttendance();
      if (page === 'announcements') loadStudentAnnouncements();
      if (page === 'exams') loadStudentExamsReport();
      if (page === 'assessments') loadStudentAssessments();
      if (page === 'fees') loadStudentFees();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Profile form
  getEl('studentProfileForm')?.addEventListener('submit', updateStudentProfile);
  getEl('btnStudentViewReport')?.addEventListener('click', viewStudentReport);
  getEl('studentExamSelect')?.addEventListener('change', handleStudentExamChange);
  getEl('btnStudentPrintReport')?.addEventListener('click', printStudentReport);

  // Password change form
  getEl('studentPasswordForm')?.addEventListener('submit', changeStudentPassword);
}

/**
 * Returns HTML for a locked/blocked page when portal is not confirmed
 */
function getLockedPageHTML(page) {
  const icons = {
    attendance: '📋',
    announcements: '📢',
    exams: '📝',
    assessments: '❓',
    fees: '💰'
  };
  const names = {
    attendance: 'Attendance Records',
    announcements: 'Announcements',
    exams: 'Exam Report Cards',
    assessments: 'Assessments',
    fees: 'Fee Details'
  };
  const icon = icons[page] || '🔒';
  const name = names[page] || page;
  
  return `
    <div style="text-align:center;padding:3rem 1rem;">
      <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
      <h3 style="color:var(--text);margin-bottom:0.5rem;">${icon} ${name} Locked</h3>
      <p style="color:var(--text-muted);max-width:400px;margin:0 auto;line-height:1.6;">
        Your portal access is pending confirmation. 
        Please wait for the administrator to approve your account before accessing this section.
      </p>
      <div style="margin-top:1.5rem;padding:0.75rem;background:var(--warning-light);border-radius:var(--radius-sm);display:inline-block;">
        <span style="font-size:0.85rem;color:var(--warning);font-weight:600;">⏳ Awaiting Admin Approval</span>
      </div>
    </div>`;
}

export async function loadStudentDashboard(user) {
  const welcomeEl = getEl('studentWelcome');
  if (!user) return;
  
  // Get profile for welcome message
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  welcomeEl.textContent = `Welcome, ${profile?.full_name || 'Student'} | 🎓 Student`;
  
  // TRI-LEVEL LOOKUP to find the correct student application record
  let app = null;
  
  // Level 1: Try to extract student ID from email (most reliable for students)
  // Student accounts use email format: STUDENTID@student.local
  const emailPrefix = user.email ? user.email.split('@')[0] : null;
  if (emailPrefix && emailPrefix.endsWith('@student') === false) {
    const { data, error } = await supabaseClient.from('applications').select('*').eq('student_id', emailPrefix).maybeSingle();
    if (!error && data) {
      app = data;
      // Ensure user_id is properly linked
      if (!data.user_id || data.user_id !== user.id) {
        await supabaseClient.from('applications').update({ user_id: user.id }).eq('student_id', emailPrefix);
        app.user_id = user.id;
      }
    }
  }
  
  // Level 2: Try user_metadata.student_id (may not exist for old accounts)
  if (!app) {
    const studentIdFromMeta = user.user_metadata?.student_id;
    if (studentIdFromMeta) {
      const { data, error } = await supabaseClient.from('applications').select('*').eq('student_id', studentIdFromMeta).maybeSingle();
      if (!error && data) {
        app = data;
        if (!data.user_id || data.user_id !== user.id) {
          await supabaseClient.from('applications').update({ user_id: user.id }).eq('student_id', studentIdFromMeta);
          app.user_id = user.id;
        }
      }
    }
  }
  
  // Level 3: Fallback to user_id lookup
  if (!app) {
    const { data, error } = await supabaseClient.from('applications').select('*').eq('user_id', user.id).maybeSingle();
    if (error) { showMessage('studentProfileMessage', 'Error: ' + error.message, 'error'); return; }
    app = data;
  }
  
  // Level 3b: SELF-HEAL — if user_id lookup found nothing, auto-link the
  // student record using the ID from email (or metadata) via the
  // SECURITY DEFINER RPC. This fixes pre-existing accounts whose
  // user_id was never linked due to the old link-function restriction.
  if (!app) {
    const studentIdGuess = (user.user_metadata?.student_id) || (emailPrefix && emailPrefix.endsWith('@student') === false ? emailPrefix : null);
    if (studentIdGuess) {
      try {
        await supabaseClient.rpc('auto_approve_student_on_login', { p_user_id: user.id, p_student_id: studentIdGuess });
        const { data: healData } = await supabaseClient.from('applications').select('*').eq('user_id', user.id).maybeSingle();
        app = healData || null;
      } catch (healErr) {
        console.warn('auto_approve_student_on_login RPC failed:', healErr.message);
        // Fallback: direct self-claim update (allowed by RLS when metadata matches)
        try {
          await supabaseClient.from('applications').update({ user_id: user.id }).eq('student_id', studentIdGuess);
          const { data: directData } = await supabaseClient.from('applications').select('*').eq('user_id', user.id).maybeSingle();
          app = directData || null;
        } catch (directErr) {
          console.warn('Direct student self-claim update failed:', directErr.message);
        }
      }
    }
  }
  
  // Level 4: Parse from profile full_name (stored as student ID during registration)
  if (!app) {
    const fullName = profile?.full_name || '';
    if (fullName && (fullName.includes('STU-') || fullName.includes('-'))) {
      const { data, error } = await supabaseClient.from('applications').select('*').eq('student_id', fullName).maybeSingle();
      if (!error && data) {
        app = data;
        await supabaseClient.from('applications').update({ user_id: user.id }).eq('student_id', fullName);
        app.user_id = user.id;
      }
    }
  }
  
  if (!app) { showMessage('studentProfileMessage', 'No admission record found. Contact your administrator.', 'error'); return; }
  
  // FIX: If student profile has no school_id, set it from the application record
  if (!profile?.school_id && app?.school_id) {
    await supabaseClient.from('profiles').update({ school_id: app.school_id }).eq('id', user.id);
    profile.school_id = app.school_id;
    // Clear cached school_id so getCurrentSchoolId() re-fetches
    const { clearSchoolIdCache } = await import('./utils.js');
    clearSchoolIdCache();
  }
  
  // Store app data and portal status globally
  _studentApp = app;
  _studentPortalConfirmed = app.portal_confirmed === true;
  
  if (!_studentPortalConfirmed) {
    // Show pending approval message on profile page
    const formContainer = getEl('studentProfileCard');
    if (formContainer) {
      formContainer.innerHTML = `
        <div style="text-align:center;padding:2rem;">
          <p style="font-size:2rem;">⏳</p>
          <h3>Your portal access is pending confirmation</h3>
          <p style="color:var(--text-muted);margin-top:0.5rem;">Please wait for the administrator to confirm your access.</p>
          <p style="color:var(--text-muted);">Your Student ID: <strong>${app.student_id}</strong></p>
          <div style="margin-top:1.5rem;padding:0.75rem;background:var(--warning-light);border-radius:var(--radius-sm);display:inline-block;">
            <span style="font-size:0.85rem;color:var(--warning);font-weight:600;">⏳ Awaiting Admin Approval</span>
          </div>
        </div>`;
    }
    // Lock all other subpages
    ['attendance', 'announcements', 'exams', 'assessments', 'fees'].forEach(p => {
      const el = getEl(`studentPage-${p}`);
      if (el) el.innerHTML = getLockedPageHTML(p);
    });
    return;
  }
  
  // Portal is confirmed - show everything
  populateStudentProfile(app);
  await loadStudentAnnouncements();
}

function populateStudentProfile(app) {
  getEl('studentFirstName').value = app.first_name || '';
  getEl('studentMiddleName').value = app.middle_name || '';
  getEl('studentLastName').value = app.last_name || '';
  getEl('studentDOB').value = app.date_of_birth || '';
  getEl('studentReligion').value = app.religion || '';
  getEl('studentHomeTown').value = app.home_town || '';
  getEl('studentPlaceOfStay').value = app.place_of_stay || '';
  getEl('studentPrevSchool').value = app.previous_school || '';
  getEl('studentAdmissionDate').value = app.admission_date || '';
  getEl('studentReadonlyID').textContent = app.student_id || '-';
  getEl('studentReadonlyClass').textContent = app.class_applying || '-';
  getEl('studentReadonlyParent').textContent = app.parent_name || '-';
  getEl('studentReadonlyContact').textContent = app.parent_contact || '-';
  getEl('studentReadonlyTeacher').textContent = app.teacher || '-';
  getEl('studentReadonlyStatus').textContent = app.status ? app.status.toUpperCase() : '-';
  const photoContainer = getEl('studentProfilePhoto');
  if (photoContainer) {
    if (app.student_photo_url) {
      photoContainer.innerHTML = `<img src="${app.student_photo_url}" class="student-profile-photo" alt="Student photo" />`;
    } else {
      photoContainer.innerHTML = '<span class="dash-photo-placeholder student-profile-photo-placeholder">📷</span>';
    }
  }
}

async function updateStudentProfile(e) {
  e.preventDefault();
  clearMessage('studentProfileMessage');
  const btn = getEl('studentProfileSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: app } = await supabaseClient.from('applications').select('*').eq('user_id', user.id).maybeSingle();
  if (!app) { showMessage('studentProfileMessage', 'No student record found.', 'error'); setLoading(btn, false, 'Update Profile'); return; }
  const payload = {
    first_name: getEl('studentFirstName').value.trim(),
    middle_name: getEl('studentMiddleName').value.trim() || null,
    last_name: getEl('studentLastName').value.trim(),
    religion: getEl('studentReligion').value.trim(),
    home_town: getEl('studentHomeTown').value.trim() || null,
    place_of_stay: getEl('studentPlaceOfStay').value.trim() || null,
    previous_school: getEl('studentPrevSchool').value.trim() || null,
  };
  try {
    const { error } = await supabaseClient.from('applications').update(payload).eq('student_id', app.student_id);
    if (error) throw error;
    showMessage('studentProfileMessage', '✅ Profile updated successfully.', 'success');
    const { data: updatedApp } = await supabaseClient.from('applications').select('*').eq('student_id', app.student_id).single();
    if (updatedApp) populateStudentProfile(updatedApp);
  } catch (err) { showMessage('studentProfileMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Update Profile'); }
}

// ================================================================
// Student Password Change
// ================================================================

async function changeStudentPassword(e) {
  e.preventDefault();
  clearMessage('studentPasswordMessage');
  const newPassword = getEl('studentNewPassword').value;
  const confirmPassword = getEl('studentConfirmPassword').value;
  if (newPassword.length < 6) {
    showMessage('studentPasswordMessage', 'Password must be at least 6 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage('studentPasswordMessage', 'Passwords do not match.', 'error');
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Updating...');
  try {
    const { data, error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    showMessage('studentPasswordMessage', '✅ Password changed successfully. Use your new password next time you sign in.', 'success');
    e.target.reset();
  } catch (err) {
    showMessage('studentPasswordMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Change Password');
  }
}

// ================================================================
// Student Announcements
// ================================================================

let _studentAnnouncementPopupInterval = null;
let _studentCurrentAnnouncementIndex = 0;

/**
 * Show a modern animated announcement popup for student dashboard
 */
function showStudentAnnouncementPopup(announcement) {
  const existing = document.getElementById('dashAnnouncementPopup');
  if (existing) existing.remove();
  if (!announcement) return;

  // Check if this announcement was dismissed with "Remind Me Later" this session
  const reminded = sessionStorage.getItem('_remindLater_' + announcement.id);
  if (reminded) return;

  const priority = announcement.priority || 'normal';
  const date = formatDate(announcement.created_at);
  const iconMap = { urgent: '🔴', high: '🟠', normal: '🔵', low: '🟢' };
  const icon = iconMap[priority] || '📢';
  const popup = document.createElement('div');
  popup.id = 'dashAnnouncementPopup';
  popup.innerHTML = `
    <div class="announcement-popup-overlay"></div>
    <div class="announcement-popup-card">
      <div class="announcement-popup-header" style="background:${priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#f59e0b' : '#10b981'};">
        <span class="announcement-popup-icon">${icon}</span>
        <span class="announcement-popup-badge">${priority.toUpperCase()}</span>
        <button class="announcement-popup-close" onclick="this.closest('#dashAnnouncementPopup').remove()">✕</button>
      </div>
      <div class="announcement-popup-body">
        <h3 class="announcement-popup-title">${announcement.title || 'Announcement'}</h3>
        <p class="announcement-popup-text">${announcement.content || ''}</p>
        <div class="announcement-popup-footer">
          <span class="announcement-popup-date">📅 ${date}</span>
          <div class="announcement-popup-actions">
            <button class="announcement-popup-dismiss" onclick="this.closest('#dashAnnouncementPopup').remove()">Dismiss</button>
            <button class="announcement-popup-remind" onclick="this.closest('#dashAnnouncementPopup').remove(); sessionStorage.setItem('_remindLater_${announcement.id}', '1');">⏰ Remind Me Later</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(popup);
  requestAnimationFrame(() => {
    const card = popup.querySelector('.announcement-popup-card');
    if (card) { card.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; card.style.opacity = '1'; card.style.transform = 'translateX(0) scale(1)'; }
    const overlay = popup.querySelector('.announcement-popup-overlay');
    if (overlay) { overlay.style.transition = 'opacity 0.3s ease'; overlay.style.opacity = '1'; }
  });
  setTimeout(() => {
    const p = document.getElementById('dashAnnouncementPopup');
    if (p) {
      const card = p.querySelector('.announcement-popup-card');
      if (card) { card.style.transition = 'all 0.4s ease'; card.style.opacity = '0'; card.style.transform = 'translateX(100px) scale(0.9)'; }
      const overlay = p.querySelector('.announcement-popup-overlay');
      if (overlay) { overlay.style.transition = 'opacity 0.3s ease'; overlay.style.opacity = '0'; }
      setTimeout(() => p.remove(), 500);
    }
  }, 8000);
}

function startStudentAnnouncementRotation(items) {
  if (_studentAnnouncementPopupInterval) {
    clearInterval(_studentAnnouncementPopupInterval);
    _studentAnnouncementPopupInterval = null;
  }
  const existing = document.getElementById('dashAnnouncementPopup');
  if (existing) existing.remove();
  if (!items || items.length === 0) return;
  _studentCurrentAnnouncementIndex = 0;
  setTimeout(() => { if (items.length > 0) showStudentAnnouncementPopup(items[0]); }, 5000);
  _studentAnnouncementPopupInterval = setInterval(() => {
    if (!items || items.length === 0) return;
    _studentCurrentAnnouncementIndex = (_studentCurrentAnnouncementIndex + 1) % items.length;
    showStudentAnnouncementPopup(items[_studentCurrentAnnouncementIndex]);
  }, 20000);
}

async function loadStudentAnnouncements() {
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('announcements').select('*').eq('is_active', true);
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) { console.error('Load announcements error:', error); return; }
  const items = data || [];
  const listEl = getEl('studentAnnouncementsList');
  const noEl = getEl('studentNoAnnouncements');
  if (!listEl) return;
  if (items.length === 0) { listEl.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  listEl.innerHTML = items.map((a) => {
    const priorityCls = `priority-${a.priority}`;
    return `<div class="announcement-card"><div class="announcement-content"><div class="announcement-title-row"><span class="announcement-title">${a.title}</span><span class="priority-badge ${priorityCls}">${a.priority}</span></div><p class="announcement-text">${a.content}</p><div class="announcement-meta"><span>${formatDate(a.created_at)}</span></div></div></div>`;
  }).join('');
  // Start announcement popup rotation
  startStudentAnnouncementRotation(items);
}

// ================================================================
// Student Fees
// ================================================================

async function loadStudentFees() {
  const summaryEl = getEl('studentFeeSummary');
  const noEl = getEl('studentNoFees');
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: app } = await supabaseClient.from('applications').select('student_id, class_applying, first_name, middle_name, last_name').eq('user_id', user.id).maybeSingle();
  if (!app) { if (summaryEl) summaryEl.innerHTML = '<p style="color:var(--text-muted);">No student record found.</p>'; return; }
  const { data: fees } = await supabaseClient.from('fees').select('*').eq('student_id', app.student_id).order('academic_year', { ascending: false }).order('term', { ascending: false });
  const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
  if (!fees || fees.length === 0) { if (noEl) noEl.style.display = 'block'; if (summaryEl) summaryEl.innerHTML = ''; return; }
  if (noEl) noEl.style.display = 'none';

  const schoolId = await getCurrentSchoolId();
  let settingsQuery = supabaseClient.from('settings').select('academic_year, current_term').eq('id', 'singleton');
  if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
  const { data: settings } = await settingsQuery.maybeSingle();
  const currentYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  const feeRows = fees.map(f => {
    const totalAmt = Number(f.total_amount || 0);
    const paidAmt = Number(f.amount_paid || 0);
    const debtAmt = Number(f.debt || 0);
    const balance = (totalAmt + debtAmt) - paidAmt;
    return { ...f, computedBalance: Math.max(0, balance) };
  });

  const currentTermFeeRow = feeRows.find(f => f.academic_year === currentYear && f.term === currentTerm);
  const currentTermBalancePayable = currentTermFeeRow?.computedBalance || 0;
  const currentTermTotal = Number(currentTermFeeRow?.total_amount || 0);
  const currentTermPaid = Number(currentTermFeeRow?.amount_paid || 0);
  const currentTermDebt = Number(currentTermFeeRow?.debt || 0);
  const totalFeeAll = feeRows.reduce((sum, f) => sum + Number(f.total_amount || 0), 0);
  const totalPaidAll = feeRows.reduce((sum, f) => sum + Number(f.amount_paid || 0), 0);

  const statusBadge = (s) => {
    if (s === 'paid') return '<span class="badge-confirmed">Paid</span>';
    if (s === 'partial') return '<span class="badge-unconfirmed">Partial</span>';
    return '<span class="status-badge status-pending">Unpaid</span>';
  };

  // Fetch receipts from receipts table, and also payment_transactions as fallback
  let receipts = [];
  let transactions = [];
  try {
    const { data: rData } = await supabaseClient.from('receipts').select('*').eq('student_id', app.student_id).order('created_at', { ascending: false });
    if (rData) receipts = rData;
  } catch (e) { console.warn('Failed to fetch receipts:', e); }
  try {
    const { data: tData } = await supabaseClient.from('payment_transactions').select('*').eq('student_id', app.student_id).order('payment_date', { ascending: false });
    if (tData) transactions = tData;
  } catch (e) { console.warn('Failed to fetch transactions:', e); }

  // Build a map of recorded_by user IDs to processor info (name + role label)
  const processorCache = {};
  async function getProcessorInfo(userId) {
    if (!userId) return null;
    if (processorCache[userId]) return processorCache[userId];
    try {
      const { data: profile } = await supabaseClient.from('profiles').select('full_name, role').eq('id', userId).maybeSingle();
      if (profile && profile.full_name) {
        const adminRoles = ['super_admin', 'school', 'sub_admin'];
        let label = 'Staff';
        if (adminRoles.includes(profile.role)) {
          label = 'Admin';
        } else if (profile.role === 'accountant') {
          label = 'Accountant';
        } else if (profile.role) {
          label = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
        }
        const info = { name: profile.full_name, label };
        processorCache[userId] = info;
        return info;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Build combined payment history: prefer receipts, fall back to transactions for entries without receipts
  const paymentHistory = [];
  const seenTransactionIds = new Set();
  
  // Add receipts
  for (const r of receipts) {
    let processorInfo = null;
    // Try to get processor info from transaction_id -> recorded_by -> profiles
    if (r.transaction_id) {
      seenTransactionIds.add(r.transaction_id);
      const tx = transactions.find(t => t.id === r.transaction_id);
      if (tx && tx.recorded_by) {
        processorInfo = await getProcessorInfo(tx.recorded_by);
      }
    }
    paymentHistory.push({
      type: 'receipt',
      receipt_number: r.receipt_number || r.receipt_no || 'N/A',
      term: r.term,
      academic_year: r.academic_year,
      amount: Number(r.amount || r.amount_paid || 0),
      date: r.receipt_date || r.payment_date || r.created_at,
      payment_method: r.payment_method || '',
      reference_number: r.reference_number || '',
      notes: r.notes || '',
      student_id: r.student_id,
      recorded_by_name: processorInfo ? `${processorInfo.label}: ${processorInfo.name}` : '',
      rawData: r
    });
  }

  // Add transactions that don't have a corresponding receipt
  for (const t of transactions) {
    if (!seenTransactionIds.has(t.id)) {
      let processorInfo = null;
      if (t.recorded_by) {
        processorInfo = await getProcessorInfo(t.recorded_by);
      }
      paymentHistory.push({
        type: 'payment',
        receipt_number: '-',
        term: t.term,
        academic_year: t.academic_year,
        amount: Number(t.amount_paid || 0),
        date: t.payment_date || t.created_at,
        payment_method: t.payment_method || '',
        reference_number: t.reference_number || '',
        notes: t.notes || '',
        student_id: t.student_id,
        recorded_by_name: processorInfo ? `${processorInfo.label}: ${processorInfo.name}` : '',
        rawData: t
      });
    }
  }

  // Sort payment history by date descending
  paymentHistory.sort((a, b) => {
    const dateA = a.date ? new Date(a.date) : new Date(0);
    const dateB = b.date ? new Date(b.date) : new Date(0);
    return dateB - dateA;
  });

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="fee-balance-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-bottom:1.25rem;">
        <div class="stat-card" style="border-left:4px solid #dc2626;background:#fef2f2;">
          <span class="stat-number" style="color:#dc2626;font-size:1.4rem;">${currentTermBalancePayable.toFixed(2)}</span>
          <span style="font-weight:600;color:#991b1b;">Balance for ${getTermDisplay(currentTerm)} (${currentYear})</span>
          <span style="display:block;font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">Fee: ${currentTermTotal.toFixed(2)} | Paid: ${currentTermPaid.toFixed(2)} | Debt: ${currentTermDebt.toFixed(2)}</span>
        </div>
        <div class="stat-card" style="border-left:4px solid #16a34a;background:#f0fdf4;">
          <span class="stat-number" style="color:#16a34a;font-size:1.4rem;">${totalPaidAll.toFixed(2)}</span>
          <span style="font-weight:600;color:#166534;">Total Amount Paid (All Terms)</span>
        </div>
        <div class="stat-card" style="border-left:4px solid #2563eb;background:#eff6ff;">
          <span class="stat-number" style="color:#2563eb;font-size:1.4rem;">${totalFeeAll.toFixed(2)}</span>
          <span style="font-weight:600;color:#1e40af;">Total Expected Fees (All Terms)</span>
        </div>
      </div>
      <div class="fee-terms-section">
        <div class="fee-terms-header">📋 Fee Records by Term</div>
        <div class="table-wrapper" style="overflow-x:auto;">
          <table class="app-table" style="min-width:900px;">
            <thead><tr><th>Student ID</th><th>Name</th><th>Class</th><th>Academic Year</th><th>Term</th><th style="text-align:right;">Total Amount</th><th style="text-align:right;">Amount Paid</th><th style="text-align:right;">Debt</th><th style="text-align:right;">Balance</th><th style="text-align:center;">Status</th><th>Last Payment</th></tr></thead>
            <tbody>${feeRows.map(f => {
              const debtVal = Number(f.debt || 0);
              const balanceVal = f.computedBalance;
              const lastPay = f.last_payment_date ? formatDate(f.last_payment_date) : '-';
              return `<tr><td><strong>${app.student_id}</strong></td><td>${name}</td><td>${app.class_applying}</td><td>${f.academic_year}</td><td>${getTermDisplay(f.term)}</td><td style="text-align:right;">${Number(f.total_amount).toFixed(2)}</td><td style="text-align:right;">${Number(f.amount_paid).toFixed(2)}</td><td style="text-align:right;"><span style="color:${debtVal > 0 ? '#dc2626' : 'inherit'}">${debtVal.toFixed(2)}</span></td><td style="text-align:right;"><span style="color:${balanceVal > 0 ? '#dc2626' : '#16a34a'}">${balanceVal.toFixed(2)}</span></td><td style="text-align:center;">${statusBadge(f.payment_status)}</td><td>${lastPay}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="fee-receipts-section">
        <div class="fee-receipts-header">📄 Receipt & Payment History</div>
        ${paymentHistory.length > 0 ? `
          <div class="table-wrapper" style="overflow-x:auto;">
            <table class="app-table" style="min-width:700px;">
              <thead><tr><th>Receipt No</th><th>Term</th><th style="text-align:right;">Amount</th><th>Date</th><th style="text-align:center;">Actions</th></tr></thead>
              <tbody>${paymentHistory.map(p => {
                const dateStr = p.date ? formatDate(p.date) : '-';
                const escRow = JSON.stringify(p.rawData).replace(/'/g, "&#39;");
                const processorParam = (p.recorded_by_name || '').replace(/"/g, '&quot;');
                const receiptActions = p.type === 'receipt' && p.receipt_number !== '-'
                  ? `<div style="display:inline-flex;gap:0.35rem;">
                      <button class="fee-print-btn" style="padding:2px 7px;font-size:11px;background:var(--success-light);border-color:var(--success);" onclick='viewSavedReceipt(${escRow}, "${processorParam}")' title="View official receipt" aria-label="View receipt">👁 View</button>
                      <button class="fee-print-btn" onclick='printSavedReceipt(${escRow}, "${processorParam}")' title="Print official receipt" aria-label="Print receipt">🖨️ Print</button>
                    </div>`
                  : '<span style="color:var(--text-muted);font-size:0.75rem;">-</span>';
                return `<tr><td><strong>${p.receipt_number}</strong></td><td>${getTermDisplay(p.term)} ${p.academic_year ? '- ' + p.academic_year : ''}</td><td style="text-align:right;">GH₵ ${p.amount.toFixed(2)}</td><td>${dateStr}</td><td style="text-align:center;">${receiptActions}</td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        ` : '<p style="padding:1rem;color:var(--text-muted);text-align:center;">No payment history available.</p>'}
      </div>`;
  }
}

// ================================================================
// Student Attendance
// ================================================================

async function loadStudentAttendance() {
  const statsEl = getEl('studentAttStats');
  const tbody = getEl('studentAttBody');
  const noEl = getEl('studentNoAttendance');
  if (!tbody) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data: app } = await supabaseClient.from('applications').select('student_id').eq('user_id', user.id).maybeSingle();
    if (!app) { if (noEl) noEl.style.display = 'block'; return; }
    const schoolId = await getCurrentSchoolId();
    // Determine the current academic year and term — PRIMARY source is the
    // per-school `school_settings` table (used by the admin module when saving
    // attendance), FALLBACK to the legacy `settings` table, then defaults.
    let settings = null;
    if (schoolId) {
      const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
        .select('academic_year, current_term')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettingsData) settings = schoolSettingsData;
    }
    if (!settings) {
      let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
      if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
      const { data: legacySettings } = await settingsQuery.maybeSingle();
      settings = legacySettings || null;
    }
    const academicYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const currentTerm = settings?.current_term || 'First';
    // Query attendance for the current academic year/term first.
    let { data: records } = await supabaseClient.from('attendance')
      .select('*').eq('student_id', app.student_id).eq('academic_year', academicYear).eq('term', currentTerm).order('date', { ascending: false });
    // Fallback: if no records for the current year/term, load ALL of the
    // student's attendance so the tab never appears empty when history exists.
    if (!records || records.length === 0) {
      const { data: allRecords } = await supabaseClient.from('attendance')
        .select('*').eq('student_id', app.student_id).order('date', { ascending: false });
      if (allRecords && allRecords.length > 0) records = allRecords;
    }
    if (!records || records.length === 0) {
      if (noEl) noEl.style.display = 'block';
      tbody.innerHTML = '';
      if (statsEl) { getEl('stuAttPresent').textContent = '0'; getEl('stuAttAbsent').textContent = '0'; getEl('stuAttTotal').textContent = '0'; getEl('stuAttPct').textContent = '0%'; }
      return;
    }
    if (noEl) noEl.style.display = 'none';
    const stats = { present: 0, absent: 0 };
    records.forEach(r => { stats[r.status]++; });
    const total = records.length;
    const pct = total > 0 ? ((stats.present / total) * 100).toFixed(1) : '0.0';
    if (statsEl) {
      getEl('stuAttPresent').textContent = stats.present;
      getEl('stuAttAbsent').textContent = stats.absent;
      getEl('stuAttTotal').textContent = total;
      getEl('stuAttPct').textContent = pct + '%';
    }
    const statusIcons = { present: '✅ Present', absent: '❌ Absent' };
    const statusColors = { present: 'var(--success)', absent: 'var(--danger)' };
    tbody.innerHTML = records.map(r => `<tr><td>${formatDate(r.date)}</td><td><span style="color:${statusColors[r.status] || 'inherit'};font-weight:600;">${statusIcons[r.status] || r.status}</span></td><td>${r.remarks || '-'}</td></tr>`).join('');
  } catch (err) {
    console.error('Load student attendance error:', err);
    if (noEl) { noEl.style.display = 'block'; noEl.textContent = 'Error loading attendance records.'; }
  }
}

// ================================================================
// Student Exams
// ================================================================

export async function loadStudentExamsReport() {
  const sel = getEl('studentExamSelect');
  const container = getEl('studentExamReportContainer');
  const noEl = getEl('studentNoExams');
  if (!sel) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data: app } = await supabaseClient.from('applications').select('student_id').eq('user_id', user.id).maybeSingle();
    if (!app) { if (noEl) { noEl.style.display = 'block'; noEl.textContent = 'No student record found.'; } if (container) container.innerHTML = ''; return; }
    const { data: results } = await supabaseClient.from('exam_results').select('exam_id').eq('student_id', app.student_id);
    if (!results || results.length === 0) { if (noEl) noEl.style.display = 'block'; if (container) container.innerHTML = ''; return; }
    const studentExamIds = [...new Set(results.filter(r => r.exam_id).map(r => r.exam_id))];
    if (studentExamIds.length === 0) { if (noEl) noEl.style.display = 'block'; if (container) container.innerHTML = ''; return; }
    const { data: exams } = await supabaseClient.from('exams').select('id, name, academic_year, term, closing_date, reopening_date').in('id', studentExamIds).order('created_at', { ascending: false });
    if (!exams || exams.length === 0) { if (noEl) noEl.style.display = 'block'; if (container) container.innerHTML = ''; return; }
    if (noEl) noEl.style.display = 'none';
    sel.innerHTML = '<option value="">— Select Exam —</option>' + exams.map(e => `<option value="${e.id}">${e.name} (${e.academic_year} - ${getTermDisplay(e.term)})</option>`).join('');
    if (exams.length > 0) { sel.value = exams[0].id; await showStudentReportCard(exams[0].id, app.student_id); }
  } catch (err) {
    console.error('Failed to load student exams:', err);
    if (noEl) { noEl.style.display = 'block'; noEl.textContent = 'Error loading exam data.'; }
  }
}

async function showStudentReportCard(examId, studentId) {
  const container = getEl('studentExamReportContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Loading report card...</div>';
  try {
    const { data: app } = await supabaseClient.from('applications').select('*').eq('student_id', studentId).maybeSingle();
    if (!app) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Student not found.</p>'; return; }
    const { data: exam } = await supabaseClient.from('exams').select('*').eq('id', examId).maybeSingle();
    if (!exam) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Exam not found.</p>'; return; }
    let examSubsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
    if (app.class_applying) examSubsQuery = examSubsQuery.eq('class_name', app.class_applying);
    const { data: examSubs } = await examSubsQuery;
    const subjects = (examSubs || []).map(s => s.subject);
    if (subjects.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No subjects configured for this exam.</p>'; return; }
    const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId).eq('student_id', studentId);
    const resultMap = new Map((results || []).map(r => [r.subject, r]));
    const schoolId = await getCurrentSchoolId();
    let settings = null;
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const settingsResult = await settingsQuery.maybeSingle();
    settings = settingsResult.data || settings;

    // Fallback: fetch school name and logo from school_settings or schools table
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
        if (!settings?.academic_year) settings = { ...(settings || {}), academic_year: schoolSettingsData.academic_year };
        if (!settings?.current_term) settings = { ...(settings || {}), current_term: schoolSettingsData.current_term };
      }
    }
    if (!schoolName && schoolId) {
      const { data: schoolData } = await supabaseClient.from('schools')
        .select('name, logo_url')
        .eq('id', schoolId)
        .maybeSingle();
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
    const { data: studentDetails } = await supabaseClient.from('exam_student_details').select('*').eq('exam_id', examId).eq('student_id', studentId).maybeSingle();
    // Attendance — use the current settings academic year and term first (this is where
    // attendance records are actually stored, matching the Attendance tab), then fall back
    // to the exam's academic year and term.
    const yearForAtt = settings?.academic_year || exam.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const termForAtt = settings?.current_term || exam.term || 'First';
    let { data: attRecords } = await supabaseClient.from('attendance').select('*').eq('student_id', studentId).eq('academic_year', yearForAtt).eq('term', termForAtt);
    if (!attRecords || attRecords.length === 0) {
      const fallbackYear = exam.academic_year;
      const fallbackTerm = exam.term;
      if (fallbackYear && (fallbackYear !== yearForAtt || fallbackTerm !== termForAtt)) {
        const { data: fallbackAtt } = await supabaseClient.from('attendance').select('*').eq('student_id', studentId).eq('academic_year', fallbackYear).eq('term', fallbackTerm);
        if (fallbackAtt && fallbackAtt.length > 0) attRecords = fallbackAtt;
      }
    }
    const attStats = { present: 0, absent: 0 };
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

    const average = subjects.length ? (total / subjects.length) : 0;
    const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
    const gradeInfo = getGrade(average);
    const remarks = studentDetails?.class_teacher_remarks || getTeacherRemarks(average);
    const headTeacherRemarks = getHeadTeacherRemarks(average);
    const interest = studentDetails?.interest || '';
    const attitude = studentDetails?.attitude || '';
    const overallPosition = studentDetails?.overall_position || '-';
    const interestDisplay = interest ? interest.charAt(0).toUpperCase() + interest.slice(1) : '-';
    const attitudeDisplay = attitude ? attitude.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '-';
    const closingDate = exam.closing_date ? formatDate(exam.closing_date) : '-';
    const reopeningDate = exam.reopening_date ? formatDate(exam.reopening_date) : '-';
    const photoHtml = app.student_photo_url
      ? `<img src="${app.student_photo_url}" class="rc-photo" alt="Student" />`
      : `<div class="rc-photo rc-photo-placeholder">📷</div>`;

    const posSuffix = overallPosition === 1 ? 'st' : overallPosition === 2 ? 'nd' : overallPosition === 3 ? 'rd' : 'th';
    const posDisplay = overallPosition !== '-' ? `${overallPosition}${posSuffix}` : '-';
    const attColor = attTotal > 0
      ? (parseFloat(attPct) >= 80 ? '#16a34a' : parseFloat(attPct) >= 50 ? '#f59e0b' : '#dc2626')
      : '#64748b';
    const attBarWidth = attTotal > 0 ? parseFloat(attPct) : 0;

    container.innerHTML = `
<div class="rc-container">
  <div class="rc-top-bar"></div>
  <div class="rc-header">
    ${schoolLogoHtml}
    <div class="rc-school-info">
      <h1 class="rc-school-name">${schoolName}</h1>
      <p class="rc-school-address">${settings?.school_address || 'Excellence in Education'}</p>
      <p class="rc-school-motto">${settings?.school_motto || 'Knowledge, Character, Service'}</p>
    </div>
    <div class="rc-header-badge">ACADEMIC REPORT</div>
  </div>
  <div class="rc-student-section">
    <div class="rc-student-photo">${photoHtml}</div>
    <div class="rc-student-data">
      <table class="rc-info-table">
        <tr><td class="rc-label">Student Name</td><td class="rc-colon">:</td><td class="rc-value">${name}</td></tr>
        <tr><td class="rc-label">Student ID</td><td class="rc-colon">:</td><td class="rc-value">${studentId}</td></tr>
        <tr><td class="rc-label">Class / Grade</td><td class="rc-colon">:</td><td class="rc-value">${app.class_applying}</td></tr>
        <tr><td class="rc-label">Academic Year</td><td class="rc-colon">:</td><td class="rc-value">${academicYear}</td></tr>
        <tr><td class="rc-label">Term</td><td class="rc-colon">:</td><td class="rc-value">${getTermDisplay(term)}</td></tr>
        <tr><td class="rc-label">Exam</td><td class="rc-colon">:</td><td class="rc-value">${exam.name}</td></tr>
        <tr><td class="rc-label">Position in Class</td><td class="rc-colon">:</td><td class="rc-value"><span class="rc-position-badge">${posDisplay}</span></td></tr>
      </table>
    </div>
    <div class="rc-student-meta">
      <table class="rc-info-table">
        <tr><td class="rc-label">Gender</td><td class="rc-colon">:</td><td class="rc-value">${app.gender || '-'}</td></tr>
        <tr><td class="rc-label">Date of Birth</td><td class="rc-colon">:</td><td class="rc-value">${app.date_of_birth ? formatDate(app.date_of_birth) : '-'}</td></tr>
        <tr><td class="rc-label">Interest</td><td class="rc-colon">:</td><td class="rc-value">${interestDisplay}</td></tr>
        <tr><td class="rc-label">Attitude</td><td class="rc-colon">:</td><td class="rc-value">${attitudeDisplay}</td></tr>
        <tr><td class="rc-label">Days in School</td><td class="rc-colon">:</td><td class="rc-value">${attTotal} day(s)</td></tr>
      </table>
    </div>
  </div>
  <div class="rc-attendance-bar">
    <div class="rc-att-label">ATTENDANCE</div>
    <div class="rc-att-track">
      <div class="rc-att-fill" style="width:${attBarWidth}%;background:${attColor};"></div>
    </div>
    <div class="rc-att-pct" style="color:${attColor};">${attPct}%</div>
    <div class="rc-att-breakdown">
      <span class="rc-att-item present">✓ ${attStats.present}</span>
      <span class="rc-att-item absent">✗ ${attStats.absent}</span>
    </div>
  </div>
  <table class="rc-subjects-table">
    <thead>
      <tr>
        <th class="rc-th-subject">SUBJECT</th>
        <th class="rc-th-score">CLASS SCORE (50)</th>
        <th class="rc-th-score">EXAM SCORE (50)</th>
        <th class="rc-th-total">TOTAL (100)</th>
        <th class="rc-th-grade">GRADE</th>
        <th class="rc-th-remark">REMARK</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="rc-summary">
    <div class="rc-summary-item rc-summary-total">
      <span class="rc-summary-label">Total Score</span>
      <span class="rc-summary-value">${total.toFixed(1)}</span>
      <span class="rc-summary-sub">out of ${maxTotal}</span>
    </div>
    <div class="rc-summary-item rc-summary-average">
      <span class="rc-summary-label">Average</span>
      <span class="rc-summary-value">${average.toFixed(1)}%</span>
      <span class="rc-summary-sub">${gradeInfo.desc}</span>
    </div>
    <div class="rc-summary-item rc-summary-grade">
      <span class="rc-summary-label">Grade</span>
      <span class="rc-summary-value">${gradeInfo.grade}</span>
      <span class="rc-summary-sub">${gradeInfo.desc}</span>
    </div>
    <div class="rc-summary-item rc-summary-subjects">
      <span class="rc-summary-label">Subjects</span>
      <span class="rc-summary-value">${subjects.length}</span>
      <span class="rc-summary-sub">offered</span>
    </div>
  </div>
  <div class="rc-key">
    <span class="rc-key-title">Grading Scale:</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-a">A</span> 80-100% (Advance)</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-b">B</span> 70-79% (Proficient)</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-c">C</span> 60-69% (Approaching)</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-d">D</span> 50-59% (Developing)</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-e">E</span> 40-49% (Beginning)</span>
    <span class="rc-key-item"><span class="rc-grade-badge grade-f">F</span> 0-39% (Fail)</span>
  </div>
  <div class="rc-remarks">
    <div class="rc-remarks-box rc-remarks-teacher">
      <div class="rc-remarks-header">📚 Class Teacher's Remarks</div>
      <div class="rc-remarks-text">${remarks}</div>
      <div class="rc-remarks-signature">
        <span class="rc-sign-line">_________________________</span>
        <span class="rc-sign-label">Signature & Date</span>
      </div>
    </div>
    <div class="rc-remarks-box rc-remarks-head">
      <div class="rc-remarks-header">👨‍🏫 Head Teacher's Remarks</div>
      <div class="rc-remarks-text">${headTeacherRemarks || '___________________________________________________________'}</div>
      <div class="rc-remarks-signature">
        <span class="rc-sign-line">_________________________</span>
        <span class="rc-sign-label">Signature & Date</span>
      </div>
    </div>
  </div>
  <div class="rc-signatures">
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Class Teacher</div>
      <div class="rc-sig-name">${settings?.class_teacher_name || ''}</div>
    </div>
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Head Teacher</div>
      <div class="rc-sig-name">${settings?.head_teacher_name || ''}</div>
    </div>
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Parent / Guardian</div>
      <div class="rc-sig-name">${app.parent_name || ''}</div>
    </div>
  </div>
  <div class="rc-footer">
    <div class="rc-footer-left">
      <span class="rc-footer-label">Closing Date:</span> ${closingDate}
    </div>
    <div class="rc-footer-center">
      <span class="rc-footer-label">Report Generated:</span> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    </div>
    <div class="rc-footer-right">
      <span class="rc-footer-label">Reopening Date:</span> ${reopeningDate}
    </div>
  </div>
</div>`;
  } catch (err) {
    console.error('Failed to show student report card:', err);
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Error loading report card.</p>';
  }
}

async function viewStudentReport() {
  const examId = getEl('studentExamSelect').value;
  if (!examId) { alert('Please select an exam.'); return; }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: app } = await supabaseClient.from('applications').select('student_id').eq('user_id', user.id).maybeSingle();
  if (app) await showStudentReportCard(examId, app.student_id);
}

async function handleStudentExamChange() {
  const examId = getEl('studentExamSelect').value;
  if (!examId) { getEl('studentExamReportContainer').innerHTML = ''; return; }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: app } = await supabaseClient.from('applications').select('student_id').eq('user_id', user.id).maybeSingle();
  if (app) await showStudentReportCard(examId, app.student_id);
}

function printStudentReport() {
  const container = getEl('studentExamReportContainer');
  if (!container || !container.innerHTML.trim() || container.innerHTML.includes('spinner')) {
    alert('No report card to print. View a report card first.');
    return;
  }
  const reportEl = container.querySelector('.rc-container');
  if (!reportEl) { alert('No report card to print.'); return; }
  
  let styles = collectStyles();
  styles += `
    body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;padding:0;margin:0;background:#fff;font-size:12px;}
    @page{size:A4;margin:12mm 10mm;}
    @media print{
      body{padding:0;margin:0;background:#fff;}
      .rc-container{box-shadow:none;border:1px solid #ccc;padding:1.2rem;max-width:100%;page-break-inside:avoid;}
      .rc-top-bar{height:4px;}
      .rc-subjects-table thead th{background:#1e293b!important;color:#fff!important;}
      .rc-subjects-table tbody tr:nth-child(even){background:#f8faff;}
      .rc-summary-total{background:#2563eb!important;}
      .rc-summary-average{background:#7c3aed!important;}
      .rc-summary-grade{background:#f59e0b!important;}
      .rc-summary-subjects{background:#10b981!important;}
      .rc-remarks-teacher{background:#f0fdf4!important;}
      .rc-remarks-head{background:#eff6ff!important;}
      .rc-key{background:#f8fafc!important;}
      *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
    }`;
  const win = openPrintWindow(
    `<html><head><title>Report Card</title><style>${styles}</style></head><body>${reportEl.outerHTML}</body></html>`,
    'Report Card', 900, 700
  );
  if (win) { win.focus(); setTimeout(() => { win.print(); }, 600); }
}

// ================================================================
// Student Receipt View & Print (official admin-style receipt with QR)
// ================================================================

// Rebuilds the full official receipt data for a saved payment receipt so the
// student sees and prints the EXACT same receipt (logo, school, fee table,
// payment details, status, notes and scannable verification QR) as the one
// issued on the admin / accountant fee dashboards.
async function buildStudentReceiptData(receipt, processorLabel) {
  // Stored receipt_data (snapshot taken when the receipt was issued) is the
  // authoritative source; fall back to the saved columns for older receipts.
  const stored = (receipt && receipt.receipt_data && typeof receipt.receipt_data === 'object')
    ? { ...receipt.receipt_data }
    : {};
  const data = { ...stored };

  data.receipt_number = receipt.receipt_number || data.receipt_number;
  data.verification_token = receipt.verification_token || data.verification_token;
  data.student_id = receipt.student_id || data.student_id || '';
  data.academic_year = receipt.academic_year || data.academic_year;
  data.term = receipt.term || data.term;
  data.receipt_date = receipt.receipt_date || receipt.payment_date || data.receipt_date || data.payment_date || null;
  data.amount_paid = Number(receipt.amount ?? receipt.amount_paid ?? data.amount_paid ?? data.amount_now ?? 0);
  data.payment_method = receipt.payment_method || data.payment_method || '';
  data.reference_number = receipt.reference_number || data.reference_number || null;
  data.notes = receipt.notes || data.notes || null;
  data.payment_status = receipt.payment_status || data.payment_status || 'paid';
  if (!data.amount_now && data.amount_paid) data.amount_now = data.amount_paid;

  if (processorLabel && !data.processed_by) {
    const idx = processorLabel.indexOf(':');
    if (idx !== -1) {
      data.processed_by_label = processorLabel.slice(0, idx).trim();
      data.processed_by = processorLabel.slice(idx + 1).trim();
    } else {
      data.processed_by_label = 'Staff';
      data.processed_by = processorLabel.trim();
    }
  }

  // Fill any missing school / student details so the receipt always renders fully.
  try {
    if (!data.school_name) {
      const schoolId = await getCurrentSchoolId();
      if (schoolId) {
        const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).maybeSingle();
        if (school && school.name) data.school_name = school.name;
      }
    }
    if (!data.student_name || !data.class) {
      const { data: app } = await supabaseClient.from('applications')
        .select('first_name, middle_name, last_name, class_applying')
        .eq('student_id', data.student_id)
        .maybeSingle();
      if (app) {
        data.student_name = data.student_name || buildStudentName(app.first_name, app.middle_name, app.last_name);
        data.class = data.class || app.class_applying;
      }
    }
  } catch (e) { /* keep whatever snapshot fields we already have */ }

  return data;
}

// View a saved receipt in the shared Payment Receipt modal (same as admin).
window.viewSavedReceipt = async function (receipt, processorLabel) {
  if (!receipt) return;
  const data = await buildStudentReceiptData(receipt, processorLabel);
  await showReceiptModal(data);
};

// Print a saved receipt: renders the official receipt (with QR) and prints it
// exactly like the admin/accountant receipt print action.
window.printSavedReceipt = async function (receipt, processorLabel) {
  if (!receipt) return;
  const data = await buildStudentReceiptData(receipt, processorLabel);
  const content = getEl('receiptContent');
  if (content) content.innerHTML = generateReceiptHTML(data);
  renderReceiptQR(data);
  // Allow a beat for the QR canvas to finish rendering before it is snapshotted
  // into the print document (mirrors the admin modal's QR serialization path).
  setTimeout(() => {
    if (typeof window.printReceipt === 'function') window.printReceipt();
  }, 600);
};
