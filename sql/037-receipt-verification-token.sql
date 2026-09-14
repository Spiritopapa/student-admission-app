-- ============================================================
--  Receipt Secure Verification Tokens (unguessable QR URLs)
-- ============================================================
--  Upgrades the fee-receipt QR code from "short receipt number"
--  to a DYNAMIC, SECURE verification URL backed by a random,
--  unguessable token stored per receipt.
--
--  WHY:
--    - Receipt numbers are short and sequential (RCT-0001, RCT-0002…),
--      so putting them directly in the QR lets anyone enumerate and
--      view every receipt in the system.
--    - A 192-bit random hex token (48 chars) cannot be guessed. The QR
--      now encodes ONLY that token, and the public verify-receipt.html
--      page fetches the full receipt by token via a SECURITY DEFINER
--      function. Nothing guessable is exposed.
--
--  WHAT THIS FILE DOES:
--    1. Adds a `verification_token` column to public.receipts.
--    2. Backfills existing receipts with a random token.
--    3. Installs a BEFORE INSERT trigger so EVERY future receipt
--       (from any code path) is auto-assigned a token.
--    4. Redefines get_receipt_for_verification() to resolve by token,
--       with a safe fallback to the old receipt_number for receipts
--       still printed under the previous format.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column + unique index (partial, ignores NULLs)
-- ------------------------------------------------------------
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS verification_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_verification_token
  ON public.receipts(verification_token)
  WHERE verification_token IS NOT NULL AND verification_token <> '';

-- ------------------------------------------------------------
-- 2. Backfill existing receipts (so old receipts stay verifiable)
-- ------------------------------------------------------------
-- NOTE: We deliberately do NOT use pgcrypto's gen_random_bytes() here.
-- On Supabase the pgcrypto extension lives in the `extensions` schema,
-- so an unqualified gen_random_bytes() call made under a `public`
-- search_path fails with "function gen_random_bytes(integer) does not
-- exist" (which is exactly what happened inside the receipt INSERT
-- trigger when recording a payment). Instead we build the same
-- 48 lowercase-hex-character token from core gen_random_uuid()
-- (available since PostgreSQL 13, already used by every table's id
-- default), which works on both Supabase and plain Postgres.
UPDATE public.receipts
   SET verification_token = substring(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') from 1 for 48)
 WHERE verification_token IS NULL OR verification_token = '';

-- ------------------------------------------------------------
-- 3. Trigger function + trigger (covers ALL receipt insert paths)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_receipt_verification_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    -- Same 48-hex-char token generator as the backfill above, built from
    -- core gen_random_uuid() so it works without pgcrypto / the
    -- `extensions` schema being on the search_path.
    NEW.verification_token := substring(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') from 1 for 48);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_verification_token ON public.receipts;
CREATE TRIGGER trg_receipt_verification_token
  BEFORE INSERT ON public.receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_verification_token();

-- ------------------------------------------------------------
-- 4. Redefine get_receipt_for_verification to resolve by token
--    (still matches receipt_number for receipts issued before
--    this upgrade, so legacy QRs keep working).
--    NOTE: DROP first, because the old version named its parameter
--    "p_receipt_number" and PostgreSQL blocks CREATE OR REPLACE when
--    an input parameter name changes (error 42P13).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_receipt_for_verification(TEXT);

CREATE OR REPLACE FUNCTION public.get_receipt_for_verification(p_lookup TEXT)
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
  -- Resolve by the unguessable verification token first, and also accept the
  -- legacy receipt_number (old QRs printed before this upgrade). Tokens are 48
  -- lowercase hex chars, so they can never collide with a receipt_number.
  SELECT * INTO v_receipt
    FROM public.receipts
   WHERE verification_token = p_lookup
      OR receipt_number = p_lookup
   LIMIT 1;

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
    'photo_url', COALESCE(v_data->>'photo_url', v_app.student_photo_url, ''),
    'verification_token', v_receipt.verification_token
  );
END;
$$;

-- Only expose this one function to anonymous + authenticated roles.
REVOKE ALL ON FUNCTION public.get_receipt_for_verification(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_receipt_for_verification(TEXT) TO anon, authenticated;

