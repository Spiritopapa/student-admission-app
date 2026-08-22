-- ============================================================
--  Student Admission Portal — Multi-Choice Assessments Module
--  Tables: assessment_questions, assessments, assessment_attempts
--  RPCs:   start_assessment_attempt, submit_assessment_attempt
-- ============================================================
-- Anti-cheating design:
--   * Admins/teachers build a large question bank and configure
--     an assessment (a "paper") that draws N random questions.
--   * When a student starts an assessment, a SECURITY DEFINER RPC
--     picks a RANDOM subset of questions and (optionally) shuffles
--     the answer options server-side. Correct answers are NEVER sent
--     to the student's browser - they are stored only in the attempt
--     snapshot on the server.
--   * Each student gets ONE fixed randomized arrangement (snapshot)
--     for a given assessment, so re-entering cannot re-randomize.
--   * Grading happens server-side on submit and the score + review
--     is returned only to that student.
-- ============================================================

-- ---------------------------------------------------
-- QUESTION BANK
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject         TEXT NOT NULL,
  class_name      TEXT,
  topic           TEXT,
  question_text   TEXT NOT NULL,
  option_a        TEXT NOT NULL,
  option_b        TEXT NOT NULL,
  option_c        TEXT NOT NULL,
  option_d        TEXT NOT NULL,
  correct_option  TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  explanation     TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;

-- Admins / sub-admins / teachers can manage the question bank.
-- Students have NO policy here, so they cannot read questions or answers.
CREATE POLICY "Admins manage assessment questions"
  ON public.assessment_questions FOR ALL
  USING (
    public.can_access_school_data(assessment_questions.school_id)
    OR public.is_approved_teacher()
  )
  WITH CHECK (
    public.can_access_school_data(assessment_questions.school_id)
    OR public.is_approved_teacher()
  );

-- Teachers should only see their own school's questions
CREATE POLICY "Teachers view own school assessment questions"
  ON public.assessment_questions FOR SELECT
  USING (
    public.is_approved_teacher()
    AND (assessment_questions.school_id IS NULL
         OR assessment_questions.school_id = (SELECT school_id FROM public.teachers WHERE user_id = auth.uid() AND is_approved = true LIMIT 1))
  );

CREATE INDEX IF NOT EXISTS idx_assessment_questions_school ON public.assessment_questions(school_id);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_subject ON public.assessment_questions(subject);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_class ON public.assessment_questions(class_name);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_active ON public.assessment_questions(is_active);
-- ---------------------------------------------------
-- ASSESSMENTS (configured papers drawing from the bank)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  subject           TEXT NOT NULL,
  class_name        TEXT,
  topic             TEXT,
  question_count    INTEGER NOT NULL DEFAULT 10 CHECK (question_count > 0),
  duration_minutes  INTEGER DEFAULT 30,
  shuffle_questions BOOLEAN DEFAULT true,
  shuffle_options   BOOLEAN DEFAULT true,
  pass_percentage   NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (pass_percentage >= 0 AND pass_percentage <= 100),
  is_published      BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

-- Admins / teachers manage assessments
CREATE POLICY "Admins manage assessments"
  ON public.assessments FOR ALL
  USING (
    public.can_access_school_data(assessments.school_id)
    OR public.is_approved_teacher()
  )
  WITH CHECK (
    public.can_access_school_data(assessments.school_id)
    OR public.is_approved_teacher()
  );

-- Teachers view their own school's assessments
CREATE POLICY "Teachers view own school assessments"
  ON public.assessments FOR SELECT
  USING (
    public.is_approved_teacher()
    AND (assessments.school_id IS NULL
         OR assessments.school_id = (SELECT school_id FROM public.teachers WHERE user_id = auth.uid() AND is_approved = true LIMIT 1))
  );

-- Students can view published assessments for their class
CREATE POLICY "Students view published assessments"
  ON public.assessments FOR SELECT
  USING (
    is_published = true
    AND is_active = true
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.user_id = auth.uid()
      AND (assessments.school_id IS NULL OR a.school_id = assessments.school_id)
      AND (assessments.class_name IS NULL OR a.class_applying = assessments.class_name)
    )
  );

CREATE INDEX IF NOT EXISTS idx_assessments_school ON public.assessments(school_id);
CREATE INDEX IF NOT EXISTS idx_assessments_published ON public.assessments(is_published, is_active);

-- ---------------------------------------------------
-- ATTEMPTS (one randomized snapshot per student per assessment)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id         TEXT NOT NULL REFERENCES public.applications(student_id) ON DELETE CASCADE,
  school_id          UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  questions_snapshot jsonb NOT NULL,
  answers            jsonb,
  started_at         TIMESTAMPTZ DEFAULT now(),
  submitted_at       TIMESTAMPTZ,
  is_submitted       BOOLEAN DEFAULT false,
  score              INTEGER DEFAULT 0,
  total_marks        INTEGER DEFAULT 0,
  score_percentage   NUMERIC(5,2) DEFAULT 0,
  pass_percentage    NUMERIC(5,2) DEFAULT 50,
  status             TEXT DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress','submitted','passed','failed')),
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(assessment_id, student_id)
);

ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;

-- Students intentionally have NO direct SELECT policy on this table.
-- The snapshot contains correct answers, so students access their own
-- attempts only through the SECURITY DEFINER RPCs below
-- (get_my_assessment_summaries / get_my_assessment_review), which never
-- leak answers before submission and only return safe summary columns.
DROP POLICY IF EXISTS "Students view own attempts" ON public.assessment_attempts;

-- Admins / teachers view attempts for their school
CREATE POLICY "Admins view attempts"
  ON public.assessment_attempts FOR SELECT
  USING (
    public.can_access_school_data(assessment_attempts.school_id)
    OR public.is_approved_teacher()
  );

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment ON public.assessment_attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student ON public.assessment_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_school ON public.assessment_attempts(school_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_assessments_updated_at ON public.assessments;
CREATE TRIGGER set_assessments_updated_at
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_assessment_questions_updated_at ON public.assessment_questions;
CREATE TRIGGER set_assessment_questions_updated_at
  BEFORE UPDATE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_assessment_attempts_updated_at ON public.assessment_attempts;
CREATE TRIGGER set_assessment_attempts_updated_at
  BEFORE UPDATE ON public.assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ============================================================
--  START ASSESSMENT (randomized snapshot, server-side)
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_assessment_attempt(p_assessment_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id    TEXT;
  v_student_class TEXT;
  v_student_school UUID;
  v_assess        public.assessments%ROWTYPE;
  v_existing      public.assessment_attempts%ROWTYPE;
  v_count         INT;
  v_snapshot      jsonb;
  v_client        jsonb;
  v_attempt_id    UUID;
BEGIN
  -- Resolve the calling user to a student + their class/school
  SELECT a.student_id, a.class_applying, a.school_id
    INTO v_student_id, v_student_class, v_student_school
  FROM public.applications a
  WHERE a.user_id = auth.uid()
  LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No student account linked to this user.');
  END IF;

  SELECT * INTO v_assess FROM public.assessments WHERE id = p_assessment_id;
  IF v_assess.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Assessment not found.');
  END IF;
  IF NOT v_assess.is_published OR NOT v_assess.is_active THEN
    RETURN jsonb_build_object('error', 'This assessment is not available.');
  END IF;
  IF v_assess.class_name IS NOT NULL AND v_assess.class_name <> v_student_class THEN
    RETURN jsonb_build_object('error', 'This assessment is not available for your class.');
  END IF;
  IF v_assess.school_id IS NOT NULL AND v_assess.school_id <> v_student_school THEN
    RETURN jsonb_build_object('error', 'This assessment is not available for you.');
  END IF;

  -- Resume an existing (not submitted) attempt: fixed snapshot, no re-randomizing
  SELECT * INTO v_existing FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND student_id = v_student_id
    LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.is_submitted THEN
      RETURN jsonb_build_object('attempt_id', v_existing.id::text, 'status', 'completed',
        'score', v_existing.score, 'total_marks', v_existing.total_marks,
        'score_percentage', v_existing.score_percentage, 'status_display', v_existing.status);
    END IF;
    SELECT jsonb_agg(el - 'correct_text' - 'explanation')
      INTO v_client
    FROM jsonb_array_elements(v_existing.questions_snapshot) el;
    RETURN jsonb_build_object('attempt_id', v_existing.id::text, 'status', 'in_progress',
      'title', v_assess.title, 'description', v_assess.description,
      'subject', v_assess.subject, 'class_name', v_assess.class_name,
      'duration_minutes', v_assess.duration_minutes,
      'pass_percentage', v_assess.pass_percentage,
      'total_marks', v_existing.total_marks,
      'questions', COALESCE(v_client, '[]'::jsonb));
  END IF;

  -- Build ONE randomized snapshot (WITH correct answers, kept server-side)
  v_snapshot := (
    WITH cand AS (
      SELECT qq.id, qq.topic, qq.question_text,
             qq.option_a, qq.option_b, qq.option_c, qq.option_d,
             qq.correct_option, qq.explanation,
             CASE qq.correct_option
               WHEN 'A' THEN qq.option_a
               WHEN 'B' THEN qq.option_b
               WHEN 'C' THEN qq.option_c
               ELSE qq.option_d
             END AS correct_text
      FROM public.assessment_questions qq
      WHERE qq.school_id = v_assess.school_id
        AND qq.is_active = true
        AND qq.subject = v_assess.subject
        AND (v_assess.class_name IS NULL OR qq.class_name = v_assess.class_name)
        AND (v_assess.topic IS NULL OR v_assess.topic = '' OR qq.topic = v_assess.topic)
    ),
    picked AS (
      SELECT c.* FROM cand c
      ORDER BY random()
      LIMIT GREATEST(1, LEAST(v_assess.question_count, (SELECT count(*) FROM cand)))
    ),
    built AS (
      SELECT jsonb_build_object(
        'id', p.id::text,
        'topic', p.topic,
        'question_text', p.question_text,
        'options', (
          SELECT jsonb_agg(jsonb_build_object('key', v.k, 'text', v.t)
                           ORDER BY (CASE WHEN v_assess.shuffle_options THEN random() ELSE 0 END), v.k)
          FROM (VALUES ('A', p.option_a), ('B', p.option_b),
                       ('C', p.option_c), ('D', p.option_d)) AS v(k, t)
        ),
        'correct_text', p.correct_text,
        'explanation', p.explanation
      ) AS obj
      FROM picked p
    )
    SELECT jsonb_agg(b.obj ORDER BY (CASE WHEN v_assess.shuffle_questions THEN random() ELSE 0 END), b.obj->>'id')
    FROM built b
  );

  IF v_snapshot IS NULL OR jsonb_array_length(v_snapshot) = 0 THEN
    RETURN jsonb_build_object('error', 'No active questions available for this assessment. Ask your teacher to add questions.');
  END IF;

  v_count := jsonb_array_length(v_snapshot);

  INSERT INTO public.assessment_attempts
    (assessment_id, student_id, school_id, questions_snapshot, pass_percentage, total_marks, status)
  VALUES
    (p_assessment_id, v_student_id, v_assess.school_id, v_snapshot, v_assess.pass_percentage, v_count, 'in_progress')
  RETURNING id INTO v_attempt_id;

-- Build sanitized client copy (answers stripped: anti-cheating)
  SELECT jsonb_agg(el - 'correct_text' - 'explanation')
    INTO v_client
  FROM jsonb_array_elements(v_snapshot) el;

  RETURN jsonb_build_object('attempt_id', v_attempt_id::text, 'status', 'in_progress',
    'title', v_assess.title, 'description', v_assess.description,
    'subject', v_assess.subject, 'class_name', v_assess.class_name,
    'duration_minutes', v_assess.duration_minutes,
    'pass_percentage', v_assess.pass_percentage,
    'total_marks', v_count,
    'questions', COALESCE(v_client, '[]'::jsonb));
END;
$$;
-- ============================================================
--  SUBMIT ASSESSMENT (server-side self grading)
--  p_answers : jsonb object mapping question_id -> chosen option key (A/B/C/D)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_assessment_attempt(p_attempt_id UUID, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id  TEXT;
  v_attempt     public.assessment_attempts%ROWTYPE;
  v_total       INT;
  v_correct     INT;
  v_pct         NUMERIC;
  v_passed      BOOLEAN;
  v_next_status TEXT;
  v_review      jsonb;
BEGIN
  SELECT student_id INTO v_student_id FROM public.applications WHERE user_id = auth.uid() LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No student account linked to this user.');
  END IF;

  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Attempt not found.');
  END IF;
  IF v_attempt.student_id <> v_student_id THEN
    RETURN jsonb_build_object('error', 'You are not allowed to submit this attempt.');
  END IF;
  IF v_attempt.is_submitted THEN
    RETURN jsonb_build_object('attempt_id', v_attempt.id::text, 'status', 'completed',
      'score', v_attempt.score, 'total_marks', v_attempt.total_marks,
      'score_percentage', v_attempt.score_percentage, 'status_display', v_attempt.status);
  END IF;

  IF p_answers IS NULL THEN p_answers := '{}'::jsonb; END IF;

  v_total := jsonb_array_length(v_attempt.questions_snapshot);

  -- Grade server-side
  WITH graded AS (
    SELECT q,
      p_answers->>(q->>'id') AS chosen_key,
      (SELECT o->>'text' FROM jsonb_array_elements(q->'options') o
        WHERE o->>'key' = (p_answers->>(q->>'id'))) AS chosen_text
    FROM jsonb_array_elements(v_attempt.questions_snapshot) q
  )
  SELECT count(*) INTO v_correct FROM graded g
  WHERE g.chosen_text IS NOT NULL AND g.chosen_text = g.q->>'correct_text';

  v_pct := ROUND(100.0 * v_correct / NULLIF(v_total, 0), 2);
  v_passed := v_pct >= v_attempt.pass_percentage;
  v_next_status := CASE WHEN v_passed THEN 'passed' ELSE 'failed' END;

  -- Build per-question review (correct answers revealed only to the attempt owner)
  WITH graded AS (
    SELECT q,
      p_answers->>(q->>'id') AS chosen_key,
      (SELECT o->>'text' FROM jsonb_array_elements(q->'options') o
        WHERE o->>'key' = (p_answers->>(q->>'id'))) AS chosen_text
    FROM jsonb_array_elements(v_attempt.questions_snapshot) q
  )
  SELECT jsonb_agg(jsonb_build_object(
      'id', g.q->>'id',
      'topic', g.q->>'topic',
      'question_text', g.q->>'question_text',
      'options', g.q->'options',
      'chosen', g.chosen_key,
      'chosen_text', g.chosen_text,
      'correct', (g.chosen_text IS NOT NULL AND g.chosen_text = g.q->>'correct_text'),
      'correct_text', g.q->>'correct_text',
      'explanation', g.q->>'explanation'
    ))
    INTO v_review FROM graded g;

  UPDATE public.assessment_attempts
  SET answers = p_answers,
      is_submitted = true,
      submitted_at = now(),
      score = v_correct,
      total_marks = v_total,
      score_percentage = v_pct,
      status = v_next_status,
      updated_at = now()
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('attempt_id', v_attempt.id::text, 'status', 'submitted',
    'score', v_correct, 'total_marks', v_total,
    'score_percentage', v_pct,
    'passed', v_passed,
    'pass_percentage', v_attempt.pass_percentage,
    'status_display', v_next_status,
    'review', COALESCE(v_review, '[]'::jsonb));
END;
$$;
-- ============================================================
--  GET MY ATTEMPTS (safe summary only - no answers/snapshot)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_assessment_summaries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id TEXT;
BEGIN
  SELECT student_id INTO v_student_id FROM public.applications WHERE user_id = auth.uid() LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'assessment_id', a.assessment_id,
      'student_id', a.student_id,
      'status', a.status,
      'is_submitted', a.is_submitted,
      'score', a.score,
      'total_marks', a.total_marks,
      'score_percentage', a.score_percentage,
      'started_at', a.started_at,
      'submitted_at', a.submitted_at
    )), '[]'::jsonb)
    FROM public.assessment_attempts a
    WHERE a.student_id = v_student_id);
END;
$$;

-- ============================================================
--  GET MY ASSESSMENT REVIEW (only after submission, owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_assessment_review(p_attempt_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id TEXT;
  v_attempt    public.assessment_attempts%ROWTYPE;
  v_title      TEXT;
  v_review     jsonb;
BEGIN
  SELECT student_id INTO v_student_id FROM public.applications WHERE user_id = auth.uid() LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No student account linked to this user.');
  END IF;

  SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
  IF v_attempt.id IS NULL OR v_attempt.student_id <> v_student_id THEN
    RETURN jsonb_build_object('error', 'Attempt not found or not yours.');
  END IF;
  IF NOT v_attempt.is_submitted THEN
    RETURN jsonb_build_object('error', 'Submit the assessment before reviewing.');
  END IF;

  SELECT title INTO v_title FROM public.assessments WHERE id = v_attempt.assessment_id;

  WITH graded AS (
    SELECT q,
      (v_attempt.answers)->>(q->>'id') AS chosen_key,
      (SELECT o->>'text' FROM jsonb_array_elements(q->'options') o
        WHERE o->>'key' = ((v_attempt.answers)->>(q->>'id'))) AS chosen_text
    FROM jsonb_array_elements(v_attempt.questions_snapshot) q
  )
  SELECT jsonb_agg(jsonb_build_object(
      'id', g.q->>'id',
      'topic', g.q->>'topic',
      'question_text', g.q->>'question_text',
      'options', g.q->'options',
      'chosen', g.chosen_key,
      'chosen_text', g.chosen_text,
      'correct', (g.chosen_text IS NOT NULL AND g.chosen_text = g.q->>'correct_text'),
      'correct_text', g.q->>'correct_text',
      'explanation', g.q->>'explanation'
    ))
    INTO v_review FROM graded g;

  RETURN jsonb_build_object('attempt_id', v_attempt.id::text, 'title', v_title,
    'score', v_attempt.score, 'total_marks', v_attempt.total_marks,
    'score_percentage', v_attempt.score_percentage,
    'status', v_attempt.status,
    'review', COALESCE(v_review, '[]'::jsonb));
END;
$$;

-- ============================================================
--  REGISTER MODULE (for school-level lock/unlock control)
-- ============================================================
INSERT INTO public.modules (name, label, icon, is_core, sort_order)
VALUES ('assessments', 'Assessments', '❓', false, 30)
ON CONFLICT (name) DO NOTHING;