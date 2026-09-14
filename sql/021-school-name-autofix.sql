-- ============================================================
--  Student Admission Portal — SCHOOL NAME AUTO-FIX
--  ============================================================
--  PROBLEM:
--    When the Super Admin creates a school via the dashboard,
--    only the `schools` table is populated. No `school_settings`
--    row is created for the new school, so the school name never
--    appears on the admin dashboard, exam report cards, fees
--    receipts, attendance reports, etc.
--
--  NOTE:
--    The legacy `settings` table has a PRIMARY KEY on `id` with
--    default 'singleton', so it can only hold ONE global row.
--    The correct per-school settings table is `school_settings`
--    (created by 020-data-isolation-fix.sql), keyed by school_id.
--
--  THIS FIX:
--    1. Creates a database trigger on `schools` that automatically
--       creates a `school_settings` row whenever a new school is
--       inserted (works for ALL code paths).
--    2. Backfills `school_settings` for any existing schools that
--       are missing these rows.
--    3. Keeps `school_settings` in sync when a school's name changes.
--
--  HOW TO APPLY:
--    Open Supabase Dashboard → SQL Editor → New Query
--    Copy the ENTIRE content of this file → Paste and Run
-- ============================================================

-- -----------------------------------------------------------
-- 1. TRIGGER FUNCTION: Auto-create school_settings for a new school
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_school_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into the per-school `school_settings` table (the correct design)
  INSERT INTO public.school_settings (school_id, school_name, academic_year, current_term)
  VALUES (NEW.id, NEW.name, '2025/2026', 'First')
  ON CONFLICT (school_id) DO UPDATE SET
    school_name = EXCLUDED.school_name;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_school_settings() TO authenticated;

-- -----------------------------------------------------------
-- 2. TRIGGER: Fire on every new school insert
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_create_school_settings ON public.schools;
CREATE TRIGGER trg_create_school_settings
  AFTER INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.create_school_settings();

-- -----------------------------------------------------------
-- 3. BACKFILL: Create `school_settings` rows for schools missing them
-- -----------------------------------------------------------
INSERT INTO public.school_settings (school_id, school_name, academic_year, current_term)
SELECT s.id, s.name, '2025/2026', 'First'
FROM public.schools s
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_settings ss WHERE ss.school_id = s.id
);

-- -----------------------------------------------------------
-- 4. Also keep school_settings in sync when a school's name changes
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_school_settings_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.school_settings
    SET school_name = NEW.name, updated_at = now()
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

-- -----------------------------------------------------------
-- 5. SAFETY: Ensure school_settings table exists
--    (in case 020-data-isolation-fix.sql hasn't been run yet)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_settings (
  school_id     UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  school_name   TEXT,
  school_address TEXT,
  school_motto   TEXT,
  academic_year TEXT DEFAULT '2025/2026',
  current_term  TEXT DEFAULT 'First' CHECK (current_term IN ('First','Second','Third')),
  total_term_days INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

-- School staff can manage their own school's settings
DROP POLICY IF EXISTS "School staff manage own school settings" ON public.school_settings;
CREATE POLICY "School staff manage own school settings"
  ON public.school_settings FOR ALL
  USING (
    public.user_has_role('super_admin')
    OR public.is_school_staff(school_settings.school_id)
  )
  WITH CHECK (
    public.user_has_role('super_admin')
    OR public.is_school_staff(school_settings.school_id)
  );

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  New schools auto-create school_settings rows
--  Existing schools backfilled
--  School name changes propagate to school_settings
-- ============================================================
