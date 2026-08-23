 /**
 * Admin Fees Module - Broad Spectrum Fee Management
 * Manages: class fees structure, per-student fees, payment recording,
 * receipt generation, balance carry-forward, debt tracking across 3 terms
 */

import { getEl, showMessage, clearMessage, setLoading, getCurrentSchoolId, formatCurrency, formatDate, logSubAdminActivity, generateAcademicYearOptions, getDefaultAcademicYear, openPrintWindow, getNextTerm, getNextAcademicYear } from './utils.js';
import { RECEIPT_VERIFY_BASE_URL } from '../supabase-config.js';
import { sendFeePaymentSms, normalizeGhanaPhone } from './sms-gateway.js';

let supabaseClient = null;

export function initAdminFees(supabase) {
  supabaseClient = supabase;
}

export function setupFeesListeners() {
  // Fee structure tab buttons
  document.querySelectorAll('.fee-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fee-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-fee-tab');
      document.querySelectorAll('.fee-tab-content').forEach(c => c.style.display = 'none');
      const target = getEl(`feeTab-${tab}`);
      if (target) target.style.display = 'block';
      loadFeeTab(tab);
    });
  });

  // Set fee structure
  getEl('feeSetStructureBtn')?.addEventListener('click', setClassFeeStructure);
  getEl('feeStructureClass')?.addEventListener('change', loadFeeStructureTab);

  // Load class fee amount when class changes in set form
  getEl('feeSetClass')?.addEventListener('change', async () => {
    const cls = getEl('feeSetClass').value;
    const year = getEl('feeSetYear').value || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const term = getEl('feeSetTerm').value;
    if (cls && year && term) {
      const { data } = await supabaseClient.from('class_fees')
        .select('fee_amount')
        .eq('class_name', cls)
        .eq('academic_year', year)
        .eq('term', term)
        .maybeSingle();
      if (data) {
        getEl('feeSetAmount').value = data.fee_amount;
      }
    }
  });

  // Record payment
  getEl('feeRecordPaymentBtn')?.addEventListener('click', recordPayment);

  // Load student info when student ID entered for payment
  getEl('feePaymentStudentId')?.addEventListener('change', loadStudentFeeInfo);
  getEl('feePaymentStudentId')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') loadStudentFeeInfo();
  });

  // Search for student fee records
  getEl('feeSearchStudent')?.addEventListener('input', filterFeeRecords);
  getEl('feeSearchClass')?.addEventListener('change', filterFeeRecords);
  getEl('feeSearchTerm')?.addEventListener('change', filterFeeRecords);
  getEl('feeSearchStatus')?.addEventListener('change', filterFeeRecords);

  // Bulk print A5 fees reminders for the selected class / all students
  getEl('feePrintRemindersBtn')?.addEventListener('click', printClassFeeReminders);

  // Debtors list refresh
  getEl('feeRefreshDebtors')?.addEventListener('click', loadDebtorsList);

  // Debtors class and term filter change
  getEl('feeDebtorsClass')?.addEventListener('change', loadDebtorsList);
  getEl('feeDebtorsTerm')?.addEventListener('change', loadDebtorsList);

  // Debtors preview and print
  getEl('feePreviewDebtors')?.addEventListener('click', previewDebtorsList);
  getEl('feePrintDebtors')?.addEventListener('click', printDebtorsListDirect);

  // Debtors bulk SMS fee reminder (select all + manual selection)
  getEl('feeSendSmsBtn')?.addEventListener('click', sendBulkFeeReminderSms);
  getEl('feeDebtorsSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.debtor-sms-check').forEach(cb => { cb.checked = e.target.checked; });
    updateSmsSelectionCount();
  });

  // Today's receipts
  getEl('feeTodayReceipts')?.addEventListener('click', showTodayReceipts);

  // Bulk carry forward
  getEl('feeBulkCarryForward')?.addEventListener('click', bulkCarryForward);

  // Holiday fee statements (bulk print)
  getEl('feePreviewHoliday')?.addEventListener('click', previewHolidayFees);
  getEl('feePrintHoliday')?.addEventListener('click', printHolidayFees);
  getEl('feeHolidayClass')?.addEventListener('change', loadHolidayTab);
  getEl('feeHolidayYear')?.addEventListener('change', loadHolidayTab);
  getEl('feeHolidayTerm')?.addEventListener('change', loadHolidayTab);

  // Delete receipts by class & date
  getEl('feePreviewDeleteReceipts')?.addEventListener('click', previewDeleteReceipts);
  getEl('feeDeleteReceiptsBtn')?.addEventListener('click', deleteReceiptsByClassDate);

  // (Removed: Generate fee records is now automatic when setting fee structure)
}

// ================================================================
// Tab Loader
// ================================================================

async function loadFeeTab(tab) {
  switch (tab) {
    case 'structure': await loadFeeStructureTab(); break;
    case 'students': await loadStudentFeesTab(); break;
    case 'payment': break; // Loaded on demand
    case 'debtors': await loadDebtorsList(); break;
    case 'holiday': await loadHolidayTab(); break;
  }
}

// ================================================================
// Populate Academic Year Select Dropdowns
// ================================================================

function populateAcademicYearSelects() {
  const yearSelectors = ['feeSetYear', 'feePayAcademicYear'];
  const defaultYear = getDefaultAcademicYear();
  const options = generateAcademicYearOptions();

  yearSelectors.forEach(id => {
    const el = getEl(id);
    if (el) {
      el.innerHTML = options;
      el.value = defaultYear;
    }
  });

  // Holiday tab year selector: populate the options but let loadHolidayTab()
  // choose the default from the school's stored academic year (if any).
  const holidayYear = getEl('feeHolidayYear');
  if (holidayYear && !holidayYear.hasAttribute('data-populated')) {
    holidayYear.innerHTML = options;
    holidayYear.setAttribute('data-populated', 'true');
  }
}

export async function loadFeesPage() {
  // Load class dropdowns
  await loadClassDropdowns();
  // Populate academic year selects
  populateAcademicYearSelects();
  // Load default tab
  await loadFeeStructureTab();
}

// ================================================================
// HELPER: Check if student has unpaid balance from previous terms
// ================================================================

/**
 * Checks if a student has outstanding balance from any term PRIOR to the given year/term.
 * Returns the earliest unpaid term info and balance if found, null if all prior terms are cleared.
 */
async function getPriorTermBalance(studentId, currentYear, currentTerm) {
  const { data: fees } = await supabaseClient.from('fees')
    .select('*')
    .eq('student_id', studentId)
    .order('academic_year')
    .order('term');

  if (!fees || fees.length === 0) return null;

  const termsOrder = ['First', 'Second', 'Third'];

  // Find the index of the current term in the ordered list to determine which terms are "prior"
  // We consider any term that appears before the current term in chronological order as "prior"
  const currentYearParts = currentYear.split('/').map(Number);
  
  for (const fee of fees) {
    const feeYearParts = fee.academic_year.split('/').map(Number);
    const feeTermIdx = termsOrder.indexOf(fee.term);
    const currentTermIdx = termsOrder.indexOf(currentTerm);
    
    // Determine if this fee record is from a PRIOR term (not current, not future)
    let isPrior = false;
    
    if (feeYearParts[0] < currentYearParts[0]) {
      // Previous academic year - definitely prior
      isPrior = true;
    } else if (feeYearParts[0] === currentYearParts[0] && feeTermIdx < currentTermIdx) {
      // Same academic year, earlier term
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

// ================================================================
// Load Class Dropdowns
// ================================================================

async function loadClassDropdowns() {
  const schoolId = await getCurrentSchoolId();
  let query = supabaseClient.from('classes').select('name').order('name');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data: classes } = await query;
  if (!classes) return;

  const classOpts = '<option value="">— Select Class —</option>' +
    classes.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

  ['feeStructureClass', 'feeSetClass', 'feeSearchClass', 'feeBulkCarryClass', 'feeDebtorsClass', 'feeDeleteReceiptsClass', 'feeHolidayClass'].forEach(id => {
    const el = getEl(id);
    if (el) el.innerHTML = classOpts;
  });
}

// ================================================================
// FEE STRUCTURE TAB
// ================================================================

async function loadFeeStructureTab() {
  const schoolId = await getCurrentSchoolId();
  const classFilter = getEl('feeStructureClass')?.value || '';
  const year = new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);

  let query = supabaseClient.from('class_fees').select('*')
    .order('class_name').order('term');

  if (schoolId) query = query.eq('school_id', schoolId);
  if (classFilter) query = query.eq('class_name', classFilter);

  const { data: fees } = await query;

  const tbody = getEl('feeStructureBody');
  if (!tbody) return;
  if (!fees || fees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">No fee structures set. Use the form below to set fees for each class and term.</td></tr>';
    return;
  }

  tbody.innerHTML = fees.map(f => `
    <tr>
      <td>${f.class_name}</td>
      <td>${f.academic_year}</td>
      <td>${f.term}</td>
      <td><strong>GH₵ ${formatCurrency(f.fee_amount)}</strong></td>
      <td>
        <button class="action-btn confirm" onclick="editClassFee('${f.id}')">Edit</button>
        <button class="action-btn danger" onclick="deleteClassFee('${f.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function setClassFeeStructure() {
  const schoolId = await getCurrentSchoolId();
  const className = getEl('feeSetClass').value;
  const year = getEl('feeSetYear').value || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const term = getEl('feeSetTerm').value;
  const amount = parseFloat(getEl('feeSetAmount').value) || 0;

  if (!className || !term) {
    showMessage('feeStructureMessage', 'Please select class and term.', 'error');
    return;
  }

  const btn = getEl('feeSetStructureBtn');
  setLoading(btn, true, 'Saving...');

  try {
    const { error } = await supabaseClient.from('class_fees').upsert({
      class_name: className,
      academic_year: year,
      term: term,
      fee_amount: amount,
      school_id: schoolId,
    }, { onConflict: 'class_name,academic_year,term,school_id' });

    if (error) throw error;

    // Also update fee records for all existing students in this class
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id')
      .eq('class_applying', className);
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students } = await studentsQuery;

    if (students && students.length > 0) {
      let updated = 0;
      let creditsApplied = 0;
      for (const student of students) {
        const { data: existing } = await supabaseClient.from('fees')
          .select('id, overpaid_amount, amount_paid')
          .eq('student_id', student.student_id)
          .eq('academic_year', year)
          .eq('term', term)
          .maybeSingle();

        if (existing) {
          // Check if there's overpaid credit from previous term that can be applied
          const { data: prevOverpaid } = await supabaseClient.from('fees')
            .select('overpaid_amount')
            .eq('student_id', student.student_id)
            .gt('overpaid_amount', 0)
            .neq('id', existing.id)
            .order('academic_year', { ascending: false })
            .order('term', { ascending: false })
            .limit(1)
            .maybeSingle();

          let effectiveAmount = amount;
          let remainingOverpaid = 0;
          
          if (prevOverpaid && Number(prevOverpaid.overpaid_amount) > 0) {
            const credit = Number(prevOverpaid.overpaid_amount);
            effectiveAmount = Math.max(amount - credit, 0);
            remainingOverpaid = Math.max(credit - amount, 0);
            
            // Clear the previous term's overpaid amount since it's been used
            await supabaseClient.from('fees')
              .update({ overpaid_amount: remainingOverpaid })
              .eq('student_id', student.student_id)
              .neq('id', existing.id)
              .gt('overpaid_amount', 0);
              
            if (credit > 0) creditsApplied++;
          }

          // Update existing fee record with new amount (after applying credit)
          // Also recalculate payment_status based on the new total and amount already paid
          const existingPaid = Number(existing.amount_paid || 0);
          const newStatus = effectiveAmount > 0 && existingPaid < effectiveAmount ? 'unpaid' : 'paid';
          const { error: upErr } = await supabaseClient.from('fees')
            .update({ 
              total_amount: amount,
              overpaid_amount: remainingOverpaid,
              payment_status: newStatus
            })
            .eq('id', existing.id);
          if (!upErr) updated++;
        } else {
          // Check for any overpaid credit from previous terms
          const { data: prevOverpaid } = await supabaseClient.from('fees')
            .select('overpaid_amount')
            .eq('student_id', student.student_id)
            .gt('overpaid_amount', 0)
            .order('academic_year', { ascending: false })
            .order('term', { ascending: false })
            .limit(1)
            .maybeSingle();

          let effectiveAmount = amount;
          let remainingOverpaid = 0;
          
          if (prevOverpaid && Number(prevOverpaid.overpaid_amount) > 0) {
            const credit = Number(prevOverpaid.overpaid_amount);
            effectiveAmount = Math.max(amount - credit, 0);
            remainingOverpaid = Math.max(credit - amount, 0);
            
            // Clear the previous term's overpaid amount since it's been used
            await supabaseClient.from('fees')
              .update({ overpaid_amount: remainingOverpaid })
              .eq('student_id', student.student_id)
              .neq('id', existing?.id || 'none')
              .gt('overpaid_amount', 0);
              
            if (credit > 0) creditsApplied++;
          }

          // Create new fee record
          const { error: insErr } = await supabaseClient.from('fees').insert({
            student_id: student.student_id,
            academic_year: year,
            term: term,
            total_amount: amount,
            amount_paid: 0,
            debt: 0,
            overpaid_amount: remainingOverpaid,
            payment_status: effectiveAmount > 0 ? 'unpaid' : 'paid',
            school_id: schoolId,
          });
          if (!insErr) updated++;
        }
      }
      let msg = `✅ Fee structure set: ${className} - ${term} Term = GH₵ ${formatCurrency(amount)}\n📋 Updated ${updated} student fee records.`;
      if (creditsApplied > 0) msg += `\n💰 Applied overpayment credits from previous term for ${creditsApplied} student(s).`;
      showMessage('feeStructureMessage', msg, 'success');
    } else {
      showMessage('feeStructureMessage', `✅ Fee structure set: ${className} - ${term} Term = GH₵ ${formatCurrency(amount)}`, 'success');
    }

    logSubAdminActivity(`Set fee structure: ${className} ${term} Term = GH₵ ${amount}`, 'fee', `${className}/${term}`);
    await loadFeeStructureTab();
  } catch (err) {
    showMessage('feeStructureMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Set Fee');
  }
}

// ================================================================
// DELETE CLASS FEE - DANGER CONFIRMATION MODAL
// Requires typing the class name before deletion is allowed
// ================================================================

let pendingDeleteClassFeeId = null;
let pendingDeleteClassFeeName = '';

window.deleteClassFee = async function(feeId) {
  try {
    // Get the class_fee details first
    const { data: classFee } = await supabaseClient.from('class_fees')
      .select('class_name, academic_year, term, school_id')
      .eq('id', feeId)
      .single();

    if (!classFee) {
      alert('Fee structure record not found.');
      return;
    }

    // Store pending deletion info
    pendingDeleteClassFeeId = feeId;
    pendingDeleteClassFeeName = classFee.class_name;

    // Populate modal with class fee details
    getEl('deleteClassFeeClassName').textContent = classFee.class_name;
    getEl('deleteClassFeeDetails').textContent = `${classFee.term} Term - ${classFee.academic_year}`;
    getEl('deleteClassFeeTypeLabel').textContent = `"${classFee.class_name}"`;

    // Reset input and button state
    const input = getEl('deleteClassFeeConfirmInput');
    const confirmBtn = getEl('deleteClassFeeConfirmBtn');
    const errorEl = getEl('deleteClassFeeMatchError');
    if (input) {
      input.value = '';
      input.disabled = false;
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      confirmBtn.style.cursor = 'not-allowed';
    }
    if (errorEl) errorEl.style.display = 'none';

    // Show the modal
    const modal = getEl('deleteClassFeeModal');
    if (modal) modal.style.display = 'flex';

    // Focus the input
    setTimeout(() => input?.focus(), 100);
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

window.closeDeleteClassFeeModal = function() {
  const modal = getEl('deleteClassFeeModal');
  if (modal) modal.style.display = 'none';
  pendingDeleteClassFeeId = null;
  pendingDeleteClassFeeName = '';
  
  // Reset input and button
  const input = getEl('deleteClassFeeConfirmInput');
  const confirmBtn = getEl('deleteClassFeeConfirmBtn');
  const errorEl = getEl('deleteClassFeeMatchError');
  if (input) input.value = '';
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
    confirmBtn.style.cursor = 'not-allowed';
  }
  if (errorEl) errorEl.style.display = 'none';
};

// Listen for input changes to validate class name match
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'deleteClassFeeConfirmInput') {
    const typedValue = e.target.value.trim();
    const confirmBtn = getEl('deleteClassFeeConfirmBtn');
    const errorEl = getEl('deleteClassFeeMatchError');
    
    if (typedValue === pendingDeleteClassFeeName) {
      // Match - enable delete button
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
      }
      if (errorEl) errorEl.style.display = 'none';
    } else {
      // No match - keep disabled
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.style.cursor = 'not-allowed';
      }
      if (errorEl && typedValue.length > 0) {
        errorEl.style.display = 'block';
      } else if (errorEl) {
        errorEl.style.display = 'none';
      }
    }
  }
});

// Confirm delete button click handler
getEl('deleteClassFeeConfirmBtn')?.addEventListener('click', async function() {
  if (!pendingDeleteClassFeeId) return;
  
  const input = getEl('deleteClassFeeConfirmInput');
  const typedValue = input?.value?.trim() || '';
  
  if (typedValue !== pendingDeleteClassFeeName) {
    const errorEl = getEl('deleteClassFeeMatchError');
    if (errorEl) errorEl.style.display = 'block';
    return;
  }

  const feeId = pendingDeleteClassFeeId;
  const className = pendingDeleteClassFeeName;
  
  // Disable button while processing
  const confirmBtn = getEl('deleteClassFeeConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ Deleting...';
  }

  try {
    // Get the class_fee details
    const { data: classFee } = await supabaseClient.from('class_fees')
      .select('class_name, academic_year, term, school_id')
      .eq('id', feeId)
      .single();

    if (!classFee) {
      alert('Fee structure record not found.');
      closeDeleteClassFeeModal();
      return;
    }

    // Delete all student fee records for this class/term/year
    // (receipts and payment_transactions are preserved via ON DELETE SET NULL or no cascade)
    const schoolId = await getCurrentSchoolId();
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id')
      .eq('class_applying', classFee.class_name);
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students } = await studentsQuery;

    if (students && students.length > 0) {
      const studentIds = students.map(s => s.student_id);
      
      const { error: delErr } = await supabaseClient.from('fees')
        .delete()
        .in('student_id', studentIds)
        .eq('academic_year', classFee.academic_year)
        .eq('term', classFee.term);

      if (delErr) throw delErr;
    }

    // Delete the class_fee structure record itself
    const { error } = await supabaseClient.from('class_fees').delete().eq('id', feeId);
    if (error) throw error;

    // Close modal and show success
    closeDeleteClassFeeModal();
    alert(`✅ Fee structure deleted.\n🗑️ Removed fee records for ${students?.length || 0} student(s) in ${classFee.class_name} - ${classFee.term} Term ${classFee.academic_year}.\n🧾 Receipts and payment transactions were preserved.`);
    await loadFeeStructureTab();
  } catch (err) {
    alert('Error: ' + err.message);
    // Re-enable button on error
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '🗑️ Delete Fee Record';
    }
  }
});

window.editClassFee = async function(feeId) {
  const { data: fee } = await supabaseClient.from('class_fees').select('*').eq('id', feeId).single();
  if (!fee) { alert('Fee record not found.'); return; }
  
  // Populate the Set/Update Class Fee form with the existing values
  getEl('feeSetClass').value = fee.class_name;
  getEl('feeSetYear').value = fee.academic_year;
  getEl('feeSetTerm').value = fee.term;
  getEl('feeSetAmount').value = fee.fee_amount;
  
  // Scroll to the form
  const formSection = document.querySelector('details.admit-section summary');
  if (formSection) {
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Open the details section
    const details = formSection.closest('details');
    if (details) details.open = true;
  }
};

// ================================================================
// STUDENT FEES TAB
// ================================================================

async function loadStudentFeesTab() {
  const schoolId = await getCurrentSchoolId();
  const search = (getEl('feeSearchStudent')?.value || '').toLowerCase();
  const classFilter = getEl('feeSearchClass')?.value || '';
  const termFilter = getEl('feeSearchTerm')?.value || '';
  const statusFilter = getEl('feeSearchStatus')?.value || '';

  // Get all students with their fee records
  let appQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying, student_photo_url');
  if (schoolId) appQuery = appQuery.eq('school_id', schoolId);
  const { data: students } = await appQuery;
  if (!students) return;

  // Get all fee records for this school
  let feeQuery = supabaseClient.from('fees').select('*');
  if (schoolId) feeQuery = feeQuery.eq('school_id', schoolId);
  const { data: feeRecords } = await feeQuery;

  // Build fee map
  const feeMap = {};
  if (feeRecords) {
    feeRecords.forEach(f => {
      const key = f.student_id;
      if (!feeMap[key]) feeMap[key] = [];
      feeMap[key].push(f);
    });
  }

  const tbody = getEl('feeStudentsBody');
  if (!tbody) return;

  let filtered = students.filter(s => {
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.toLowerCase();
    const matchesSearch = !search || name.includes(search) || s.student_id.toLowerCase().includes(search);
    const matchesClass = !classFilter || s.class_applying === classFilter;
    return matchesSearch && matchesClass;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const fees = feeMap[s.student_id] || [];
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`;
    const photoHtml = s.student_photo_url
      ? `<img src="${s.student_photo_url}" alt="Photo" class="student-photo-thumb" />`
      : '<span class="dash-photo-placeholder">🎓</span>';

    // Build term fee display
    const termDisplay = fees
      .filter(f => !termFilter || f.term === termFilter)
      .sort((a, b) => {
        const terms = ['First', 'Second', 'Third'];
        return terms.indexOf(a.term) - terms.indexOf(b.term);
      })
      .map(f => {
        const total = Number(f.total_amount) + Number(f.debt || 0);
        const paid = Number(f.amount_paid);
        const bal = total - paid;
        const overpaid = Number(f.overpaid_amount || 0);
        let status = bal <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
        let balanceDisplay = '';
        if (bal < 0) {
          // Negative balance = overpaid = credit for next term
          balanceDisplay = `<span class="fee-balance-credit">Credit: GH₵ ${formatCurrency(Math.abs(bal))} (will deduct from next term)</span>`;
          status = 'paid';
        } else {
          balanceDisplay = `<span class="fee-balance-${status}">Bal: GH₵ ${formatCurrency(bal)}</span>`;
        }
        return `<div class="fee-term-row">
          <span class="fee-term-label">${f.term} ${f.academic_year}:</span>
          <span>Total: GH₵ ${formatCurrency(total)}</span>
          <span>Paid: GH₵ ${formatCurrency(paid)}</span>
          ${balanceDisplay}
          ${overpaid > 0 ? `<span class="fee-credit-badge">💰 Credit: GH₵ ${formatCurrency(overpaid)}</span>` : ''}
          <span class="fee-status-badge fee-status-${status}">${status}</span>
        </div>`;
      }).join('') || '<span style="color:var(--text-muted);font-size:0.85rem;">No fee records</span>';

    const totalBalance = fees.reduce((sum, f) => {
      const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      // If negative (overpaid), it's a credit, don't count as balance due
      return sum + Math.max(bal, 0);
    }, 0);

    return `<tr>
      <td>${photoHtml}</td>
      <td><strong>${s.student_id}</strong></td>
      <td>${name}</td>
      <td>${s.class_applying}</td>
      <td>${termDisplay}</td>
      <td><strong>GH₵ ${formatCurrency(totalBalance)}</strong></td>
      <td>
        <button class="action-btn confirm" onclick="openFeePayment('${s.student_id}')">💰 Pay</button>
        <button class="action-btn" onclick="editStudentFee('${s.student_id}')">✏️ Edit Fees</button>
        <button class="action-btn" onclick="viewStudentReceipts('${s.student_id}')">🧾 Receipts</button>
        <button class="action-btn view" onclick="printFeeReminder('${s.student_id}')">🖨️ Reminder</button>
        <button class="action-btn danger" onclick="deleteStudentReceipts('${s.student_id}')">🗑️ Delete Receipt</button>
      </td>
    </tr>`;
  }).join('');
}

function filterFeeRecords() {
  loadStudentFeesTab();
}

// ================================================================
// PAYMENT TAB
// ================================================================

async function loadStudentFeeInfo() {
  const studentId = getEl('feePaymentStudentId').value.trim();
  if (!studentId) return;

  clearMessage('feePaymentMessage');
  const infoEl = getEl('feeStudentInfo');
  infoEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">Loading...</div>';

  // Get student
  const { data: student } = await supabaseClient.from('applications')
    .select('*')
    .eq('student_id', studentId)
    .maybeSingle();

  if (!student) {
    infoEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--danger);">❌ Student not found</div>';
    return;
  }

  // Get fee records
  const { data: fees } = await supabaseClient.from('fees')
    .select('*')
    .eq('student_id', studentId)
    .order('academic_year')
    .order('term');

  // Auto-fill academic year/term from the student's fee records
  // Show the first unpaid/partial fee record (chronologically), or if all paid, show the next term
  if (fees && fees.length > 0) {
    // Find the FIRST (earliest) fee record with an outstanding balance - this ensures
    // we always prioritize clearing old balances before new term fees
    const pendingFee = fees.find(f => {
      const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      return bal > 0;
    });
    
    if (pendingFee) {
      // The student has outstanding balance from an earlier term.
      // Auto-select this term to ensure it gets paid first before moving to newer terms.
      getEl('feePayAcademicYear').value = pendingFee.academic_year;
      getEl('feePayTerm').value = pendingFee.term;
    } else {
      // All terms are fully paid or overpaid - find the next term
      const terms = ['First', 'Second', 'Third'];
      const lastFee = fees[fees.length - 1];
      const lastTermIdx = terms.indexOf(lastFee.term);
      
      // Determine next term and year
      let nextTerm, nextYear;
      if (lastTermIdx >= 0 && lastTermIdx < 2) {
        nextTerm = terms[lastTermIdx + 1];
        nextYear = lastFee.academic_year;
      } else {
        nextTerm = 'First';
        const parts = lastFee.academic_year.split('/');
        nextYear = (parseInt(parts[0]) + 1) + '/' + (parseInt(parts[1]) + 1);
      }
      
      // Check if next term fee record already exists
      const nextFee = fees.find(f => f.academic_year === nextYear && f.term === nextTerm);
      if (nextFee) {
        getEl('feePayAcademicYear').value = nextFee.academic_year;
        getEl('feePayTerm').value = nextFee.term;
      } else {
        // Next term fee not set yet - show awaiting status
        getEl('feePayAcademicYear').value = nextYear;
        getEl('feePayTerm').value = nextTerm;
      }
    }
  } else {
    getEl('feePayAcademicYear').value = '';
    getEl('feePayTerm').value = 'First';
  }

  // Build fee summary
  const name = `${student.first_name} ${student.middle_name || ''} ${student.last_name}`;
  
  // Check if there are any unpaid balances from PRIOR terms that must be cleared first
  const selectedYear = getEl('feePayAcademicYear').value;
  const selectedTerm = getEl('feePayTerm').value;
  let priorBalanceHtml = '';
  
  if (fees && fees.length > 0 && selectedYear) {
    // Find the earliest unpaid term chronologically
    const pendingFees = fees.filter(f => {
      const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      return bal > 0;
    });
    
    if (pendingFees.length > 0) {
      const firstPending = pendingFees[0]; // Already sorted chronologically from DB query
      
      // Check if the selected term is AFTER the first unpaid term
      const termsOrder = ['First', 'Second', 'Third'];
      const firstPendingYearParts = firstPending.academic_year.split('/').map(Number);
      const selectedYearParts = selectedYear.split('/').map(Number);
      const firstPendingTermIdx = termsOrder.indexOf(firstPending.term);
      const selectedTermIdx = termsOrder.indexOf(selectedTerm);
      
      let isPayingLaterTerm = false;
      
      if (selectedYearParts[0] > firstPendingYearParts[0]) {
        isPayingLaterTerm = true;
      } else if (selectedYearParts[0] === firstPendingYearParts[0] && selectedTermIdx > firstPendingTermIdx) {
        isPayingLaterTerm = true;
      }
      
      if (isPayingLaterTerm) {
        // The user is trying to pay for a term that comes after an unpaid earlier term - BLOCK IT
        // Force the selection back to the earliest unpaid term
        getEl('feePayAcademicYear').value = firstPending.academic_year;
        getEl('feePayTerm').value = firstPending.term;
        
        priorBalanceHtml = `<div class="fee-payment-summary" style="margin:1rem 0;padding:1rem;background:#fee2e2;border:2px solid #ef4444;border-radius:6px;font-size:0.9rem;color:#991b1b;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-size:1.5rem;">⛔</span>
            <strong style="font-size:1.1rem;">Compulsory: Clear Previous Balance First!</strong>
          </div>
          <p style="margin:0 0 0.5rem 0;">
            <strong>${firstPending.term} Term ${firstPending.academic_year}</strong> has an outstanding balance of 
            <strong style="color:#dc2626;">GH₵ ${formatCurrency(firstPending.balance)}</strong> 
            that MUST be paid before you can proceed with the current term fees.
          </p>
          <p style="margin:0;font-size:0.85rem;">
            📌 The payment form has been automatically set to this term. Please clear this balance first.
          </p>
        </div>`;
      }
    }
  }

  let feeHtml = `<div class="fee-student-header">
    <div><strong>${student.student_id}</strong> - ${name}</div>
    <div>Class: ${student.class_applying}</div>
  </div>
  ${priorBalanceHtml}
  <div class="fee-records-list">`;

  if (!fees || fees.length === 0) {
    feeHtml += '<div style="padding:1rem;color:var(--text-muted);">No fee records for this student.</div>';
  } else {
    fees.forEach(f => {
      const total = Number(f.total_amount) + Number(f.debt || 0);
      const paid = Number(f.amount_paid);
      const bal = total - paid;
      const overpaid = Number(f.overpaid_amount || 0);
      let status = bal <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
      let balanceDisplay = '';
      if (bal < 0) {
        // Negative balance = overpaid = credit for next term
        balanceDisplay = `<span class="fee-balance-credit">Credit: GH₵ ${formatCurrency(Math.abs(bal))}</span>`;
        if (overpaid > 0) {
          balanceDisplay += ` <span class="fee-credit-badge">💰 Carried to next term</span>`;
        }
        status = 'paid';
      } else {
        balanceDisplay = `<span class="fee-balance-${status}">Balance: GH₵ ${formatCurrency(bal)}</span>`;
      }
      feeHtml += `<div class="fee-record-card ${status}">
        <div class="fee-record-term">${f.term} Term - ${f.academic_year}</div>
        <div class="fee-record-details">
          <span>Total: GH₵ ${formatCurrency(total)}</span>
          <span>Paid: GH₵ ${formatCurrency(paid)}</span>
          ${balanceDisplay}
          <span class="fee-status-badge fee-status-${status}">${status}</span>
        </div>
      </div>`;
    });
  }
  feeHtml += '</div>';

  // Check if all terms are paid and show next term status
  const allPaid = fees && fees.length > 0 && fees.every(f => {
    const bal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
    return bal <= 0;
  });
  
  if (allPaid && fees.length > 0) {
    const terms = ['First', 'Second', 'Third'];
    const lastFee = fees[fees.length - 1];
    const lastTermIdx = terms.indexOf(lastFee.term);
    
    let nextTerm, nextYear;
    if (lastTermIdx >= 0 && lastTermIdx < 2) {
      nextTerm = terms[lastTermIdx + 1];
      nextYear = lastFee.academic_year;
    } else {
      nextTerm = 'First';
      const parts = lastFee.academic_year.split('/');
      nextYear = (parseInt(parts[0]) + 1) + '/' + (parseInt(parts[1]) + 1);
    }
    
    const nextFee = fees.find(f => f.academic_year === nextYear && f.term === nextTerm);
    
    if (nextFee) {
      const nextBal = (Number(nextFee.total_amount) + Number(nextFee.debt || 0)) - Number(nextFee.amount_paid);
      const nextOverpaid = Number(nextFee.overpaid_amount || 0);
      let nextStatus = nextBal <= 0 ? 'paid' : (nextFee.amount_paid > 0 ? 'partial' : 'unpaid');
      
      feeHtml += `<div class="fee-payment-summary" style="margin-top:1rem;padding:0.75rem;background:#f0fdf4;border-radius:4px;font-size:0.85rem;color:#166534;">
        <strong>✅ All current terms paid!</strong><br/>
        Next: <strong>${nextTerm} Term ${nextYear}</strong> — 
        Total: GH₵ ${formatCurrency(Number(nextFee.total_amount) + Number(nextFee.debt || 0))} | 
        Paid: GH₵ ${formatCurrency(nextFee.amount_paid)} | 
        Balance: <span class="fee-balance-${nextStatus}">GH₵ ${formatCurrency(Math.max(nextBal, 0))}</span>
        ${nextOverpaid > 0 ? ` | <span class="fee-credit-badge">💰 Credit: GH₵ ${formatCurrency(nextOverpaid)}</span>` : ''}
        <span class="fee-status-badge fee-status-${nextStatus}" style="margin-left:0.5rem;">${nextStatus}</span>
      </div>`;
    } else {
      // Next term fee not set yet - show awaiting status
      feeHtml += `<div class="fee-payment-summary" style="margin-top:1rem;padding:0.75rem;background:#fef3c7;border-radius:4px;font-size:0.85rem;color:#92400e;">
        <strong>⏳ Awaiting Next Term Fee</strong><br/>
        All current terms are paid. The fee for <strong>${nextTerm} Term ${nextYear}</strong> has not been set yet.<br/>
        Once the fee structure is set via "Set / Update Class Fee", the fee record will be automatically created with any overpaid credit applied.
      </div>`;
    }
  }
  
  // Payment form note
  feeHtml += `<div class="fee-payment-summary" style="margin-top:1rem;padding:0.75rem;background:#fef3c7;border-radius:4px;font-size:0.85rem;color:#92400e;">
    <strong>📌 Note:</strong> Select the Academic Year and Term above, then enter the payment amount. Fee records are automatically created when you set the fee structure via "Set / Update Class Fee".
  </div>`;

  infoEl.innerHTML = feeHtml;

  // Store student info for payment
  infoEl.dataset.studentId = studentId;
  infoEl.dataset.studentName = name;
  infoEl.dataset.className = student.class_applying;
}

// Open payment from students tab
window.openFeePayment = async function(studentId) {
  // Switch to payment tab
  document.querySelectorAll('.fee-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-fee-tab="payment"]')?.classList.add('active');
  document.querySelectorAll('.fee-tab-content').forEach(c => c.style.display = 'none');
  const target = getEl('feeTab-payment');
  if (target) target.style.display = 'block';

  getEl('feePaymentStudentId').value = studentId;
  await loadStudentFeeInfo();
};

async function recordPayment() {
  const studentId = getEl('feePaymentStudentId').value.trim();
  const year = getEl('feePayAcademicYear').value;
  const term = getEl('feePayTerm').value;
  const amount = parseFloat(getEl('feePayAmount').value);
  const method = getEl('feePayMethod').value;
  const reference = getEl('feePayReference').value.trim() || null;
  const notes = getEl('feePayNotes').value.trim() || null;

  if (!studentId) { showMessage('feePaymentMessage', 'Enter a student ID.', 'error'); return; }
  if (!amount || amount <= 0) { showMessage('feePaymentMessage', 'Enter a valid amount.', 'error'); return; }

  // CHECK 1: Ensure the selected term's fee record exists and is not already fully paid
  const { data: currentFeeRec } = await supabaseClient.from('fees')
    .select('total_amount, amount_paid, debt')
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('term', term)
    .maybeSingle();

  if (!currentFeeRec) {
    showMessage('feePaymentMessage', 
      `❌ No fee record found for ${studentId} for ${term} Term ${year}.\n\nPlease go to the "Set / Update Class Fee" section to set the fee structure first. Fee records are automatically created when the fee structure is set.`, 
      'error');
    return;
  }

  const totalDue = Number(currentFeeRec.total_amount) + Number(currentFeeRec.debt || 0);
  const currentPaid = Number(currentFeeRec.amount_paid);
  const outstanding = totalDue - currentPaid;

  if (outstanding <= 0) {
    showMessage('feePaymentMessage', 
      `✅ ${studentId} has already fully paid for ${term} Term ${year}.\n\nTotal Due: GH₵ ${formatCurrency(totalDue)}\nAmount Paid: GH₵ ${formatCurrency(currentPaid)}\n\nNo further payment is needed for this term.`, 
      'error');
    return;
  }

  // CHECK 2: Ensure no prior term has an outstanding balance before allowing this payment
  const priorBalance = await getPriorTermBalance(studentId, year, term);
  if (priorBalance) {
    showMessage('feePaymentMessage', 
      `⛔ COMPULSORY: Cannot pay for ${term} Term ${year} because there is an outstanding balance from a previous term.\n\n` +
      `Unpaid: ${priorBalance.term} Term ${priorBalance.academic_year}\n` +
      `Amount Due: GH₵ ${formatCurrency(priorBalance.balance)}\n\n` +
      `💡 Please select "${priorBalance.term} Term ${priorBalance.academic_year}" in the Academic Year/Term dropdown above and clear this previous balance first.`, 
      'error');
    return;
  }

  // Get fee record with overpaid info for the overpayment check
  const { data: currentFee } = await supabaseClient.from('fees')
    .select('total_amount, amount_paid, debt, overpaid_amount')
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('term', term)
    .maybeSingle();

  if (amount > outstanding && outstanding > 0) {
    showMessage('feePaymentMessage',
      `⛔ OVERPAYMENT PREVENTED\n\n` +
      `Outstanding for ${term} Term ${year}: GH₵ ${formatCurrency(outstanding)}\n` +
      `You attempted to pay: GH₵ ${formatCurrency(amount)}\n` +
      `Excess amount: GH₵ ${formatCurrency(amount - outstanding)}\n\n` +
      `💡 Please enter an amount equal to or less than the outstanding balance of GH₵ ${formatCurrency(outstanding)}.\n` +
      `Overpayment is not allowed. If you need to pay for the next term, please use that term's payment form.`,
      'error');
    return;
  }

  if (!confirm(`Record payment of GH₵ ${formatCurrency(amount)} for ${studentId}?\n\nA receipt will be generated automatically.`)) return;

  const btn = getEl('feeRecordPaymentBtn');
  setLoading(btn, true, 'Processing...');
  clearMessage('feePaymentMessage');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const schoolId = await getCurrentSchoolId();

    // Call the process_fee_payment RPC function
    const { data, error } = await supabaseClient.rpc('process_fee_payment', {
      p_student_id: studentId,
      p_academic_year: year,
      p_term: term,
      p_amount: amount,
      p_payment_method: method,
      p_reference_number: reference,
      p_notes: notes,
      p_recorded_by: user?.id || null,
      p_school_id: schoolId,
    });

    if (error) throw error;

    if (!data.success) {
      showMessage('feePaymentMessage', 'Error: ' + (data.error || 'Payment processing failed'), 'error');
      return;
    }

    // Determine if this is a previous term payment (for receipt emphasis)
    const termsOrder = ['First', 'Second', 'Third'];
    const currentTermIdx = termsOrder.indexOf(term);
    const currentYear = new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
    const yearParts = year.split('/').map(Number);
    const currentYearParts = currentYear.split('/').map(Number);
    let isPreviousTermPayment = false;
    
    if (yearParts[0] < currentYearParts[0]) {
      isPreviousTermPayment = true;
    } else if (yearParts[0] === currentYearParts[0] && currentTermIdx < termsOrder.indexOf('First')) {
      // If current term is not First, and we're paying for an earlier term in same year
      // This is simplified - we check if the paid term is before the current actual term
      const settings = await supabaseClient.from('settings').select('current_term').eq('id', 'singleton').maybeSingle();
      const actualCurrentTerm = settings?.data?.current_term || 'First';
      const actualCurrentTermIdx = termsOrder.indexOf(actualCurrentTerm);
      if (currentTermIdx < actualCurrentTermIdx) {
        isPreviousTermPayment = true;
      }
    }

    let successMsg = `✅ Payment recorded successfully!\nReceipt: ${data.receipt_number}\nAmount: GH₵ ${formatCurrency(data.amount_paid)}\nStatus: ${data.payment_status}`;

    showMessage('feePaymentMessage', successMsg, 'success');
    logSubAdminActivity(`Recorded payment of GH₵ ${amount} for ${studentId} (Receipt: ${data.receipt_number})`, 'payment', `${studentId} - ${data.student_name}`);

    // Notify the parent via SMS as soon as the payment is recorded
    sendFeePaymentSms({
      studentId,
      receiptNumber: data.receipt_number,
      amount: data.amount_paid,
      term,
      academicYear: year,
      method,
      studentName: data.student_name,
      className: data.class,
      schoolName: data.school_name,
      remainingBalance: data.remaining_balance,
    });

    // Clear payment fields
    getEl('feePayAmount').value = '';
    getEl('feePayReference').value = '';
    getEl('feePayNotes').value = '';

    // Reload fee info
    await loadStudentFeeInfo();

    // Fetch student photo URL for QR code
    let studentPhotoUrl = '';
    try {
      const { data: studentApp } = await supabaseClient.from('applications')
        .select('student_photo_url')
        .eq('student_id', studentId)
        .maybeSingle();
      if (studentApp?.student_photo_url) studentPhotoUrl = studentApp.student_photo_url;
    } catch (e) { /* ignore photo fetch errors */ }

    // Show receipt with previous term flag
    showReceiptModal({ ...data, student_id: studentId, student_photo_url: studentPhotoUrl, is_previous_term_payment: isPreviousTermPayment });

  } catch (err) {
    showMessage('feePaymentMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '💾 Record Payment');
  }
}

// ================================================================
// RECEIPT MODAL & PRINTING
// ================================================================

async function showReceiptModal(data) {
  // Fetch school logo URL if not already present
  if (!data.school_logo_url) {
    try {
      const schoolId = await getCurrentSchoolId();
      if (schoolId) {
        const { data: schoolSettings } = await supabaseClient.from('school_settings')
          .select('logo_url')
          .eq('school_id', schoolId)
          .maybeSingle();
        if (schoolSettings?.logo_url) {
          data.school_logo_url = schoolSettings.logo_url;
        } else {
          const { data: school } = await supabaseClient.from('schools')
            .select('logo_url')
            .eq('id', schoolId)
            .maybeSingle();
          if (school?.logo_url) data.school_logo_url = school.logo_url;
        }
      }
    } catch (e) { /* ignore logo fetch errors */ }
  }
  const receiptHtml = generateReceiptHTML(data);
  const modal = getEl('receiptModal');
  const content = getEl('receiptContent');
  if (content) content.innerHTML = receiptHtml;
  // Render QR code for security verification
  renderReceiptQR(data);
  if (modal) modal.style.display = 'flex';
}

// ================================================================
// QR CODE SECURITY - Receipt Verification
// Now renders a URL QR code. Scanning it opens the public
// verify-receipt.html page which displays EVERY content of the
// fee receipt (school, student, fees, payment, issuer, notes...).
// ================================================================

// ⚠️ IMPORTANT — "site can't be reached" when scanning?
// The QR encodes a URL that a phone must be able to open. If the app is
// only running on your PC (localhost) the phone can never reach it.
// The public base URL is configured in js/supabase-config.js
// (RECEIPT_VERIFY_BASE_URL). Set it to your PUBLIC deployment URL (e.g.
// your Vercel site) so receipts are scannable from any phone — including
// while you work locally. Leave it '' to auto-use the current site's
// origin, which works after you deploy (Vercel/GitHub Pages) but not from
// localhost/file://.

// Resolve the base URL used for the verification page, preferring the
// explicitly configured public URL over the current window origin.
function getReceiptVerificationInfo() {
  let base = RECEIPT_VERIFY_BASE_URL ? String(RECEIPT_VERIFY_BASE_URL).replace(/\/+$/, '') : '';
  let host = '';
  if (!base && typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
    base = String(window.location.origin).replace(/\/+$/, '');
  }
  try { host = (window.location && window.location.hostname) || ''; } catch (e) { host = ''; }
  // A host becomes unscannable when it's empty (file://) or a local/private address.
  const isLocal = !base || host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  return { base, host, isLocal };
}

function buildReceiptQRPayload(data) {
  // Encode ONLY the secure verification token in the QR. Each receipt gets a
  // random, unguessable token (see sql/037-receipt-verification-token.sql).
  // Scanning the QR opens verify-receipt.html?t=<token>, which looks the full
  // receipt up in the database via get_receipt_for_verification(). Using a
  // token (instead of the sequential receipt_number) prevents anyone from
  // guessing or enumerating receipts by scanning nearby numbers.
  const token = data.verification_token || data.verificationToken || '';

  // Point to the public verification page with just the secure token.
  const { base } = getReceiptVerificationInfo();
  const baseUrl = base ? base + '/verify-receipt.html' : 'verify-receipt.html';

  if (token) {
    return baseUrl + '?t=' + encodeURIComponent(String(token));
  }

  // Fallback for receipts that predate the token upgrade (still verifiable via
  // the legacy receipt_number path, which get_receipt_for_verification accepts).
  const receiptNumber = data.receipt_number || data.receiptNumber || '';
  return receiptNumber
    ? baseUrl + '?r=' + encodeURIComponent(String(receiptNumber))
    : baseUrl;
}


// Size of the receipt QR. The internal resolution is higher than the on-screen
// size so the printed / downloaded QR stays crisp, while the display size keeps
// the framed QR fitting neatly on the receipt.
const RECEIPT_QR_INTERNAL = 220;
const RECEIPT_QR_DISPLAY = 120;

// NOTE: The receipt QR is intentionally rendered as a clean, standard QR Code
// Model 2 with NO centre logo. Embedding an image/logo in the middle of the code
// obscures the finder/alignment patterns and makes plain Android / iPhone camera
// scanners fail to detect it, so we deliberately avoid a logo here and instead
// rely on a proper white quiet zone (margin + padding) for reliable scanning.

function renderReceiptQR(data) {
  const container = getEl('receiptQRCode');
  if (!container) return;
  container.innerHTML = ''; // Clear previous QR code

  try {
    const payload = buildReceiptQRPayload(data);
    const { isLocal, base } = getReceiptVerificationInfo();
    if (isLocal) {
      console.warn('⚠️ Receipt QR link is local (' + (base || 'no origin') + ') — a phone cannot reach it. Set RECEIPT_VERIFY_BASE_URL in js/supabase-config.js to your public URL.');
    }

    // node-qrcode browser build — generates a clean, standard QR Code Model 2
    // with NO centre logo so native Android / iPhone camera apps detect & scan it.
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `width:${RECEIPT_QR_DISPLAY}px;height:${RECEIPT_QR_DISPLAY}px;display:block;`;

    QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: 'M',   // standard Model 2 medium — larger modules, camera friendly
      width: RECEIPT_QR_INTERNAL,
      margin: 3                    // proper quiet zone all around for reliable scanning
    }).then(() => {
      // White backing + padding give the QR a clean quiet zone (no logo to obscure it).
      const slot = document.createElement('div');
      slot.style.cssText = 'display:inline-block;background:#ffffff;border-radius:12px;padding:12px;';
      slot.appendChild(canvas);

      // Small, airy frame around the code.
      const frame = document.createElement('div');
      frame.style.cssText = 'display:inline-block;background:#ffffff;padding:18px 22px;border:1px solid #dde1f2;border-radius:18px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.05);';
      frame.appendChild(slot);

      // Small school-name label with letter-spacing.
      const label = document.createElement('div');
      label.style.cssText = 'margin-top:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.62rem;color:#858aa8;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;';
      label.textContent = data.school_name || 'Scan to verify';
      frame.appendChild(label);

      container.appendChild(frame);
    }).catch((e) => {
      console.warn('QR render failed:', e);
      container.innerHTML = '<span style="font-size:0.7rem;color:#999;">QR unavailable</span>';
    });
  } catch (e) {
    container.innerHTML = '<span style="font-size:0.7rem;color:#999;">QR unavailable</span>';
  }
}

export { renderReceiptQR };

export function generateReceiptHTML(data) {
  const schoolName = data.school_name || 'School';
  const schoolLogoUrl = data.school_logo_url || '';

  // Show a visible warning right on the receipt when the QR link is local
  // (built from localhost / file://) and therefore cannot be scanned by a phone.
  const verifyInfo = getReceiptVerificationInfo();
  const verifyWarning = verifyInfo.isLocal
    ? '<div class="receipt-generated" style="margin-top:0.35rem;font-size:0.6rem;color:#b45309;line-height:1.35;">⚠️ QR link is local — not scannable from a phone. Set RECEIPT_VERIFY_BASE_URL in js/supabase-config.js to your public URL (e.g. your Vercel site).</div>'
    : '';
  const now = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const overpaidAmount = Number(data.overpaid_amount || 0);
  const remainingBalance = Number(data.remaining_balance || 0);
  const debtAmount = Number(data.debt || 0);
  const isPreviousTermPayment = data.is_previous_term_payment === true;

  // Determine if this payment is for an arrears/prior term balance
  // If there's a debt amount > 0 carried into this term, part of this payment covers that debt
  // Or if the term being paid is not the latest term chronologically
  const hasArrears = debtAmount > 0 && (Number(data.amount_now || data.amount_paid) > 0);

  let balanceRow = '';
  let overpaymentNotice = '';
  let arrearsBadge = '';

  // Show prominent PREVIOUS TERM PAYMENT badge if this is a previous term payment
  if (isPreviousTermPayment) {
    arrearsBadge = `<div class="receipt-credit-notice" style="margin:0.5rem 0;padding:0.75rem;background:#fee2e2;border:2px solid #ef4444;border-radius:6px;font-size:0.9rem;color:#991b1b;text-align:center;">
      <div style="font-size:1.5rem;margin-bottom:0.25rem;">⏪</div>
      <strong style="font-size:1.1rem;">PREVIOUS TERM PAYMENT</strong><br/>
      <span style="font-size:0.85rem;">This payment is for <strong>${data.term} Term ${data.academic_year}</strong> — an earlier term balance.</span>
    </div>`;
  } else if (hasArrears) {
    arrearsBadge = `<div class="receipt-credit-notice" style="margin:0.5rem 0;padding:0.5rem;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;font-size:0.85rem;color:#92400e;">
      ⏰ <strong>ARREARS PAYMENT</strong> — This payment includes GH₵ ${formatCurrency(debtAmount)} towards outstanding balance carried forward from a previous term.
    </div>`;
  }

  if (overpaidAmount > 0) {
    balanceRow = `<tr>
      <td>Remaining Balance</td>
      <td style="text-align:right;"><span class="fee-balance-credit">-GH₵ ${formatCurrency(overpaidAmount)} (Credit for next term)</span></td>
    </tr>`;
    overpaymentNotice = `<div class="receipt-credit-notice" style="margin-top:0.5rem;padding:0.5rem;background:#f0fdf4;border-radius:4px;font-size:0.85rem;color:#166534;">
      💰 <strong>GH₵ ${formatCurrency(overpaidAmount)}</strong> overpaid — this credit will be deducted from the next term's fees.
    </div>`;
  } else {
    balanceRow = `<tr>
      <td>Remaining Balance</td>
      <td style="text-align:right;">${formatCurrency(remainingBalance)}</td>
    </tr>`;
  }

  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="School Logo" style="width:60px;height:60px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;margin-bottom:0.25rem;" />`
    : '';

  return `
    <div class="receipt-container">
      <div class="receipt-header">
        ${logoHtml}
        <div class="receipt-school-name">${schoolName}</div>
        <div class="receipt-title">OFFICIAL RECEIPT</div>
        <div class="receipt-number">#${data.receipt_number}</div>
      </div>
      <div class="receipt-body">
        <div class="receipt-date">Date: ${now}</div>
        <div class="receipt-divider"></div>
        <div class="receipt-student-info">
          <div><strong>Student:</strong> ${data.student_name}</div>
          <div><strong>Student ID:</strong> ${data.student_id || ''}</div>
          <div><strong>Class:</strong> ${data.class}</div>
          <div><strong>Term:</strong> ${data.term || ''} - ${data.academic_year || ''}</div>
        </div>
        <div class="receipt-divider"></div>
        ${arrearsBadge}
        <table class="receipt-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align:right;">Amount (GH₵)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Total Fees Due</td>
              <td style="text-align:right;">${formatCurrency(data.total_due || (data.total_fees + (data.debt || 0)))}</td>
            </tr>
            <tr>
              <td>Amount Paid Previously</td>
              <td style="text-align:right;">${formatCurrency(data.amount_paid_before || 0)}</td>
            </tr>
            <tr class="receipt-highlight-row">
              <td><strong>Amount Paid Now</strong></td>
              <td style="text-align:right;"><strong>${formatCurrency(data.amount_now || data.amount_paid)}</strong></td>
            </tr>
            <tr>
              <td>Total Paid</td>
              <td style="text-align:right;">${formatCurrency(data.total_paid)}</td>
            </tr>
            ${balanceRow}
          </tbody>
        </table>
        ${overpaymentNotice}
        <div class="receipt-payment-method">
          Payment Method: <strong>${data.payment_method || 'Cash'}</strong>
          ${data.reference_number ? `| Reference: ${data.reference_number}` : ''}
        </div>
        <div class="receipt-status">
          Status: <span class="fee-status-badge fee-status-${data.payment_status}">${data.payment_status.toUpperCase()}</span>
        </div>
        ${data.notes ? `<div class="receipt-notes">Notes: ${data.notes}</div>` : ''}
      </div>
      <div class="receipt-footer">
        <div class="receipt-thankyou">Thank you for your payment!</div>
        ${data.processed_by ? `<div class="receipt-processed-by" style="font-size:0.75rem;color:#555;margin-top:0.4rem;">Processed by: <strong>${data.processed_by_label || 'Staff'}: ${data.processed_by}</strong></div>` : ''}
        <div class="receipt-qr-section" style="margin-top:1rem;text-align:center;border-top:1px dashed #999;padding-top:0.75rem;">
          <div id="receiptQRCode" style="display:inline-block;"></div>
          <div class="receipt-generated" style="margin-top:0.3rem;font-size:0.65rem;">Scan to view &amp; verify full receipt details</div>
          ${verifyWarning}
        </div>
        <div class="receipt-generated" style="margin-top:0.3rem;font-size:0.65rem;">Generated by Student Admission Portal</div>
      </div>
    </div>
  `;
}

// View student receipts
window.viewStudentReceipts = async function(studentId) {
  const { data: receipts } = await supabaseClient.from('receipts')
    .select('*')
    .eq('student_id', studentId)
    .order('receipt_date', { ascending: false });

  const modal = getEl('receiptListModal');
  const content = getEl('receiptListContent');
  if (!content) return;

  if (!receipts || receipts.length === 0) {
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts found for this student.</div>';
  } else {
    content.innerHTML = `<div style="margin-bottom:1rem;"><strong>${receipts.length}</strong> receipt(s) found</div>
    <table class="app-table">
      <thead><tr><th>Receipt #</th><th>Date</th><th>Term</th><th>Amount</th><th>Method</th><th>Action</th></tr></thead>
      <tbody>
        ${receipts.map(r => `
          <tr>
            <td><strong>${r.receipt_number}</strong></td>
            <td>${formatDate(r.receipt_date)}</td>
            <td>${r.term} ${r.academic_year}</td>
            <td>GH₵ ${formatCurrency(r.amount)}</td>
            <td>${r.payment_method}</td>
            <td><button class="action-btn confirm" onclick="reprintReceipt('${r.id}')">🖨️ Reprint</button>
            <button class="action-btn danger" onclick="deleteReceiptRecord('${r.id}', '${r.student_id}')">🗑️ Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }
  if (modal) modal.style.display = 'flex';
};

// Open the receipts modal for a student, focused on deleting a receipt.
// Clicking the per-student "Delete Receipt" button in the fees
// management table opens the same list, where each receipt has a
// 🗑️ Delete action (in case of a mistaken fee payment).
window.deleteStudentReceipts = async function(studentId) {
  await viewStudentReceipts(studentId);
};

// Delete a single receipt from the database and reverse the payment.
window.deleteReceiptRecord = async function(receiptId, studentId) {
  if (!confirm(`🗑️ DELETE RECEIPT\n\nAre you sure you want to permanently delete this receipt and REVERSE the payment?\n\nThe fee record will be recalculated (amount paid / status updated) to undo this payment.\n\nThis action CANNOT be undone!`)) return;

  // Second confirmation for extra safety
  if (!confirm(`⚠️ FINAL CONFIRMATION\n\nThis will remove the receipt and its payment transaction from the database and reverse the payment. Continue?`)) return;

  try {
    const { data, error } = await supabaseClient.rpc('delete_receipt', {
      p_receipt_id: receiptId,
    });

    if (error) throw error;
    if (!data.success) {
      alert('Error: ' + (data.error || 'Failed to delete receipt.'));
      return;
    }

    alert(`✅ Receipt ${data.receipt_number} deleted and payment of GH₵ ${formatCurrency(data.amount)} reversed successfully.`);

    logSubAdminActivity(`Deleted receipt ${data.receipt_number} for ${data.student_id} and reversed payment (GH₵ ${formatCurrency(data.amount)})`, 'fee', `${data.receipt_number}: GH₵ ${formatCurrency(data.amount)}`);

    // Refresh the receipts modal and the fees/dashboard tables
    await viewStudentReceipts(studentId);
    try { await loadStudentFeesTab(); } catch (e) { /* table may be hidden */ }
    try { await loadDebtorsList(); } catch (e) { /* ignore */ }
  } catch (err) {
    alert('Error deleting receipt: ' + err.message);
  }
};

// Print an A5 fees reminder note for a single student, reminding the
// parent/guardian of the current balance still left to pay.
window.printFeeReminder = async function(studentId) {
  const schoolId = await getCurrentSchoolId();

  // --- School name & logo ---
  let schoolName = 'School';
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
          schoolName = school.name;
          schoolLogoUrl = school.logo_url || '';
        }
      }
    } catch (e) { /* keep school defaults */ }
  }

  // --- Student info ---
  const { data: student } = await supabaseClient.from('applications')
    .select('first_name, middle_name, last_name, class_applying, parent_name, parent_contact')
    .eq('student_id', studentId)
    .maybeSingle();
  if (!student) { alert('Student not found.'); return; }

  const studentName = `${student.first_name} ${student.middle_name || ''} ${student.last_name}`.trim();
  const parentName = student.parent_name || 'Parent / Guardian';
  const parentContact = student.parent_contact || '';

  // --- Fee records ---
  const { data: feeRecords } = await supabaseClient.from('fees').select('*').eq('student_id', studentId);

  const termOrder = { First: 1, Second: 2, Third: 3 };
  const sortedFees = (feeRecords || []).slice().sort((a, b) => {
    const yearCmp = (a.academic_year || '').localeCompare(b.academic_year || '');
    return yearCmp !== 0 ? yearCmp : (termOrder[a.term] || 0) - (termOrder[b.term] || 0);
  });

  let totalOutstanding = 0;
  const rows = sortedFees.map((f, i) => {
    const total = Number(f.total_amount || 0) + Number(f.debt || 0);
    const paid = Number(f.amount_paid || 0);
    const bal = total - paid;
    const overpaid = bal < 0;
    if (!overpaid) totalOutstanding += bal;
    const balCell = overpaid
      ? `<span style="color:#166534;">Credit GH₵ ${formatCurrency(Math.abs(bal))}</span>`
      : `<span style="color:${bal > 0 ? '#b91c1c' : '#166534'};font-weight:${bal > 0 ? 700 : 400};">GH₵ ${formatCurrency(bal)}</span>`;
    const rowBg = i % 2 === 0 ? '#fff' : '#f6f8fb';
    return `<tr style="background:${rowBg};">
      <td style="padding:5px;border:1px solid #ddd;font-size:11px;">${f.term} Term ${f.academic_year}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">GH₵ ${formatCurrency(total)}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">GH₵ ${formatCurrency(paid)}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">${balCell}</td>
    </tr>`;
  }).join('');

  const noFeesRow = sortedFees.length === 0
    ? '<tr><td colspan="4" style="padding:6px;border:1px solid #ddd;text-align:center;color:#777;font-size:12px;">No fee records found for this student.</td></tr>'
    : '';


const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" style="width:52px;height:52px;object-fit:contain;border-radius:6px;" />`
    : '<div style="width:52px;height:52px;border-radius:6px;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;">🏛️</div>';

  const now = formatDate(new Date().toISOString());

  const pageHtml = `
    <div class="a5-page">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:3px solid #1e3a5f;padding-bottom:8px;margin-bottom:10px;">
        ${logoHtml}
        <div style="flex:1;text-align:center;">
          <div style="font-size:16px;font-weight:700;color:#1e3a5f;">${schoolName}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#1e3a5f;">🧾 FEES REMINDER NOTE</div>
          <div style="font-size:10px;color:#555;">Issued: ${now}</div>
        </div>
      </div>

      <div style="font-size:11px;margin-bottom:10px;padding:8px;background:#f0f4f9;border-radius:6px;line-height:1.6;">
        <strong>Student:</strong> ${studentName}<br/>
        <strong>ID:</strong> ${studentId} &nbsp;|&nbsp; <strong>Class:</strong> ${student.class_applying}<br/>
        <strong>Parent / Guardian:</strong> ${parentName}${parentContact ? ` &nbsp;|&nbsp; <strong>Contact:</strong> ${parentContact}` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <thead>
          <tr style="background:#1e3a5f;color:#fff;">
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:left;font-size:11px;">Term / Year</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Total (GH₵)</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Paid (GH₵)</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Balance (GH₵)</th>
          </tr>
        </thead>
        <tbody>
          ${rows || noFeesRow}
        </tbody>
      </table>

      <div style="border:2px solid #1e3a5f;border-radius:8px;padding:8px 10px;margin-bottom:10px;background:#eef2f7;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">TOTAL BALANCE LEFT TO PAY</span>
          <span style="font-size:18px;font-weight:800;color:#b91c1c;">GH₵ ${formatCurrency(totalOutstanding)}</span>
        </div>
      </div>

      <div style="border:2px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:10px;font-size:11px;color:#78350f;line-height:1.55;">
        <strong style="font-size:12px;">📢 REMINDER TO PARENT / GUARDIAN</strong><br/>
        Dear ${parentName},<br/>
        This is to remind you that your ward, <strong>${studentName}</strong> (${student.class_applying}), currently has an outstanding school fees balance of
        <strong>GH₵ ${formatCurrency(totalOutstanding)}</strong> left to be paid.
        ${totalOutstanding > 0
          ? `Kindly settle the outstanding balance as soon as possible to enable your ward's smooth and uninterrupted participation in school activities.`
          : `Your ward's fees are fully settled. Thank you for your timely payment.`}
        <br/>We thank you for your continued support.
      </div>

      <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:10px;color:#555;">
        <div>______________________<br/>Student's Signature</div>
        <div>______________________<br/>Parent's Signature</div>
        <div>______________________<br/>School Official</div>
      </div>
    </div>`;

  openPrintWindow(`
    <html><head>
      <title>Fees Reminder - ${studentName}</title>
      <style>
        @page { size: A5 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .a5-page { width: 148mm; min-height: 190mm; }
        @media print {
          body { margin: 0; padding: 0; }
          .a5-page { width: 148mm; }
        }
      </style>
    </head><body>${pageHtml}</body></html>
  `, `Fees Reminder - ${studentName}`, 560, 800);

  logSubAdminActivity(`Printed fees reminder note for ${studentId} (${studentName})`, 'fee', `${studentId}: balance GH₵ ${formatCurrency(totalOutstanding)}`);
};
// ================================================================
//  A5 FEES REMINDER NOTE — shared builders (single + bulk print)
// ================================================================

// Resolve the school display name & logo for printing.
async function getSchoolPrintInfo(schoolId) {
  let schoolName = 'School';
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
          schoolName = school.name;
          schoolLogoUrl = school.logo_url || '';
        }
      }
    } catch (e) { /* keep defaults */ }
  }
  return { schoolName, schoolLogoUrl };
}

// Load & compute a single student's reminder data.
async function buildFeeReminderData(studentId) {
  const { data: student } = await supabaseClient.from('applications')
    .select('first_name, middle_name, last_name, class_applying, parent_name, parent_contact')
    .eq('student_id', studentId)
    .maybeSingle();
  if (!student) return null;

  const studentName = `${student.first_name} ${student.middle_name || ''} ${student.last_name}`.trim();
  const parentName = student.parent_name || 'Parent / Guardian';
  const parentContact = student.parent_contact || '';

  const { data: feeRecords } = await supabaseClient.from('fees').select('*').eq('student_id', studentId);
  const termOrder = { First: 1, Second: 2, Third: 3 };
  const sortedFees = (feeRecords || []).slice().sort((a, b) => {
    const yearCmp = (a.academic_year || '').localeCompare(b.academic_year || '');
    return yearCmp !== 0 ? yearCmp : (termOrder[a.term] || 0) - (termOrder[b.term] || 0);
  });

  let totalOutstanding = 0;
  const rows = sortedFees.map((f, i) => {
    const total = Number(f.total_amount || 0) + Number(f.debt || 0);
    const paid = Number(f.amount_paid || 0);
    const bal = total - paid;
    const overpaid = bal < 0;
    if (!overpaid) totalOutstanding += bal;
    const balCell = overpaid
      ? `<span style="color:#166534;">Credit GH₵ ${formatCurrency(Math.abs(bal))}</span>`
      : `<span style="color:${bal > 0 ? '#b91c1c' : '#166534'};font-weight:${bal > 0 ? 700 : 400};">GH₵ ${formatCurrency(bal)}</span>`;
    const rowBg = i % 2 === 0 ? '#fff' : '#f6f8fb';
    return `<tr style="background:${rowBg};">
      <td style="padding:5px;border:1px solid #ddd;font-size:11px;">${f.term} Term ${f.academic_year}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">GH₵ ${formatCurrency(total)}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">GH₵ ${formatCurrency(paid)}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-size:11px;">${balCell}</td>
    </tr>`;
  }).join('');

  const noFeesRow = sortedFees.length === 0
    ? '<tr><td colspan="4" style="padding:6px;border:1px solid #ddd;text-align:center;color:#777;font-size:12px;">No fee records found for this student.</td></tr>'
    : '';

  return {
    studentId,
    studentName,
    parentName,
    parentContact,
    className: student.class_applying || '',
    rows,
    noFeesRow,
    totalOutstanding
  };
}


// Render a single A5 reminder page for one student (shared between single & bulk).
function renderFeeReminderA5(data, schoolInfo) {
  const { schoolName, schoolLogoUrl } = schoolInfo;
  const { studentId, studentName, parentName, parentContact, className, rows, noFeesRow, totalOutstanding } = data;
  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" style="width:52px;height:52px;object-fit:contain;border-radius:6px;" />`
    : '<div style="width:52px;height:52px;border-radius:6px;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;">🏛️</div>';
  const now = formatDate(new Date().toISOString());

  return `
    <div class="a5-page">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:3px solid #1e3a5f;padding-bottom:8px;margin-bottom:10px;">
        ${logoHtml}
        <div style="flex:1;text-align:center;">
          <div style="font-size:16px;font-weight:700;color:#1e3a5f;">${schoolName}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#1e3a5f;">🧾 FEES REMINDER NOTE</div>
          <div style="font-size:10px;color:#555;">Issued: ${now}</div>
        </div>
      </div>

      <div style="font-size:11px;margin-bottom:10px;padding:8px;background:#f0f4f9;border-radius:6px;line-height:1.6;">
        <strong>Student:</strong> ${studentName}<br/>
        <strong>ID:</strong> ${studentId} &nbsp;|&nbsp; <strong>Class:</strong> ${className}<br/>
        <strong>Parent / Guardian:</strong> ${parentName}${parentContact ? ` &nbsp;|&nbsp; <strong>Contact:</strong> ${parentContact}` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <thead>
          <tr style="background:#1e3a5f;color:#fff;">
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:left;font-size:11px;">Term / Year</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Total (GH₵)</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Paid (GH₵)</th>
            <th style="padding:5px;border:1px solid #1e3a5f;text-align:right;font-size:11px;">Balance (GH₵)</th>
          </tr>
        </thead>
        <tbody>
          ${rows || noFeesRow}
        </tbody>
      </table>

      <div style="border:2px solid #1e3a5f;border-radius:8px;padding:8px 10px;margin-bottom:10px;background:#eef2f7;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">TOTAL BALANCE LEFT TO PAY</span>
          <span style="font-size:18px;font-weight:800;color:#b91c1c;">GH₵ ${formatCurrency(totalOutstanding)}</span>
        </div>
      </div>

      <div style="border:2px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:10px;font-size:11px;color:#78350f;line-height:1.55;">
        <strong style="font-size:12px;">📢 REMINDER TO PARENT / GUARDIAN</strong><br/>
        Dear ${parentName},<br/>
        This is to remind you that your ward, <strong>${studentName}</strong> (${className}), currently has an outstanding school fees balance of
        <strong>GH₵ ${formatCurrency(totalOutstanding)}</strong> left to be paid.
        ${totalOutstanding > 0
          ? 'Kindly settle the outstanding balance as soon as possible to enable your ward\'s smooth and uninterrupted participation in school activities.'
          : 'Your ward\'s fees are fully settled. Thank you for your timely payment.'}
        <br/>We thank you for your continued support.
      </div>

      <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:10px;color:#555;">
        <div>______________________<br/>Student's Signature</div>
        <div>______________________<br/>Parent's Signature</div>
        <div>______________________<br/>School Official</div>
      </div>
    </div>`;
}
// Wrap one or more A5 pages in a printable HTML document (A5 paper, one page per student).
function feeReminderPrintShell(pagesHtml, title) {
  return `
    <html><head>
      <title>${title}</title>
      <style>
        @page { size: A5 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .a5-page { width: 148mm; min-height: 190mm; }
        @media print {
          body { margin: 0; padding: 0; }
          .a5-page { width: 148mm; break-after: page; }
          .a5-page:last-child { break-after: auto; }
        }
      </style>
    </head><body>${pagesHtml}</body></html>
  `;
}

// Bulk print A5 fees reminder notes for ALL students in the currently
// selected class (or all students) on the Student Fees tab.
window.printClassFeeReminders = async function() {
  const schoolId = await getCurrentSchoolId();
  const schoolInfo = await getSchoolPrintInfo(schoolId);

  const search = (getEl('feeSearchStudent')?.value || '').toLowerCase();
  const classFilter = getEl('feeSearchClass')?.value || '';

  let query = supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('status', 'admitted');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data: students } = await query;

  let filtered = students || [];
  if (classFilter) filtered = filtered.filter(s => s.class_applying === classFilter);
  if (search) {
    filtered = filtered.filter(s => {
      const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`.toLowerCase();
      return name.includes(search) || (s.student_id || '').toLowerCase().includes(search);
    });
  }

  if (filtered.length === 0) {
    alert('No students match the current filters. Select a class (or clear the filters) and try again.');
    return;
  }

  const label = classFilter ? `Class ${classFilter}` : `${filtered.length} students`;

  const pages = [];
  for (const s of filtered) {
    const data = await buildFeeReminderData(s.student_id);
    if (!data) continue;
    pages.push(renderFeeReminderA5(data, schoolInfo));
  }

  if (pages.length === 0) { alert('No reminder notes could be generated.'); return; }

  const title = `Fees Reminders - ${label}`;
  openPrintWindow(feeReminderPrintShell(pages.join('\n'), title), title, 560, 800);
  logSubAdminActivity(`Bulk printed ${pages.length} A5 fees reminder note(s) for ${label}`, 'fee', `${label}: ${pages.length} note(s)`);
};

// Reprint receipt
window.reprintReceipt = async function(receiptId) {
  const { data: receipt } = await supabaseClient.from('receipts')
    .select('*, payment_transactions(*)')
    .eq('id', receiptId)
    .single();

  if (!receipt) { alert('Receipt not found'); return; }

  // Build receipt data from stored receipt_data or transaction
  const receiptData = receipt.receipt_data || {
    student_name: receipt.student_id,
    class: '',
    school_name: '',
    total_due: receipt.amount,
    amount_paid_before: 0,
    amount_now: receipt.amount,
    total_paid: receipt.amount,
    remaining_balance: 0,
    payment_status: 'paid',
    payment_method: receipt.payment_method,
    reference_number: null,
    notes: null,
  };
  receiptData.receipt_number = receipt.receipt_number;
  receiptData.verification_token = receipt.verification_token;
  receiptData.student_id = receipt.student_id;
  receiptData.amount_paid = receipt.amount;
  receiptData.academic_year = receipt.academic_year;
  receiptData.term = receipt.term;
  receiptData.receipt_date = receipt.receipt_date;

  // If receipt_data doesn't have school_name, fetch it from the schools table
  if (!receiptData.school_name) {
    try {
      const schoolId = await getCurrentSchoolId();
      if (schoolId) {
        const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).maybeSingle();
        if (school?.name) receiptData.school_name = school.name;
      }
    } catch (e) { /* keep fallback */ }
  }

  // If receipt_data doesn't have processed_by info, try to get it from the transaction
  if (!receiptData.processed_by && receipt.payment_transactions) {
    const tx = receipt.payment_transactions;
    if (tx.recorded_by) {
      try {
        const { data: profile } = await supabaseClient.from('profiles')
          .select('full_name, role')
          .eq('id', tx.recorded_by)
          .maybeSingle();
        if (profile && profile.full_name) {
          receiptData.processed_by = profile.full_name;
          const adminRoles = ['super_admin', 'school', 'sub_admin'];
          if (adminRoles.includes(profile.role)) {
            receiptData.processed_by_label = 'Admin';
          } else if (profile.role === 'accountant') {
            receiptData.processed_by_label = 'Accountant';
          } else if (profile.role) {
            receiptData.processed_by_label = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
          } else {
            receiptData.processed_by_label = 'Staff';
          }
        }
      } catch (e) { /* ignore lookup errors */ }
    }
  }

  // Get student and school info
  const { data: student } = await supabaseClient.from('applications')
    .select('first_name, middle_name, last_name, class_applying, student_photo_url')
    .eq('student_id', receipt.student_id)
    .single();
  if (student) {
    receiptData.student_name = `${student.first_name} ${student.middle_name || ''} ${student.last_name}`;
    receiptData.class = student.class_applying;
    receiptData.student_photo_url = student.student_photo_url || '';
  }

  const schoolId = await getCurrentSchoolId();
  const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).single();
  if (school) receiptData.school_name = school.name;

  showReceiptModal(receiptData);
};

// Print receipt
window.printReceipt = function() {
  const content = getEl('receiptContent');
  if (!content) return;
  // Serialize the QR <canvas> to an <img> so it survives being copied into
  // the print document — canvas pixel data does not transfer via innerHTML.
  let printContent = content.innerHTML;
  try {
    // IMPORTANT: read the pixels from the LIVE <canvas>, not from a cloned one.
    // cloneNode(true) copies a canvas's attributes but never its drawing buffer,
    // so a cloned <canvas> is always blank and its toDataURL() is an empty image.
    // The clone is only used to build the HTML string with the <img> substituted.
    const liveCanvas = content.querySelector('#receiptQRCode canvas');
    if (liveCanvas && typeof liveCanvas.toDataURL === 'function') {
      const img = document.createElement('img');
      img.src = liveCanvas.toDataURL('image/png');
      img.width = liveCanvas.width || RECEIPT_QR_INTERNAL;
      img.height = liveCanvas.height || RECEIPT_QR_INTERNAL;
      img.alt = 'Receipt QR code';
      img.style.cssText = `width:${RECEIPT_QR_DISPLAY}px;height:${RECEIPT_QR_DISPLAY}px;display:inline-block;border-radius:10px;`;
      const clone = content.cloneNode(true);
      const cloneCanvas = clone.querySelector('#receiptQRCode canvas');
      if (cloneCanvas && cloneCanvas.parentNode) {
        cloneCanvas.parentNode.replaceChild(img, cloneCanvas);
        printContent = clone.innerHTML;
      }
    }
  } catch (e) {
    console.warn('QR serialization failed, using raw content:', e);
  }
  openPrintWindow(`
    <html><head>
      <title>Receipt</title>
      <style>
        @media print {
          .receipt-qr-section canvas, .receipt-qr-section img { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
        }
        body { font-family: 'Courier New', monospace; padding: 20px; max-width: 400px; margin: 0 auto; }
        .receipt-container { background: #fff; }
        .receipt-header { text-align: center; border-bottom: 2px dashed #333; padding-bottom: 10px; margin-bottom: 10px; }
        .receipt-school-name { font-size: 18px; font-weight: bold; }
        .receipt-title { font-size: 14px; font-weight: bold; letter-spacing: 2px; margin: 5px 0; }
        .receipt-number { font-size: 12px; color: #666; }
        .receipt-body { padding: 10px 0; }
        .receipt-divider { border-top: 1px dashed #999; margin: 8px 0; }
        .receipt-student-info { font-size: 12px; line-height: 1.6; }
        .receipt-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
        .receipt-table th { border-bottom: 1px solid #333; padding: 5px; text-align: left; }
        .receipt-table td { padding: 5px; }
        .receipt-highlight-row { background: #f0fdf4; font-weight: bold; }
        .receipt-payment-method { font-size: 11px; margin: 5px 0; }
        .receipt-status { margin: 5px 0; }
        .receipt-notes { font-size: 11px; color: #666; margin-top: 5px; }
        .receipt-footer { text-align: center; border-top: 2px dashed #333; padding-top: 10px; margin-top: 10px; }
        .receipt-thankyou { font-size: 14px; font-weight: bold; }
        .receipt-generated { font-size: 10px; color: #999; margin-top: 5px; }
        .receipt-qr-section { text-align: center !important; }
        .receipt-qr-section canvas, .receipt-qr-section img { display: inline-block !important; }
        .fee-status-badge { padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; }
        .fee-status-paid { background: #dcfce7; color: #166534; }
        .fee-status-partial { background: #fef3c7; color: #92400e; }
        .fee-status-unpaid { background: #fee2e2; color: #991b1b; }
      </style>
    </head><body>${printContent}</body></html>
  `, 'Receipt', 800, 600);
};

// Print receipt list (student receipts modal)
window.printReceiptList = function() {
  const content = getEl('receiptListContent');
  if (!content) return;
  openPrintWindow(`
    <html><head>
      <title>Student Receipts</title>
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
        .fee-status-badge { padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; }
        .fee-status-paid { background: #dcfce7; color: #166534; }
        .fee-status-partial { background: #fef3c7; color: #92400e; }
        .fee-status-unpaid { background: #fee2e2; color: #991b1b; }
      </style>
    </head><body>${content.innerHTML}</body></html>
  `, 'Student Receipts', 900, 700);
};

// ================================================================
// DEBTORS TAB
// ================================================================

async function loadDebtorsList() {
  const schoolId = await getCurrentSchoolId();
  const tbody = getEl('feeDebtorsBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';
  const selAll = getEl('feeDebtorsSelectAll');
  if (selAll) selAll.checked = false;
  updateSmsSelectionCount();

  // Get filter values
  const dateFrom = getEl('feeDebtorsDateFrom')?.value || '';
  const dateTo = getEl('feeDebtorsDateTo')?.value || '';
  const classFilter = getEl('feeDebtorsClass')?.value || '';
  const termFilter = getEl('feeDebtorsTerm')?.value || '';

  // Get all fee records with outstanding balance > 0 (including previous term debt)
  // We fetch ALL fee records and filter in JS to capture records where
  // total_amount + debt - amount_paid > 0, since the generated 'balance' column
  // only reflects total_amount - amount_paid and does NOT include debt carried forward.
  // This also handles records that may have an incorrect payment_status (e.g. 'paid'
  // when there's actually an outstanding balance) from CSV-imported students.
  let query = supabaseClient.from('fees')
    .select('*');

  if (schoolId) query = query.eq('school_id', schoolId);
  if (termFilter) query = query.eq('term', termFilter);
  query = query.order('created_at', { ascending: false });

  const { data: allFees } = await query;
  if (!allFees || allFees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">🎉 No debtors! All fees are up to date.</td></tr>';
    const countEl = getEl('feeDebtorsCount');
    if (countEl) countEl.textContent = '0 debtor(s)';
    return;
  }

  // Filter to only records with an actual outstanding balance
  const debtors = allFees.filter(f => {
    const actualOutstanding = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
    return actualOutstanding > 0;
  });

  if (debtors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">🎉 No debtors! All fees are up to date.</td></tr>';
    const countEl = getEl('feeDebtorsCount');
    if (countEl) countEl.textContent = '0 debtor(s)';
    return;
  }

  // Get student names for all debtor student IDs
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

  // Group by student
  const grouped = {};
  debtors.forEach(d => {
    const studentInfo = nameMap[d.student_id] || {};
    if (!grouped[d.student_id]) {
      grouped[d.student_id] = {
        student_id: d.student_id,
        first_name: studentInfo.first_name || d.student_id,
        middle_name: studentInfo.middle_name || '',
        last_name: studentInfo.last_name || '',
        class: studentInfo.class_applying || '',
        fees: [],
        total_balance: 0,
        last_payment_date: null
      };
    }
    grouped[d.student_id].fees.push(d);
    // Calculate actual outstanding including previous term debt carried forward
    const actualOutstanding = (Number(d.total_amount) + Number(d.debt || 0)) - Number(d.amount_paid);
    grouped[d.student_id].total_balance += Math.max(actualOutstanding, 0);
    // Track the latest payment date across all fee records for this student
    if (d.last_payment_date) {
      const dDate = new Date(d.last_payment_date);
      if (!grouped[d.student_id].last_payment_date || dDate > new Date(grouped[d.student_id].last_payment_date)) {
        grouped[d.student_id].last_payment_date = d.last_payment_date;
      }
    }
  });

  // Convert to array and apply filters
  let sorted = Object.values(grouped).sort((a, b) => b.total_balance - a.total_balance);

  // Filter by class if provided
  if (classFilter) {
    sorted = sorted.filter(s => s.class === classFilter);
  }

  // Filter by date range if provided
  if (dateFrom || dateTo) {
    sorted = sorted.filter(s => {
      if (!s.last_payment_date) {
        return !dateFrom;
      }
      const paymentDate = new Date(s.last_payment_date);
      if (dateFrom && paymentDate < new Date(dateFrom)) return false;
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        if (paymentDate > endDate) return false;
      }
      return true;
    });
  }

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors found for the selected filters.</td></tr>';
    const countEl = getEl('feeDebtorsCount');
    if (countEl) countEl.textContent = '0 debtor(s)';
    return;
  }

  tbody.innerHTML = sorted.map(s => {
    const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`;
    const feeDetails = s.fees.map(f => {
      const actualBal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
      return `<div style="font-size:0.8rem;">${f.term} ${f.academic_year}: Total: GH₵ ${formatCurrency(Number(f.total_amount) + Number(f.debt || 0))} | Paid: GH₵ ${formatCurrency(f.amount_paid)} | Bal: GH₵ ${formatCurrency(actualBal)}${f.debt > 0 ? ` (includes debt: GH₵ ${formatCurrency(f.debt)})` : ''}</div>`;
    }).join('');
    const lastPayDate = s.last_payment_date ? formatDate(s.last_payment_date) : '<span style="color:var(--text-muted);">Never</span>';

    return `<tr>
      <td style="text-align:center;">
        <input type="checkbox" class="debtor-sms-check" data-student-id="${escapeAttr(s.student_id)}" data-student-name="${escapeAttr(name)}" data-class="${escapeAttr(s.class)}" data-balance="${Number(s.total_balance) || 0}" onchange="updateSmsSelectionCount()" title="Select to send a fee reminder SMS" />
      </td>
      <td><strong>${s.student_id}</strong></td>
      <td>${name}</td>
      <td>${s.class}</td>
      <td>${feeDetails}</td>
      <td><strong class="fee-balance-unpaid">GH₵ ${formatCurrency(s.total_balance)}</strong></td>
      <td>${lastPayDate}</td>
      <td>
        <button class="action-btn confirm" onclick="openFeePayment('${s.student_id}')">💰 Record Payment</button>
      </td>
    </tr>`;
  }).join('');

  // Update count
  const countEl = getEl('feeDebtorsCount');
  if (countEl) countEl.textContent = `${sorted.length} debtor(s)`;

  // Keep the bulk-SMS selection counter in sync with the fresh rows.
  updateSmsSelectionCount();
}

// ================================================================
// DEBTORS BULK SMS — FEE REMINDERS
// ================================================================

/** Escape a value for safe injection inside an HTML attribute in templates. */
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Keep the "N selected" counter in the debtors toolbar in sync. */
window.updateSmsSelectionCount = function () {
  const count = document.querySelectorAll('.debtor-sms-check:checked').length;
  const el = getEl('feeSmsSelectedCount');
  if (el) el.textContent = `${count} selected`;
};

/** Best-effort school name lookup for SMS headers. */
async function getSchoolNameForSms(schoolId) {
  if (!schoolId) return 'School';
  try {
    const { data: settings } = await supabaseClient.from('school_settings')
      .select('school_name')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (settings?.school_name) return settings.school_name;
    const { data: school } = await supabaseClient.from('schools')
      .select('name')
      .eq('id', schoolId)
      .single();
    return school?.name || 'School';
  } catch (err) {
    return 'School';
  }
}

/** Build a short one-SMS fee reminder for a debtor. */
function buildDebtorReminderSms(schoolName, studentName, className, balance) {
  const school = String(schoolName || 'School').trim().slice(0, 40);
  const cls = className ? ` (${String(className).trim()})` : '';
  const bal = formatCurrency(Number(balance) || 0);
  return (
    `${school}: Dear Parent/Guardian, this is a reminder that fees for ${studentName}${cls} ` +
    `have an outstanding balance of GH\u20b5${bal}. Kindly settle the balance to keep your ward in school. Thank you.`
  );
}

/**
 * Send one reminder through the /api/send-sms (Nalo) gateway and audit it as
 * a new row in sms_logs. Mirrors sms-gateway.js / admin-sms-monitor.js.
 *
 * The audit insert is best-effort and NEVER changes the outcome of a send
 * (the payment-SMS module uses the same fire-and-forget rule). Returns
 * { ok: true } on success, or { ok: false, error } with the exact reason
 * returned by /api/send-sms (e.g. "Nalo SMS is not configured ...").
 */
async function sendDebtorReminderSms(recipient, studentId, message, schoolId) {
  // 1) Send
  let res = null;
  let resp = null;
  try {
    res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: recipient, message }),
    });
    resp = await res.json().catch(() => null);
  } catch (err) {
    console.warn('[Fees] SMS send network error for ' + studentId + ':', err.message);
    return { ok: false, error: 'Network error reaching SMS gateway: ' + err.message };
  }

  const success = Boolean(resp && resp.success);
  const error = success
    ? null
    : ((resp && (resp.error || resp.message)) || ('Gateway returned HTTP ' + (res ? res.status : '?')));

  // 2) Audit (best-effort, never flips the send outcome)
  try {
    const { data: { user } } = await supabaseClient.auth.getUser().catch(() => ({ data: { user: null } }));
    await supabaseClient.from('sms_logs').insert({
      school_id: schoolId || null,
      student_id: studentId || null,
      recipient: recipient || null,
      message: message || null,
      status: (resp && resp.status) || null,
      success,
      provider_response: (resp && resp.providerRaw) || null,
      error: error || (success ? null : 'Gateway error'),
      created_by: user?.id || null,
    });
  } catch (err) {
    console.warn('[Fees] Failed to write sms_logs row for ' + studentId + ':', err.message);
  }

  if (!success) console.warn('[Fees] SMS rejected for ' + studentId + ':', error);
  return success ? { ok: true, error: null } : { ok: false, error };
}

/** Bulk-send fee reminder SMS to the debtors selected in the list. */
window.sendBulkFeeReminderSms = async function () {
  clearMessage('feeDebtorsSmsMessage');

  const boxes = Array.from(document.querySelectorAll('.debtor-sms-check:checked'));
  if (boxes.length === 0) {
    showMessage('feeDebtorsSmsMessage', '⚠️ Please select at least one debtor first — tick the checkboxes (or the Select All box) and try again.', 'error');
    return;
  }

  // Capture the selection + any per-row data we need BEFORE the list refresh.
  const selected = boxes.map(cb => ({
    studentId: cb.dataset.studentId || '',
    name: cb.dataset.studentName || cb.dataset.studentId || 'student',
    className: cb.dataset.class || '',
    balance: Number(cb.dataset.balance || 0),
  }));

  // Resolve a valid parent phone for each selected debtor.
  const withPhone = [];
  const noPhone = [];
  for (const s of selected) {
    const { data: app } = await supabaseClient.from('applications')
      .select('parent_contact')
      .eq('student_id', s.studentId)
      .maybeSingle();
    const phone = normalizeGhanaPhone(app?.parent_contact);
    if (phone) withPhone.push({ ...s, phone });
    else noPhone.push(s);
  }

  if (withPhone.length === 0) {
    showMessage('feeDebtorsSmsMessage', `❌ None of the ${selected.length} selected debtor(s) have a valid parent/guardian phone number on record, so no SMS was sent.`, 'error');
    return;
  }

  const total = withPhone.length;
  const confirmText = `Send a fee reminder SMS to the parents/guardians of ${total} debtor(s)?\n\n` +
    `This will send ${total} message(s) through the Nalo SMS gateway.` +
    (noPhone.length ? `\n(${noPhone.length} already excluded — no valid phone on record.)` : '');
  if (!confirm(confirmText)) return;

  const schoolId = await getCurrentSchoolId();
  const schoolName = await getSchoolNameForSms(schoolId);

  const btn = getEl('feeSendSmsBtn');
  const originalLabel = btn ? btn.textContent.trim() : '📨 Send Fee Reminder SMS';
  setLoading(btn, true, 'Sending...');

  let sent = 0;
  let failed = 0;
  const reasons = {};
  try {
    for (let i = 0; i < withPhone.length; i++) {
      const s = withPhone[i];
      if (btn) btn.innerHTML = `<span class="spinner"></span> Sending ${i + 1} of ${total}`;
      const message = buildDebtorReminderSms(schoolName, s.name, s.className, s.balance);
      const result = await sendDebtorReminderSms(s.phone, s.studentId, message, schoolId);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        const reason = String(result.error || 'Unknown error').trim();
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
    }
  } catch (err) {
    console.error('[Fees] Bulk SMS error:', err.message);
    failed = total - sent;
  } finally {
    setLoading(btn, false, originalLabel);
  }

  let summary = `✅ Bulk SMS complete!\nSent: ${sent}\nFailed: ${failed}`;
  if (failed > 0) {
    const topReasons = Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `  • ${reason}${count > 1 ? ` (×${count})` : ''}`);
    summary += `\n\n${topReasons.join('\n')}`;
  }
  if (noPhone.length) summary += `\nSkipped (no valid phone): ${noPhone.length}`;
  showMessage('feeDebtorsSmsMessage', summary, failed === 0 ? 'success' : 'error');

  // Refresh the debtor list (clears the checkboxes) and nudge the SMS
  // monitoring dashboard so the new sms_logs rows appear immediately.
  await loadDebtorsList();
  try {
    const { refreshSmsMonitor } = await import('./admin-sms-monitor.js');
    await refreshSmsMonitor();
  } catch (e) { /* the realtime channel will pick up the new sms_logs rows */ }
};

// ================================================================
// DEBTORS PREVIEW & PRINT
// ================================================================

/**
 * Generates a print-friendly HTML table of the current debtors list data
 * based on the active filters (class, term, date range).
 */
async function generateDebtorsPrintHTML() {
  const schoolId = await getCurrentSchoolId();
  
  // Get school name and logo
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
  }

  // Get filter values
  const dateFrom = getEl('feeDebtorsDateFrom')?.value || '';
  const dateTo = getEl('feeDebtorsDateTo')?.value || '';
  const classFilter = getEl('feeDebtorsClass')?.value || '';
  const termFilter = getEl('feeDebtorsTerm')?.value || '';

  // Get all fee records with outstanding balance > 0 (including previous term debt)
  // We fetch ALL fee records and filter in JS to capture records where
  // total_amount + debt - amount_paid > 0, since the generated 'balance' column
  // only reflects total_amount - amount_paid and does NOT include debt carried forward.
  // This also handles records that may have an incorrect payment_status (e.g. 'paid'
  // when there's actually an outstanding balance) from CSV-imported students.
  let query = supabaseClient.from('fees')
    .select('*');

  if (schoolId) query = query.eq('school_id', schoolId);
  if (termFilter) query = query.eq('term', termFilter);
  query = query.order('created_at', { ascending: false });

  const { data: allFees } = await query;
  if (!allFees || allFees.length === 0) return null;

  // Filter to only records with an actual outstanding balance
  const debtors = allFees.filter(f => {
    const actualOutstanding = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
    return actualOutstanding > 0;
  });

  if (debtors.length === 0) return null;

  // Get student names
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

  // Group by student
  const grouped = {};
  debtors.forEach(d => {
    const studentInfo = nameMap[d.student_id] || {};
    if (!grouped[d.student_id]) {
      grouped[d.student_id] = {
        student_id: d.student_id,
        first_name: studentInfo.first_name || d.student_id,
        middle_name: studentInfo.middle_name || '',
        last_name: studentInfo.last_name || '',
        class: studentInfo.class_applying || '',
        fees: [],
        total_balance: 0,
        last_payment_date: null
      };
    }
    grouped[d.student_id].fees.push(d);
    // Calculate actual outstanding including previous term debt carried forward
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

  // Apply class filter
  if (classFilter) {
    sorted = sorted.filter(s => s.class === classFilter);
  }

  // Apply date filter
  if (dateFrom || dateTo) {
    sorted = sorted.filter(s => {
      if (!s.last_payment_date) return !dateFrom;
      const paymentDate = new Date(s.last_payment_date);
      if (dateFrom && paymentDate < new Date(dateFrom)) return false;
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        if (paymentDate > endDate) return false;
      }
      return true;
    });
  }

  if (sorted.length === 0) return null;

  // Build filter description
  const filterParts = [];
  if (classFilter) filterParts.push(`Class: ${classFilter}`);
  if (termFilter) filterParts.push(`Term: ${termFilter}`);
  if (dateFrom) filterParts.push(`From: ${formatDate(dateFrom)}`);
  if (dateTo) filterParts.push(`To: ${formatDate(dateTo)}`);
  const filterDesc = filterParts.length > 0 ? filterParts.join(' | ') : 'All Debtors';

  const now = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const totalOutstanding = sorted.reduce((sum, s) => sum + s.total_balance, 0);

  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="School Logo" style="width:60px;height:60px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;margin-bottom:0.25rem;" />`
    : '';

  let html = `
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
            <th style="padding:8px 6px;border:1px solid #333;text-align:right;">Total Balance (GH₵)</th>
            <th style="padding:8px 6px;border:1px solid #333;text-align:left;">Last Payment</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((s, i) => {
            const name = `${s.first_name} ${s.middle_name || ''} ${s.last_name}`;
            const feeDetails = s.fees.map(f => {
              const actualBal = (Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid);
              return `${f.term} ${f.academic_year}: Total: GH₵ ${formatCurrency(Number(f.total_amount) + Number(f.debt || 0))} | Paid: GH₵ ${formatCurrency(f.amount_paid)} | Bal: GH₵ ${formatCurrency(actualBal)}${f.debt > 0 ? ` (includes prev debt: GH₵ ${formatCurrency(f.debt)})` : ''}`;
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
            <td style="padding:8px 6px;border:1px solid #333;text-align:right;">GH₵ ${formatCurrency(totalOutstanding)}</td>
            <td style="padding:8px 6px;border:1px solid #333;"></td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:15px;font-size:11px;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:8px;">
        <p style="margin:2px 0;">Total Debtors: ${sorted.length} | Total Outstanding: GH₵ ${formatCurrency(totalOutstanding)}</p>
        <p style="margin:2px 0;">Generated by Student Admission Portal</p>
      </div>
    </div>
  `;

  return html;
}

/**
 * Preview debtors list in a modal
 */
window.previewDebtorsList = async function() {
  const modal = getEl('debtorsPrintModal');
  const content = getEl('debtorsPrintContent');
  if (!modal || !content) return;

  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Generating preview...</div>';
  modal.style.display = 'flex';

  const html = await generateDebtorsPrintHTML();
  if (!html) {
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No debtors found for the selected filters.</div>';
    return;
  }

  content.innerHTML = html;
};

/**
 * Print debtors list directly (opens in new window)
 */
window.printDebtorsListDirect = async function() {
  const html = await generateDebtorsPrintHTML();
  if (!html) {
    alert('No debtors found for the selected filters.');
    return;
  }

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
};

/**
 * Print debtors list from preview modal
 */
window.printDebtorsList = async function() {
  const content = getEl('debtorsPrintContent');
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
};

// ================================================================
// TODAY'S RECEIPTS
// ================================================================

/**
 * Shows a modal with all receipts created today and the total amount collected.
 */
window.showTodayReceipts = async function() {
  const schoolId = await getCurrentSchoolId();
  
  // Get today's date range (start of day to end of day)
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

  // Get school name
  let schoolName = 'School';
  if (schoolId) {
    const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).single();
    if (school) schoolName = school.name;
  }

  // Query receipts created today
  let query = supabaseClient.from('receipts')
    .select('*')
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd)
    .order('created_at', { ascending: false });

  if (schoolId) query = query.eq('school_id', schoolId);

  const { data: receipts } = await query;

  // Get student names for all receipt student IDs
  const studentIds = receipts ? [...new Set(receipts.map(r => r.student_id))] : [];
  const nameMap = {};
  if (studentIds.length > 0) {
    const { data: studentNames } = await supabaseClient.from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying')
      .in('student_id', studentIds);
    if (studentNames) {
      studentNames.forEach(s => {
        nameMap[s.student_id] = s;
      });
    }
  }

  const todayFormatted = today.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const totalAmount = receipts ? receipts.reduce((sum, r) => sum + Number(r.amount), 0) : 0;
  const receiptCount = receipts ? receipts.length : 0;

  // Build HTML
  let html = `
    <div style="font-family:Arial,sans-serif;padding:10px;">
      <div style="text-align:center;margin-bottom:15px;border-bottom:2px solid #1e3a5f;padding-bottom:10px;">
        <h2 style="margin:0;font-size:20px;color:#1e3a5f;">${schoolName}</h2>
        <h3 style="margin:5px 0;font-size:16px;">TODAY'S RECEIPTS</h3>
        <p style="margin:5px 0;font-size:13px;color:#555;">${todayFormatted}</p>
      </div>
      <div style="display:flex;gap:1rem;margin-bottom:15px;flex-wrap:wrap;">
        <div style="flex:1;padding:12px;background:#f0fdf4;border-radius:6px;text-align:center;border:1px solid #bbf7d0;">
          <div style="font-size:12px;color:#166534;">Total Receipts</div>
          <div style="font-size:24px;font-weight:bold;color:#166534;">${receiptCount}</div>
        </div>
        <div style="flex:1;padding:12px;background:#fef3c7;border-radius:6px;text-align:center;border:1px solid #fde68a;">
          <div style="font-size:12px;color:#92400e;">Total Amount Collected</div>
          <div style="font-size:24px;font-weight:bold;color:#92400e;">GH₵ ${formatCurrency(totalAmount)}</div>
        </div>
      </div>`;

  if (!receipts || receipts.length === 0) {
    html += '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts recorded today.</div>';
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
            <th>Amount (GH₵)</th>
            <th>Method</th>
            <th>Time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${receipts.map((r, i) => {
            const studentInfo = nameMap[r.student_id] || {};
            const studentName = studentInfo.first_name 
              ? `${studentInfo.first_name} ${studentInfo.middle_name || ''} ${studentInfo.last_name}`
              : r.student_id;
            const className = studentInfo.class_applying || '';
            const time = new Date(r.created_at).toLocaleTimeString('en-GB', {
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
              <td><button class="action-btn confirm" style="font-size:11px;padding:2px 6px;" onclick="reprintReceipt('${r.id}')">🖨️</button></td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#1e3a5f;color:#fff;font-weight:bold;">
            <td colspan="6" style="padding:8px;text-align:right;">TOTAL</td>
            <td style="padding:8px;text-align:right;">GH₵ ${formatCurrency(totalAmount)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }

  html += `</div>`;

  // Show in a modal
  const modal = getEl('receiptListModal');
  const content = getEl('receiptListContent');
  if (content) {
    content.innerHTML = html;
  }
  if (modal) {
    // Update modal title
    const title = modal.querySelector('.modal-header h3');
    if (title) title.textContent = `📋 Today's Receipts - ${todayFormatted}`;
    modal.style.display = 'flex';
  }
};

// ================================================================
// DELETE RECEIPTS BY CLASS & DATE
// ================================================================

/**
 * Preview receipts that would be deleted for the selected class and date range.
 */
async function previewDeleteReceipts() {
  const className = getEl('feeDeleteReceiptsClass')?.value;
  const dateFrom = getEl('feeDeleteReceiptsDateFrom')?.value || '';
  const dateTo = getEl('feeDeleteReceiptsDateTo')?.value || '';

  if (!className) {
    showMessage('feeDeleteReceiptsMessage', 'Please select a class.', 'error');
    return;
  }

  clearMessage('feeDeleteReceiptsMessage');
  const tbody = getEl('feeDeleteReceiptsBody');
  const summaryEl = getEl('feeDeleteReceiptsSummary');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading receipts...</td></tr>';
  if (summaryEl) summaryEl.textContent = '';

  try {
    const schoolId = await getCurrentSchoolId();

    // Get all student IDs in the selected class
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying')
      .eq('class_applying', className);
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students } = await studentsQuery;

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found in this class.</td></tr>';
      return;
    }

    const studentIds = students.map(s => s.student_id);
    const nameMap = {};
    students.forEach(s => {
      nameMap[s.student_id] = s;
    });

    // Query receipts for these students
    let query = supabaseClient.from('receipts')
      .select('*')
      .in('student_id', studentIds)
      .order('receipt_date', { ascending: false });

    if (schoolId) query = query.eq('school_id', schoolId);
    if (dateFrom) query = query.gte('receipt_date', dateFrom + 'T00:00:00');
    if (dateTo) query = query.lte('receipt_date', dateTo + 'T23:59:59.999');

    const { data: receipts } = await query;

    if (!receipts || receipts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No receipts found for the selected class and date range.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const totalAmount = receipts.reduce((sum, r) => sum + Number(r.amount), 0);

    tbody.innerHTML = receipts.map(r => {
      const studentInfo = nameMap[r.student_id] || {};
      const studentName = studentInfo.first_name
        ? `${studentInfo.first_name} ${studentInfo.middle_name || ''} ${studentInfo.last_name}`
        : r.student_id;
      return `<tr>
        <td><strong>${r.receipt_number}</strong></td>
        <td>${r.student_id}</td>
        <td>${studentName}</td>
        <td>${className}</td>
        <td>${r.term} ${r.academic_year}</td>
        <td style="text-align:right;font-weight:bold;">${formatCurrency(r.amount)}</td>
        <td>${r.payment_method}</td>
        <td>${formatDate(r.receipt_date)}</td>
      </tr>`;
    }).join('');

    if (summaryEl) {
      summaryEl.innerHTML = `<span style="color:#b91c1c;">⚠️ Found <strong>${receipts.length}</strong> receipt(s) totaling <strong>GH₵ ${formatCurrency(totalAmount)}</strong> that will be deleted.</span>`;
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--danger);">Error loading receipts: ' + err.message + '</td></tr>';
  }
}

/**
 * Delete receipts for the selected class and date range directly from the database.
 */
async function deleteReceiptsByClassDate() {
  const className = getEl('feeDeleteReceiptsClass')?.value;
  const dateFrom = getEl('feeDeleteReceiptsDateFrom')?.value || '';
  const dateTo = getEl('feeDeleteReceiptsDateTo')?.value || '';

  if (!className) {
    showMessage('feeDeleteReceiptsMessage', 'Please select a class.', 'error');
    return;
  }

  // Build filter description for confirmation
  const filterParts = [`Class: ${className}`];
  if (dateFrom) filterParts.push(`From: ${dateFrom}`);
  if (dateTo) filterParts.push(`To: ${dateTo}`);
  const filterDesc = filterParts.join(' | ');

  if (!confirm(`🗑️ DELETE RECEIPTS - DANGER ZONE\n\n${filterDesc}\n\nThis will PERMANENTLY delete all matching receipts and their associated payment transactions from the database.\n\nFee records will be recalculated (amount paid and payment status updated).\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?`)) return;

  // Second confirmation for extra safety
  if (!confirm(`⚠️ FINAL CONFIRMATION\n\nAre you 100% sure you want to delete these receipts?\n\nThis is irreversible.`)) return;

  const btn = getEl('feeDeleteReceiptsBtn');
  setLoading(btn, true, 'Deleting...');
  clearMessage('feeDeleteReceiptsMessage');

  try {
    const schoolId = await getCurrentSchoolId();

    const { data, error } = await supabaseClient.rpc('delete_receipts_by_class_date', {
      p_class_name: className,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_school_id: schoolId,
    });

    if (error) throw error;

    if (!data.success) {
      showMessage('feeDeleteReceiptsMessage', 'Error: ' + (data.error || 'Failed to delete receipts'), 'error');
      return;
    }

    showMessage('feeDeleteReceiptsMessage',
      `✅ Deletion complete!\n\n` +
      `🗑️ Receipts deleted: ${data.receipts_deleted}\n` +
      `💳 Transactions deleted: ${data.transactions_deleted}\n` +
      `💰 Total amount: GH₵ ${formatCurrency(data.total_amount)}\n` +
      `📋 Fee records updated: ${data.fee_records_updated}`,
      'success');

    logSubAdminActivity(`Deleted ${data.receipts_deleted} receipt(s) for ${className} (${filterDesc})`, 'fee', `${className}: ${data.receipts_deleted} receipts, GH₵ ${data.total_amount}`);

    // Clear the preview table
    const tbody = getEl('feeDeleteReceiptsBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">Select a class and date range, then click "Preview Receipts" to see matching receipts.</td></tr>';
    }
    const summaryEl = getEl('feeDeleteReceiptsSummary');
    if (summaryEl) summaryEl.textContent = '';

    // Refresh related views
    await loadDebtorsList();
  } catch (err) {
    showMessage('feeDeleteReceiptsMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '🗑️ Delete Receipts');
  }
}

// ================================================================
// BULK CARRY FORWARD
// ================================================================

async function bulkCarryForward() {
  const className = getEl('feeBulkCarryClass').value;
  const fromYear = getEl('feeBulkFromYear').value;
  const fromTerm = getEl('feeBulkFromTerm').value;
  const toYear = getEl('feeBulkToYear').value;
  const toTerm = getEl('feeBulkToTerm').value;
  const newAmount = parseFloat(getEl('feeBulkAmount').value) || 0;

  if (!className || !fromYear || !fromTerm || !toYear || !toTerm) {
    showMessage('feeBulkMessage', 'Please fill all fields.', 'error');
    return;
  }

  if (!confirm(`Carry forward balances for ALL students in ${className}?\n\nFrom: ${fromTerm} ${fromYear}\nTo: ${toTerm} ${toYear}\nNew Fee: GH₵ ${formatCurrency(newAmount)}\n\nAll unpaid balances will be attached as debt.`)) return;

  const btn = getEl('feeBulkCarryForward');
  setLoading(btn, true, 'Processing...');
  clearMessage('feeBulkMessage');

  try {
    const schoolId = await getCurrentSchoolId();
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id')
      .eq('class_applying', className);
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students } = await studentsQuery;

    if (!students || students.length === 0) {
      showMessage('feeBulkMessage', 'No students found in this class.', 'error');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const student of students) {
      try {
        const { data, error } = await supabaseClient.rpc('promote_student_fees', {
          p_student_id: student.student_id,
          p_current_academic_year: fromYear,
          p_current_term: fromTerm,
          p_new_class_name: className,
          p_new_academic_year: toYear,
          p_new_term: toTerm,
          p_new_fee_amount: newAmount,
        });
        if (error || !data.success) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        errorCount++;
      }
    }

    showMessage('feeBulkMessage', `✅ Carry forward complete!\nProcessed: ${students.length}\nSuccess: ${successCount}\nErrors: ${errorCount}`, 'success');
    logSubAdminActivity(`Bulk carry forward: ${className} ${fromTerm}->${toTerm}`, 'fee', `${className}: ${successCount} students`);
    await loadDebtorsList();
  } catch (err) {
    showMessage('feeBulkMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '🔄 Bulk Carry Forward');
  }
}

// ================================================================
// HOLIDAY FEE STATEMENTS (BULK GENERATE + PRINT)
// Emphasizes the outstanding balance, the next term fees, and the
// total amount to pay. Intended to be printed for students as they
// go on holiday vacation, with a note to parents/guardians.
// ================================================================

/** Compare two (year, term) pairs chronologically. Returns >0 if a is later, <0 if earlier, 0 if equal. */
function compareTerm(aYear, aTerm, bYear, bTerm) {
  const order = { First: 1, Second: 2, Third: 3 };
  const aStart = parseInt(String(aYear).split('/')[0]) || 0;
  const bStart = parseInt(String(bYear).split('/')[0]) || 0;
  if (aStart !== bStart) return aStart > bStart ? 1 : -1;
  const ao = order[aTerm] || 0;
  const bo = order[bTerm] || 0;
  return ao > bo ? 1 : (ao < bo ? -1 : 0);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Loads the Holiday Statements tab: sets default year/term from school
 * settings, updates the "next term" hint, and renders the preview table
 * for the currently selected class.
 */
async function loadHolidayTab() {
  const yearSelect = getEl('feeHolidayYear');
  const termSelect = getEl('feeHolidayTerm');
  if (!yearSelect || !termSelect) return;

  // Only seed defaults once (first time the tab is opened).
  if (!yearSelect.value) {
    let acadYear = getDefaultAcademicYear();
    let curTerm = 'First';
    try {
      const schoolId = await getCurrentSchoolId();
      if (schoolId) {
        const { data } = await supabaseClient.from('school_settings')
          .select('academic_year, current_term')
          .eq('school_id', schoolId)
          .maybeSingle();
        if (data?.academic_year) acadYear = data.academic_year;
        if (data?.current_term) curTerm = data.current_term;
      }
    } catch (e) { /* keep defaults */ }
    yearSelect.value = acadYear;
    termSelect.value = curTerm;
  }

  updateHolidayNextHint();
  await renderHolidayPreviewTable();
}

/** Shows the computed "next term" under the term selector. */
function updateHolidayNextHint() {
  const hint = getEl('feeHolidayNextHint');
  if (!hint) return;
  const year = getEl('feeHolidayYear')?.value;
  const term = getEl('feeHolidayTerm')?.value;
  if (!year || !term) { hint.textContent = ''; return; }
  if (term === 'Third') {
    hint.textContent = `Next term: First Term ${getNextAcademicYear(year)} (new academic year)`;
    return;
  }
  const nextTerm = getNextTerm(term);
  hint.textContent = nextTerm ? `Next term: ${nextTerm} Term ${year}` : '';
}

/**
 * Gathers all data needed to build the statements.
 * Returns { statements, className, currentYear, currentTerm, nextTerm,
 *           nextYear, nextFeeSource } or null on invalid input.
 */
async function buildHolidayStatementData() {
  const schoolId = await getCurrentSchoolId();
  const className = getEl('feeHolidayClass')?.value || '';
  const currentYear = getEl('feeHolidayYear')?.value || '';
  const currentTerm = getEl('feeHolidayTerm')?.value || '';
  const nextFeeOverride = parseFloat(getEl('feeHolidayNextFee')?.value) || 0;

  if (!className) {
    showMessage('feeHolidayMessage', 'Please select a class.', 'error');
    return null;
  }
  if (!currentYear || !currentTerm) {
    showMessage('feeHolidayMessage', 'Please select the academic year and the term that just ended.', 'error');
    return null;
  }

  const nextTerm = getNextTerm(currentTerm);
  if (!nextTerm) {
    showMessage('feeHolidayMessage', 'Could not determine the next term.', 'error');
    return null;
  }
  const nextYear = currentTerm === 'Third' ? getNextAcademicYear(currentYear) : currentYear;

  // Next term fee: manual override, otherwise from the class fee structure.
  let nextFee = nextFeeOverride;
  let nextFeeSource = 'manual';
  if (!nextFeeOverride) {
    const { data: cf } = await supabaseClient.from('class_fees')
      .select('fee_amount')
      .eq('class_name', className)
      .eq('academic_year', nextYear)
      .eq('term', nextTerm)
      .maybeSingle();
    if (cf) {
      nextFee = Number(cf.fee_amount) || 0;
      nextFeeSource = 'structure';
    } else {
      nextFee = 0;
      nextFeeSource = 'missing';
    }
  }

  // Students in the class.
  let q = supabaseClient.from('applications')
    .select('student_id, first_name, middle_name, last_name, class_applying')
    .eq('class_applying', className);
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data: students } = await q;
  if (!students || students.length === 0) {
    showMessage('feeHolidayMessage', 'No students found in this class.', 'error');
    return null;
  }

  // All fee records for these students.
  const ids = students.map(s => s.student_id);
  let fq = supabaseClient.from('fees').select('*').in('student_id', ids);
  if (schoolId) fq = fq.eq('school_id', schoolId);
  const { data: allFees } = await fq;

  const statements = students.map(s => {
    const name = `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || s.student_id;
    const records = (allFees || []).filter(f => f.student_id === s.student_id);

    let totalOutstanding = 0;  // sum of all outstanding term balances (incl. current/previous)
    let credit = 0;            // overpayment / credit to deduct
    const entries = [];        // one entry per term: { academic_year, term, markup, paid, balance }

    for (const f of records) {
      // Ignore any future-term records (should not normally exist).
      if (compareTerm(f.academic_year, f.term, currentYear, currentTerm) > 0) continue;
      const markup = round2(Number(f.total_amount) + Number(f.debt || 0));
      const paid = round2(Number(f.amount_paid));
      const balance = round2(markup - paid);
      entries.push({ academic_year: f.academic_year, term: f.term, markup, paid, balance });
      if (balance > 0) totalOutstanding = round2(totalOutstanding + balance);
      else if (balance < 0) credit = round2(credit + Math.abs(balance));
    }

    // Show terms in chronological order.
    entries.sort((a, b) => compareTerm(a.academic_year, a.term, b.academic_year, b.term));

    const amountToPay = Math.max(0, round2(nextFee + totalOutstanding - credit));
    return {
      student_id: s.student_id,
      name,
      class: s.class_applying,
      entries,
      totalOutstanding,
      credit,
      nextFee: round2(nextFee),
      amountToPay
    };
  });

  return { statements, className, currentYear, currentTerm, nextTerm, nextYear, nextFeeSource };
}

/** Renders the on-tab preview table of the bulk amounts. */
async function renderHolidayPreviewTable() {
  const tbody = getEl('feeHolidayPreviewBody');
  if (!tbody) return;
  const className = getEl('feeHolidayClass')?.value || '';
  if (!className) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Select a class to preview holiday fee statements.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';
  const data = await buildHolidayStatementData();
  clearMessage('feeHolidayMessage');

  if (!data) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No data to show.</td></tr>';
    return;
  }

  if (data.nextFeeSource === 'missing') {
    showMessage('feeHolidayMessage', '⚠️ No fee is set for the next term for this class. Amount to pay currently reflects the balance only. Set the next term fee via "Set / Update Class Fee" or enter it manually above.', 'error');
  }

  tbody.innerHTML = data.statements.map(s => {
    // Per-term balance breakdown shown under the balance column.
    const breakdown = s.entries.length
      ? s.entries.map(e => {
          if (Number(e.balance) !== 0) {
            const label = Number(e.balance) < 0
              ? `<span class="fee-balance-credit">Credit GH₵ ${formatCurrency(Math.abs(e.balance))}</span>`
              : `<span class="fee-balance-unpaid">GH₵ ${formatCurrency(e.balance)}</span>`;
            return `<div style="font-size:0.8rem;">${e.term} Term ${e.academic_year}: <strong>${label}</strong></div>`;
          }
          return `<div style="font-size:0.8rem;color:var(--text-muted);">${e.term} Term ${e.academic_year}: Paid ✓</div>`;
        }).join('')
      : '<span style="color:var(--text-muted);">No fee records</span>';

    return `<tr>
      <td><strong>${s.student_id}</strong></td>
      <td>${s.name}</td>
      <td>
        ${breakdown}
        <div style="margin-top:0.25rem;font-weight:700;">Total: GH₵ ${formatCurrency(s.totalOutstanding)}</div>
      </td>
      <td>${data.nextFeeSource === 'missing' ? '<span style="color:var(--text-muted);">Not set</span>' : `GH₵ ${formatCurrency(s.nextFee)}`}</td>
      <td>${s.credit > 0 ? `<span class="fee-balance-credit">-GH₵ ${formatCurrency(s.credit)}</span>` : '—'}</td>
      <td><strong style="color:#b91c1c;">GH₵ ${formatCurrency(s.amountToPay)}</strong></td>
    </tr>`;
  }).join('');
}

/** Generates the full printable HTML, one page per student. */
async function generateHolidayPrintHTML() {
  const schoolId = await getCurrentSchoolId();

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
  }

  const data = await buildHolidayStatementData();
  if (!data) return null;
  const { statements, currentYear, currentTerm, nextTerm, nextYear, nextFeeSource } = data;
  const now = formatDate(new Date().toISOString());
  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" style="width:70px;height:70px;object-fit:contain;" />`
    : '';

  const pages = statements.map(s => {
    const balanceRows = s.entries.length
      ? s.entries.map((e, i) => {
          const rowBg = i % 2 === 0 ? '#fff' : '#f6f8fb';
          const overpaid = Number(e.balance) < 0;
          const isOutstanding = Number(e.balance) > 0;
          const balanceCell = overpaid
            ? `<span style="color:#166534;">Credit GH₵ ${formatCurrency(Math.abs(e.balance))}</span>`
            : `<span style="color:${isOutstanding ? '#b91c1c' : '#166534'};font-weight:${isOutstanding ? 700 : 400};">GH₵ ${formatCurrency(e.balance)}</span>`;
          return `<tr style="background:${rowBg};">
            <td style="padding:6px;border:1px solid #ddd;">${e.term} Term ${e.academic_year}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right;">GH₵ ${formatCurrency(e.markup)}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right;">GH₵ ${formatCurrency(e.paid)}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right;">${balanceCell}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="4" style="padding:6px;border:1px solid #ddd;text-align:center;color:#555;">No fee records found.</td></tr>`;

    const creditRow = s.credit > 0
      ? `<tr><td style="padding:6px 5px;">Less: Credit / Overpayment</td><td style="padding:6px 5px;text-align:right;">- GH₵ ${formatCurrency(s.credit)}</td></tr>`
      : '';

    return `
      <div class="statement-page">
        <div style="display:flex;align-items:center;gap:12px;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:12px;">
          ${logoHtml}
          <div style="flex:1;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#1e3a5f;">${schoolName}</div>
            <div style="font-size:14px;font-weight:600;letter-spacing:1px;color:#1e3a5f;">🏖️ HOLIDAY FEE STATEMENT</div>
            <div style="font-size:12px;color:#555;">Issued: ${now}</div>
          </div>
        </div>

        <div style="font-size:13px;margin-bottom:12px;padding:10px;background:#f0f4f9;border-radius:6px;">
          <strong>Student:</strong> ${s.name} &nbsp; | &nbsp; <strong>ID:</strong> ${s.student_id} &nbsp; | &nbsp; <strong>Class:</strong> ${s.class}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
          <thead>
            <tr style="background:#1e3a5f;color:#fff;">
              <th style="padding:6px;border:1px solid #1e3a5f;text-align:left;">Term / Academic Year</th>
              <th style="padding:6px;border:1px solid #1e3a5f;text-align:right;">Fees (GH₵)</th>
              <th style="padding:6px;border:1px solid #1e3a5f;text-align:right;">Paid (GH₵)</th>
              <th style="padding:6px;border:1px solid #1e3a5f;text-align:right;">Balance (GH₵)</th>
            </tr>
          </thead>
          <tbody>
            ${balanceRows}
            <tr style="background:#eef2f7;font-weight:700;">
              <td colspan="3" style="padding:6px;border-top:2px solid #1e3a5f;text-align:right;">TOTAL OUTSTANDING</td>
              <td style="padding:6px;border-top:2px solid #1e3a5f;text-align:right;color:#b91c1c;">GH₵ ${formatCurrency(s.totalOutstanding)}</td>
            </tr>
          </tbody>
        </table>

        <div style="border:2px solid #1e3a5f;border-radius:8px;padding:12px;margin-bottom:12px;background:#f7faff;">
          <div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:8px;">FEE SUMMARY FOR NEXT TERM (${nextTerm} Term ${nextYear})</div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:6px 5px;">Total Outstanding Balance (all terms)</td>
              <td style="padding:6px 5px;text-align:right;">GH₵ ${formatCurrency(s.totalOutstanding)}</td>
            </tr>
            ${creditRow}
            <tr>
              <td style="padding:6px 5px;">${nextTerm} Term ${nextYear} Fees ${nextFeeSource === 'missing' ? '<span style="color:#b91c1c;font-size:12px;">(not yet set)</span>' : ''}</td>
              <td style="padding:6px 5px;text-align:right;">GH₵ ${formatCurrency(s.nextFee)}</td>
            </tr>
            <tr style="border-top:2px solid #1e3a5f;">
              <td style="padding:8px 5px;font-weight:700;">TOTAL TO PAY NEXT TERM</td>
              <td style="padding:8px 5px;text-align:right;font-size:18px;font-weight:800;color:#b91c1c;">GH₵ ${formatCurrency(s.amountToPay)}</td>
            </tr>
          </table>
        </div>

        <div style="border:2px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:12px;font-size:13px;color:#78350f;">
          <strong>📢 NOTE TO PARENTS / GUARDIANS</strong><br/>
          Dear Parent/Guardian, please kindly prepare and pay <strong>GH₵ ${formatCurrency(s.amountToPay)}</strong> for
          your ward's <strong>${nextTerm} Term ${nextYear}</strong> school fees before or on resumption.
          ${s.credit > 0 ? 'Your ward has a credit which has already been deducted from the amount due. ' : ''}
          ${s.totalOutstanding > 0 ? `This includes your ward's outstanding balance of GH₵ ${formatCurrency(s.totalOutstanding)} (see the term-by-term breakdown above). ` : ''}
          We thank you for your continued support and wish your ward a happy and restful holiday vacation.
        </div>

        <div style="margin-top:34px;display:flex;justify-content:space-between;font-size:12px;color:#555;">
          <div>______________________<br/>Student's Signature</div>
          <div>______________________<br/>Parent's Signature</div>
          <div>______________________<br/>School Official</div>
        </div>
      </div>`;
  }).join('');

  return `<div style="font-family:Arial,sans-serif;max-width:210mm;margin:0 auto;">${pages}</div>`;
}

/** Preview all holiday statements in a modal. */
window.previewHolidayFees = async function() {
  const modal = getEl('holidayPrintModal');
  const content = getEl('holidayPrintContent');
  if (!modal || !content) return;

  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Generating statements...</div>';
  modal.style.display = 'flex';

  const html = await generateHolidayPrintHTML();
  if (!html) {
    content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No statements generated. Check the selected class, year and term.</div>';
    return;
  }
  content.innerHTML = html;
};

/** Print all holiday statements directly (opens in a new print window). */
window.printHolidayFees = async function() {
  const html = await generateHolidayPrintHTML();
  if (!html) {
    alert('Unable to generate statements. Check the selected class, year and term.');
    return;
  }
  openPrintWindow(`
    <html><head>
      <title>Holiday Fee Statements</title>
      <style>
        @media print {
          body { margin:0; padding:0; }
          .statement-page { page-break-after: always; }
          .statement-page:last-child { page-break-after: auto; }
        }
        body { font-family: Arial, sans-serif; }
      </style>
    </head><body>${html}</body></html>
  `, 'Holiday Fee Statements', 900, 700);
};

/** Print holiday statements from the preview modal. */
window.printHolidayFeesFromModal = function() {
  const content = getEl('holidayPrintContent');
  if (!content) return;
  openPrintWindow(`
    <html><head>
      <title>Holiday Fee Statements</title>
      <style>
        @media print {
          body { margin:0; padding:0; }
          .statement-page { page-break-after: always; }
          .statement-page:last-child { page-break-after: auto; }
        }
        body { font-family: Arial, sans-serif; }
      </style>
    </head><body>${content.innerHTML}</body></html>
  `, 'Holiday Fee Statements', 900, 700);
};
// ================================================================
// GENERATE FEE RECORDS FOR ALL STUDENTS IN A CLASS
// ================================================================

async function generateFeeRecords() {
  const className = getEl('feeGenClass').value;
  const term = getEl('feeGenTerm').value;

  if (!className) {
    showMessage('feeGenerateMessage', 'Please select a class.', 'error');
    return;
  }

  const btn = getEl('feeGenerateRecordsBtn');
  setLoading(btn, true, 'Checking fee structure...');
  clearMessage('feeGenerateMessage');

  try {
    const schoolId = await getCurrentSchoolId();

    // Look up fee structure for this class and term to get the academic year
    const { data: classFee } = await supabaseClient.from('class_fees')
      .select('fee_amount, academic_year')
      .eq('class_name', className)
      .eq('term', term)
      .maybeSingle();

    if (!classFee) {
      setLoading(btn, false, '👥 Generate Fee Records');
      showMessage('feeGenerateMessage', 
        `❌ No fee structure found for ${className} - ${term} Term.\n\nPlease go to the "Set / Update Class Fee" section first to set the fee structure (including academic year) for this class and term before generating fee records.`, 
        'error');
      return;
    }

    const year = classFee.academic_year;
    const feeAmount = classFee.fee_amount;

    if (!confirm(`Generate fee records for ALL students in ${className}?\n\nTerm: ${term} ${year}\nFee Amount: GH₵ ${formatCurrency(feeAmount)}\n\nExisting records will be preserved.`)) {
      setLoading(btn, false, '👥 Generate Fee Records');
      return;
    }

    // Get all students in this class
    let studentsQuery = supabaseClient.from('applications')
      .select('student_id')
      .eq('class_applying', className);
    if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId);
    const { data: students } = await studentsQuery;

    if (!students || students.length === 0) {
      showMessage('feeGenerateMessage', 'No students found in this class.', 'error');
      return;
    }

    let created = 0;
    let skipped = 0;

    for (const student of students) {
      // Check if fee record already exists
      const { data: existing } = await supabaseClient.from('fees')
        .select('id, total_amount, amount_paid, debt, payment_status')
        .eq('student_id', student.student_id)
        .eq('academic_year', year)
        .eq('term', term)
        .maybeSingle();

      if (existing) {
        // If the existing record has an outstanding balance but payment_status is 'paid'
        // (e.g. from CSV import before fee structure was set), fix the status
        const existingOutstanding = (Number(existing.total_amount) + Number(existing.debt || 0)) - Number(existing.amount_paid);
        if (existingOutstanding > 0 && existing.payment_status === 'paid') {
          await supabaseClient.from('fees')
            .update({ payment_status: 'unpaid' })
            .eq('id', existing.id);
        }
        skipped++;
        continue;
      }

      // Create fee record
      const { error } = await supabaseClient.from('fees').insert({
        student_id: student.student_id,
        academic_year: year,
        term: term,
        total_amount: feeAmount,
        amount_paid: 0,
        debt: 0,
        payment_status: feeAmount > 0 ? 'unpaid' : 'paid',
        school_id: schoolId,
      });

      if (!error) created++;
    }

    showMessage('feeGenerateMessage', `✅ Complete!\nCreated: ${created}\nSkipped (already exist): ${skipped}\nTotal students: ${students.length}`, 'success');
    logSubAdminActivity(`Generated fee records for ${className} ${term} ${year}`, 'fee', `${className}: ${created} created, ${skipped} skipped`);
  } catch (err) {
    showMessage('feeGenerateMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, '👥 Generate Fee Records');
  }
}

// ================================================================
// DELETE INDIVIDUAL FEE RECORD
// ================================================================

window.deleteFeeRecord = async function(feeId, studentId, termLabel) {
  if (!confirm(`🗑️ Delete fee record for ${studentId} (${termLabel})?\n\nThis will permanently delete this fee record from the database. Payment transactions and receipts will be preserved. This action CANNOT be undone.`)) return;

  try {
    // Delete only the fee record - receipts and payment_transactions are PRESERVED
    const { error } = await supabaseClient.from('fees')
      .delete()
      .eq('id', feeId);

    if (error) throw error;

    showMessage('editStudentFeeMessage', `✅ Fee record for ${termLabel} deleted successfully. Receipts & payment history preserved.`, 'success');
    logSubAdminActivity(`Deleted fee record for ${studentId} (${termLabel})`, 'fee', `${studentId}/${termLabel}`);

    // Reload the edit modal content
    await editStudentFee(studentId);
  } catch (err) {
    showMessage('editStudentFeeMessage', 'Error deleting fee record: ' + err.message, 'error');
  }
};

// ================================================================
// EDIT STUDENT FEE RECORDS
// ================================================================

window.editStudentFee = async function(studentId) {
  // Get all fee records for this student
  const { data: fees } = await supabaseClient.from('fees')
    .select('*')
    .eq('student_id', studentId)
    .order('academic_year')
    .order('term');

  if (!fees || fees.length === 0) {
    alert(`No fee records found for ${studentId}. Fee records are created automatically when the fee structure is set via "Set / Update Class Fee".`);
    return;
  }

  // Build a simple inline edit form
  const student = await supabaseClient.from('applications')
    .select('first_name, middle_name, last_name')
    .eq('student_id', studentId)
    .single();

  const name = student?.data ? `${student.data.first_name} ${student.data.middle_name || ''} ${student.data.last_name}` : studentId;

  let html = `<div style="padding:1rem;">
    <h3 style="margin:0 0 0.5rem 0;">✏️ Edit Fee Records</h3>
    <p style="margin-bottom:1rem;color:var(--text-muted);font-size:0.85rem;">
      <strong>${studentId}</strong> - ${name}
    </p>
    <table class="app-table">
      <thead>
        <tr>
          <th>Year</th>
          <th>Term</th>
          <th>Total Amount (GH₵)</th>
          <th>Amount Paid (GH₵)</th>
          <th>Debt (GH₵)</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${fees.map(f => `
          <tr id="fee-row-${f.id}">
            <td><input type="text" class="edit-fee-year" value="${f.academic_year}" data-id="${f.id}" style="width:100px;padding:0.3rem;border:1px solid var(--border);border-radius:4px;" /></td>
            <td>
              <select class="edit-fee-term" data-id="${f.id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:4px;">
                <option value="First" ${f.term === 'First' ? 'selected' : ''}>First</option>
                <option value="Second" ${f.term === 'Second' ? 'selected' : ''}>Second</option>
                <option value="Third" ${f.term === 'Third' ? 'selected' : ''}>Third</option>
              </select>
            </td>
            <td><input type="number" class="edit-fee-total" value="${f.total_amount}" data-id="${f.id}" step="0.01" min="0" style="width:100px;padding:0.3rem;border:1px solid var(--border);border-radius:4px;" /></td>
            <td><input type="number" class="edit-fee-paid" value="${f.amount_paid}" data-id="${f.id}" step="0.01" min="0" style="width:100px;padding:0.3rem;border:1px solid var(--border);border-radius:4px;" /></td>
            <td><input type="number" class="edit-fee-debt" value="${f.debt || 0}" data-id="${f.id}" step="0.01" min="0" style="width:100px;padding:0.3rem;border:1px solid var(--border);border-radius:4px;" /></td>
            <td>
              <select class="edit-fee-status" data-id="${f.id}" style="padding:0.3rem;border:1px solid var(--border);border-radius:4px;">
                <option value="unpaid" ${f.payment_status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                <option value="partial" ${f.payment_status === 'partial' ? 'selected' : ''}>Partial</option>
                <option value="paid" ${f.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
              </select>
            </td>
            <td>
              <button type="button" class="action-btn danger" onclick="deleteFeeRecord('${f.id}', '${studentId}', '${f.term} ${f.academic_year}')" style="font-size:0.8rem;padding:0.25rem 0.5rem;">🗑️ Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="margin-top:1rem;display:flex;gap:0.5rem;">
      <button type="button" class="btn btn-primary" id="saveStudentFeeEdits">💾 Save Changes</button>
      <button type="button" class="btn btn-secondary" onclick="document.getElementById('editStudentFeeModal').style.display='none'">Cancel</button>
    </div>
    <div id="editStudentFeeMessage" class="message" style="display:none;margin-top:0.75rem;"></div>
  </div>`;

  // Create or reuse modal
  let modal = getEl('editStudentFeeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'editStudentFeeModal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `<div class="modal-card" style="max-width:900px;max-height:90vh;overflow-y:auto;">
      <div class="modal-header">
        <h3>✏️ Edit Student Fee Records</h3>
        <button class="modal-close" onclick="document.getElementById('editStudentFeeModal').style.display='none'">✖</button>
      </div>
      <div class="modal-body" id="editStudentFeeContent"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'editStudentFeeModal') modal.style.display = 'none';
    });
  }

  getEl('editStudentFeeContent').innerHTML = html;
  modal.style.display = 'flex';

  // Add save handler
  setTimeout(() => {
    getEl('saveStudentFeeEdits')?.addEventListener('click', async () => {
      const btn = getEl('saveStudentFeeEdits');
      setLoading(btn, true, 'Saving...');
      clearMessage('editStudentFeeMessage');

      try {
        const yearInputs = document.querySelectorAll('.edit-fee-year');
        const termInputs = document.querySelectorAll('.edit-fee-term');
        const totalInputs = document.querySelectorAll('.edit-fee-total');
        const paidInputs = document.querySelectorAll('.edit-fee-paid');
        const debtInputs = document.querySelectorAll('.edit-fee-debt');
        const statusInputs = document.querySelectorAll('.edit-fee-status');

        let updated = 0;
        for (let i = 0; i < yearInputs.length; i++) {
          const id = yearInputs[i].dataset.id;
          const academic_year = yearInputs[i].value;
          const term = termInputs[i].value;
          const total_amount = parseFloat(totalInputs[i].value) || 0;
          const amount_paid = parseFloat(paidInputs[i].value) || 0;
          const debt = parseFloat(debtInputs[i].value) || 0;
          const payment_status = statusInputs[i].value;

          const { error } = await supabaseClient.from('fees')
            .update({
              academic_year,
              term,
              total_amount,
              amount_paid,
              debt,
              payment_status,
            })
            .eq('id', id);

          if (!error) updated++;
        }

        showMessage('editStudentFeeMessage', `✅ Updated ${updated} fee record(s) for ${studentId}.`, 'success');
        logSubAdminActivity(`Edited fee records for ${studentId}`, 'fee', `${studentId}: ${updated} records`);
        
        // Reload the student fees tab
        await loadStudentFeesTab();
      } catch (err) {
        showMessage('editStudentFeeMessage', 'Error: ' + err.message, 'error');
      } finally {
        setLoading(btn, false, '💾 Save Changes');
      }
    });
  }, 100);
};

// Close modals
window.closeReceiptModal = function() {
  const modal = getEl('receiptModal');
  if (modal) modal.style.display = 'none';
};

window.closeReceiptListModal = function() {
  const modal = getEl('receiptListModal');
  if (modal) modal.style.display = 'none';
};

// Modal click to close
document.addEventListener('click', (e) => {
  if (e.target.id === 'receiptModal') closeReceiptModal();
  if (e.target.id === 'receiptListModal') closeReceiptListModal();
  if (e.target.id === 'debtorsPrintModal') document.getElementById('debtorsPrintModal').style.display = 'none';
  if (e.target.id === 'holidayPrintModal') document.getElementById('holidayPrintModal').style.display = 'none';
  if (e.target.id === 'deleteClassFeeModal') closeDeleteClassFeeModal();
});
