-- ============================================================
--  Student Admission Portal — Transport Collector Route Assignments
-- ============================================================
--  Purpose:
--    Lets the Admin assign SPECIFIC bus destinations (routes) to
--    SPECIFIC Transport Fees Collection staff. A collector then
--    only sees / handles the destination(s) they have been
--    assigned to — both in the UI (js/modules/transport-shared.js
--    manage mode) and in the data they can reach for management.
--
--  Admin UI: Transport → Collector Destinations tab
--            (js/modules/admin-transport.js).
--
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transport_collector_routes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (teacher_id, route_id)
);

ALTER TABLE public.transport_collector_routes ENABLE ROW LEVEL SECURITY;

-- Admins / sub-admins manage who collects on which destination
CREATE POLICY "Admins manage collector route assignments"
  ON public.transport_collector_routes FOR ALL
  USING (public.can_access_school_data(transport_collector_routes.school_id))
  WITH CHECK (public.can_access_school_data(transport_collector_routes.school_id));

-- School staff view assignments (a collector must see their own routes)
CREATE POLICY "Users view collector route assignments"
  ON public.transport_collector_routes FOR SELECT
  USING (public.can_access_school_data(transport_collector_routes.school_id));

CREATE INDEX IF NOT EXISTS idx_transport_collector_routes_school
  ON public.transport_collector_routes (school_id);

CREATE INDEX IF NOT EXISTS idx_transport_collector_routes_teacher
  ON public.transport_collector_routes (teacher_id);

CREATE INDEX IF NOT EXISTS idx_transport_collector_routes_route
  ON public.transport_collector_routes (route_id);

-- ============================================================
--  Done
-- ============================================================