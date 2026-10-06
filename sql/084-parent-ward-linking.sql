-- ============================================================
--  MIGRATION: Parent ⇄ Ward connectivity (proper linking)
--  Fixes the broken parent -> ward linkage and gives parents a
--  self-service way to connect their child's Student ID.
--
--  WHY: parent_links RLS only allowed parents to SELECT their own
--  links (and staff to manage them), so the registerParent() insert
--  after sign-up was silently rejected. Parents then logged in to an
--  empty "My Wards" dashboard with no way to connect a ward.
--
--  Adds:
--    1. RLS INSERT/DELETE policies so a parent can link/unlink wards
--       whose recorded parent contact matches their phone/email (or a
--       ward with no guardian contact yet).
--    2. link_ward_to_parent() / unlink_ward()  — app-facing RPCs
--       (SECURITY DEFINER) used by registration, login self-healing
--       and the Connect-a-Ward dashboard flow.
--    3. admin_link_parent_ward() / admin_unlink_parent_ward() —
--       school-staff RPCs used by the Parents management screen.
-- ============================================================

-- ============================================================
--  1. RLS: parents may link/unlink their OWN wards
--     Guard: the ward must exist AND (no guardian contact on file
--     OR the parent's phone/email matches the recorded contact).
-- ============================================================
DROP POLICY IF EXISTS "Parents link own wards" ON public.parent_links;
DROP POLICY IF EXISTS "Parents unlink own wards" ON public.parent_links;

CREATE POLICY "Parents link own wards"
  ON public.parent_links FOR INSERT
  WITH CHECK (
    parent_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.student_id = parent_links.student_id
        AND (parent_links.school_id IS NULL OR parent_links.school_id = a.school_id)
        AND (
          COALESCE(NULLIF(TRIM(a.parent_contact), ''), '') = ''
          OR EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
              AND (
                regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g')
                  = regexp_replace(COALESCE(a.parent_contact, ''), '\D', '', 'g')
                OR lower(COALESCE(pr.email, '')) = lower(COALESCE(a.parent_contact, ''))
              )
          )
        )
    )
  );

-- Parents may remove their own links too.
CREATE POLICY "Parents unlink own wards"
  ON public.parent_links FOR DELETE
  USING (parent_user_id = auth.uid());

-- ============================================================
--  2. link_ward_to_parent / unlink_ward  (app-facing, parent RPCs)
-- ============================================================
CREATE OR REPLACE FUNCTION public.link_ward_to_parent(p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id UUID := auth.uid();
  v_school_id UUID;
  v_contact_ok BOOLEAN;
BEGIN
  IF v_parent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be signed in to link a ward.');
  END IF;

  SELECT a.school_id,
         COALESCE(NULLIF(TRIM(a.parent_contact), ''), '') = ''
           OR EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = v_parent_id
               AND (
                 regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g')
                   = regexp_replace(COALESCE(a.parent_contact, ''), '\D', '', 'g')
                 OR lower(COALESCE(pr.email, '')) = lower(COALESCE(a.parent_contact, ''))
               )
           )
  INTO v_school_id, v_contact_ok
  FROM public.applications a
  WHERE a.student_id = p_student_id;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No student was found with that Student ID. Double-check the ID (e.g. STU-ABC12) and try again.');
  END IF;

  IF NOT v_contact_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student already has a different guardian contact on file. Ask the school to link you, or update your phone number on My Profile to match the school record.');
  END IF;

  INSERT INTO public.parent_links (parent_user_id, student_id, school_id)
  VALUES (v_parent_id, p_student_id, v_school_id)
  ON CONFLICT (parent_user_id, student_id) DO NOTHING;

  -- Keep the parent profile scoped to the ward's school so the header,
  -- branding and notices resolve correctly.
  UPDATE public.profiles SET school_id = v_school_id
  WHERE id = v_parent_id AND (school_id IS NULL OR school_id <> v_school_id);

  RETURN jsonb_build_object('success', true, 'linked', true, 'student_id', p_student_id, 'school_id', v_school_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_ward_to_parent(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlink_ward(p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id UUID := auth.uid();
BEGIN
  IF v_parent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be signed in to unlink a ward.');
  END IF;

  DELETE FROM public.parent_links
  WHERE parent_user_id = v_parent_id AND student_id = p_student_id;

  RETURN jsonb_build_object('success', true, 'unlinked', true, 'student_id', p_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlink_ward(TEXT) TO authenticated;

-- ============================================================
--  3. admin_link_parent_ward / admin_unlink_parent_ward
--     School staff can connect a parent account to a ward of their
--     own school (fixes phone mismatches / school-side onboarding).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_link_parent_ward(p_parent_user_id UUID, p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_school UUID;
  v_student_school UUID;
BEGIN
  SELECT school_id INTO v_caller_school FROM public.profiles WHERE id = auth.uid();

  IF NOT public.user_has_role('super_admin') THEN
    IF v_caller_school IS NULL OR NOT public.is_school_staff(v_caller_school) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to link parent accounts');
    END IF;
  END IF;

  SELECT a.school_id INTO v_student_school
  FROM public.applications a WHERE a.student_id = p_student_id;

  IF v_student_school IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No student was found with that Student ID');
  END IF;

  -- Staff may only link wards of their own school.
  IF NOT public.user_has_role('super_admin') AND v_student_school <> v_caller_school THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student belongs to a different school');
  END IF;

  INSERT INTO public.parent_links (parent_user_id, student_id, school_id)
  VALUES (p_parent_user_id, p_student_id, v_student_school)
  ON CONFLICT (parent_user_id, student_id) DO NOTHING;

  UPDATE public.profiles SET school_id = v_student_school
  WHERE id = p_parent_user_id AND (school_id IS NULL OR school_id <> v_student_school);

  RETURN jsonb_build_object('success', true, 'linked', true, 'student_id', p_student_id, 'school_id', v_student_school);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_link_parent_ward(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unlink_parent_ward(p_parent_user_id UUID, p_student_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
  v_link_school UUID;
BEGIN
  IF NOT public.user_has_role('super_admin') THEN
    SELECT school_id INTO v_school_id FROM public.profiles WHERE id = auth.uid();
    IF v_school_id IS NULL OR NOT public.is_school_staff(v_school_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to unlink parent accounts');
    END IF;
  END IF;

  SELECT school_id INTO v_link_school
  FROM public.parent_links
  WHERE parent_user_id = p_parent_user_id AND student_id = p_student_id;

  IF v_link_school IS NOT NULL AND NOT public.user_has_role('super_admin')
     AND v_link_school <> v_school_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'That ward belongs to a different school');
  END IF;

  DELETE FROM public.parent_links
  WHERE parent_user_id = p_parent_user_id AND student_id = p_student_id;

  RETURN jsonb_build_object('success', true, 'unlinked', true, 'student_id', p_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unlink_parent_ward(UUID, TEXT) TO authenticated;

-- ============================================================
--  MIGRATION COMPLETE — what this adds:
--  RLS: parents may link/unlink their own wards (contact-guarded)
--  link_ward_to_parent / unlink_ward   (parent self-service + login heal)
--  admin_link_parent_ward / admin_unlink_parent_ward (school staff)
-- ============================================================