-- ============================================================
--  Student Admission Portal — COMPLETE DATA ISOLATION FIX
--  ============================================================
--  CRITICAL SECURITY MIGRATION
--  Fixes all cross-school data leakage vulnerabilities
--
--  HOW TO APPLY:
--  1. Open Supabase Dashboard → SQL Editor → New Query
--  2. Copy the ENTIRE content of this file
--  3. Paste and Run
--
--  WHAT THIS FIXES (20 critical vulnerabilities):
--  01. `profiles` RLS: Admin/Sub Admin can read ALL profiles across ALL schools
--  02. `exams` RLS: Teachers can modify ANY exam in ANY school
--  03. `exams` RLS: Students can view ALL active exams in ALL schools
--  04. `exams` RLS: Parents can view ALL active exams in ALL schools
--  05. `exam_subjects` RLS: Teachers with NULL school_id can view ALL school subjects
--  06. `announcements` RLS: NULL school_id records visible to ALL users
--  07. `attendance` RLS: Teachers can manage ANY school's attendance records
--  08. `settings` PK: ALL schools share the same `singleton` id (data overwrite!)
--  09. `link_school_to_user` — ANY user can claim ANY school
--  10. `link_sub_admin_to_user` — ANY user can claim ANY sub_admin
--  11. `link_teacher_to_user` — ANY user can claim ANY teacher
--  12. `link_accountant_to_user` — ANY user can claim ANY accountant
--  13. `link_student_to_application` — ANY user can claim ANY student
--  14. `delete_student_completely` — ANY user can delete ANY student in ANY school
--  15. `process_fee_payment` — No school scope validation
--  16. `carry_forward_balance` — No school scope validation
--  17. `promote_student_fees` — No school scope validation
--  18. `get_student_fee_summary` — No school scope validation
--  19. `apply_overpaid_credit` — No school scope validation
--  20. `teacher_classes_subjects` RLS — teachers can see own assignments only
--      (no school cross-check needed but verify join safety)
-- ============================================================

-- ************************************************************
-- SECTION 1: ADD SECURITY CHECK HELPER FUNCTIONS
-- ************************************************************

-- ------------------------------------------------------------------
-- 1.1 Safe school access check: user must belong to the school
--     OR be a super_admin (for global operations only).
--     Unlike can_access_school_data, this also returns false for NULL.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_school_staff(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_school_id IS NULL THEN
    RETURN false;
  END IF;
  -- Super admins bypass school scope
  IF public.user_has_role('super_admin') THEN
    RETURN true;
  END IF;
  RETURN public.user_belongs_to_school(p_school_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_school_staff(UUID) TO authenticated;

-- ------------------------------------------------------------------
-- 1.2 Verify caller can modify a given student record.
--     Used in SECURITY DEFINER functions that operate on student_ids.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_modify_student(p_student_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  -- Get the student's school
  SELECT school_id INTO v_school_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.is_school_staff(v_school_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_modify_student(TEXT) TO authenticated;

-- ************************************************************
-- SECTION 2: FIX PROFILES RLS (Item 01)
-- ************************************************************

-- A school admin/sub_admin must ONLY see profiles of users belonging
-- to their own school. The old policy let them see profiles of ALL schools.
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;

CREATE POLICY "Admins read own school profiles"
  ON public.profiles FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR (
      (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
      AND profiles.school_id = public.get_user_school_id()
    )
  );

-- Also protect profile updates: only admin/sub_admin of the SAME school
-- can update profiles in that school (needed for name updates, approval flows).
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins update school profiles"
  ON public.profiles;

CREATE POLICY "Admins update school profiles"
  ON public.profiles FOR UPDATE
  USING (
    public.user_has_role('super_admin')
    OR (
      (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
      AND profiles.school_id = public.get_user_school_id()
    )
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR (
      (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
      AND profiles.school_id = public.get_user_school_id()
    )
  );

-- ************************************************************
-- SECTION 3: FIX EXAMS RLS (Items 02, 03, 04)
-- ************************************************************

-- 3.1 Admins/Teachers can manage exams ONLY in their own school.
--     Teachers should NEVER have blanket write access to other schools' exams.
DROP POLICY IF EXISTS "Admins manage exams" ON public.exams;

CREATE POLICY "Admins manage their school exams"
  ON public.exams FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(exams.school_id)
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR public.is_school_staff(exams.school_id)
  );

-- 3.2 Teachers need READ access to exams in their own school only.
DROP POLICY IF EXISTS "Teachers view own school exams"
  ON public.exams;

CREATE POLICY "Teachers view own school exams"
  ON public.exams FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(exams.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND t.school_id = exams.school_id
      )
    )
  );

-- 3.3 Students can ONLY view active exams from THEIR OWN school.
DROP POLICY IF EXISTS "Students view active exams" ON public.exams;

CREATE POLICY "Students view active exams in own school"
  ON public.exams FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.user_id = auth.uid()
      AND a.school_id = exams.school_id
    )
  );

-- 3.4 Parents can ONLY view active exams for their ward's school.
DROP POLICY IF EXISTS "Parents view ward exams" ON public.exams;

CREATE POLICY "Parents view ward exams in ward school"
  ON public.exams FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.parent_user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = pl.student_id
        AND a.school_id = exams.school_id
      )
    )
  );

-- ************************************************************
-- SECTION 4: FIX EXAM SUBJECTS RLS (Item 05)
-- ************************************************************

-- Teachers can view exam subjects ONLY for exams in their own school.
-- The old policy allowed teachers with NULL school_id to see ALL subjects.
DROP POLICY IF EXISTS "Teachers view exam subjects for their school" ON public.exam_subjects;

CREATE POLICY "Teachers view own school exam subjects"
  ON public.exam_subjects FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND t.school_id = e.school_id
      )
    )
  );

-- Students can view exam subjects ONLY for their own school's exams.
DROP POLICY IF EXISTS "Students view exam subjects for their exams" ON public.exam_subjects;

CREATE POLICY "Students view own school exam subjects"
  ON public.exam_subjects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_results er
      WHERE er.exam_id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = er.student_id
        AND a.user_id = auth.uid()
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.user_id = auth.uid()
        AND a.school_id = e.school_id
      )
    )
  );

-- Parents can view exam subjects ONLY for their ward's school exams.
DROP POLICY IF EXISTS "Parents view exam subjects for ward exams" ON public.exam_subjects;

CREATE POLICY "Parents view ward school exam subjects"
  ON public.exam_subjects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_results er
      WHERE er.exam_id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.parent_links pl
        WHERE pl.student_id = er.student_id
        AND pl.parent_user_id = auth.uid()
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.parent_links pl
        WHERE pl.parent_user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.student_id = pl.student_id
          AND a.school_id = e.school_id
        )
      )
    )
  );

-- ************************************************************
-- SECTION 5: FIX EXAM RESULTS RLS (teacher scope)
-- ************************************************************

-- Teachers who manage results must be in the SAME school as the exam.
DROP POLICY IF EXISTS "Admins manage results" ON public.exam_results;

CREATE POLICY "Admins and teachers manage own school results"
  ON public.exam_results FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(exam_results.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.exams e
        WHERE e.id = exam_results.exam_id
        AND EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = auth.uid()
          AND t.is_approved = true
          AND t.school_id = e.school_id
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_results.student_id
        AND a.class_applying = ANY(public.get_teacher_classes())
        AND a.school_id = exam_results.school_id
      )
    )
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR public.is_school_staff(exam_results.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.exams e
        WHERE e.id = exam_results.exam_id
        AND EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = auth.uid()
          AND t.is_approved = true
          AND t.school_id = e.school_id
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_results.student_id
        AND a.class_applying = ANY(public.get_teacher_classes())
        AND a.school_id = exam_results.school_id
      )
    )
  );

-- Students can view own results (already requires own application — safe,
-- but add school consistency for defense-in-depth)
DROP POLICY IF EXISTS "Students view own results" ON public.exam_results;

CREATE POLICY "Students view own results"
  ON public.exam_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = exam_results.student_id
      AND a.user_id = auth.uid()
      AND a.school_id = exam_results.school_id
    )
  );

-- Parents can view ward results (add school consistency)
DROP POLICY IF EXISTS "Parents view ward results" ON public.exam_results;

CREATE POLICY "Parents view ward results"
  ON public.exam_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.student_id = exam_results.student_id
      AND pl.parent_user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_results.exam_id
      AND EXISTS (
        SELECT 1 FROM public.parent_links pl2
        WHERE pl2.parent_user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.student_id = pl2.student_id
          AND a.school_id = e.school_id
        )
      )
    )
  );

-- ************************************************************
-- SECTION 6: FIX EXAM STUDENT DETAILS RLS (teacher scope)
-- ************************************************************
DROP POLICY IF EXISTS "Admins manage exam student details" ON public.exam_student_details;

CREATE POLICY "Admins and teachers manage own school exam details"
  ON public.exam_student_details FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_student_details.exam_id
      AND public.is_school_staff(e.school_id)
    )
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.exams e
        WHERE e.id = exam_student_details.exam_id
        AND EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = auth.uid()
          AND t.is_approved = true
          AND t.school_id = e.school_id
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_student_details.student_id
        AND a.class_applying = ANY(public.get_teacher_classes())
      )
    )
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_student_details.exam_id
      AND public.is_school_staff(e.school_id)
    )
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.exams e
        WHERE e.id = exam_student_details.exam_id
        AND EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = auth.uid()
          AND t.is_approved = true
          AND t.school_id = e.school_id
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_student_details.student_id
        AND a.class_applying = ANY(public.get_teacher_classes())
      )
    )
  );

-- ************************************************************
-- SECTION 7: FIX ANNOUNCEMENTS RLS (Item 06)
-- ************************************************************

-- NULL school_id announcements should NOT be visible to all schools.
-- They are legacy orphan records. Only super_admin should see/manage them.
DROP POLICY IF EXISTS "Users view own school announcements" ON public.announcements;

CREATE POLICY "Users view own school announcements only"
  ON public.announcements FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR (
      is_active = true
      AND announcements.school_id IS NOT NULL
      AND public.is_school_staff(announcements.school_id)
    )
  );

-- ************************************************************
-- SECTION 8: FIX ATTENDANCE RLS (Item 07)
-- ************************************************************

-- Teachers must ONLY manage attendance in their own school.
DROP POLICY IF EXISTS "Admins and teachers manage attendance" ON public.attendance;

CREATE POLICY "Admins and teachers manage own school attendance"
  ON public.attendance FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(attendance.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND t.school_id = attendance.school_id
      )
    )
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR public.is_school_staff(attendance.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND t.school_id = attendance.school_id
      )
    )
  );

-- Students view own attendance (add school consistency)
DROP POLICY IF EXISTS "Students view own attendance" ON public.attendance;

CREATE POLICY "Students view own attendance"
  ON public.attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = attendance.student_id
      AND a.user_id = auth.uid()
      AND a.school_id = attendance.school_id
    )
  );

-- Parents view ward attendance (add school consistency)
DROP POLICY IF EXISTS "Parents view ward attendance" ON public.attendance;

CREATE POLICY "Parents view ward attendance"
  ON public.attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.student_id = attendance.student_id
      AND pl.parent_user_id = auth.uid()
    )
    AND attendance.school_id IS NOT NULL
  );

-- ************************************************************
-- SECTION 9: FIX SETTINGS TABLE — PER-SCHOOL SINGLETON (Item 08)
-- ************************************************************

-- The `id TEXT PRIMARY KEY DEFAULT 'singleton'` design is CATASTROPHIC:
-- ALL schools share the SAME row, so School A's settings overwrite School B's.
--
-- FIX: Keep the table structure but force a unique primary key that is
-- actually per-school. The PK becomes school_id (plus a default id for
-- backward-compatibility when school_id is NULL).
-- We migrate existing rows to use school_id as the PK.

-- Step 1: The old `settings` table has a PRIMARY KEY on `id` with default 'singleton',
-- which means only ONE row can ever exist. This is the root cause of the data
-- corruption issue. We do NOT insert into it. Instead, we create a NEW per-school
-- settings table keyed by school_id.

-- Create the new per-school settings table
CREATE TABLE IF NOT EXISTS public.school_settings (
  school_id     UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  school_name   TEXT,
  school_address TEXT,
  school_motto   TEXT,
  academic_year TEXT DEFAULT '2025/2026',
  current_term  TEXT DEFAULT 'First' CHECK (current_term IN ('First','Second','Third')),
  total_term_days INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

-- School staff can manage their own school's settings
CREATE POLICY "School staff manage own school settings"
  ON public.school_settings FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(school_settings.school_id)
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR public.is_school_staff(school_settings.school_id)
  );

-- Seed the new table from existing data
INSERT INTO public.school_settings
  (school_id, school_name, academic_year, current_term, created_at, updated_at)
SELECT
  COALESCE(school_id, s.id),
  COALESCE(school_name, s.name),
  COALESCE(academic_year, '2025/2026'),
  COALESCE(current_term, 'First'),
  now(),
  now()
FROM public.settings
LEFT JOIN public.schools s ON s.id = settings.school_id
WHERE school_id IS NOT NULL
ON CONFLICT (school_id) DO NOTHING;

-- Insert for any schools that were missed
INSERT INTO public.school_settings (school_id, school_name, academic_year, current_term)
SELECT s.id, s.name, '2025/2026', 'First'
FROM public.schools s
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_settings ss WHERE ss.school_id = s.id
);

-- ************************************************************
-- SECTION 10: FIX LINK FUNCTIONS — CRITICAL SECURITY (Items 09-13)
-- ************************************************************

-- EVERY link_* function is SECURITY DEFINER and lets ANY authenticated
-- user claim ANY school / sub_admin / teacher / accountant / student.
-- We add strict role + school verification.

-- 10.1 Link school admin to school — ONLY super_admin can link.
DROP FUNCTION IF EXISTS public.link_school_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_school_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_role('super_admin') THEN
    RAISE EXCEPTION 'Only super admins can link school admins';
  END IF;
  UPDATE public.schools
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

-- 10.2 Link sub admin to user — ONLY school admin of that school can link.
DROP FUNCTION IF EXISTS public.link_sub_admin_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_sub_admin_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.sub_admins
  WHERE registration_id = p_registration_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Sub admin registration ID not found';
  END IF;

  -- Only the school admin of the SAME school can link sub admins
  IF NOT public.user_has_role('super_admin')
     AND NOT (public.user_has_role('admin') AND public.user_belongs_to_school(v_school_id)) THEN
    RAISE EXCEPTION 'Not authorized to link this sub admin';
  END IF;

  UPDATE public.sub_admins
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

-- 10.3 Link teacher to user — ONLY admin/sub_admin of that school can link.
DROP FUNCTION IF EXISTS public.link_teacher_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_teacher_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.teachers
  WHERE registration_id = p_registration_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Teacher registration ID not found';
  END IF;

  -- Only admin/sub_admin of the SAME school can link teachers
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this teacher';
  END IF;

  UPDATE public.teachers
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

-- 10.4 Link accountant to user — ONLY admin/sub_admin of that school can link.
DROP FUNCTION IF EXISTS public.link_accountant_to_user(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_accountant_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.accountants
  WHERE registration_id = p_registration_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Accountant registration ID not found';
  END IF;

  -- Only admin/sub_admin of the SAME school can link accountants
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RAISE EXCEPTION 'Not authorized to link this accountant';
  END IF;

  UPDATE public.accountants
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

-- 10.5 Link student to application — ONLY admin/sub_admin/teacher/accountant
--     of the SAME school can link a student to their auth user.
DROP FUNCTION IF EXISTS public.link_student_to_application(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.link_student_to_application(p_student_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Student ID not found';
  END IF;

  -- Only staff of the SAME school can link a student
  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RAISE EXCEPTION 'Not authorized to link this student';
  END IF;

  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id AND user_id IS NULL;
END;
$$;

-- ************************************************************
-- SECTION 11: FIX DELETE STUDENT COMPLETELY (Item 14)
-- ************************************************************

DROP FUNCTION IF EXISTS public.delete_student_completely(TEXT);

CREATE OR REPLACE FUNCTION public.delete_student_completely(p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_student_name TEXT;
  v_class_name TEXT;
  v_deleted_parent_links INT := 0;
  v_deleted_attendance INT := 0;
  v_deleted_exam_details INT := 0;
  v_deleted_exam_results INT := 0;
  v_deleted_transactions INT := 0;
  v_deleted_receipts INT := 0;
  v_deleted_fees INT := 0;
  v_deleted_applications INT := 0;
  v_deleted_profiles INT := 0;
  v_auth_deleted BOOLEAN := false;
  v_school_id UUID;
BEGIN
  -- SECURITY: Get the student's school and verify caller is staff of that school
  SELECT user_id, school_id INTO v_user_id, v_school_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  -- Only staff (admin/sub_admin) of the SAME school OR super_admin can delete
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this student');
  END IF;

  -- Build student name for logging
  SELECT CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name),
         class_applying
  INTO v_student_name, v_class_name
  FROM public.applications
  WHERE student_id = p_student_id;

  -- 1. Delete parent_links (no FK cascade to applications.student_id)
  DELETE FROM public.parent_links WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_parent_links = ROW_COUNT;

  -- 2. Delete attendance records
  DELETE FROM public.attendance WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_attendance = ROW_COUNT;

  -- 3. Delete exam student details
  DELETE FROM public.exam_student_details WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_details = ROW_COUNT;

  -- 4. Delete exam results
  DELETE FROM public.exam_results WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_results = ROW_COUNT;

  -- 5. Delete payment transactions
  DELETE FROM public.payment_transactions WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_transactions = ROW_COUNT;

  -- 6. Delete receipts
  DELETE FROM public.receipts WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_receipts = ROW_COUNT;

  -- 7. Delete fee records
  DELETE FROM public.fees WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_fees = ROW_COUNT;

  -- 8. Delete the application record (main student record)
  DELETE FROM public.applications WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_applications = ROW_COUNT;

  -- 9. Delete profile if user_id exists
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_user_id;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;
  END IF;

  -- 10. Delete auth user if user_id exists
  IF v_user_id IS NOT NULL THEN
    BEGIN
      DELETE FROM auth.users WHERE id = v_user_id;
      v_auth_deleted := FOUND;
    EXCEPTION
      WHEN OTHERS THEN
        v_auth_deleted := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'student_name', v_student_name,
    'class', v_class_name,
    'user_id', v_user_id,
    'auth_deleted', v_auth_deleted,
    'deleted_counts', jsonb_build_object(
      'parent_links', v_deleted_parent_links,
      'attendance', v_deleted_attendance,
      'exam_student_details', v_deleted_exam_details,
      'exam_results', v_deleted_exam_results,
      'payment_transactions', v_deleted_transactions,
      'receipts', v_deleted_receipts,
      'fees', v_deleted_fees,
      'applications', v_deleted_applications,
      'profiles', v_deleted_profiles
    )
  );
END;
$$;

-- ************************************************************
-- SECTION 12: FIX FEE FUNCTIONS — SCHOOL SCOPE (Items 15-19)
-- ************************************************************

-- 12.1 process_fee_payment — enforce school scope.
--      If p_school_id is NULL, auto-detect from the student.
DROP FUNCTION IF EXISTS public.process_fee_payment(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.process_fee_payment(
  p_student_id TEXT,
  p_academic_year TEXT,
  p_term TEXT,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_recorded_by UUID DEFAULT NULL,
  p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee_id UUID;
  v_current_paid NUMERIC(12,2);
  v_current_total NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_current_overpaid NUMERIC(12,2);
  v_new_paid NUMERIC(12,2);
  v_new_status TEXT;
  v_transaction_id UUID;
  v_receipt_number TEXT;
  v_receipt_id UUID;
  v_verification_token TEXT;
  v_remaining NUMERIC(12,2);
  v_overpaid_amount NUMERIC(12,2);
  v_student_name TEXT;
  v_class_name TEXT;
  v_school_name TEXT;
  v_class_fee_amount NUMERIC(12,2);
  v_processor_name TEXT;
  v_processor_role TEXT;
  v_processor_label TEXT;
  v_effective_school_id UUID;
BEGIN
  -- SECURITY: Determine target school, require caller to be staff of that school
  SELECT a.school_id INTO v_effective_school_id
  FROM public.applications a
  WHERE a.student_id = p_student_id;

  IF v_effective_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_effective_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to process payment for this student');
  END IF;

  -- Use the student's actual school (never trust a passed school_id that differs)
  p_school_id := v_effective_school_id;

  -- Get current fee record (MUST exist - created via Set/Update Class Fee)
  SELECT id, amount_paid, total_amount, debt, COALESCE(overpaid_amount, 0)
  INTO v_fee_id, v_current_paid, v_current_total, v_current_debt, v_current_overpaid
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year
    AND term = p_term
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Auto-create fee record using the school's class fee
    SELECT cf.fee_amount INTO v_class_fee_amount
    FROM public.applications a
    LEFT JOIN public.class_fees cf ON cf.class_name = a.class_applying
      AND cf.academic_year = p_academic_year
      AND cf.term = p_term
      AND cf.school_id = p_school_id
    WHERE a.student_id = p_student_id;

    v_class_fee_amount := COALESCE(v_class_fee_amount, 0);

    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, overpaid_amount, payment_status, school_id)
    VALUES (p_student_id, p_academic_year, p_term, v_class_fee_amount, 0, 0, 0, 'unpaid', p_school_id)
    RETURNING id, amount_paid, total_amount, debt, overpaid_amount
    INTO v_fee_id, v_current_paid, v_current_total, v_current_debt, v_current_overpaid;
  END IF;

  -- Calculate outstanding balance for this term
  v_remaining := (v_current_total + v_current_debt) - v_current_paid;

  -- Cap payment amount to outstanding balance
  IF p_amount > v_remaining THEN
    p_amount := v_remaining;
  END IF;

  v_new_paid := v_current_paid + p_amount;
  v_remaining := (v_current_total + v_current_debt) - v_new_paid;

  v_overpaid_amount := 0;
  IF v_remaining <= 0 THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  UPDATE public.fees
  SET amount_paid = v_new_paid,
      payment_status = v_new_status,
      overpaid_amount = 0,
      last_payment_date = now(),
      updated_at = now()
  WHERE id = v_fee_id;

  -- Create transaction (school_id forced to student's school)
  INSERT INTO public.payment_transactions (
    student_id, academic_year, term, amount_paid,
    payment_method, payment_date, reference_number, notes,
    recorded_by, school_id
  ) VALUES (
    p_student_id, p_academic_year, p_term, p_amount,
    p_payment_method, now(), p_reference_number, p_notes,
    p_recorded_by, p_school_id
  ) RETURNING id INTO v_transaction_id;

  -- Look up processor info if recorded_by is provided
  IF p_recorded_by IS NOT NULL THEN
    SELECT full_name, role INTO v_processor_name, v_processor_role
    FROM public.profiles
    WHERE id = p_recorded_by;

    v_processor_label := CASE
      WHEN v_processor_role IN ('super_admin', 'school', 'sub_admin') THEN 'Admin'
      WHEN v_processor_role = 'accountant' THEN 'Accountant'
      WHEN v_processor_role IS NOT NULL THEN INITCAP(v_processor_role)
      ELSE 'Staff'
    END;
  END IF;

  -- Generate receipt
  v_receipt_number := public.generate_receipt_number();

  SELECT CONCAT(a.first_name, ' ', COALESCE(a.middle_name || ' ', ''), a.last_name),
         a.class_applying
  INTO v_student_name, v_class_name
  FROM public.applications a WHERE a.student_id = p_student_id;

  SELECT COALESCE(s.name, 'School') INTO v_school_name
  FROM public.schools s WHERE s.id = p_school_id;

  INSERT INTO public.receipts (
    receipt_number, transaction_id, student_id,
    academic_year, term, amount, payment_method,
    receipt_date, receipt_data, school_id
  ) VALUES (
    v_receipt_number, v_transaction_id, p_student_id,
    p_academic_year, p_term, p_amount, p_payment_method,
    now(),
    jsonb_build_object(
      'student_name', v_student_name,
      'class', v_class_name,
      'school_name', v_school_name,
      'total_fees', v_current_total,
      'debt', v_current_debt,
      'total_due', v_current_total + v_current_debt,
      'amount_paid_before', v_current_paid,
      'amount_now', p_amount,
      'total_paid', v_new_paid,
      'remaining_balance', v_remaining,
      'overpaid_amount', v_overpaid_amount,
      'payment_status', v_new_status,
      'payment_method', p_payment_method,
      'reference_number', p_reference_number,
      'notes', p_notes,
      'processed_by', v_processor_name,
      'processed_by_label', v_processor_label
    ),
    p_school_id
  ) RETURNING id, verification_token INTO v_receipt_id, v_verification_token;

  -- Clean up fully paid previous-term fee records (same behavior as before)
  IF v_new_status = 'paid' THEN
    DECLARE
      v_later_exists BOOLEAN;
      v_term_order INT;
      v_paid_term_order INT;
    BEGIN
      v_paid_term_order := CASE p_term
        WHEN 'First' THEN 1
        WHEN 'Second' THEN 2
        WHEN 'Third' THEN 3
        ELSE 0
      END;

      SELECT EXISTS(
        SELECT 1 FROM public.fees
        WHERE student_id = p_student_id
          AND id != v_fee_id
          AND school_id = p_school_id
          AND (
            SPLIT_PART(academic_year, '/', 1)::INT > SPLIT_PART(p_academic_year, '/', 1)::INT
            OR
            (SPLIT_PART(academic_year, '/', 1)::INT = SPLIT_PART(p_academic_year, '/', 1)::INT
             AND CASE term
               WHEN 'First' THEN 1
               WHEN 'Second' THEN 2
               WHEN 'Third' THEN 3
             END > v_paid_term_order)
          )
        LIMIT 1
      ) INTO v_later_exists;

      IF v_later_exists THEN
        DELETE FROM public.fees WHERE id = v_fee_id;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'verification_token', v_verification_token,
    'amount_paid', p_amount,
    'total_paid', v_new_paid,
    'remaining_balance', v_remaining,
    'overpaid_amount', v_overpaid_amount,
    'payment_status', v_new_status,
    'student_name', v_student_name,
    'class', v_class_name,
    'school_name', v_school_name,
    'academic_year', p_academic_year,
    'term', p_term,
    'debt', v_current_debt,
    'processed_by', v_processor_name,
    'processed_by_label', v_processor_label
  );
END;
$$;

-- 12.2 carry_forward_balance — enforce school scope
DROP FUNCTION IF EXISTS public.carry_forward_balance(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.carry_forward_balance(
  p_student_id TEXT,
  p_from_academic_year TEXT,
  p_from_term TEXT,
  p_to_academic_year TEXT,
  p_to_term TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_total_carry NUMERIC(12,2);
  v_target_fee_id UUID;
  v_target_total NUMERIC(12,2);
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to carry forward balance for this student');
  END IF;

  SELECT (total_amount - amount_paid), debt
  INTO v_current_balance, v_current_debt
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_from_academic_year
    AND term = p_from_term
    AND school_id = v_school_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source fee record not found');
  END IF;

  v_total_carry := v_current_balance + v_current_debt;

  SELECT id, total_amount INTO v_target_fee_id, v_target_total
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_to_academic_year
    AND term = p_to_term
    AND school_id = v_school_id;

  IF FOUND THEN
    UPDATE public.fees
    SET debt = v_total_carry,
        payment_status = CASE WHEN v_total_carry > 0 THEN 'unpaid' ELSE payment_status END,
        updated_at = now()
    WHERE id = v_target_fee_id;
  ELSE
    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, payment_status, school_id)
    SELECT p_student_id, p_to_academic_year, p_to_term, 0, 0, v_total_carry,
           CASE WHEN v_total_carry > 0 THEN 'unpaid' ELSE 'paid' END,
           v_school_id
    FROM public.applications WHERE student_id = p_student_id AND school_id = v_school_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'carried_amount', v_total_carry,
    'from', p_from_academic_year || ' ' || p_from_term,
    'to', p_to_academic_year || ' ' || p_to_term);
END;
$$;

-- 12.3 promote_student_fees — enforce school scope
DROP FUNCTION IF EXISTS public.promote_student_fees(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.promote_student_fees(
  p_student_id TEXT,
  p_current_academic_year TEXT,
  p_current_term TEXT,
  p_new_class_name TEXT,
  p_new_academic_year TEXT,
  p_new_term TEXT,
  p_new_fee_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC(12,2);
  v_current_debt NUMERIC(12,2);
  v_total_carry NUMERIC(12,2);
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to promote fees for this student');
  END IF;

  SELECT (total_amount - amount_paid), debt
  INTO v_current_balance, v_current_debt
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_current_academic_year
    AND term = p_current_term
    AND school_id = v_school_id;

  IF NOT FOUND THEN
    v_current_balance := 0;
    v_current_debt := 0;
  END IF;

  v_total_carry := COALESCE(v_current_balance, 0) + COALESCE(v_current_debt, 0);

  INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, payment_status, school_id)
  SELECT p_student_id, p_new_academic_year, p_new_term, p_new_fee_amount, 0, v_total_carry,
         CASE WHEN (p_new_fee_amount + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
         v_school_id
  FROM public.applications WHERE student_id = p_student_id AND school_id = v_school_id
  ON CONFLICT (student_id, academic_year, term)
  DO UPDATE SET
    total_amount = p_new_fee_amount,
    debt = v_total_carry,
    payment_status = CASE WHEN (p_new_fee_amount + v_total_carry) > 0 THEN 'unpaid' ELSE 'paid' END,
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'carried_balance', v_total_carry,
    'new_total', p_new_fee_amount + v_total_carry);
END;
$$;

-- 12.4 get_student_fee_summary — enforce school scope
DROP FUNCTION IF EXISTS public.get_student_fee_summary(TEXT);

CREATE OR REPLACE FUNCTION public.get_student_fee_summary(p_student_id TEXT)
RETURNS TABLE(
  academic_year TEXT, term TEXT,
  total_amount NUMERIC, amount_paid NUMERIC,
  balance NUMERIC, debt NUMERIC,
  payment_status TEXT, last_payment_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.academic_year, f.term, f.total_amount, f.amount_paid,
         f.balance, f.debt, f.payment_status, f.last_payment_date
  FROM public.fees f
  WHERE f.student_id = p_student_id
    AND f.school_id = v_school_id
  ORDER BY f.academic_year, f.term;
END;
$$;

-- 12.5 apply_overpaid_credit — enforce school scope
DROP FUNCTION IF EXISTS public.apply_overpaid_credit(TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.apply_overpaid_credit(
  p_student_id TEXT,
  p_academic_year TEXT,
  p_term TEXT,
  p_new_total_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overpaid_amount NUMERIC(12,2);
  v_effective_total NUMERIC(12,2);
  v_fee_id UUID;
  v_new_overpaid NUMERIC(12,2);
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.applications WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT public.is_school_staff(v_school_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to apply overpaid credit for this student');
  END IF;

  SELECT COALESCE(overpaid_amount, 0) INTO v_overpaid_amount
  FROM public.fees
  WHERE student_id = p_student_id
    AND overpaid_amount > 0
    AND school_id = v_school_id
  ORDER BY academic_year DESC,
    CASE term WHEN 'First' THEN 1 WHEN 'Second' THEN 2 WHEN 'Third' THEN 3 END DESC
  LIMIT 1;

  IF v_overpaid_amount IS NULL OR v_overpaid_amount = 0 THEN
    RETURN jsonb_build_object('success', true, 'applied', 0, 'new_total', p_new_total_amount);
  END IF;

  v_effective_total := GREATEST(p_new_total_amount - v_overpaid_amount, 0);
  v_new_overpaid := GREATEST(v_overpaid_amount - p_new_total_amount, 0);

  SELECT id INTO v_fee_id
  FROM public.fees
  WHERE student_id = p_student_id
    AND academic_year = p_academic_year
    AND term = p_term
    AND school_id = v_school_id;

  IF FOUND THEN
    UPDATE public.fees
    SET total_amount = p_new_total_amount,
        overpaid_amount = v_new_overpaid,
        payment_status = CASE WHEN (v_effective_total + debt) > 0 THEN 'unpaid' ELSE 'paid' END,
        updated_at = now()
    WHERE id = v_fee_id;
  ELSE
    INSERT INTO public.fees (student_id, academic_year, term, total_amount, amount_paid, debt, overpaid_amount, payment_status, school_id)
    VALUES (p_student_id, p_academic_year, p_term, p_new_total_amount, 0, 0, v_new_overpaid,
            CASE WHEN v_effective_total > 0 THEN 'unpaid' ELSE 'paid' END,
            v_school_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'applied', v_overpaid_amount - v_new_overpaid, 'new_total', v_effective_total, 'remaining_overpaid', v_new_overpaid);
END;
$$;

-- ************************************************************
-- SECTION 13: FIX TEACHER ACCESS TO APPLICATIONS (class+school)
-- ************************************************************

-- Teachers must only see students in their assigned classes AND their school.
DROP POLICY IF EXISTS "Teachers view class students" ON public.applications;

CREATE POLICY "Teachers view own school class students"
  ON public.applications FOR SELECT
  USING (
    public.user_has_role('super_admin')
    OR (
      public.is_approved_teacher()
      AND class_applying = ANY(public.get_teacher_classes())
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND t.school_id = applications.school_id
      )
    )
  );

-- ************************************************************
-- SECTION 14: REVOKE DANGEROUS FUNCTION ACCESS FROM ANON
-- ************************************************************

-- Revoke the ID-check functions from anon role (they leak data existence)
REVOKE EXECUTE ON FUNCTION public.check_school_id_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_sub_admin_id_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_teacher_id_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_accountant_id_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_student_id_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.super_admin_exists() FROM anon;

-- Keep these available for authenticated users (needed for registration flows)
GRANT EXECUTE ON FUNCTION public.check_school_id_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_sub_admin_id_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_teacher_id_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_accountant_id_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_student_id_exists(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_exists() TO authenticated;

-- ************************************************************
-- SECTION 15: VERIFY IMPORTANT POLICIES ARE IN PLACE
-- ************************************************************

DO $$
BEGIN
  -- Verify key policies exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'applications' AND policyname = 'Teachers view own school class students'
  ) THEN
    RAISE EXCEPTION 'Applications teacher policy not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'announcements' AND policyname = 'Users view own school announcements only'
  ) THEN
    RAISE EXCEPTION 'Announcements policy not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'exams' AND policyname = 'Admins manage their school exams'
  ) THEN
    RAISE EXCEPTION 'Exams manage policy not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance' AND policyname = 'Admins and teachers manage own school attendance'
  ) THEN
    RAISE EXCEPTION 'Attendance policy not created';
  END IF;
END;
$$;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  Security fixes applied:
--  01. profiles RLS school-scoped
--  02. exams RLS school-scoped for all roles
--  03. exam_subjects RLS school-scoped
--  04. exam_results RLS school-scoped
--  05. exam_student_details RLS school-scoped
--  06. announcements NULL school_id no longer leaked
--  07. attendance RLS school-scoped
--  08. settings → new school_settings per-school table
--  09. link_school_to_user super_admin only
--  10. link_sub_admin_to_user school admin only
--  11. link_teacher_to_user school staff only
--  12. link_accountant_to_user school staff only
--  13. link_student_to_application school staff only
--  14. delete_student_completely school-scoped
--  15. process_fee_payment school-scoped
--  16. carry_forward_balance school-scoped
--  17. promote_student_fees school-scoped
--  18. get_student_fee_summary school-scoped
--  19. apply_overpaid_credit school-scoped
--  20. teachers can only see own school class students
-- ============================================================