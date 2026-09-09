-- ============================================================
--  Student Admission Portal — Student Transport System Module
--  Tables: transport_routes, transport_enrollments, transport_fee_payments
--  Features: daily transport fee collection for students who come
--            to school with the school bus, grouped by bus
--            destination (route). Every route carries its own fee.
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

-- ------------------------------------------------------------
-- 1. TRANSPORT ROUTES (bus destinations)
--    Each destination (e.g. "Madina", "East Legon") has its own
--    daily fee that students on that route must pay.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_routes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  fee         NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transport_routes ENABLE ROW LEVEL SECURITY;

-- Admins / sub-admins / accountants manage transport routes
CREATE POLICY "Admins manage transport routes"
  ON public.transport_routes FOR ALL
  USING (public.can_access_school_data(transport_routes.school_id))
  WITH CHECK (public.can_access_school_data(transport_routes.school_id));

-- Users view transport routes for their own school
CREATE POLICY "Users view transport routes"
  ON public.transport_routes FOR SELECT
  USING (public.can_access_school_data(transport_routes.school_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_routes_school_name
  ON public.transport_routes (school_id, name);

CREATE INDEX IF NOT EXISTS idx_transport_routes_school
  ON public.transport_routes (school_id);

DROP TRIGGER IF EXISTS set_transport_routes_updated_at ON public.transport_routes;
CREATE TRIGGER set_transport_routes_updated_at
  BEFORE UPDATE ON public.transport_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 2. TRANSPORT ENROLLMENTS (selected students on the bus)
--    Maps a student to the route/destination they ride on.
--    Only enrolled (active) students appear on the daily
--    collection sheet.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, route_id)
);

ALTER TABLE public.transport_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage transport enrollments"
  ON public.transport_enrollments FOR ALL
  USING (public.can_access_school_data(transport_enrollments.school_id))
  WITH CHECK (public.can_access_school_data(transport_enrollments.school_id));

CREATE POLICY "Users view transport enrollments"
  ON public.transport_enrollments FOR SELECT
  USING (public.can_access_school_data(transport_enrollments.school_id));

CREATE INDEX IF NOT EXISTS idx_transport_enrollments_school
  ON public.transport_enrollments (school_id);

CREATE INDEX IF NOT EXISTS idx_transport_enrollments_route
  ON public.transport_enrollments (route_id);

CREATE INDEX IF NOT EXISTS idx_transport_enrollments_student
  ON public.transport_enrollments (student_id);
DROP TRIGGER IF EXISTS set_transport_enrollments_updated_at ON public.transport_enrollments;
CREATE TRIGGER set_transport_enrollments_updated_at
  BEFORE UPDATE ON public.transport_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 3. TRANSPORT FEE PAYMENTS (daily collection records)
--    One row per student per route per day. The fee amount is
--    snapshotted from the route at collection time so history
--    stays accurate even if the route fee changes later.
--    UNIQUE(student_id, collection_date, route_id) prevents
--    double-marking the same student twice on one day.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_fee_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  route_id        UUID REFERENCES public.transport_routes(id) ON DELETE SET NULL,
  fee_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  collection_date DATE NOT NULL,
  payment_method  TEXT NOT NULL DEFAULT 'Cash',
  reference       TEXT,
  notes           TEXT,
  collected_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, collection_date, route_id)
);

ALTER TABLE public.transport_fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage transport fee payments"
  ON public.transport_fee_payments FOR ALL
  USING (public.can_access_school_data(transport_fee_payments.school_id))
  WITH CHECK (public.can_access_school_data(transport_fee_payments.school_id));

CREATE POLICY "Users view transport fee payments"
  ON public.transport_fee_payments FOR SELECT
  USING (public.can_access_school_data(transport_fee_payments.school_id));

CREATE INDEX IF NOT EXISTS idx_transport_payments_school_date
  ON public.transport_fee_payments (school_id, collection_date);

CREATE INDEX IF NOT EXISTS idx_transport_payments_route
  ON public.transport_fee_payments (route_id);

CREATE INDEX IF NOT EXISTS idx_transport_payments_student
  ON public.transport_fee_payments (student_id);

-- ------------------------------------------------------------
-- 4. MODULES: register the Transport module so the Super Admin
--    can lock/unlock it per school like every other module.
-- ------------------------------------------------------------
INSERT INTO public.modules (name, label, icon, is_core, sort_order)
VALUES ('transport', 'Transport', '', false, 13)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
--  Done
-- ============================================================