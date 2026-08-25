-- ============================================================
--  Student Admission Portal — Communication & Attendance
--  Tables: announcements, attendance
-- ============================================================

-- ---------------------------------------------------
-- 8. ANNOUNCEMENTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low','normal','high','urgent')),
  is_active   BOOLEAN DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Admins can manage announcements
CREATE POLICY "Admins manage announcements"
  ON public.announcements FOR ALL
  USING (
    public.can_access_school_data(announcements.school_id)
  );

-- Users can view active announcements in their own school
-- NOTE: Also supports NULL school_id (legacy records)
CREATE POLICY "Users view own school announcements"
  ON public.announcements FOR SELECT
  USING (
    is_active = true
    AND (
      announcements.school_id IS NULL
      OR public.can_access_school_data(announcements.school_id)
    )
  );

-- Indexes for announcements
CREATE INDEX IF NOT EXISTS idx_announcements_active ON public.announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON public.announcements(priority);
CREATE INDEX IF NOT EXISTS idx_announcements_school_id ON public.announcements(school_id);

-- ---------------------------------------------------
-- 19. ATTENDANCE
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'present'
                  CHECK (status IN ('present','absent')),
  class_name      TEXT NOT NULL,
  academic_year   TEXT NOT NULL,
  term            TEXT NOT NULL DEFAULT 'First'
                  CHECK (term IN ('First','Second','Third')),
  remarks         TEXT DEFAULT '',
  marked_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, date)
);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and teachers manage attendance"
  ON public.attendance FOR ALL
  USING (
    public.can_access_school_data(attendance.school_id)
    OR public.is_approved_teacher()
  )
  WITH CHECK (
    public.can_access_school_data(attendance.school_id)
    OR public.is_approved_teacher()
  );

CREATE POLICY "Students view own attendance"
  ON public.attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = attendance.student_id
      AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Parents view ward attendance"
  ON public.attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.student_id = attendance.student_id
      AND pl.parent_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON public.attendance(class_name);
CREATE INDEX IF NOT EXISTS idx_attendance_school_id ON public.attendance(school_id);