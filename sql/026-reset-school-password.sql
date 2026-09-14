-- ============================================================
--  Student Admission Portal — Reset School Admin Password
--  Allows the Super Admin to reset a school admin's password
--  to a custom password of their choice.
-- ============================================================
--  What this adds:
--  reset_school_password() function - SECURITY DEFINER RPC
--  Only super_admin can call it
--  Updates the auth.users password for the school's linked user
--  Returns JSON with success status and details
--  Fallback: finds admin user via profiles table if schools.user_id is NULL
--  Uses pgcrypto extension for bcrypt password hashing
-- ============================================================

-- Ensure pgcrypto extension is available (Supabase installs it in extensions schema)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.reset_school_password(p_school_id UUID, p_new_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_school_name TEXT;
  v_registration_id TEXT;
  v_password_updated BOOLEAN := false;
  v_linked BOOLEAN := false;
  v_hashed_password TEXT;
BEGIN
  -- Verify the caller is a super admin
  IF NOT public.user_has_role('super_admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only the Super Admin can reset school passwords.'
    );
  END IF;

  -- Validate password length
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Password must be at least 6 characters long.'
    );
  END IF;

  -- Get the school's linked user_id and info
  SELECT user_id, name, registration_id
  INTO v_user_id, v_school_name, v_registration_id
  FROM public.schools
  WHERE id = p_school_id;

  -- Check if school exists
  IF v_school_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'School not found.'
    );
  END IF;

  -- If no direct user_id link, try fallback lookups:
  -- 1. Look up the admin profile by school_id and role='admin'
  -- 2. Look up the auth user by the school's registration ID email format
  IF v_user_id IS NULL THEN
    -- Fallback 1: Find admin profile linked to this school
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE school_id = p_school_id
      AND role = 'admin'
    LIMIT 1;

    -- Fallback 2: Find auth user by the school's registration ID email format
    IF v_user_id IS NULL AND v_registration_id IS NOT NULL THEN
      SELECT id INTO v_user_id
      FROM auth.users
      WHERE email = lower(v_registration_id) || '@school.local'
      LIMIT 1;
    END IF;

    -- If we found a user via fallback, link them to the school record
    IF v_user_id IS NOT NULL THEN
      UPDATE public.schools
      SET user_id = v_user_id
      WHERE id = p_school_id;
      v_linked := true;
    END IF;
  END IF;

  -- Check if we found an admin user
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No admin account found for this school. The school admin must register first using their Registration ID (' || v_registration_id || ').'
    );
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
                RETURN jsonb_build_object(
                  'success', false,
                  'error', 'pgcrypto extension not found. Please run: CREATE EXTENSION IF NOT EXISTS pgcrypto; in the Supabase SQL Editor.'
                );
            END;
        END;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Password hashing failed: ' || SQLERRM
      );
  END;

  -- Update the auth user's password
  BEGIN
    UPDATE auth.users
    SET encrypted_password = v_hashed_password
    WHERE id = v_user_id;
    v_password_updated := FOUND;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Failed to update password: ' || SQLERRM
      );
  END;

  IF NOT v_password_updated THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Auth user not found for this school.'
    );
  END IF;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'school_id', p_school_id,
    'school_name', v_school_name,
    'registration_id', v_registration_id,
    'user_id', v_user_id,
    'auto_linked', v_linked,
    'message', 'Password reset successfully for ' || v_school_name
  );
END;
$$;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  How to use:
--  SELECT public.reset_school_password(
--    'school-uuid-here',
--    'NewPassword123'
--  );
-- ============================================================