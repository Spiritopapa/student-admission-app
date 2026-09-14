-- ============================================================
--  Student Admission Portal — Helper Functions
--  Must be created FIRST before any RLS policies that reference them
-- ============================================================

-- Function to check if a user has a specific role (reads from profiles table)
CREATE OR REPLACE FUNCTION public.user_has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = p_role
  );
END;
$$;

-- Function: Get current user's school_id from profiles
CREATE OR REPLACE FUNCTION public.get_user_school_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school_id UUID;
BEGIN
  SELECT p.school_id INTO school_id
  FROM public.profiles p
  WHERE p.id = auth.uid();
  RETURN school_id;
END;
$$;

-- Helper function: Check if user belongs to a specific school
CREATE OR REPLACE FUNCTION public.user_belongs_to_school(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND school_id = p_school_id
  );
END;
$$;

-- Helper function: Check if user can access data for a given school
CREATE OR REPLACE FUNCTION public.can_access_school_data(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Super admins can access all schools
  IF public.user_has_role('super_admin') THEN
    RETURN true;
  END IF;
  -- Other users can only access their own school
  RETURN public.user_belongs_to_school(p_school_id);
END;
$$;

-- Teacher helper functions (must exist before policies that reference them)
CREATE OR REPLACE FUNCTION public.get_teacher_class()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  class_name TEXT;
BEGIN
  SELECT class_taught INTO class_name
  FROM public.teachers
  WHERE user_id = auth.uid()
  AND is_approved = true
  LIMIT 1;
  RETURN class_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_teacher()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.teachers
    WHERE user_id = auth.uid()
    AND is_approved = true
  );
END;
$$;