-- ============================================================
--  Student Admission Portal — Academic Entities
--  Tables: applications (students), teachers, accountants, classes, subjects
-- ============================================================

-- ---------------------------------------------------
-- 5. APPLICATIONS (Students)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        TEXT UNIQUE NOT NULL,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name        TEXT NOT NULL,
  middle_name       TEXT,
  last_name         TEXT NOT NULL,
  class_applying    TEXT NOT NULL,
  teacher           TEXT,
  previous_school   TEXT,
  admission_date    DATE,
  date_of_birth     DATE NOT NULL,
  parent_name       TEXT NOT NULL,
  parent_contact    TEXT NOT NULL,
  home_town         TEXT,
  place_of_stay     TEXT,
  gender            TEXT NOT NULL DEFAULT 'Male'
                    CHECK (gender IN ('Male','Female','Other')),
  religion          TEXT NOT NULL DEFAULT 'Christian'
                    CHECK (religion IN ('Christian','Muslim','Others')),
  term              TEXT NOT NULL DEFAULT 'First'
                    CHECK (term IN ('First','Second','Third')),
  student_photo_url TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','admitted')),
  portal_confirmed  BOOLEAN NOT NULL DEFAULT false,
  sub_admin_approved BOOLEAN NOT NULL DEFAULT false,
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins can read all applications in their school
CREATE POLICY "Admins read all applications"
  ON public.applications FOR SELECT
  USING (
    public.can_access_school_data(applications.school_id)
  );

-- Admins and Sub Admins can insert
CREATE POLICY "Admins insert applications"
  ON public.applications FOR INSERT
  WITH CHECK (
    public.can_access_school_data(applications.school_id)
  );

-- Admins and Sub Admins can update
CREATE POLICY "Admins update applications"
  ON public.applications FOR UPDATE
  USING (
    public.can_access_school_data(applications.school_id)
  );

-- Admins and Sub Admins can delete
CREATE POLICY "Admins delete applications"
  ON public.applications FOR DELETE
  USING (
    public.can_access_school_data(applications.school_id)
  );

-- Students view only their own record
CREATE POLICY "Students view own application"
  ON public.applications FOR SELECT
  USING (user_id = auth.uid());

-- Parents view their ward's record via parent_links
CREATE POLICY "Parents view ward application"
  ON public.applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.parent_links pl
    WHERE pl.student_id = applications.student_id
    AND pl.parent_user_id = auth.uid()
  ));

-- Teachers view students in their class
CREATE POLICY "Teachers view class students"
  ON public.applications FOR SELECT
  USING (
    public.is_approved_teacher()
    AND class_applying = public.get_teacher_class()
  );

-- ---------------------------------------------------
-- 6. TEACHERS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teachers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  class_taught    TEXT,
  subject         TEXT,
  qualification   TEXT,
  date_joined     DATE DEFAULT CURRENT_DATE,
  is_active       BOOLEAN DEFAULT true,
  registration_id TEXT UNIQUE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_approved     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

-- Admins and Sub Admins can manage teachers
CREATE POLICY "Admins manage teachers"
  ON public.teachers FOR ALL
  USING (
    public.can_access_school_data(teachers.school_id)
  );

-- Teachers can view their own record
CREATE POLICY "Teachers view own record"
  ON public.teachers FOR SELECT
  USING (user_id = auth.uid());

-- Indexes for teachers
CREATE INDEX IF NOT EXISTS idx_teachers_email ON public.teachers(email);
CREATE INDEX IF NOT EXISTS idx_teachers_class ON public.teachers(class_taught);
CREATE INDEX IF NOT EXISTS idx_teachers_registration_id ON public.teachers(registration_id);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON public.teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON public.teachers(school_id);

-- ---------------------------------------------------
-- 7. ACCOUNTANTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accountants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id TEXT UNIQUE NOT NULL,  -- Generated by sub admin (e.g. ACC-0001)
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_approved     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.accountants ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all accountants
CREATE POLICY "Super admins manage accountants"
  ON public.accountants FOR ALL
  USING (
    public.user_has_role('super_admin')
  )
  WITH CHECK (
    public.user_has_role('super_admin')
  );

-- School admins can manage accountants within their school
CREATE POLICY "School admins manage accountants"
  ON public.accountants FOR ALL
  USING (
    public.user_has_role('admin')
    AND public.user_belongs_to_school(accountants.school_id)
  )
  WITH CHECK (
    public.user_has_role('admin')
    AND public.user_belongs_to_school(accountants.school_id)
  );

-- Sub admins can manage accountants within their school
CREATE POLICY "Sub admins manage accountants"
  ON public.accountants FOR ALL
  USING (
    public.user_has_role('sub_admin')
    AND public.user_belongs_to_school(accountants.school_id)
  )
  WITH CHECK (
    public.user_has_role('sub_admin')
    AND public.user_belongs_to_school(accountants.school_id)
  );

-- Accountants can view their own record
CREATE POLICY "Accountants view own record"
  ON public.accountants FOR SELECT
  USING (user_id = auth.uid());

-- Accountants can view students in their school (needed for fee management)
CREATE POLICY "Accountants view students"
  ON public.applications FOR SELECT
  USING (
    public.user_has_role('accountant')
    AND public.user_belongs_to_school(applications.school_id)
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accountants_registration_id ON public.accountants(registration_id);
CREATE INDEX IF NOT EXISTS idx_accountants_user_id ON public.accountants(user_id);
CREATE INDEX IF NOT EXISTS idx_accountants_school_id ON public.accountants(school_id);

-- ---------------------------------------------------
-- 14. CLASSES
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'primary'
               CHECK (level IN ('creche','nursery','kg','primary','jhs')),
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- Admins can manage classes
CREATE POLICY "Admins manage classes"
  ON public.classes FOR ALL
  USING (
    public.can_access_school_data(classes.school_id)
  );

-- Users can view own school classes
CREATE POLICY "Users view own school classes"
  ON public.classes FOR SELECT
  USING (
    public.can_access_school_data(classes.school_id)
  );

-- Per-school unique constraint (allows same class name across different schools)
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_school_name_unique
  ON public.classes (school_id, name);
CREATE INDEX IF NOT EXISTS idx_classes_school_id ON public.classes(school_id);

-- ---------------------------------------------------
-- 15. SUBJECTS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subjects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

-- Admins can manage subjects
CREATE POLICY "Admins manage subjects"
  ON public.subjects FOR ALL
  USING (
    public.can_access_school_data(subjects.school_id)
  );

-- Users can view own school subjects
CREATE POLICY "Users view own school subjects"
  ON public.subjects FOR SELECT
  USING (
    public.can_access_school_data(subjects.school_id)
  );

-- Per-school unique constraint (allows same subject name across different schools)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_school_name_unique
  ON public.subjects (school_id, name);
CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON public.subjects(school_id);
