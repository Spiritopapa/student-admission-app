-- ============================================================
--  Student Admission Portal — SCHOOL ONBOARDING PERSISTENCE FIX
--  ============================================================
--  PROBLEM:
--    After a school completes the 4-stage registration wizard and the
--    account is created, the school info provided in stage 3 (admin
--    name, school type, location, student population, email, mobile)
--    sometimes never appears on the Super Admin dashboard.
--
--  ROOT CAUSES ADDRESSED:
--    1. The onboarding data was only persisted by the anon-safe RPC
--       `save_school_onboarding_info`, which silently skipped saving
--       when the school row was not yet claimed (`user_id IS NULL`).
--    2. The final "Register as School" submit step (js/modules/auth.js)
--       did NOT re-save the onboarding info, so if the single stage-3
--       save was skipped/failed the account was created without the
--       data ever landing on the schools row.
--    3. The old RPC could not be re-run after the school row was linked
--       to the admin, so a final re-save at account-creation time would
--       have returned false.
--
--  THIS SCRIPT:
--    1. Idempotently recreates the onboarding columns (safe even if
--       044-school-onboarding.sql was never applied to the live DB).
--    2. Relaxes save_school_onboarding_info so the linked school admin
--       can re-persist their OWN onboarding info after the account is
--       created (auth.uid() = user_id), while anon callers can still
--       only fill an UNCLAIMED school (no loss of security).
--    3. Re-applies the anon + authenticated grants.
--
--  HOW TO APPLY:
--    Open Supabase Dashboard → SQL Editor → run this file (or re-run
--    sql/000-run-all.sql). It is fully idempotent (safe to re-run).
-- ============================================================

-- ---------------------------------------------------------------
-- 1. ENSURE THE ONBOARDING COLUMNS EXIST (safe even if 044 was missed)
-- ---------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admin_name TEXT,
  ADD COLUMN IF NOT EXISTS school_type TEXT CHECK (school_type IN ('public','private')),
  ADD COLUMN IF NOT EXISTS student_population INTEGER,
  ADD COLUMN IF NOT EXISTS location TEXT;

-- Backfill location from the existing address column for convenience.
UPDATE public.schools
SET location = COALESCE(location, address)
WHERE location IS NULL AND address IS NOT NULL;

-- ---------------------------------------------------------------
-- 2. REDEFINE save_school_onboarding_info (guaranteed persistence)
--    Allows:
--      - anon / any caller while the school row is unclaimed
--        (user_id IS NULL)  → the normal wizard stage-3 save; and
--      - the school's OWN linked admin (user_id = auth.uid())
--        → a final re-save at account-creation/submit time so the
--          Super Admin dashboard always shows the provided details.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_school_onboarding_info(
  p_registration_id   TEXT,
  p_admin_name        TEXT,
  p_school_type       TEXT,
  p_location          TEXT,
  p_email             TEXT,
  p_phone             TEXT,
  p_student_population INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN := false;
BEGIN
  IF p_school_type IS NULL OR p_school_type NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'school_type must be "public" or "private".';
  END IF;

  UPDATE public.schools
  SET admin_name          = NULLIF(p_admin_name, ''),
      school_type         = p_school_type,
      location            = COALESCE(NULLIF(p_location, ''), location, address),
      address             = COALESCE(NULLIF(p_location, ''), address),
      email               = COALESCE(NULLIF(p_email, ''), email),
      phone               = COALESCE(NULLIF(p_phone, ''), phone),
      student_population  = COALESCE(p_student_population, student_population),
      updated_at          = now()
  WHERE registration_id = p_registration_id
    AND (
      user_id IS NULL
      OR user_id = auth.uid()
    )
  RETURNING true INTO v_found;

  RETURN v_found;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_school_onboarding_info(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.save_school_onboarding_info(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================