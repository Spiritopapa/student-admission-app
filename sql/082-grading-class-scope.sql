-- ============================================================
--  MIGRATION: Per-Class Grading Systems
--  Adds a class_name dimension to grading_systems so a school can run a
--  SEPARATE grading scale for each class, with automatic fallback to the
--  school-wide scale and then to the system default A-F scale.
--  Run this entire file in the Supabase SQL Editor (after 013-grading-systems).
-- ============================================================

-- ============================================================
--  1. CLASS SCOPE COLUMN
--     class_name NULL           -> school-wide scale (applies to all classes)
--     class_name 'Class 1'      -> per-class override for that class
-- ============================================================
ALTER TABLE grading_systems ADD COLUMN IF NOT EXISTS class_name TEXT DEFAULT NULL;

-- ============================================================
--  2. CLASS-AWARE UNIQUENESS (requires PostgreSQL 15+, Supabase is on 15+)
--     NULLS NOT DISTINCT treats NULL values as equal so a class can never
--     define two bands with the same label or the same boundary twice.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grading_systems_school_id_subject_name_grade_label_key') THEN
    ALTER TABLE grading_systems DROP CONSTRAINT grading_systems_school_id_subject_name_grade_label_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grading_systems_school_id_subject_name_min_score_key') THEN
    ALTER TABLE grading_systems DROP CONSTRAINT grading_systems_school_id_subject_name_min_score_key;
  END IF;
END $$;

ALTER TABLE grading_systems ADD CONSTRAINT grading_systems_class_scope_label_key
  UNIQUE NULLS NOT DISTINCT (school_id, class_name, subject_name, grade_label);
ALTER TABLE grading_systems ADD CONSTRAINT grading_systems_class_scope_min_key
  UNIQUE NULLS NOT DISTINCT (school_id, class_name, subject_name, min_score);
-- ============================================================
--  3. HELPER: EFFECTIVE SCALE FOR ONE CLASS
--     Resolution order: class rows -> school-wide rows -> system defaults.
-- ============================================================
CREATE OR REPLACE FUNCTION get_grade_scale_for_class(p_school_id UUID, p_class_name TEXT DEFAULT NULL)
RETURNS TABLE (
  grade_label TEXT,
  subject_name TEXT,
  min_score NUMERIC,
  max_score NUMERIC,
  description TEXT,
  color_class TEXT,
  sort_order INTEGER,
  scope TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM grading_systems
    WHERE school_id = p_school_id AND class_name IS NOT DISTINCT FROM p_class_name
  ) THEN
    RETURN QUERY
    SELECT g.grade_label, g.subject_name, g.min_score, g.max_score, g.description,
           g.color_class, g.sort_order, 'class'::TEXT
    FROM grading_systems g
    WHERE g.school_id = p_school_id AND g.class_name IS NOT DISTINCT FROM p_class_name
    ORDER BY g.sort_order ASC, g.min_score DESC;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM grading_systems WHERE school_id = p_school_id AND class_name IS NULL) THEN
    RETURN QUERY
    SELECT g.grade_label, g.subject_name, g.min_score, g.max_score, g.description,
           g.color_class, g.sort_order, 'school'::TEXT
    FROM grading_systems g
    WHERE g.school_id = p_school_id AND g.class_name IS NULL
    ORDER BY g.sort_order ASC, g.min_score DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT g.grade_label, g.subject_name, g.min_score, g.max_score, g.description,
         g.color_class, g.sort_order, 'default'::TEXT
  FROM grading_systems g
  WHERE g.school_id IS NULL AND g.is_default = true
  ORDER BY g.sort_order ASC, g.min_score DESC;
END;
$$;

-- ============================================================
--  4. HELPER: GRADE FOR A SCORE (class + subject aware)
--     Priority: class+subject -> class+overall -> school+subject ->
--               school+overall -> system default overall.
--     Backwards compatible: old callers using (score, school_id) still work.
-- ============================================================
CREATE OR REPLACE FUNCTION get_grade_for_score(
  p_score NUMERIC,
  p_school_id UUID DEFAULT NULL,
  p_subject_name TEXT DEFAULT NULL,
  p_class_name TEXT DEFAULT NULL
)
RETURNS TABLE (grade_label TEXT, description TEXT, color_class TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    -- 1) class-scoped subject rows
    SELECT g.grade_label, g.description, g.color_class, g.min_score, 1::INT AS priority
    FROM grading_systems g
    WHERE g.school_id = p_school_id
      AND g.class_name IS NOT DISTINCT FROM p_class_name
      AND g.subject_name IS NOT DISTINCT FROM p_subject_name
      AND p_score >= g.min_score AND p_score <= COALESCE(g.max_score, 100)
    UNION ALL
    -- 2) class-scoped overall rows
    SELECT g.grade_label, g.description, g.color_class, g.min_score, 2::INT
    FROM grading_systems g
    WHERE g.school_id = p_school_id
      AND g.class_name IS NOT DISTINCT FROM p_class_name
      AND g.subject_name IS NULL
      AND p_score >= g.min_score AND p_score <= COALESCE(g.max_score, 100)
    UNION ALL
    -- 3) school-wide subject rows
    SELECT g.grade_label, g.description, g.color_class, g.min_score, 3::INT
    FROM grading_systems g
    WHERE g.school_id = p_school_id
      AND g.class_name IS NULL
      AND g.subject_name IS NOT DISTINCT FROM p_subject_name
      AND p_score >= g.min_score AND p_score <= COALESCE(g.max_score, 100)
    UNION ALL
    -- 4) school-wide overall rows
    SELECT g.grade_label, g.description, g.color_class, g.min_score, 4::INT
    FROM grading_systems g
    WHERE g.school_id = p_school_id
      AND g.class_name IS NULL
      AND g.subject_name IS NULL
      AND p_score >= g.min_score AND p_score <= COALESCE(g.max_score, 100)
    UNION ALL
    -- 5) system default overall rows
    SELECT g.grade_label, g.description, g.color_class, g.min_score, 5::INT
    FROM grading_systems g
    WHERE g.school_id IS NULL AND g.is_default = true
      AND g.subject_name IS NULL
      AND p_score >= g.min_score AND p_score <= COALESCE(g.max_score, 100)
  )
  SELECT grade_label, description, color_class FROM candidates
  ORDER BY priority ASC, min_score DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'F'::TEXT, 'Fail'::TEXT, 'grade-f'::TEXT;
  END IF;
END;
$$;

-- ============================================================
--  5. RLS: no new policies required. Every row carries school_id that the
--     existing "view school's grading systems" / admin management policies
--     (sql/013) already cover, including the new class-scoped rows.
-- ============================================================
COMMENT ON TABLE grading_systems IS 'Per-school grading scales. class_name NULL = school-wide (all classes); subject_name NULL = overall band (all subjects); more specific scopes win when resolving a score.';

-- ============================================================
--  MIGRATION COMPLETE - what this adds:
--  grading_systems.class_name            per-class grading scopes
--  class-aware unique constraints        no duplicate labels/boundaries per scope
--  get_grade_scale_for_class()           effective scale for one class
--  get_grade_for_score(score, school, subject, class)
-- ============================================================