-- ============================================================
--  Student Admission Portal — Additional Teacher Profile Fields
--  Adds new fields to the teachers table for the teacher dashboard
-- ============================================================

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS date_assumption_district DATE,
  ADD COLUMN IF NOT EXISTS date_assumption_present_station DATE,
  ADD COLUMN IF NOT EXISTS college_attended TEXT,
  ADD COLUMN IF NOT EXISTS shs_attended TEXT,
  ADD COLUMN IF NOT EXISTS salary_level TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS account_branch TEXT,
  ADD COLUMN IF NOT EXISTS home_town TEXT,
  ADD COLUMN IF NOT EXISTS area_of_specialization TEXT,
  ADD COLUMN IF NOT EXISTS professional_qualification TEXT,
  ADD COLUMN IF NOT EXISTS academic_qualification TEXT;