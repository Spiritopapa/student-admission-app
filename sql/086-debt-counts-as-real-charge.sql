-- ============================================================
--  MIGRATION 086: fees.debt IS A REAL CHARGE (counts in balances)
-- ============================================================
--  PROBLEM
--  The admin "Edit Fees" screen lets the admin add a DEBT amount to a
--  student's fee record, but since migration 083 every balance engine
--  (process_fee_payment, feeMath.js, dashboards, termly bills) treated
--  `fees.debt` as informational only — so the debt NEVER added up to
--  the outstanding fees and could not be collected.
--
--  FIX (new invariant)
--    RECORD BALANCE = total_amount + debt − amount_paid
--  `debt` is a REAL extra charge on that record and is part of what the
--  student owes. To guarantee every cedi is counted exactly once:
--    * promote_student_fees no longer writes the carried arrears into the
--      new record's `debt` (the arrears already live on the old records) —
--      new records are inserted with debt = 0, and re-runs never overwrite
--      an admin-entered debt.
--    * ALL existing debt values are zeroed below, so balances are EXACTLY
--      the same right before and after this migration (debt was excluded
--      from every balance until now) while carried "duplicate" values
--      created by the old carry-forward are removed.
--
--  ⚠️ If an admin had manually entered `debt` values BEFORE this
--  migration, re-enter them AFTER running it — they now really count.
--
--  Also includes the migration-085 locking fix (PERFORM ... FOR UPDATE
--  instead of FOR UPDATE on the aggregate SUM query).
--
--  ⚠️ SUPERSEDED (process_fee_payment ONLY): migration 087 re-adds
--  processed_by / processed_by_label to the receipt snapshot (dropped
--  by the 083 waterfall rewrite) and backfills existing receipts.
--  The live function definition lives in 087; the debt / balance
--  changes below remain the current behaviour.
--
--  Safe to re-run (idempotent).
-- ============================================================

-- 1. Zero legacy debt: balances stay exactly as they were before this
--    migration (debt was excluded everywhere), and carried duplicates
--    created by the old promote_student_fees disappear.
UPDATE public.fees SET debt = 0 WHERE debt <> 0;

-- 2. The generated `balance` column must follow the new rule.
ALTER TABLE public.fees DROP COLUMN balance;
ALTER TABLE public.fees ADD COLUMN balance NUMERIC(12,2)
  GENERATED ALWAYS AS (total_amount + debt - amount_paid) STORED;

-- ============================================================
--  3. process_fee_payment — FIFO waterfall, debt counted once
-- ============================================================
DROP FUNCTION IF EXISTS public.process_fee_payment(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.process_fee_payment(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.process_fee_payment(
  p_student_id TEXT,
  p_academic_year TEXT,
  p_term TEXT,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_recorded_by UUID DEFAULT NULL,
  p_school_id UUID DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_outstanding NUMERIC(12,2);
  v_remaining_amount NUMERIC(12,2);
  v_applied NUMERIC(12,2);
  v_prior_term_applied NUMERIC(12,2);
  v_selected_term_applied NUMERIC(12,2);
  v_allocations JSONB := '[]'::jsonb;
  v_target_total NUMERIC(12,2);
  v_target_debt NUMERIC(12,2);
  v_target_paid NUMERIC(12,2);
  v_rec RECORD;
  v_take NUMERIC(12,2);
  v_transaction_id UUID;
  v_receipt_number TEXT;
  v_receipt_id UUID;
  v_student_name TEXT;
  v_class_name TEXT;
  v_school_name TEXT;
  v_processor_name TEXT;
  v_processor_role TEXT;
  v_processor_label TEXT;
  v_pay_date TIMESTAMPTZ;
  v_effective_school_id UUID;
BEGIN
  v_pay_date := COALESCE(p_payment_date, now());

  -- SECURITY: resolve the student's school and require the caller to be staff
  -- of that school; never trust a passed school_id that differs.
  SELECT a.school_id INTO v_effective_school_id
  FROM public.applications a WHERE a.student_id = p_student_id;

  IF v_effective_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_effective_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to process payment for this student');
  END IF;

  p_school_id := v_effective_school_id;

  -- Guard: the selected term must already have a fee record.
  PERFORM 1 FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year AND term = p_term
    AND (p_school_id IS NULL OR school_id = p_school_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No fee record found for this student, academic year, and term. Fee records must be created via the Fee Structure section first.'
    );
  END IF;

  -- Selected-term snapshot for the receipt (display only).
  SELECT total_amount, debt, amount_paid
  INTO v_target_total, v_target_debt, v_target_paid
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year AND term = p_term
    AND (p_school_id IS NULL OR school_id = p_school_id);

  -- Lock every fee row for this student BEFORE computing the outstanding
  -- total. PostgreSQL rejects FOR UPDATE on a query that also uses
  -- aggregates ("FOR UPDATE is not allowed with aggregate functions"), so
  -- the row lock and the SUM have to be two separate statements.
  PERFORM 1 FROM public.fees
  WHERE student_id = p_student_id AND (p_school_id IS NULL OR school_id = p_school_id)
  FOR UPDATE;

  -- Total outstanding across EVERY term: total + debt − paid. Admin-added
  -- `debt` is a real charge on its own record, counted exactly once.
  SELECT COALESCE(SUM(GREATEST(total_amount + debt - amount_paid, 0)), 0)
  INTO v_total_outstanding
  FROM public.fees
  WHERE student_id = p_student_id AND (p_school_id IS NULL OR school_id = p_school_id);

  IF v_total_outstanding <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student has no outstanding fee balance.');
  END IF;

  -- Cap at the total outstanding balance (no overpayment).
  v_remaining_amount := LEAST(COALESCE(p_amount, 0), v_total_outstanding);
  v_applied := 0;
  v_prior_term_applied := 0;
  v_selected_term_applied := 0;

  -- WATERFALL: settle the OLDEST outstanding term first.
  FOR v_rec IN
    SELECT f.id, f.academic_year, f.term, f.total_amount, f.debt, f.amount_paid
    FROM public.fees f
    WHERE f.student_id = p_student_id AND (p_school_id IS NULL OR f.school_id = p_school_id)
    ORDER BY (split_part(f.academic_year, '/', 1))::int ASC,
             CASE f.term WHEN 'First' THEN 1 WHEN 'Second' THEN 2 ELSE 3 END ASC
    FOR UPDATE OF f
  LOOP
    EXIT WHEN v_remaining_amount <= 0;
    IF (COALESCE(v_rec.total_amount, 0) + COALESCE(v_rec.debt, 0) - COALESCE(v_rec.amount_paid, 0)) > 0 THEN
      v_take := LEAST(
        v_remaining_amount,
        COALESCE(v_rec.total_amount, 0) + COALESCE(v_rec.debt, 0) - COALESCE(v_rec.amount_paid, 0)
      );
      UPDATE public.fees
      SET amount_paid = amount_paid + v_take,
          payment_status = CASE
            WHEN ((total_amount + debt) - (amount_paid + v_take)) <= 0 THEN 'paid'
            WHEN (amount_paid + v_take) > 0 THEN 'partial'
            ELSE 'unpaid'
          END,
          last_payment_date = v_pay_date,
          updated_at = now()
      WHERE id = v_rec.id;

      v_remaining_amount := v_remaining_amount - v_take;
      v_applied := v_applied + v_take;
      IF (v_rec.academic_year <> p_academic_year OR v_rec.term <> p_term) THEN
        v_prior_term_applied := v_prior_term_applied + v_take;
      ELSE
        v_selected_term_applied := v_selected_term_applied + v_take;
      END IF;
      v_allocations := v_allocations || jsonb_build_object(
        'fee_id', v_rec.id,
        'academic_year', v_rec.academic_year,
        'term', v_rec.term,
        'amount', v_take
      );
    END IF;
  END LOOP;

  -- Transaction (recorded against the selected term chosen by the clerk).
  INSERT INTO public.payment_transactions (
    student_id, academic_year, term, amount_paid,
    payment_method, payment_date, reference_number, notes,
    recorded_by, school_id
  ) VALUES (
    p_student_id, p_academic_year, p_term, v_applied,
    p_payment_method, v_pay_date, p_reference_number, p_notes,
    p_recorded_by, p_school_id
  ) RETURNING id INTO v_transaction_id;

  -- Allocation ledger: exactly which fee records this payment settled.
  INSERT INTO public.fee_payment_allocations (
    transaction_id, fee_id, student_id, school_id, academic_year, term, amount
  )
  SELECT v_transaction_id, (a->>'fee_id')::uuid, p_student_id, p_school_id,
         a->>'academic_year', a->>'term', (a->>'amount')::numeric
  FROM jsonb_array_elements(v_allocations) a;

  -- Processor label for the receipt.
  IF p_recorded_by IS NOT NULL THEN
    SELECT full_name, role INTO v_processor_name, v_processor_role
    FROM public.profiles WHERE id = p_recorded_by;

    v_processor_label := CASE
      WHEN v_processor_role IN ('super_admin', 'school', 'sub_admin') THEN 'Admin'
      WHEN v_processor_role = 'accountant' THEN 'Accountant'
      WHEN v_processor_role IS NOT NULL THEN INITCAP(v_processor_role)
      ELSE 'Staff'
    END;
  END IF;

  -- Per-school receipt series.
  v_receipt_number := public.generate_receipt_number(p_school_id);

  SELECT CONCAT(a.first_name, ' ', COALESCE(a.middle_name || ' ', ''), a.last_name), a.class_applying
  INTO v_student_name, v_class_name
  FROM public.applications a WHERE a.student_id = p_student_id;

  SELECT COALESCE(s.name, 'School') INTO v_school_name FROM public.schools s WHERE s.id = p_school_id;

  INSERT INTO public.receipts (
    receipt_number, transaction_id, student_id,
    academic_year, term, amount, payment_method,
    receipt_date, receipt_data, school_id
  ) VALUES (
    v_receipt_number, v_transaction_id, p_student_id,
    p_academic_year, p_term, v_applied, p_payment_method,
    v_pay_date,
    jsonb_build_object(
      'student_name', v_student_name,
      'class', v_class_name,
      'school_name', v_school_name,
      'total_fees', COALESCE(v_target_total, 0),
      'debt', COALESCE(v_target_debt, 0),
      'total_due', COALESCE(v_target_total, 0) + COALESCE(v_target_debt, 0),
      'amount_paid_before', COALESCE(v_target_paid, 0),
      'amount_now', v_applied,
      'total_paid', COALESCE(v_target_paid, 0) + v_selected_term_applied,
      'remaining_balance', GREATEST(v_total_outstanding - v_applied, 0),
      'settled_arrears', v_prior_term_applied,
      'allocations', v_allocations
    ),
    p_school_id
  ) RETURNING id INTO v_receipt_id;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_number', v_receipt_number,
    'receipt_id', v_receipt_id,
    'transaction_id', v_transaction_id,
    'student_id', p_student_id,
    'student_name', v_student_name,
    'academic_year', p_academic_year,
    'term', p_term,
    'amount_paid', v_applied,
    'total_paid', v_applied,
    'overpaid_amount', 0,
    'remaining_balance', GREATEST(v_total_outstanding - v_applied, 0),
    'allocated_to_arrears', v_prior_term_applied,
    'allocations', v_allocations
  );
END;
$$;

-- ============================================================
--  4. promote_student_fees — arrears stay on the old records
--     (the new record is created with debt = 0; writing the carry
--      into `debt` as well would double-count it now that debt is
--      part of every balance).
-- ============================================================
DROP FUNCTION IF EXISTS public.promote_student_fees(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.promote_student_fees(
  p_student_id TEXT,
  p_current_academic_year TEXT,
  p_current_term TEXT,
  p_new_class_name TEXT,
  p_new_academic_year TEXT,
  p_new_term TEXT,
  p_new_fee_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_carry NUMERIC(12,2);
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to promote fees for this student');
  END IF;

  -- TRUE cumulative arrears across ALL existing terms (record-balance basis).
  SELECT COALESCE(SUM(GREATEST(total_amount + debt - amount_paid, 0)), 0)
  INTO v_total_carry
  FROM public.fees WHERE student_id = p_student_id AND school_id = v_school_id;

  INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, payment_status, school_id)
  SELECT p_student_id, p_new_academic_year, p_new_term, p_new_fee_amount, 0, 0,
         CASE WHEN COALESCE(p_new_fee_amount, 0) > 0 THEN 'unpaid' ELSE 'paid' END,
         v_school_id
  FROM public.applications WHERE student_id = p_student_id AND school_id = v_school_id
  ON CONFLICT (student_id, academic_year, term)
  DO UPDATE SET
    total_amount = EXCLUDED.total_amount,
    payment_status = CASE
      WHEN COALESCE(EXCLUDED.total_amount, 0) + COALESCE(debt, 0) - amount_paid <= 0 THEN 'paid'
      WHEN amount_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END,
    updated_at = now();
    -- `debt` is deliberately NOT touched: a debt entered by the admin on an
    -- existing record must survive re-runs of the carry forward.

  RETURN jsonb_build_object(
    'success', true,
    'carried_balance', COALESCE(v_total_carry, 0),
    'new_total', COALESCE(p_new_fee_amount, 0) + COALESCE(v_total_carry, 0)
  );
END;
$$;

-- ============================================================
--  5. delete_receipt — reverse the FIFO waterfall precisely
--     (status recomputed on the total + debt − paid basis)
-- ============================================================
DROP FUNCTION IF EXISTS public.delete_receipt(UUID);

CREATE OR REPLACE FUNCTION public.delete_receipt(p_receipt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_alloc RECORD;
  v_reversed NUMERIC(12,2) := 0;
  v_fee_recreated BOOLEAN := false;
BEGIN
  SELECT r.* INTO v_receipt
  FROM public.receipts r WHERE r.id = p_receipt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;

  -- Reverse every allocation this transaction made (FIFO waterfall).
  FOR v_alloc IN
    SELECT a.fee_id, a.amount
    FROM public.fee_payment_allocations a
    WHERE a.transaction_id = v_receipt.transaction_id
    ORDER BY a.created_at ASC
  LOOP
    IF v_alloc.fee_id IS NOT NULL AND v_alloc.amount > 0 THEN
      UPDATE public.fees
      SET amount_paid = GREATEST(amount_paid - v_alloc.amount, 0),
          payment_status = CASE
            WHEN ((total_amount + debt) - GREATEST(amount_paid - v_alloc.amount, 0)) <= 0 THEN 'paid'
            WHEN GREATEST(amount_paid - v_alloc.amount, 0) > 0 THEN 'partial'
            ELSE 'unpaid'
          END,
          updated_at = now()
      WHERE id = v_alloc.fee_id;
      v_reversed := v_reversed + v_alloc.amount;
    END IF;
  END LOOP;

  -- Legacy receipts (pre-allocation ledger): reverse from their own term record.
  IF v_reversed = 0 AND COALESCE(v_receipt.amount, 0) > 0 THEN
    UPDATE public.fees
    SET amount_paid = GREATEST(amount_paid - v_receipt.amount, 0),
        payment_status = CASE
          WHEN ((total_amount + debt) - GREATEST(amount_paid - v_receipt.amount, 0)) <= 0 THEN 'paid'
          WHEN GREATEST(amount_paid - v_receipt.amount, 0) > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE student_id = v_receipt.student_id
      AND academic_year = v_receipt.academic_year
      AND term = v_receipt.term
      AND (v_receipt.school_id IS NULL OR school_id = v_receipt.school_id);
    IF FOUND THEN
      v_reversed := v_reversed + v_receipt.amount;
    ELSE
      v_fee_recreated := true;
    END IF;
  END IF;

  -- Remove the receipt and its transaction (FK cascade cleans allocations).
  DELETE FROM public.receipts WHERE id = v_receipt.id;
  IF v_receipt.transaction_id IS NOT NULL THEN
    DELETE FROM public.payment_transactions WHERE id = v_receipt.transaction_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_number', v_receipt.receipt_number,
    'student_id', v_receipt.student_id,
    'amount', v_receipt.amount,
    'reversed_amount', v_reversed,
    'fee_record_created', v_fee_recreated
  );
END;
$$;
