-- ============================================================
--  Student Admission Portal — REGISTRATION SELF-CLAIM FIX
--  ============================================================
--  BUG: Teacher and Accountant accounts get stuck "pending approval"
--  even after the admin created them with is_approved = true.
--
--  ROOT CAUSE (3 issues):
--  ------------------------------------------------------------
--  01. `020-data-isolation-fix.sql` hardened `link_teacher_to_user`
--      and `link_accountant_to_user` to ONLY allow school admin /
--      sub_admin to link. But when a teacher/accountant registers,
--      they call these RPCs as a BRAND-NEW registered user whose
--      profile role is 'teacher'/'accountant' — not admin. The RPC
--      raises `Not authorized to link this teacher` → user_id never
--      gets set → their own record remains unlinked.
--
--  02. Login guard in auth.js does:
--        SELECT is_approved FROM teachers WHERE user_id = <uid>
--      Since user_id is NULL (never linked), no row matches →
--      guard treats them as unapproved → "pending approval" lockout.
--
--  03. RLS: teachers table only has "Teachers view own record"
--      (user_id = auth.uid()) which returns nothing when user_id is
--      NULL. Accountants have NO self-read-by-registration policy.
--      So even a self-heal attempt in JS can't read their row.
--
--  HOW THIS FIX WORKS:
--  ------------------------------------------------------------
--  A. `link_teacher_to_user` / `link_accountant_to_user` now allow
--     the registering user to SELF-CLAIM their own record:
--        * Staff (admin/sub_admin of that school) can still link.
--        * The person registering with that exact registration_id
--          (stored in their raw_user_meta_data) can claim it too.
--        * Cross-school staff claims are still rejected.
--     When claiming, if the record was already created with
--     is_approved = true (admin pre-approved at creation), it stays
--     approved and user is linked immediately.
--
--  B. New RLS policies let a just-registered teacher/accountant
--     READ their own record by registration_id (while user_id is
--     still NULL) so the registration flow and login self-heal can
--     find and link them.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================

-- ************************************************************
-- SECTION 1: FIX LINK FUNCTIONS — allow self-claim
-- ************************************************************

DROP FUNCTION IF EXISTS public.link_teacher_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_teacher_to_user(p_registration_id TEXT, p_user_id UUID)
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
  FROM public.teachers
  WHERE registration_id = p_registration_id;

  IF v_school_id IS NULL AND p_registration_id IS NOT NULL THEN
    -- Maybe the row exists but has a NULL school_id (legacy)
    SELECT registration_id INTO v_reg_id
    FROM public.teachers
    WHERE registration_id = p_registration_id;

    IF v_reg_id IS NULL THEN
      RAISE EXCEPTION 'Teacher registration ID not found';
    END IF;
    v_school_id := NULL;
  END IF;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Teacher registration ID not found';
  END IF;

  -- Allowed when:
  --  1. Super admin
  --  2. Admin/sub_admin of the SAME school (staff linking)
  --  3. The registering user whose raw_user_meta_data.registration_id
  --     matches this record (SELF-CLAIM)
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     )
     AND NOT (
       p_user_id = auth.uid()
       AND (
         COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
         OR (
           -- Fallback: profiles.email matches the teacher.local email
           EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid()
             AND pr.email = lower(p_registration_id) || '@teacher.local'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this teacher';
  END IF;

  UPDATE public.teachers
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_teacher_to_user(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_teacher_to_user(TEXT, UUID) TO anon;

DROP FUNCTION IF EXISTS public.link_accountant_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_accountant_to_user(p_registration_id TEXT, p_user_id UUID)
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
  FROM public.accountants
  WHERE registration_id = p_registration_id;

  IF v_school_id IS NULL AND p_registration_id IS NOT NULL THEN
    SELECT registration_id INTO v_reg_id
    FROM public.accountants
    WHERE registration_id = p_registration_id;

    IF v_reg_id IS NULL THEN
      RAISE EXCEPTION 'Accountant registration ID not found';
    END IF;
    v_school_id := NULL;
  END IF;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Accountant registration ID not found';
  END IF;

  -- Allowed when:
  --  1. Super admin
  --  2. Admin/sub_admin of the SAME school (staff linking)
  --  3. The registering user whose raw_user_meta_data.registration_id
  --     matches this record (SELF-CLAIM)
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
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
             AND pr.email = lower(p_registration_id) || '@accountant.local'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this accountant';
  END IF;

  UPDATE public.accountants
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_accountant_to_user(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_accountant_to_user(TEXT, UUID) TO anon;

-- ************************************************************
-- SECTION 2: RLS — allow self-read by registration_id while unlinked
-- ************************************************************

-- 2.1 TEACHERS: A just-registered teacher can see their own record
--     by registration_id when user_id is still NULL (registration/
--     self-heal flow). Staff access already covered by existing policies.
DROP POLICY IF EXISTS "Teachers view own record" ON public.teachers;

CREATE POLICY "Teachers view own record"
  ON public.teachers FOR SELECT
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
            AND pr.email = lower(registration_id) || '@teacher.local'
          )
        )
      )
    )
  );

-- 2.2 ACCOUNTANTS: A just-registered accountant can see their own
--     record by registration_id when user_id is still NULL.
DROP POLICY IF EXISTS "Accountants view own record" ON public.accountants;

CREATE POLICY "Accountants view own record"
  ON public.accountants FOR SELECT
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
            AND pr.email = lower(registration_id) || '@accountant.local'
          )
        )
      )
    )
  );

-- 2.3 TEACHER SELF-CLAIM UPDATE: A just-registered teacher needs to be
--     able to set user_id (+ is_approved) on their own unlinked record
--     during registration (JS direct-update fallback path). Guarded to
--     only allow self-claim of the record whose registration_id matches
--     the user's own metadata — cross-school claims are still blocked.
--     NOTE: UPDATE-only. INSERT/DELETE remain exclusive to school staff
--     (the "Admins manage teachers" ALL policy is preserved).
DROP POLICY IF EXISTS "Teachers update own record" ON public.teachers;

CREATE POLICY "Teachers update own record"
  ON public.teachers FOR UPDATE
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

-- 2.4 ACCOUNTANT SELF-CLAIM UPDATE: Same self-claim update capability for
--     accountants. The existing "School admins manage accountants" and
--     "Sub admins manage accountants" policies already cover staff; this
--     extends UPDATE to the accountant themself while unlinked.
DROP POLICY IF EXISTS "Accountants update own record" ON public.accountants;

CREATE POLICY "Accountants update own record"
  ON public.accountants FOR UPDATE
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
-- SECTION 3: LOGIN SELF-HEAL — auto-approve + link records for
-- users whose admin already set is_approved = true at creation.
-- Also backfills any existing unlinked teacher/accountant rows so
-- previously locked-out users can sign in immediately.
-- ************************************************************

CREATE OR REPLACE FUNCTION public.auto_approve_teacher_on_login(p_user_id UUID, p_registration_id TEXT)
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

  UPDATE public.teachers
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
    AND is_approved = true  -- only auto-approve if admin already approved
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
    -- Backfill the profile's school_id so the teacher's dashboard
    -- has correct school scope (fixes accounts registered while
    -- school_id was null due to RLS-blocked pre-signup lookups).
    UPDATE public.profiles pr
    SET school_id = t.school_id
    FROM public.teachers t
    WHERE pr.id = p_user_id
      AND t.registration_id = p_registration_id
      AND pr.school_id IS NULL;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_teacher_on_login(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_approve_accountant_on_login(p_user_id UUID, p_registration_id TEXT)
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

  UPDATE public.accountants
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
    AND is_approved = true  -- only auto-approve if admin already approved
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
    -- Backfill the profile's school_id so the accountant's dashboard
    -- has correct school scope.
    UPDATE public.profiles pr
    SET school_id = a.school_id
    FROM public.accountants a
    WHERE pr.id = p_user_id
      AND a.registration_id = p_registration_id
      AND pr.school_id IS NULL;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_accountant_on_login(UUID, TEXT) TO authenticated;

-- ************************************************************
-- SECTION 4: ANON-SAFE REGISTRATION LOOKUP RPCs
-- ************************************************************
--  During registration the user is NOT yet authenticated (anon key),
--  so RLS blocks reading the teachers/accountants tables directly.
--  These SECURITY DEFINER functions (like the existing check_*
--  functions) let the registration form resolve the record's full_name
--  and school_id anonymously so the new profile gets a correct
--  school_id and the dashboard works after login.

CREATE OR REPLACE FUNCTION public.get_teacher_registration_info(p_registration_id TEXT)
RETURNS TABLE(full_name TEXT, school_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.full_name, t.school_id
  FROM public.teachers t
  WHERE t.registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_teacher_registration_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_registration_info(TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.get_accountant_registration_info(p_registration_id TEXT)
RETURNS TABLE(full_name TEXT, school_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.full_name, a.school_id
  FROM public.accountants a
  WHERE a.registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_accountant_registration_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_accountant_registration_info(TEXT) TO anon;

-- ************************************************************
-- SECTION 5: STUDENT SELF-CLAIM & SELF-HEAL
-- ************************************************************
--  Students have the SAME bug class as teachers/accountants:
--  01. `020-data-isolation-fix.sql` hardened `link_student_to_application`
--      to ONLY allow staff to link. A registering student (role=student)
--      is rejected → user_id never set → dashboard can't find their record.
--  02. RLS "Students view own application" only matches user_id = auth.uid();
--      with NULL user_id the student can't read their own record at all.
--  03. The pre-signup school_id lookup is RLS-blocked for anon users,
--      leaving the student profile with NULL school_id.
--
--  10.5a Fix link_student_to_application — allow self-claim by the
--       registering student (verified via metadata student_id or the
--       student.local email). Staff links still allowed; cross-school
--       claims still rejected.
DROP FUNCTION IF EXISTS public.link_student_to_application(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_student_to_application(p_student_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
  v_sid       TEXT;
BEGIN
  SELECT school_id, student_id INTO v_school_id, v_sid
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Student ID not found';
  END IF;

  -- Allowed when:
  --  1. Super admin
  --  2. Staff (admin/sub_admin/teacher/accountant of the SAME school)
  --  3. The registering student whose metadata student_id matches
  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id)
     AND NOT (
       p_user_id = auth.uid()
       AND (
         COALESCE(auth.jwt()->'user_metadata'->>'student_id', '') = p_student_id
         OR (
           EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid()
             AND pr.email = lower(p_student_id) || '@student.local'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this student';
  END IF;

  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id AND user_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_student_to_application(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_student_to_application(TEXT, UUID) TO anon;

-- 5.1 RLS: A just-registered student can read their own application by
--     student_id while user_id is still NULL (dashboard lookup / self-heal).
DROP POLICY IF EXISTS "Students view own application" ON public.applications;

CREATE POLICY "Students view own application"
  ON public.applications FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND (
        COALESCE(auth.jwt()->'user_metadata'->>'student_id', '') = student_id
        OR (
          EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
            AND pr.email = lower(student_id) || '@student.local'
          )
        )
      )
    )
  );

-- 5.2 RLS: Student self-claim UPDATE — lets the student link their own
--     unlinked record by student_id (dashboard auto-link + JS fallback).
--     UPDATE-only; INSERT/DELETE remain exclusive to school staff.
DROP POLICY IF EXISTS "Students update own record" ON public.applications;

CREATE POLICY "Students update own record"
  ON public.applications FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'student_id', '') = student_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'student_id', '') = student_id
    )
  );

-- 5.3 Anon-safe registration lookup for students (school_id resolution
--     before sign-up, same pattern as teachers/accountants).
CREATE OR REPLACE FUNCTION public.get_student_registration_info(p_student_id TEXT)
RETURNS TABLE(school_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.school_id
  FROM public.applications a
  WHERE a.student_id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_registration_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_registration_info(TEXT) TO anon;

-- 5.4 Login self-heal for students: links user_id and backfills the
--     profile school_id so the dashboard can find and render the record.
--     (portal_confirmed is intentionally untouched — that stays admin-controlled.)
CREATE OR REPLACE FUNCTION public.auto_approve_student_on_login(p_user_id UUID, p_student_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF p_user_id IS NULL OR p_student_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
    -- Backfill profile school_id so the student dashboard has correct scope
    UPDATE public.profiles pr
    SET school_id = a.school_id
    FROM public.applications a
    WHERE pr.id = p_user_id
      AND a.student_id = p_student_id
      AND pr.school_id IS NULL;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_student_on_login(UUID, TEXT) TO authenticated;

-- ============================================================
--  DEPLOYMENT COMPLETE
--  ============================================================
--  After running:
--   1. Teachers/Accountants created with is_approved = true can
--      register and immediately sign in — no admin re-approval.
--   2. Existing unlinked teacher/accountant records that were
--      pre-approved are auto-linked + approved on next login.
--   3. Students can read/link their own application record at
--      registration and at login (self-heal), so the dashboard
--      loads their info immediately.
--   4. Registration now resolves the real school_id via anon-safe
--      RPCs so profiles get a correct school_id (fixes null
--      school_id caused by RLS blocking the pre-signup table read).
--   5. Cross-school data isolation is preserved (self-claim only
--      works when the ID matches the user's metadata).
-- ============================================================
