-- ============================================================
--  Student Admission Portal — LOGIN ID FORMAT RESOLUTION FIX
-- ============================================================
--  WHAT HAPPENED
--  -------------
--  Role registration IDs changed format over time:
--    Old: SCH-0001 / TCH-0001 / ACC-0001           (plain 4-digit serial)
--    New: SCH-SIS-0001 / TCH-SIN-0001 / ACC-SIN-0001
--         (up to 3 school-name initials + 4-digit serial —
--          see sql/044-school-onboarding.sql and sql/046-per-school-staff-ids.sql)
--
--  The "forgot password" identifier resolver (public._fp_resolve_login_user)
--  only recognised the OLD format, so admins/teachers/accountants with a
--  new-format ID could not be found by the SMS password-reset flow.
--  This file re-creates that resolver so it accepts BOTH formats.
--  The browser sign-in was fixed in js/modules/auth.js (same rule).
--
--  HOW TO RUN
--  ----------
--  Supabase Dashboard → SQL Editor → paste this whole file → Run.
--  Safe to re-run (CREATE OR REPLACE FUNCTION).
-- ============================================================

-- Resolve a login identifier (email or ID) to the auth user id.
-- Mirrors the resolver in js/modules/auth.js setupLoginForm().
-- The optional ([a-z0-9]{1,3}-)? group accepts BOTH the old format
-- (TCH-0001) and the per-school initials format (TCH-SIN-0001).
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
  ELSIF v_id ~ '^tch-([a-z0-9]{1,3}-)?[0-9]{4}$' THEN
    v_email := v_id || '@teacher.local';
  ELSIF v_id ~ '^acc-([a-z0-9]{1,3}-)?[0-9]{4}$' THEN
    v_email := v_id || '@accountant.local';
  ELSIF v_id ~ '^sch-([a-z0-9]{1,3}-)?[0-9]{4}$' THEN
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

-- ============================================================
--  OPTIONAL: "Email not confirmed" on sign-in?
-- ------------------------------------------------------------
--  If your project ever had "Confirm email" switched ON (it is the
--  Supabase default), accounts that were created while it was ON —
--  especially synthetic accounts like admin@school.local which have
--  no real mailbox — can never click a confirmation link, so sign-in
--  returns HTTP 400 "Email not confirmed" even with the correct
--  password. Turning the setting OFF does NOT retroactively confirm
--  those users. If that is your situation, uncomment and run:
--
--  UPDATE auth.users
--  SET email_confirmed_at = COALESCE(email_confirmed_at, now())
--  WHERE email_confirmed_at IS NULL
--    AND email LIKE '%.local';
--
--  (You can also confirm individual users under Dashboard →
--   Authentication → Users and clicking "Confirm".)
-- ============================================================