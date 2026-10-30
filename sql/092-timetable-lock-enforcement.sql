-- ============================================================
-- 092 - Enforce the timetable module lock in the database
-- Safe for installations where 091 was applied before the lock-aware policies
-- were added to that migration.
-- ============================================================
INSERT INTO public.modules (name, label, icon, is_core, sort_order)
VALUES ('timetable', 'Timetable', '', false, 31)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_school_module_locked(p_school_id UUID, p_module_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_modules
    WHERE school_id = p_school_id AND module_name = p_module_name AND is_locked = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_school_module_locked(UUID, TEXT) TO authenticated;

ALTER POLICY "Admins manage school timetables" ON public.timetable_entries
  USING (public.can_access_school_data(school_id) AND NOT public.is_school_module_locked(school_id, 'timetable'))
  WITH CHECK (public.can_access_school_data(school_id) AND NOT public.is_school_module_locked(school_id, 'timetable'));

ALTER POLICY "Teachers view their timetable entries" ON public.timetable_entries
  USING (NOT public.is_school_module_locked(school_id, 'timetable') AND teacher_id IN (SELECT id FROM public.teachers WHERE user_id = auth.uid()));

ALTER POLICY "Students view their class timetable" ON public.timetable_entries
  USING (NOT public.is_school_module_locked(school_id, 'timetable') AND EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.user_id = auth.uid() AND a.status = 'admitted'
      AND a.school_id = timetable_entries.school_id AND a.class_applying = timetable_entries.class_name
  ));

ALTER POLICY "Parents view linked ward timetables" ON public.timetable_entries
  USING (NOT public.is_school_module_locked(school_id, 'timetable') AND EXISTS (
    SELECT 1 FROM public.parent_links pl
    JOIN public.applications a ON a.student_id = pl.student_id
    WHERE pl.parent_user_id = auth.uid() AND a.status = 'admitted'
      AND a.school_id = timetable_entries.school_id AND a.class_applying = timetable_entries.class_name
  ));
