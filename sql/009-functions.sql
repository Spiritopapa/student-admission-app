-- ============================================================
--  Student Admission Portal — Functions
--  Includes: ID generation, check functions, link functions, utilities
-- ============================================================

-- ---------------------------------------------------
-- 25. ID GENERATION FUNCTIONS
-- ---------------------------------------------------

-- Generate school registration ID
CREATE OR REPLACE FUNCTION public.generate_school_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
  new_id TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(registration_id, '-', 2) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.schools
  WHERE registration_id LIKE 'SCH-%';
  new_id := 'SCH-' || LPAD(next_num::TEXT, 4, '0');
  RETURN new_id;
END;
$$;

-- Generate sub admin registration ID
CREATE OR REPLACE FUNCTION public.generate_sub_admin_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
  new_id TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(registration_id, '-', 2) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.sub_admins
  WHERE registration_id LIKE 'SA-%';
  new_id := 'SA-' || LPAD(next_num::TEXT, 4, '0');
  RETURN new_id;
END;
$$;

-- Generate teacher registration ID
CREATE OR REPLACE FUNCTION public.generate_teacher_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
  new_id TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(registration_id, '-', 2) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.teachers
  WHERE registration_id LIKE 'TCH-%';
  new_id := 'TCH-' || LPAD(next_num::TEXT, 4, '0');
  RETURN new_id;
END;
$$;

-- Generate accountant registration ID
CREATE OR REPLACE FUNCTION public.generate_accountant_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
  new_id TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(registration_id, '-', 2) AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.accountants
  WHERE registration_id LIKE 'ACC-%';
  new_id := 'ACC-' || LPAD(next_num::TEXT, 4, '0');
  RETURN new_id;
END;
$$;

-- Generate student ID (random alphanumeric)
CREATE OR REPLACE FUNCTION public.generate_student_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_id TEXT;
  id_exists BOOLEAN;
BEGIN
  LOOP
    new_id := 'STU-' ||
      substring(chars, floor(random() * length(chars) + 1)::int, 1) ||
      substring(chars, floor(random() * length(chars) + 1)::int, 1) ||
      substring(chars, floor(random() * length(chars) + 1)::int, 1) ||
      substring(chars, floor(random() * length(chars) + 1)::int, 1) ||
      substring(chars, floor(random() * length(chars) + 1)::int, 1);
    SELECT EXISTS(SELECT 1 FROM public.applications WHERE student_id = new_id) INTO id_exists;
    EXIT WHEN NOT id_exists;
  END LOOP;
  RETURN new_id;
END;
$$;

-- ---------------------------------------------------
-- 26. CHECK FUNCTIONS
-- ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_school_id_exists(target_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.schools WHERE registration_id = target_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_sub_admin_id_exists(target_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.sub_admins WHERE registration_id = target_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_teacher_id_exists(target_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.teachers WHERE registration_id = target_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_accountant_id_exists(target_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.accountants WHERE registration_id = target_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_student_id_exists(target_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.applications WHERE student_id = target_id);
END;
$$;

-- ---------------------------------------------------
-- 27. LINK FUNCTIONS
-- ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.link_school_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.schools
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_sub_admin_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sub_admins
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_teacher_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.teachers
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_accountant_to_user(p_registration_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.accountants
  SET user_id = p_user_id
  WHERE registration_id = p_registration_id AND user_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_student_to_application(p_student_id TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.applications
  SET user_id = p_user_id
  WHERE student_id = p_student_id AND user_id IS NULL;
END;
$$;

-- ---------------------------------------------------
-- 29. OTHER UTILITY FUNCTIONS
-- ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.super_admin_exists()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE role = 'super_admin');
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_auth_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_modules_for_sub_admin(p_user_id UUID)
RETURNS TABLE(module_name TEXT, label TEXT, icon TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.name, m.label, m.icon
  FROM public.modules m
  WHERE m.is_core = true
  UNION
  SELECT m.name, m.label, m.icon
  FROM public.sub_admin_modules sam
  JOIN public.modules m ON m.name = sam.module_name
  JOIN public.sub_admins sa ON sa.id = sam.sub_admin_id
  WHERE sa.user_id = p_user_id
  AND sam.is_active = true
  AND m.is_core = false
  ORDER BY m.sort_order;
END;
$$;