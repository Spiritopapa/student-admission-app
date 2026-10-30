-- ============================================================
-- 095 - Data API Table Grants (Supabase PostgREST / supabase-js)
-- ============================================================
-- Supabase will stop automatically granting Data API access to
-- new tables in the "public" schema from 30 Oct 2026 onward.
-- Existing tables are unaffected, but any schema recreation
-- (preview branches, `supabase db reset`, new projects) needs
-- explicit GRANTs or the API returns "permission denied".
--
-- This migration adds explicit GRANTs for every table in the
-- public schema so the Data API keeps working after a fresh
-- schema deployment.
--
-- Grant model (RLS policies still control which rows are visible):
--   authenticated   -> SELECT, INSERT, UPDATE, DELETE on all tables
--   service_role    -> ALL on all tables (server-side, bypasses RLS)
--   anon            -> SELECT only on tables with public read access
-- ============================================================

-- -----------------------------------------------------------
-- 1. Authenticated users: full CRUD on every table.
--    RLS policies (already defined in each migration) restrict
--    which rows each role can actually read/write.
-- -----------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
ON
  public.schools,
  public.profiles,
  public.sub_admins,
  public.parent_links,
  public.applications,
  public.teachers,
  public.accountants,
  public.classes,
  public.subjects,
  public.exams,
  public.exam_results,
  public.exam_subjects,
  public.exam_student_details,
  public.announcements,
  public.attendance,
  public.settings,
  public.sub_admin_activities,
  public.modules,
  public.sub_admin_modules,
  public.school_modules,
  public.school_settings,
  public.grading_systems,
  public.teacher_classes_subjects,
  public.teacher_documents,
  public.fee_categories,
  public.class_fees,
  public.fees,
  public.payment_transactions,
  public.receipts,
  public.password_reset_otps,
  public.income_expense_categories,
  public.income_expenses,
  public.assessment_questions,
  public.assessments,
  public.assessment_attempts,
  public.school_applications,
  public.staff_activities,
  public.support_reports,
  public.admission_items,
  public.transport_routes,
  public.transport_enrollments,
  public.transport_fee_payments,
  public.transport_collector_routes,
  public.class_subjects,
  public.attendance_event_days,
  public.student_activities,
  public.fee_payment_allocations,
  public.staff_payslips,
  public.staff_salary_setup,
  public.timetable_entries,
  public.sms_logs
TO authenticated;

-- -----------------------------------------------------------
-- 2. Service role: ALL privileges on every table.
--    Used by server-side Vercel API functions; bypasses RLS.
-- -----------------------------------------------------------
GRANT ALL
ON
  public.schools,
  public.profiles,
  public.sub_admins,
  public.parent_links,
  public.applications,
  public.teachers,
  public.accountants,
  public.classes,
  public.subjects,
  public.exams,
  public.exam_results,
  public.exam_subjects,
  public.exam_student_details,
  public.announcements,
  public.attendance,
  public.settings,
  public.sub_admin_activities,
  public.modules,
  public.sub_admin_modules,
  public.school_modules,
  public.school_settings,
  public.grading_systems,
  public.teacher_classes_subjects,
  public.teacher_documents,
  public.fee_categories,
  public.class_fees,
  public.fees,
  public.payment_transactions,
  public.receipts,
  public.password_reset_otps,
  public.income_expense_categories,
  public.income_expenses,
  public.assessment_questions,
  public.assessments,
  public.assessment_attempts,
  public.school_applications,
  public.staff_activities,
  public.support_reports,
  public.admission_items,
  public.transport_routes,
  public.transport_enrollments,
  public.transport_fee_payments,
  public.transport_collector_routes,
  public.class_subjects,
  public.attendance_event_days,
  public.student_activities,
  public.fee_payment_allocations,
  public.staff_payslips,
  public.staff_salary_setup,
  public.timetable_entries,
  public.sms_logs
TO service_role;

-- -----------------------------------------------------------
-- 3. Anon (unauthenticated): SELECT only on tables that have
--    a public read policy (USING (true)). Currently only:
--      public.schools  -> "Anyone can check school ID"
--    All other tables require authentication via RLS.
-- -----------------------------------------------------------
GRANT SELECT
ON
  public.schools
TO anon;

-- ============================================================
--  DEPLOYMENT COMPLETE
-- ============================================================
-- After running this migration, new tables added in later
-- migrations should include their own GRANT statements in the
-- same migration file (per Supabase's recommendation).
-- ============================================================
