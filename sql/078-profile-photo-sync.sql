-- ============================================================
--  Student Admission Portal — Profile Photo Sync
-- ============================================================
--  PURPOSE:
--    The React profile pages persist a profile photo on the `profiles`
--    row (profiles.photo_url) and mirror it into the role-specific
--    source tables so every part of the app reflects the change:
--      teacher    -> teachers.photo_url
--      accountant -> accountants.photo_url
--      admin      -> schools.admin_photo_url
--      student    -> applications.student_photo_url
--
--    However, `profiles.photo_url` had no schema migration of its own
--    (the client wrote it directly), so on fresh deployments the column
--    can be missing entirely and profile photo saves silently fail.
--    This migration:
--      01. Guarantees profiles.photo_url exists.
--      02. Backfills profiles.photo_url from the authoritative staff /
--          student records (only fills NULLs).
--      03. Mirrors any existing profiles.photo_url back into stale
--          staff / student records so admin lists and dashboards that
--          read the role tables show the same photo.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
--  Safe to re-run (IF NOT EXISTS / UPDATE ... WHERE ... NULL-updates).
-- ============================================================

-- ------------------------------------------------------------
-- 01. Guarantee the column used by the React profile page.
-- ------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ------------------------------------------------------------
-- 02. Backfill into profiles from the authoritative source rows.
-- ------------------------------------------------------------
UPDATE public.profiles p
SET photo_url = t.photo_url
FROM public.teachers t
WHERE t.user_id = p.id
  AND p.role = 'teacher'
  AND p.photo_url IS NULL
  AND t.photo_url IS NOT NULL;

UPDATE public.profiles p
SET photo_url = a.photo_url
FROM public.accountants a
WHERE a.user_id = p.id
  AND p.role = 'accountant'
  AND p.photo_url IS NULL
  AND a.photo_url IS NOT NULL;

UPDATE public.profiles p
SET photo_url = s.admin_photo_url
FROM public.schools s
WHERE s.user_id = p.id
  AND p.role = 'admin'
  AND p.photo_url IS NULL
  AND s.admin_photo_url IS NOT NULL;

UPDATE public.profiles p
SET photo_url = app.student_photo_url
FROM public.applications app
WHERE app.user_id = p.id
  AND p.role = 'student'
  AND p.photo_url IS NULL
  AND app.student_photo_url IS NOT NULL;

-- ------------------------------------------------------------
-- 03. Mirror existing profile photos back into the role tables
--     so admin lists / staff records stay consistent. Only touched
--     when the values differ; the accountant name-lock trigger does
--     not fire because it only watches full_name.
-- ------------------------------------------------------------
UPDATE public.teachers t
SET photo_url = p.photo_url
FROM public.profiles p
WHERE p.id = t.user_id
  AND p.photo_url IS NOT NULL
  AND t.photo_url IS DISTINCT FROM p.photo_url;

UPDATE public.accountants a
SET photo_url = p.photo_url
FROM public.profiles p
WHERE p.id = a.user_id
  AND p.photo_url IS NOT NULL
  AND a.photo_url IS DISTINCT FROM p.photo_url;

UPDATE public.schools s
SET admin_photo_url = p.photo_url
FROM public.profiles p
WHERE p.id = s.user_id
  AND p.photo_url IS NOT NULL
  AND s.admin_photo_url IS DISTINCT FROM p.photo_url;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================
--  After running:
--   1. profiles.photo_url always exists for every role.
--   2. Existing photos are backfilled from and mirrored into the
--      role-specific tables, so profile changes display everywhere.
--   3. No existing data is overwritten when values already match.
-- ============================================================