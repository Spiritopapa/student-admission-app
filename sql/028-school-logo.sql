-- ============================================================
--  Student Admission Portal — School Logo Support
--  ============================================================
--  Adds a `logo_url` column to `school_settings` so each school
--  can have its own logo displayed on:
--    - Sidebar (all dashboards)
--    - Exam report cards
--    - Fees receipts
--    - Debtors list
--    - Today's receipts
--    - Attendance reports
--    - Other relevant documents
--
--  HOW TO APPLY:
--  1. Open Supabase Dashboard → SQL Editor → New Query
--  2. Copy the ENTIRE content of this file
--  3. Paste and Run
-- ============================================================

-- Add logo_url column to school_settings (per-school settings)
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Also add logo_url to schools table as a fallback
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- ============================================================
--  Storage Bucket for School Logos
--  ============================================================
--  Creates a public storage bucket for school logos.
-- ============================================================

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-logos', 'school-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to create the school-logos bucket
-- (needed for the JS client-side auto-create fallback in utils.js)
DROP POLICY IF EXISTS "Allow authenticated to create school-logos bucket" ON storage.buckets;
CREATE POLICY "Allow authenticated to create school-logos bucket"
  ON storage.buckets FOR INSERT
  WITH CHECK (id = 'school-logos' AND auth.role() = 'authenticated');

-- Allow anyone to view school logos
DROP POLICY IF EXISTS "Anyone can view school logos" ON storage.objects;
CREATE POLICY "Anyone can view school logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'school-logos');

-- Allow authenticated users to upload school logos
DROP POLICY IF EXISTS "Authenticated users can upload school logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload school logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'school-logos' AND auth.role() = 'authenticated');

-- Allow authenticated users to update/delete objects in school-logos bucket
DROP POLICY IF EXISTS "Authenticated users can manage school logos" ON storage.objects;
CREATE POLICY "Authenticated users can manage school logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'school-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete school logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'school-logos' AND auth.role() = 'authenticated');

-- ============================================================
--  RLS: Ensure school_settings logo_url is accessible
--  ============================================================
--  The existing RLS policy "School staff manage own school settings"
--  already allows super_admin and school staff to read/update
--  school_settings, so no additional policy is needed.
--  The schools table already has "Anyone can check school ID"
--  policy for SELECT, so logo_url is readable.

-- ============================================================
--  ✅ Done
-- ============================================================