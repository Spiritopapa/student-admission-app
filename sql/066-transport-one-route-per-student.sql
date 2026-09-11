-- ============================================================
--  Student Admission Portal — One Student = One Bus Destination
-- ============================================================
--  Purpose:
--    A student may ride only ONE bus destination at a time.
--    Once a student is added to a destination they cannot be added
--    to ANOTHER destination unless they are first removed (deleted)
--    from their current destination.
--
--  What this migration does:
--    1. De-duplicates legacy data: if a student somehow ended up with
--       more than one ACTIVE enrollment, the OLDEST one is kept and
--       the newer ones are deactivated (history rows stay intact).
--    2. Creates a partial UNIQUE index so the database itself
--       rejects a student being ACTIVE on more than one destination.
--
--  The admin UI (js/modules/admin-transport.js — Enroll Students tab)
--  also disables students already assigned elsewhere; this index is the
--  server-side guarantee behind that rule.
--
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

-- ------------------------------------------------------------
-- 1. De-duplicate legacy duplicate ACTIVE enrollments
--    Keep the OLDEST active enrollment per student and deactivate
--    the rest so the unique index below can be created safely.
-- ------------------------------------------------------------
UPDATE public.transport_enrollments e
SET is_active = false
WHERE e.is_active
  AND EXISTS (
    SELECT 1
    FROM public.transport_enrollments e2
    WHERE e2.student_id = e.student_id
      AND e2.is_active
      AND (
        e2.created_at < e.created_at
        OR (e2.created_at = e.created_at AND e2.id < e.id)
        OR (e2.created_at IS NULL AND e.created_at IS NULL AND e2.id < e.id)
      )
  );

-- ------------------------------------------------------------
-- 2. Database-level rule: at most one ACTIVE enrollment per student
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_transport_enrollments_one_active_per_student;
CREATE UNIQUE INDEX idx_transport_enrollments_one_active_per_student
  ON public.transport_enrollments (student_id)
  WHERE is_active;

-- ============================================================
--  Done
-- ============================================================