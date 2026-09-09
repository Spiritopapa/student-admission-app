-- ============================================================
--  Student Admission Portal — Transport Fees Collector Staff Flag
-- ============================================================
--  Purpose:
--    Lets the admin flag SELECTED staff members as responsible for
--    the management of transport fee collection. When a staff ID
--    is generated (Staff → Create Staff with Registration ID) the
--    admin can tick "Transport Fees Collector".
--
--  What this enables:
--    - The flagged teacher/staff sees the "Transport" tab on their
--      own dashboard and can mark students' daily bus fees as
--      PAID / UNPAID (manage mode).
--    - The Accountant always sees the Transport module in
--      VIEW-ONLY mode (read the daily sheet + payments history,
--      print reports).
--    - The Admin keeps full access (routes & fees, enrollment,
--      daily collection, history).
--
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS is_transport_collector BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_teachers_transport_collector
  ON public.teachers (is_transport_collector)
  WHERE is_transport_collector = true;

-- ============================================================
--  Done
-- ============================================================