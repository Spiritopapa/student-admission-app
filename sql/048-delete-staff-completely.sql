-- ============================================================
--  Student Admission Portal — Complete Teacher & Accountant Deletion
--  Ensures ALL related data (including the profile and the auth
--  account) is permanently deleted when an admin removes a
--  teacher or an accountant.
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql)
-- ============================================================
--  What this adds:
--  ✅ delete_teacher_completely(UUID)    — atomic teacher deletion
--  ✅ delete_accountant_completely(UUID) — atomic accountant deletion
--
--  Each SECURITY DEFINER function:
--   * Is scoped to the caller's own school (super_admin bypasses).
--   * Deletes child records (teacher documents, class-subject
--     assignments) alongside the main record.
--   * Deletes the linked profiles row (the auth→profile FK also
--     cascades on auth deletion; explicit delete is extra safety).
--   * Deletes the auth.users row → the person can no longer sign in.
--     (The created_by / recorded_by references in school data such
--     as announcements, fee transactions and income/expenses are
--     nulled automatically by their ON DELETE SET NULL FKs — school
--     records themselves are preserved.)
--   * Falls back to the synthetic portal email
--     (<registration_id>@teacher.local / @accountant.local) when a
--     record was never linked to its auth user.
-- ============================================================

-- ---------------------------------------------------
-- 1. DELETE TEACHER COMPLETELY
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_teacher_completely(p_teacher_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_full_name        TEXT;
  v_registration_id  TEXT;
  v_school_id        UUID;
  v_deleted_docs     INT := 0;
  v_deleted_assign   INT := 0;
  v_deleted_teacher  INT := 0;
  v_deleted_profiles INT := 0;
  v_auth_deleted     BOOLEAN := false;
BEGIN
  -- Locate the teacher before deletion.
  SELECT user_id, full_name, registration_id, school_id
    INTO v_user_id, v_full_name, v_registration_id, v_school_id
    FROM public.teachers
   WHERE id = p_teacher_id;

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Teacher not found');
  END IF;

  -- SECURITY: Only the Super Admin OR an Admin/Sub-Admin of the SAME
  -- school may delete this teacher.
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this teacher');
  END IF;

  -- Resolve the auth user: prefer the linked user_id, else look up the
  -- teacher portal synthetic email (<registration_id>@teacher.local).
  IF v_user_id IS NULL AND v_registration_id IS NOT NULL THEN
    SELECT id INTO v_user_id
      FROM auth.users
     WHERE email = lower(v_registration_id) || '@teacher.local'
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = v_user_id WHERE id = p_teacher_id;
    END IF;
  END IF;

  -- 1. Teacher documents (explicit delete for safety; FK cascades too).
  DELETE FROM public.teacher_documents WHERE teacher_id = p_teacher_id;
  GET DIAGNOSTICS v_deleted_docs = ROW_COUNT;

  -- 2. Class-subject assignments (explicit delete for safety).
  DELETE FROM public.teacher_classes_subjects WHERE teacher_id = p_teacher_id;
  GET DIAGNOSTICS v_deleted_assign = ROW_COUNT;

  -- 3. Teacher record (cascades to any remaining child rows).
  DELETE FROM public.teachers WHERE id = p_teacher_id;
  GET DIAGNOSTICS v_deleted_teacher = ROW_COUNT;

  -- 4. User profile (the auth→profile FK cascades too; explicit for safety).
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_user_id;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;
  END IF;

  -- 5. Auth account. Deleting auth.users cascades to profiles and nulls
  --    out created_by / recorded_by references in school data.
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

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', p_teacher_id,
    'teacher_name', v_full_name,
    'user_id', v_user_id,
    'auth_deleted', v_auth_deleted,
    'deleted_counts', jsonb_build_object(
      'teacher_documents', v_deleted_docs,
      'teacher_classes_subjects', v_deleted_assign,
      'teachers', v_deleted_teacher,
      'profiles', v_deleted_profiles
    )
  );
END;
$$;

-- Restrict execution to authenticated users only (blocks anon / PUBLIC).
REVOKE EXECUTE ON FUNCTION public.delete_teacher_completely(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_teacher_completely(UUID) TO authenticated;
-- ---------------------------------------------------
-- 2. DELETE ACCOUNTANT COMPLETELY
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_accountant_completely(p_accountant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_full_name         TEXT;
  v_registration_id   TEXT;
  v_school_id         UUID;
  v_deleted_accountant INT := 0;
  v_deleted_profiles  INT := 0;
  v_auth_deleted      BOOLEAN := false;
BEGIN
  -- Locate the accountant before deletion.
  SELECT user_id, full_name, registration_id, school_id
    INTO v_user_id, v_full_name, v_registration_id, v_school_id
    FROM public.accountants
   WHERE id = p_accountant_id;

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accountant not found');
  END IF;

  -- SECURITY: Only the Super Admin OR an Admin/Sub-Admin of the SAME
  -- school may delete this accountant.
  IF NOT public.user_has_role('super_admin')
     AND NOT (
       (public.user_has_role('admin') OR public.user_has_role('sub_admin'))
       AND public.user_belongs_to_school(v_school_id)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this accountant');
  END IF;

  -- Resolve the auth user: prefer the linked user_id, else look up the
  -- accountant portal synthetic email (<registration_id>@accountant.local).
  IF v_user_id IS NULL AND v_registration_id IS NOT NULL THEN
    SELECT id INTO v_user_id
      FROM auth.users
     WHERE email = lower(v_registration_id) || '@accountant.local'
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      UPDATE public.accountants SET user_id = v_user_id WHERE id = p_accountant_id;
    END IF;
  END IF;

  -- 1. Accountant record.
  DELETE FROM public.accountants WHERE id = p_accountant_id;
  GET DIAGNOSTICS v_deleted_accountant = ROW_COUNT;

  -- 2. User profile (the auth→profile FK cascades too; explicit for safety).
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_user_id;
    GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;
  END IF;

  -- 3. Auth account. Deleting auth.users cascades to profiles and nulls
  --    out created_by / recorded_by references in school data.
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

  RETURN jsonb_build_object(
    'success', true,
    'accountant_id', p_accountant_id,
    'accountant_name', v_full_name,
    'user_id', v_user_id,
    'auth_deleted', v_auth_deleted,
    'deleted_counts', jsonb_build_object(
      'accountants', v_deleted_accountant,
      'profiles', v_deleted_profiles
    )
  );
END;
$$;

-- Restrict execution to authenticated users only (blocks anon / PUBLIC).
REVOKE EXECUTE ON FUNCTION public.delete_accountant_completely(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_accountant_completely(UUID) TO authenticated;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  What this adds:
--  ✅ delete_teacher_completely()    — atomic teacher deletion
--  ✅ delete_accountant_completely() — atomic accountant deletion
--  ✅ Handles child rows + profile + auth.users in ONE transaction
--  ✅ SECURITY DEFINER so it bypasses RLS (with an internal
--     school-scope check on every call)
--  ✅ Returns detailed deletion counts for the admin summary
-- ============================================================