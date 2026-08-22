-- ============================================================
--  Student Admission Portal — Storage Bucket & Global Indexes
-- ============================================================

-- ---------------------------------------------------
-- 30. STORAGE BUCKET for student photos
-- ---------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can view student photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload student photos" ON storage.objects;

CREATE POLICY "Anyone can view student photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'student-photos');

CREATE POLICY "Authenticated users can upload student photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'student-photos' AND auth.role() = 'authenticated');

-- ---------------------------------------------------
-- 31. GLOBAL INDEXES (for frequently queried columns)
-- ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_school_id ON public.profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_student_id ON public.applications(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_class ON public.applications(class_applying);
CREATE INDEX IF NOT EXISTS idx_applications_school_id ON public.applications(school_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_student ON public.parent_links(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON public.parent_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_school_id ON public.parent_links(school_id);