-- ============================================================
--  Student Admission Portal — Module Lock Dashboard Filter
--  Adds a helper function to get locked modules for a school
--  and ensures the admin dashboard hides related sections.
-- ============================================================

-- ---------------------------------------------------
-- FUNCTION: Get locked module names for a school
-- Returns all module names that are locked for the given school.
-- Used by the admin dashboard to hide related sections.
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_locked_modules_for_school(p_school_id UUID)
RETURNS TABLE(module_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT sm.module_name
  FROM public.school_modules sm
  WHERE sm.school_id = p_school_id
  AND sm.is_locked = true;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_locked_modules_for_school(UUID) TO authenticated;