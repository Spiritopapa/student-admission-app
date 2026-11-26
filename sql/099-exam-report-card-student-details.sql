-- Add per-student report-card conduct, attitude, and interest selections.
ALTER TABLE public.exam_student_details
  ADD COLUMN IF NOT EXISTS conduct TEXT;

ALTER TABLE public.exam_student_details
  ALTER COLUMN interest DROP NOT NULL,
  ALTER COLUMN interest DROP DEFAULT,
  ALTER COLUMN attitude DROP NOT NULL,
  ALTER COLUMN attitude DROP DEFAULT;

ALTER TABLE public.exam_student_details
  DROP CONSTRAINT IF EXISTS exam_student_details_conduct_check,
  DROP CONSTRAINT IF EXISTS exam_student_details_interest_check,
  DROP CONSTRAINT IF EXISTS exam_student_details_attitude_check;

ALTER TABLE public.exam_student_details
  ADD CONSTRAINT exam_student_details_conduct_check
    CHECK (conduct IN ('respectful', 'humble', 'calm', 'helpful', 'stubbornness', 'truancy')),
  ADD CONSTRAINT exam_student_details_interest_check
    CHECK (interest IN ('sports', 'music', 'reading', 'art', 'public speaking', 'mathematics', 'singing', 'writing', 'athletics', 'science')),
  ADD CONSTRAINT exam_student_details_attitude_check
    CHECK (attitude IN ('hard-working', 'enthusiastic', 'dependable', 'not serious', 'lazy', 'active', 'respectful', 'calm', 'obedient', 'pay attention', 'dull', 'truant', 'not active'));
