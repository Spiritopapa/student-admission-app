-- ============================================================
--  Student Admission Portal — Staff Type (Teaching / Non-Teaching)
--  Adds a `staff_type` column to the teachers table so admins can
--  classify each staff member as 'teaching' or 'non_teaching'.
--  The admin Staff module uses this to decide whether class and
--  subject assignment fields are relevant:
--    - Teaching Staff    -> class + subject assignment shown/saved
--    - Non-Teaching Staff-> class + subject assignment hidden/null
--  Existing rows default to 'teaching' so current data is preserved.
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================

-- 1. Add the staff_type column (idempotent) + an index for filtering.
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS staff_type TEXT;

CREATE INDEX IF NOT EXISTS idx_teachers_staff_type
  ON public.teachers(staff_type);

-- 2. Backfill existing rows as 'teaching' if the value is still empty/null,
--    and normalize any non-standard values to the two supported strings.
UPDATE public.teachers
   SET staff_type = CASE
     WHEN staff_type = 'non_teaching' THEN 'non_teaching'
     ELSE 'teaching'
   END
 WHERE staff_type IS NULL
    OR staff_type NOT IN ('teaching', 'non_teaching');

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================