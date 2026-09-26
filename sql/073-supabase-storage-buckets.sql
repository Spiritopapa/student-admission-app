-- ============================================================
--  SchoolRunner — Supabase Storage Buckets
--  Migration 073
--
--  Replaces Cloudinary as the file storage layer. All photos and
--  documents are stored in dedicated public buckets:
--
--    student-photos   student / staff photos
--    applications     admission application photos (public form uploads)
--    school-logos     school logos
--    documents        teacher documents, scans and general files
--
--  Uploads are gated by storage.object RLS policies. Deletes are
--  intentionally NOT granted to the browser; the serverless function
--  /api/storage-delete removes files using the service role.
--  Safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('student-photos', 'student-photos', true),
  ('applications', 'applications', true),
  ('school-logos', 'school-logos', true),
  ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------
-- Authenticated users may upload into any app bucket.
-- ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users upload app files'
  ) THEN
    CREATE POLICY "Authenticated users upload app files"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id IN ('student-photos', 'applications', 'school-logos', 'documents')
        AND length(name) < 260
      );
  END IF;
END $$;

-- ---------------------------------------------------
-- Anonymous uploads only for the applications bucket
-- (needed so prospective students can attach a photo
-- to a public admission application). The unique random
-- path keeps objects unguessable.
-- ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Anon uploads to applications bucket'
  ) THEN
    CREATE POLICY "Anon uploads to applications bucket"
      ON storage.objects FOR INSERT
      TO anon
      WITH CHECK (
        bucket_id = 'applications'
        AND (storage.foldername(name))[1] = 'applications'
        AND length(name) < 260
      );
  END IF;
END $$;

-- ---------------------------------------------------
-- Public reads (needed for listing objects in the app)
-- ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read app files'
  ) THEN
    CREATE POLICY "Public read app files"
      ON storage.objects FOR SELECT
      USING (
        bucket_id IN ('student-photos', 'applications', 'school-logos', 'documents')
      );
  END IF;
END $$;