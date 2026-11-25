-- 098 - Secure student report-card rankings

DROP POLICY IF EXISTS "Students view published exam subjects" ON public.exam_subjects;
CREATE POLICY "Students view published exam subjects"
  ON public.exam_subjects FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.applications AS a
    JOIN public.exams AS e ON e.id = exam_subjects.exam_id
    WHERE a.user_id = auth.uid()
      AND a.school_id = e.school_id
      AND e.is_active = true
  ));

CREATE OR REPLACE FUNCTION public.get_student_exam_report_positions(p_exam_id uuid)
RETURNS TABLE (
  subject text,
  subject_rank bigint,
  overall_position bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target AS (
    SELECT a.student_id, a.school_id, a.class_applying
    FROM public.applications AS a
    JOIN public.exams AS e
      ON e.id = p_exam_id
      AND e.school_id = a.school_id
      AND e.is_active = true
    WHERE a.user_id = auth.uid()
    LIMIT 1
  ),
  scoped_results AS (
    SELECT
      er.student_id,
      er.subject,
      COALESCE(er.marks_obtained, 0)::numeric AS marks
    FROM target
    JOIN public.applications AS a
      ON a.school_id = target.school_id
      AND a.class_applying IS NOT DISTINCT FROM target.class_applying
    JOIN public.exam_results AS er
      ON er.student_id = a.student_id
      AND er.school_id = target.school_id
      AND er.exam_id = p_exam_id
  ),
  subject_rankings AS (
    SELECT
      student_id,
      subject,
      ROW_NUMBER() OVER (
        PARTITION BY subject
        ORDER BY marks DESC, student_id ASC
      ) AS subject_rank
    FROM scoped_results
  ),
  overall_rankings AS (
    SELECT
      student_id,
      ROW_NUMBER() OVER (
        ORDER BY AVG(marks) DESC, student_id ASC
      ) AS overall_position
    FROM scoped_results
    GROUP BY student_id
  )
  SELECT sr.subject, sr.subject_rank, overall.overall_position
  FROM subject_rankings AS sr
  JOIN overall_rankings AS overall USING (student_id)
  WHERE sr.student_id = (SELECT student_id FROM target);
$$;

REVOKE ALL ON FUNCTION public.get_student_exam_report_positions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_exam_report_positions(uuid) TO authenticated;
