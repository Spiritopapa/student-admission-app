-- ============================================================
--  Student Admission Portal — Forgot Password (SMS OTP via Nalo)
-- ============================================================
--  Adds the self-service "Forgot Password" flow on the sign-in page.
--  Users identify their account (email or ID), confirm the FULL mobile
--  number on file (a hint shows only its last 3 digits), receive a
--  6-digit OTP by SMS (delivered via /api/send-sms → Nalo gateway), and
--  set a new password.
--
--  What this adds:
--  ✅ profiles.phone  - canonical mobile source for ALL roles
--  ✅ Backfills profiles.phone from role tables where a number already
--     exists (teacher/accountant/school-admin; student → parent contact;
--     parent → ward's parent contact; sub_admin/super_admin need one set)
--  ✅ password_reset_otps  - hashed OTP storage (RLS locked; only the
--     SECURITY DEFINER RPCs below touch it)
--  ✅ Public RPCs callable by logged-OUT users (granted to anon):
--       lookup_forgot_password_account(identifier) → {found, has_phone, role, phone_last3}
--       request_forgot_password_otp(identifier, phone) → {success, otp, phone_last3}
--       verify_forgot_password_otp(identifier, otp, new_password) → {success}
--
--  Security notes:
--  - The OTP is bcrypt-hashed in the DB (never stored in plaintext).
--  - The plaintext OTP is returned ONLY to the caller that already proved
--    they know BOTH the identifier AND the full mobile number; the client
--    delivers it by SMS through /api/send-sms so the Nalo key stays server-side.
--  - Each OTP expires in 10 minutes, is single-use, and allows max 5 attempts.
--  - The identifier → account resolver mirrors the exact logic used at login.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- SECTION 1: profiles.phone (canonical mobile for all roles)
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Backfill where a number already exists (only fills NULLs)
UPDATE public.profiles p
SET phone = t.phone
FROM public.teachers t
WHERE t.user_id = p.id AND p.role = 'teacher'
  AND p.phone IS NULL AND t.phone IS NOT NULL;

UPDATE public.profiles p
SET phone = a.phone
FROM public.accountants a
WHERE a.user_id = p.id AND p.role = 'accountant'
  AND p.phone IS NULL AND a.phone IS NOT NULL;

UPDATE public.profiles p
SET phone = s.phone
FROM public.schools s
WHERE s.user_id = p.id AND p.role = 'admin'
  AND p.phone IS NULL AND s.phone IS NOT NULL;

-- Students: the parent/guardian's mobile is the OTP number (per requirement)
UPDATE public.profiles p
SET phone = a.parent_contact
FROM public.applications a
WHERE a.user_id = p.id AND p.role = 'student'
  AND p.phone IS NULL AND a.parent_contact IS NOT NULL;

-- Parents: use the parent contact of any linked ward
UPDATE public.profiles p
SET phone = a.parent_contact
FROM public.parent_links pl
LEFT JOIN public.applications a ON a.student_id = pl.student_id
WHERE pl.parent_user_id = p.id AND p.role = 'parent'
  AND p.phone IS NULL AND a.parent_contact IS NOT NULL;

-- ============================================================
-- SECTION 2: password_reset_otps
-- ============================================================
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  otp_hash   TEXT NOT NULL,               -- bcrypt hash, never plaintext
  phone      TEXT,                        -- normalized number the OTP was sent to
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
-- No direct RLS policies: direct table access is blocked for everyone.
-- Only the SECURITY DEFINER RPCs in this file read/write this table.

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user
  ON public.password_reset_otps (user_id, created_at DESC);

-- ============================================================
-- SECTION 3: Internal helpers (NOT granted to clients)
-- ============================================================

-- Normalize a Ghana phone to a comparable 9-digit local string.
CREATE OR REPLACE FUNCTION public._fp_normalize_phone(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE v TEXT;
BEGIN
  IF p_input IS NULL THEN RETURN NULL; END IF;
  v := regexp_replace(p_input, '[^0-9]', '', 'g');
  IF v = '' THEN RETURN NULL; END IF;
  IF left(v, 3) = '233' THEN v := right(v, length(v) - 3);
  ELSIF left(v, 1) = '0' THEN v := right(v, length(v) - 1);
  END IF;
  RETURN v;
END;
$$;

-- Resolve a login identifier (email or ID) to the auth user id.
CREATE OR REPLACE FUNCTION public._fp_resolve_login_user(p_identifier TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_id    TEXT := lower(btrim(p_identifier));
  v_email TEXT;
  v_user  UUID;
  v_reg   TEXT;
BEGIN
  IF v_id = '' THEN RETURN NULL; END IF;

  -- Mirror the login logic in js/modules/auth.js
  IF v_id ~ '^stu-[a-z0-9]{5}$' THEN
    v_email := v_id || '@student.local';
  ELSIF v_id ~ '^sa-[0-9]{4}$' THEN
    v_email := v_id || '@subadmin.local';
  ELSIF v_id ~ '^tch-[0-9]{4}$' THEN
    v_email := v_id || '@teacher.local';
  ELSIF v_id ~ '^acc-[0-9]{4}$' THEN
    v_email := v_id || '@accountant.local';
  ELSIF v_id ~ '^sch-[0-9]{4}$' THEN
    v_email := v_id || '@school.local';
  ELSIF strpos(btrim(p_identifier), '@') > 0 THEN
    v_email := v_id;
  ELSE
    -- Possible teacher staff ID → registration_id@teacher.local
    SELECT t.registration_id INTO v_reg
    FROM public.teachers t
    WHERE lower(t.staff_id) = v_id
    LIMIT 1;
    IF v_reg IS NOT NULL THEN
      v_email := lower(v_reg) || '@teacher.local';
    ELSE
      v_email := v_id;
    END IF;
  END IF;

  SELECT id INTO v_user
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  RETURN v_user;
END;
$$;

-- Resolve a user's mobile number (canonical: profiles.phone, then backfill).
CREATE OR REPLACE FUNCTION public._fp_get_user_phone(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_phone TEXT; v_role TEXT;
BEGIN
  SELECT phone, role INTO v_phone, v_role FROM public.profiles WHERE id = p_user_id;
  IF COALESCE(v_phone, '') <> '' THEN RETURN v_phone; END IF;

  IF v_role = 'teacher' THEN
    SELECT phone INTO v_phone FROM public.teachers WHERE user_id = p_user_id AND phone IS NOT NULL LIMIT 1;
  ELSIF v_role = 'accountant' THEN
    SELECT phone INTO v_phone FROM public.accountants WHERE user_id = p_user_id AND phone IS NOT NULL LIMIT 1;
  ELSIF v_role = 'admin' THEN
    SELECT phone INTO v_phone FROM public.schools WHERE user_id = p_user_id AND phone IS NOT NULL LIMIT 1;
  ELSIF v_role = 'student' THEN
    SELECT parent_contact INTO v_phone FROM public.applications WHERE user_id = p_user_id AND parent_contact IS NOT NULL LIMIT 1;
  ELSIF v_role = 'parent' THEN
    SELECT a.parent_contact INTO v_phone
    FROM public.parent_links pl
    LEFT JOIN public.applications a ON a.student_id = pl.student_id
    WHERE pl.parent_user_id = p_user_id AND a.parent_contact IS NOT NULL
    LIMIT 1;
  END IF;

  RETURN v_phone;
END;
$$;

-- ============================================================
-- SECTION 4: Public RPCs (granted to anon for logged-out users)
-- ============================================================

-- Step 1: Confirm the account exists and reveal only the LAST 3 digits of
-- the registered mobile number as a hint.
CREATE OR REPLACE FUNCTION public.lookup_forgot_password_account(p_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_phone   TEXT;
  v_role    TEXT;
BEGIN
  v_user_id := public._fp_resolve_login_user(p_identifier);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  v_phone := public._fp_get_user_phone(v_user_id);

  IF COALESCE(v_phone, '') = '' THEN
    RETURN jsonb_build_object('found', true, 'has_phone', false, 'role', v_role, 'phone_last3', NULL);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'has_phone', true,
    'role', v_role,
    'phone_last3', right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 3)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.lookup_forgot_password_account(TEXT) TO anon, authenticated;

-- Step 2: Verify the FULL mobile number matches the account and generate an
-- OTP. Returns the plaintext OTP to the caller so the app can send it by SMS
-- through /api/send-sms (Nalo gateway).
CREATE OR REPLACE FUNCTION public.request_forgot_password_otp(p_identifier TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_phone   TEXT;
  v_otp     TEXT;
  v_now     TIMESTAMPTZ := now();
BEGIN
  v_user_id := public._fp_resolve_login_user(p_identifier);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account not found. Check the email or ID you entered.');
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

-- Step 3: Validate the OTP and, on success, set the new password.
CREATE OR REPLACE FUNCTION public.verify_forgot_password_otp(p_identifier TEXT, p_otp TEXT, p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_rec     public.password_reset_otps%ROWTYPE;
  v_ok      BOOLEAN;
  v_err     TEXT;
BEGIN
  v_user_id := public._fp_resolve_login_user(p_identifier);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account not found.');
  END IF;

  SELECT * INTO v_rec
  FROM public.password_reset_otps
  WHERE user_id = v_user_id AND used = false
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No verification code was requested. Please start again.');
  END IF;

  IF v_rec.expires_at < now() THEN
    UPDATE public.password_reset_otps SET used = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('success', false, 'error', 'The verification code has expired. Please request a new one.');
  END IF;

  IF v_rec.attempts >= 5 THEN
    UPDATE public.password_reset_otps SET used = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('success', false, 'error', 'Too many incorrect attempts. Please request a new code.');
  END IF;

  v_ok := (crypt(COALESCE(p_otp, ''), v_rec.otp_hash) = v_rec.otp_hash);

  IF NOT v_ok THEN
    UPDATE public.password_reset_otps SET attempts = attempts + 1 WHERE id = v_rec.id;
    RETURN jsonb_build_object('success', false, 'error', 'Invalid verification code. Please try again.');
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 6 characters long.');
  END IF;

  v_err := public._admin_reset_user_password(v_user_id, p_new_password);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  UPDATE public.password_reset_otps SET used = true, attempts = attempts + 1 WHERE id = v_rec.id;

  RETURN jsonb_build_object('success', true, 'message', 'Password reset successfully. You can now sign in with your new password.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_forgot_password_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
--  MIGRATION COMPLETE
--  How to use (client):
--  1. SELECT lookup_forgot_password_account('SCH-0001')  → phone_last3 hint
--  2. SELECT request_forgot_password_otp('SCH-0001','0244...') → otp (send via SMS)
--  3. SELECT verify_forgot_password_otp('SCH-0001','123456','NewPass123')
-- ============================================================
