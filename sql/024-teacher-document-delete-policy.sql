-- ============================================================
--  Student Admission Portal — Teacher Document Delete Policies
--  ============================================================
--  BUG: Teachers can upload new PDF files (certificate /
--  appointment letter) but the OLD files are never deleted.
--
--  ROOT CAUSE:
--  ------------------------------------------------------------
--  01. `teacher_documents` table has SELECT + INSERT policies
--      for teachers ("Teachers view own documents" and
--      "Teachers upload own documents") but NO DELETE policy.
--      When `deleteOldTeacherDocuments()` runs
--      `supabase.from('teacher_documents').delete()`, RLS
--      blocks it → old database records remain.
--
--  02. `storage.objects` for the `teacher-documents` bucket has
--      SELECT + INSERT policies but NO DELETE policy.
--      When `supabase.storage.from('teacher-documents').remove()`
--      runs, RLS blocks it → old storage files remain.
--
--  HOW THIS FIX WORKS:
--  ------------------------------------------------------------
--  A. Adds a DELETE policy on `teacher_documents` so a teacher
--     can delete their OWN document records (verified via the
--     teachers table user_id = auth.uid()).
--
--  B. Adds a DELETE policy on `storage.objects` so authenticated
--     users can delete files from the `teacher-documents` bucket.
--
--  HOW TO APPLY:
--  Run this file in Supabase SQL Editor (or via 000-run-all.sql).
-- ============================================================

-- ************************************************************
-- SECTION 1: TEACHER_DOCUMENTS DELETE POLICY
-- ************************************************************

-- Teachers can delete their own document records
DROP POLICY IF EXISTS "Teachers delete own documents" ON public.teacher_documents;

CREATE POLICY "Teachers delete own documents"
  ON public.teacher_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_documents.teacher_id
      AND t.user_id = auth.uid()
    )
  );

-- ************************************************************
-- SECTION 2: STORAGE DELETE POLICY
-- ************************************************************

-- Authenticated users can delete files from the teacher-documents bucket
DROP POLICY IF EXISTS "Authenticated users can delete teacher documents" ON storage.objects;

CREATE POLICY "Authenticated users can delete teacher documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'teacher-documents' AND auth.role() = 'authenticated'
  );

-- ============================================================
--  DEPLOYMENT COMPLETE
--  ============================================================
--  After running:
--   1. Teachers can delete their own document records from
--      the `teacher_documents` table.
--   2. Authenticated users can delete files from the
--      `teacher-documents` storage bucket.
--   3. The `deleteOldTeacherDocuments()` function in
--      teacher-dashboard.js will now successfully remove old
--      PDF files when a new one is uploaded.
-- ============================================================