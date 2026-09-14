-- ============================================================
--  Student Admission Portal — Bug Reports & Suggestions
--  ============================================================
--  Adds a `support_reports` table so ANY signed-in user can submit a
--  bug report or a suggestion about the app from their dashboard.
--
--  Reports are stored centrally and shown on the Super Admin dashboard,
--  where the Super Admin can view them, update their status
--  (new / in_progress / resolved) and delete them.
--
--  Submission happens through the SECURITY DEFINER RPC
--  `submit_support_report()` which derives the reporter identity
--  (name, email) and their school from their OWN profile, so a user
--  can never spoof another school or another identity.
-- ============================================================

-- ---------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type    TEXT NOT NULL DEFAULT 'suggestion'
                 CHECK (report_type IN ('bug','suggestion')),
  subject        TEXT NOT NULL,
  message        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','in_progress','resolved')),
  reported_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_name  TEXT,
  reporter_email TEXT,
  school_id      UUID REFERENCES public.schools(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.support_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------
-- 2. SECURE SUBMIT FUNCTION (derives identity from the caller's profile)
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_support_report(
  p_type TEXT,
  p_subject TEXT,
  p_message TEXT
)
RETURNS public.support_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID;
  v_name       TEXT;
  v_email      TEXT;
  v_school_id  UUID;
  v_report     public.support_reports;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type NOT IN ('bug','suggestion') THEN
    RAISE EXCEPTION 'Invalid report type';
  END IF;
  IF p_subject IS NULL OR TRIM(p_subject) = '' THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;
  IF p_message IS NULL OR TRIM(p_message) = '' THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  SELECT p.full_name, p.email, p.school_id
    INTO v_name, v_email, v_school_id
    FROM public.profiles p
   WHERE p.id = v_uid;

  INSERT INTO public.support_reports
    (report_type, subject, message, reported_by, reporter_name, reporter_email, school_id)
  VALUES
    (p_type, TRIM(p_subject), TRIM(p_message), v_uid, v_name, v_email, v_school_id)
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

-- ---------------------------------------------------
-- 3. TOUCH updated_at WHEN STATUS CHANGES
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_support_report_updated_at()
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

DROP TRIGGER IF EXISTS trg_support_reports_touch_updated_at ON public.support_reports;
CREATE TRIGGER trg_support_reports_touch_updated_at
  BEFORE UPDATE ON public.support_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_support_report_updated_at();

-- ---------------------------------------------------
-- 4. RLS POLICIES
-- ---------------------------------------------------
-- Users can insert their own report (defence-in-depth for direct inserts;
-- the submit_support_report() RPC already bypasses RLS securely).
CREATE POLICY "Users insert own reports"
  ON public.support_reports FOR INSERT
  WITH CHECK (auth.uid() = reported_by);

-- Users view their own reports; Super Admins view all.
CREATE POLICY "Users view own reports"
  ON public.support_reports FOR SELECT
  USING (
    auth.uid() = reported_by
    OR public.user_has_role('super_admin')
  );

-- Super Admins update status (work the queue).
CREATE POLICY "Super admins update reports"
  ON public.support_reports FOR UPDATE
  USING (public.user_has_role('super_admin'));

-- Super Admins delete reports.
CREATE POLICY "Super admins delete reports"
  ON public.support_reports FOR DELETE
  USING (public.user_has_role('super_admin'));

-- ---------------------------------------------------
-- 5. INDEXES
-- ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_support_reports_school_id ON public.support_reports(school_id);
CREATE INDEX IF NOT EXISTS idx_support_reports_status    ON public.support_reports(status);
CREATE INDEX IF NOT EXISTS idx_support_reports_type      ON public.support_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_support_reports_created   ON public.support_reports(created_at);