-- ============================================================
--  Student Admission Portal — Complete Schema Runner
--  Run this file in Supabase SQL Editor to execute ALL schema files
--  in the correct dependency order.
-- ============================================================
--  Usage: Copy and paste the entire content into Supabase SQL Editor
--  or run: psql -f 000-run-all.sql
-- ============================================================

-- ============================================================
--  EXECUTION ORDER (files are numbered for clarity):
-- ============================================================
--  001 - Helper Functions (must be first - used by RLS policies)
--  002 - Core Entities (schools, profiles, sub_admins, parent_links)
--  003 - Academic Entities (applications, teachers, accountants, classes, subjects)
--  004 - Exam Entities (exams, exam_results, exam_subjects, exam_student_details)
--  006 - Communication & Attendance (announcements, attendance)
--  007 - Settings & Permissions (settings, sub_admin_activities, modules, sub_admin_modules)
--  008 - Triggers (updated_at, auto-set school_id)
--  009 - Functions (ID generation, check, link, utility functions)
--  010 - Storage & Indexes (storage bucket, global indexes)
-- ============================================================

-- ============================================================
--  TABLE REFERENCE (29 tables total):
-- ============================================================
--  1.  schools               - School registrations
--  2.  profiles              - User profiles with roles
--  3.  sub_admins            - Sub admin records
--  4.  parent_links          - Parent-student relationships
--  5.  applications          - Student applications/admissions
--  6.  teachers              - Teacher records
--  7.  accountants           - Accountant records
--  8.  announcements         - School announcements
--  12. exams                 - Exam schedules
--  13. exam_results          - Student exam scores
--  14. exam_subjects         - Subjects per exam
--  15. exam_student_details  - Student exam details (attitude, remarks)
--  16. classes               - Class definitions
--  17. subjects              - Subject definitions
--  18. settings              - School settings
--  19. attendance            - Student attendance records
--  20. sub_admin_activities  - Sub admin activity logs
--  21. modules               - System modules
--  22. sub_admin_modules     - Sub admin module permissions
--  23. school_modules         - Per-school module lock/unlock
--  24. teacher_classes_subjects - Teacher multiple class-subject assignments
--  25. fee_categories        - Fee categories (Tuition, PTA, etc.)
--  26. class_fees            - Fee structure per class/term
--  27. fees                  - Per-student fee records per term
--  28. payment_transactions  - Individual payment records
--  29. receipts              - Stored receipts with JSONB data
-- ============================================================

-- ============================================================
--  ROLES (7 roles):
-- ============================================================
--  super_admin | admin | sub_admin | teacher | student | parent | accountant
-- ============================================================

-- ============================================================
--  BEGIN EXECUTION
-- ============================================================

-- Step 1: Helper Functions (RLS dependencies)
\i 001-helper-functions.sql

-- Step 2: Core Entities
\i 002-core-entities.sql

-- Step 3: Academic Entities
\i 003-academic-entities.sql

-- Step 4: Exam Entities
\i 004-exam-entities.sql

-- Step 6: Communication & Attendance
\i 006-communication-attendance.sql

-- Step 7: Settings & Permissions (settings, sub_admin_activities, modules, sub_admin_modules)
\i 007-settings-permissions.sql

-- Step 8: Triggers
\i 008-triggers.sql

-- Step 9: Functions
\i 009-functions.sql

-- Step 10: Storage & Indexes
\i 010-storage-indexes.sql

-- Step 11: School Module Permissions
\i 011-school-modules.sql

-- Step 12: Grading Systems (per-school configurable grading)
\i 013-grading-systems.sql

-- Step 13: Teacher Multi Class-Subject Assignments
\i 014-teacher-class-subjects.sql

-- Step 14: Fees Management Module (broad spectrum fee management with 3-term support)
-- Includes: fee_categories, class_fees, fees, payment_transactions, receipts tables
-- Includes: process_fee_payment (with overpayment carry-forward), carry_forward_balance,
--           promote_student_fees, get_student_fee_summary, apply_overpaid_credit functions
\i 015-fees-management.sql

-- Step 15: Complete Student Deletion (atomic cascade delete for all student-related data)
-- Creates: delete_student_completely() function
-- Deletes from: parent_links, attendance, exam_student_details, exam_results,
--               payment_transactions, receipts, fees, applications, profiles, auth.users
\i 019-delete-student-cascade.sql

-- Step 16: School Name Auto-Fix (creates settings + school_settings for every school)
-- Creates: create_school_settings() trigger function + trg_create_school_settings trigger
--          sync_school_settings_on_update() trigger function + trg_sync_school_settings trigger
-- Backfills: settings and school_settings rows for all existing schools
\i 021-school-name-autofix.sql

-- Step 17: Registration Self-Claim Fix (teacher/accountant login lockout fix)
-- Fixes: link_teacher_to_user / link_accountant_to_user to allow the registering
--        user to SELF-CLAIM their record (previous version only allowed staff).
-- Adds: RLS self-read-by-registration_id policies for unlinked teachers/accountants.
-- Adds: auto_approve_teacher_on_login / auto_approve_accountant_on_login self-heal
--       functions so pre-approved accounts can sign in immediately.
\i 022-registration-self-claim.sql

-- Step 18: Teacher Profile Fields (comprehensive teacher profile data)
-- Adds: photo, personal info, IDs, appointment dates, school info, rank/salary fields
-- Creates: teacher_documents table for file uploads (certificate, appointment letter)
-- Creates: teacher-documents storage bucket
-- Adds: calculate_age function + auto-calculate age trigger
-- Adds: check_staff_id_exists / get_teacher_info_by_staff_id for staff ID login
\i 023-teacher-profile-fields.sql

-- Step 19: Teacher Document Delete Policies (allow teachers to delete old PDF files)
-- Fixes: teacher_documents DELETE RLS policy (teachers can delete their own records)
-- Fixes: storage.objects DELETE policy for teacher-documents bucket
-- Enables: deleteOldTeacherDocuments() in teacher-dashboard.js to remove old files
\i 024-teacher-document-delete-policy.sql

-- Step 20: Module Lock Dashboard Filter (helper function for locked modules)
-- Creates: get_locked_modules_for_school() function
-- Used by: admin-dashboard.js and super-admin.js to filter dashboard data
--          when modules are locked for a school
\i 025-module-lock-dashboard-filter.sql

-- Step 21: Reset School Admin Password (super admin can reset school admin passwords)
-- Creates: reset_school_password() function
-- Used by: super-admin.js to reset a school admin's password to a custom password
--          when the school admin forgets their password
\i 026-reset-school-password.sql

-- Step 22: Accountant Name Lock (prevent accountants from changing their own name)
-- Creates: prevent_accountant_name_change() trigger on accountants table
--          prevent_accountant_profile_name_change() trigger on profiles table
-- Blocks:  Accountants from updating their own full_name after the admin
--          has generated an ID (registration_id) for them.
-- Admins/sub_admins/super_admins can still update accountant names.
\i 027-accountant-name-lock.sql

-- Step 23: School Logo Support (adds logo_url to school_settings and schools)
-- Adds: logo_url column to school_settings and schools tables
-- Used by: super-admin.js to upload school logos when creating schools
--          admin-dashboard.js, admin-exams.js, admin-fees.js, teacher-dashboard.js,
--          accountant-dashboard.js to display logos on sidebars, report cards,
--          receipts, debtors lists, and other documents
\i 028-school-logo.sql

-- Step 24: Additional Teacher Profile Fields (education, bank, and appointment info)
-- Adds: date_assumption_district, date_assumption_present_station, college_attended,
--       shs_attended, salary_level, bank_account_name, bank_account_number,
--       account_branch, home_town, area_of_specialization,
--       professional_qualification, academic_qualification columns to teachers table
-- Used by: teacher-dashboard.js and admin-teachers.js for comprehensive teacher profiles
\i 029-teacher-profile-additional-fields.sql

-- Step 25: Delete Receipts by Class & Date (admin fees module)
-- Creates: delete_receipts_by_class_date() function
-- Used by: admin-fees.js "Delete Receipts" tab to delete receipts for
--          students in a class within a date range, and recalculate
--          the affected fee records' amount_paid and payment_status
\i 030-delete-receipts-by-class-date.sql

-- Step 26: Income & Expenditure Tracking Module
-- Creates: income_expense_categories, income_expenses tables
-- Creates: seed_income_expense_categories(), auto_seed_income_expense_categories(),
--          get_ie_summary(), get_ie_category_breakdown() functions
-- Used by: accountant-dashboard.js and admin-dashboard.js "Income & Expenses"
--          tab for tracking school income and expenses with category
--          management and reports
\i 031-income-expenses.sql

-- Step 27: Income & Expense Module Registration
-- Registers the 'income-expenses' module in the modules table
-- so the Super Admin can lock/unlock it per school via the
-- Module Locks management UI
\i 032-income-expense-module-registration.sql

-- Step 28: Exam Subjects Class-Based Filtering
-- Adds class_name column to exam_subjects so each class can
-- have its own set of subjects for an exam
\i 033-exam-subjects-class-filter.sql

-- Step 29: School & Sub-Admin Self-Claim Fix
-- Fixes: link_school_to_user / link_sub_admin_to_user to allow the
--        registering user to SELF-CLAIM their record (previous version
--        only allowed super_admin for schools / school admin for sub-admins).
-- Adds: RLS self-read-by-registration_id policies for unlinked schools/sub_admins.
-- Adds: auto_approve_school_on_login / auto_approve_sub_admin_on_login self-heal
--       functions so previously unlinked accounts can sign in immediately.
\i 034-school-subadmin-self-claim-fix.sql

-- Step 30: Data Isolation Closure (audit-remediation)
-- Closes remaining public/cross-school leaks discovered in the security audit:
--   - schools table readable by anyone (anon directory leak)
--   - get_ie_summary / get_ie_category_breakdown callable by anon + any school
--   - config RPCs (get_school_grades, get_school_module_status, etc.) callable by anon
--   - get_teacher_info_by_staff_id leaking teacher PII
--   - delete_auth_user callable by anon
--   - auto_approve_* / link_* accepting an arbitrary p_user_id
--   - storage upload/delete scoped to the owning school
-- REQUIRES: auth.js uses get_school_registration_info RPC for school registration.
\i 035-data-isolation-closure.sql

-- Step 31: Receipt Public Verification Lookup (short QR support)
-- Creates: get_receipt_for_verification() SECURITY DEFINER function.
-- Used by: verify-receipt.html to fetch a full receipt by its short
--          receipt_number (the only data now encoded in the printed QR),
--          keeping the QR small/sparse so phone cameras scan it easily.
\i 036-receipt-verification-lookup.sql

-- Step 32: Receipt Secure Verification Tokens (unguessable QR URLs)
-- Adds a random per-receipt verification_token, a BEFORE INSERT trigger
-- so every receipt gets one, and redefines get_receipt_for_verification()
-- to resolve by that token (with legacy receipt_number fallback).
-- The printed QR now encodes ONLY the unguessable token.
\i 037-receipt-verification-token.sql

-- Step 33: Delete a Single Receipt (with payment reversal)
-- Creates: delete_receipt() SECURITY DEFINER function.
-- Used by: admin-fees.js per-student "Delete Receipt" button in the
--          Fees Management (Student Fees) table. Deletes one mistaken
--          receipt + its payment transaction and reverses the fee
--          payment (recalculates amount_paid and payment_status).
\i 038-delete-single-receipt.sql

-- Step 34: Admin Password Reset for Teachers, Accountants & Students
-- Creates: reset_teacher_password() / reset_accountant_password() /
--          reset_student_password() SECURITY DEFINER functions +
--          _admin_reset_user_password() internal helper.
-- Used by: admin-teachers.js, admin-accountants.js and admin-students.js
--          "🔑 Password" buttons (see #adminResetPasswordModal) so an
--          admin can reset a forgotten portal password to a custom one.
\i 039-reset-user-passwords.sql

-- Step 35: Multi-Choice Assessments Module
-- Creates: assessment_questions / assessments / assessment_attempts tables,
--          start_assessment_attempt / submit_assessment_attempt SECURITY
--          DEFINER RPCs (server-side randomized snapshots + grading), RLS
--          policies, and registers the 'assessments' module for lock control.
-- Used by: admin-assessments.js, teacher-assessments.js, assessment-taking.js
\i 040-assessments.sql

-- Step 36: Nalo Solutions SMS Gateway Logging
-- Creates: sms_logs table (audit trail for fee-payment SMS notifications)
--          with per-school RLS policies (staff manage, staff view).
-- Used by: js/modules/sms-gateway.js which sends a parent SMS the moment a
--          fee payment is recorded via the /api/send-sms Vercel function.
\i 041-sms-gateway.sql

-- Step 37: Forgot Password (SMS OTP via Nalo)
-- Creates: profiles.phone (canonical mobile per user, backfilled),
--          password_reset_otps table, and the public RPCs
--          lookup_forgot_password_account / request_forgot_password_otp /
--          verify_forgot_password_otp (granted to anon) so logged-out users
--          can reset their password via an SMS OTP sent through /api/send-sms.
-- Used by: js/modules/forgot-password.js (sign-in page modal).
\i 042-forgot-password.sql

-- Step 38: SMS Monitoring Module
-- Registers the 'sms-monitoring' module in the modules table so the
-- Super Admin can lock/unlock it per school via the Module Locks UI.
-- The module is read-only monitoring over the existing sms_logs table
-- (created in step 36), so no new tables are required.
-- Used by: js/modules/admin-sms-monitor.js (admin sidebar tab).
\i 043-sms-monitoring-module.sql

-- Step 39: School Onboarding & Initials-Based School ID
-- Adds: schools.admin_name / school_type / student_population /
--       location columns. Rewrites generate_school_id(TEXT) so the
--       school registration ID carries the school name initials
--       (SCH-<INIT>-NNNN). Adds save_school_onboarding_info() anon-safe
--       RPC used by the school-admin registration wizard to persist the
--       admin name / school type / location / population / email / mobile
--       (for password change) before the account is created.
-- Used by: js/modules/super-admin.js (generate school ID with name) and
--          js/modules/auth.js (multi-stage school registration wizard).
\i 044-school-onboarding.sql

-- Step 40: Per-School Receipt Numbers
-- Rewrites generate_receipt_number() so each school's receipts use a
-- unique series built from the school name initials
-- (e.g. "Sunshine International School" -> RCP-SIN-000001).
-- Also redefines process_fee_payment() to pass school_id so receipts
-- are scoped per school while the receipt_number column stays globally unique.
\i 045-per-school-receipts.sql

-- Step 41: Per-School Teacher & Accountant IDs
-- Rewrites generate_teacher_id() / generate_accountant_id() so each
-- school's teacher/accountant IDs carry the school name initials
-- (e.g. Sunshine International School -> TCH-SIN-0001 / ACC-SIN-0001)
-- while the registration_id column stays globally unique.
\i 046-per-school-staff-ids.sql

-- Step 42: Login / Forgot-Password ID format resolution
-- The per-school initials ID formats (SCH-SIS-0001 / TCH-SIN-0001 /
-- ACC-SIN-0001) were introduced in steps 39 & 41, but the sign-in and
-- password-reset resolvers still only matched the old SCH-0001 patterns,
-- so a brand-new-format admin/teacher/accountant ID returned HTTP 400
-- "Invalid login credentials". Re-defines _fp_resolve_login_user() so
-- the forgot-password flow accepts both formats. (js/modules/auth.js is
-- updated separately with the matching browser-side rule.)
\i 047-login-id-format-resolution.sql

-- Step 43: Complete Teacher & Accountant Deletion
-- Creates: delete_teacher_completely() / delete_accountant_completely()
-- Each atomically removes the staff record, child rows, the linked
-- profile AND the auth.users account (staff can no longer sign in).
-- Mirrors the student cascade (delete_student_completely) for staff.
-- Used by: js/modules/admin-teachers.js (deleteTeacher) and
--          js/modules/admin-accountants.js (deleteAccountant).
\i 048-delete-staff-completely.sql

-- Step 44: School Onboarding Persistence Fix
-- Re-defines save_school_onboarding_info() so the school's own linked admin
-- can re-persist the stage-3 onboarding details (admin name, school type,
-- location, population, email, mobile) even after the account exists, and
-- idempotently ensures the onboarding columns exist on the live DB.
-- Used by: js/modules/auth.js — the school registration wizard now re-saves
--          the onboarding info at the final "Register as School" submit, so
--          every school's provided info appears on the Super Admin dashboard.
\i 049-school-onboarding-persistence-fix.sql

-- Step 45: Staff Type (Teaching / Non-Teaching)
-- Adds: teachers.staff_type column so the admin Staff module can classify
--       staff members as 'teaching' or 'non_teaching'. Class/subject
--       assignment fields in the admin staff forms are shown for teaching
--       staff and dropped for non-teaching staff.
-- Used by: js/modules/admin-teachers.js (admin Staff Module) — the ID
--          generation flow and the Add/Edit staff form.
\i 050-teacher-staff-type.sql

-- Step 46: Staff Activity Log
-- Creates: staff_activities table (with RLS) so school admins can open a
--          '📋 Activity' button for each teacher & accountant and audit
--          login/logout, fee payments, income/expenditure, debtors list
--          generation, password changes, reprints, profile updates, exam
--          marks entry, attendance marking and assessment activity.
-- Used by: js/modules/utils.js (logStaffActivity), js/modules/admin-teachers.js
--          (viewTeacherActivities) and js/modules/admin-accountants.js
--          (viewAccountantActivities).
\i 051-staff-activity-log.sql

\i 052-attendance-present-absent-only.sql

-- Step 47: Clear Activity Logs (RLS DELETE policies)
-- Adds DELETE policies on staff_activities (teacher/accountant logs) and
-- sub_admin_activities so the '🗑️ Clear All Logs' button in the activity-log
-- modals can delete every log row for one user. Mirrors the existing SELECT
-- policies (super admin / school admin / the user themself). Safe to re-run.
-- Used by: js/modules/admin-teachers.js (clearStaffActivityLog),
--          js/modules/admin-accountants.js (shared clearStaffActivityLog),
--          js/modules/super-admin.js (clearSubAdminActivityLog).
\i 053-clear-activity-logs.sql

-- ============================================================
--  SCHEMA DEPLOYMENT COMPLETE
-- ============================================================
--  Next steps:
--  1. Create a super_admin user via the app
--  2. Register schools via super admin dashboard
--  3. School admins register sub_admins, teachers, accountants
--  4. Sub admins admit students and manage the school
-- ============================================================
--  OPTIONAL FIX SCRIPTS (run only if needed for existing data):
--  - 016-fix-missing-profiles.sql  - Backfill missing profile records
--  - 017-fix-settings-and-rls.sql  - Backfill missing settings & fix RLS
--  - 018-overpayment-handling.sql  - (Already merged into 015-fees-management.sql)
-- ============================================================