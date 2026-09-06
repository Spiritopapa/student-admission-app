-- ============================================================
--  Student Admission Portal — Password-Reset OTP Monthly Limit
-- ============================================================
--  Purpose:
--    1. Give every user a MAXIMUM of 3 password-reset SMS OTPs
--       within any rolling 30-day period.
--    2. When the allowance is exhausted, request_forgot_password_otp()
--       REFUSES to mint another code and returns:
--         { success: false, otp_limit_exceeded: true, otps_remaining: 0 }
--       so js/modules/forgot-password.js can pop up a message telling
--       the user to contact the developer for a password reset.
--
--  How the count works:
--    password_reset_otps keeps one row per minted OTP, so the number
--    of codes issued in the last 30 days is simply:
--      count(*) WHERE user_id = ? AND created_at > now() - interval '30 days'
--    This is the same pattern already used for the 10-minute rate limit.
--    It is a true rolling window — the allowance refreshes as soon as
--    codes age past 30 days.
--
--  This migration also returns otps_remaining on success so the client
--  can warn the user when they have used their final allowed code.
--
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

-- -----------------------------------------------------------
-- Harden request_forgot_password_otp() — 30-day cap of 3 codes
-- (Mirrors sql/056-sms-admin-assistance.sql + monthly limit).
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
  v_otps_remaining   INT;
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

  -- Monthly limit: max 3 password-reset codes per user in any rolling 30 days.
  IF (SELECT count(*) FROM public.password_reset_otps
      WHERE user_id = v_user_id AND created_at > v_now - interval '30 days') >= 3 THEN
    RETURN jsonb_build_object(
      'success', false,
      'otp_limit_exceeded', true,
      'otps_remaining', 0,
      'error', 'You have used all 3 password-reset codes allowed in 30 days. Please contact the developer for a password reset.'
    );
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

  -- Codes left in the current 30-day window (0 means the user just used #3).
  v_otps_remaining := 3 - (SELECT count(*) FROM public.password_reset_otps
                           WHERE user_id = v_user_id AND created_at > v_now - interval '30 days');

  RETURN jsonb_build_object(
    'success', true,
    'otp', v_otp,
    'phone_last3', right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 3),
    'assistance_phone', v_assistance_phone,
    'otps_remaining', v_otps_remaining
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_forgot_password_otp(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
--  Done
-- ============================================================