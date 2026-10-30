-- ============================================================
-- 094 - Published exam visibility
-- `exams.is_active` is the publication flag. Hidden exams and their report
-- details are unavailable to students and parents at the database layer.
-- ============================================================
DROP POLICY IF EXISTS "Students view own results" ON public.exam_results;
CREATE POLICY "Students view published own results"
  ON public.exam_results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.exams e ON e.id = exam_results.exam_id
    WHERE a.student_id = exam_results.student_id
      AND a.user_id = auth.uid()
      AND a.school_id = exam_results.school_id
      AND e.school_id = exam_results.school_id
      AND e.is_active = true
  ));

DROP POLICY IF EXISTS "Parents view ward results" ON public.exam_results;
CREATE POLICY "Parents view published ward results"
  ON public.exam_results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    JOIN public.applications a ON a.student_id = pl.student_id
    JOIN public.exams e ON e.id = exam_results.exam_id
    WHERE pl.parent_user_id = auth.uid()
      AND pl.student_id = exam_results.student_id
      AND a.school_id = exam_results.school_id
      AND e.school_id = exam_results.school_id
      AND e.is_active = true
  ));

DROP POLICY IF EXISTS "Students view own exam details" ON public.exam_student_details;
CREATE POLICY "Students view published own exam details"
  ON public.exam_student_details FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.exams e ON e.id = exam_student_details.exam_id
    WHERE a.student_id = exam_student_details.student_id
      AND a.user_id = auth.uid()
      AND e.school_id = a.school_id
      AND e.is_active = true
  ));

DROP POLICY IF EXISTS "Parents view ward exam details" ON public.exam_student_details;
CREATE POLICY "Parents view published ward exam details"
  ON public.exam_student_details FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    JOIN public.applications a ON a.student_id = pl.student_id
    JOIN public.exams e ON e.id = exam_student_details.exam_id
    WHERE pl.parent_user_id = auth.uid()
      AND pl.student_id = exam_student_details.student_id
      AND e.school_id = a.school_id
      AND e.is_active = true
  ));
