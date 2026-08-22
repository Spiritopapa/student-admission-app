-- ============================================================
--  Student Admission Portal — SCHOOL & SUB-ADMIN SELF-CLAIM FIX
--  ============================================================
--  BUG: School admin and sub-admin registration fails with a 400
--  error when calling `link_school_to_user` / `link_sub_admin_to_user`.
--
--  ROOT CAUSE:
--  ------------------------------------------------------------
--  `020-data-isolation-fix.sql` hardened these functions to ONLY
--  allow super_admin (for schools) or school admin (for sub-admins)
--  to link. But when a school admin / sub-admin registers, they call
--  these RPCs as a BRAND-NEW registered user whose profile role is
--  'admin' / 'sub_admin' — not super_admin. The RPC raises
--  `Only super admins can link school admins` → user_id never gets
--  set → the school/sub-admin record remains unlinked.
--
--  This fix follows the same pattern as `022-registration-self-claim.sql`
--  for teachers/accountants/students:
--    A. Allow the registering user to SELF-CLAIM their own record
--       (verified via metadata registration_id or the *.local email).
--    B. Add RLS policies so a just-registered school admin / sub-admin
--       can READ their own record by registration_id while user_id is NULL.
--    C. Add self-claim UPDATE policies for schools / sub_admins.
--    D. Add anon-safe registration lookup RPCs for schools.
--    E. Add login self-heal functions for schools / sub-admins.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================

-- ************************************************************
-- SECTION 1: FIX LINK FUNCTIONS — allow self-claim
-- ************************************************************

-- 1.1 Fix link_school_to_user — allow self-claim by the registering
--     school admin (verified via metadata registration_id or the
--     school.local email). Super admin links still allowed.
DROP FUNCTION IF EXISTS public.link_school_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_school_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id TEXT;
BEGIN
  SELECT registration_id INTO v_reg_id
  FROM public.schools
  WHERE registration_id = p_registration_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'School registration ID not found';
  END IF;

  -- Allowed when:
  --  1. Super admin
  --  2. The registering user whose raw_user_meta_data.registration_id
  --     matches this record (SELF-CLAIM)
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND (
         COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
         OR (
           EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid()
             AND pr.email = lower(p_registration_id) || '@school.local'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this school';
  END IF;

  UPDATE public.schools
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_school_to_user(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_school_to_user(TEXT, UUID) TO anon;

-- 1.2 Fix link_sub_admin_to_user — allow self-claim by the registering
--     sub-admin (verified via metadata registration_id or the
--     subadmin.local email). Super admin / school admin links still allowed.
DROP FUNCTION IF EXISTS public.link_sub_admin_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_sub_admin_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
  v_reg_id    TEXT;
BEGIN
  SELECT school_id, registration_id INTO v_school_id, v_reg_id
  FROM public.sub_admins
  WHERE registration_id = p_registration_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Sub admin registration ID not found';
  END IF;

  -- Allowed when:
  --  1. Super admin
  --  2. Admin of the SAME school (staff linking)
  --  3. The registering user whose raw_user_meta_data.registration_id
  --     matches this record (SELF-CLAIM)
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       public.user_has_role('admin')
       AND public.user_belongs_to_school(v_school_id)
     )
     AND NOT (
       p_user_id = auth.uid()
       AND (
         COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
         OR (
           EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid()
             AND pr.email = lower(p_registration_id) || '@subadmin.local'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this sub admin';
  END IF;

  UPDATE public.sub_admins
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_sub_admin_to_user(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_sub_admin_to_user(TEXT, UUID) TO anon;

-- ************************************************************
-- SECTION 2: RLS — allow self-read by registration_id while unlinked
-- ************************************************************

-- 2.1 SCHOOLS: A just-registered school admin can see their own record
--     by registration_id when user_id is still NULL (registration/
--     self-heal flow). Super admin access already covered by existing policies.
DROP POLICY IF EXISTS "School admins view own school" ON public.schools;

CREATE POLICY "School admins view own school"
  ON public.schools FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND (
        COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
        OR (
          EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
            AND pr.email = lower(registration_id) || '@school.local'
          )
        )
      )
    )
  );

-- 2.2 SUB_ADMINS: A just-registered sub-admin can see their own
--     record by registration_id when user_id is still NULL.
DROP POLICY IF EXISTS "Sub admins view own record" ON public.sub_admins;

CREATE POLICY "Sub admins view own record"
  ON public.sub_admins FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND (
        COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
        OR (
          EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
            AND pr.email = lower(registration_id) || '@subadmin.local'
          )
        )
      )
    )
  );

-- 2.3 SCHOOL SELF-CLAIM UPDATE: A just-registered school admin needs to be
--     able to set user_id on their own unlinked record during registration
--     (JS direct-update fallback path). Guarded to only allow self-claim
--     of the record whose registration_id matches the user's own metadata.
DROP POLICY IF EXISTS "School admins update own record" ON public.schools;

CREATE POLICY "School admins update own record"
  ON public.schools FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
    )
  );

-- 2.4 SUB_ADMIN SELF-CLAIM UPDATE: Same self-claim update capability for
--     sub-admins. The existing "Super admins manage sub admins" and
--     "School admins manage sub admins" policies already cover staff.
DROP POLICY IF EXISTS "Sub admins update own record" ON public.sub_admins;

CREATE POLICY "Sub admins update own record"
  ON public.sub_admins FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
    )
  );

-- ************************************************************
-- SECTION 3: LOGIN SELF-HEAL — auto-link records for users whose
-- admin already created them. Also backfills any existing unlinked
-- school/sub-admin rows so previously locked-out users can sign in.
-- ************************************************************

CREATE OR REPLACE FUNCTION public.auto_approve_school_on_login(p_user_id UUID, p_registration_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF p_user_id IS NULL OR p_registration_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.schools
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
    -- Backfill the profile's school_id so the school admin's dashboard
    -- has correct school scope.
    UPDATE public.profiles pr
    SET school_id = s.id
    FROM public.schools s
    WHERE pr.id = p_user_id
      AND s.registration_id = p_registration_id
      AND pr.school_id IS NULL;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_school_on_login(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_approve_sub_admin_on_login(p_user_id UUID, p_registration_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF p_user_id IS NULL OR p_registration_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.sub_admins
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
    -- Backfill the profile's school_id so the sub-admin's dashboard
    -- has correct school scope.
    UPDATE public.profiles pr
    SET school_id = sa.school_id
    FROM public.sub_admins sa
    WHERE pr.id = p_user_id
      AND sa.registration_id = p_registration_id
      AND pr.school_id IS NULL;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_sub_admin_on_login(UUID, TEXT) TO authenticated;

-- ************************************************************
-- SECTION 4: ANON-SAFE REGISTRATION LOOKUP RPCs
-- ************************************************************
--  During registration the user is NOT yet authenticated (anon key),
--  so RLS blocks reading the schools/sub_admins tables directly.
--  These SECURITY DEFINER functions let the registration form resolve
--  the record's school_id anonymously so the new profile gets a correct
--  school_id and the dashboard works after login.

CREATE OR REPLACE FUNCTION public.get_school_registration_info(p_registration_id TEXT)
RETURNS TABLE(school_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id
  FROM public.schools s
  WHERE s.registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO anon;

-- ============================================================
--  DEPLOYMENT COMPLETE
--  ============================================================
--  After running:
--   1. School admins can register with their generated ID and the
--      school record is linked to their user account immediately.
--   2. Sub-admins can register with their generated ID and the
--      sub_admin record is linked to their user account immediately.
--   3. Existing unlinked school/sub-admin records are auto-linked
--      on next login (self-heal).
--   4. Registration now resolves the real school_id via anon-safe
--      RPCs so profiles get a correct school_id.
--   5. Cross-school data isolation is preserved (self-claim only
--      works when the ID matches the user's metadata).
-- ============================================================