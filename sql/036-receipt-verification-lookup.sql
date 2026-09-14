-- ============================================================
--  Receipt Public Verification Lookup (short QR support)
-- ============================================================
--  Creates a SECURITY DEFINER function that lets the standalone
--  verify-receipt.html page look up a full receipt by its short
--  receipt_number (the only data now encoded in the printed QR).
--
--  SECURITY:
--  - SECURITY DEFINER lets this function read receipts even though
--    the anonymous role has no direct SELECT on the receipts table.
--  - It ONLY exposes the single receipt matching the passed number,
--    returning a normalized, display-only payload.
--  - EXECUTE is granted only to anon/authenticated for verification;
--    nothing leaks entire tables or other schools' data.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_receipt_for_verification(p_receipt_number TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_app     public.applications%ROWTYPE;
  v_school  public.schools%ROWTYPE;
  v_data    jsonb;
  v_student_name  text;
  v_student_class text;
  v_school_name   text;
  v_school_logo   text;
BEGIN
  SELECT * INTO v_receipt
    FROM public.receipts
   WHERE receipt_number = p_receipt_number;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_app
    FROM public.applications
   WHERE student_id = v_receipt.student_id
   LIMIT 1;

  SELECT * INTO v_school
    FROM public.schools
   WHERE id = v_receipt.school_id
   LIMIT 1;

  v_data := COALESCE(v_receipt.receipt_data, '{}'::jsonb);

  v_student_name  := COALESCE(v_data->>'student_name',
                              concat_ws(' ', v_app.first_name, v_app.middle_name, v_app.last_name),
                              v_receipt.student_id);
  v_student_class := COALESCE(v_data->>'class', v_data->>'student_class', v_app.class_applying, '');
  v_school_name   := COALESCE(v_data->>'school_name', v_school.name, 'School');
  v_school_logo   := COALESCE(v_school.logo_url, v_data->>'school_logo_url', '');

  RETURN jsonb_build_object(
    'school_name', v_school_name,
    'school_logo_url', v_school_logo,
    'receipt_number', v_receipt.receipt_number,
    'receipt_date', to_char(v_receipt.receipt_date AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI'),
    'student_name', v_student_name,
    'student_id', v_receipt.student_id,
    'student_class', v_student_class,
    'term', COALESCE(v_data->>'term', v_receipt.term, ''),
    'academic_year', COALESCE(v_data->>'academic_year', v_receipt.academic_year, ''),
    'total_due', COALESCE(NULLIF(v_data->>'total_due','')::numeric,
                          NULLIF(v_data->>'total_fees','')::numeric,
                          v_receipt.amount, 0),
    'amount_paid_before', COALESCE(NULLIF(v_data->>'amount_paid_before','')::numeric, 0),
    'amount_now', COALESCE(NULLIF(v_data->>'amount_now','')::numeric, v_receipt.amount, 0),
    'total_paid', COALESCE(NULLIF(v_data->>'total_paid','')::numeric, v_receipt.amount, 0),
    'remaining_balance', COALESCE(NULLIF(v_data->>'remaining_balance','')::numeric, 0),
    'overpaid_amount', COALESCE(NULLIF(v_data->>'overpaid_amount','')::numeric, 0),
    'debt', COALESCE(NULLIF(v_data->>'debt','')::numeric, 0),
    'is_previous_term_payment', COALESCE((v_data->>'is_previous_term_payment')::boolean, false),
    'payment_method', COALESCE(v_data->>'payment_method', v_receipt.payment_method, 'Cash'),
    'reference_number', COALESCE(v_data->>'reference_number', ''),
    'payment_status', COALESCE(v_data->>'payment_status', 'paid'),
    'notes', COALESCE(v_data->>'notes', ''),
    'issued_by', COALESCE(v_data->>'processed_by', 'Staff'),
    'issued_by_label', COALESCE(v_data->>'processed_by_label', 'Issuer'),
    'photo_url', COALESCE(v_data->>'photo_url', v_app.student_photo_url, '')
  );
END;
$$;

-- Only expose this one function to anonymous + authenticated roles.
REVOKE ALL ON FUNCTION public.get_receipt_for_verification(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_receipt_for_verification(TEXT) TO anon, authenticated;
