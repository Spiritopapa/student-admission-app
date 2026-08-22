-- ============================================================
--  Student Admission Portal — Delete Receipts by Class & Date
--  Creates: delete_receipts_by_class_date() function
--  Used by: admin-fees.js "Delete Receipts" tab
--  Deletes receipts (and cascading payment_transactions) for
--  students in a given class within a date range, and
--  recalculates the fees.amount_paid for affected fee records.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_receipts_by_class_date(
  p_class_name TEXT,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_count INT := 0;
  v_transaction_count INT := 0;
  v_total_amount NUMERIC(12,2) := 0;
  v_fee_updates INT := 0;
  v_student_ids TEXT[];
  v_receipt RECORD;
  v_fee_id UUID;
  v_current_paid NUMERIC(12,2);
  v_new_paid NUMERIC(12,2);
  v_new_status TEXT;
  v_total_due NUMERIC(12,2);
  v_debt NUMERIC(12,2);
  v_school_id UUID;
BEGIN
  -- Resolve school_id if not provided
  IF p_school_id IS NULL THEN
    v_school_id := public.get_user_school_id();
  ELSE
    v_school_id := p_school_id;
  END IF;

  -- Validate school access
  IF NOT public.can_access_school_data(v_school_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You do not have permission to delete receipts for this school.'
    );
  END IF;

  -- Get all student IDs in the specified class for this school
  SELECT ARRAY_AGG(a.student_id)
  INTO v_student_ids
  FROM public.applications a
  WHERE a.class_applying = p_class_name
    AND (v_school_id IS NULL OR a.school_id = v_school_id);

  IF v_student_ids IS NULL OR array_length(v_student_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'receipts_deleted', 0,
      'transactions_deleted', 0,
      'total_amount', 0,
      'fee_records_updated', 0,
      'message', 'No students found in class ' || p_class_name
    );
  END IF;

  -- Loop through matching receipts
  FOR v_receipt IN
    SELECT r.id, r.student_id, r.academic_year, r.term, r.amount, r.transaction_id
    FROM public.receipts r
    WHERE r.student_id = ANY(v_student_ids)
      AND (v_school_id IS NULL OR r.school_id = v_school_id)
      AND (p_date_from IS NULL OR r.receipt_date::date >= p_date_from)
      AND (p_date_to IS NULL OR r.receipt_date::date <= p_date_to)
    ORDER BY r.receipt_date
  LOOP
    -- Update the corresponding fee record
    SELECT id, amount_paid, total_amount, debt
    INTO v_fee_id, v_current_paid, v_total_due, v_debt
    FROM public.fees
    WHERE student_id = v_receipt.student_id
      AND academic_year = v_receipt.academic_year
      AND term = v_receipt.term
    FOR UPDATE;

    IF FOUND THEN
      -- Subtract the receipt amount from amount_paid
      v_new_paid := GREATEST(v_current_paid - v_receipt.amount, 0);
      
      -- Determine new payment status
      IF v_new_paid <= 0 THEN
        v_new_status := 'unpaid';
      ELSIF v_new_paid < (v_total_due + v_debt) THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'paid';
      END IF;

      -- Update the fee record
      UPDATE public.fees
      SET amount_paid = v_new_paid,
          payment_status = v_new_status,
          last_payment_date = CASE 
            WHEN v_new_paid > 0 THEN last_payment_date
            ELSE NULL
          END,
          updated_at = now()
      WHERE id = v_fee_id;

      v_fee_updates := v_fee_updates + 1;
    END IF;

    -- Delete the receipt (cascades to payment_transactions via transaction_id FK)
    DELETE FROM public.receipts WHERE id = v_receipt.id;
    v_receipt_count := v_receipt_count + 1;
    v_total_amount := v_total_amount + v_receipt.amount;
    
    IF v_receipt.transaction_id IS NOT NULL THEN
      v_transaction_count := v_transaction_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'receipts_deleted', v_receipt_count,
    'transactions_deleted', v_transaction_count,
    'total_amount', v_total_amount,
    'fee_records_updated', v_fee_updates,
    'message', 'Deleted ' || v_receipt_count || ' receipt(s) totaling GH₵ ' || v_total_amount
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_receipts_by_class_date(TEXT, DATE, DATE, UUID) TO authenticated;