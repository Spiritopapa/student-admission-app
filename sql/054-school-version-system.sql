-- ============================================================
--  Student Admission Portal — SCHOOL TRIAL / FULL VERSION SYSTEM
--  ============================================================
--  Purpose:
--    1. Let the Super Admin tag each school with a version when
--       generating its School ID:
--         - 'full'  -> unlimited access
--         - 'trial' -> time-limited access with a set expiry.
--    2. Store the version on the `schools` row (plan_version) plus
--       the trial expiry (trial_ends_at) so the rest of the app
--       and the dashboard can enforce / display it.
--    3. Make the generated School ID self-describing:
--         - Full  : SCH-<INIT>-NNNN   e.g. SCH-SIS-0001
--         - Trial : SCH-TRIAL-<INIT>-NNNN e.g. SCH-TRIAL-SIS-0001
-- ============================================================

-- -----------------------------------------------------------
-- 1. EXTEND SCHOOLS TABLE WITH VERSION FIELDS
-- -----------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS plan_version TEXT DEFAULT 'full'
    CHECK (plan_version IN ('trial', 'full')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Backfill: any existing school without an explicit version is 'full'.
UPDATE public.schools
SET plan_version = 'full'
WHERE plan_version IS NULL;

-- -----------------------------------------------------------
-- 2. REWRITE SCHOOL ID GENERATOR WITH VERSION SUPPORT
--    Old format            : SCH-<INIT>-NNNN
--    New full version      : SCH-<INIT>-NNNN
--    New trial version     : SCH-TRIAL-<INIT>-NNNN
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_school_id(TEXT);
DROP FUNCTION IF EXISTS public.generate_school_id(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.generate_school_id(
  p_school_name TEXT,
  p_version     TEXT DEFAULT 'full'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initials TEXT;
  v_clean    TEXT;
  v_next     INT;
  v_version  TEXT;
  new_id     TEXT;
BEGIN
  -- Normalise the version argument (default full).
  v_version := lower(coalesce(p_version, 'full'));
  IF v_version NOT IN ('trial', 'full') THEN
    RAISE EXCEPTION 'p_version must be either "trial" or "full".';
  END IF;

  -- Derive up to 3 uppercase initials (A-Z) from the significant words.
  v_clean := upper(coalesce(p_school_name, ''));
  v_clean := regexp_replace(v_clean, '[^A-Z0-9 ]', ' ');

  SELECT string_agg(left(w, 1), '') INTO v_initials
  FROM unnest(regexp_split_to_array(v_clean, '\s+')) AS w
  WHERE w <> '';

  v_initials := upper(left(coalesce(v_initials, ''), 3));
  IF v_initials = '' THEN
    v_initials := 'SCH';
  END IF;

  -- Build the next unique id for THIS initials prefix, considering BOTH
  -- full (SCH-<INIT>-NNNN) and trial (SCH-TRIAL-<INIT>-NNNN) formats.
  new_id := '';
  LOOP
    SELECT COALESCE(MAX(t.num::INTEGER), 0) + 1 INTO v_next
    FROM (
      SELECT (regexp_match(registration_id, '(\d+)$'))[1] AS num
      FROM public.schools
      WHERE registration_id LIKE 'SCH-' || v_initials || '-%'
         OR registration_id LIKE 'SCH-TRIAL-' || v_initials || '-%'
    ) t
    WHERE t.num ~ '^[0-9]+$';

    IF v_version = 'trial' THEN
      new_id := 'SCH-TRIAL-' || v_initials || '-' || LPAD(v_next::TEXT, 4, '0');
    ELSE
      new_id := 'SCH-' || v_initials || '-' || LPAD(v_next::TEXT, 4, '0');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.schools WHERE registration_id = new_id) THEN
      EXIT;
    END IF;
    v_next := v_next + 1;
  END LOOP;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_school_id(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_school_id(TEXT, TEXT) TO anon;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================
