-- ============================================================
--  Student Admission Portal — Staff Activity Log
--  Table: staff_activities
--  Tracks login/logout and key operations performed by
--  teachers & accountants so school admins can audit them.
-- ============================================================
--  Used by: js/modules/utils.js (logStaffActivity) which resolves
--           the current logged-in teacher/accountant record and
--           writes one row per significant action:
--             * login / logout (teacher + accountant)
--             * fee payments (accountant)
--             * income & expenditure records (accountant)
--             * debtors list generation (accountant)
--             * password change attempts (accountant)
--             * reprint of receipts (accountant)
--             * profile updates (teacher)
--             * examination marks entry (teacher)
--             * marking of attendance (teacher)
--             * conducting assessment (teacher)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_activities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID,
  staff_id              UUID,
  staff_type            TEXT NOT NULL,            -- 'teacher' | 'accountant'
  staff_name            TEXT,
  staff_registration_id TEXT,
  action                TEXT NOT NULL,            -- e.g. 'Logged in', 'Recorded fee payment'
  entity_type           TEXT DEFAULT 'general',
  entity_details        TEXT,
  performed_by_user_id  UUID,
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.staff_activities ENABLE ROW LEVEL SECURITY;

-- Super admins can view all staff activities
CREATE POLICY "Super admins view all staff activities"
  ON public.staff_activities FOR SELECT
  USING (
    public.user_has_role('super_admin')
  );

-- School admins can view activities within their own school
CREATE POLICY "School admins view own school staff activities"
  ON public.staff_activities FOR SELECT
  USING (
    public.can_access_school_data(staff_activities.school_id)
  );

-- Each teacher/accountant can view their own activity log
CREATE POLICY "Staff view own activities"
  ON public.staff_activities FOR SELECT
  USING (
    staff_activities.performed_by_user_id = auth.uid()
  );

-- Allow insert from the activity logger (role checks happen in JS)
CREATE POLICY "Insert staff activities"
  ON public.staff_activities FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_staff_activities_staff  ON public.staff_activities(staff_type, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_activities_school ON public.staff_activities(school_id);
CREATE INDEX IF NOT EXISTS idx_staff_activities_created ON public.staff_activities(created_at);