import { supabase } from './supabase';
import { openPrintWindow, escapeHtml } from './print';
import { formatDate, buildStudentName } from './format';
import { orderFees, termKey, feeBalance } from './feeMath';

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

/** The academic year + term that follows the given term. */
export function nextTermOf(year, term) {
  const order = ['First', 'Second', 'Third'];
  const idx = order.indexOf(term);
  if (idx < 0) return { year, term: 'First' };
  if (idx === order.length - 1) {
    const start = Number(String(year || '').split('/')[0] || 0) + 1;
    return { year: `${start}/${start + 1}`, term: order[0] };
  }
  return { year, term: order[idx + 1] };
}

/** The fee structure (class_fees row) for a class in a given year/term. */
export async function fetchClassFee(schoolId, className, year, term) {
  if (!schoolId || !className || !year || !term) return null;
  const { data } = await supabase
    .from('class_fees')
    .select('*')
    .eq('school_id', schoolId)
    .eq('class_name', className)
    .eq('academic_year', year)
    .eq('term', term)
    .maybeSingle();
  return data || null;
}

function money(n) {
  const value = Number(n || 0);
  const sign = value < 0 ? '-' : '';
  return `${sign}GHC ${Math.abs(value).toFixed(2)}`;
}
/**
 * Merge the student's recurring items (from the current term's fee_breakdown)
 * with one-off bill items the office enters when printing. Matching names
 * (case-insensitive) are overridden by the office entry so totals never
 * double-count the same item.
 */
export function mergeBillItems(recurring = [], extra = []) {
  const merged = (recurring || [])
    .map((it) => ({
      name: String(it?.name || 'Additional Fee'),
      amount: Math.max(Number(it?.amount || 0), 0),
    }))
    .filter((it) => it.amount > 0);
  (extra || []).forEach((it) => {
    const name = String(it?.name || '').trim();
    const amount = Number(it?.amount || 0);
    if (!name || !(amount > 0)) return;
    const key = name.toLowerCase();
    const idx = merged.findIndex((m) => m.name.trim().toLowerCase() === key);
    if (idx >= 0) merged[idx] = { name, amount };
    else merged.push({ name, amount });
  });
  return merged;
}

/**
 * Pure computation of the staged, procedural termly bill.
 *
 * The bill mirrors how world-class school statements are laid out
 * (MIT: previous billed balance -> current charges -> payments -> credits ->
 * amount due; Inkwelly: per-term fee invoice heads + due total):
 *
 *   STAGE 1 - PRESENT TERM ACCOUNT   debt b/f + term charges (class fee +
 *             fee_breakdown items) - payments  ->  PRESENT TERM BALANCE,
 *             which is an arrear (positive) or a credit (negative).
 *   STAGE 2 - NEXT TERM FEE STRUCTURE class_fees row for the NEXT year/term.
 *             When the structure has not been set for the class, the next
 *             term is NOT billed — no class fee and no other items are
 *             included (the bill then covers the present term only).
 *   STAGE 3 - OTHER BILL ITEMS       recurring fee_breakdown items projected
 *             onto next term + one-off items supplied by the office. Only
 *             applied when the next term fee structure exists.
 *   STAGE 4 - SUB-TOTAL              present arrear + next-term class fee +
 *             other items. A present CREDIT is deliberately left out here so
 *             it is subtracted exactly once, in stage 5.
 *   STAGE 5 - AMOUNT DUE FOR NEXT TERM  sub-total - present credit (>= 0).
 *
 * @param {object}  p
 * @param {object|null} p.fee        - `fees` row for the billed term
 * @param {Array}   p.receipts       - receipts for the billed term
 * @param {object|null} p.nextClassFee - class_fees row for the NEXT term
 * @param {Array}   p.billItems      - one-off items added by the office
 * @param {Array}   p.history        - ALL of the student's fee records (any
 *                                     year/term). Used to itemise the arrears
 *                                     carried forward term-by-term and to keep
 *                                     the bill free of double counting (each
 *                                     earlier term's balance lives on its own
 *                                     record, so `debt` is never re-added).
 */
export function computeTermlyBillStages({
  fee = null,
  receipts = [],
  nextClassFee = null,
  billItems = [],
  history = [],
}) {
  const breakdown = fee?.fee_breakdown && typeof fee.fee_breakdown === 'object' ? fee.fee_breakdown : {};

  /* --- Stage 1: arrears + present term account ------------------------ */
  const classFeeThisTerm =
    breakdown.class_fee != null && Number(breakdown.class_fee) >= 0
      ? Number(breakdown.class_fee)
      : Number(fee?.total_amount || 0);
  const recurringItems = (Array.isArray(breakdown.items) ? breakdown.items : [])
    .map((it) => ({ name: String(it?.name || 'Additional Fee'), amount: Number(it?.amount || 0) }))
    .filter((it) => it.amount > 0);
  const thisTermCharges = Number(fee?.total_amount || 0); // authoritative snapshot (already includes items)

  // Itemised arrears: every EARLIER term record with an outstanding balance.
  // `debt` is deliberately ignored — the money is already represented by the
  // earlier term records, so including it would double-count.
  const feeKey = fee ? termKey(fee) : Number.MAX_SAFE_INTEGER;
  const priorRecords = orderFees(history || []).filter((h) => termKey(h) < feeKey);
  const arrearsLines = priorRecords
    .map((h) => ({
      academic_year: h.academic_year,
      term: h.term,
      amount: feeBalance(h),
    }))
    .filter((l) => l.amount > 0);
  const arrearsTotal = arrearsLines.reduce((s, l) => s + l.amount, 0);

  const debtBf = Number(fee?.debt || 0); // informational only (legacy b/f display)
  const paid = receipts && receipts.length
    ? receipts.reduce((s, r) => s + Number(r.amount || 0), 0)
    : Number(fee?.amount_paid || 0);
  const presentBalance = thisTermCharges - paid; // signed; negative = credit
  const arrearBf = arrearsTotal + Math.max(presentBalance, 0); // true balance carried forward
  const presentCredit = Math.max(-presentBalance, 0);

  /* --- Stage 2: next term fee structure ------------------------------- */
  // If the school has not set a fee structure for this class in the NEXT
  // year/term, we do NOT bill the next term at all (no fallback to the present
  // term's rate). The bill then only states the present term account.
  const hasNextStructure = !!(nextClassFee && Number(nextClassFee.fee_amount) > 0);
  const nextTermClassFee = hasNextStructure ? Number(nextClassFee.fee_amount) : 0;

  /* --- Stage 3: other bill items -------------------------------------- */
  // Other bill items (recurring + office-added) are next-term charges too, so
  // they are only included when the next term is actually being billed.
  const otherItems = hasNextStructure ? mergeBillItems(recurringItems, billItems) : [];
  const otherItemsTotal = otherItems.reduce((s, it) => s + it.amount, 0);

  /* --- Stages 4 & 5 ---------------------------------------------------- */
  const nextTermTotal = nextTermClassFee + otherItemsTotal;
  const subTotal = arrearBf + nextTermTotal;               // credit excluded here
  const amountDue = Math.max(subTotal - presentCredit, 0); // ...subtracted once here

  return {
    classFeeThisTerm,
    recurringItems,
    thisTermCharges,
    debtBf,
    paid,
    presentBalance,
    arrearBf,
    presentCredit,
    arrearsLines,
    arrearsTotal,
    hasNextStructure,
    nextTermClassFee,
    otherItems,
    otherItemsTotal,
    nextTermTotal,
    subTotal,
    amountDue,
  };
}

/** All fee records for one student in chronological order. */
export async function fetchStudentFeeHistory(schoolId, studentId) {
  if (!schoolId || !studentId) return [];
  const { data } = await supabase
    .from('fees')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId);
  return orderFees(data || []);
}
/**
 * Build one A4 staged termly fee bill page for a student.
 *
 * @param {object} p
 * @param {object} p.school      - { name, logoUrl, address, motto, phone }
 * @param {object} p.student     - application row (name fields, class, parent)
 * @param {object|null} p.fee    - `fees` row for the billed term
 * @param {Array}   p.receipts   - receipts for the billed term
 * @param {string}  p.year       - billed academic year, e.g. "2025/2026"
 * @param {string}  p.term       - "First" | "Second" | "Third"
 * @param {string|null} p.closingDate - term closing/vacation date
 * @param {string}  p.nextYear   - next term's academic year
 * @param {string}  p.nextTerm   - next term name
 * @param {object|null} p.nextClassFee - class_fees row for the NEXT term
 * @param {Array}   p.billItems  - one-off "other bill items" from the office
 * @param {boolean} p.lastPage   - suppress the trailing page break
 */
export function buildTermlyBillPage({
  school, student, fee, receipts = [], year, term, closingDate,
  nextYear, nextTerm, nextClassFee, billItems = [], history = [], lastPage = false,
}) {
  const stages = computeTermlyBillStages({ fee, receipts, nextClassFee, billItems, history });
  const {
    classFeeThisTerm, recurringItems, thisTermCharges, debtBf, paid, presentBalance,
    arrearBf, presentCredit, arrearsLines, arrearsTotal,
    hasNextStructure, nextTermClassFee,
    otherItems, otherItemsTotal, nextTermTotal, subTotal, amountDue,
  } = stages;

  const studentName = buildStudentName(student?.first_name, student?.middle_name, student?.last_name) || student?.student_id || 'Student';
  const logoHtml = school?.logoUrl ? `<img src="${esc(school.logoUrl)}" alt="logo" class="bill-logo" />` : '';
  const closingHtml = closingDate
    ? `<div class="bill-closing">CLOSING DATE: <b>${esc(formatDate(closingDate))}</b></div>`
    : '';
  const parentLine = student?.parent_name
    ? `<strong>Parent / Guardian:</strong> ${esc(student.parent_name)}${student?.parent_contact ? ` &nbsp;|&nbsp; <strong>Contact:</strong> ${esc(student.parent_contact)}` : ''}`
    : '';
  const billNo = `BILL-${String(year).replace(/\//g, '')}-${term.slice(0, 1).toUpperCase()}-${esc(student?.student_id || '000')}`;

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

  /* ---------- Stage 1 : arrears + present term account ---------- */
  const arrearsRows = arrearsLines.length
    ? arrearsLines
        .map(
          (l) =>
            `<tr><td>Balance carried forward — ${esc(l.term)} Term ${esc(l.academic_year)}</td><td class="right">${money(l.amount)}</td></tr>`
        )
        .join('')
    : debtBf > 0
      ? `<tr><td>Debt brought forward (b/f)</td><td class="right">${money(debtBf)}</td></tr>`
      : '';
  const stage1 = `
    <table class="bill-table">
      <thead><tr><th style="width:70%;">Description</th><th class="right" style="width:30%;">Amount (GHC)</th></tr></thead>
      <tbody>
        ${arrearsRows}
        ${arrearsLines.length > 1 ? `<tr class="bill-subrow"><td><b>Total arrears carried forward</b></td><td class="right"><b>${money(arrearsTotal)}</b></td></tr>` : ''}
        <tr><td>${esc(term)} Term class fee — ${esc(student?.class_applying || 'Class fee')}</td><td class="right">${money(classFeeThisTerm)}</td></tr>
        ${recurringItems.map((it) => `<tr><td>&nbsp;&nbsp;${esc(it.name)}</td><td class="right">${money(it.amount)}</td></tr>`).join('')}
        <tr class="bill-subrow"><td><b>Total charges — ${esc(term)} Term ${esc(year)}</b></td><td class="right"><b>${money(thisTermCharges)}</b></td></tr>
        <tr><td>LESS: Payments received this term</td><td class="right">${money(paid)}</td></tr>
        ${
          arrearBf > 0
            ? `<tr class="bill-band bill-due-band"><td><b>BALANCE CARRIED FORWARD — OWED</b></td><td class="right"><b>${money(arrearBf)}</b></td></tr>`
            : (arrearBf === 0 && presentBalance < 0)
              ? `<tr class="bill-band bill-credit-band"><td><b>PRESENT TERM BALANCE — CREDIT</b></td><td class="right"><b>${money(presentCredit)}</b></td></tr>`
              : `<tr class="bill-band bill-zero-band"><td><b>BALANCE CARRIED FORWARD</b></td><td class="right"><b>${money(arrearBf)}</b></td></tr>`
        }
      </tbody>
    </table>`;

  /* ---------- Stage 1b : itemised payments ---------- */
  const stage1b = `
    <table class="bill-table">
      <thead><tr><th>Date</th><th>Receipt No.</th><th>Method</th><th class="right">Amount</th></tr></thead>
      <tbody>${paymentRows}</tbody>
      <tfoot>
        <tr class="bill-subrow">
          <td colspan="3"><b>Total paid this term</b></td>
          <td class="right"><b>${money(paid)}</b></td>
        </tr>
      </tfoot>
    </table>`;
  /* ---------- Stage 2 : next term fee structure ---------- */
  const stage2 = `
    <table class="bill-table">
      <thead><tr><th style="width:70%;">Fee structure — ${esc(nextTerm)} Term ${esc(nextYear)}</th><th class="right" style="width:30%;">Amount (GHC)</th></tr></thead>
      <tbody>
        ${
          hasNextStructure
            ? `<tr><td>${esc(nextTerm)} Term class fee — ${esc(student?.class_applying || 'Class fee')}</td><td class="right">${money(nextTermClassFee)}</td></tr>
        <tr class="bill-subrow"><td><b>Next term fee structure subtotal</b></td><td class="right"><b>${money(nextTermClassFee)}</b></td></tr>`
            : '<tr><td colspan="2" class="bill-muted">Fee structure for this class has not been set yet — next term fees are <b>not included</b> in this bill.</td></tr>'
        }
      </tbody>
    </table>`;

  /* ---------- Stage 3 : other bill items ---------- */
  const otherItemRows = !hasNextStructure
    ? '<tr><td colspan="2" class="bill-muted">Next term not billed — no fee structure has been set for this class yet.</td></tr>'
    : otherItems.length
      ? otherItems
          .map((it, i) => `<tr><td>${i + 1}. ${esc(it.name)}</td><td class="right">${money(it.amount)}</td></tr>`)
          .join('')
      : '<tr><td colspan="2" class="bill-muted">No other bill items — next term consists of the class fee above.</td></tr>';

  const stage3 = `
    <table class="bill-table">
      <thead><tr><th style="width:70%;">Other bill items — ${esc(nextTerm)} Term ${esc(nextYear)}</th><th class="right" style="width:30%;">Amount (GHC)</th></tr></thead>
      <tbody>
        ${otherItemRows}
        ${hasNextStructure ? `<tr class="bill-subrow"><td><b>Other bill items subtotal</b></td><td class="right"><b>${money(otherItemsTotal)}</b></td></tr>` : ''}
      </tbody>
    </table>`;

  /* ---------- Stages 4 & 5 : sub-total & amount due ---------- */
  const amountCell = amountDue > 0
    ? `<b class="bill-due">${money(amountDue)}</b>`
    : `<b class="bill-credit">${money(0)}</b>`;

  const stage45 = `
    <table class="bill-table bill-summary">
      <tbody>
        ${
          arrearBf > 0
            ? `<tr><td>Balance carried forward — ${esc(term)} Term</td><td class="right">${money(arrearBf)}</td></tr>`
            : ''
        }
        ${
          hasNextStructure
            ? `<tr><td>Next term class fee — ${esc(nextTerm)} Term</td><td class="right">${money(nextTermClassFee)}</td></tr>
        ${otherItemsTotal > 0 ? `<tr><td>Other bill items — next term</td><td class="right">${money(otherItemsTotal)}</td></tr>` : ''}`
            : '<tr><td colspan="2" class="bill-muted">Next term fees not yet published — only the present term balance applies.</td></tr>'
        }
        <tr class="bill-subrow"><td><b>SUBTOTAL</b></td><td class="right"><b>${money(subTotal)}</b></td></tr>
        ${
          presentCredit > 0
            ? `<tr class="bill-creditrow"><td>LESS: Present-term credit applied ${presentBalance < 0 ? `(overpaid ${esc(term)} Term)` : ''}</td><td class="right bill-credit">(${money(presentCredit)})</td></tr>`
            : ''
        }
        <tr class="bill-amount">
          <td><b>AMOUNT DUE FOR NEXT TERM</b><br/><span class="bill-muted bill-amt-sub">${esc(nextTerm)} Term ${esc(nextYear)}</span></td>
          <td class="right">${amountCell}</td>
        </tr>
      </tbody>
    </table>`;

  /* ---------- Note to parent ---------- */
  const notice = !hasNextStructure
    ? amountDue > 0
      ? `The fee structure for ${esc(nextTerm)} Term ${esc(nextYear)} has not been set yet, so next term fees are <b>not included</b> in this bill. Please settle the outstanding ${esc(term)} Term balance of <b>${money(amountDue)}</b>${closingDate ? ` before the term closes on ${esc(formatDate(closingDate))}` : ''}. Thank you.`
      : `The fee structure for ${esc(nextTerm)} Term ${esc(nextYear)} has not been set yet, so next term fees are <b>not included</b> in this bill. Your ward's ${esc(term)} Term balance is fully settled; you will be notified once the next term fees are published.`
    : amountDue > 0
      ? `Your ward's fees for ${esc(nextTerm)} Term ${esc(nextYear)} come to <b>${money(amountDue)}</b>. `
        + (arrearBf > 0 ? `This includes the outstanding ${esc(term)} Term balance of <b>${money(arrearBf)}</b>. ` : '')
        + (presentCredit > 0 ? `A credit of <b>${money(presentCredit)}</b> from ${esc(term)} Term has been applied. ` : '')
        + (closingDate ? `Kindly pay before the school reopens on ${esc(formatDate(closingDate))} to secure your ward's place. ` : `Kindly pay at the school's accounts office before ${esc(nextTerm)} Term begins. `)
        + 'Thank you for your continued support.'
      : presentCredit > 0
        ? `Your ward's ${esc(nextTerm)} Term ${esc(nextYear)} fees of <b>${money(nextTermTotal)}</b> are fully covered by the existing credit of <b>${money(presentCredit)}</b>. Thank you for your timely payment.`
        : `Your ward's fees are fully settled for ${esc(term)} Term, and no amount is due for ${esc(nextTerm)} Term ${esc(nextYear)}. Thank you for your support.`;
  return `<div class="bill-page" style="${lastPage ? '' : 'page-break-after: always;'}" data-student="${esc(student?.student_id || '')}">
    <div class="bill-head">
      ${logoHtml}
      <div style="flex:1;text-align:center;">
        <div class="bill-school">${esc(school?.name || 'School')}</div>
        ${school?.address ? `<div class="bill-sub">${esc(school.address)}</div>` : ''}
        ${school?.motto ? `<div class="bill-sub bill-motto">${esc(school.motto)}</div>` : ''}
        <div class="bill-title">TERMLY FEE BILL — STAGED STATEMENT</div>
        <div class="bill-sub">${esc(term)} Term ${esc(year)} &nbsp;·&nbsp; ${esc(nextTerm)} Term ${esc(nextYear)} &nbsp;·&nbsp; ${billNo}</div>
      </div>
    </div>
    ${closingHtml}

    <div class="bill-student">
      <strong>Student:</strong> ${esc(studentName)} &nbsp;|&nbsp; <strong>ID:</strong> <span style="font-family:monospace;">${esc(student?.student_id || '—')}</span> &nbsp;|&nbsp; <strong>Class:</strong> ${esc(student?.class_applying || '—')}<br/>
      ${parentLine}
    </div>

    <div class="bill-stage">STAGE 1 · PRESENT TERM ACCOUNT — ${esc(term)} TERM ${esc(year)}</div>
    ${stage1}
    ${stage1b}

    <div class="bill-stage">STAGE 2 · NEXT TERM FEE STRUCTURE</div>
    ${stage2}

    <div class="bill-stage">STAGE 3 · OTHER BILL ITEMS FOR NEXT TERM</div>
    ${stage3}

    <div class="bill-stage">STAGES 4 &amp; 5 · SUB-TOTAL &amp; AMOUNT DUE FOR NEXT TERM</div>
    ${stage45}

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
  .bill-page { width: 190mm; min-height: 265mm; margin: 0 auto; font-family: Arial, 'Segoe UI', sans-serif; color: #111; font-size: 10.5px; }
  .bill-head { display: flex; align-items: center; gap: 10px; border-bottom: 3px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 8px; }
  .bill-logo { height: 56px; width: 56px; object-fit: contain; }
  .bill-school { font-size: 16px; font-weight: 800; color: #1e3a5f; }
  .bill-title { font-size: 12.5px; font-weight: 800; letter-spacing: 1.2px; color: #1e3a5f; margin-top: 2px; }
  .bill-sub { font-size: 10px; color: #475569; }
  .bill-motto { font-style: italic; }
  .bill-muted { color: #64748b; font-style: italic; }
  .bill-amt-sub { font-size: 8.5px; font-weight: 400; }
  .bill-closing { text-align: center; font-size: 11px; background: #f0f4f9; border: 1px solid #1e3a5f; color: #1e3a5f; border-radius: 6px; padding: 4px 6px; margin-bottom: 8px; }
  .bill-student { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; line-height: 1.55; margin-bottom: 8px; }
  .bill-stage { font-size: 9.5px; font-weight: 800; letter-spacing: 1px; color: #fff; background: #1e3a5f; border-radius: 4px; padding: 3px 7px; margin: 7px 0 3px; }
  .bill-table { width: 100%; border-collapse: collapse; margin: 2px 0 4px; }
  .bill-table th, .bill-table td { border: 1px solid #94a3b8; padding: 3px 6px; font-size: 10px; }
  .bill-table th { background: #eef2f7; color: #1e3a5f; text-align: left; }
  .bill-subrow td { background: #f1f5f9; }
  .bill-band td { font-size: 10.5px; }
  .bill-due-band td { background: #fef2f2; color: #b91c1c; }
  .bill-credit-band td { background: #f0fdf4; color: #15803d; }
  .bill-zero-band td { background: #f8fafc; color: #334155; }
  .bill-credit { color: #15803d; font-weight: 800; }
  .bill-creditrow td { background: #f0fdf4; }
  .bill-due { color: #b91c1c; font-weight: 800; }
  .bill-amount td { background: #1e3a5f; color: #fff; font-size: 12px; padding: 7px 8px; }
  .bill-amount .right b { font-size: 14px; }
  .bill-note { border: 1px solid #d97706; background: #fffbeb; color: #78350f; border-radius: 6px; padding: 7px 9px; margin-top: 7px; line-height: 1.5; }
  .bill-sig { display: flex; justify-content: space-between; margin-top: 24px; font-size: 10px; color: #475569; }
  .bill-foot { margin-top: 8px; font-size: 9.5px; color: #64748b; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 6px; }
  .right { text-align: right; }
  @media print {
    .bill-page { width: 190mm; margin: 0; }
    @page { size: A4 portrait; margin: 8mm; }
  }
`;
/**
 * Fast, lightweight preview of a staged bill run — used by the print dialog to
 * show staged totals ("3 bills · GHC 1,620 due next term") before printing.
 *
 * Receipts are not fetched here; the present-term balance uses the fee
 * record's `amount_paid`, which is kept in sync by every payment.
 *
 * @returns {Promise<object|null>} { count, presentBalance, nextTermTotal,
 *   subTotal, amountDue, nextYear, nextTerm }
 */
export async function previewTermlyBills({ schoolId, students = [], year, term, billItems = [] }) {
  const list = (students || []).filter(Boolean);
  if (!list.length || !year || !term) return null;

  const next = nextTermOf(year, term);
  const ids = list.map((s) => s.student_id);
  const classNames = [...new Set(list.map((s) => s.class_applying).filter(Boolean))];

  const [{ data: fees }, feeRows] = await Promise.all([
    // All fee records for the selected students (every year/term) so each bill
    // can itemise the true term-by-term arrears carried forward.
    supabase
      .from('fees')
      .select('*')
      .eq('school_id', schoolId)
      .in('student_id', ids),
    classNames.length
      ? supabase
          .from('class_fees')
          .select('*')
          .eq('school_id', schoolId)
          .eq('academic_year', next.year)
          .eq('term', next.term)
          .in('class_name', classNames)
      : Promise.resolve({ data: [] }),
  ]);

  const historyByStudent = {};
  (fees || []).forEach((f) => {
    (historyByStudent[f.student_id] = historyByStudent[f.student_id] || []).push(f);
  });
  const feeByClass = {};
  (feeRows?.data || []).forEach((cf) => {
    feeByClass[cf.class_name] = cf;
  });

  let presentBalance = 0;
  let arrearsTotal = 0;
  let nextTermTotal = 0;
  let subTotal = 0;
  let amountDue = 0;
  list.forEach((student) => {
    const history = historyByStudent[student.student_id] || [];
    const fee = history.find((h) => h.academic_year === year && h.term === term) || null;
    const stages = computeTermlyBillStages({
      fee,
      receipts: [],
      nextClassFee: feeByClass[student.class_applying] || null,
      billItems,
      history,
    });
    presentBalance += stages.presentBalance;
    arrearsTotal += stages.arrearsTotal;
    nextTermTotal += stages.nextTermTotal;
    subTotal += stages.subTotal;
    amountDue += stages.amountDue;
  });

  return {
    count: list.length,
    presentBalance,
    arrearsTotal,
    nextTermTotal,
    subTotal,
    amountDue,
    nextYear: next.year,
    nextTerm: next.term,
  };
}

/**
 * Print staged termly fee bills for one or many students in a single print
 * window (one A4 page per student, in the order given).
 *
 * @param {object} p
 * @param {string} p.schoolId
 * @param {Array}  p.students   - application rows
 * @param {string} p.year       - academic year, e.g. "2025/2026"
 * @param {string} p.term       - "First" | "Second" | "Third"
 * @param {string|null} p.closingDate - term closing/vacation date
 * @param {Array}  p.billItems  - one-off "other bill items" added by the office
 * @returns {Promise<number>} number of bills printed
 */
export async function printTermlyBills({ schoolId, students = [], year, term, closingDate, billItems = [] }) {
  const list = (students || []).filter(Boolean);
  if (!list.length || !year || !term) return 0;

  const school = await fetchSchoolPrintInfo(schoolId);
  const closing = closingDate || (await fetchTermClosingDate(schoolId, year, term));

  const pages = [];
  const next = nextTermOf(year, term);
  for (let i = 0; i < list.length; i += 1) {
    const student = list[i];
    const [history, receipts, nextClassFee] = await Promise.all([
      fetchStudentFeeHistory(schoolId, student.student_id),
      fetchTermReceipts(schoolId, student.student_id, year, term),
      fetchClassFee(schoolId, student.class_applying, next.year, next.term),
    ]);
    const fee = (history || []).find((h) => h.academic_year === year && h.term === term) || null;
    pages.push(
      buildTermlyBillPage({
        school,
        student,
        fee,
        history,
        receipts,
        year,
        term,
        closingDate: closing,
        nextYear: next.year,
        nextTerm: next.term,
        nextClassFee,
        billItems,
        lastPage: i === list.length - 1,
      })
    );
  }

  openPrintWindow(
    `Staged Termly Fee Bills — ${school.name} ${term} Term ${year}`,
    `<style>${BILL_CSS}</style>${pages.join('')}`
  );
  return pages.length;
}






