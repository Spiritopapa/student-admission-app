-- ============================================================
--  Student Admission Portal — Attendance Event Days
--  New table: public.attendance_event_days
--
--  Lets a school admin mark a specific calendar date as an
--  "event day" — either a Holiday (no school) or a Manual /
--  Special day (e.g. sports day, staff training, power cut).
--
--  Event days are PURE INDICATORS for the attendance views:
--    * Daily mode  -> amber banner on the selected date.
--    * 30-day grid -> highlighted header + badge + tooltip.
--    * Daily view  -> amber chip next to the date in reports.
--  They never create attendance records and never block the
--  admin from marking Present/Absent on that date (a manual
--  special day can still be a school day).
--
--  Used by: js/modules/admin-attendance.js (manage + show),
--           js/modules/teacher-dashboard.js (show),
--           js/modules/attendance-report.js (show).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_event_days (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL,
  event_type  TEXT NOT NULL DEFAULT 'holiday'
              CHECK (event_type IN ('holiday','manual')),
  label       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, date)
);

ALTER TABLE public.attendance_event_days ENABLE ROW LEVEL SECURITY;

-- Admins (incl. super admin) manage event days for their school.
DROP POLICY IF EXISTS "Admins manage attendance event days" ON public.attendance_event_days;
CREATE POLICY "Admins manage attendance event days"
  ON public.attendance_event_days FOR ALL
  USING (public.can_access_school_data(attendance_event_days.school_id));

-- Approved teachers can view event days (read-only).
DROP POLICY IF EXISTS "Teachers view attendance event days" ON public.attendance_event_days;
CREATE POLICY "Teachers view attendance event days"
  ON public.attendance_event_days FOR SELECT
  USING (public.is_approved_teacher());

-- Students (and parents whose profile carries a school_id) can view
-- their own school's event days.
DROP POLICY IF EXISTS "Users view own school event days" ON public.attendance_event_days;
CREATE POLICY "Users view own school event days"
  ON public.attendance_event_days FOR SELECT
  USING (public.user_belongs_to_school(attendance_event_days.school_id));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_event_days_school
  ON public.attendance_event_days(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_event_days_date
  ON public.attendance_event_days(date);

-- Keep updated_at in sync (matching the generic trigger helper).
DROP TRIGGER IF EXISTS set_attendance_event_days_updated_at ON public.attendance_event_days;
CREATE TRIGGER set_attendance_event_days_updated_at
  BEFORE UPDATE ON public.attendance_event_days
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-fill school_id from the signed-in profile (matching attendance).
DROP TRIGGER IF EXISTS set_attendance_event_days_school_id ON public.attendance_event_days;
CREATE TRIGGER set_attendance_event_days_school_id
  BEFORE INSERT ON public.attendance_event_days
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();