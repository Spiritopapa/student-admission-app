-- ============================================================
--  Student Admission Portal — Per-School SMS Enable/Disable
--  ============================================================
--  Purpose:
--    1. Add schools.sms_enabled so the Super Admin can enable or
--       disable SMS messaging per school from the Super Admin
--       dashboard (Schools → SMS column).
--    2. Provide is_school_sms_enabled(p_school_id) (SECURITY
--       DEFINER) so ANY authenticated school staff member / super
--       admin can read the flag even when RLS would hide the
--       schools row from them.
--    3. Harden request_forgot_password_otp() so an OTP is NEVER
--       minted for an account whose school has SMS disabled —
--       otherwise a reset code could be generated that the SMS
--       delivery step would never be able to send.
--
--  HOW TO APPLY:
--  1. Open Supabase Dashboard → SQL Editor → New Query
--  2. Copy the ENTIRE content of this file
--  3. Paste and Run
--  ============================================================

-- -----------------------------------------------------------
-- 1. ADD sms_enabled COLUMN TO schools  (default = enabled)
-- -----------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT true;

-- Safety backfill (in case a legacy column definition was NULL-able).
UPDATE public.schools SET sms_enabled = true WHERE sms_enabled IS NULL;

-- -----------------------------------------------------------
-- 2. is_school_sms_enabled(p_school_id) — SECURITY DEFINER RPC
--    Returns TRUE when SMS is enabled (or the school is unknown),
--    FALSE when explicitly disabled.
--    Granted ONLY to authenticated users (never anon).
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_school_sms_enabled(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN COALESCE((SELECT sms_enabled FROM public.schools WHERE id = p_school_id), true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_school_sms_enabled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_school_sms_enabled(UUID) TO authenticated;

-- -----------------------------------------------------------
-- 3. HARDEN request_forgot_password_otp()
--    (Mirrors sql/042-forgot-password.sql with the per-school
--     SMS-disabled guard added BEFORE the OTP is generated.)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_forgot_password_otp(p_identifier TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id     UUID;
  v_phone       TEXT;
  v_otp         TEXT;
  v_now         TIMESTAMPTZ := now();
  v_school_id   UUID;
  v_sms_enabled BOOLEAN;
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

  RETURN jsonb_build_object(
    'success', true,
    'otp', v_otp,
    'phone_last3', right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 3)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_forgot_password_otp(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
--  ✅ Done
-- ============================================================