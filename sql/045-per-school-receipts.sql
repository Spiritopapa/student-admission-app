-- ============================================================
--  Student Admission Portal — PER-SCHOOL RECEIPT NUMBERS
--  ============================================================
--  Purpose:
--    Each school gets its own unique receipt number sequence so
--    a school's receipts are independently and recognizably
--    numbered (e.g. "Sunshine International School" receipts are
--    RCP-SIN-000001, RCP-SIN-000002, ...). The school name
--    initials are embedded in the receipt number (mirroring the
--    initials-based School ID), which keeps the receipt_number
--    column globally UNIQUE while giving every school its own
--    readable series.
--
--    Also redefines process_fee_payment() so it passes the
--    school_id into the new generator.
-- ============================================================

-- -----------------------------------------------------------
-- 1. REWRITE RECEIPT NUMBER GENERATOR TO BE PER-SCHOOL
--    Old format : RCP-000001
--    New format : RCP-SIN-000001   (initials derived from school name)
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_receipt_number();

CREATE OR REPLACE FUNCTION public.generate_receipt_number(p_school_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initials TEXT;
  v_clean    TEXT;
  v_next     INT;
  new_id     TEXT;
BEGIN
  -- Derive up to 3 uppercase initials (A-Z/0-9) from significant words.
  SELECT upper(name) INTO v_clean FROM public.schools WHERE id = p_school_id;
  v_clean := regexp_replace(coalesce(v_clean, ''), '[^A-Z0-9 ]', ' ');

  SELECT string_agg(left(w, 1), '') INTO v_initials
  FROM unnest(regexp_split_to_array(v_clean, '\s+')) AS w
  WHERE w <> '';

  v_initials := upper(left(coalesce(v_initials, ''), 3));
  IF v_initials = '' THEN
    v_initials := 'SCH';
  END IF;

  -- Build the next unique id within THIS initials prefix (unique across
  -- all schools so identical-initial names can never collide).
  SELECT COALESCE(MAX(num::INTEGER), 0) + 1 INTO v_next
  FROM (
    SELECT SPLIT_PART(receipt_number, '-', 3) AS num
    FROM public.receipts
    WHERE receipt_number LIKE 'RCP-' || v_initials || '-%'
  ) t
  WHERE t.num ~ '^[0-9]+$';

  new_id := 'RCP-' || v_initials || '-' || LPAD(v_next::TEXT, 6, '0');
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_receipt_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_receipt_number(UUID) TO anon;

-- -----------------------------------------------------------
-- 2. REDEFINE process_fee_payment TO PASS p_school_id
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_fee_payment(
  p_student_id TEXT,
  p_academic_year TEXT,
  p_term TEXT,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_recorded_by UUID DEFAULT NULL,
  p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee_id UUID;
  v_current_paid NUMERIC(12,2);
  v_current_total NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_current_overpaid NUMERIC(12,2);
  v_new_paid NUMERIC(12,2);
  v_new_status TEXT;
  v_transaction_id UUID;
  v_receipt_number TEXT;
  v_receipt_id UUID;
  v_remaining NUMERIC(12,2);
  v_overpaid_amount NUMERIC(12,2);
  v_student_name TEXT;
  v_class_name TEXT;
  v_school_name TEXT;
  v_class_fee_amount NUMERIC(12,2);
  v_next_term TEXT;
  v_next_year TEXT;
  v_next_fee_id UUID;
  v_next_total NUMERIC(12,2);
  v_next_paid NUMERIC(12,2);
  v_next_overpaid NUMERIC(12,2);
  v_processor_name TEXT;
  v_processor_role TEXT;
  v_processor_label TEXT;
BEGIN
-- Get current fee record (MUST exist - created via Set/Update Class Fee)
  SELECT id, amount_paid, total_amount, debt, COALESCE(overpaid_amount, 0)
  INTO v_fee_id, v_current_paid, v_current_total, v_current_debt, v_current_overpaid
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year
    AND term = p_term
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No fee record found for this student, academic year, and term. Fee records must be created via the Fee Structure section first.'
    );
  END IF;

  -- Calculate outstanding balance for this term
  v_remaining := (v_current_total + v_current_debt) - v_current_paid;

  -- STOP OVERPAYMENT: Cap payment amount to outstanding balance
  IF p_amount > v_remaining THEN
    p_amount := v_remaining;
  END IF;

  -- Calculate new values (p_amount is now guaranteed <= outstanding)
  v_new_paid := v_current_paid + p_amount;
  v_remaining := (v_current_total + v_current_debt) - v_new_paid;

  -- Determine payment status (overpayment is now impossible)
  v_overpaid_amount := 0;
  IF v_remaining <= 0 THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  -- Update fee record - amount_paid will NEVER exceed total_amount + debt
  UPDATE public.fees
  SET amount_paid = v_new_paid,
      payment_status = v_new_status,
      overpaid_amount = 0,
      last_payment_date = now(),
      updated_at = now()
  WHERE id = v_fee_id;

  -- Create transaction
  INSERT INTO public.payment_transactions (
    student_id, academic_year, term, amount_paid,
    payment_method, payment_date, reference_number, notes,
    recorded_by, school_id
  ) VALUES (
    p_student_id, p_academic_year, p_term, p_amount,
    p_payment_method, now(), p_reference_number, p_notes,
    p_recorded_by, p_school_id
  ) RETURNING id INTO v_transaction_id;

  -- Look up processor info if recorded_by is provided
  IF p_recorded_by IS NOT NULL THEN
    SELECT full_name, role INTO v_processor_name, v_processor_role
    FROM public.profiles
    WHERE id = p_recorded_by;

    v_processor_label := CASE
      WHEN v_processor_role IN ('super_admin', 'school', 'sub_admin') THEN 'Admin'
      WHEN v_processor_role = 'accountant' THEN 'Accountant'
      WHEN v_processor_role IS NOT NULL THEN INITCAP(v_processor_role)
      ELSE 'Staff'
    END;
  END IF;

  -- Generate PER-SCHOOL receipt (unique per school via its name initials)
  v_receipt_number := public.generate_receipt_number(p_school_id);
SELECT CONCAT(a.first_name, ' ', COALESCE(a.middle_name || ' ', ''), a.last_name),
         a.class_applying
  INTO v_student_name, v_class_name
  FROM public.applications a WHERE a.student_id = p_student_id;

  SELECT COALESCE(s.name, 'School') INTO v_school_name
  FROM public.schools s WHERE s.id = p_school_id;

  INSERT INTO public.receipts (
    receipt_number, transaction_id, student_id,
    academic_year, term, amount, payment_method,
    receipt_date, receipt_data, school_id
  ) VALUES (
    v_receipt_number, v_transaction_id, p_student_id,
    p_academic_year, p_term, p_amount, p_payment_method,
    now(),
    jsonb_build_object(
      'student_name', v_student_name,
      'class', v_class_name,
      'school_name', v_school_name,
      'total_fees', v_current_total,
      'debt', v_current_debt,
      'total_due', v_current_total + v_current_debt,
      'amount_paid_before', v_current_paid,
      'amount_now', p_amount,
      'total_paid', v_new_paid,
      'remaining_balance', v_remaining,
      'overpaid_amount', v_overpaid_amount,
      'payment_status', v_new_status,
      'payment_method', p_payment_method,
      'reference_number', p_reference_number,
      'notes', p_notes,
      'processed_by', v_processor_name,
      'processed_by_label', v_processor_label
    ),
    p_school_id
  ) RETURNING id INTO v_receipt_id;

  -- AUTO-CLEANUP: If this fee record is now fully paid AND it is
  -- a PREVIOUS term (not the latest term for this student), delete it.
  IF v_new_status = 'paid' THEN
    DECLARE
      v_later_exists BOOLEAN;
      v_term_order INT;
      v_paid_term_order INT;
    BEGIN
      v_paid_term_order := CASE p_term
        WHEN 'First' THEN 1
        WHEN 'Second' THEN 2
        WHEN 'Third' THEN 3
        ELSE 0
      END;

      SELECT EXISTS(
        SELECT 1 FROM public.fees
        WHERE student_id = p_student_id
          AND id != v_fee_id
          AND (
            SPLIT_PART(academic_year, '/', 1)::INT > SPLIT_PART(p_academic_year, '/', 1)::INT
            OR
            (SPLIT_PART(academic_year, '/', 1)::INT = SPLIT_PART(p_academic_year, '/', 1)::INT
             AND CASE term
               WHEN 'First' THEN 1
               WHEN 'Second' THEN 2
               WHEN 'Third' THEN 3
             END > v_paid_term_order)
          )
        LIMIT 1
      ) INTO v_later_exists;

      IF v_later_exists THEN
        DELETE FROM public.fees WHERE id = v_fee_id;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'amount_paid', p_amount,
    'total_paid', v_new_paid,
    'remaining_balance', v_remaining,
    'overpaid_amount', v_overpaid_amount,
    'payment_status', v_new_status,
    'student_name', v_student_name,
    'class', v_class_name,
    'school_name', v_school_name,
    'academic_year', p_academic_year,
    'term', p_term,
    'debt', v_current_debt,
    'processed_by', v_processor_name,
    'processed_by_label', v_processor_label
  );
END;
$$;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================