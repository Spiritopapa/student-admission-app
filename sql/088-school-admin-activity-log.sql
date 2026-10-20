-- ============================================================
--  MIGRATION 088: SUPER ADMIN ACTIVITY LOG FOR EVERY SCHOOL ADMIN
-- ============================================================
--  WHAT THIS ADDS
--  1. sub_admin_activities.school_id — denormalized school link so the
--     Super Admin "Activity Log" can filter sub-admin rows by school
--     WITHOUT reading sub_admins (that table has no super-admin SELECT
--     policy). Backfills every existing row from sub_admins.
--  2. Comments documenting that school-admin rows live in
--     staff_activities with staff_type = 'admin' (the column never had
--     a CHECK constraint; its RLS already gives super admins SELECT on
--     every row and school admins SELECT on their own school's rows).
--
--  RLS (already in place — unchanged by this migration):
--    staff_activities     — super admin SELECT all / school-scoped SELECT /
--                           actor SELECT own; INSERT WITH CHECK (true)
--    sub_admin_activities — super admin SELECT all; INSERT WITH CHECK (true)
--
--  Written by: src/lib/activity.js (logAdminActivity / logSubAdminActivity)
--  Read by:    src/pages/superadmin/SuperAdminActivityLog.jsx
--
--  HOW TO APPLY
--  Run this file in the Supabase SQL Editor (or via 000-run-all.sql).
--  Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE public.sub_admin_activities ADD COLUMN IF NOT EXISTS school_id UUID;

UPDATE public.sub_admin_activities a
SET school_id = s.school_id
FROM public.sub_admins s
WHERE a.sub_admin_id = s.id
  AND a.school_id IS NULL
  AND s.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sub_admin_activities_school ON public.sub_admin_activities(school_id);

COMMENT ON COLUMN public.staff_activities.staff_type
  IS 'teacher | accountant | admin (school-admin rows written by logAdminActivity)';
COMMENT ON COLUMN public.sub_admin_activities.school_id
  IS 'School of the sub admin (backfilled by migration 088) — school filter for the super admin activity log.';
