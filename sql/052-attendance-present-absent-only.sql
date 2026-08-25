-- ============================================================
--  Student Admission Portal — Attendance: Present/Absent only
--  Migration for sql/006-communication-attendance.sql
--
--  Fixes the public.attendance.status column so only these two
--  values are allowed:
--      'present'  (student was in school)
--      'absent'   (student was not in school)
--
--  It is SAFE TO RE-RUN (idempotent). Existing data is mapped:
--      'late'    -> 'present'  (late students were in school)
--      'excused' -> 'absent'   (excused = granted permission away)
-- ============================================================

-- ------------------------------------------------------------
-- 1. DATA MIGRATION — normalize old status values first so the
--    new CHECK constraint can be validated against clean data.
-- ------------------------------------------------------------

-- Late students were still present in school -> present.
UPDATE public.attendance
SET status    = 'present',
    updated_at = now()
WHERE status = 'late';

-- Excused means granted permission to be away -> absent.
UPDATE public.attendance
SET status    = 'absent',
    updated_at = now()
WHERE status = 'excused';

-- ------------------------------------------------------------
-- 2. DROP the old CHECK constraint(s) on the status column.
--
--    The original inline constraint may be named anything
--    (e.g. "attendance_status_check" or an auto-generated name).
--    We target ONLY constraints attached to the `status`
--    column via pg_constraint.conkey, so the `term` CHECK
--    constraint is never touched.
-- ------------------------------------------------------------
DO $$
DECLARE
  con_row RECORD;
BEGIN
  FOR con_row IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum   = ANY (con.conkey)
    WHERE con.conrelid   = 'public.attendance'::regclass
      AND con.contype    = 'c'             -- check constraints only
      AND att.attname    = 'status'        -- column checks only
  LOOP
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT %I', con_row.conname);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. ADD the new CHECK constraint (only if absent — idempotent).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'attendance_status_check'
      AND conrelid = 'public.attendance'::regclass
  ) THEN
    ALTER TABLE public.attendance
      ADD CONSTRAINT attendance_status_check
      CHECK (status IN ('present','absent'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. VERIFICATION — should return 0 rows after a clean run.
-- ------------------------------------------------------------
SELECT 'remaining_invalid_status_rows' AS check_item,
       count(*)                        AS row_count
FROM public.attendance
WHERE status NOT IN ('present','absent');