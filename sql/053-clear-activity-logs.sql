-- ============================================================
--  Student Admission Portal — Clear Activity Logs (DELETE policies)
--  Addendum to sql/051-staff-activity-log.sql and
--  sql/007-settings-permissions.sql.
--
--  Adds DELETE policies so the "Clear All Logs" button in the
--  activity-log modals can remove every log row for one user:
--    * staff_activities     (teacher / accountant logs)
--    * sub_admin_activities (sub admin logs)
--
--  The DELETE policies mirror the existing SELECT policies so that
--  anyone who can VIEW a user's log can also clear it:
--    * super admins  → all schools
--    * school admins → their own school
--    * the user      → their own entries
--
--  SAFE TO RE-RUN (idempotent — each policy is created only if it
--  does not already exist).
-- ============================================================

-- ------------------------------------------------------------
-- 1. STAFF ACTIVITIES (teachers & accountants)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'staff_activities'
      AND policyname = 'Super admins delete staff activities'
  ) THEN
    CREATE POLICY "Super admins delete staff activities"
      ON public.staff_activities FOR DELETE
      USING (public.user_has_role('super_admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'staff_activities'
      AND policyname = 'School admins delete own school staff activities'
  ) THEN
    CREATE POLICY "School admins delete own school staff activities"
      ON public.staff_activities FOR DELETE
      USING (public.can_access_school_data(staff_activities.school_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'staff_activities'
      AND policyname = 'Staff delete own activities'
  ) THEN
    CREATE POLICY "Staff delete own activities"
      ON public.staff_activities FOR DELETE
      USING (staff_activities.performed_by_user_id = auth.uid());
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. SUB ADMIN ACTIVITIES
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sub_admin_activities'
      AND policyname = 'Super admins delete sub admin activities'
  ) THEN
    CREATE POLICY "Super admins delete sub admin activities"
      ON public.sub_admin_activities FOR DELETE
      USING (public.user_has_role('super_admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sub_admin_activities'
      AND policyname = 'School admins delete own school sub admin activities'
  ) THEN
    CREATE POLICY "School admins delete own school sub admin activities"
      ON public.sub_admin_activities FOR DELETE
      USING (
        public.can_access_school_data(
          (SELECT school_id FROM public.sub_admins WHERE id = sub_admin_activities.sub_admin_id)
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sub_admin_activities'
      AND policyname = 'Sub admins delete own activities'
  ) THEN
    CREATE POLICY "Sub admins delete own activities"
      ON public.sub_admin_activities FOR DELETE
      USING (
        (SELECT user_id FROM public.sub_admins WHERE id = sub_admin_activities.sub_admin_id) = auth.uid()
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. VERIFICATION — list the DELETE policies just created.
-- ------------------------------------------------------------
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'DELETE'
  AND tablename IN ('staff_activities', 'sub_admin_activities')
ORDER BY tablename, policyname;