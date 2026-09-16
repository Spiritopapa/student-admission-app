-- ============================================================
-- 069 - Canonical Class Subjects
--  Adds class_subjects as the single source of truth for which
--  subjects belong to each class. Admin assigns subjects to a
--  class once here; teacher assignments, exam subject selectors
--  and the teacher dashboard all derive from this mapping so the
--  teacher sees EXACTLY the subjects the admin configured for the
--  selected class.
--
--  Example: Teacher 1 teaches English & Mathematics in JHS 1 and
--  Science in JHS 2. After the admin configures class_subjects:
--    JHS 1 -> English, Mathematics
--    JHS 2 -> Science
--  The teacher's exam module shows English/Mathematics when the
--  JHS 1 filter is active and Science when JHS 2 is active.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_subjects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name   TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  school_id    UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins can manage class-subject assignments
CREATE POLICY "Admins manage class subjects"
  ON public.class_subjects FOR ALL
  USING (
    public.can_access_school_data(class_subjects.school_id)
  )
  WITH CHECK (
    public.can_access_school_data(class_subjects.school_id)
  );

-- Users in the school can view the canonical subject list per class
CREATE POLICY "Users view own school class subjects"
  ON public.class_subjects FOR SELECT
  USING (
    public.can_access_school_data(class_subjects.school_id)
  );

-- One subject per class per school
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_subjects_school_class_subject_unique
  ON public.class_subjects (school_id, class_name, subject_name);

CREATE INDEX IF NOT EXISTS idx_class_subjects_class_name ON public.class_subjects(class_name);
CREATE INDEX IF NOT EXISTS idx_class_subjects_school_id ON public.class_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_name ON public.class_subjects(subject_name);

-- ---------------------------------------------------
-- Backfill existing data so nothing is lost
-- ---------------------------------------------------
-- 1) From teacher class-subject assignments (the primary source today)
INSERT INTO public.class_subjects (class_name, subject_name, school_id)
SELECT DISTINCT tcs.class_name, tcs.subject_name, tcs.school_id
FROM public.teacher_classes_subjects tcs
WHERE tcs.school_id IS NOT NULL
  AND tcs.class_name IS NOT NULL
  AND tcs.subject_name IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2) From exam subjects for classes that have exam subjects but
--    no teacher assignment rows yet (so the mapping still appears).
INSERT INTO public.class_subjects (class_name, subject_name, school_id)
SELECT DISTINCT es.class_name, es.subject, e.school_id
FROM public.exam_subjects es
JOIN public.exams e ON e.id = es.exam_id
WHERE es.class_name IS NOT NULL
  AND es.subject IS NOT NULL
  AND e.school_id IS NOT NULL
ON CONFLICT DO NOTHING;