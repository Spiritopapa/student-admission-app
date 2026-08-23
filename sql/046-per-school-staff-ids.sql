-- ============================================================
--  Student Admission Portal — PER-SCHOOL TEACHER & ACCOUNTANT IDs
--  ============================================================
--  Purpose:
--    Teacher and accountant registration IDs now carry the school
--    name initials so each school has its own recognizable, unique
--    series:
--      Teacher   : TCH-SIN-0001   (Sunshine International School)
--      Accountant: ACC-SIN-0001
--    The `registration_id` column stays globally UNIQUE because the
--    initials prefix differs per school (and collisions are still
--    avoided by scanning the whole table for the exact prefix).
-- ============================================================

-- -----------------------------------------------------------
-- Shared helper: initials (up to 3) derived from a school's name
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_initials(p_school_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean    TEXT;
  v_initials TEXT;
BEGIN
  SELECT upper(name) INTO v_clean FROM public.schools WHERE id = p_school_id;
  v_clean := regexp_replace(coalesce(v_clean, ''), '[^A-Z0-9 ]', ' ');

  SELECT string_agg(left(w, 1), '') INTO v_initials
  FROM unnest(regexp_split_to_array(v_clean, '\s+')) AS w
  WHERE w <> '';

  v_initials := upper(left(coalesce(v_initials, ''), 3));
  IF v_initials = '' THEN
    v_initials := 'SCH';
  END IF;
  RETURN v_initials;
END;
$$;

GRANT EXECUTE ON FUNCTION public.school_initials(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.school_initials(UUID) TO anon;

-- -----------------------------------------------------------
-- 1. TEACHER ID (per-school)
--    Old: TCH-0001   New: TCH-SIN-0001
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_teacher_id();

CREATE OR REPLACE FUNCTION public.generate_teacher_id(p_school_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initials TEXT;
  new_id     TEXT;
  v_next     INT;
BEGIN
  v_initials := public.school_initials(p_school_id);

  LOOP
    SELECT COALESCE(MAX(num::INTEGER), 0) + 1 INTO v_next
    FROM (
      SELECT SPLIT_PART(registration_id, '-', 3) AS num
      FROM public.teachers
      WHERE registration_id LIKE 'TCH-' || v_initials || '-%'
    ) t
    WHERE t.num ~ '^[0-9]+$';

    new_id := 'TCH-' || v_initials || '-' || LPAD(v_next::TEXT, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE registration_id = new_id) THEN
      RETURN new_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_teacher_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_teacher_id(UUID) TO anon;

-- -----------------------------------------------------------
-- 2. ACCOUNTANT ID (per-school)
--    Old: ACC-0001   New: ACC-SIN-0001
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_accountant_id();

CREATE OR REPLACE FUNCTION public.generate_accountant_id(p_school_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initials TEXT;
  new_id     TEXT;
  v_next     INT;
BEGIN
  v_initials := public.school_initials(p_school_id);

  LOOP
    SELECT COALESCE(MAX(num::INTEGER), 0) + 1 INTO v_next
    FROM (
      SELECT SPLIT_PART(registration_id, '-', 3) AS num
      FROM public.accountants
      WHERE registration_id LIKE 'ACC-' || v_initials || '-%'
    ) t
    WHERE t.num ~ '^[0-9]+$';

    new_id := 'ACC-' || v_initials || '-' || LPAD(v_next::TEXT, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM public.accountants WHERE registration_id = new_id) THEN
      RETURN new_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_accountant_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_accountant_id(UUID) TO anon;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================