-- ============================================================
--  Student Admission Portal — School Onboarding Applications
--  ============================================================
--  Adds a `school_applications` table so prospective schools can
--  apply to join the platform from the public onboarding page
--  (school-onboarding.html), which a real school visits BEFORE it
--  has a School ID.
--
--  Each application is reviewed on the Super Admin dashboard:
--  the Super Admin can approve, reject or delete it.
--
--  Insertion happens ONLY through the SECURITY DEFINER RPC
--  `submit_school_application()`, which is granted to the `anon` role
--  (public page) and to `authenticated`. RLS forbids a public user from
--  reading or listing anyone else's application; only Super Admins may
--  SELECT / UPDATE / DELETE rows.
-- ============================================================

-- ---------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name           TEXT NOT NULL,
  admin_name            TEXT NOT NULL,
  admin_email           TEXT NOT NULL,
  admin_phone           TEXT,
  school_type           TEXT NOT NULL DEFAULT 'private'
                        CHECK (school_type IN ('public','private')),
  location              TEXT,
  student_population    INTEGER,
  message               TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.school_applications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------
-- 2. SECURE SUBMIT FUNCTION (public/anonymous safe)
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_school_application(
  p_school_name TEXT,
  p_admin_name  TEXT,
  p_admin_email TEXT,
  p_admin_phone TEXT,
  p_school_type TEXT,
  p_location    TEXT,
  p_population  INTEGER,
  p_message     TEXT
)
RETURNS public.school_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.school_applications;
BEGIN
  IF p_school_name IS NULL OR TRIM(p_school_name) = '' THEN
    RAISE EXCEPTION 'School name is required';
  END IF;
  IF p_admin_name IS NULL OR TRIM(p_admin_name) = '' THEN
    RAISE EXCEPTION 'Administrator name is required';
  END IF;
  IF p_admin_email IS NULL OR TRIM(p_admin_email) = '' THEN
    RAISE EXCEPTION 'Administrator email is required';
  END IF;
  IF p_school_type NOT IN ('public','private') THEN
    RAISE EXCEPTION 'Invalid school type';
  END IF;

  -- Guard against duplicate spam while the original is still pending.
  IF EXISTS (
    SELECT 1 FROM public.school_applications sa
    WHERE sa.status = 'pending'
      AND lower(sa.school_name) = lower(TRIM(p_school_name))
  ) THEN
    RAISE EXCEPTION 'A pending application already exists for this school.';
  END IF;

  INSERT INTO public.school_applications
    (school_name, admin_name, admin_email, admin_phone, school_type,
     location, student_population, message)
  VALUES
    (TRIM(p_school_name), TRIM(p_admin_name), TRIM(p_admin_email),
     NULLIF(TRIM(p_admin_phone), ''), p_school_type,
     NULLIF(TRIM(p_location), ''), NULLIF(p_population, 0),
     NULLIF(TRIM(p_message), ''))
  RETURNING * INTO v_app;

  RETURN v_app;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_school_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_school_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- ---------------------------------------------------
-- 3. TOUCH updated_at WHEN STATUS CHANGES
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_school_application_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_applications_touch_updated_at ON public.school_applications;
CREATE TRIGGER trg_school_applications_touch_updated_at
  BEFORE UPDATE ON public.school_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_school_application_updated_at();

-- ---------------------------------------------------
-- 4. RLS POLICIES (management is Super Admin only)
-- ---------------------------------------------------
-- Public users must NOT be able to read/list applications, so there is
-- intentionally NO public SELECT policy. Only the Super Admin can view
-- and manage the queue.
CREATE POLICY "Super admins manage school applications"
  ON public.school_applications FOR ALL
  USING (public.user_has_role('super_admin'));

-- ---------------------------------------------------
-- 5. INDEXES
-- ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_school_applications_status ON public.school_applications(status);
CREATE INDEX IF NOT EXISTS idx_school_applications_name  ON public.school_applications(lower(school_name));