-- ============================================================
--  Student Admission Portal — Overpayment Handling
--  Adds overpaid_amount column to fees table and updates
--  the process_fee_payment function to handle overpayments
--  with carry-forward to next term
--  
--  KEY DESIGN: When overpayment occurs, amount_paid exceeds
--  total_amount, making the balance column go NEGATIVE.
--  This negative balance clearly shows the credit that will
--  be applied to the next term's fees.
-- ============================================================

-- ---------------------------------------------------
-- 1. Add overpaid_amount column to fees table
-- ---------------------------------------------------
ALTER TABLE public.fees 
ADD COLUMN IF NOT EXISTS overpaid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------
-- 2. Updated process_fee_payment with overpayment support
--    When overpaid: amount_paid > total_amount, balance goes negative
--    The negative balance = credit for next term
-- ---------------------------------------------------
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
  -- Get current fee record (or create one if missing)
  SELECT id, amount_paid, total_amount, debt, COALESCE(overpaid_amount, 0)
  INTO v_fee_id, v_current_paid, v_current_total, v_current_debt, v_current_overpaid
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year
    AND term = p_term
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Auto-create fee record
    SELECT cf.fee_amount INTO v_class_fee_amount
    FROM public.applications a
    LEFT JOIN public.class_fees cf ON cf.class_name = a.class_applying
      AND cf.academic_year = p_academic_year
      AND cf.term = p_term
      AND cf.school_id = p_school_id
    WHERE a.student_id = p_student_id;

    v_class_fee_amount := COALESCE(v_class_fee_amount, 0);

    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, overpaid_amount, payment_status, school_id)
    VALUES (p_student_id, p_academic_year, p_term, v_class_fee_amount, 0, 0, 0, 'unpaid', p_school_id)
    RETURNING id, amount_paid, total_amount, debt, overpaid_amount
    INTO v_fee_id, v_current_paid, v_current_total, v_current_debt, v_current_overpaid;
  END IF;

  -- Calculate outstanding balance for this term
  v_remaining := (v_current_total + v_current_debt) - v_current_paid;

  -- ⛔ TOTALLY PREVENT OVERPAYMENT: Cap payment amount to outstanding balance
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
      overpaid_amount = 0,  -- Always reset to 0 since overpayment is prevented
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

  -- Generate receipt
  v_receipt_number := public.generate_receipt_number();

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
      'remaining_balance', v_remaining, -- Can be negative (credit)
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

  -- ============================================================
  -- AUTO-CLEANUP: If this fee record is now fully paid AND it is
  -- a PREVIOUS term (not the latest term for this student),
  -- delete the fee record to reduce table congestion.
  -- Receipts and payment_transactions are PRESERVED since they
  -- reference student_id directly, not the fee record ID.
  -- ============================================================
  IF v_new_status = 'paid' THEN
    -- Check if there are any LATER terms for this student
    -- (meaning this paid term is a previous/older term)
    DECLARE
      v_later_exists BOOLEAN;
      v_paid_term_order INT;
    BEGIN
      -- Determine the numeric order of the paid term
      v_paid_term_order := CASE p_term
        WHEN 'First' THEN 1
        WHEN 'Second' THEN 2
        WHEN 'Third' THEN 3
        ELSE 0
      END;

      -- Check if any fee record exists with a later academic year/term
      SELECT EXISTS(
        SELECT 1 FROM public.fees
        WHERE student_id = p_student_id
          AND id != v_fee_id
          AND (
            -- Later academic year
            SPLIT_PART(academic_year, '/', 1)::INT > SPLIT_PART(p_academic_year, '/', 1)::INT
            OR
            -- Same academic year, later term
            (SPLIT_PART(academic_year, '/', 1)::INT = SPLIT_PART(p_academic_year, '/', 1)::INT
             AND CASE term
               WHEN 'First' THEN 1
               WHEN 'Second' THEN 2
               WHEN 'Third' THEN 3
             END > v_paid_term_order)
          )
        LIMIT 1
      ) INTO v_later_exists;

      -- Only delete if this is a previous term (not the latest)
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
    'remaining_balance', v_remaining, -- Can be negative (credit for next term)
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

-- ---------------------------------------------------
-- 3. Updated promote_student_fees to apply overpaid amount
--    When promoting to next term, the overpaid_amount from
--    the current term is used to reduce the new term's fees
-- ---------------------------------------------------
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
  v_current_balance NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_current_overpaid NUMERIC(12,2);
  v_total_carry NUMERIC(12,2);
  v_effective_fee NUMERIC(12,2);
  v_remaining_overpaid NUMERIC(12,2);
BEGIN
  -- Get current term's balance (can be negative if overpaid) and overpaid_amount
  SELECT (total_amount - amount_paid), debt, COALESCE(overpaid_amount, 0)
  INTO v_current_balance, v_current_debt, v_current_overpaid
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_current_academic_year
    AND term = p_current_term;

  IF NOT FOUND THEN
    v_current_balance := 0;
    v_current_debt := 0;
    v_current_overpaid := 0;
  END IF;

  -- Calculate carry: balance (can be negative) + debt
  -- If balance is negative (overpaid), it reduces what's owed
  v_total_carry := GREATEST(COALESCE(v_current_balance, 0) + COALESCE(v_current_debt, 0), 0);
  
  -- Effective fee after applying overpaid amount
  -- If balance is negative, that negative amount is the credit
  v_effective_fee := GREATEST(p_new_fee_amount + LEAST(COALESCE(v_current_balance, 0), 0), 0);
  
  -- Any remaining overpaid amount after covering the new fee
  v_remaining_overpaid := GREATEST(ABS(LEAST(COALESCE(v_current_balance, 0), 0)) - p_new_fee_amount, 0);

  INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, overpaid_amount, payment_status, school_id)
  SELECT p_student_id, p_new_academic_year, p_new_term, p_new_fee_amount, 0, v_total_carry, v_remaining_overpaid,
         CASE WHEN (v_effective_fee + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
         school_id
  FROM public.applications WHERE student_id = p_student_id
  ON CONFLICT (student_id, academic_year, term)
  DO UPDATE SET
    total_amount = p_new_fee_amount,
    debt = v_total_carry,
    overpaid_amount = v_remaining_overpaid,
    payment_status = CASE WHEN (v_effective_fee + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'carried_balance', v_total_carry,
    'overpaid_applied', GREATEST(ABS(LEAST(COALESCE(v_current_balance, 0), 0)) - v_remaining_overpaid, 0),
    'remaining_overpaid', v_remaining_overpaid,
    'new_total', p_new_fee_amount + v_total_carry);
END;
$$;

-- ---------------------------------------------------
-- 4. Updated setClassFeeStructure logic (handled in JS)
--    When setting fee structure for a new term, the JS
--    will check for overpaid_amount on existing records
--    and apply the credit automatically.
-- ---------------------------------------------------

-- ---------------------------------------------------
-- 5. Function to apply overpaid credit when setting fees
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_overpaid_credit(
  p_student_id TEXT,
  p_academic_year TEXT,
  p_term TEXT,
  p_new_total_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overpaid_amount NUMERIC(12,2);
  v_effective_total NUMERIC(12,2);
  v_fee_id UUID;
  v_new_overpaid NUMERIC(12,2);
BEGIN
  -- Get any overpaid amount from previous terms for this student
  -- Look at the most recent term's overpaid_amount
  SELECT COALESCE(overpaid_amount, 0) INTO v_overpaid_amount
  FROM public.fees
  WHERE student_id = p_student_id
    AND overpaid_amount > 0
  ORDER BY academic_year DESC, 
    CASE term WHEN 'First' THEN 1 WHEN 'Second' THEN 2 WHEN 'Third' THEN 3 END DESC
  LIMIT 1;

  IF v_overpaid_amount IS NULL OR v_overpaid_amount = 0 THEN
    RETURN jsonb_build_object('success', true, 'applied', 0, 'new_total', p_new_total_amount);
  END IF;

  -- Apply the overpaid credit: reduce the total by the overpaid amount
  v_effective_total := GREATEST(p_new_total_amount - v_overpaid_amount, 0);
  v_new_overpaid := GREATEST(v_overpaid_amount - p_new_total_amount, 0);

  -- Update or insert the fee record
  SELECT id INTO v_fee_id
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year
    AND term = p_term;

  IF FOUND THEN
    UPDATE public.fees
    SET total_amount = p_new_total_amount,
        overpaid_amount = v_new_overpaid,
        payment_status = CASE WHEN (v_effective_total + debt) > 0 THEN 'unpaid' ELSE 'paid' END,
        updated_at = now()
    WHERE id = v_fee_id;
  ELSE
    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, overpaid_amount, payment_status, school_id)
    SELECT p_student_id, p_academic_year, p_term, p_new_total_amount, 0, 0, v_new_overpaid,
           CASE WHEN v_effective_total > 0 THEN 'unpaid' ELSE 'paid' END,
           school_id
    FROM public.applications WHERE student_id = p_student_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'applied', v_overpaid_amount - v_new_overpaid, 'new_total', v_effective_total, 'remaining_overpaid', v_new_overpaid);
END;
$$;