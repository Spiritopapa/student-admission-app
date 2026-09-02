-- ============================================================
--  Student Admission Portal — Settings & Permissions
--  Tables: settings, sub_admin_activities, modules, sub_admin_modules
-- ============================================================

-- ---------------------------------------------------
-- 18. SETTINGS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  id            TEXT PRIMARY KEY DEFAULT 'singleton',
  school_name   TEXT,
  academic_year TEXT DEFAULT '2025/2026',
  current_term  TEXT DEFAULT 'First'
                CHECK (current_term IN ('First','Second','Third')),
  school_id     UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Admins can manage settings
CREATE POLICY "Admins manage settings"
  ON public.settings FOR ALL
  USING (
    public.can_access_school_data(settings.school_id)
  );

-- Users can view settings
CREATE POLICY "Users view settings"
  ON public.settings FOR SELECT
  USING (
    public.can_access_school_data(settings.school_id)
  );

-- Insert default settings for schools that don't have them
INSERT INTO public.settings (id, school_name, academic_year, current_term, school_id)
SELECT 'singleton', s.name, '2025/2026', 'First', s.id
FROM public.schools s
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings st WHERE st.school_id = s.id
);

-- ---------------------------------------------------
-- 20. SUB_ADMIN_ACTIVITIES
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sub_admin_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_admin_id    UUID REFERENCES public.sub_admins(id) ON DELETE CASCADE,
  sub_admin_name  TEXT,
  registration_id TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT DEFAULT 'general',
  entity_details  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sub_admin_activities ENABLE ROW LEVEL SECURITY;

-- Super admins can view all activities
CREATE POLICY "Super admins view all activities"
  ON public.sub_admin_activities FOR SELECT
  USING (
    public.user_has_role('super_admin')
  );

-- School admins can view activities for their school's sub admins
CREATE POLICY "School admins view own school activities"
  ON public.sub_admin_activities FOR SELECT
  USING (
    public.can_access_school_data(
      (SELECT school_id FROM public.sub_admins WHERE id = sub_admin_activities.sub_admin_id)
    )
  );

-- Sub admins can view their own activities
CREATE POLICY "Sub admins view own activities"
  ON public.sub_admin_activities FOR SELECT
  USING (
    (SELECT user_id FROM public.sub_admins WHERE id = sub_admin_activities.sub_admin_id) = auth.uid()
  );

-- Allow insert from the activity logger
CREATE POLICY "Insert activities"
  ON public.sub_admin_activities FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sub_admin_activities_sub_admin ON public.sub_admin_activities(sub_admin_id);
CREATE INDEX IF NOT EXISTS idx_sub_admin_activities_created ON public.sub_admin_activities(created_at);

-- ---------------------------------------------------
-- 21. MODULES
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modules (
  name       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  icon       TEXT,
  is_core    BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view modules
CREATE POLICY "All authenticated users view modules"
  ON public.modules FOR SELECT
  USING (auth.role() = 'authenticated');

-- Super admins can manage modules
CREATE POLICY "Super admins manage modules"
  ON public.modules FOR ALL
  USING (public.user_has_role('super_admin'));

-- Seed module data
INSERT INTO public.modules (name, label, icon, is_core, sort_order) VALUES
  ('students', 'Students', '', true, 1),
  ('classes', 'Classes', '', true, 2),
  ('subjects', 'Subjects', '', true, 3),
  ('teachers', 'Teachers', '', false, 4),
  ('accountants', 'Accountants', '', false, 5),
  ('parents', 'Parents', '', false, 6),
  ('admit', 'Admit Student', '', true, 7),
  ('attendance', 'Attendance', '', false, 8),
  ('exams', 'Exams', '', false, 9),
  ('grading', 'Grading', '', false, 10),
  ('fees', 'Fees Management', '', false, 11)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------
-- 22. SUB_ADMIN_MODULES
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sub_admin_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_admin_id UUID REFERENCES public.sub_admins(id) ON DELETE CASCADE,
  module_name  TEXT REFERENCES public.modules(name) ON DELETE CASCADE,
  is_active    BOOLEAN DEFAULT true,
  UNIQUE(sub_admin_id, module_name)
);

ALTER TABLE public.sub_admin_modules ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all
CREATE POLICY "Super admins manage all sub_admin_modules"
  ON public.sub_admin_modules FOR ALL
  USING (public.user_has_role('super_admin'));

-- School admins can manage sub admin modules for their school
CREATE POLICY "School admins manage sub admin modules"
  ON public.sub_admin_modules FOR ALL
  USING (
    public.can_access_school_data(
      (SELECT school_id FROM public.sub_admins WHERE id = sub_admin_modules.sub_admin_id)
    )
  );