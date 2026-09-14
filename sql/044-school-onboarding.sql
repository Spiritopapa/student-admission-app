-- ============================================================
--  Student Admission Portal — SCHOOL ONBOARDING & ID INITIALS
--  ============================================================
--  Purpose:
--    1. Make the school registration ID contain the school
--       name abbreviations/initials (e.g. "Sunshine International
--       School" -> "SCH-SIS-0001") so the ID is recognizable.
--    2. Add per-school onboarding columns (admin name, school
--       type, student population) captured during the school
--       admin registration wizard. "Location" reuses the existing
--       schools.address column; email & phone (mobile used for
--       password reset) already exist on the schools table.
--    3. Provide an anon-safe RPC so a not-yet-claimed school can
--       persist that onboarding data while the school admin is
--       still mid-registration (stages 1-3 happen before sign-up).
-- ============================================================

-- -----------------------------------------------------------
-- 1. EXTEND SCHOOLS TABLE WITH ONBOARDING FIELDS
-- -----------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admin_name TEXT,
  ADD COLUMN IF NOT EXISTS school_type TEXT CHECK (school_type IN ('public','private')),
  ADD COLUMN IF NOT EXISTS student_population INTEGER,
  ADD COLUMN IF NOT EXISTS location TEXT;

-- Backfill location from the existing address column for convenience.
UPDATE public.schools
SET location = COALESCE(location, address)
WHERE location IS NULL AND address IS NOT NULL;

-- -----------------------------------------------------------
-- 2. REWRITE SCHOOL ID GENERATION TO INCLUDE NAME INITIALS
--    Old format : SCH-0001
--    New format : SCH-SIA-0001   (initials derived from school name)
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_school_id();

CREATE OR REPLACE FUNCTION public.generate_school_id(p_school_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initials TEXT;
  v_clean    TEXT;
  v_next     INT;
  new_id     TEXT;
BEGIN
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

  -- Build the next unique id for THIS initials prefix.
  new_id := '';
  LOOP
    SELECT COALESCE(MAX(num::INTEGER), 0) + 1 INTO v_next
    FROM (
      SELECT SPLIT_PART(registration_id, '-', 3) AS num
      FROM public.schools
      WHERE registration_id LIKE 'SCH-' || v_initials || '-%'
    ) t
    WHERE t.num ~ '^[0-9]+$';

    new_id := 'SCH-' || v_initials || '-' || LPAD(v_next::TEXT, 4, '0');

    IF NOT EXISTS (SELECT 1 FROM public.schools WHERE registration_id = new_id) THEN
      EXIT;
    END IF;
    v_next := v_next + 1;
  END LOOP;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_school_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_school_id(TEXT) TO anon;

-- -----------------------------------------------------------
-- 3. ANON-SAFE ONBOARDING PERSIST RPC
--    Only applies while the school row is NOT yet claimed by an
--    admin user (user_id IS NULL), matching the registration flow.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_school_onboarding_info(
  p_registration_id   TEXT,
  p_admin_name        TEXT,
  p_school_type       TEXT,
  p_location          TEXT,
  p_email             TEXT,
  p_phone             TEXT,
  p_student_population INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN := false;
BEGIN
  IF p_school_type IS NULL OR p_school_type NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'school_type must be "public" or "private".';
  END IF;

  UPDATE public.schools
  SET admin_name          = NULLIF(p_admin_name, ''),
      school_type         = p_school_type,
      location            = COALESCE(NULLIF(p_location, ''), location, address),
      address             = COALESCE(NULLIF(p_location, ''), address),
      email               = COALESCE(NULLIF(p_email, ''), email),
      phone               = COALESCE(NULLIF(p_phone, ''), phone),
      student_population  = COALESCE(p_student_population, student_population),
      updated_at          = now()
  WHERE registration_id = p_registration_id
    AND user_id IS NULL
  RETURNING true INTO v_found;

  RETURN v_found;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_school_onboarding_info(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.save_school_onboarding_info(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================