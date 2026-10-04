-- ============================================================
--  Student Admission Portal — Multi-Class Teacher RLS
--  Fixes row-level security so teachers assigned to SEVERAL
--  classes (teacher_classes_subjects junction + class_taught
--  CSV list) can read their students and enter examination
--  marks for EVERY class they teach — the old policies only
--  matched the literal `class_taught` string returned by
--  get_teacher_class(), which silently broke multi-class staff
--  (used by the teacher Examinations module and My Class).
--  Safe to re-run (CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- ============================================================

-- Helper: is the signed-in approved teacher in charge of p_class?
-- Matches the class_taught CSV list (tokenised) OR the
-- teacher_classes_subjects junction rows.
CREATE OR REPLACE FUNCTION public.is_teacher_for_class(p_class TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_class IS NULL OR p_class = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.teachers t
    WHERE t.user_id = auth.uid()
      AND t.is_approved = true
      AND (
        p_class = ANY (string_to_array(regexp_replace(t.class_taught, '\s*,\s*', ','), ','))
        OR EXISTS (
          SELECT 1 FROM public.teacher_classes_subjects tcs
          WHERE tcs.teacher_id = t.id
            AND tcs.class_name = p_class
        )
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_teacher_for_class(TEXT) TO authenticated;

-- 1. Applications: teachers read their students in EVERY assigned class.
DROP POLICY IF EXISTS "Teachers view class students" ON public.applications;
CREATE POLICY "Teachers view class students"
  ON public.applications FOR SELECT
  USING (
    public.is_approved_teacher()
    AND public.is_teacher_for_class(applications.class_applying)
  );

-- 2. Exam results: teachers can enter marks for their classes.
DROP POLICY IF EXISTS "Admins manage results" ON public.exam_results;
CREATE POLICY "Admins manage results"
  ON public.exam_results FOR ALL
  USING (
    public.can_access_school_data(exam_results.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_results.student_id
          AND public.is_teacher_for_class(a.class_applying)
      )
    )
  );

-- 3. Exam student details: same multi-class access for teachers.
DROP POLICY IF EXISTS "Admins manage exam student details" ON public.exam_student_details;
CREATE POLICY "Admins manage exam student details"
  ON public.exam_student_details FOR ALL
  USING (
    public.can_access_school_data(
      (SELECT school_id FROM public.exams WHERE id = exam_student_details.exam_id)
    )
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_student_details.student_id
          AND public.is_teacher_for_class(a.class_applying)
      )
    )
  );