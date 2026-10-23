-- ============================================================
--  Staff Payslips
--  Table: staff_payslips (payslip records for teachers & accountants)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_payslips (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  staff_id              UUID NOT NULL,
  staff_type            TEXT NOT NULL CHECK (staff_type IN ('teacher', 'accountant')),
  staff_name            TEXT NOT NULL,
  staff_registration_id TEXT,
  pay_month             INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  pay_year              INTEGER NOT NULL,
  academic_year         TEXT,
  term                  TEXT CHECK (term IN ('First', 'Second', 'Third')),
  basic_salary          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_housing     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_transport   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowance_other       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_tax         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_ssnit       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_loan        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_other       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_pay               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (school_id, staff_id, staff_type, pay_month, pay_year)
);

ALTER TABLE public.staff_payslips ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins manage payslips within their school
CREATE POLICY "Admins manage staff payslips"
  ON public.staff_payslips FOR ALL
  USING (public.can_access_school_data(staff_payslips.school_id))
  WITH CHECK (public.can_access_school_data(staff_payslips.school_id));

-- Super admins manage all payslips
CREATE POLICY "Super admins manage staff payslips"
  ON public.staff_payslips FOR ALL
  USING (public.user_has_role('super_admin'))
  WITH CHECK (public.user_has_role('super_admin'));

-- Staff view their own payslips (resolved via teachers / accountants user_id link)
CREATE POLICY "Staff view own payslips"
  ON public.staff_payslips FOR SELECT
  USING (
    (staff_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = staff_payslips.staff_id AND t.user_id = auth.uid()
    ))
    OR
    (staff_type = 'accountant' AND EXISTS (
      SELECT 1 FROM public.accountants a
      WHERE a.id = staff_payslips.staff_id AND a.user_id = auth.uid()
    ))
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_payslips_school ON public.staff_payslips(school_id);
CREATE INDEX IF NOT EXISTS idx_staff_payslips_staff ON public.staff_payslips(staff_id, staff_type);
CREATE INDEX IF NOT EXISTS idx_staff_payslips_period ON public.staff_payslips(pay_month, pay_year);

-- Updated-at trigger
CREATE TRIGGER set_staff_payslips_updated_at
  BEFORE UPDATE ON public.staff_payslips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
