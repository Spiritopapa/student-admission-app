-- ============================================================
--  Student Admission Portal -- LOGIN & SELF-CLAIM ACCESS FIX
--  Migration 096
-- ============================================================
--
--  PURPOSE:
--    1. Grant EXECUTE to anon on functions called BEFORE sign-in/sign-up
--       (Supabase stopped auto-granting Data API access to new functions
--       effective 30 Oct 2026; without these, login/registration returns
--       "permission denied" for unauthenticated users).
--
--    2. Add RLS UPDATE policies so school admins, sub-admins, teachers,
--       and accountants can SELF-CLAIM their own unlinked record (set
--       user_id = auth.uid()) when user_id is NULL and the registration_id
--       matches their auth user_metadata or profile email. This fixes the
--       inconsistent login where some staff could sign in (already linked)
--       and others got "something went wrong" (direct UPDATE fallback was
--       blocked by RLS).
--
--  IDENTICAL TO: changes made in sql/035-data-isolation-closure.sql and
--  sql/095-data-api-grants.sql, consolidated here for standalone deployment.
--
--  SAFE TO RE-RUN: uses IF EXISTS guards and DROP POLICY IF EXISTS.
-- ============================================================

-- ============================================================
--  PART 1: Anon EXECUTE grants (functions called before auth)
-- ============================================================

-- Teacher staff-ID login lookup (called as anon during login when the
-- entered ID doesn't match the TCH-#### pattern).
GRANT EXECUTE ON FUNCTION public.get_teacher_info_by_staff_id(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_info_by_staff_id(TEXT) TO authenticated;

-- Registration ID existence checks (called as anon during registration
-- before the user has signed up).
GRANT EXECUTE ON FUNCTION public.check_student_id_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_teacher_id_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_accountant_id_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_school_id_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_sub_admin_id_exists(TEXT) TO anon;

-- ============================================================
--  PART 2: Self-claim UPDATE RLS policies (fixes inconsistent login)
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 School admin claims own unlinked school
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "School admin claims own unlinked school" ON public.schools;

CREATE POLICY "School admin claims own unlinked school"
  ON public.schools FOR UPDATE
  USING (
    public.user_has_role('admin')
    AND user_id IS NULL
    AND (
      COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.email = lower(registration_id) || '@school.local'
      )
    )
  )
  WITH CHECK (
    public.user_has_role('admin')
    AND user_id = auth.uid()
  );

-- ------------------------------------------------------------
-- 2.2 Sub admin claims own unlinked record
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Sub admin claims own unlinked record" ON public.sub_admins;

CREATE POLICY "Sub admin claims own unlinked record"
  ON public.sub_admins FOR UPDATE
  USING (
    public.user_has_role('sub_admin')
    AND user_id IS NULL
    AND (
      COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.email = lower(registration_id) || '@subadmin.local'
      )
    )
  )
  WITH CHECK (
    public.user_has_role('sub_admin')
    AND user_id = auth.uid()
  );

-- ------------------------------------------------------------
-- 2.3 Teacher claims own unlinked record
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Teacher claims own unlinked record" ON public.teachers;

CREATE POLICY "Teacher claims own unlinked record"
  ON public.teachers FOR UPDATE
  USING (
    public.user_has_role('teacher')
    AND user_id IS NULL
    AND (
      COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.email = lower(registration_id) || '@teacher.local'
      )
    )
  )
  WITH CHECK (
    public.user_has_role('teacher')
    AND user_id = auth.uid()
  );

-- ------------------------------------------------------------
-- 2.4 Accountant claims own unlinked record
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Accountant claims own unlinked record" ON public.accountants;

CREATE POLICY "Accountant claims own unlinked record"
  ON public.accountants FOR UPDATE
  USING (
    public.user_has_role('accountant')
    AND user_id IS NULL
    AND (
      COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.email = lower(registration_id) || '@accountant.local'
      )
    )
  )
  WITH CHECK (
    public.user_has_role('accountant')
    AND user_id = auth.uid()
  );

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  After running this migration:
--   1. Teacher staff-ID login lookup works for unauthenticated users.
--   2. Registration ID validation works for unauthenticated users.
--   3. School admin / sub admin / teacher / accountant can self-claim
--      their unlinked record during login, fixing the "something went
--      wrong" error for staff whose account was not yet linked.
-- ============================================================
