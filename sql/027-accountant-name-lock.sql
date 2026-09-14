-- ============================================================
--  Student Admission Portal — Accountant Name Lock
--  ============================================================
--  PURPOSE: After the admin has generated an ID (registration_id)
--  for an accountant, the accountant must NOT be able to update
--  or change their name on their dashboard profile.
--
--  This is enforced at the DATABASE level (triggers) so it cannot
--  be bypassed by direct API calls or client-side manipulation.
--
--  HOW IT WORKS:
--  01. `prevent_accountant_name_change` trigger on `accountants`
--      table: Blocks an accountant (user_id = auth.uid()) from
--      updating their own `full_name` when they have a
--      `registration_id` (i.e., the admin generated an ID for them).
--      Admins/sub_admins/super_admins can still update the name.
--
--  02. `prevent_accountant_profile_name_change` trigger on
--      `profiles` table: Blocks an accountant-role user from
--      updating their own `full_name` in the profiles table.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================

-- ************************************************************
-- SECTION 1: TRIGGER on `accountants` table
-- ************************************************************

CREATE OR REPLACE FUNCTION public.prevent_accountant_name_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only block when the accountant is updating their OWN record
  -- (user_id matches the authenticated user) AND they have a
  -- registration_id (admin generated an ID for them).
  IF NEW.user_id = auth.uid()
     AND OLD.registration_id IS NOT NULL
     AND NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'Accountant name is locked. Please contact the school admin to change your name.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_accountant_name_change ON public.accountants;

CREATE TRIGGER trg_prevent_accountant_name_change
  BEFORE UPDATE OF full_name ON public.accountants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_accountant_name_change();

-- ************************************************************
-- SECTION 2: TRIGGER on `profiles` table
-- ************************************************************

CREATE OR REPLACE FUNCTION public.prevent_accountant_profile_name_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block an accountant-role user from changing their own full_name
  -- in the profiles table. Admins can still change it.
  IF NEW.id = auth.uid()
     AND OLD.role = 'accountant'
     AND NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'Accountant name is locked. Please contact the school admin to change your name.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_accountant_profile_name_change ON public.profiles;

CREATE TRIGGER trg_prevent_accountant_profile_name_change
  BEFORE UPDATE OF full_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_accountant_profile_name_change();

-- ============================================================
--  DEPLOYMENT COMPLETE
--  ============================================================
--  After running:
--   1. Accountants with a registration_id (admin-generated ID)
--      cannot change their own name in the `accountants` table.
--   2. Accountant-role users cannot change their own name in the
--      `profiles` table.
--   3. Admins/sub_admins/super_admins can still update accountant
--      names as before.
-- ============================================================