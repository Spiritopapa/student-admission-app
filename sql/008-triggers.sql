-- ============================================================
--  Student Admission Portal — Triggers
--  Includes: updated_at triggers, auto-set school_id triggers
-- ============================================================

-- ---------------------------------------------------
-- 23. AUTO-UPDATE TRIGGERS (updated_at)
-- ---------------------------------------------------

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables with updated_at column
CREATE TRIGGER set_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_results_updated_at
  BEFORE UPDATE ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_subjects_updated_at
  BEFORE UPDATE ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_exam_student_details_updated_at
  BEFORE UPDATE ON public.exam_student_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_attendance_updated_at
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------
-- 24. AUTO-SET SCHOOL_ID TRIGGERS
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- Create triggers for all data tables to auto-set school_id
CREATE TRIGGER set_applications_school_id
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_teachers_school_id
  BEFORE INSERT ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_classes_school_id
  BEFORE INSERT ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_subjects_school_id
  BEFORE INSERT ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_announcements_school_id
  BEFORE INSERT ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_exams_school_id
  BEFORE INSERT ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_exam_results_school_id
  BEFORE INSERT ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_parent_links_school_id
  BEFORE INSERT ON public.parent_links
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_sub_admins_school_id
  BEFORE INSERT ON public.sub_admins
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

CREATE TRIGGER set_attendance_school_id
  BEFORE INSERT ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

-- Fix: Missing trigger for accountants table (rsl policy fix)
CREATE TRIGGER set_accountants_school_id
  BEFORE INSERT ON public.accountants
  FOR EACH ROW EXECUTE FUNCTION public.set_school_id();

-- Fix: Ensure school_id is preserved during applications updates
CREATE OR REPLACE FUNCTION public.ensure_applications_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    NEW.school_id := OLD.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_applications_school_id ON public.applications;
CREATE TRIGGER ensure_applications_school_id
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_applications_school_id();
