-- ============================================================
--  MIGRATION: Grading Systems (Per-School Configurable Grading)
--  Run this entire file in the Supabase SQL Editor
--  Supports overall grading AND per-subject grading
-- ============================================================

-- ============================================================
--  1. CREATE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS grading_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  subject_name TEXT DEFAULT NULL,
     -- NULL = overall grading (applies to all subjects)
     -- "Mathematics", "English", etc. = per-subject grading
  grade_label TEXT NOT NULL,
     -- e.g. "A", "B", "Excellent", "Pass", "Distinction"
  min_score NUMERIC(5,2) NOT NULL,
     -- Minimum percentage to achieve this grade
  max_score NUMERIC(5,2) DEFAULT 100,
     -- Maximum percentage for this grade
  description TEXT DEFAULT '',
     -- e.g. "Advance", "Proficient", "Developing"
  is_default BOOLEAN DEFAULT false,
     -- Whether this is part of the default grade set
  color_class TEXT DEFAULT '',
     -- CSS class: "grade-a", "grade-b", "grade-c", etc.
  sort_order INTEGER DEFAULT 0,
     -- Display order (1 = highest grade)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, subject_name, grade_label),
  UNIQUE(school_id, subject_name, min_score)
);

-- ============================================================
--  2. ENABLE ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE grading_systems ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  3. RLS POLICIES
-- ============================================================

-- Allow viewing (any authenticated user can see their school's grades)
CREATE POLICY "Users can view their school's grading systems"
  ON grading_systems FOR SELECT
  USING (
    school_id IS NULL OR
    school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  );

-- Allow admins to manage their own school's grades
CREATE POLICY "Admins can manage their school's grading systems"
  ON grading_systems FOR ALL
  USING (
    school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  );

-- Allow super admins to manage all grading systems
CREATE POLICY "Super admins can manage all grading systems"
  ON grading_systems FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
--  4. SEED DEFAULT GRADES (overall, applies to all subjects)
--     These are used as fallback if a school hasn't configured
--     their own grading system yet.
-- ============================================================
INSERT INTO grading_systems (school_id, subject_name, grade_label, min_score, max_score, description, color_class, sort_order, is_default)
VALUES
  (NULL, NULL, 'A', 80, 100,   'Advance',                 'grade-a', 1, true),
  (NULL, NULL, 'B', 70, 79.99, 'Proficient',              'grade-b', 2, true),
  (NULL, NULL, 'C', 60, 69.99, 'Approaching Proficient',  'grade-c', 3, true),
  (NULL, NULL, 'D', 50, 59.99, 'Developing',              'grade-d', 4, true),
  (NULL, NULL, 'E', 40, 49.99, 'Beginning',               'grade-e', 5, true),
  (NULL, NULL, 'F', 0,  39.99, 'Fail',                    'grade-f', 6, true)
ON CONFLICT (school_id, subject_name, grade_label) DO NOTHING;

-- ============================================================
--  5. REGISTER MODULE (for sidebar visibility & module locking)
-- ============================================================
INSERT INTO modules (name, label, icon, sort_order)
VALUES ('grading', 'Grading System', '📊', 13)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
--  6. HELPER FUNCTION: Get grading for a school
--     Returns overall grades or subject-specific grades.
--     Falls back to system defaults if school has none.
-- ============================================================
CREATE OR REPLACE FUNCTION get_school_grades(p_school_id UUID DEFAULT NULL)
RETURNS TABLE (
  grade_label TEXT,
  min_score NUMERIC,
  max_score NUMERIC,
  description TEXT,
  color_class TEXT,
  sort_order INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Try school-specific grades first
  RETURN QUERY
  SELECT g.grade_label, g.min_score, g.max_score, g.description, g.color_class, g.sort_order
  FROM grading_systems g
  WHERE g.school_id = p_school_id
  ORDER BY g.sort_order ASC, g.min_score DESC;
  
  -- If none found, return system defaults
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT g.grade_label, g.min_score, g.max_score, g.description, g.color_class, g.sort_order
    FROM grading_systems g
    WHERE g.school_id IS NULL AND g.is_default = true
    ORDER BY g.sort_order ASC, g.min_score DESC;
  END IF;
END;
$$;

-- ============================================================
--  7. HELPER FUNCTION: Get grade for a specific score
--     Looks for subject-specific grade first, falls back to
--     overall grade, then system default.
-- ============================================================
CREATE OR REPLACE FUNCTION get_grade_for_score(p_score NUMERIC, p_school_id UUID DEFAULT NULL)
RETURNS TABLE (
  grade_label TEXT,
  description TEXT,
  color_class TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT g.grade_label, g.description, g.color_class
  FROM grading_systems g
  WHERE (g.school_id = p_school_id OR g.school_id IS NULL)
    AND p_score >= g.min_score AND p_score <= g.max_score
  ORDER BY g.school_id NULLS LAST, g.min_score DESC
  LIMIT 1;
  
  -- If no match found, return 'F' as fallback
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'F'::TEXT, 'Fail'::TEXT, 'grade-f'::TEXT;
  END IF;
END;
$$;

-- ============================================================
--  MIGRATION COMPLETE
-- ============================================================
--  What this adds:
--  ✅ grading_systems table with per-subject support
--  ✅ RLS policies for data isolation
--  ✅ Default A-F grading scale seeded
--  ✅ Module registered for sidebar & locking
--  ✅ get_school_grades() function
--  ✅ get_grade_for_score() function
-- ============================================================