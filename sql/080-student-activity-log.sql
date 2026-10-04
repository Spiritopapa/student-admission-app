-- ============================================================
--  Student Admission Portal — Student Activity Log
--  Table: student_activities
--  Tracks login, profile updates and other key operations performed
--  by students so school admins can audit them, mirroring the
--  `staff_activities` table used for teachers & accountants.
-- ============================================================
--  Used by: src/lib/activity.js (logStudentActivity), the admin
--           Activity Log page and the per-student Activity modal.
--  Entity types: 'auth' (login), 'profile', 'report', 'announcement'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.student_activities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID,
  student_id            TEXT REFERENCES public.applications(student_id) ON DELETE CASCADE,
  student_name          TEXT,
  class_name            TEXT,
  action                TEXT NOT NULL,            -- e.g. 'Logged in', 'Updated profile'
  entity_type           TEXT DEFAULT 'general',
  entity_details        TEXT,
  performed_by_user_id  UUID,
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.student_activities ENABLE ROW LEVEL SECURITY;

-- Super admins can view all student activities
CREATE POLICY "Super admins view all student activities"
  ON public.student_activities FOR SELECT
  USING (
    public.user_has_role('super_admin')
  );

-- School admins can view activities within their own school
CREATE POLICY "School admins view own school student activities"
  ON public.student_activities FOR SELECT
  USING (
    public.can_access_school_data(student_activities.school_id)
  );

-- Each student can view their own activity log
CREATE POLICY "Students view own activities"
  ON public.student_activities FOR SELECT
  USING (
    student_activities.performed_by_user_id = auth.uid()
  );

-- Allow insert from the activity logger (role checks happen in JS)
CREATE POLICY "Insert student activities"
  ON public.student_activities FOR INSERT
  WITH CHECK (true);

-- School admins can clear a student's log ("Clear All Logs" button)
CREATE POLICY "School admins delete own school student activities"
  ON public.student_activities FOR DELETE
  USING (
    public.can_access_school_data(student_activities.school_id)
  );

-- Super admins can delete any student activity
CREATE POLICY "Super admins delete student activities"
  ON public.student_activities FOR DELETE
  USING (
    public.user_has_role('super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_student_activities_student ON public.student_activities(student_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_school ON public.student_activities(school_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_created ON public.student_activities(created_at);