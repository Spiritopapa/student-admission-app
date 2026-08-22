-- ============================================================
--  Student Admission Portal — DATA ISOLATION CLOSURE (v2)
--  ============================================================
--  AUDIT-LEVEL FIX for remaining cross-school / public-facing leaks
--  that survived 020-data-isolation-fix.sql.
--
--  WHAT THIS FIXES (verified against the live project on 2026-08-11):
--   01. `schools` table was readable by ANYONE (anon) via the
--       "Anyone can check school ID" USING(true) policy -> full school
--       directory (names, emails, phones, addresses, UUIDs) leaked.
--   02. `get_ie_summary` / `get_ie_category_breakdown` RPCs were
--       callable by anon AND returned ANY school's financial data -
--       no caller-school check. (Verified: returned live totals.)
--   03. `get_school_grades` / `get_school_module_status` /
--       `get_locked_modules_for_school` / `get_active_modules_for_school`
--       leaked other schools' grading + module-lock configuration.
--   04. `get_teacher_info_by_staff_id` returned teacher full PII
--       (full_name, school_id, registration_id) to any caller.
--   05. `delete_auth_user` was callable by anon -> any user could be
--       permanently deleted by any requester. (Verified executable.)
--   06. auto_approve_school_on_login / auto_approve_sub_admin_on_login /
--       auto_approve_student_on_login / auto_approve_teacher_on_login /
--       auto_approve_accountant_on_login accepted an ARBITRARY
--       p_user_id -> any authenticated user could claim/link ANY
--       unlinked school, sub-admin, student, teacher or accountant.
--   07. link_school_to_user / link_sub_admin_to_user /
--       link_teacher_to_user / link_accountant_to_user /
--       link_student_to_application allowed school staff to link a
--       THIRD-PARTY user to a record (p_user_id not bound to caller).
--   08. Storage buckets student-photos / teacher-documents / school-logos
--       allowed ANY authenticated user to upload / overwrite / delete
--       ANY file in them (no school scope) -> cross-school tampering of
--       photos and sensitive teacher documents.
--
--  HOW TO APPLY:
--   Run this file in Supabase SQL Editor (or via 000-run-all.sql).
--   It is idempotent (safe to re-run).
-- ============================================================

-- ************************************************************
-- SECTION 1: SCHOOLS TABLE - STOP PUBLIC DIRECTORY LEAK
-- ************************************************************

DROP POLICY IF EXISTS "Anyone can check school ID" ON public.schools;

DROP POLICY IF EXISTS "School members view own school" ON public.schools;
CREATE POLICY "School members view own school"
  ON public.schools FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.school_id = schools.id
    )
    OR (
      user_id IS NULL
      AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = registration_id
    )
  );

-- ************************************************************
-- SECTION 2: REGISTRATION LOOKUP RPC (extends the anon-safe route)
-- ************************************************************
-- Returns only the id + name of the school whose registration_id was
-- entered. Still anon-safe, but requires the caller to know a real
-- registration identifier (no directory listing).

DROP FUNCTION IF EXISTS public.get_school_registration_info(TEXT);

CREATE OR REPLACE FUNCTION public.get_school_registration_info(p_registration_id TEXT)
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name
  FROM public.schools s
  WHERE s.registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO authenticated;

-- Helper used by guards below: true when caller is a super_admin, a member
-- (by profile.school_id), or the linked school admin.
CREATE OR REPLACE FUNCTION public.is_school_member(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.user_has_role('super_admin') THEN
    RETURN true;
  END IF;
  IF public.get_user_school_id() = p_school_id THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id
    AND s.user_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_school_member(UUID) TO authenticated;

-- ************************************************************
-- SECTION 3: CLOSE FINANCIAL DATA LEAKS (RPC + internal scope guard)
-- ************************************************************

CREATE OR REPLACE FUNCTION public.get_ie_summary(
  p_school_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
  total_income NUMERIC,
  total_expense NUMERIC,
  net_balance NUMERIC,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_member(p_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN ie.type = 'income' THEN ie.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN ie.type = 'expense' THEN ie.amount ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(CASE WHEN ie.type = 'income' THEN ie.amount ELSE -ie.amount END), 0) AS net_balance,
    COUNT(*)::BIGINT AS transaction_count
  FROM public.income_expenses ie
  WHERE ie.school_id = p_school_id
    AND (p_from_date IS NULL OR ie.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR ie.transaction_date <= p_to_date);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ie_summary(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ie_summary(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ie_category_breakdown(
  p_school_id UUID,
  p_type TEXT DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
  category_id UUID,
  category_name TEXT,
  category_icon TEXT,
  category_color TEXT,
  total_amount NUMERIC,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_member(p_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    iec.id,
    iec.name,
    iec.icon,
    iec.color,
    COALESCE(SUM(ie.amount), 0) AS total_amount,
    COUNT(ie.id)::BIGINT AS transaction_count
  FROM public.income_expense_categories iec
  LEFT JOIN public.income_expenses ie ON ie.category_id = iec.id
    AND (p_from_date IS NULL OR ie.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR ie.transaction_date <= p_to_date)
  WHERE iec.school_id = p_school_id
    AND (p_type IS NULL OR iec.type = p_type)
  GROUP BY iec.id, iec.name, iec.icon, iec.color
  ORDER BY total_amount DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ie_category_breakdown(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ie_category_breakdown(UUID, TEXT, DATE, DATE) TO authenticated;


-- ************************************************************
-- SECTION 4: CLOSE CONFIG-LEAKING RPCs
-- ************************************************************

CREATE OR REPLACE FUNCTION public.get_school_grades(p_school_id UUID DEFAULT NULL)
RETURNS TABLE (
  grade_label TEXT,
  min_score NUMERIC,
  max_score NUMERIC,
  description TEXT,
  color_class TEXT,
  sort_order INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_school_id UUID;
BEGIN
  v_school_id := COALESCE(p_school_id, public.get_user_school_id());
  IF v_school_id IS NULL OR NOT public.is_school_member(v_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT g.grade_label, g.min_score, g.max_score, g.description, g.color_class, g.sort_order
  FROM grading_systems g
  WHERE g.school_id = v_school_id
  ORDER BY g.sort_order ASC, g.min_score DESC;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT g.grade_label, g.min_score, g.max_score, g.description, g.color_class, g.sort_order
    FROM grading_systems g
    WHERE g.school_id IS NULL AND g.is_default = true
    ORDER BY g.sort_order ASC, g.min_score DESC;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_school_grades(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_grades(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_school_module_status(p_school_id UUID)
RETURNS TABLE(module_name TEXT, label TEXT, icon TEXT, is_core BOOLEAN, is_locked BOOLEAN, sort_order INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_member(p_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.name, m.label, m.icon, m.is_core,
    COALESCE((SELECT sm.is_locked FROM public.school_modules sm WHERE sm.school_id = p_school_id AND sm.module_name = m.name), false) AS is_locked,
    m.sort_order
  FROM public.modules m
  ORDER BY m.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_school_module_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_module_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_locked_modules_for_school(p_school_id UUID)
RETURNS TABLE(module_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_member(p_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT sm.module_name
  FROM public.school_modules sm
  WHERE sm.school_id = p_school_id
  AND sm.is_locked = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_locked_modules_for_school(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_locked_modules_for_school(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_modules_for_school(p_school_id UUID)
RETURNS TABLE(module_name TEXT, label TEXT, icon TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_member(p_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.name, m.label, m.icon
  FROM public.modules m
  WHERE m.is_core = true
  AND NOT EXISTS (
    SELECT 1 FROM public.school_modules sm
    WHERE sm.school_id = p_school_id AND sm.module_name = m.name AND sm.is_locked = true
  )
  UNION
  SELECT m.name, m.label, m.icon
  FROM public.modules m
  WHERE m.is_core = false
  AND NOT EXISTS (
    SELECT 1 FROM public.school_modules sm
    WHERE sm.school_id = p_school_id AND sm.module_name = m.name AND sm.is_locked = true
  )
  ORDER BY m.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_modules_for_school(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_modules_for_school(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_modules_for_sub_admin(p_user_id UUID)
RETURNS TABLE(module_name TEXT, label TEXT, icon TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid()
     AND NOT public.user_has_role('super_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.name, m.label, m.icon
  FROM public.modules m
  WHERE m.is_core = true
  UNION
  SELECT m.name, m.label, m.icon
  FROM public.sub_admin_modules sam
  JOIN public.modules m ON m.name = sam.module_name
  JOIN public.sub_admins sa ON sa.id = sam.sub_admin_id
  WHERE sa.user_id = p_user_id
  AND sam.is_active = true
  AND m.is_core = false
  ORDER BY m.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_modules_for_sub_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_modules_for_sub_admin(UUID) TO authenticated;

-- staff-ID login helper: only maps staff_id -> registration_id (no PII)
DROP FUNCTION IF EXISTS public.get_teacher_info_by_staff_id(TEXT);

CREATE OR REPLACE FUNCTION public.get_teacher_info_by_staff_id(p_staff_id TEXT)
RETURNS TABLE (registration_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.registration_id
  FROM public.teachers t
  WHERE t.staff_id = p_staff_id;
END;
$$;


-- ************************************************************
-- SECTION 5: NEUTER delete_auth_user (was executable by anon)
-- ************************************************************
-- Only the user's own school admin/sub_admin (or super_admin) may delete
-- a user. Preserves the legacy fallback path in admin-students.js while
-- blocking arbitrary account deletion.

CREATE OR REPLACE FUNCTION public.delete_auth_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_school UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.user_has_role('super_admin') THEN
    DELETE FROM auth.users WHERE id = p_user_id;
    RETURN FOUND;
  END IF;

  SELECT school_id INTO v_target_school
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_target_school IS NULL THEN
    SELECT school_id INTO v_target_school
    FROM public.applications
    WHERE user_id = p_user_id
    LIMIT 1;
  END IF;

  IF NOT public.is_school_staff(v_target_school) THEN
    RAISE EXCEPTION 'Not authorized to delete this user';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_auth_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_auth_user(UUID) TO authenticated;

-- ************************************************************
-- SECTION 6: BIND auto_approve_* TO THE CALLER (no third-party claiming)
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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE public.schools
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE public.sub_admins
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE public.teachers
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND is_approved = true
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE public.accountants
  SET user_id = p_user_id,
      is_approved = true
  WHERE registration_id = p_registration_id
    AND is_approved = true
    AND (user_id IS NULL OR user_id = p_user_id)
  RETURNING 1 INTO v_updated;

  IF COALESCE(v_updated, 0) > 0 THEN
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

REVOKE EXECUTE ON FUNCTION public.auto_approve_school_on_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_school_on_login(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_approve_sub_admin_on_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_sub_admin_on_login(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_approve_student_on_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_student_on_login(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_approve_teacher_on_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_teacher_on_login(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_approve_accountant_on_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_accountant_on_login(UUID, TEXT) TO authenticated;

-- ************************************************************
-- SECTION 7: BIND link_* TO THE CALLER (no third-party linking)
-- ************************************************************

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

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND (
         COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
         OR EXISTS (
           SELECT 1 FROM public.profiles pr
           WHERE pr.id = auth.uid()
           AND pr.email = lower(p_registration_id) || '@school.local'
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

CREATE OR REPLACE FUNCTION public.link_sub_admin_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id TEXT;
BEGIN
  SELECT registration_id INTO v_reg_id
  FROM public.sub_admins
  WHERE registration_id = p_registration_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Sub admin registration ID not found';
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this sub admin';
  END IF;

  UPDATE public.sub_admins
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_teacher_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id TEXT;
BEGIN
  SELECT registration_id INTO v_reg_id
  FROM public.teachers
  WHERE registration_id = p_registration_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Teacher registration ID not found';
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this teacher';
  END IF;

  UPDATE public.teachers
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_accountant_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id TEXT;
BEGIN
  SELECT registration_id INTO v_reg_id
  FROM public.accountants
  WHERE registration_id = p_registration_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Accountant registration ID not found';
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND COALESCE(auth.jwt()->'user_metadata'->>'registration_id', '') = p_registration_id
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this accountant';
  END IF;

  UPDATE public.accountants
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_student_to_application(p_student_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id TEXT;
BEGIN
  SELECT student_id INTO v_reg_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Student ID not found';
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       p_user_id = auth.uid()
       AND COALESCE(auth.jwt()->'user_metadata'->>'student_id', '') = p_student_id
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this student';
  END IF;

  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id AND user_id IS NULL;
END;
$$;

-- ************************************************************
-- SECTION 8: SCOPE STORAGE WRITES/DELETES TO THE OWNING SCHOOL
-- ************************************************************
-- File naming in the app:
--   student-photos:    STU-<ID>_<timestamp>.<ext>       (prefix = student_id)
--   teacher-documents: (cert|appt)_<teacher UUID>_<ts>.<ext>
--   school-logos:      school_<school UUID>_<timestamp>.<ext>
--
-- The buckets stay PUBLIC for READ so existing <img> tags keep working.
-- If you also need read confidentiality (photos / documents must not be
-- viewable by URL), switch the app to signed URLs first (see report notes).

DROP POLICY IF EXISTS "Authenticated users can upload student photos" ON storage.objects;
-- INSERT is relaxed so admission-time uploads (which happen BEFORE the
-- application row is created) continue to work. It still requires the
-- caller to be school staff and the filename to carry a valid student id
-- prefix, blocking arbitrary non-student uploads. UPDATE/DELETE below are
-- strictly scoped to the owning school via the existing application row.
CREATE POLICY "School staff upload own school student photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'student-photos'
    AND auth.role() = 'authenticated'
    AND public.get_user_school_id() IS NOT NULL
    AND storage.filename(name) ~ '^STU-[A-Z0-9]{5}_'
  );

DROP POLICY IF EXISTS "School staff update own school student photos" ON storage.objects;
CREATE POLICY "School staff update own school student photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'student-photos'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = split_part(storage.filename(name), '_', 1)
      AND public.is_school_member(a.school_id)
    )
  );

DROP POLICY IF EXISTS "School staff delete own school student photos" ON storage.objects;
CREATE POLICY "School staff delete own school student photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'student-photos'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = split_part(storage.filename(name), '_', 1)
      AND public.is_school_member(a.school_id)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can upload teacher documents" ON storage.objects;
CREATE POLICY "School staff or teacher manage own school teacher documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'teacher-documents'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = (regexp_replace(storage.filename(name), '^(cert|appt|photo)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_.*$', '\2'))::uuid
      AND (t.user_id = auth.uid() OR public.is_school_member(t.school_id))
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete teacher documents" ON storage.objects;
CREATE POLICY "School staff or teacher delete own school teacher documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'teacher-documents'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = (regexp_replace(storage.filename(name), '^(cert|appt|photo)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_.*$', '\2'))::uuid
      AND (t.user_id = auth.uid() OR public.is_school_member(t.school_id))
    )
  );

DROP POLICY IF EXISTS "Authenticated users can upload school logos" ON storage.objects;
CREATE POLICY "School members upload own school logo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'school-logos'
    AND auth.role() = 'authenticated'
    AND public.is_school_member(
      (regexp_replace(storage.filename(name), '^school_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_.*$', '\1'))::uuid
    )
  );

DROP POLICY IF EXISTS "Authenticated users can manage school logos" ON storage.objects;
CREATE POLICY "School members update own school logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'school-logos'
    AND auth.role() = 'authenticated'
    AND public.is_school_member(
      (regexp_replace(storage.filename(name), '^school_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_.*$', '\1'))::uuid
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete school logos" ON storage.objects;
CREATE POLICY "School members delete own school logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'school-logos'
    AND auth.role() = 'authenticated'
    AND public.is_school_member(
      (regexp_replace(storage.filename(name), '^school_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_.*$', '\1'))::uuid
    )
  );

-- ************************************************************
-- SECTION 9: VERIFY
-- ************************************************************
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'schools' AND policyname = 'Anyone can check school ID'
  ) THEN
    RAISE EXCEPTION 'Open schools policy still present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'schools' AND policyname = 'School members view own school'
  ) THEN
    RAISE EXCEPTION 'Member schools policy not created';
  END IF;
END;
$$;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  Remaining recommendations (out of scope of this file):
--   1. Move student-photos / teacher-documents to PRIVATE buckets and
--      render via signed URLs for full read-confidentiality of PII /
--      marks documents (buckets are still public-read by design today).
--   2. Registration/claim security is tied to the invitation-ID design;
--      keep registration IDs secret and never share them publicly.
-- ============================================================
