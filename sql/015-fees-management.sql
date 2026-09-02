-- ============================================================
--  Student Admission Portal — Fees Management Module (v2)
--  Migration file with all fixes baked in
--  Tables: fee_categories, class_fees, fees, payment_transactions, receipts
--  Functions: payment processing, carry-forward, promotion, receipt generation
--  Supports 3-term academic year with balance carry-forward
-- ============================================================

-- ============================================================
--  SECTION 1: TABLES
-- ============================================================

-- ---------------------------------------------------
-- 1.1 FEE CATEGORIES (e.g. Tuition, Development, PTA)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.fee_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fee categories"
  ON public.fee_categories FOR ALL
  USING (public.can_access_school_data(fee_categories.school_id));

CREATE POLICY "Users view fee categories"
  ON public.fee_categories FOR SELECT
  USING (public.can_access_school_data(fee_categories.school_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_categories_school_name
  ON public.fee_categories (school_id, name);

-- ---------------------------------------------------
-- 1.2 CLASS FEES (fee structure per class/term)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name      TEXT NOT NULL,
  academic_year   TEXT NOT NULL DEFAULT '2025/2026',
  term            TEXT NOT NULL DEFAULT 'First'
                  CHECK (term IN ('First','Second','Third')),
  fee_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.class_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage class fees"
  ON public.class_fees FOR ALL
  USING (public.can_access_school_data(class_fees.school_id));

CREATE POLICY "Users view class fees"
  ON public.class_fees FOR SELECT
  USING (public.can_access_school_data(class_fees.school_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_class_fees_unique
  ON public.class_fees (class_name, academic_year, term, school_id);

-- ---------------------------------------------------
-- 1.3 FEES (per-student fee record per term)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  academic_year     TEXT NOT NULL DEFAULT '2025/2026',
  term              TEXT NOT NULL DEFAULT 'First'
                    CHECK (term IN ('First','Second','Third')),
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance           NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  debt              NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Carried forward from previous term
  payment_status    TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('paid','partial','unpaid')),
  last_payment_date TIMESTAMPTZ,
  overpaid_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage fees"
  ON public.fees FOR ALL
  USING (public.can_access_school_data(fees.school_id));

CREATE POLICY "Students view own fees"
  ON public.fees FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.student_id = fees.student_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Parents view ward fees"
  ON public.fees FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    WHERE pl.student_id = fees.student_id AND pl.parent_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_fees_student_id ON public.fees(student_id);
CREATE INDEX IF NOT EXISTS idx_fees_school_id ON public.fees(school_id);
CREATE INDEX IF NOT EXISTS idx_fees_academic_year ON public.fees(academic_year);
CREATE INDEX IF NOT EXISTS idx_fees_term ON public.fees(term);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_student_term_unique
  ON public.fees (student_id, academic_year, term);

-- ---------------------------------------------------
-- 1.4 PAYMENT TRANSACTIONS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  academic_year     TEXT NOT NULL DEFAULT '2025/2026',
  term              TEXT NOT NULL DEFAULT 'First'
                    CHECK (term IN ('First','Second','Third')),
  amount_paid       NUMERIC(12,2) NOT NULL,
  payment_method    TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','mobile_money','bank_transfer','cheque','other')),
  payment_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference_number  TEXT,
  notes             TEXT,
  recorded_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage transactions"
  ON public.payment_transactions FOR ALL
  USING (public.can_access_school_data(payment_transactions.school_id));

CREATE POLICY "Students view own transactions"
  ON public.payment_transactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.student_id = payment_transactions.student_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Parents view ward transactions"
  ON public.payment_transactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    WHERE pl.student_id = payment_transactions.student_id AND pl.parent_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_payment_transactions_student ON public.payment_transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_school ON public.payment_transactions(school_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_date ON public.payment_transactions(payment_date);

-- ---------------------------------------------------
-- 1.5 RECEIPTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    TEXT UNIQUE NOT NULL,
  transaction_id    UUID REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  student_id        TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  academic_year     TEXT NOT NULL DEFAULT '2025/2026',
  term              TEXT NOT NULL DEFAULT 'First'
                    CHECK (term IN ('First','Second','Third')),
  amount            NUMERIC(12,2) NOT NULL,
  payment_method    TEXT NOT NULL DEFAULT 'cash',
  receipt_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  receipt_data      JSONB,
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage receipts"
  ON public.receipts FOR ALL
  USING (public.can_access_school_data(receipts.school_id));

CREATE POLICY "Students view own receipts"
  ON public.receipts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.student_id = receipts.student_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Parents view ward receipts"
  ON public.receipts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    WHERE pl.student_id = receipts.student_id AND pl.parent_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_receipts_student ON public.receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_receipts_school ON public.receipts(school_id);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON public.receipts(receipt_number);

-- ============================================================
--  SECTION 2: FUNCTIONS
-- ============================================================

-- ---------------------------------------------------
-- 2.1 Receipt Number Generator
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
  new_id TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(receipt_number, '-', 2) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.receipts
  WHERE receipt_number LIKE 'RCP-%';
  new_id := 'RCP-' || LPAD(next_num::TEXT, 6, '0');
  RETURN new_id;
END;
$$;

-- ---------------------------------------------------
-- 2.2 Process Fee Payment (auto-creates fee records)
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

  -- TOTALLY PREVENT OVERPAYMENT: Cap payment amount to outstanding balance
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
      v_term_order INT;
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

-- ---------------------------------------------------
-- 2.3 Carry Forward Balance
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.carry_forward_balance(
  p_student_id TEXT,
  p_from_academic_year TEXT,
  p_from_term TEXT,
  p_to_academic_year TEXT,
  p_to_term TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_total_carry NUMERIC(12,2);
  v_target_fee_id UUID;
  v_target_total NUMERIC(12,2);
BEGIN
  SELECT (total_amount - amount_paid), debt
  INTO v_current_balance, v_current_debt
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_from_academic_year
    AND term = p_from_term;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source fee record not found');
  END IF;

  v_total_carry := v_current_balance + v_current_debt;

  SELECT id, total_amount INTO v_target_fee_id, v_target_total
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_to_academic_year
    AND term = p_to_term;

  IF FOUND THEN
    UPDATE public.fees
    SET debt = v_total_carry,
        payment_status = CASE WHEN v_total_carry > 0 THEN 'unpaid' ELSE payment_status END,
        updated_at = now()
    WHERE id = v_target_fee_id;
  ELSE
    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, payment_status, school_id)
    SELECT p_student_id, p_to_academic_year, p_to_term, 0, 0, v_total_carry,
           CASE WHEN v_total_carry > 0 THEN 'unpaid' ELSE 'paid' END,
           school_id
    FROM public.applications WHERE student_id = p_student_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'carried_amount', v_total_carry,
    'from', p_from_academic_year || ' ' || p_from_term,
    'to', p_to_academic_year || ' ' || p_to_term);
END;
$$;

-- ---------------------------------------------------
-- 2.4 Promote Student Fees (carry balance to new class/term)
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
  v_total_carry NUMERIC(12,2);
BEGIN
  SELECT (total_amount - amount_paid), debt
  INTO v_current_balance, v_current_debt
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_current_academic_year
    AND term = p_current_term;

  IF NOT FOUND THEN
    v_current_balance := 0;
    v_current_debt := 0;
  END IF;

  v_total_carry := COALESCE(v_current_balance, 0) + COALESCE(v_current_debt, 0);

  INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, payment_status, school_id)
  SELECT p_student_id, p_new_academic_year, p_new_term, p_new_fee_amount, 0, v_total_carry,
         CASE WHEN (p_new_fee_amount + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
         school_id
  FROM public.applications WHERE student_id = p_student_id
  ON CONFLICT (student_id, academic_year, term)
  DO UPDATE SET
    total_amount = p_new_fee_amount,
    debt = v_total_carry,
    payment_status = CASE WHEN (p_new_fee_amount + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'carried_balance', v_total_carry,
    'new_total', p_new_fee_amount + v_total_carry);
END;
$$;

-- ---------------------------------------------------
-- 2.5 Get Student Fee Summary
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_fee_summary(p_student_id TEXT)
RETURNS TABLE(
  academic_year TEXT, term TEXT,
  total_amount NUMERIC, amount_paid NUMERIC,
  balance NUMERIC, debt NUMERIC,
  payment_status TEXT, last_payment_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT f.academic_year, f.term, f.total_amount, f.amount_paid,
         f.balance, f.debt, f.payment_status, f.last_payment_date
  FROM public.fees f
  WHERE f.student_id = p_student_id
  ORDER BY f.academic_year, f.term;
END;
$$;

-- ---------------------------------------------------
-- 2.6 Apply Overpaid Credit (when setting fee structure for a new term)
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

-- ============================================================
--  SECTION 3: TRIGGERS (auto-update timestamps)
--  Uses the same update_updated_at_column() function defined in 008-triggers.sql
-- ============================================================

-- fee_categories updated_at trigger
DROP TRIGGER IF EXISTS set_fee_categories_updated_at ON public.fee_categories;
CREATE TRIGGER set_fee_categories_updated_at
  BEFORE UPDATE ON public.fee_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- class_fees updated_at trigger
DROP TRIGGER IF EXISTS set_class_fees_updated_at ON public.class_fees;
CREATE TRIGGER set_class_fees_updated_at
  BEFORE UPDATE ON public.class_fees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- fees updated_at trigger
DROP TRIGGER IF EXISTS set_fees_updated_at ON public.fees;
CREATE TRIGGER set_fees_updated_at
  BEFORE UPDATE ON public.fees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
