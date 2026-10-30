-- ============================================================
-- 093 - School account activation
-- A suspended school blocks its administrator and every linked user at login.
-- Existing approval flags are preserved so reactivation restores access
-- without requiring the school to re-approve all staff and students.
-- ============================================================
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_schools_active ON public.schools(is_active);

CREATE OR REPLACE FUNCTION public.set_school_account_active(p_school_id UUID, p_is_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_role('super_admin') THEN
    RAISE EXCEPTION 'Only Super Administrators can change school account access.';
  END IF;

  UPDATE public.schools
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'School not found.';
  END IF;

  RETURN jsonb_build_object('success', true, 'is_active', p_is_active);
END;
$$;

REVOKE ALL ON FUNCTION public.set_school_account_active(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_school_account_active(UUID, BOOLEAN) TO authenticated;
