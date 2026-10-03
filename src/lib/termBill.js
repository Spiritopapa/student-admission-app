import { supabase } from './supabase';
import { openPrintWindow, escapeHtml } from './print';
import { formatDate, buildStudentName } from './format';

const esc = escapeHtml;

/** School display info used on printed documents. */
export async function fetchSchoolPrintInfo(schoolId) {
  let name = 'School';
  let logoUrl = '';
  let address = '';
  let motto = '';
  let phone = '';
  if (schoolId) {
    const { data: ss } = await supabase
      .from('school_settings')
      .select('school_name, logo_url, school_address, school_motto')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (ss?.school_name) name = ss.school_name;
    if (ss?.logo_url) logoUrl = ss.logo_url;
    if (ss?.school_address) address = ss.school_address;
    if (ss?.school_motto) motto = ss.school_motto;
    const { data: school } = await supabase.from('schools').select('phone').eq('id', schoolId).maybeSingle();
    phone = school?.phone || '';
  }
  return { name, logoUrl, address, motto, phone };
}

/**
 * The term's closing date, taken from the school's exam record for that
 * year/term (the same value printed on report cards). Null when not set.
 */
export async function fetchTermClosingDate(schoolId, year, term) {
  if (!schoolId || !year || !term) return null;
  try {
    const { data } = await supabase
      .from('exams')
      .select('closing_date')
      .eq('school_id', schoolId)
      .eq('academic_year', year)
      .eq('term', term)
      .not('closing_date', 'is', null)
      .order('closing_date', { ascending: false })
      .limit(1);
    return data && data.length ? data[0].closing_date : null;
  } catch (err) {
    return null;
  }
}

export async function fetchTermFee(schoolId, studentId, year, term) {
  const { data } = await supabase
    .from('fees')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('term', term)
    .maybeSingle();
  return data || null;
}

export async function fetchTermReceipts(schoolId, studentId, year, term) {
  const { data } = await supabase
    .from('receipts')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('term', term)
    .order('receipt_date', { ascending: true });
  return data || [];
}

function money(n) {
  const value = Number(n || 0);
  const sign = value < 0 ? '-' : '';
  return `${sign}GHC ${Math.abs(value).toFixed(2)}`;
}
/**
 * Build one A5 termly fee bill page for a student.
 *
 * @param {object} p
 * @param {object} p.school   - { name, logoUrl, address, motto, phone }
 * @param {object} p.student  - application row (name fields, class, parent)
 * @param {object|null} p.fee - the `fees` row for this term (or null)
 * @param {Array}   p.receipts - receipts for this term
 * @param {string}  p.year    - academic year, e.g. "2025/2026"
 * @param {string}  p.term    - "First" | "Second" | "Third"
 * @param {string|null} p.closingDate - term closing/vacation date
 * @param {boolean} p.lastPage - suppress the trailing page break
 */
export function buildTermlyBillPage({ school, student, fee, receipts, year, term, closingDate, lastPage = false }) {
  const studentName = buildStudentName(student?.first_name, student?.middle_name, student?.last_name) || student?.student_id || 'Student';
  const totalAmount = Number(fee?.total_amount || 0);
  const debt = Number(fee?.debt || 0);
  const totalCharged = totalAmount + debt;
  const paid = (receipts || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const balance = totalCharged - paid;
  const due = Math.max(balance, 0);
  const credit = balance < 0 ? Math.abs(balance) : 0;

  const paymentRows = (receipts || []).length
    ? receipts
        .map(
          (r) =>
            `<tr>
              <td>${r.receipt_date ? esc(formatDate(r.receipt_date)) : '—'}</td>
              <td>${esc(r.receipt_number || '—')}</td>
              <td>${esc((r.payment_method || '—').replace(/_/g, ' '))}</td>
              <td class="right">${money(r.amount)}</td>
            </tr>`
        )
        .join('')
    : '<tr><td colspan="4" style="text-align:center;color:#64748b;">No payments recorded for this term.</td></tr>';

  const logoHtml = school?.logoUrl
    ? `<img src="${esc(school.logoUrl)}" alt="logo" class="bill-logo" />`
    : '';

  const closingHtml = closingDate
    ? `<div class="bill-closing">CLOSING DATE: <b>${esc(formatDate(closingDate))}</b></div>`
    : '';

  const balanceHtml = credit > 0
    ? `<tr class="bill-total-row">
        <td class="bill-light"><b>CREDIT / OVERPAYMENT (applied to next term)</b></td>
        <td class="right bill-credit"><b>${money(credit)}</b></td>
      </tr>`
    : `<tr class="bill-total-row">
        <td class="bill-light"><b>BALANCE DUE</b></td>
        <td class="right ${due > 0 ? 'bill-due' : 'bill-credit'}"><b>${money(due)}</b></td>
      </tr>`;

  const parentLine = student?.parent_name
    ? `<strong>Parent / Guardian:</strong> ${esc(student.parent_name)}${student?.parent_contact ? ` &nbsp;|&nbsp; <strong>Contact:</strong> ${esc(student.parent_contact)}` : ''}`
    : '';
const notice = due > 0
    ? `Kindly settle the outstanding balance of <b>${money(due)}</b>${closingDate ? ` before the term closes on ${esc(formatDate(closingDate))}` : ' as soon as possible'} to keep your ward in school. Thank you for your continued support.`
    : credit > 0
      ? `Your ward's fees are fully settled with a credit of <b>${money(credit)}</b>, which will be applied to the next term. Thank you for your timely payment.`
      : "Your ward's fees are fully settled for this term. Thank you for your timely payment.";

  return `<div class="bill-page" style="${lastPage ? '' : 'page-break-after: always;'}" data-student="${esc(student?.student_id || '')}">
    <div class="bill-head">
      ${logoHtml}
      <div style="flex:1;text-align:center;">
        <div class="bill-school">${esc(school?.name || 'School')}</div>
        ${school?.address ? `<div class="bill-sub">${esc(school.address)}</div>` : ''}
        ${school?.motto ? `<div class="bill-sub bill-motto">${esc(school.motto)}</div>` : ''}
        <div class="bill-title">TERMLY FEE BILL</div>
        <div class="bill-sub">${esc(term)} Term ${esc(year)}</div>
      </div>
    </div>
    ${closingHtml}

    <div class="bill-student">
      <strong>Student:</strong> ${esc(studentName)} &nbsp;|&nbsp; <strong>ID:</strong> <span style="font-family:monospace;">${esc(student?.student_id || '—')}</span> &nbsp;|&nbsp; <strong>Class:</strong> ${esc(student?.class_applying || '—')}<br/>
      ${parentLine}
    </div>

    <table class="bill-table">
      <thead>
        <tr><th style="width:68%;">Description</th><th class="right" style="width:32%;">Amount (GHC)</th></tr>
      </thead>
      <tbody>
        <tr><td>${esc(term)} Term fees (${esc(year)})</td><td class="right">${money(totalAmount)}</td></tr>
        ${debt > 0 ? `<tr><td>Debt brought forward</td><td class="right">${money(debt)}</td></tr>` : ''}
        <tr class="bill-total-row">
          <td class="bill-light"><b>Total charged this term</b></td>
          <td class="right"><b>${money(totalCharged)}</b></td>
        </tr>
        <tr><td>LESS: Total paid this term</td><td class="right">${money(paid)}</td></tr>
        ${balanceHtml}
      </tbody>
    </table>

    <div class="bill-section">PAYMENTS RECEIVED</div>
    <table class="bill-table">
      <thead>
        <tr><th>Date</th><th>Receipt No.</th><th>Method</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>${paymentRows}</tbody>
      <tfoot>
        <tr class="bill-total-row">
          <td colspan="3" class="bill-light"><b>Total paid this term</b></td>
          <td class="right"><b>${money(paid)}</b></td>
        </tr>
      </tfoot>
    </table>

    <div class="bill-note">
      <b>NOTE TO PARENT / GUARDIAN</b><br/>
      Dear ${student?.parent_name ? esc(student.parent_name) : 'Parent/Guardian'},<br/>${notice}
    </div>

    <div class="bill-sig">
      <div>______________________<br/>Student's Signature</div>
      <div>______________________<br/>Parent's Signature</div>
      <div>______________________<br/>School Official</div>
    </div>
    <div class="bill-foot">
      ${school?.phone ? `For enquiries call ${esc(school.phone)}. ` : ''}Student Admission Portal · Generated ${new Date().toLocaleString()}
    </div>
  </div>`;
}
const BILL_CSS = `
  .bill-page { width: 148mm; min-height: 185mm; margin: 0 auto; font-family: Arial, 'Segoe UI', sans-serif; color: #111; font-size: 11px; }
  .bill-head { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 8px; }
  .bill-logo { height: 54px; width: 54px; object-fit: contain; }
  .bill-school { font-size: 15px; font-weight: 800; color: #1e3a5f; }
  .bill-title { font-size: 13px; font-weight: 800; letter-spacing: 1.5px; color: #1e3a5f; margin-top: 2px; }
  .bill-sub { font-size: 10px; color: #475569; }
  .bill-motto { font-style: italic; }
  .bill-closing { text-align: center; font-size: 11px; background: #f0f4f9; border: 1px solid #1e3a5f; color: #1e3a5f; border-radius: 6px; padding: 4px 6px; margin-bottom: 8px; }
  .bill-student { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; line-height: 1.55; margin-bottom: 8px; }
  .bill-table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  .bill-table th, .bill-table td { border: 1px solid #94a3b8; padding: 4px 6px; font-size: 10.5px; }
  .bill-table th { background: #1e3a5f; color: #fff; text-align: left; }
  .bill-total-row td { background: #eef2f7; }
  .bill-balance td { background: #fef2f2; }
  .bill-credit { color: #15803d; font-weight: 800; }
  .bill-due { color: #b91c1c; font-weight: 800; }
  .bill-light { background: transparent; }
  .bill-section { font-size: 10px; font-weight: 800; letter-spacing: 1px; color: #1e3a5f; margin-top: 4px; }
  .bill-note { border: 1px solid #d97706; background: #fffbeb; color: #78350f; border-radius: 6px; padding: 7px 9px; margin-top: 6px; line-height: 1.5; }
  .bill-sig { display: flex; justify-content: space-between; margin-top: 26px; font-size: 10px; color: #475569; }
  .bill-foot { margin-top: 8px; font-size: 9.5px; color: #64748b; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 6px; }
  .right { text-align: right; }
  @media print {
    .bill-page { width: 148mm; margin: 0; }
    @page { size: A5 portrait; margin: 9mm; }
  }
`;

/**
 * Print termly fee bills for one or many students in a single print window
 * (one A5 page per student, in the order given).
 *
 * @param {object} p
 * @param {string} p.schoolId
 * @param {Array}  p.students - application rows
 * @param {string} p.year     - academic year, e.g. "2025/2026"
 * @param {string} p.term     - "First" | "Second" | "Third"
 * @param {string|null} p.closingDate - term closing/vacation date
 * @returns {Promise<number>} number of bills printed
 */
export async function printTermlyBills({ schoolId, students = [], year, term, closingDate }) {
  const list = (students || []).filter(Boolean);
  if (!list.length || !year || !term) return 0;

  const school = await fetchSchoolPrintInfo(schoolId);
  const closing = closingDate || (await fetchTermClosingDate(schoolId, year, term));

  const pages = [];
  for (let i = 0; i < list.length; i += 1) {
    const student = list[i];
    const [fee, receipts] = await Promise.all([
      fetchTermFee(schoolId, student.student_id, year, term),
      fetchTermReceipts(schoolId, student.student_id, year, term),
    ]);
    pages.push(
      buildTermlyBillPage({
        school,
        student,
        fee,
        receipts,
        year,
        term,
        closingDate: closing,
        lastPage: i === list.length - 1,
      })
    );
  }

  openPrintWindow(
    `Termly Fee Bills — ${school.name} ${term} Term ${year}`,
    `<style>${BILL_CSS}</style>${pages.join('')}`
  );
  return pages.length;
}