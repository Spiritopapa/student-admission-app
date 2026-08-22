-- ============================================================
--  Student Admission Portal — Teacher Multiple Class-Subject Assignments
--  Allows teachers to be assigned to multiple classes and multiple subjects
-- ============================================================

-- ---------------------------------------------------
-- TEACHER CLASSES SUBJECTS (junction table)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_classes_subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_name    TEXT NOT NULL,
  subject_name  TEXT NOT NULL,
  school_id     UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.teacher_classes_subjects ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins can manage teacher assignments
CREATE POLICY "Admins manage teacher class-subject assignments"
  ON public.teacher_classes_subjects FOR ALL
  USING (
    public.can_access_school_data(teacher_classes_subjects.school_id)
  )
  WITH CHECK (
    public.can_access_school_data(teacher_classes_subjects.school_id)
  );

-- Teachers can view their own assignments
CREATE POLICY "Teachers view own class-subject assignments"
  ON public.teacher_classes_subjects FOR SELECT
  USING (
    teacher_id IN (
      SELECT id FROM public.teachers WHERE user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tcs_teacher_id ON public.teacher_classes_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tcs_class_name ON public.teacher_classes_subjects(class_name);
CREATE INDEX IF NOT EXISTS idx_tcs_subject_name ON public.teacher_classes_subjects(subject_name);
CREATE INDEX IF NOT EXISTS idx_tcs_school_id ON public.teacher_classes_subjects(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tcs_teacher_class_subject_unique 
  ON public.teacher_classes_subjects (teacher_id, class_name, subject_name);

-- ---------------------------------------------------
-- UPDATED HELPER FUNCTIONS
-- ---------------------------------------------------

-- Updated: Get teacher's classes (returns array of class names)
CREATE OR REPLACE FUNCTION public.get_teacher_classes()
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  class_names TEXT[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT tcs.class_name ORDER BY tcs.class_name)
  INTO class_names
  FROM public.teacher_classes_subjects tcs
  JOIN public.teachers t ON t.id = tcs.teacher_id
  WHERE t.user_id = auth.uid()
  AND t.is_approved = true;
  
  -- Fallback to single class_taught if no junction records exist
  IF class_names IS NULL THEN
    SELECT ARRAY(
      SELECT class_taught FROM public.teachers
      WHERE user_id = auth.uid()
      AND is_approved = true
      AND class_taught IS NOT NULL
      LIMIT 1
    ) INTO class_names;
  END IF;
  
  RETURN class_names;
END;
$$;

-- Updated: Get teacher's subjects for a given class
CREATE OR REPLACE FUNCTION public.get_teacher_subjects(p_class_name TEXT DEFAULT NULL)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  subject_names TEXT[];
BEGIN
  IF p_class_name IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT tcs.subject_name ORDER BY tcs.subject_name)
    INTO subject_names
    FROM public.teacher_classes_subjects tcs
    JOIN public.teachers t ON t.id = tcs.teacher_id
    WHERE t.user_id = auth.uid()
    AND t.is_approved = true
    AND tcs.class_name = p_class_name;
  ELSE
    SELECT ARRAY_AGG(DISTINCT tcs.subject_name ORDER BY tcs.subject_name)
    INTO subject_names
    FROM public.teacher_classes_subjects tcs
    JOIN public.teachers t ON t.id = tcs.teacher_id
    WHERE t.user_id = auth.uid()
    AND t.is_approved = true;
  END IF;
  
  -- Fallback to single subject if no junction records exist
  IF subject_names IS NULL THEN
    SELECT ARRAY(
      SELECT subject FROM public.teachers
      WHERE user_id = auth.uid()
      AND is_approved = true
      AND subject IS NOT NULL
      LIMIT 1
    ) INTO subject_names;
  END IF;
  
  RETURN subject_names;
END;
$$;

-- Keep old functions for backward compatibility but update them
CREATE OR REPLACE FUNCTION public.get_teacher_class()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  class_name TEXT;
BEGIN
  -- Try the first class from junction table
  SELECT tcs.class_name INTO class_name
  FROM public.teacher_classes_subjects tcs
  JOIN public.teachers t ON t.id = tcs.teacher_id
  WHERE t.user_id = auth.uid()
  AND t.is_approved = true
  ORDER BY tcs.class_name
  LIMIT 1;
  
  -- Fallback to single class_taught
  IF class_name IS NULL THEN
    SELECT class_taught INTO class_name
    FROM public.teachers
    WHERE user_id = auth.uid()
    AND is_approved = true
    LIMIT 1;
  END IF;
  
  RETURN class_name;
END;
$$;

-- Keep old is_approved_teacher function unchanged
CREATE OR REPLACE FUNCTION public.is_approved_teacher()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.teachers
    WHERE user_id = auth.uid()
    AND is_approved = true
  );
END;
$$;

-- Update RLS policy for teachers to see students from ANY of their assigned classes
DROP POLICY IF EXISTS "Teachers view class students" ON public.applications;

CREATE POLICY "Teachers view class students"
  ON public.applications FOR SELECT
  USING (
    public.is_approved_teacher()
    AND (
      class_applying = ANY(public.get_teacher_classes())
    )
  );