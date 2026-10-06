/**
 * feeMath.js - Pure helpers for the school-fee ledger.
 *
 * Single source of truth for how a student's fee liability is computed:
 *
 *   RECORD BALANCE  = total_amount − amount_paid   (per term record)
 *
 * The `fees.debt` column is treated as INFORMATIONAL ONLY ("balance brought
 * forward" at the time the record was created). It is never summed into
 * liabilities — the genuine arrears live in the earlier term RECORDS, so adding
 * `debt` as well would double-count the same money across a chain of terms.
 * This exactly mirrors the database's generated `fees.balance` column.
 *
 * Payments are WATERFALLED across terms oldest-first: every payment settles the
 * oldest outstanding term balance before touching a newer one. That way a
 * payment in Second Term clears a First Term arrears first, and the next bill
 * only shows the remaining arrears itemised per term.
 */
export const TERM_ORDER = { First: 1, Second: 2, Third: 3 };

export const TERM_NAMES = ['First', 'Second', 'Third'];

/** Numeric start of an academic year, e.g. "2026/2027" -> 2026. */
export function yearStart(year) {
  return Number(String(year || '').split('/')[0] || 0);
}

/** Chronological key for one fee record (smaller = older). */
export function termKey(f) {
  return f ? yearStart(f.academic_year) * 10 + (TERM_ORDER[f.term] || 0) : 0;
}

/** Sort fee records oldest → newest. */
export function orderFees(fees = []) {
  return [...(fees || [])].filter(Boolean).sort((a, b) => termKey(a) - termKey(b));
}

/** Outstanding balance of one term record (never negative). */
export function feeBalance(f) {
  return Math.max((Number(f?.total_amount) || 0) - (Number(f?.amount_paid) || 0), 0);
}

/** Credit (overpayment) inside one term record (never negative). */
export function feeCredit(f) {
  return Math.max((Number(f?.amount_paid) || 0) - (Number(f?.total_amount) || 0), 0);
}

/** Total outstanding across all records, without double-counting debt. */
export function totalOutstanding(fees = []) {
  return orderFees(fees).reduce((s, f) => s + feeBalance(f), 0);
}

/**
 * Waterfall a payment across fee records oldest-first.
 * Returns { allocations, remaining } where each allocation is
 * { fee_id, academic_year, term, amount } in the order the money was applied.
 */
export function waterfallAllocations(ordered, amount) {
  let remaining = Math.max(Number(amount) || 0, 0);
  const allocations = [];
  for (const f of orderFees(ordered)) {
    if (remaining <= 0) break;
    const bal = feeBalance(f);
    if (bal <= 0) continue;
    const take = Math.min(remaining, bal);
    allocations.push({
      fee_id: f.id,
      academic_year: f.academic_year,
      term: f.term,
      amount: Math.round((Number(take) + Number.EPSILON) * 100) / 100,
    });
    remaining -= take;
  }
  return { allocations, remaining: Math.max(Math.round((Number(remaining) + Number.EPSILON) * 100) / 100, 0) };
}

/** Status of a single record from its numbers (total − paid). */
export function feeStatusOf(f) {
  const bal = feeBalance(f);
  if (bal <= 0) return 'paid';
  return Number(f?.amount_paid || 0) > 0 ? 'partial' : 'unpaid';
}

/** Aggregated status across all of a student's records. 'none' when no records. */
export function studentFeeStatus(fees = []) {
  const list = orderFees(fees);
  if (!list.length) return 'none';
  const outstanding = list.some((f) => feeBalance(f) > 0);
  const anyPayment = list.some((f) => Number(f.amount_paid || 0) > 0);
  if (!outstanding) return 'paid';
  return anyPayment ? 'partial' : 'unpaid';
}

/** Format a number to locked 2-decimal cents. */
export function toCents(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}