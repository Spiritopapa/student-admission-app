-- ============================================================
--  Student Admission Portal — Complete Student Deletion (v2)
--  Migration 075
--
--  Extends delete_student_completely to also remove EVERYTHING tied
--  to a student, including:
--    - sms_logs                 (TEXT student_id, NO FK → orphans remain)
--    - transport_enrollments     (explicit delete, as FK may be missing)
--    - transport_fee_payments    (explicit delete, as FK may be missing)
--  plus the existing cleanup of: parent_links, attendance,
--  exam_student_details, exam_results, payment_transactions, receipts,
--  fees, applications (+ assessment_attempts via FK cascade), profiles
--  and the auth.users portal account.
--
--  Same school-scoped authorization and single-transaction behaviour as
--  the previous version. Safe to re-run (CREATE OR REPLACE).
--  Run this file in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_student_completely(p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_student_name TEXT;
  v_class_name TEXT;
  v_deleted_parent_links INT := 0;
  v_deleted_sms_logs INT := 0;
  v_deleted_attendance INT := 0;
  v_deleted_exam_details INT := 0;
  v_deleted_exam_results INT := 0;
  v_deleted_transactions INT := 0;
  v_deleted_receipts INT := 0;
  v_deleted_fees INT := 0;
  v_deleted_transport_enrollments INT := 0;
  v_deleted_transport_fee_payments INT := 0;
  v_deleted_applications INT := 0;
  v_deleted_profiles INT := 0;
  v_auth_deleted BOOLEAN := false;
  v_school_id UUID;
BEGIN
  -- SECURITY: Get the student's school and verify caller is staff of that school
  SELECT user_id, school_id INTO v_user_id, v_school_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this student');
  END IF;

  -- Build student name for logging
  SELECT CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name),
         class_applying
  INTO v_student_name, v_class_name
  FROM public.applications
  WHERE student_id = p_student_id;

  -- 1. Delete parent_links (no FK cascade to applications.student_id)
  DELETE FROM public.parent_links WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_parent_links = ROW_COUNT;

  -- 2. Delete SMS logs (no FK cascade — orphaned rows would otherwise remain)
  DELETE FROM public.sms_logs WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_sms_logs = ROW_COUNT;

  -- 3. Delete attendance records
  DELETE FROM public.attendance WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_attendance = ROW_COUNT;

  -- 4. Delete exam student details
  DELETE FROM public.exam_student_details WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_details = ROW_COUNT;

  -- 5. Delete exam results
  DELETE FROM public.exam_results WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_results = ROW_COUNT;

  -- 6. Delete payment transactions
  DELETE FROM public.payment_transactions WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_transactions = ROW_COUNT;

  -- 7. Delete receipts
  DELETE FROM public.receipts WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_receipts = ROW_COUNT;

  -- 8. Delete fee records
  DELETE FROM public.fees WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_fees = ROW_COUNT;

  -- 9. Delete transport enrolment + transport fee payments
  DELETE FROM public.transport_enrollments WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_transport_enrollments = ROW_COUNT;

  DELETE FROM public.transport_fee_payments WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_transport_fee_payments = ROW_COUNT;

  -- 10. Delete the application record (main student record; cascades
  --     assessment_attempts and any other FK ON DELETE CASCADE children)
  DELETE FROM public.applications WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_applications = ROW_COUNT;

  -- 11. Delete profile if user_id exists
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_user_id;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;
  END IF;

  -- 12. Delete auth user (portal login) if user_id exists
  IF v_user_id IS NOT NULL THEN
    BEGIN
      DELETE FROM auth.users WHERE id = v_user_id;
      v_auth_deleted := FOUND;
    EXCEPTION
      WHEN OTHERS THEN
        -- Auth deletion may fail if this runs from a non-superuser context
        v_auth_deleted := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'student_name', v_student_name,
    'class', v_class_name,
    'user_id', v_user_id,
    'auth_deleted', v_auth_deleted,
    'deleted_counts', jsonb_build_object(
      'parent_links', v_deleted_parent_links,
      'sms_logs', v_deleted_sms_logs,
      'attendance', v_deleted_attendance,
      'exam_student_details', v_deleted_exam_details,
      'exam_results', v_deleted_exam_results,
      'payment_transactions', v_deleted_transactions,
      'receipts', v_deleted_receipts,
      'fees', v_deleted_fees,
      'transport_enrollments', v_deleted_transport_enrollments,
      'transport_fee_payments', v_deleted_transport_fee_payments,
      'applications', v_deleted_applications,
      'profiles', v_deleted_profiles
    )
  );
END;
$$;

-- ============================================================
--  MIGRATION 075 COMPLETE
-- ============================================================