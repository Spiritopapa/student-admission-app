-- ============================================================
--  SchoolRunner — Public Admission Application
--  Migration 074
--
--  Lets prospective students apply for admission from the public
--  website. Inserts flow through a SECURITY DEFINER RPC so anon
--  users cannot read or modify other applications. The generated
--  row is 'pending'; a Sub Administrator reviews and confirms it
--  from the admin Students module.
--
--  Also exposes a minimal public school lookup (only approved
--  schools' names) so applicants can pick the school they are
--  applying to. Safe to re-run.
-- ============================================================

-- ---------------------------------------------------
-- 1. Public school lookup for the apply page
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_schools()
RETURNS TABLE (id UUID, name TEXT, location TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.address
  FROM public.schools s
  WHERE s.is_approved = true
  ORDER BY s.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_schools() TO anon, authenticated;

-- ---------------------------------------------------
-- 2. Secure application submission
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_admission_application(
  p_school_id        UUID,
  p_first_name       TEXT,
  p_middle_name      TEXT,
  p_last_name        TEXT,
  p_class_applying   TEXT,
  p_date_of_birth    DATE,
  p_parent_name      TEXT,
  p_parent_contact   TEXT,
  p_gender           TEXT DEFAULT 'Male',
  p_religion         TEXT DEFAULT 'Christian',
  p_home_town        TEXT DEFAULT NULL,
  p_place_of_stay    TEXT DEFAULT NULL,
  p_previous_school  TEXT DEFAULT NULL,
  p_photo_path       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id TEXT;
  v_app public.applications;
BEGIN
  IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
    RAISE EXCEPTION 'First name is required';
  END IF;
  IF p_last_name IS NULL OR TRIM(p_last_name) = '' THEN
    RAISE EXCEPTION 'Last name is required';
  END IF;
  IF p_class_applying IS NULL OR TRIM(p_class_applying) = '' THEN
    RAISE EXCEPTION 'Class is required';
  END IF;
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'Date of birth is required';
  END IF;
  IF p_parent_name IS NULL OR TRIM(p_parent_name) = '' THEN
    RAISE EXCEPTION 'Parent name is required';
  END IF;
  IF p_parent_contact IS NULL OR TRIM(p_parent_contact) = '' THEN
    RAISE EXCEPTION 'Parent contact is required';
  END IF;
  IF p_school_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.schools WHERE id = p_school_id AND is_approved = true
  ) THEN
    RAISE EXCEPTION 'School not found or not yet approved';
  END IF;
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'Please select your school';
  END IF;

  SELECT public.generate_student_id() INTO v_student_id;

  INSERT INTO public.applications (
    student_id, first_name, middle_name, last_name, class_applying,
    date_of_birth, gender, religion, parent_name, parent_contact,
    home_town, place_of_stay, previous_school, student_photo_url,
    status, school_id, created_at, updated_at
  )
  VALUES (
    v_student_id,
    TRIM(p_first_name), NULLIF(TRIM(p_middle_name), ''), TRIM(p_last_name),
    TRIM(p_class_applying), p_date_of_birth, p_gender, p_religion,
    TRIM(p_parent_name), TRIM(p_parent_contact),
    NULLIF(TRIM(p_home_town), ''), NULLIF(TRIM(p_place_of_stay), ''),
    NULLIF(TRIM(p_previous_school), ''), p_photo_path,
    'pending', p_school_id, now(), now()
  )
  RETURNING * INTO v_app;

  RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'application', to_jsonb(v_app));
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_admission_application(UUID, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;