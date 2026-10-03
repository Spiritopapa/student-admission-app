-- ============================================================
--  Student Admission Portal — Bidirectional School Logo/Name Sync
-- ============================================================
--  PROBLEM:
--    School identity lives in two tables read by different parts
--    of the app:
--      schools          -> read by the Super Admin dashboard / list
--      school_settings  -> read by the school Admin dashboard /
--                          Settings page, receipts, report cards
--    When the school admin changes the logo (or name) in School
--    Settings, only `school_settings` was updated, so the Super
--    Admin dashboard kept showing the old `schools.logo_url`.
--    The reverse could also happen (Super Admin creating/editing
--    a school leaving `school_settings.logo_url` empty).
--
--  THIS FIX:
--    01. Extends create_school_settings() to carry logo_url over
--        when a school is inserted.
--    02. Extends sync_school_settings_on_update() so a `schools`
--        update of name/logo_url also updates `school_settings`.
--    03. Adds sync_schools_on_settings_update() so a
--        `school_settings` update of school_name/logo_url also
--        updates `schools`.
--    04. Backfills any existing gaps in both directions.
--
--    Infinite recursion is prevented by the IS DISTINCT FROM
--    guards: once the values match, the opposite trigger no-ops.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
--  Safe to re-run (CREATE OR REPLACE / trigger drop / UPDATEs).
-- ============================================================

-- ------------------------------------------------------------
-- 01. Auto-create school_settings WITH the logo url.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_school_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.school_settings (school_id, school_name, academic_year, current_term, logo_url)
  VALUES (NEW.id, NEW.name, '2025/2026', 'First', NEW.logo_url)
  ON CONFLICT (school_id) DO UPDATE SET
    school_name = EXCLUDED.school_name,
    logo_url    = COALESCE(EXCLUDED.logo_url, school_settings.logo_url);
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_school_settings() TO authenticated;

-- ------------------------------------------------------------
-- 02. schools -> school_settings (name + logo)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_school_settings_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.logo_url IS DISTINCT FROM OLD.logo_url THEN
    UPDATE public.school_settings
    SET school_name = NEW.name,
        logo_url    = COALESCE(NEW.logo_url, school_settings.logo_url),
        updated_at  = now()
    WHERE school_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_school_settings ON public.schools;
CREATE TRIGGER trg_sync_school_settings
  AFTER UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_school_settings_on_update();
-- ------------------------------------------------------------
-- 03. school_settings -> schools (name + logo)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_schools_on_settings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_name IS DISTINCT FROM OLD.school_name
     OR NEW.logo_url IS DISTINCT FROM OLD.logo_url THEN
    UPDATE public.schools
    SET name       = COALESCE(NULLIF(TRIM(NEW.school_name), ''), schools.name),
        logo_url   = COALESCE(NEW.logo_url, schools.logo_url),
        updated_at = now()
    WHERE id = NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_schools_on_settings_update ON public.school_settings;
CREATE TRIGGER trg_sync_schools_on_settings_update
  AFTER INSERT OR UPDATE OF school_name, logo_url ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_schools_on_settings_update();

-- ------------------------------------------------------------
-- 04. Backfill existing gaps (prefer the non-null side).
-- ------------------------------------------------------------
UPDATE public.school_settings ss
SET logo_url = s.logo_url
FROM public.schools s
WHERE s.id = ss.school_id
  AND ss.logo_url IS NULL
  AND s.logo_url IS NOT NULL;

UPDATE public.schools s
SET logo_url = ss.logo_url
FROM public.school_settings ss
WHERE ss.school_id = s.id
  AND s.logo_url IS NULL
  AND ss.logo_url IS NOT NULL;

UPDATE public.schools s
SET name = ss.school_name
FROM public.school_settings ss
WHERE ss.school_id = s.id
  AND s.name IS DISTINCT FROM ss.school_name
  AND NULLIF(TRIM(ss.school_name), '') IS NOT NULL;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================
--  After running:
--   1. A logo/name change from either side propagates to the
--      other table, so the Super Admin dashboard and the school
--      Admin portal always show the same logo and name.
--   2. Existing rows are backfilled (non-null wins).
--   3. Re-running is safe (CREATE OR REPLACE, trigger drops,
--      guarded UPDATEs).
-- ============================================================