-- ============================================================
--  Student Admission Portal — Delete a Single Receipt (with payment reversal)
--  Creates: delete_receipt() SECURITY DEFINER function
--  Used by: admin-fees.js per-student "Delete Receipt" button in the
--           Fees Management (Student Fees) table, plus the receipts
--           list modal.
--
--  PURPOSE:
--   Removes a single mistaken fee receipt from the database and REVERSES
--   the related payment:
--     1. Subtracts the receipt amount from the matching fees.amount_paid
--        and recalculates payment_status (paid / partial / unpaid).
--     2. Recreates the fee record if it was auto-cleaned by
--        process_fee_payment() once a previous term became fully paid.
--     3. Deletes the receipt AND its linked payment_transaction so no
--        trace of the mistaken payment remains.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_receipt(p_receipt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_fee_id UUID;
  v_current_paid NUMERIC(12,2);
  v_total_amount NUMERIC(12,2);
  v_debt NUMERIC(12,2);
  v_new_paid NUMERIC(12,2);
  v_new_status TEXT;
  v_pending NUMERIC(12,2);
  v_fee_recreated BOOLEAN := false;
BEGIN
  -- Resolve the receipt
  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found.');
  END IF;

  -- Permission check (school staff only)
  IF NOT public.can_access_school_data(v_receipt.school_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You do not have permission to delete this receipt.'
    );
  END IF;

  -- Lock (or recreate) the matching fee record
  SELECT id, amount_paid, total_amount, debt
  INTO v_fee_id, v_current_paid, v_total_amount, v_debt
  FROM public.fees
  WHERE student_id = v_receipt.student_id
    AND academic_year = v_receipt.academic_year
    AND term = v_receipt.term
  FOR UPDATE;

  IF NOT FOUND THEN
    -- The fee record may have been auto-deleted by process_fee_payment()
    -- once this previous term became fully paid. Restore it using the
    -- amounts captured on the receipt so the payment can be reversed.
    v_total_amount := COALESCE(
      NULLIF((v_receipt.receipt_data->>'total_fees')::numeric, NULL),
      NULLIF((v_receipt.receipt_data->>'total_due')::numeric, NULL),
      v_receipt.amount
    );
    IF v_total_amount IS NULL OR v_total_amount < 0 THEN
      v_total_amount := v_receipt.amount;
    END IF;
    v_debt := COALESCE((v_receipt.receipt_data->>'debt')::numeric, 0);
    IF v_debt IS NULL OR v_debt < 0 THEN v_debt := 0; END IF;

    INSERT INTO public.fees (
      student_id, academic_year, term, total_amount, amount_paid,
      debt, overpaid_amount, payment_status, school_id
    ) VALUES (
      v_receipt.student_id, v_receipt.academic_year, v_receipt.term,
      v_total_amount, 0, v_debt, 0, 'unpaid', v_receipt.school_id
    )
    RETURNING id INTO v_fee_id;

    v_current_paid := 0;
    v_fee_recreated := true;
  END IF;

  -- Reverse the payment (never below zero)
  v_new_paid := GREATEST(COALESCE(v_current_paid, 0) - v_receipt.amount, 0);

  -- Recalculate payment status
  v_pending := COALESCE(v_total_amount, 0) + COALESCE(v_debt, 0);
  IF v_new_paid <= 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_new_paid < v_pending THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'paid';
  END IF;

  UPDATE public.fees
  SET amount_paid = v_new_paid,
      payment_status = v_new_status,
      last_payment_date = (
        -- Recompute from the student's remaining receipts for this term
        SELECT MAX(r.receipt_date)
        FROM public.receipts r
        WHERE r.student_id = v_receipt.student_id
          AND r.academic_year = v_receipt.academic_year
          AND r.term = v_receipt.term
          AND r.id <> v_receipt.id
      ),
      updated_at = now()
  WHERE id = v_fee_id;

  -- Delete the receipt and its linked payment transaction
  -- (the FK receipts.transaction_id -> payment_transactions ON DELETE
  --  CASCADE would also remove the receipt if the transaction is deleted,
  --  so deleting both here is safe/order-independent)
  DELETE FROM public.receipts WHERE id = v_receipt.id;

  IF v_receipt.transaction_id IS NOT NULL THEN
    DELETE FROM public.payment_transactions WHERE id = v_receipt.transaction_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_number', v_receipt.receipt_number,
    'student_id', v_receipt.student_id,
    'amount', v_receipt.amount,
    'reversed_amount', v_receipt.amount,
    'new_amount_paid', v_new_paid,
    'payment_status', v_new_status,
    'fee_record_created', v_fee_recreated
  );
END;
$$;

-- Only authenticated school staff can execute this
REVOKE ALL ON FUNCTION public.delete_receipt(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_receipt(UUID) TO authenticated;