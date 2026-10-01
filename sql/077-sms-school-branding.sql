-- ============================================================
--  SchoolRunner — SMS School Branding (name + contact number)
--  Migration 077
--
--  Completes the "every SMS carries the school name and a contact
--  number" goal started in 056-sms-admin-assistance.sql:
--    - Fee-payment receipt SMS    → school name + school phone
--                                 (composed client-side; no SQL change)
--    - Debtor reminder SMS        → school phone appended
--                                 (composed client-side; no SQL change)
--    - Password-reset OTP SMS     → school NAME now returned so the
--                                 client can prefix it (the
--                                 assistance phone was already there)
--
--  This migration:
--    1. Adds _fp_get_school_name(p_user_id) — resolves the school's
--       display name for ANY role (staff via profiles.school_id,
--       student via applications.school_id, parent via parent_links).
--    2. Recreates request_forgot_password_otp() so its JSON result
--       also carries school_name (empty for the Super Admin).
--
--  Safe to re-run (CREATE OR REPLACE).
-- ============================================================

-- -----------------------------------------------------------
-- 1. Resolve the school's display name for a given user.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fp_get_school_name(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_school_id UUID;
  v_name      TEXT;
BEGIN
  -- 1) Staff (admin / sub_admin / teacher / accountant): profile school_id
  SELECT school_id INTO v_school_id
  FROM public.profiles
  WHERE id = p_user_id;

  -- 2) Student: the application row is keyed by user_id
  IF v_school_id IS NULL THEN
    SELECT school_id INTO v_school_id
    FROM public.applications
    WHERE user_id = p_user_id
    LIMIT 1;
  END IF;

  -- 3) Parent: via any linked ward's application
  IF v_school_id IS NULL THEN
    SELECT a.school_id INTO v_school_id
    FROM public.parent_links pl
    JOIN public.applications a ON a.student_id = pl.student_id
    WHERE pl.parent_user_id = p_user_id
    LIMIT 1;
  END IF;

  IF v_school_id IS NOT NULL THEN
    SELECT name INTO v_name
    FROM public.schools
    WHERE id = v_school_id
      AND COALESCE(name, '') <> '';
  END IF;

  RETURN v_name;
END;
$$;
-- -----------------------------------------------------------
-- 2. Recreate request_forgot_password_otp() → also returns
--    school_name so the OTP SMS can be prefixed with it.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_forgot_password_otp(p_identifier TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id          UUID;
  v_phone            TEXT;
  v_otp              TEXT;
  v_now              TIMESTAMPTZ := now();
  v_school_id        UUID;
  v_sms_enabled      BOOLEAN;
  v_assistance_phone TEXT;
  v_school_name      TEXT;
BEGIN
  v_user_id := public._fp_resolve_login_user(p_identifier);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account not found. Check the email or ID you entered.');
  END IF;

  -- Per-school SMS control: never mint an OTP that cannot be delivered.
  SELECT school_id INTO v_school_id FROM public.profiles WHERE id = v_user_id;
  IF v_school_id IS NOT NULL THEN
    SELECT sms_enabled INTO v_sms_enabled FROM public.schools WHERE id = v_school_id;
    IF v_sms_enabled = false THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SMS is currently disabled for your school by the Super Admin. Password-reset codes cannot be sent by SMS right now. Please contact your school administrator for help.'
      );
    END IF;
  END IF;

  v_phone := public._fp_get_user_phone(v_user_id);
  IF COALESCE(v_phone, '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'No mobile number is on file for this account. Please contact your administrator to add one, then try again.');
  END IF;

  IF public._fp_normalize_phone(p_phone) IS DISTINCT FROM public._fp_normalize_phone(v_phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'The mobile number you entered does not match the number on file.');
  END IF;

  -- Rate limit: max 5 OTP requests per user in 10 minutes
  IF (SELECT count(*) FROM public.password_reset_otps
      WHERE user_id = v_user_id AND created_at > v_now - interval '10 minutes') >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many verification-code requests. Please wait a few minutes and try again.');
  END IF;

  -- Invalidate any previous unused OTPs for this user
  UPDATE public.password_reset_otps SET used = true
  WHERE user_id = v_user_id AND used = false;

  v_otp := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO public.password_reset_otps (user_id, otp_hash, phone, expires_at)
  VALUES (v_user_id, crypt(v_otp, gen_salt('bf')), v_phone, v_now + interval '10 minutes');

  -- School admin's mobile so the OTP SMS can offer "call for any assistance"
  -- (empty for accounts with no school, e.g. the Super Admin).
  v_assistance_phone := public._fp_get_assistance_phone(v_user_id);

  -- School display name so the OTP SMS can be branded with it.
  v_school_name := public._fp_get_school_name(v_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'otp', v_otp,
    'phone_last3', right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 3),
    'assistance_phone', v_assistance_phone,
    'school_name', v_school_name
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_forgot_password_otp(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
--  Done — client-side SMS composition picks up the new fields.
-- ============================================================