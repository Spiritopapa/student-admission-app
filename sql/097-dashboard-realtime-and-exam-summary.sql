-- 097 - Dashboard realtime refresh and efficient exam result summaries

CREATE INDEX IF NOT EXISTS idx_exam_results_school_exam
  ON public.exam_results (school_id, exam_id);

CREATE OR REPLACE FUNCTION public.get_exam_result_counts(
  p_school_id uuid,
  p_exam_ids uuid[]
)
RETURNS TABLE (exam_id uuid, result_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT er.exam_id, COUNT(*) AS result_count
  FROM public.exam_results AS er
  JOIN public.exams AS e ON e.id = er.exam_id
  WHERE er.school_id = p_school_id
    AND e.school_id = p_school_id
    AND er.exam_id = ANY(p_exam_ids)
  GROUP BY er.exam_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_exam_result_counts(uuid, uuid[]) TO authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE NOTICE 'supabase_realtime publication is unavailable; dashboard subscriptions were not enabled.';
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'applications',
    'classes',
    'teachers',
    'fees',
    'attendance',
    'payment_transactions',
    'transport_fee_payments',
    'receipts',
    'school_modules',
    'schools',
    'teacher_classes_subjects',
    'announcements',
    'exams',
    'exam_results',
    'parent_links',
    'school_applications'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END
$$;
