-- ============================================================
--  Staff Salary Setup
--  Table: staff_salary_setup (default earnings & deductions per staff)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_salary_setup (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  staff_id              UUID NOT NULL,
  staff_type            TEXT NOT NULL CHECK (staff_type IN ('teacher', 'accountant')),
  basic_salary          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_housing     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_transport   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_other       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_tax         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_ssnit       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_loan        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_other       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (school_id, staff_id, staff_type)
);

ALTER TABLE public.staff_salary_setup ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins manage salary setup within their school
CREATE POLICY "Admins manage staff salary setup"
  ON public.staff_salary_setup FOR ALL
  USING (public.can_access_school_data(staff_salary_setup.school_id))
  WITH CHECK (public.can_access_school_data(staff_salary_setup.school_id));

-- Super admins manage all salary setup
CREATE POLICY "Super admins manage staff salary setup"
  ON public.staff_salary_setup FOR ALL
  USING (public.user_has_role('super_admin'))
  WITH CHECK (public.user_has_role('super_admin'));

-- Staff view their own salary setup
CREATE POLICY "Staff view own salary setup"
  ON public.staff_salary_setup FOR SELECT
  USING (
    (staff_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = staff_salary_setup.staff_id AND t.user_id = auth.uid()
    ))
    OR
    (staff_type = 'accountant' AND EXISTS (
      SELECT 1 FROM public.accountants a
      WHERE a.id = staff_salary_setup.staff_id AND a.user_id = auth.uid()
    ))
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_salary_setup_school ON public.staff_salary_setup(school_id);
CREATE INDEX IF NOT EXISTS idx_staff_salary_setup_staff ON public.staff_salary_setup(staff_id, staff_type);

-- Updated-at trigger
CREATE TRIGGER set_staff_salary_setup_updated_at
  BEFORE UPDATE ON public.staff_salary_setup
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Data API Grants (Supabase PostgREST / supabase-js access)
-- Added per Supabase change effective 30 Oct 2026.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_salary_setup TO authenticated;
GRANT ALL ON public.staff_salary_setup TO service_role;
