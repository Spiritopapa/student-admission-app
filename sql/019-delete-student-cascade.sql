-- ============================================================
--  Student Admission Portal — Complete Student Deletion
--  Ensures ALL related data is deleted when a student is removed
--  Run this file in Supabase SQL Editor
-- ============================================================
--  Tables cleaned up (in order):
--  1. parent_links        - No FK cascade to applications(student_id)
--  2. attendance          - Has FK CASCADE but explicit for safety
--  3. exam_student_details - Has FK CASCADE but explicit for safety
--  4. exam_results        - Has FK CASCADE but explicit for safety
--  5. payment_transactions - Has FK CASCADE but explicit for safety
--  6. receipts            - Has FK CASCADE but explicit for safety
--  7. fees                - Has FK CASCADE but explicit for safety
--  8. applications        - Main student record (cascades to above)
--  9. profiles            - User profile (by user_id UUID)
--  10. auth.users         - Auth account (via delete_auth_user RPC)
-- ============================================================

-- ---------------------------------------------------
--  FUNCTION: delete_student_completely
--  Deletes a student and ALL associated records atomically
--  Returns JSON with success status and details
-- ---------------------------------------------------
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
  v_deleted_attendance INT := 0;
  v_deleted_exam_details INT := 0;
  v_deleted_exam_results INT := 0;
  v_deleted_transactions INT := 0;
  v_deleted_receipts INT := 0;
  v_deleted_fees INT := 0;
  v_deleted_applications INT := 0;
  v_deleted_profiles INT := 0;
  v_auth_deleted BOOLEAN := false;
BEGIN
  -- Get the user_id and student info before deletion
  SELECT user_id INTO v_user_id
  FROM public.applications
  WHERE student_id = p_student_id;

  -- Build student name for logging
  SELECT CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name),
         class_applying
  INTO v_student_name, v_class_name
  FROM public.applications
  WHERE student_id = p_student_id;

  -- 1. Delete parent_links (no FK cascade to applications.student_id)
  DELETE FROM public.parent_links WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_parent_links = ROW_COUNT;

  -- 2. Delete attendance records
  DELETE FROM public.attendance WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_attendance = ROW_COUNT;

  -- 3. Delete exam student details
  DELETE FROM public.exam_student_details WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_details = ROW_COUNT;

  -- 4. Delete exam results
  DELETE FROM public.exam_results WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_exam_results = ROW_COUNT;

  -- 5. Delete payment transactions
  DELETE FROM public.payment_transactions WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_transactions = ROW_COUNT;

  -- 6. Delete receipts
  DELETE FROM public.receipts WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_receipts = ROW_COUNT;

  -- 7. Delete fee records
  DELETE FROM public.fees WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_fees = ROW_COUNT;

  -- 8. Delete the application record (main student record)
  DELETE FROM public.applications WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_deleted_applications = ROW_COUNT;

  -- 9. Delete profile if user_id exists
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_user_id;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;
  END IF;

  -- 10. Delete auth user if user_id exists
  IF v_user_id IS NOT NULL THEN
    BEGIN
      DELETE FROM auth.users WHERE id = v_user_id;
      v_auth_deleted := FOUND;
    EXCEPTION
      WHEN OTHERS THEN
        -- Auth deletion may fail if running as non-superuser
        v_auth_deleted := false;
    END;
  END IF;

  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'student_name', v_student_name,
    'class', v_class_name,
    'user_id', v_user_id,
    'auth_deleted', v_auth_deleted,
    'deleted_counts', jsonb_build_object(
      'parent_links', v_deleted_parent_links,
      'attendance', v_deleted_attendance,
      'exam_student_details', v_deleted_exam_details,
      'exam_results', v_deleted_exam_results,
      'payment_transactions', v_deleted_transactions,
      'receipts', v_deleted_receipts,
      'fees', v_deleted_fees,
      'applications', v_deleted_applications,
      'profiles', v_deleted_profiles
    )
  );
END;
$$;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  What this adds:
--  delete_student_completely() function - atomic deletion
--  Handles ALL 10 related tables
--  Returns detailed deletion counts
--  Runs in a single transaction (all or nothing)
--  SECURITY DEFINER so it bypasses RLS
-- ============================================================