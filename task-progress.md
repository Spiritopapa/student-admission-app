# Web-to-APK Wrapper Fixes — Font Size + Navigation Smoothness

## Problem
When the app is wrapped into an Android APK (WebView), text rendered much
larger than expected and navigation/page moves were not smooth (stutter/jank).

## Root causes
1. **Oversized text** — Android WebView auto-inflates text / applies device
   font-scale inside wrappers, even with a viewport meta present.
2. **Janky navigation** — `scrollTo({ behavior:'smooth' })`, multi-property
   page transitions (translate + scale + blur), staggered card-entrance
   delays and continuous decorative blob animations are heavy in WebView.

## Fixes
- `index.html` (head): viewport meta is locked (`maximum-scale=1.0`,
  `user-scalable=no`) **only when the inline detector finds a WebView**
  (APK). Normal mobile browsers keep pinch-to-zoom.
- `css/webview.css` (+section 20):
  - `html.webview-mode { font-size: 15px !important }` (14px on ≤380px)
    plus `text-size-adjust: 100% !important`.
  - Page swaps → quick opacity-only fade (0.16s), no translate/scale/blur.
  - Zeroed staggered `.dash-overview-card` delays; charts fade in instantly.
  - Decorative animations (`.home-blob`, `.login-blob`, `.glow-pulse`,
    `.float-anim`, `.login-water-ripple`) disabled in WebView mode.
  - `will-change` reduced to `auto` on chart fills.
- `js/modules/navigation.js`:
  - New `patchWebViewScroll()` — when `html.webview-mode` is set, patches
    `window.scrollTo` and `Element.prototype.scrollIntoView` so every
    programmatic scroll is instant (no smooth-scroll lag) in the wrapper.
  - `showPage()` scrolls to top instantly.
- `attendance-report.html`, `edit-student.html`, `verify-receipt.html`:
  locked viewport meta + `text-size-adjust` + smaller 15px mobile root font.

## Verification
- `node --check` passes for `navigation.js`.
- CSS brace balance verified for `webview.css` / `base.css`.
- WebView-only rules are gated on `.webview-mode` so browser behaviour is
  unchanged except instant top-scroll on page change.

---

# Accountant Dashboard - Student Loading Fix

## Issue Analysis
The accountant dashboard fails to load student-related data due to multiple bugs:

1. **Broken `!inner` join queries** - `loadClassFeeSummary()` and `showAccountantDebtors()` use `!inner` join syntax to join `fees` with `applications`, but no FK relationship exists between `fees.student_id` (TEXT) and `applications.student_id` (TEXT) 
2. **Non-existent RPC `get_student_id_join`** - Called in `loadClassFeeSummary()` line 183, this RPC doesn't exist in the database, causing the query to return empty results
3. **Unused first query in `loadClassFeeSummary`** - Line 179-183 executes a query but never uses its result

## Fix Plan
- [x] Read accountant-dashboard.js code
- [x] Examine index.html for accountant dashboard structure  
- [x] Read app.js, utils.js, auth.js for full flow understanding
- [x] Read SQL schema files for RLS and FK relationships
- [x] Identify why students don't load - found the root causes
- [x] Fix broken join queries in loadClassFeeSummary() and showAccountantDebtors()
- [x] Remove non-existent RPC call
- [x] Remove dead code from unused first query
- [x] Verify fix

## Fix Summary

### 1. Replaced `loadClassFeeSummary()` with `loadAccClassSummary()`
The old function used a broken `!inner` join between `fees` and `applications` plus a non-existent RPC call. The new function:
- Queries `applications` and `fees` separately (no join needed)
- Builds class-level aggregates in JavaScript

- Displays total fees, collected, outstanding, student count, and collection percentage per class

### 2. Replaced `showAccountantDebtors()` with `loadAccDebtorsData()`
The old function used a broken `!inner` join. The new function:
- Queries `fees` with `balance > 0` directly
- Fetches student names separately via `applications` table
- Groups debtors by student and displays outstanding details

### 3. Removed non-existent RPC call
The `get_student_id_join` RPC call has been completely removed.

### 4. Removed dead code
The unused first query in the old `loadClassFeeSummary()` has been eliminated.

### 5. Verified remaining `!inner` joins are valid
- `payment_transactions.student_id` → FK to `applications(student_id)` ✓ (015-fees-management.sql line 120)
- `attendance.student_id` → FK to `applications(student_id)` ✓ (006-communication-attendance.sql line 53)
# Multi-Choice Assessments Module (Self-Marking, Randomized per Student)

## Overview
A comprehensive auto-marking multiple-choice assessment module. Teachers/admins bulk-import thousands of questions, configure "papers" that draw a random subset, and students take them with a randomized question/option arrangement. Grading is computed server-side.

## Files added / changed
- `sql/040-assessments.sql` (new migration, registered in 000-run-all.sql):
  - Tables: `assessment_questions`, `assessments`, `assessment_attempts` (+ RLS).
  - SECURITY DEFINER RPCs: `start_assessment_attempt`, `submit_assessment_attempt`, `get_my_assessment_summaries`, `get_my_assessment_review`.
  - Registers the `assessments` module (for school lock/unlock).
- `js/modules/assessment-shared.js` (new): bulk parser, chunked insert, template download, html escaping.
- `js/modules/admin-assessments.js` (new): question bank CRUD, bulk CSV/paste import, assessment papers, attempts table.
- `js/modules/teacher-assessments.js` (new): teacher-scoped question bank + assessments + results.
- `js/modules/assessment-taking.js` (new): student list, randomized taking UI with timer, submit + review.
- `js/app.js`: registered init/setup + admin `assessments` route.
- `js/modules/student-dashboard.js` / `teacher-dashboard.js`: added `assessments` nav/subpage wiring.
- `index.html`: admin page, teacher subpage, student subpage, nav links; `css/assessments.css` linked.

## Anti-cheating design
- Randomization is done server-side in `start_assessment_attempt` (random subset + optional shuffle). Correct answers are never sent to the student's browser.
- Each student gets ONE fixed snapshot per assessment (resuming re-uses it; re-entering cannot re-randomize).
- Students have NO direct SELECT on `assessment_questions` or the full `assessment_attempts` (which holds answers). They access own data only via the secure RPCs.
- Grading happens server-side on submit.

---

# Class-Subject Consistency — Admin Assignments vs Teacher Dashboard

## Problem
Admin-per-class subject assignments did not match what teachers saw on their dashboard.
`getTeacherClasses()` returned subjects as a flat **union across all classes**, so a
teacher assigned English & Maths in JHS 1 and Science in JHS 2 saw all three subjects
for every class filter. There was also no canonical admin UI to define "subjects of a class".

## Fix / redesign
- **`sql/069-class-subjects-canonical.sql` (new migration, registered in `000-run-all.sql`):**
  new `public.class_subjects` table = single source of truth for class → subjects.
  Backfills from `teacher_classes_subjects` and `exam_subjects` so existing data is preserved.
- **`js/modules/admin-subjects.js` + `index.html`:** new "Assign Subjects to Classes"
  section (class + subject selects, add/remove table) so the admin configures subjects
  per selected class once.
- **`js/modules/admin-teachers.js`:** per-class subject pickers in the Add/Edit Staff form
  now offer only subjects from `class_subjects` for that class (global-list fallback when
  the class has no mapping, so legacy data is not blocked).
- **`js/modules/admin-exams.js`:** "Add Subject to Exam" dropdown is scoped to the selected
  class's `class_subjects` and excludes already-added subjects; refreshes after adding.
- **`js/modules/teacher-dashboard.js`:** `getTeacherClasses()` now returns a `subjectByClass`
  map; the exam subject filter is re-scoped whenever the exam/class filter changes, and
  `loadTeacherExamStudents()` intersects the exam's subjects for the class with the
  teacher's subjects **for that class**. Filter JHS 1 → English & Mathematics; JHS 2 → Science.
- **`js/modules/realtime.js` / `js/modules/backup-restore.js`:** class-subject UI refresh on
  realtime updates; `class_subjects` included in school backups.

## Verification
- Proper ES-module syntax check (`node --check` on `.mjs` copies) passes for all edited modules.
- Full flow reviewed end-to-end in `loadTeacherExamStudents` (class-scoped intersection
  drives both the subject dropdown and the score-sheet columns).

---

# Teacher Exam Sheet — Per-Class Subjects + Per-Student Save/Delete

## Round 2 (per-student actions)
- **`js/modules/teacher-dashboard.js`:** added an `Action` column to the teacher score
  sheet with per-student **Save** and **Delete Scores** buttons.
  - `saveTeacherStudentScores(studentId)` → `persistTeacherExamScores([studentId], false)`
    reuses the Save-All persistence logic but updates only that row's action cell, so
    unsaved input in other rows is never lost.
  - `deleteTeacherStudentScores(studentId)` deletes the student's `exam_results` for the
    exam and their `exam_student_details`, with confirmation, then updates the row in place.
  - `renderTeacherScoreSheet` refactored to build the sheet from a reusable
    `buildTeacherRowActions / updateTeacherRowActions` pair.

## Round 3 (All Classes = subjects per class + staff quick-form fix)
- **Teacher dashboard "All Classes" mode now loads subjects separately per class:**
  - `loadTeacherExamStudents` queries `exam_subjects` with `class_name` and builds a
    `subjectsByClass` map (`{ 'JHS 1': ['English','Mathematics'], 'JHS 2': ['Science'] }`)
    from (exam subjects for that class ∩ teacher's subjects for that class).
  - `renderTeacherScoreSheet` groups students by class; each class gets its own block
    (tbody) with its own subject columns. `persistTeacherExamScores`, `autoRankTeacherSubjects`
    and `printTeacherReportCards` are all class-aware now.
- **Staff quick-create ("Generate ID") form supports separate subjects per class:**
  - `index.html` replaced the single global subject multi-select with
    `#newTeacherClassSubjects`; `admin-teachers.js` adds `renderNewTeacherClassSubjectBlocks`
    so each selected class gets its own (initially empty) subject picker scoped to that
    class. `saveNewTeacher` now collects `subjectsByClass` per class, so
    JHS 1 → English/Maths/Science and JHS 2 → Mathematics stay independent.

## Verification
- ES-module syntax checks pass for `teacher-dashboard.js` and `admin-teachers.js`.
- No schema change needed for these rounds (frontend-only refinements).

---

# Staff Photo on the Teacher Sidebar

- **`js/modules/teacher-dashboard.js`:** added `updateTeacherSidebarPhoto(photoUrl)`
  which injects the staff photo (`teachers.photo_url`) into the
  `#teacherSidebar .dash-avatar` circle (the existing `.dash-avatar img` CSS makes
  it a rounded cover-fit thumbnail; the default icon fallback stays when no photo).
  - Called in `loadTeacherDashboard` so the photo appears every time a teacher logs in.
  - Called again in `saveTeacherProfile` so the sidebar updates immediately after the
    teacher uploads a new photo from "My Profile".
- Admin and accountant sidebars already show their staff photos; teacher was the gap.

---

# Teacher Profile Cleanup + Sidebar Photo Hover

## 1. Change Password separated from profile fields
- **`index.html`:** removed the New Password / Confirm New Password fields from
  `teacherProfileForm` and added a dedicated collapsible **"Change Password"** section
  (`#teacherPasswordSection` / `#teacherPasswordForm`) below the profile form, with its
  own message area (`#teacherPasswordMessage`).
- **`js/modules/teacher-dashboard.js`:**
  - Added `changeTeacherPassword(e)` — validates (min 6 chars, matching), calls
    `supabaseClient.auth.updateUser({ password })`, clears the fields, collapses the
    section, and logs the activity.
  - Registered the new `teacherPasswordForm` submit listener in `setupTeacherDashboard`.
  - Removed all password handling from `saveTeacherProfile` (reads, `updateUser`, field
    clearing) so saving profile details never touches the password and vice versa.

## 2. Hover-to-zoom on the sidebar staff photo
- **`css/components.css`:** added
  `#teacherSidebar .dash-avatar img { transition ... }` and
  `#teacherSidebar .dash-avatar:hover img { transform: scale(1.06); box-shadow ... }`,
  mirroring the existing admin sidebar hover zoom (only affects the photo when uploaded).

---

# Mobile Fix — Subject Names on Teacher Score Entry Cards

## Problem
On mobile view, the teacher exam score sheet stacked into cards but **no subject names
showed** next to each score. Root cause: mobile labels come from `td[data-label]`
(via `.app-table td::before { content: attr(data-label) }`), and `applyTableLabels()`
only sets `data-label` when the table has a `<thead>`. The teacher score table no
longer has a `<thead>` (per-class headers are rendered as `<tbody>` group rows), so
`applyTableLabels()` returned early and no subject labels were ever attached.

## Fix
- **`js/modules/teacher-dashboard.js` (`renderTeacherScoreSheet`):** every score cell
  now renders an explicit
  `data-label="${sub} (Class/Exam)"` plus `data-label` on Student ID / Name / Class /
  Action, so each mobile card identifies its subject (e.g. "ENGLISH (CLASS/EXAM)").
- **`css/components.css`:** inside the `@media (max-width: 768px)` stacked-card block,
  hide the redundant `.teacher-class-group-head` row per class — each student card now
  labels its own subjects, so the header row is no longer needed on mobile.

---

# Teacher Exams — Search Bar for Students

## Goal
Quickly find a student in the loaded exam score sheet by name or ID.

## Changes
- **`index.html`:** added a search input (`#teacherExamSearch`, "Search student by name
  or ID...") plus a live counter (`#teacherExamSearchCount`) in the exams module toolbar,
  above the score table.
- **`js/modules/teacher-dashboard.js`:**
  - `filterTeacherExamStudents()` — filters the loaded sheet **on the live DOM**
    (hides/shows `tr[data-student-id]` rows and their whole class group), so unsaved
    typed scores are never re-rendered or lost. Matches name or student ID (case-insensitive).
  - `updateTeacherExamSearchCount()` — shows "X / Y student(s) shown".
  - Search input listener wired in `setupTeacherDashboard`; the search box resets when a
    new sheet is loaded or the exams page is opened, and the counter updates after render.
---

# Settings Module Lock — Hide Settings-Dependent UI (Term Fees on Admit Form)

## Problem
1. The `settings` module was registered as a **core** module
   (`sql/061-admission-settings.sql`, `is_core = true`), so the Super Admin
   module manager **disables its Lock/Unlock toggle** — Settings could never
   actually be locked per school.
2. Even when a module is locked, only the module's **own** sidebar item /
   page section was hidden. The admit "Add Student" form's **Term Fees
   (Class Fee + Additional Items)** block — sourced from the Settings module
   (Admission Items) and the Fees module (class-fee structure) — stayed
   visible, so "settings" data leaked into the student-admission flow.

## Fixes
- **`sql/070-settings-module-lock.sql`** (new, wired into `sql/000-run-all.sql`):]
   flips `public.modules.is_core` to `false` for `'settings'` so the Super
   Admin can lock/unlock it per school like every other non-core module.

- **`js/app.js`** (`filterAdminSidebarByLockedModules`)::
   added `LOCKED_MODULE_DEPENDENT_SECTIONS` — when `settings` or `fees` is
   locked, the `#admitTermFeesSection` block on the **Admit Student** page is
   hidden too (alongside the existing sidebar/page hiding),and reset when
   unlocked. This pattern generalizes easily to any other cross-page dependency..

- **`index.html`** — the Admit form's Term Fees `<details>` block now carries
   `id="admitTermFeesSection"`.

- **`js/modules/admin-students.js`** (admit submit)::
   when the Term Fees block is hidden because Settings/Fees is locked, NO fee
   record is created and NO fee charges appear — `includeFees:false` is passed
   to the generated Admission Form..

- **`js/modules/admission-form.js`** — supports `includeFees`; when `false`,
   the printed Admission Form omits the Term Fees table and fee note..

## Audit — other lock modules' dependencies
- **fees** → admit form Term Fees block hidden ✔ (now, along with Fees page + dashboard fee widgets already gated).
- **settings** → Settings page hidden ✔ + admit form Term Fees block hidden ✔ (now).
- **transport** → own page hidden ✔; dashboard today-transport widget already
   gated by `admin-dashboard.js` `fetchLockedModules()` ✔; no admit-form dep..
- **students / teachers / accountants / parents / announcements / attendance /
   exams / assessments / income-expenses / sms-monitoring** → each owns a page
   that is already hidden when locked ✔; adopt form has no other cross-page deps..
- Edit-student forms (inline + `edit-student.html` popup) contain no fee
   fields, so nothing settings-related to hide there. ✔
---

# Backup & Restore Added to the Super Admin Module Lock System

## What changed
- **`sql/071-backup-module.sql`** (new, wired into `sql/000-run-all.sql` as
  Step 64): registers a **non-core** `backup` module
  (`('backup', 'Backup & Restore', '', false, 14)`).
  Because it's non-core, the Super Admin module manager
  (`get_school_module_status` → `renderModuleToggles`) now shows an
  **enabled Lock/Unlock toggle** for "Backup & Restore" per school.
- No front-end code changes were required: `filterAdminSidebarByLockedModules()`
  already hides any `[data-admin-page]` sidebar button and matching
  `page-admin-*` section generically, so locking `backup` hides the "Backup &
  Restore" sidebar item and the `page-admin-backup` page automatically.
  (The mobile admin dock does not include a Backup chip, and nothing else
  references the Backup page, so there are no dependent sections to hide.)

## Notes
- Apply the migration (`sql/071-backup-module.sql`) to existing databases;
  `sql/000-run-all.sql` includes it for fresh installs.
- Locking Backup & Restore only affects the school admin/sub-admin sidebar —
  it does not touch the actual stored data, matching every other module lock.
---

# Admin Dashboard — Staff Card (Teaching / Non-Teaching)

## What changed
- **`js/modules/admin-dashboard.js`** (`renderDashboard`): added a **Staff**
  overview card (large total count + a sub-line `Teaching X · Non-Teaching Y`)
  to the dashboard overview cards row, gated on `showTeachers` (so it
  disappears when the Super Admin locks the teachers module — mirroring
  `fetchTeachers()` which already skips loading when locked).
- **`animateDashboardCounters`:** added the Staff total to the animated counters
  and populates the teaching / non-teaching split from `teachers.staff_type`
  (`'non_teaching'` vs everything else, matching the Staff module's display logic).

## Notes
- "Staff" in this app = the `teachers` table (the sidebar "Staff" module);
  `staff_type` values are `'teaching'` / `'non_teaching'` (`sql/050-teacher-staff-type.sql`), so the card counts those. Accountants remain a separate module/page.
# Module-Lock Audit — No Locked-Module Features Reappear on the Admin Dashboard

## Problem
Auditing the Super Admin module-lock feature (`school_modules` → school
admin dashboard) found three inconsistencies where a locked module's
features could still reappear on the admin dashboard home:

1. **`attendance` was not gated at all.** The "Today's Attendance by Class"
   card was always rendered and `fetchTodayAttendance()` always queried the
   `attendance` table even though `attendance` is a **non-core (lockable)**
   module.
2. **Student overview stat cards were never hidden.** The Total Students /
   Admitted / Awaiting / Female / Male / Portal Confirmed cards always
   rendered even though `renderDashboard()` already computed `showStudents`
   ("core module, but check anyway") and used it to hide the population
   chart + recent-students list. Inconsistent defense-in-depth.
3. **Realtime activity feed leaked locked-module events.** When data changed
   in a locked module's table (`fees`, `payment_transactions`,
   `announcements`, `exam_results`, `exam_student_details`, `attendance`,
   `teachers`, `teacher_classes_subjects`), the dashboard's activity feed
   still logged entries like "New fee record", "Payment received", "New
   announcement", "Exam score added", etc., and triggered a refresh.

## Fixes — `js/modules/admin-dashboard.js`
- **`fetchTodayAttendance()`**: now skips the query when `attendance` is
  locked (mirrors `fetchFees` / `fetchTransportToday` / `fetchTeachers` /
  `fetchAnnouncements`).
- **`renderDashboard()`**:
  - Added `const showAttendance = !lockedModules.has('attendance')` and
    wrapped the "Today's Attendance by Class" card in
    `${showAttendance ? ... : ''}`.
  - Wrapped the six student overview stat cards in `${showStudents ? ... : ''}`
    for consistency with the existing student chart/list gating.
- **`handleRealtimeEvent()`**: added a `TABLE_MODULE` map; events from tables
  owned by a module that is locked for the school are now ignored entirely
  (no activity-feed entry, no dashboard refresh).

Consistency confirmed elsewhere (no change needed):
- Super Admin per-school list/stat filtering (`super-admin.js`
  `getAllLockedModules` / `isModuleLocked`) and `toggleSchoolModuleLock` →
  `clearLockedModulesCache`.
- Admin sidebar + dependent sections (`js/app.js`
  `filterAdminSidebarByLockedModules`, incl. the admit-form Term Fees block).
- Mobile admin dock chips (`js/modules/navigation.js` `refreshAdminDockLocks`).

## Verification
- `node --check js/modules/admin-dashboard.js` passes (exit 0).
- Locked-module widgets (fees, announcements, attendance, transport,
  teachers, students) are now hidden from the admin dashboard home; the
  gating also survives the 30s polling and realtime refresh paths because
  `fetchLockedModules()` is re-run before each render.