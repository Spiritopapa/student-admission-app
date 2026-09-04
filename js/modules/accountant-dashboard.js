/**
 * Accountant Dashboard Module - FINAL FIX
 * Always shows fee data. Tries to load student names separately.
 * If student names fail, still shows student IDs. NEVER silently fails.
 */

import { getEl, showMessage, clearMessage, setLoading, getCurrentSchoolId, formatCurrency, formatDate, generateAcademicYearOptions, getDefaultAcademicYear, openPrintWindow, logStaffActivity } from './utils.js';
import { sendFeePaymentSms } from './sms-gateway.js';
import { buildFeeClassChartHtml, animateFeeClassChart, formatPct } from './fee-class-chart.js';

// ================================================================
// HELPER: Check if student has unpaid balance from previous terms
// ================================================================

/**
 * Checks if a student has outstanding balance from any term PRIOR to the given year/term.
 * Returns the earliest unpaid term info and balance if found, null if all prior terms are cleared.
 */
async function getPriorTermBalance(supabase, studentId, currentYear, currentTerm) {
  const { data: fees } = await supabase.from('fees')
    .select('*')
    .eq('student_id', studentId)
    .order('academic_year')
    .order('term');

  if (!fees || fees.length === 0) return null;

  const termsOrder = ['First', 'Second', 'Third'];
  const currentYearParts = currentYear.split('/').map(Number);
  
  for (const fee of fees) {
    const feeYearParts = fee.academic_year.split('/').map(Number);
    const feeTermIdx = termsOrder.indexOf(fee.term);
    const currentTermIdx = termsOrder.indexOf(currentTerm);
    
    let isPrior = false;
    
    if (feeYearParts[0] < currentYearParts[0]) {
      isPrior = true;
    } else if (feeYearParts[0] === currentYearParts[0] && feeTermIdx < currentTermIdx) {
      isPrior = true;
    }
    
    if (isPrior) {
      const total = Number(fee.total_amount) + Number(fee.debt || 0);
      const paid = Number(fee.amount_paid);
      const balance = total - paid;
      
      if (balance > 0) {
        return {
          academic_year: fee.academic_year,
          term: fee.term,
          balance: balance,
          total: total,
          paid: paid
        };
      }
    }
  }
  
  return null;
}

let supabaseClient = null;

export function initAccountantDashboard(supabase) {
  supabaseClient = supabase;
}

export function setupAccountantDashboard() {
  document.querySelectorAll('#accountantSidebar .dash-nav-link[data-accountant-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-accountant-page');
      document.querySelectorAll('#accountantSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadAccountantSubPage(page);
    });
  });

  getEl('accountantProfileForm')?.addEventListener('submit', updateAccountantProfile);
  getEl('accountantPasswordForm')?.addEventListener('submit', changeAccountantPassword);

  // Today's receipts & transactions (filtered by current accountant)
  getEl('accTodayRefresh')?.addEventListener('click', loadAccTodayReceipts);
  getEl('accTodayPreview')?.addEventListener('click', previewAccTodayReceipts);
  getEl('accTodayPrint')?.addEventListener('click', printAccTodayReceipts);
}

// ================================================================
// ACCOUNTANT TODAY'S RECEIPTS & TRANSACTIONS (Dashboard)
// Filters by the current accountant's user ID (recorded_by)
// ================================================================

let _accTodayReceiptsCache = [];
let _accTodayReceiptsLoaded = false;

/**
 * Loads today's receipts and payment transactions that were processed
 * by the CURRENT accountant (the logged-in user). Updates the
 * #accTodayReceiptsBody table and the summary stat cards.
 */
async function loadAccTodayReceipts() {
  const schoolId = await _getSchoolId();
  const tbody = getEl('accTodayReceiptsBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--text-muted);">Loading today\'s receipts...</td></tr>';

    // Get the current authenticated user (the accountant)
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--danger);">Not authenticated.</td></tr>';
      return;
    }

    // Today's date range (start of day → end of day)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

    // STEP 1: Get today's payment_transactions processed by ONLY this accountant
    let txQuery = supabaseClient.from('payment_transactions')
      .select('id, student_id, academic_year, term, amount_paid, payment_method, payment_date, reference_number, notes, recorded_by, school_id')
      .eq('recorded_by', user.id)
      .gte('payment_date', todayStart)
      .lte('payment_date', todayEnd);
    if (schoolId) txQuery = txQuery.eq('school_id', schoolId);
    txQuery = txQuery.order('payment_date', { ascending: false });

    const { data: transactions } = await txQuery;

    // STEP 2: Get the matching receipts for those transactions
    let receipts = [];
    if (transactions && transactions.length > 0) {
      const txIds = transactions.map(t => t.id);
      // Chunk the IN query to avoid URL length limits
      const chunkSize = 50;
      for (let i = 0; i < txIds.length; i += chunkSize) {
        const chunk = txIds.slice(i, i + chunkSize);
        let rQuery = supabaseClient.from('receipts')
          .select('*')
          .in('transaction_id', chunk);
        if (schoolId) rQuery = rQuery.eq('school_id', schoolId);
        rQuery = rQuery.order('receipt_date', { ascending: false });
        const { data: chunkReceipts } = await rQuery;
        if (chunkReceipts) receipts = receipts.concat(chunkReceipts);
      }
    }

    // STEP 3: Get student names for display
    const studentIds = [...new Set(receipts.map(r => r.student_id))];
    const nameMap = {};
    if (studentIds.length > 0) {
      const { data: studentNames } = await supabaseClient.from('applications')
        .select('student_id, first_name, middle_name, last_name, class_applying')
        .in('student_id', studentIds);
      if (studentNames) {
        studentNames.forEach(s => { nameMap[s.student_id] = s; });
      }
    }

    // Cache results for preview/print
    _accTodayReceiptsCache = receipts;
    _accTodayReceiptsLoaded = true;

    // Update summary stat cards
    const countEl = getEl('accTodayReceiptCount');
    if (countEl) countEl.textContent = receipts.length;

    const txCountEl = getEl('accTodayTxCount');
    if (txCountEl) txCountEl.textContent = transactions ? transactions.length : 0;

    const totalAmount = receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalEl = getEl('accTodayTotalAmount');
    if (totalEl) totalEl.textContent = `GHC ${formatCurrency(totalAmount)}`;

    const todayCountEl = getEl('accTodayCount');
    if (todayCountEl) todayCountEl.textContent = `${receipts.length} today`;

    const totalCell = getEl('accTodayTotalCell');
    if (totalCell) totalCell.textContent = `GHC ${formatCurrency(totalAmount)}`;

    const foot = getEl('accTodayFoot');
    if (foot) foot.style.display = receipts.length > 0 ? '' : 'none';

    if (receipts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts processed by you today.</td></tr>';
      return;
    }

    // Render the receipts table rows
    tbody.innerHTML = receipts.map(r => {
      const studentInfo = nameMap[r.student_id] || {};
      const studentName = studentInfo.first_name
        ? `${studentInfo.first_name} ${studentInfo.middle_name || ''} ${studentInfo.last_name}`
        : r.student_id;
      const className = studentInfo.class_applying || '';
      const time = new Date(r.receipt_date || r.created_at).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit'
      });
      return `<tr>
        <td><strong>${r.receipt_number}</strong></td>
        <td>${r.student_id}</td>
        <td>${studentName}</td>
        <td>${className}</td>
        <td>${r.term} ${r.academic_year}</td>
        <td style="text-align:right;font-weight:bold;">GHC ${formatCurrency(r.amount)}</td>
        <td>${r.payment_method}</td>
        <td>${time}</td>
        <td><button class="action-btn confirm" style="font-size:11px;padding:2px 6px;" onclick="reprintReceipt('${r.id}')"></button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('[ACC] loadAccTodayReceipts error:', err);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--danger);">Error loading today\'s receipts.</td></tr>';
  }
}

/**
 * Builds the HTML for preview/print of today's receipts,
 * showing the school header, accountant name, totals, and the receipt table.
 */
async function buildAccTodayReceiptsHTML() {
  const schoolId = await _getSchoolId();

  // School name
  let schoolName = 'School';
  let schoolLogoUrl = '';
  if (schoolId) {
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
        schoolName = school.name;
        schoolLogoUrl = school.logo_url || '';
      }
    }
    // Apply logo to accountant sidebar
    if (schoolLogoUrl) {
      const accountantSidebarLogo = document.querySelector('#accountantSidebar .sidebar-logo-circle');
      if (accountantSidebarLogo) {
        accountantSidebarLogo.innerHTML = `<img src="${schoolLogoUrl}" alt="School Logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px;background:#fff;padding:2px;" />`;
      }
    }
  }

  // Accountant name
  const { data: { user } } = await supabaseClient.auth.getUser();
  let accountantName = '';
  if (user) {
    const { data: acc } = await supabaseClient.from('accountants')
      .select('full_name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (acc?.full_name) {
      accountantName = acc.full_name;
    } else {
      const { data: prof } = await supabaseClient.from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      if (prof?.full_name) accountantName = prof.full_name;
    }
  }

  const today = new Date();
  const todayFormatted = today.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const receipts = _accTodayReceiptsCache;

  // Student names for the print/preview table
  const studentIds = [...new Set(receipts.map(r => r.student_id))];
  const nameMap = {};
  if (studentIds.length > 0) {
    const { data: students } = await supabaseClient.from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying')
      .in('student_id', studentIds);
    if (students) {
      students.forEach(s => { nameMap[s.student_id] = s; });
    }
  }

  const totalAmount = receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  let html = `
    <div style="font-family:Arial,sans-serif;padding:10px;">
      <div style="text-align:center;margin-bottom:15px;border-bottom:2px solid #1e3a5f;padding-bottom:10px;">
        <h2 style="margin:0;font-size:20px;color:#1e3a5f;">${schoolName}</h2>
        <h3 style="margin:5px 0;font-size:16px;">TODAY'S RECEIPTS</h3>
        <p style="margin:5px 0;font-size:13px;color:#555;">${todayFormatted}</p>
        ${accountantName ? `<p style="margin:2px 0;font-size:12px;color:#555;">Processed by: <strong>${accountantName}</strong></p>` : ''}
      </div>
      <div style="display:flex;gap:1rem;margin-bottom:15px;flex-wrap:wrap;">
        <div style="flex:1;padding:12px;background:#f0fdf4;border-radius:6px;text-align:center;border:1px solid #bbf7d0;">
          <div style="font-size:12px;color:#166534;">Total Receipts</div>
          <div style="font-size:24px;font-weight:bold;color:#166534;">${receipts.length}</div>
        </div>
        <div style="flex:1;padding:12px;background:#fef3c7;border-radius:6px;text-align:center;border:1px solid #fde68a;">
          <div style="font-size:12px;color:#92400e;">Total Amount Collected</div>
          <div style="font-size:24px;font-weight:bold;color:#92400e;">GHC ${formatCurrency(totalAmount)}</div>
        </div>
      </div>`;

  if (!receipts || receipts.length === 0) {
    html += '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts processed by you today.</div>';
  } else {
    html += `<div class="table-wrapper">
      <table class="app-table" style="font-size:12px;">
        <thead>
          <tr>
            <th>#</th>
            <th>Receipt #</th>
            <th>Student ID</th>
            <th>Student Name</th>
            <th>Class</th>
            <th>Term</th>
            <th>Amount (GHC)</th>
            <th>Method</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${receipts.map((r, i) => {
            const studentInfo = nameMap[r.student_id] || {};
            const studentName = studentInfo.first_name
              ? `${studentInfo.first_name} ${studentInfo.middle_name || ''} ${studentInfo.last_name}`
              : r.student_id;
            const className = studentInfo.class_applying || '';
            const time = new Date(r.receipt_date || r.created_at).toLocaleTimeString('en-GB', {
              hour: '2-digit', minute: '2-digit'
            });
            return `<tr>
              <td>${i + 1}</td>
              <td><strong>${r.receipt_number}</strong></td>
              <td>${r.student_id}</td>
              <td>${studentName}</td>
              <td>${className}</td>
              <td>${r.term} ${r.academic_year}</td>
              <td style="text-align:right;font-weight:bold;">${formatCurrency(r.amount)}</td>
              <td>${r.payment_method}</td>
              <td>${time}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#1e3a5f;color:#fff;font-weight:bold;">
            <td colspan="6" style="padding:8px;text-align:right;">TOTAL</td>
            <td style="padding:8px;text-align:right;">GHC ${formatCurrency(totalAmount)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Shows a preview modal of today's receipts for the current accountant.
 */
async function previewAccTodayReceipts() {
  if (!_accTodayReceiptsLoaded) {
    await loadAccTodayReceipts();
  }
  const html = await buildAccTodayReceiptsHTML();
  const modal = getEl('receiptListModal');
  const content = getEl('receiptListContent');
  if (content) content.innerHTML = html;
  if (modal) {
    const title = modal.querySelector('.modal-header h3');
    const today = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    if (title) title.textContent = `Today's Receipts Preview - ${today}`;
    modal.style.display = 'flex';
  }
}

/**
 * Opens a print window with today's receipts for the current accountant.
 */
async function printAccTodayReceipts() {
  if (!_accTodayReceiptsLoaded) {
    await loadAccTodayReceipts();
  }
  const html = await buildAccTodayReceiptsHTML();
  openPrintWindow(`
    <html><head>
      <title>Today's Receipts</title>
      <style>
        @media print {
          body { margin: 0; padding: 10px; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
        body { font-family: Arial, sans-serif; padding: 20px; }
        .app-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .app-table th { background: #1e3a5f; color: #fff; padding: 8px 6px; border: 1px solid #333; text-align: left; }
        .app-table td { padding: 6px; border: 1px solid #ddd; }
        .app-table tr:nth-child(even) { background: #f8f9fa; }
        .action-btn { display: none; }
      </style>
    </head><body>${html}</body></html>
  `, "Today's Receipts", 900, 700);
  try { await logStaffActivity('Printed today\'s receipts collection', { role: 'accountant', entityType: 'receipts' }); } catch (e) { /* noop */ }
}

// ================================================================
// Get school_id - multiple fallbacks
// ================================================================

async function _getSchoolId() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;

    // Try profiles first (standard method)
    const { data: prof } = await supabaseClient
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle();
    
    if (prof?.school_id) return prof.school_id;

    // Fallback: get school_id from accountants table
    const { data: acc, error } = await supabaseClient
      .from('accountants')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (error) console.error('[ACC] Accountants query error:', error);
    
    if (acc?.school_id) {
      // Found school_id in accountants table but not in profile.
      // Update the profile so getCurrentSchoolId() works next time
      await supabaseClient.from('profiles').update({ school_id: acc.school_id }).eq('id', user.id);
      return acc.school_id;
    }
    
    return null;
  } catch (err) {
    console.error('[ACC] getSchoolId error:', err);
    return null;
  }
}

export async function loadAccountantDashboard() {
  const schoolId = await _getSchoolId();
  if (!schoolId) { console.error('[ACC] No school ID available'); return; }

  // Load accountant name for welcome card
  await loadAccountantProfileData();

  // Load all dashboard data: fee overview, distribution, recent payments, class summary, today's receipts
  await Promise.all([
    loadAccFeeOverview(),
    loadAccPaymentDistribution(),
    loadAccRecentPayments(),
    loadAccClassSummary(),
    loadAccTodayReceipts(),
  ]);

  // Hook up refresh button for class summary (needs to be done after content is rendered)
  setTimeout(() => {
    const refreshBtn = getEl('accRefreshSummary');
    if (refreshBtn) {
      // Remove any old listeners by cloning
      const newBtn = refreshBtn.cloneNode(true);
      refreshBtn.parentNode.replaceChild(newBtn, refreshBtn);
      newBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await loadAccClassSummary();
      });
    }
  }, 100);
}

// ================================================================
// Profile & Password
// ================================================================

async function updateAccountantProfile(e) {
  e.preventDefault();
  clearMessage('accountantProfileMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Saving...');
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Not auth');
    const fn = getEl('accountantProfileName').value.trim();
    if (!fn) { showMessage('accountantProfileMessage', 'Name required.', 'error'); setLoading(btn, false, 'Update Name'); return; }

    // NAME LOCK: If the admin has generated an ID (registration_id) for this
    // accountant, they cannot change their own name. Only the admin can.
    const { data: accRecord } = await supabaseClient.from('accountants')
      .select('registration_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (accRecord?.registration_id) {
      showMessage('accountantProfileMessage', 'Your name is locked. Please contact the school admin to change your name.', 'error');
      setLoading(btn, false, 'Update Name');
      // Revert the input to the original name
      await loadAccountantProfileData();
      return;
    }

    const { error: pe } = await supabaseClient.from('profiles').update({ full_name: fn }).eq('id', user.id);
    if (pe) throw pe;
    await supabaseClient.from('accountants').update({ full_name: fn }).eq('user_id', user.id);
    showMessage('accountantProfileMessage', 'Updated.', 'success');
    getEl('accountantSidebarName').textContent = fn;
    try { await logStaffActivity('Updated accountant profile', { role: 'accountant', entityType: 'profile', entityDetails: `New name: ${fn}` }); } catch (e) { console.warn(e); }
  } catch (err) { showMessage('accountantProfileMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Update Name'); }
}

async function changeAccountantPassword(e) {
  e.preventDefault();
  clearMessage('accountantProfileMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true, 'Changing...');
  const np = getEl('accountantNewPassword').value;
  const cp = getEl('accountantConfirmPassword').value;
  if (np.length < 6) {
    try { await logStaffActivity('Password change attempt failed — too short', { role: 'accountant', entityType: 'password' }); } catch (e) { /* noop */ }
    showMessage('accountantProfileMessage', '6+ chars.', 'error'); setLoading(btn, false, 'Change Password'); return;
  }
  if (np !== cp) {
    try { await logStaffActivity('Password change attempt failed — passwords do not match', { role: 'accountant', entityType: 'password' }); } catch (e) { /* noop */ }
    showMessage('accountantProfileMessage', 'Mismatch.', 'error'); setLoading(btn, false, 'Change Password'); return;
  }
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: np });
    if (error) throw error;
    showMessage('accountantProfileMessage', 'Changed.', 'success');
    getEl('accountantNewPassword').value = '';
    getEl('accountantConfirmPassword').value = '';
    try { await logStaffActivity('Changed accountant password', { role: 'accountant', entityType: 'password' }); } catch (e) { /* noop */ }
  } catch (err) {
    try { await logStaffActivity('Password change attempt failed: ' + err.message, { role: 'accountant', entityType: 'password' }); } catch (e) { /* noop */ }
    showMessage('accountantProfileMessage', 'Error: ' + err.message, 'error');
  }
  finally { setLoading(btn, false, 'Change Password'); }
}

// ================================================================
// Sub-page loader
// ================================================================

async function loadAccountantSubPage(page) {
  const titles = { dashboard: 'Dashboard', profile: 'Profile', fees: 'Fees Management', receipts: 'Receipts', debtors: 'Debtors', 'income-expenses': 'Income & Expenses' };
  document.querySelectorAll('.accountant-subpage').forEach(p => p.style.display = 'none');
  const target = getEl(`accountantPage-${page}`);
  if (target) target.style.display = 'block';
  const te = getEl('accountantDashTitle');
  if (te && titles[page]) te.textContent = titles[page];

  switch (page) {
    case 'dashboard': await loadAccountantDashboard(); break;
    case 'profile': await loadAccountantProfileData(); break;
    case 'fees': await loadAccountantFeesPage(); break;
    case 'receipts': await loadAccountantReceiptsPage(); break;
    case 'debtors': await loadAccountantDebtorsPage(); break;
    case 'income-expenses': {
      const { loadIncomeExpensesPage } = await import('./income-expenses.js');
      await loadIncomeExpensesPage('accIeContainer');
      break;
    }
  }
}

async function loadAccountantProfileData() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data: p } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
    if (p) { getEl('accountantProfileName').value = p.full_name || ''; getEl('accountantProfileEmail').value = p.email || ''; }
    // Try accountants table first for the most up-to-date name, fallback to profiles
    let accountantName = null;
    const { data: a } = await supabaseClient.from('accountants').select('full_name, registration_id, photo_url').eq('user_id', user.id).maybeSingle();
    if (a?.full_name) {
      accountantName = a.full_name;
      getEl('accountantSidebarName').textContent = a.full_name;
    } else if (p?.full_name) {
      accountantName = p.full_name;
      getEl('accountantSidebarName').textContent = p.full_name;
    }
    // Show the accountant's framed picture in the sidebar avatar (if uploaded)
    const accAvatarEl = document.querySelector('#accountantSidebar .dash-avatar');
    if (a?.photo_url && accAvatarEl) {
      accAvatarEl.innerHTML = `<img src="${a.photo_url}" alt="Accountant" />`;
    } else if (accAvatarEl && accAvatarEl.querySelector('img')) {
      accAvatarEl.innerHTML = '';
    }

    // NAME LOCK: If the admin has generated an ID (registration_id) for this
    // accountant, disable the name input field so they cannot change it.
    const nameInput = getEl('accountantProfileName');
    const nameSubmitBtn = getEl('accountantProfileForm')?.querySelector('button[type="submit"]');
    if (a?.registration_id) {
      if (nameInput) {
        nameInput.disabled = true;
        nameInput.title = 'Your name is locked. Please contact the school admin to change it.';
      }
      if (nameSubmitBtn) {
        nameSubmitBtn.disabled = true;
        nameSubmitBtn.textContent = 'Name Locked';
      }
      // Show a lock notice
      const lockNotice = getEl('accountantNameLockNotice');
      if (lockNotice) lockNotice.style.display = 'block';
    } else {
      if (nameInput) {
        nameInput.disabled = false;
        nameInput.title = '';
      }
      if (nameSubmitBtn) {
        nameSubmitBtn.disabled = false;
        nameSubmitBtn.textContent = 'Update Name';
      }
      const lockNotice = getEl('accountantNameLockNotice');
      if (lockNotice) lockNotice.style.display = 'none';
    }
    // Update the welcome card with the accountant's name
    const welcomeEl = getEl('accountantWelcome');
    if (welcomeEl && accountantName) {
      welcomeEl.textContent = `Welcome, ${accountantName}!`;
    } else if (welcomeEl) {
      welcomeEl.textContent = 'Welcome!';
    }
    const sid = await _getSchoolId();
    if (sid) {
      const { data: s } = await supabaseClient.from('schools').select('name').eq('id', sid).single();
      if (s) getEl('accountantSidebarSchoolName').textContent = s.name;
    }
  } catch (err) { console.error('[ACC] Profile err:', err); }
}

// ================================================================
// ACCOUNTANT FEES MANAGEMENT PAGE
// ================================================================

async function loadAccountantFeesPage() {
  const schoolId = await _getSchoolId();
  const container = getEl('accFeesContainer');
  if (!container) return;

  const currentYear = new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);

  container.innerHTML = `
    <div class="fee-tabs" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
      <button type="button" class="btn btn-secondary fee-tab active" data-acc-fee-tab="students">Student Fees</button>
      <button type="button" class="btn btn-secondary fee-tab" data-acc-fee-tab="payment">Record Payment</button>
      <button type="button" class="btn btn-secondary fee-tab" data-acc-fee-tab="debtors">Debtors</button>
    </div>
    <div id="accFeeTab-students" class="acc-fee-content">
      <div class="card-toolbar" style="flex-wrap:wrap;">
        <input type="text" id="accFeeSearch" placeholder="Search student name or ID..." class="search-input" style="max-width:250px;" />
        <select id="accFeeClass" class="filter-select"><option value="">All Classes</option></select>
        <select id="accFeeSearchTerm" class="filter-select"><option value="">All Terms</option><option value="First">First Term</option><option value="Second">Second Term</option><option value="Third">Third Term</option></select>
        <select id="accFeeSearchStatus" class="filter-select"><option value="">All Status</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></select>
      </div>
      <div class="table-wrapper">
        <table class="app-table">
          <thead><tr><th>Photo</th><th>Student ID</th><th>Name</th><th>Class</th><th>Fee Details by Term</th><th>Total Balance</th><th>Action</th></tr></thead>
          <tbody id="accFeeStudentsBody"><tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
    <div id="accFeeTab-payment" class="acc-fee-content" style="display:none;">
      <p class="subtitle">Enter student ID to load their fee information and record a payment. A receipt will be automatically generated.</p>
      <div class="form-row" style="max-width:600px;">
        <div class="form-group"><label>Student ID *</label><input type="text" id="accFeeStudentId" placeholder="Enter student ID and press Enter" style="font-size:1rem;padding:0.6rem;" /></div>
      </div>
      <div id="accFeeStudentInfo" style="margin:1rem 0;"><div style="text-align:center;padding:1rem;color:var(--text-muted);">Enter a student ID to begin.</div></div>
      <div class="acc-card" style="max-width:600px;">
        <h3 style="margin:0 0 0.75rem 0;">Record New Payment</h3>
        <div class="form-row">
          <div class="form-group"><label>Academic Year</label><select id="accPayAcademicYear" class="filter-select">${generateAcademicYearOptions(null, null, getDefaultAcademicYear())}</select></div>
          <div class="form-group"><label>Term</label><select id="accPayTerm"><option value="First">First Term</option><option value="Second">Second Term</option><option value="Third">Third Term</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Amount (GHC) *</label><input type="number" id="accPayAmount" step="0.01" min="0.01" placeholder="e.g. 500.00" /></div>
          <div class="form-group"><label>Payment Method</label><select id="accPayMethod"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Reference Number</label><input type="text" id="accPayRef" placeholder="Optional: receipt/transaction ref" /></div>
          <div class="form-group"><label>Notes</label><input type="text" id="accPayNotes" placeholder="Optional notes" /></div>
        </div>
        <button type="button" class="btn btn-primary btn-full" id="accPayBtn">Record Payment</button>
        <div id="accPayMessage" class="message" style="display:none;margin-top:0.75rem;"></div>
      </div>
    </div>
    <div id="accFeeTab-debtors" class="acc-fee-content" style="display:none;">
      <div class="card-toolbar">
        <span id="accFeeDebtorsCount" style="font-size:0.9rem;font-weight:600;">Loading...</span>
        <button type="button" class="btn btn-secondary" id="accFeeDebtorsRefresh">Refresh</button>
      </div>
      <div class="table-wrapper">
        <table class="app-table">
          <thead><tr><th>Student ID</th><th>Name</th><th>Class</th><th>Outstanding Details</th><th>Total Balance</th><th>Action</th></tr></thead>
          <tbody id="accFeeDebtorsBody"><tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading debtors...</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  // Load classes dropdown - scope to the accountant's school
  let classQuery = supabaseClient.from('classes').select('name').order('name');
  if (schoolId) classQuery = classQuery.eq('school_id', schoolId);
  const { data: classes } = await classQuery;
  const classFilter = getEl('accFeeClass');
  if (classFilter && classes) {
    classFilter.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option>${c.name}</option>`).join('');
  }

  // Load students fees
  await loadAccStudentFees();

  // Setup tab switching
  container.querySelectorAll('.fee-tab[data-acc-fee-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.fee-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-acc-fee-tab');
      container.querySelectorAll('.acc-fee-content').forEach(c => c.style.display = 'none');
      const target = getEl(`accFeeTab-${tab}`);
      if (target) target.style.display = 'block';
      if (tab === 'students') loadAccStudentFees();
      if (tab === 'debtors') loadAccFeeDebtors();
    });
  });

  // Search/class filter
  getEl('accFeeSearch')?.addEventListener('input', loadAccStudentFees);
  getEl('accFeeClass')?.addEventListener('change', loadAccStudentFees);
  getEl('accFeeSearchTerm')?.addEventListener('change', loadAccStudentFees);
  getEl('accFeeSearchStatus')?.addEventListener('change', loadAccStudentFees);

  // Load student info
  getEl('accFeeStudentId')?.addEventListener('change', loadAccFeeStudentInfo);
  getEl('accFeeStudentId')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') loadAccFeeStudentInfo();
  });

  // Debtors refresh
  getEl('accFeeDebtorsRefresh')?.addEventListener('click', loadAccFeeDebtors);

  // Payment button handler (uses the main form fields in the payment tab)
  getEl('accPayBtn')?.addEventListener('click', processAccPayment);
}

async function loadAccStudentFees() {
  const schoolId = await _getSchoolId();
  const search = (getEl('accFeeSearch')?.value || '').toLowerCase();
  const classFilter = getEl('accFeeClass')?.value || '';

  let appQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying, student_photo_url');
  if (schoolId) appQuery = appQuery.eq('school_id', schoolId);
  const { data: students } = await appQuery;
  if (!students) return;

  let feeQuery = supabaseClient.from('fees').select('*');
  if (schoolId) feeQuery = feeQuery.eq('school_id', schoolId);
  const { data: feeRecords } = await feeQuery;

  const feeMap = {};
  if (feeRecords) {
    feeRecords.forEach(f => {
      if (!feeMap[f.student_id]) feeMap[f.student_id] = [];
      feeMap[f.student_id].push(f);
    });
  }

  const tbody = getEl('accFeeStudentsBody');
  if (!tbody) return;

  let filtered = students.filter(s => {
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.toLowerCase();
    const matchesSearch = !search || name.includes(search) || s.student_id.toLowerCase().includes(search);
    const matchesClass = !classFilter || s.class_applying === classFilter;
    return matchesSearch && matchesClass;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const fees = feeMap[s.student_id] || [];
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`;
    const photoHtml = s.student_photo_url
      ? `<img src="${s.student_photo_url}" alt="Photo" class="student-photo-thumb" />`
      : '<span class="dash-photo-placeholder"></span>';
    const termDisplay = fees.sort((a, b) => {
      const terms = ['First', 'Second', 'Third'];
      return terms.indexOf(a.term) - terms.indexOf(b.term) || a.academic_year.localeCompare(b.academic_year);
    }).map(f => {
      const total = Number(f.total_amount) + Number(f.debt || 0);
      const paid = Number(f.amount_paid);
      const bal = total - paid;
      const status = bal <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
      return `<div class="fee-term-row">
        <span class="fee-term-label">${f.term} ${f.academic_year}:</span>
        <span>GHC ${formatCurrency(total)}</span>
        <span>Paid: GHC ${formatCurrency(paid)}</span>
        <span class="fee-balance-${status}">Bal: GHC ${formatCurrency(Math.max(bal, 0))}</span>
        <span class="fee-status-badge fee-status-${status}">${status}</span>
      </div>`;
    }).join('') || '<span style="color:var(--text-muted);font-size:0.85rem;">No fee records</span>';

    const totalBalance = fees.reduce((sum, f) => sum + Math.max((Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid), 0), 0);

    return `<tr>
      <td>${photoHtml}</td>
      <td><strong>${s.student_id}</strong></td>
      <td>${name}</td>
      <td>${s.class_applying}</td>
      <td>${termDisplay}</td>
      <td><strong>GHC ${formatCurrency(totalBalance)}</strong></td>
      <td><button class="action-btn confirm" onclick="accRecordPayment('${s.student_id}')">Pay</button></td>
    </tr>`;
  }).join('');
}

// Expose for inline onclick
window.accRecordPayment = async function(studentId) {
  // Switch to payment tab
  const container = getEl('accountantPage-fees');
  if (container) {
    container.querySelectorAll('.fee-tab').forEach(b => b.classList.remove('active'));
    container.querySelector('[data-acc-fee-tab="payment"]')?.classList.add('active');
    container.querySelectorAll('.acc-fee-content').forEach(c => c.style.display = 'none');
    const target = getEl('accFeeTab-payment');
    if (target) target.style.display = 'block';
  }
  getEl('accFeeStudentId').value = studentId;
  await loadAccFeeStudentInfo();
};

async function loadAccFeeStudentInfo() {
  const studentId = getEl('accFeeStudentId').value.trim();
  if (!studentId) return;

  const infoEl = getEl('accFeeStudentInfo');
  infoEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">Loading...</div>';

  const { data: student } = await supabaseClient.from('applications')
    .select('*').eq('student_id', studentId).maybeSingle();
  if (!student) {
    infoEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--danger);">Student not found</div>';
    return;
  }

  const { data: fees } = await supabaseClient.from('fees')
    .select('*').eq('student_id', studentId).order('academic_year').order('term');

  const schoolId = await _getSchoolId();
  let sq = supabaseClient.from('settings').select('*').eq('id', 'singleton');
  if (schoolId) sq = sq.eq('school_id', schoolId);
  const { data: settings } = await sq.maybeSingle();
  const currentYear = settings?.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const currentTerm = settings?.current_term || 'First';

  const name = `${student.first_name} ${student.middle_name || ''} ${student.last_name}`;
  let html = `<div class="fee-student-header">
    <div><strong>${student.student_id}</strong> - ${name}</div>
    <div>Class: ${student.class_applying}</div>
  </div><div class="fee-records-list">`;

  if (!fees || fees.length === 0) {
    html += '<div style="padding:1rem;color:var(--text-muted);">No fee records for this student.</div>';
  } else {
    fees.forEach(f => {
      const total = Number(f.total_amount) + Number(f.debt || 0);
      const paid = Number(f.amount_paid);
      const bal = total - paid;
      const status = bal <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
      html += `<div class="fee-record-card ${status}">
        <div class="fee-record-term">${f.term} Term - ${f.academic_year}</div>
        <div class="fee-record-details">
          <span>Total: GHC ${formatCurrency(total)}</span>
          <span>Paid: GHC ${formatCurrency(paid)}</span>
          <span class="fee-balance-${status}">Balance: GHC ${formatCurrency(Math.max(bal, 0))}</span>
          <span class="fee-status-badge fee-status-${status}">${status}</span>
        </div>
      </div>`;
    });
  }
  html += '</div>';

  // Auto-detect: find the first unpaid term chronologically, or if all paid, show next term
  const terms = ['First', 'Second', 'Third'];
  let selectedYear = currentYear;
  let selectedTerm = currentTerm;

  if (fees && fees.length > 0) {
    // Find the first (earliest) fee record with outstanding balance
    const pendingFee = fees.find(f => {
      const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      return bal > 0;
    });

    if (pendingFee) {
      // There's an unpaid term - auto-select it
      selectedYear = pendingFee.academic_year;
      selectedTerm = pendingFee.term;
    } else {
      // All terms are fully paid - find the next term
      const lastFee = fees[fees.length - 1];
      const lastTermIdx = terms.indexOf(lastFee.term);

      if (lastTermIdx >= 0 && lastTermIdx < 2) {
        selectedTerm = terms[lastTermIdx + 1];
        selectedYear = lastFee.academic_year;
      } else {
        selectedTerm = 'First';
        const parts = lastFee.academic_year.split('/');
        selectedYear = (parseInt(parts[0]) + 1) + '/' + (parseInt(parts[1]) + 1);
      }
    }
  }

  // Update the payment form fields with the auto-selected year/term
  const yearInput = getEl('accPayAcademicYear');
  const termInput = getEl('accPayTerm');
  if (yearInput) yearInput.value = selectedYear;
  if (termInput) termInput.value = selectedTerm;

  // Show outstanding for the selected term
  const selectedFee = fees?.find(f => f.academic_year === selectedYear && f.term === selectedTerm);
  const outstanding = selectedFee ? Math.max((Number(selectedFee.total_amount) + Number(selectedFee.debt || 0)) - Number(selectedFee.amount_paid), 0) : 0;

  let statusHtml = '';
  if (fees && fees.length > 0) {
    const allPaid = fees.every(f => {
      const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      return bal <= 0;
    });
    if (allPaid) {
      statusHtml = `<div class="fee-payment-summary" style="margin-top:1rem;padding:0.75rem;background:#f0fdf4;border-radius:4px;font-size:0.85rem;color:#166534;">
        <strong>All current terms paid!</strong><br/>
        Auto-selected next: <strong>${selectedTerm} Term ${selectedYear}</strong>
        ${outstanding > 0 ? ` — Outstanding: <strong>GHC ${formatCurrency(outstanding)}</strong>` : ' — Fee record not yet set.'}
      </div>`;
    } else {
      statusHtml = `<div class="fee-payment-summary" style="margin-top:1rem;">
        <div>Outstanding for <strong>${selectedTerm} Term ${selectedYear}</strong>: <strong>GHC ${formatCurrency(outstanding)}</strong></div>
      </div>`;
    }
  }

  html += statusHtml;
  infoEl.innerHTML = html;
}

// ================================================================
// ACCOUNTANT PAYMENT PROCESSING (uses main form fields in payment tab)
// ================================================================

async function processAccPayment() {
  const studentId = getEl('accFeeStudentId').value.trim();
  if (!studentId) { showMessage('accPayMessage', 'Please enter a student ID first.', 'error'); return; }

  const amount = parseFloat(getEl('accPayAmount').value);
  if (!amount || amount <= 0) { showMessage('accPayMessage', 'Enter a valid amount.', 'error'); return; }

  const academicYear = getEl('accPayAcademicYear').value.trim();
  const term = getEl('accPayTerm').value;
  if (!academicYear || !term) { showMessage('accPayMessage', 'Academic year and term are required.', 'error'); return; }

  const schoolId = await _getSchoolId();

  // CHECK 1: Ensure the selected term's fee record exists and is not already fully paid
  const { data: currentFee } = await supabaseClient.from('fees')
    .select('total_amount, amount_paid, debt')
    .eq('student_id', studentId)
    .eq('academic_year', academicYear)
    .eq('term', term)
    .maybeSingle();

  if (!currentFee) {
    showMessage('accPayMessage', 
      `No fee record found for ${studentId} for ${term} Term ${academicYear}.\n\nPlease ask the admin to set the fee structure first. Fee records are automatically created when the fee structure is set.`, 
      'error');
    return;
  }

  const totalDue = Number(currentFee.total_amount) + Number(currentFee.debt || 0);
  const currentPaid = Number(currentFee.amount_paid);
  const outstanding = totalDue - currentPaid;

  if (outstanding <= 0) {
    showMessage('accPayMessage', 
      `${studentId} has already fully paid for ${term} Term ${academicYear}.\n\nTotal Due: GHC ${formatCurrency(totalDue)}\nAmount Paid: GHC ${formatCurrency(currentPaid)}\n\nNo further payment is needed for this term.`, 
      'error');
    return;
  }

  // CHECK 2: Ensure no prior term has an outstanding balance
  const priorBalance = await getPriorTermBalance(supabaseClient, studentId, academicYear, term);
  if (priorBalance) {
    showMessage('accPayMessage', 
      `COMPULSORY: Cannot pay for ${term} Term ${academicYear} because there is an outstanding balance from a previous term.\n\n` +
      `Unpaid: ${priorBalance.term} Term ${priorBalance.academic_year}\n` +
      `Amount Due: GHC ${formatCurrency(priorBalance.balance)}\n\n` +
      `Please clear this previous balance first before paying the current term fees.`, 
      'error');
    return;
  }

  // CHECK 3: TOTALLY PREVENT OVERPAYMENT
  if (amount > outstanding && outstanding > 0) {
    showMessage('accPayMessage',
      `OVERPAYMENT PREVENTED\n\n` +
      `Outstanding for ${term} Term ${academicYear}: GHC ${formatCurrency(outstanding)}\n` +
      `You attempted to pay: GHC ${formatCurrency(amount)}\n` +
      `Excess amount: GHC ${formatCurrency(amount - outstanding)}\n\n` +
      `Please enter an amount equal to or less than the outstanding balance of GHC ${formatCurrency(outstanding)}.\n` +
      `Overpayment is not allowed. If you need to pay for the next term, please use that term's payment form.`,
      'error');
    return;
  }

  if (!confirm(`Record payment of GHC ${formatCurrency(amount)} for ${studentId} (${term} Term ${academicYear})?`)) return;

  const btn = getEl('accPayBtn');
  setLoading(btn, true, 'Processing...');
  clearMessage('accPayMessage');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data, error } = await supabaseClient.rpc('process_fee_payment', {
      p_student_id: studentId,
      p_academic_year: academicYear,
      p_term: term,
      p_amount: amount,
      p_payment_method: getEl('accPayMethod').value,
      p_reference_number: getEl('accPayRef').value.trim() || null,
      p_notes: getEl('accPayNotes').value.trim() || null,
      p_recorded_by: user?.id || null,
      p_school_id: schoolId,
    });
    if (error) throw error;
    if (!data.success) { showMessage('accPayMessage', 'Error: ' + (data.error || 'Failed'), 'error'); return; }

    showMessage('accPayMessage', `Paid! Receipt: ${data.receipt_number}`, 'success');
    try { await logStaffActivity(`Recorded fee payment of GHC ${formatCurrency(amount)} for ${studentId} (Receipt: ${data.receipt_number})`, { role: 'accountant', entityType: 'payment', entityDetails: `${studentId} · ${term} Term ${academicYear} · GHC ${formatCurrency(amount)}` }); } catch (e) { console.warn(e); }
    // Notify the parent via SMS as soon as the payment is recorded
    sendFeePaymentSms({
      studentId,
      receiptNumber: data.receipt_number,
      amount: data.amount_paid,
      term,
      academicYear,
      method: getEl('accPayMethod').value,
      studentName: data.student_name,
      className: data.class,
      schoolName: data.school_name,
      remainingBalance: data.remaining_balance,
    });

    getEl('accPayAmount').value = '';
    getEl('accPayRef').value = '';
    getEl('accPayNotes').value = '';
    await loadAccFeeStudentInfo();
    // Fetch student photo URL for QR code
    let studentPhotoUrl = '';
    try {
      const { data: studentApp } = await supabaseClient.from('applications')
        .select('student_photo_url')
        .eq('student_id', studentId)
        .maybeSingle();
      if (studentApp?.student_photo_url) studentPhotoUrl = studentApp.student_photo_url;
    } catch (e) { /* ignore photo fetch errors */ }

    // Show receipt if function exists
    if (typeof showReceiptModal === 'function') {
      const { generateReceiptHTML, renderReceiptQR } = await import('./admin-fees.js');
      const content = getEl('receiptContent');
      const modal = getEl('receiptModal');
      if (content && modal) {
        // Fetch school logo URL
        let schoolLogoUrl = '';
        try {
          const schoolIdForLogo = await _getSchoolId();
          if (schoolIdForLogo) {
            const { data: schoolSettings } = await supabaseClient.from('school_settings')
              .select('logo_url')
              .eq('school_id', schoolIdForLogo)
              .maybeSingle();
            if (schoolSettings?.logo_url) {
              schoolLogoUrl = schoolSettings.logo_url;
            } else {
              const { data: school } = await supabaseClient.from('schools')
                .select('logo_url')
                .eq('id', schoolIdForLogo)
                .maybeSingle();
              if (school?.logo_url) schoolLogoUrl = school.logo_url;
            }
          }
        } catch (e) { /* ignore logo fetch errors */ }
        content.innerHTML = generateReceiptHTML({ ...data, school_logo_url: schoolLogoUrl });
        // Render QR code for security verification
        renderReceiptQR({ ...data, student_id: studentId, student_photo_url: studentPhotoUrl, school_logo_url: schoolLogoUrl });
        modal.style.display = 'flex';
      }
    }
  } catch (err) { showMessage('accPayMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Record Payment'); }
}

// ================================================================
// ACCOUNTANT FEES DEBTORS (inside fees management tab)
// ================================================================

async function loadAccFeeDebtors() {
  const schoolId = await _getSchoolId();
  const tbody = getEl('accFeeDebtorsBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';

  // Get all fee records with balance > 0
  let query = supabaseClient.from('fees')
    .select('*')
    .gt('balance', 0);
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('balance', { ascending: false });

  const { data: debtors } = await query;
  if (!debtors || debtors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors! All fees are up to date.</td></tr>';
    const countEl = getEl('accFeeDebtorsCount');
    if (countEl) countEl.textContent = '0 debtors - All clear!';
    return;
  }

  // Get student names
  const studentIds = [...new Set(debtors.map(d => d.student_id))];
  const { data: studentNames } = await supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .in('student_id', studentIds);

  const nameMap = {};
  if (studentNames) {
    studentNames.forEach(s => { nameMap[s.student_id] = s; });
  }

  // Group by student
  const grouped = {};
  debtors.forEach(d => {
    if (!grouped[d.student_id]) {
      const info = nameMap[d.student_id] || {};
      grouped[d.student_id] = {
        student_id: d.student_id,
        first_name: info.first_name || '',
        middle_name: info.middle_name || '',
        last_name: info.last_name || '',
        class: info.class_applying || '',
        fees: [],
        total_balance: 0
      };
    }
    grouped[d.student_id].fees.push(d);
    grouped[d.student_id].total_balance += Number(d.balance);
  });

  const sorted = Object.values(grouped).sort((a, b) => b.total_balance - a.total_balance);

  tbody.innerHTML = sorted.map(s => {
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.trim() || s.student_id;
    const feeDetails = s.fees.map(f =>
      `<div style="font-size:0.8rem;">${f.term} ${f.academic_year}: GHC ${formatCurrency(f.balance)} (Debt: GHC ${formatCurrency(f.debt || 0)})</div>`
    ).join('');
    return `<tr>
      <td><strong>${s.student_id}</strong></td><td>${name}</td><td>${s.class}</td>
      <td>${feeDetails}</td>
      <td><strong class="fee-balance-unpaid">GHC ${formatCurrency(s.total_balance)}</strong></td>
      <td><button class="action-btn confirm" onclick="accRecordPayment('${s.student_id}')">Pay</button></td>
    </tr>`;
  }).join('');

  const countEl = getEl('accFeeDebtorsCount');
  if (countEl) countEl.textContent = `${sorted.length} debtor(s) - Total: GHC ${formatCurrency(sorted.reduce((sum, s) => sum + s.total_balance, 0))}`;
}

// ================================================================
// ACCOUNTANT RECEIPTS PAGE
// ================================================================

async function loadAccountantReceiptsPage() {
  const schoolId = await _getSchoolId();
  const container = getEl('accReceiptsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="card-toolbar">
      <input type="text" id="accRecSearch" placeholder="Search by receipt # or student ID" class="search-input" style="max-width:300px;" />
      <button type="button" class="btn btn-secondary" id="accRecRefresh">Refresh</button>
    </div>
    <div class="table-wrapper">
      <table class="app-table">
        <thead><tr><th>Receipt #</th><th>Student ID</th><th>Date</th><th>Term</th><th>Amount</th><th>Method</th><th>Action</th></tr></thead>
        <tbody id="accReceiptsBody"><tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading receipts...</td></tr></tbody>
      </table>
    </div>
  `;

  getEl('accRecSearch')?.addEventListener('input', loadAccReceipts);
  getEl('accRecRefresh')?.addEventListener('click', loadAccReceipts);
  await loadAccReceipts();
}

async function loadAccReceipts() {
  const schoolId = await _getSchoolId();
  const search = (getEl('accRecSearch')?.value || '').toLowerCase();
  const tbody = getEl('accReceiptsBody');
  if (!tbody) return;

  let query = supabaseClient.from('receipts').select('*');
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('receipt_date', { ascending: false }).limit(100);

  const { data: receipts } = await query;
  if (!receipts || receipts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts found.</td></tr>';
    return;
  }

  const filtered = search ? receipts.filter(r =>
    r.receipt_number.toLowerCase().includes(search) ||
    r.student_id.toLowerCase().includes(search)
  ) : receipts;

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><strong>${r.receipt_number}</strong></td>
      <td>${r.student_id}</td>
      <td>${formatDate(r.receipt_date)}</td>
      <td>${r.term} ${r.academic_year}</td>
      <td>GHC ${formatCurrency(r.amount)}</td>
      <td>${r.payment_method}</td>
      <td><button class="action-btn confirm" onclick="window.reprintReceipt && reprintReceipt('${r.id}')">Reprint</button></td>
    </tr>
  `).join('');
}

// ================================================================
// ACCOUNTANT DEBTORS PAGE
// ================================================================

async function loadAccountantDebtorsPage() {
  const schoolId = await _getSchoolId();
  const container = getEl('accDebtorsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="card-toolbar" style="flex-wrap:wrap;">
      <span id="accDebtorsCount" style="font-weight:600;">Loading...</span>
      <select id="accDebtorsClass" class="filter-select" style="max-width:180px;"><option value="">All Classes</option></select>
      <button type="button" class="btn btn-secondary" id="accDebtorsRefresh">Refresh</button>
      <button type="button" class="btn btn-secondary" id="accDebtorsPreview">Preview</button>
      <button type="button" class="btn btn-primary" id="accDebtorsPrint">Print Debtors</button>
    </div>
    <div class="table-wrapper">
      <table class="app-table">
        <thead><tr><th>Student ID</th><th>Name</th><th>Class</th><th>Outstanding Details</th><th>Total Balance</th><th>Action</th></tr></thead>
        <tbody id="accDebtorsBody"><tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading debtors...</td></tr></tbody>
      </table>
    </div>
  `;

  // Populate the class filter (scoped to the accountant's school)
  try {
    let classQuery = supabaseClient.from('classes').select('name').order('name');
    if (schoolId) classQuery = classQuery.eq('school_id', schoolId);
    const { data: classes } = await classQuery;
    const classFilterEl = getEl('accDebtorsClass');
    if (classFilterEl && classes && classes.length > 0) {
      classFilterEl.innerHTML = '<option value="">All Classes</option>' +
        classes.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }
  } catch (e) { /* keep the default dropdown if classes cannot be loaded */ }

  getEl('accDebtorsRefresh')?.addEventListener('click', loadAccDebtorsData);
  getEl('accDebtorsClass')?.addEventListener('change', loadAccDebtorsData);
  getEl('accDebtorsPreview')?.addEventListener('click', previewAccDebtorsList);
  getEl('accDebtorsPrint')?.addEventListener('click', printAccDebtorsListDirect);
  await loadAccDebtorsData();
}

async function loadAccDebtorsData() {
  const schoolId = await _getSchoolId();
  const tbody = getEl('accDebtorsBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';

  // Step 1: Get all fee records with balance > 0 (outstanding debts)
  let query = supabaseClient.from('fees')
    .select('*')
    .gt('balance', 0);
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('balance', { ascending: false });

  const { data: debtors } = await query;
  if (!debtors || debtors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors!</td></tr>';
    const countEl = getEl('accDebtorsCount');
    if (countEl) countEl.textContent = '0 debtors - All clear!';
    return;
  }

  // Step 2: Get student names for all debtor student IDs
  const studentIds = [...new Set(debtors.map(d => d.student_id))];
  const { data: studentNames } = await supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .in('student_id', studentIds);

  const nameMap = {};
  if (studentNames) {
    studentNames.forEach(s => {
      nameMap[s.student_id] = s;
    });
  }

  // Step 3: Group by student and build display
  const grouped = {};
  debtors.forEach(d => {
    if (!grouped[d.student_id]) {
      const studentInfo = nameMap[d.student_id] || {};
      grouped[d.student_id] = {
        student_id: d.student_id,
        first_name: studentInfo.first_name || '',
        middle_name: studentInfo.middle_name || '',
        last_name: studentInfo.last_name || '',
        class: studentInfo.class_applying || '',
        fees: [],
        total_balance: 0
      };
    }
    grouped[d.student_id].fees.push(d);
    grouped[d.student_id].total_balance += Number(d.balance);
  });

  // Apply the class filter (if one is selected)
  let sorted = Object.values(grouped).sort((a, b) => b.total_balance - a.total_balance);
  const classFilter = getEl('accDebtorsClass')?.value || '';
  if (classFilter) {
    sorted = sorted.filter(s => s.class === classFilter);
  }

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors found for the selected filters.</td></tr>';
    const countEl = getEl('accDebtorsCount');
    if (countEl) countEl.textContent = `0 debtor(s)${classFilter ? ' - ' + classFilter : ''}`;
    return;
  }

  tbody.innerHTML = sorted.map(s => {
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.trim() || s.student_id;
    const feeDetails = s.fees.map(f =>
      `<div style="font-size:0.8rem;">${f.term} ${f.academic_year}: GHC ${formatCurrency(f.balance)} (Debt: GHC ${formatCurrency(f.debt || 0)})</div>`
    ).join('');
    return `<tr>
      <td><strong>${s.student_id}</strong></td><td>${name}</td><td>${s.class}</td>
      <td>${feeDetails}</td>
      <td><strong class="fee-balance-unpaid">GHC ${formatCurrency(s.total_balance)}</strong></td>
      <td><button class="action-btn confirm" onclick="accRecordPayment('${s.student_id}')">Pay</button></td>
    </tr>`;
  }).join('');

  const countEl = getEl('accDebtorsCount');
  if (countEl) countEl.textContent = `${sorted.length} debtor(s) - Total: GHC ${formatCurrency(sorted.reduce((sum, s) => sum + s.total_balance, 0))}`;
}

// ================================================================
// ACCOUNTANT DEBTORS - PRINT PREVIEW & DIRECT PRINT
// Mirrors the admin debtors module (class filter + preview + print).
// ================================================================

/** Build the printable debtors list HTML honouring the active class filter. */
async function generateAccDebtorsPrintHTML() {
  const schoolId = await _getSchoolId();

  // School name & logo
  let schoolName = 'School';
  let schoolLogoUrl = '';
  if (schoolId) {
    try {
      const { data: schoolSettings } = await supabaseClient.from('school_settings')
        .select('school_name, logo_url')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (schoolSettings && schoolSettings.school_name) {
        schoolName = schoolSettings.school_name;
        schoolLogoUrl = schoolSettings.logo_url || '';
      } else {
        const { data: school } = await supabaseClient.from('schools')
          .select('name, logo_url').eq('id', schoolId).single();
        if (school) {
          schoolName = school.name;
          schoolLogoUrl = school.logo_url || '';
        }
      }
    } catch (e) { /* keep the default school name/logo */ }
  }

  const classFilter = getEl('accDebtorsClass')?.value || '';

  // Fetch ALL fee records and filter in memory so records whose actual
  // outstanding (total + debt - paid) is > 0 are captured even when the
  // generated `balance` column is inconsistent.
  let query = supabaseClient.from('fees').select('*');
  if (schoolId) query = query.eq('school_id', schoolId);
  query = query.order('created_at', { ascending: false });
  const { data: allFees } = await query;
  if (!allFees || allFees.length === 0) return null;

  const debtors = allFees.filter(f => {
    const actualOutstanding = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
    return actualOutstanding > 0;
  });
  if (debtors.length === 0) return null;

  const studentIds = [...new Set(debtors.map(d => d.student_id))];
  const { data: studentNames } = await supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .in('student_id', studentIds);
  const nameMap = {};
  if (studentNames) studentNames.forEach(s => { nameMap[s.student_id] = s; });

  // Group by student
  const grouped = {};
  debtors.forEach(d => {
    const info = nameMap[d.student_id] || {};
    if (!grouped[d.student_id]) {
      grouped[d.student_id] = {
        student_id: d.student_id,
        first_name: info.first_name || d.student_id,
        middle_name: info.middle_name || '',
        last_name: info.last_name || '',
        class: info.class_applying || '',
        fees: [],
        total_balance: 0,
        last_payment_date: null
      };
    }
    grouped[d.student_id].fees.push(d);
    const actualOutstanding = (Number(d.total_amount) + Number(d.debt || 0)) - Number(d.amount_paid);
    grouped[d.student_id].total_balance += Math.max(actualOutstanding, 0);
    if (d.last_payment_date) {
      const dDate = new Date(d.last_payment_date);
      if (!grouped[d.student_id].last_payment_date || dDate > new Date(grouped[d.student_id].last_payment_date)) {
        grouped[d.student_id].last_payment_date = d.last_payment_date;
      }
    }
  });

  let sorted = Object.values(grouped).sort((a, b) => b.total_balance - a.total_balance);
  if (classFilter) sorted = sorted.filter(s => s.class === classFilter);
  if (sorted.length === 0) return null;

  const totalOutstanding = sorted.reduce((sum, s) => sum + s.total_balance, 0);
  const filterDesc = classFilter ? `Class: ${classFilter}` : 'All Debtors';
  const now = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="School Logo" style="width:60px;height:60px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;margin-bottom:0.25rem;" />`
    : '';

  return `
    <div class="debtors-print-container" style="font-family:Arial,sans-serif;padding:20px;">
      <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid #333;padding-bottom:10px;">
        ${logoHtml}
        <h1 style="margin:0;font-size:22px;">${schoolName}</h1>
        <h2 style="margin:5px 0;font-size:18px;">DEBTORS LIST</h2>
        <p style="margin:5px 0;font-size:13px;color:#555;">${filterDesc}</p>
        <p style="margin:5px 0;font-size:12px;color:#777;">Generated: ${now}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#1e3a5f;color:#fff;">
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">#</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Student ID</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Name</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Class</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Outstanding Details</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:right;">Total Balance (GHC)</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Last Payment</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((s, i) => {
            const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.trim();
            const feeDetails = s.fees.map(f => {
              const actualBal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
              return `${f.term} ${f.academic_year}: Total: GHC ${formatCurrency(Number(f.total_amount) + Number(f.debt || 0))} | Paid: GHC ${formatCurrency(f.amount_paid)} | Bal: GHC ${formatCurrency(actualBal)}${f.debt > 0 ? ` (includes prev debt: GHC ${formatCurrency(f.debt)})` : ''}`;
            }).join('; ');
            const lastPayDate = s.last_payment_date ? formatDate(s.last_payment_date) : 'Never';
            const rowBg = i % 2 === 0 ? '#fff' : '#f8f9fa';
            return `<tr style="background:${rowBg};">
              <td style="padding:6px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
              <td style="padding:6px;border:1px solid #ddd;">${s.student_id}</td>
              <td style="padding:6px;border:1px solid #ddd;">${name}</td>
              <td style="padding:6px;border:1px solid #ddd;">${s.class}</td>
              <td style="padding:6px;border:1px solid #ddd;font-size:11px;">${feeDetails}</td>
              <td style="padding:6px;border:1px solid #ddd;text-align:right;font-weight:bold;color:#dc2626;">${formatCurrency(s.total_balance)}</td>
              <td style="padding:6px;border:1px solid #ddd;">${lastPayDate}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#1e3a5f;color:#fff;font-weight:bold;">
            <td colspan="5" style="padding:8px 6px;border:1px solid #333;text-align:right;">TOTAL OUTSTANDING</td>
            <td style="padding:8px 6px;border:1px solid #333;text-align:right;">GHC ${formatCurrency(totalOutstanding)}</td>
            <td style="padding:8px 6px;border:1px solid #333;"></td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:15px;font-size:11px;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:8px;">
        <p style="margin:2px 0;">Total Debtors: ${sorted.length} | Total Outstanding: GHC ${formatCurrency(totalOutstanding)}</p>
        <p style="margin:2px 0;">Generated by Student Admission Portal</p>
      </div>
    </div>
  `;
}

/** Show a modal preview of the debtors list with a Print action. */
function showAccDebtorsPreviewModal(html) {
  const existing = document.getElementById('accDebtorsPrintModal');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const modal = document.createElement('div');
  modal.id = 'accDebtorsPrintModal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:1000px;max-height:90vh;overflow-y:auto;">
      <div class="modal-header">
        <h3>Debtors List Preview</h3>
        <div>
          <button type="button" class="btn btn-sm btn-primary" id="accDebtorsModalPrint" style="margin-right:0.5rem;">Print</button>
          <button type="button" class="modal-close" id="accDebtorsModalClose">×</button>
        </div>
      </div>
      <div class="modal-body" id="accDebtorsModalContent">${html}</div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => { if (modal.parentNode) modal.parentNode.removeChild(modal); };
  modal.querySelector('#accDebtorsModalClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#accDebtorsModalPrint').addEventListener('click', () => {
    const content = modal.querySelector('#accDebtorsModalContent');
    if (!content) return;
    openPrintWindow(`
      <html><head>
        <title>Debtors List</title>
        <style>
          @media print {
            body { margin: 0; padding: 10px; }
            .debtors-print-container { page-break-after: auto; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          }
          body { font-family: Arial, sans-serif; }
        </style>
      </head><body>${content.innerHTML}</body></html>
    `, 'Debtors List', 900, 700);
    logStaffActivity('Generated debtors list (printed)', { role: 'accountant', entityType: 'debtors' }).catch(() => {});
  });
}

/** Preview the current debtors list (respects the selected class filter). */
async function previewAccDebtorsList() {
  const html = await generateAccDebtorsPrintHTML();
  showAccDebtorsPreviewModal(html || '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors found for the selected filters.</div>');
  try { await logStaffActivity('Generated debtors list (preview)', { role: 'accountant', entityType: 'debtors' }); } catch (e) { /* noop */ }
}

/** Print the debtors list directly (respects the selected class filter). */
async function printAccDebtorsListDirect() {
  const html = await generateAccDebtorsPrintHTML();
  if (!html) { alert('No debtors found for the selected filters.'); return; }
  openPrintWindow(`
    <html><head>
      <title>Debtors List</title>
      <style>
        @media print {
          body { margin: 0; padding: 10px; }
          .debtors-print-container { page-break-after: auto; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
        body { font-family: Arial, sans-serif; }
      </style>
    </head><body>${html}</body></html>
  `, 'Debtors List', 900, 700);
  try { await logStaffActivity('Generated debtors list (printed)', { role: 'accountant', entityType: 'debtors' }); } catch (e) { /* noop */ }
}

// ================================================================
// ACCOUNTANT DASHBOARD OVERVIEW - DATA FUNCTIONS
// ================================================================

async function loadAccFeeOverview() {
  const schoolId = await _getSchoolId();
  try {
    let query = supabaseClient.from('fees').select('student_id, academic_year, term, total_amount, amount_paid, debt, balance');
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: fees } = await query;

    let totalAmount = 0, totalPaid = 0;
    if (fees) {
      fees.forEach(f => {
        totalAmount += Number(f.total_amount) || 0;
        totalPaid += Number(f.amount_paid) || 0;
      });
    }

    // Total Expected = all fee billings. Carried debt is NOT added again — it
    // is already inside the older term records' total_amount that were rolled
    // forward, so adding it here would double-count it.
    const totalExpected = totalAmount;
    // Outstanding Balance = what's still owed after all payments
    const outstandingBalance = Math.max(totalExpected - totalPaid, 0);

    const totalEl = getEl('accFeeTotalAmount');
    if (totalEl) totalEl.textContent = `GHC ${formatCurrency(totalExpected)}`;

    const paidEl = getEl('accFeeTotalPaid');
    if (paidEl) paidEl.textContent = `GHC ${formatCurrency(totalPaid)}`;

    const balanceEl = getEl('accFeeTotalBalance');
    if (balanceEl) balanceEl.textContent = `GHC ${formatCurrency(outstandingBalance)}`;

    // Collection rate percentage (based on total expected, not just total_amount)
    const pctEl = getEl('accFeePct');
    const fillEl = getEl('accFeeProgressFill');
    if (totalExpected > 0) {
      const pct = Math.round((totalPaid / totalExpected) * 100);
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (fillEl) fillEl.style.width = `${Math.min(pct, 100)}%`;
    } else {
      if (pctEl) pctEl.textContent = '0%';
      if (fillEl) fillEl.style.width = '0%';
    }
  } catch (err) {
    console.error('[ACC] loadAccFeeOverview error:', err);
  }
}

/**
 * Loads the payment distribution by status (paid/partial/unpaid).
 * Updates the #accDistributionContainer bars.
 */
async function loadAccPaymentDistribution() {
  const schoolId = await _getSchoolId();
  try {
    let query = supabaseClient.from('fees').select('student_id, total_amount, amount_paid, debt');
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: fees } = await query;

    let paid = 0, partial = 0, unpaid = 0;
    const uniqueStudents = new Set();

    if (fees) {
      fees.forEach(f => {
        uniqueStudents.add(f.student_id);
        const total = Number(f.total_amount) + Number(f.debt || 0);
        const paidAmt = Number(f.amount_paid);
        const bal = total - paidAmt;
        if (bal <= 0) paid++;
        else if (paidAmt > 0) partial++;
        else unpaid++;
      });
    }

    const total = paid + partial + unpaid;
    const totalEl = getEl('accDistTotal');
    if (totalEl) totalEl.textContent = `${uniqueStudents.size} Students`;

    const calcPct = (val) => total > 0 ? Math.round((val / total) * 100) : 0;

    const paidPct = calcPct(paid);
    const partialPct = calcPct(partial);
    const unpaidPct = calcPct(unpaid);

    const paidBar = getEl('accDistPaidBar');
    if (paidBar) paidBar.style.width = `${paidPct}%`;
    const paidVal = getEl('accDistPaidValue');
    if (paidVal) paidVal.textContent = `${paid} (${paidPct}%)`;

    const partialBar = getEl('accDistPartialBar');
    if (partialBar) partialBar.style.width = `${partialPct}%`;
    const partialVal = getEl('accDistPartialValue');
    if (partialVal) partialVal.textContent = `${partial} (${partialPct}%)`;

    const unpaidBar = getEl('accDistUnpaidBar');
    if (unpaidBar) unpaidBar.style.width = `${unpaidPct}%`;
    const unpaidVal = getEl('accDistUnpaidValue');
    if (unpaidVal) unpaidVal.textContent = `${unpaid} (${unpaidPct}%)`;

    // Update paid/partial/unpaid counts next to overview
    const paidCount = getEl('accFeePaidCount');
    if (paidCount) paidCount.textContent = paid;
    const partialCount = getEl('accFeePartialCount');
    if (partialCount) partialCount.textContent = partial;
    const unpaidCount = getEl('accFeeUnpaidCount');
    if (unpaidCount) unpaidCount.textContent = unpaid;
  } catch (err) {
    console.error('[ACC] loadAccPaymentDistribution error:', err);
  }
}

/**
 * Loads recent payments (last 10 transactions) and displays them.
 * Updates the #accRecentPayments list.
 */
async function loadAccRecentPayments() {
  const schoolId = await _getSchoolId();
  try {
    let query = supabaseClient.from('payment_transactions')
      .select('*, applications!inner(student_id, first_name, middle_name, last_name)');
    if (schoolId) query = query.eq('school_id', schoolId);
    query = query.order('payment_date', { ascending: false }).limit(10);
    const { data: payments } = await query;

    const listEl = getEl('accRecentPayments');
    const countEl = getEl('accRecentCount');
    if (!listEl) return;

    if (!payments || payments.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">No recent payments found.</div>';
      if (countEl) countEl.textContent = '0';
      return;
    }

    if (countEl) countEl.textContent = payments.length;

    listEl.innerHTML = payments.map(p => {
      const app = p.applications || {};
      const name = `${app.first_name || ''} ${app.middle_name || ''} ${app.last_name || ''}`.trim() || p.student_id;
      return `<div class="acc-recent-item">
        <div class="acc-recent-info">
          <span class="acc-recent-name">${name}</span>
          <span class="acc-recent-detail">${p.student_id} · ${p.term} ${p.academic_year}</span>
        </div>
        <div class="acc-recent-amount">GHC ${formatCurrency(p.amount_paid)}</div>
        <div class="acc-recent-method">${p.payment_method}</div>
        <div class="acc-recent-date">${formatDate(p.payment_date)}</div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('[ACC] loadAccRecentPayments error:', err);
  }
}

/**
 * Loads the class-wise fee summary table.
 * Updates the #accClassSummaryBody table body.
 */
async function loadAccClassSummary() {
  const schoolId = await _getSchoolId();
  try {
    // Get all students grouped by class
    let appQuery = supabaseClient.from('applications').select('student_id, class_applying');
    if (schoolId) appQuery = appQuery.eq('school_id', schoolId);
    const { data: students } = await appQuery;
    if (!students) return;

    // Get all fees for this school
    let feeQuery = supabaseClient.from('fees').select('student_id, total_amount, amount_paid, debt');
    if (schoolId) feeQuery = feeQuery.eq('school_id', schoolId);
    const { data: fees } = await feeQuery;

    // Build class-level aggregates
    const classMap = {};
    if (students) {
      students.forEach(s => {
        if (!classMap[s.class_applying]) {
          classMap[s.class_applying] = { totalFees: 0, collected: 0, outstanding: 0, studentCount: 0 };
        }
        classMap[s.class_applying].studentCount++;
      });
    }

    if (fees) {
      fees.forEach(f => {
        // Find the student's class
        const student = students?.find(s => s.student_id === f.student_id);
        if (!student) return;
        const cls = student.class_applying;
        if (!classMap[cls]) {
          classMap[cls] = { totalFees: 0, collected: 0, outstanding: 0, studentCount: 0 };
        }
        const total = Number(f.total_amount) + Number(f.debt || 0);
        const paid = Number(f.amount_paid);
        classMap[cls].totalFees += total;
        classMap[cls].collected += paid;
        classMap[cls].outstanding += Math.max(total - paid, 0);
      });
    }

    const tbody = getEl('accClassSummaryBody');
    if (!tbody) return;

    const classNames = Object.keys(classMap).sort();
    if (classNames.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No class data available.</td></tr>';
      return;
    }

    tbody.innerHTML = classNames.map(cls => {
      const data = classMap[cls];
      // Exact percentage — shares the same formatting as the chart above so the
      // table and chart can never disagree.
      const pct = formatPct(data.collected, data.totalFees);
      return `<tr>
        <td><strong>${cls}</strong></td>
        <td>GHC ${formatCurrency(data.totalFees)}</td>
        <td>GHC ${formatCurrency(data.collected)}</td>
        <td>GHC ${formatCurrency(data.outstanding)}</td>
        <td>${data.studentCount}</td>
        <td>${pct}</td>
      </tr>`;
    }).join('');

    // Render the animated "Fees by Class" bar chart and animate it.
    // Re-uses the same classMap already built for the table above, so the
    // chart and the table always stay in sync (including manual refresh).
    const chartEl = getEl('accFeeClassChart');
    if (chartEl) {
      chartEl.innerHTML = buildFeeClassChartHtml(classMap);
      setTimeout(() => animateFeeClassChart(chartEl), 60);
    }
  } catch (err) {
    console.error('[ACC] loadAccClassSummary error:', err);
  }
}

export { loadAccountantSubPage };
