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