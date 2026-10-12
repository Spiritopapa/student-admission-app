-- ============================================================
--  MIGRATION 085: FIX process_fee_payment
--  "FOR UPDATE is not allowed with aggregate functions"
-- ============================================================
--  Migration 083 (FIFO waterfall) computed the student's total
--  outstanding balance with SUM() in the SAME statement as FOR UPDATE:
--
--    SELECT COALESCE(SUM(...), 0) ... FROM fees ... FOR UPDATE;
--
--  PostgreSQL forbids row locking on aggregate queries, so EVERY fee
--  payment failed at runtime with:
--
--    FOR UPDATE is not allowed with aggregate functions
--
--  Fix: lock the fee rows first (PERFORM ... FOR UPDATE), then compute
--  the SUM in a plain statement. The lock intent is unchanged - all of
--  the student's fee rows are still locked for the whole transaction,
--  so concurrent payments for the same student still serialize.
--
--  Safe to re-run (idempotent).
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

  -- Total outstanding across EVERY term on the record-balance basis.
  SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0)
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
    SELECT f.id, f.academic_year, f.term, f.total_amount, f.amount_paid
    FROM public.fees f
    WHERE f.student_id = p_student_id AND (p_school_id IS NULL OR f.school_id = p_school_id)
    ORDER BY (split_part(f.academic_year, '/', 1))::int ASC,
             CASE f.term WHEN 'First' THEN 1 WHEN 'Second' THEN 2 ELSE 3 END ASC
    FOR UPDATE OF f
  LOOP
    EXIT WHEN v_remaining_amount <= 0;
    IF (COALESCE(v_rec.total_amount, 0) - COALESCE(v_rec.amount_paid, 0)) > 0 THEN
      v_take := LEAST(v_remaining_amount, COALESCE(v_rec.total_amount, 0) - COALESCE(v_rec.amount_paid, 0));
      UPDATE public.fees
      SET amount_paid = amount_paid + v_take,
          payment_status = CASE
            WHEN (total_amount - (amount_paid + v_take)) <= 0 THEN 'paid'
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
