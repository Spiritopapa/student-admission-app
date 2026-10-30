-- ============================================================
-- 091 - School timetables
-- One row is one scheduled lesson for a class on a weekday.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  room TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_timetable_entries_school_class
  ON public.timetable_entries (school_id, class_name, weekday, starts_at);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_teacher
  ON public.timetable_entries (teacher_id, weekday, starts_at);

ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage school timetables"
  ON public.timetable_entries FOR ALL
  USING (public.can_access_school_data(school_id))
  WITH CHECK (public.can_access_school_data(school_id));

CREATE POLICY "Teachers view their timetable entries"
  ON public.timetable_entries FOR SELECT
  USING (teacher_id IN (SELECT id FROM public.teachers WHERE user_id = auth.uid()));

CREATE POLICY "Students view their class timetable"
  ON public.timetable_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.user_id = auth.uid()
      AND a.status = 'admitted'
      AND a.school_id = timetable_entries.school_id
      AND a.class_applying = timetable_entries.class_name
  ));

CREATE POLICY "Parents view linked ward timetables"
  ON public.timetable_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    JOIN public.applications a ON a.student_id = pl.student_id
    WHERE pl.parent_user_id = auth.uid()
      AND a.status = 'admitted'
      AND a.school_id = timetable_entries.school_id
      AND a.class_applying = timetable_entries.class_name
  ));

DROP TRIGGER IF EXISTS set_timetable_entries_updated_at ON public.timetable_entries;
CREATE TRIGGER set_timetable_entries_updated_at
  BEFORE UPDATE ON public.timetable_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
