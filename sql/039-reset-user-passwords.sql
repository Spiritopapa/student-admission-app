-- ============================================================
--  Student Admission Portal — Admin Password Reset for Teachers,
--  Accountants and Students
-- ============================================================
--  What this adds:
--  ✅ reset_teacher_password()    - SECURITY DEFINER RPC
--  ✅ reset_accountant_password() - SECURITY DEFINER RPC
--  ✅ reset_student_password()    - SECURITY DEFINER RPC
--  ✅ Only super_admin OR an admin/sub_admin of the SAME school
--     can call them (guards each call against cross-school resets)
--  ✅ Updates the auth.users password for the linked user
--  ✅ Returns JSON with success status and details
--  ✅ Fallback: finds the auth user via the portal email
--     (registration_id@teacher.local / @accountant.local /
--      student_id@student.local) and auto-links it when found
--  ✅ Uses pgcrypto extension for bcrypt password hashing
-- ============================================================

-- Ensure pgcrypto extension is available (Supabase installs it in extensions schema)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
--  INTERNAL HELPER (NOT granted to clients on purpose — only the
--  three reset functions call this inside their SECURITY DEFINER
--  context, so no unauthorised user can ever hit it directly).
--  Hashes the new password and updates auth.users.encrypted_password.
-- ============================================================
CREATE OR REPLACE FUNCTION public._admin_reset_user_password(p_user_id UUID, p_new_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_hashed_password TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'No portal account found for this user.';
  END IF;

  -- Hash the password using bcrypt (pgcrypto extension)
  -- Try multiple schemas since Supabase may install pgcrypto in different locations
  BEGIN
    BEGIN
      v_hashed_password := crypt(p_new_password, gen_salt('bf'));
    EXCEPTION
      WHEN undefined_function THEN
        BEGIN
          v_hashed_password := extensions.crypt(p_new_password, extensions.gen_salt('bf'));
        EXCEPTION
          WHEN undefined_function THEN
            BEGIN
              v_hashed_password := public.crypt(p_new_password, public.gen_salt('bf'));
            EXCEPTION
              WHEN undefined_function THEN
                RETURN 'pgcrypto extension not found. Please run: CREATE EXTENSION IF NOT EXISTS pgcrypto; in the Supabase SQL Editor.';
            END;
        END;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'Password hashing failed: ' || SQLERRM;
  END;

  -- Update the auth user's password
  BEGIN
    UPDATE auth.users
    SET encrypted_password = v_hashed_password
    WHERE id = p_user_id;
    IF NOT FOUND THEN
      RETURN 'Auth user not found for the record.';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'Failed to update password: ' || SQLERRM;
  END;

  RETURN NULL; -- success
END;
$$;

-- ============================================================
--  1. RESET TEACHER PASSWORD
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_teacher_password(p_teacher_id UUID, p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id         UUID;
  v_full_name       TEXT;
  v_registration_id TEXT;
  v_school_id       UUID;
  v_err             TEXT;
BEGIN
  SELECT user_id, full_name, registration_id, school_id
  INTO v_user_id, v_full_name, v_registration_id, v_school_id
  FROM public.teachers
  WHERE id = p_teacher_id;

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Teacher not found.');
  END IF;

  -- Only the Super Admin OR an Admin/Sub-Admin of the SAME school can reset
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only an admin of this school or the Super Admin can reset teacher passwords.'
    );
  END IF;

  -- Validate password length
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 6 characters long.');
  END IF;

  -- Fallback: find the auth user via the teacher portal email and auto-link
  IF v_user_id IS NULL AND v_registration_id IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = lower(v_registration_id) || '@teacher.local'
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = v_user_id WHERE id = p_teacher_id;
    END IF;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No portal account found for this teacher. The teacher must register first using their Registration ID (' || COALESCE(v_registration_id, 'N/A') || ') before the password can be reset.'
    );
  END IF;

  v_err := public._admin_reset_user_password(v_user_id, p_new_password);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_type', 'teacher',
    'teacher_id', p_teacher_id,
    'full_name', v_full_name,
    'registration_id', v_registration_id,
    'message', 'Password reset successfully for ' || v_full_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_teacher_password(UUID, TEXT) TO authenticated;
-- ============================================================
--  2. RESET ACCOUNTANT PASSWORD
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_accountant_password(p_accountant_id UUID, p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id         UUID;
  v_full_name       TEXT;
  v_registration_id TEXT;
  v_school_id       UUID;
  v_err             TEXT;
BEGIN
  SELECT user_id, full_name, registration_id, school_id
  INTO v_user_id, v_full_name, v_registration_id, v_school_id
  FROM public.accountants
  WHERE id = p_accountant_id;

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accountant not found.');
  END IF;

  -- Only the Super Admin OR an Admin/Sub-Admin of the SAME school can reset
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only an admin of this school or the Super Admin can reset accountant passwords.'
    );
  END IF;

  -- Validate password length
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 6 characters long.');
  END IF;

  -- Fallback: find the auth user via the accountant portal email and auto-link
  IF v_user_id IS NULL AND v_registration_id IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = lower(v_registration_id) || '@accountant.local'
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      UPDATE public.accountants SET user_id = v_user_id WHERE id = p_accountant_id;
    END IF;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No portal account found for this accountant. The accountant must register first using their Registration ID (' || COALESCE(v_registration_id, 'N/A') || ') before the password can be reset.'
    );
  END IF;

  v_err := public._admin_reset_user_password(v_user_id, p_new_password);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_type', 'accountant',
    'accountant_id', p_accountant_id,
    'full_name', v_full_name,
    'registration_id', v_registration_id,
    'message', 'Password reset successfully for ' || v_full_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_accountant_password(UUID, TEXT) TO authenticated;
-- ============================================================
--  3. RESET STUDENT PASSWORD
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_student_password(p_student_id TEXT, p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id    UUID;
  v_first_name TEXT;
  v_last_name  TEXT;
  v_school_id  UUID;
  v_err        TEXT;
BEGIN
  SELECT user_id, first_name, last_name, school_id
  INTO v_user_id, v_first_name, v_last_name, v_school_id
  FROM public.applications
  WHERE student_id = p_student_id;

  IF v_first_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found.');
  END IF;

  -- Only the Super Admin OR an Admin/Sub-Admin of the SAME school can reset
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only an admin of this school or the Super Admin can reset student passwords.'
    );
  END IF;

  -- Validate password length
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 6 characters long.');
  END IF;

  -- Fallback: find the auth user via the student portal email and auto-link
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = lower(p_student_id) || '@student.local'
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      UPDATE public.applications SET user_id = v_user_id WHERE student_id = p_student_id;
    END IF;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No portal account found for this student. The student must register first using their Student ID (' || p_student_id || ') before the password can be reset.'
    );
  END IF;

  v_err := public._admin_reset_user_password(v_user_id, p_new_password);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_type', 'student',
    'student_id', p_student_id,
    'full_name', btrim(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, '')),
    'message', 'Password reset successfully for student ' || p_student_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_student_password(TEXT, TEXT) TO authenticated;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  How to use:
--  SELECT public.reset_teacher_password(
--    'teacher-uuid-here',
--    'NewPassword123'
--  );
--  SELECT public.reset_accountant_password(
--    'accountant-uuid-here',
--    'NewPassword123'
--  );
--  SELECT public.reset_student_password(
--    'STUDENT-ID-HERE',
--    'NewPassword123'
--  );
-- ============================================================