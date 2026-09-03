-- ============================================================
-- 058: School Registration Lookup — ALWAYS return the school name
-- ============================================================
-- PROBLEM
--   The school-admin registration wizard (Stage 1 → Stage 2) calls
--   get_school_registration_info(p_registration_id) and expects the
--   school NAME so it can auto-show it ("we found your school").
--
--   An older version of this function (034) returned ONLY the school_id:
--       RETURNS TABLE(school_id UUID)
--   When that version is deployed, `row.name` / `row.id` are undefined,
--   so the wizard hides a blank/none name in Step 2.
--
--   A later version (035) returned (id, name). This migration makes the
--   contract explicit and future-proof: it DROPs and re-creates the
--   function so it ALWAYS exposes the id, the display name, and the
--   registration_id (verified-safe, sealed with SECURITY DEFINER so RLS
--   cannot block the anonymous pre-auth lookup).
--
-- NOTE: `DROP FUNCTION` is required because PostgreSQL refuses to
--   CREATE OR REPLACE across a different return type.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_school_registration_info(TEXT);

CREATE OR REPLACE FUNCTION public.get_school_registration_info(p_registration_id TEXT)
RETURNS TABLE(id UUID, name TEXT, registration_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.registration_id
  FROM public.schools s
  WHERE s.registration_id = p_registration_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_school_registration_info(TEXT) TO authenticated;