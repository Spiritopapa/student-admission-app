-- ============================================================
--  Student Admission Portal — School Module Permissions
--  Tables: school_modules
-- ============================================================
-- Run this after the main schema has been applied.
-- ============================================================

-- ---------------------------------------------------
-- SCHOOL MODULES TABLE
-- Links schools to module permissions.
-- Super admin can lock/unlock modules per school.
-- When a module is locked for a school, that school's
-- admin sidebar hides the locked modules.
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_modules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  module_name     TEXT NOT NULL REFERENCES public.modules(name) ON DELETE CASCADE,
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, module_name)
);

ALTER TABLE public.school_modules ENABLE ROW LEVEL SECURITY;

-- Super admins can manage school_modules
CREATE POLICY "Super admins manage school_modules"
  ON public.school_modules FOR ALL
  USING (
    public.user_has_role('super_admin')
  )
  WITH CHECK (
    public.user_has_role('super_admin')
  );

-- School admins can view their own school's module permissions
-- (needed so the frontend can filter the sidebar)
CREATE POLICY "School admins view own school modules"
  ON public.school_modules FOR SELECT
  USING (
    public.can_access_school_data(school_modules.school_id)
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_school_modules_school ON public.school_modules(school_id);
CREATE INDEX IF NOT EXISTS idx_school_modules_module ON public.school_modules(module_name);

-- Trigger for updated_at
CREATE TRIGGER set_school_modules_updated_at
  BEFORE UPDATE ON public.school_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------
-- FUNCTION: Get active (non-locked) modules for a school
-- Returns all modules that are NOT locked for the given school.
-- Core modules are always active regardless of lock status.
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_modules_for_school(p_school_id UUID)
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
  AND NOT EXISTS (
    SELECT 1 FROM public.school_modules sm
    WHERE sm.school_id = p_school_id
    AND sm.module_name = m.name
    AND sm.is_locked = true
  )
  UNION
  SELECT m.name, m.label, m.icon
  FROM public.modules m
  WHERE m.is_core = false
  AND NOT EXISTS (
    SELECT 1 FROM public.school_modules sm
    WHERE sm.school_id = p_school_id
    AND sm.module_name = m.name
    AND sm.is_locked = true
  )
  ORDER BY m.sort_order;
END;
$$;

-- ---------------------------------------------------
-- FUNCTION: Get all modules with their lock status for a school
-- Returns all modules with an is_locked flag for the given school.
-- Used by the super admin module management UI.
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_school_module_status(p_school_id UUID)
RETURNS TABLE(module_name TEXT, label TEXT, icon TEXT, is_core BOOLEAN, is_locked BOOLEAN, sort_order INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.name, m.label, m.icon, m.is_core,
    COALESCE((SELECT sm.is_locked FROM public.school_modules sm WHERE sm.school_id = p_school_id AND sm.module_name = m.name), false) AS is_locked,
    m.sort_order
  FROM public.modules m
  ORDER BY m.sort_order;
END;
$$;