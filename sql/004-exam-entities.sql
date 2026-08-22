-- ============================================================
--  Student Admission Portal — Exam Entities
--  Tables: exams, exam_results, exam_subjects, exam_student_details
-- ============================================================

-- ---------------------------------------------------
-- 10. EXAMS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term          TEXT NOT NULL DEFAULT 'First'
                  CHECK (term IN ('First','Second','Third')),
  start_date    DATE,
  end_date      DATE,
  closing_date  DATE,
  reopening_date DATE,
  is_active     BOOLEAN DEFAULT true,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id     UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

-- Admins can manage exams
CREATE POLICY "Admins manage exams"
  ON public.exams FOR ALL
  USING (
    public.can_access_school_data(exams.school_id)
    OR public.is_approved_teacher()
  );

-- Students can view active exams
CREATE POLICY "Students view active exams"
  ON public.exams FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.user_id = auth.uid()
    )
  );

-- Parents can view active exams for ward
CREATE POLICY "Parents view ward exams"
  ON public.exams FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = pl.student_id
        AND pl.parent_user_id = auth.uid()
      )
    )
  );

-- Indexes for exams
CREATE INDEX IF NOT EXISTS idx_exams_active ON public.exams(is_active);
CREATE INDEX IF NOT EXISTS idx_exams_year_term ON public.exams(academic_year, term);
CREATE INDEX IF NOT EXISTS idx_exams_school_id ON public.exams(school_id);

-- ---------------------------------------------------
-- 11. EXAM RESULTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id        UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  marks_obtained NUMERIC(5,2),
  class_score    NUMERIC(5,2),
  exam_score     NUMERIC(5,2),
  exam_score_input NUMERIC(5,2),
  grade          TEXT,
  remarks        TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id      UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_id, student_id, subject)
);

ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins can manage results
CREATE POLICY "Admins manage results"
  ON public.exam_results FOR ALL
  USING (
    public.can_access_school_data(exam_results.school_id)
    OR (
      public.is_approved_teacher()
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.student_id = exam_results.student_id
        AND a.class_applying = public.get_teacher_class()
      )
    )
  );

-- Students can view own results
CREATE POLICY "Students view own results"
  ON public.exam_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = exam_results.student_id
      AND a.user_id = auth.uid()
    )
  );

-- Parents can view ward results
CREATE POLICY "Parents view ward results"
  ON public.exam_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.student_id = exam_results.student_id
      AND pl.parent_user_id = auth.uid()
    )
  );

-- Indexes for exam_results
CREATE INDEX IF NOT EXISTS idx_results_exam ON public.exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON public.exam_results(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_school_id ON public.exam_results(school_id);

-- ---------------------------------------------------
-- 12. EXAM SUBJECTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  class_name    TEXT,
  subject       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_id, class_name, subject)
);

ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage exam subjects"
  ON public.exam_subjects FOR ALL
  USING (
    public.can_access_school_data(
      (SELECT school_id FROM public.exams WHERE id = exam_subjects.exam_id)
    )
  );

-- Teachers can view exam subjects for their school
CREATE POLICY "Teachers view exam subjects for their school"
  ON public.exam_subjects FOR SELECT
  USING (
    public.is_approved_teacher()
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_subjects.exam_id
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
        AND t.is_approved = true
        AND (t.school_id = e.school_id OR t.school_id IS NULL)
      )
    )
  );

-- Students can view exam subjects for exams where they have results
CREATE POLICY "Students view exam subjects for their exams"
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
  );

-- Parents can view exam subjects for ward exams
CREATE POLICY "Parents view exam subjects for ward exams"
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
  );

CREATE INDEX IF NOT EXISTS idx_exam_subjects_exam ON public.exam_subjects(exam_id);

-- ---------------------------------------------------
-- 13. EXAM STUDENT DETAILS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_student_details (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  interest      TEXT NOT NULL DEFAULT 'mathematics'
                  CHECK (interest IN ('mathematics', 'singing', 'writing', 'reading', 'athletics', 'science')),
  attitude      TEXT NOT NULL DEFAULT 'active'
                  CHECK (attitude IN ('active', 'respectful', 'calm', 'obedient', 'pay attention', 'dull', 'truant', 'not active')),
  class_teacher_remarks TEXT,
  overall_position INT,
  head_teacher_remarks TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_id, student_id)
);

ALTER TABLE public.exam_student_details ENABLE ROW LEVEL SECURITY;

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
        AND a.class_applying = public.get_teacher_class()
      )
    )
  );

CREATE POLICY "Students view own exam details"
  ON public.exam_student_details FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = exam_student_details.student_id
      AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Parents view ward exam details"
  ON public.exam_student_details FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.student_id = exam_student_details.student_id
      AND pl.parent_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_exam_student_details_exam ON public.exam_student_details(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_student_details_student ON public.exam_student_details(student_id);