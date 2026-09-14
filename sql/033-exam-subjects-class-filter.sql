-- ============================================================
--  Exam Subjects Class-Based Filtering
--  Adds class_name column to exam_subjects so each class can
--  have its own set of subjects for an exam
-- ============================================================

-- Add class_name column to exam_subjects
ALTER TABLE public.exam_subjects
  ADD COLUMN IF NOT EXISTS class_name TEXT;

-- Drop the old unique constraint (exam_id, subject) since subjects
-- are now unique per (exam_id, class_name, subject)
ALTER TABLE public.exam_subjects
  DROP CONSTRAINT IF EXISTS exam_subjects_exam_id_subject_key;

-- Create new unique constraint allowing the same subject for
-- different classes within the same exam
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_subjects_exam_class_subject_unique
  ON public.exam_subjects (exam_id, class_name, subject);

-- Index for class-based lookups
CREATE INDEX IF NOT EXISTS idx_exam_subjects_class_name
  ON public.exam_subjects (class_name);

-- Backfill: For existing records without a class_name, populate it
-- from the applications table (students' class) so existing data
-- remains associated with at least one class. If no students exist
-- for a subject, we leave class_name NULL (visible to all classes).
UPDATE public.exam_subjects es
SET class_name = sub.class_name
FROM (
  SELECT DISTINCT es_inner.id, a.class_applying AS class_name
  FROM public.exam_subjects es_inner
  JOIN public.exam_results er ON er.exam_id = es_inner.exam_id AND er.subject = es_inner.subject
  JOIN public.applications a ON a.student_id = er.student_id
  WHERE es_inner.class_name IS NULL
) sub
WHERE es.id = sub.id;