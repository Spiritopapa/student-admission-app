-- ============================================================
--  Student Admission Portal — Transport Payment Delete Restriction
-- ============================================================
--  Purpose:
--    Restrict DELETION of student transport fee payment records to
--    the school Admin (and Sub-Admins / Super Admin) ONLY.
--
--    Transport Fees Collectors (flagged staff) may ADD collections
--    (mark a student PAID) and the Accountant may VIEW, but neither
--    may DELETE / undo a recorded collection. Previously the broad
--    "Admins manage transport fee payments" FOR ALL policy let any
--    school member delete rows through the API.
--
--  What this migration does:
--    - Drops the broad FOR ALL policy on transport_fee_payments.
--    - Keeps SELECT open to everyone in the school (existing policy).
--    - Adds INSERT / UPDATE for school members (so collectors can
--      mark fees collected).
--    - Adds DELETE ONLY for admin / sub_admin / super_admin.
--
--  Apply in Supabase → SQL Editor (idempotent / safe to re-run).
-- ============================================================

-- -----------------------------------------------------------
-- 1. Remove the old "everyone in the school can do anything" policy
-- -----------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage transport fee payments"
  ON public.transport_fee_payments;

-- -----------------------------------------------------------
-- 2. INSERT / UPDATE stay open to school members
--    (Transport Fees Collectors still record collections)
-- -----------------------------------------------------------
CREATE POLICY "School staff insert transport fee payments"
  ON public.transport_fee_payments FOR INSERT
  WITH CHECK (public.can_access_school_data(transport_fee_payments.school_id));

CREATE POLICY "School staff update transport fee payments"
  ON public.transport_fee_payments FOR UPDATE
  USING (public.can_access_school_data(transport_fee_payments.school_id))
  WITH CHECK (public.can_access_school_data(transport_fee_payments.school_id));

-- -----------------------------------------------------------
-- 3. DELETE / Admins & Sub-Admins only (super admin can too)
-- -----------------------------------------------------------
CREATE POLICY "Admins delete transport fee payments"
  ON public.transport_fee_payments FOR DELETE
  USING (
    public.user_has_role('super_admin')
    OR (
      (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
      AND public.user_belongs_to_school(transport_fee_payments.school_id)
    )
  );

-- ============================================================
--  Done
-- ============================================================