-- ============================================================
--  Student Admission Portal — Admin & Accountant Photos (with Frame)
--  ============================================================
--  PURPOSE: Capture the School Administrator's picture (with a
--  decorative frame) during school (admin) registration and the
--  Accountant's picture (with a frame) during accountant
--  registration. The framed photo URL is stored so it can be
--  shown in the sidebar avatar and profile views.
--
--  CHANGES:
--   01. schools.admin_photo_url   - School administrator's framed photo
--   02. accountants.photo_url     - Accountant's framed photo
--   03. staff-photos bucket       - Public storage bucket for both
--
--  HOW IT WORKS (frontend):
--   The frontend draws the selected picture on a canvas with a
--   decorative passport-style frame, exports it as a JPEG, and
--   uploads that FRAMED image (via Cloudinary, or the
--   `staff-photos` Supabase Storage bucket as a fallback). The
--   returned public URL is stored in the columns below.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================
-- (The frontend applies the frame on a canvas BEFORE uploading,
--  so the stored file is the framed image itself.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. SCHOOLS — school administrator's framed photo
-- ------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admin_photo_url TEXT;

-- ------------------------------------------------------------
-- 2. ACCOUNTANTS — accountant's framed photo
-- ------------------------------------------------------------
ALTER TABLE public.accountants
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ------------------------------------------------------------
-- 3. STAFF-PHOTOS STORAGE BUCKET (supabase-storage fallback)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-photos', 'staff-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to create the staff-photos bucket
-- (needed for the JS client-side auto-create fallback in utils.js)
DROP POLICY IF EXISTS "Allow authenticated to create staff-photos bucket" ON storage.buckets;
CREATE POLICY "Allow authenticated to create staff-photos bucket"
  ON storage.buckets FOR INSERT
  WITH CHECK (id = 'staff-photos' AND auth.role() = 'authenticated');

-- Anyone can view staff photos (avatar images are fully public)
DROP POLICY IF EXISTS "Anyone can view staff photos" ON storage.objects;
CREATE POLICY "Anyone can view staff photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'staff-photos');

-- Authenticated users (the registering admin/accountant) can upload
DROP POLICY IF EXISTS "Authenticated users can upload staff photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload staff photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'staff-photos' AND auth.role() = 'authenticated');

-- Authenticated users can update/delete objects in staff-photos bucket
DROP POLICY IF EXISTS "Authenticated users can manage staff photos" ON storage.objects;
CREATE POLICY "Authenticated users can manage staff photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'staff-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete staff photos" ON storage.objects;
CREATE POLICY "Authenticated users can delete staff photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'staff-photos' AND auth.role() = 'authenticated');

-- ============================================================
--  DEPLOYMENT COMPLETE
--  ============================================================
--  After running:
--   1. schools.admin_photo_url stores the admin's framed photo URL.
--   2. accountants.photo_url stores the accountant's framed photo URL.
--   3. The `staff-photos` bucket accepts authenticated uploads and
--      serves them publicly.
-- ============================================================