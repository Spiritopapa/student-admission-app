-- ============================================================
--  Student Admission Portal — Teacher Profile Fields
--  Adds comprehensive teacher profile fields to the teachers table
--  Creates teacher_documents table for file uploads
--  Creates storage bucket for teacher documents
-- ============================================================

-- ---------------------------------------------------
-- 1. ADD PROFILE FIELDS TO TEACHERS TABLE
-- ---------------------------------------------------
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS surname TEXT,
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS disability TEXT,
  ADD COLUMN IF NOT EXISTS place_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS religion TEXT,
  ADD COLUMN IF NOT EXISTS staff_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS mobile_number TEXT,
  ADD COLUMN IF NOT EXISTS ghana_card_number TEXT,
  ADD COLUMN IF NOT EXISTS tin_number TEXT,
  ADD COLUMN IF NOT EXISTS ntc_number TEXT,
  ADD COLUMN IF NOT EXISTS ssnit_number TEXT,
  ADD COLUMN IF NOT EXISTS certificate_number TEXT,
  ADD COLUMN IF NOT EXISTS emis_code TEXT,
  ADD COLUMN IF NOT EXISTS date_first_appointment_district DATE,
  ADD COLUMN IF NOT EXISTS date_transfer_last_school DATE,
  ADD COLUMN IF NOT EXISTS date_promoted_present_rank DATE,
  ADD COLUMN IF NOT EXISTS date_last_upgrading DATE,
  ADD COLUMN IF NOT EXISTS school_name TEXT,
  ADD COLUMN IF NOT EXISTS school_region TEXT,
  ADD COLUMN IF NOT EXISTS circuit TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS rank TEXT,
  ADD COLUMN IF NOT EXISTS salary_scale TEXT,
  ADD COLUMN IF NOT EXISTS salary_step TEXT;

-- Indexes for searchable fields
CREATE INDEX IF NOT EXISTS idx_teachers_first_name ON public.teachers(first_name);
CREATE INDEX IF NOT EXISTS idx_teachers_surname ON public.teachers(surname);
CREATE INDEX IF NOT EXISTS idx_teachers_staff_id ON public.teachers(staff_id);
CREATE INDEX IF NOT EXISTS idx_teachers_ghana_card ON public.teachers(ghana_card_number);
CREATE INDEX IF NOT EXISTS idx_teachers_tin ON public.teachers(tin_number);
CREATE INDEX IF NOT EXISTS idx_teachers_ntc ON public.teachers(ntc_number);
CREATE INDEX IF NOT EXISTS idx_teachers_ssnit ON public.teachers(ssnit_number);
CREATE INDEX IF NOT EXISTS idx_teachers_certificate ON public.teachers(certificate_number);
CREATE INDEX IF NOT EXISTS idx_teachers_emis ON public.teachers(emis_code);
CREATE INDEX IF NOT EXISTS idx_teachers_gender ON public.teachers(gender);
CREATE INDEX IF NOT EXISTS idx_teachers_region ON public.teachers(region);
CREATE INDEX IF NOT EXISTS idx_teachers_district ON public.teachers(district);
CREATE INDEX IF NOT EXISTS idx_teachers_school_name ON public.teachers(school_name);

-- ---------------------------------------------------
-- 2. TEACHER DOCUMENTS TABLE (for file uploads)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL CHECK (document_type IN ('certificate','appointment_letter','other')),
  file_url        TEXT NOT NULL,
  file_name       TEXT,
  file_size       INTEGER,
  uploaded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.teacher_documents ENABLE ROW LEVEL SECURITY;

-- Admins can manage teacher documents
CREATE POLICY "Admins manage teacher documents"
  ON public.teacher_documents FOR ALL
  USING (
    public.can_access_school_data(teacher_documents.school_id)
  )
  WITH CHECK (
    public.can_access_school_data(teacher_documents.school_id)
  );

-- Teachers can view their own documents
CREATE POLICY "Teachers view own documents"
  ON public.teacher_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_documents.teacher_id
      AND t.user_id = auth.uid()
    )
  );

-- Teachers can upload their own documents
CREATE POLICY "Teachers upload own documents"
  ON public.teacher_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_documents.teacher_id
      AND t.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_teacher_documents_teacher ON public.teacher_documents(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_documents_school ON public.teacher_documents(school_id);

-- ---------------------------------------------------
-- 3. STORAGE BUCKET for teacher documents
-- ---------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('teacher-documents', 'teacher-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can view teacher documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload teacher documents" ON storage.objects;

CREATE POLICY "Anyone can view teacher documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'teacher-documents');

CREATE POLICY "Authenticated users can upload teacher documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'teacher-documents' AND auth.role() = 'authenticated');

-- ---------------------------------------------------
-- 4. FUNCTION: Calculate age from date of birth
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_age(p_dob DATE)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_dob IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN DATE_PART('year', AGE(CURRENT_DATE, p_dob))::INTEGER;
END;
$$;

-- ---------------------------------------------------
-- 5. TRIGGER: Auto-calculate age when dob changes
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_calculate_teacher_age()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.dob IS NOT NULL THEN
    NEW.age := public.calculate_age(NEW.dob);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_calculate_teacher_age ON public.teachers;
CREATE TRIGGER trg_auto_calculate_teacher_age
  BEFORE INSERT OR UPDATE OF dob ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_teacher_age();

-- ---------------------------------------------------
-- 6. FUNCTION: Check if staff ID exists (for login linking)
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_staff_id_exists(p_staff_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.teachers
    WHERE staff_id = p_staff_id
  );
END;
$$;

-- ---------------------------------------------------
-- 7. FUNCTION: Get teacher info by staff ID (for login)
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_teacher_info_by_staff_id(p_staff_id TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  school_id UUID,
  registration_id TEXT,
  staff_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.full_name, t.school_id, t.registration_id, t.staff_id
  FROM public.teachers t
  WHERE t.staff_id = p_staff_id;
END;
$$;