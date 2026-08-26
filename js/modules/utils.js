/**
 * Shared utilities for Student Admission Portal
 */

import { uploadToCloudinary, isCloudinaryReady } from './cloudinary.js';
// ================================================================
// DOM Helpers
// ================================================================

export function getEl(id) {
  return document.getElementById(id);
}

export function showMessage(elId, text, type = 'info') {
  const el = getEl(elId);
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

export function clearMessage(elId) {
  const el = getEl(elId);
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

export function setLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span> ' + (text || 'Loading...') : text;
}

// ================================================================
// School ID Helper - Ensures data isolation between schools
// ================================================================

let _cachedSchoolId = null;
let _cachedSchoolIdUser = null;
let _supabaseForSchoolId = null;

/**
 * Initialize the school ID helper with supabase client
 */
export function initSchoolIdHelper(supabase) {
  _supabaseForSchoolId = supabase;
}

/**
 * Get the current user's school_id from their profile.
 * Caches the result per-USER to avoid repeated lookups.
 *
 * CRITICAL SECURITY FIX: the cache is keyed by the authenticated user id so
 * that a previously signed-in user's school can NEVER be returned for a
 * different user (e.g. when sign-out doesn't clear the old cache on every
 * code path). This prevents one school's data from appearing in another
 * school's dashboard.
 */
export async function getCurrentSchoolId() {
  if (!_supabaseForSchoolId) return null;
  try {
    const { data: { user } } = await _supabaseForSchoolId.auth.getUser();
    if (!user) return null;
    // Only reuse the cache if it belongs to the CURRENT user
    if (_cachedSchoolId && _cachedSchoolIdUser === user.id) return _cachedSchoolId;

    const { data: profile } = await _supabaseForSchoolId.from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single();
    if (profile?.school_id) {
      _cachedSchoolId = profile.school_id;
      _cachedSchoolIdUser = user.id;
      return profile.school_id;
    }
    return null;
  } catch (err) {
    console.warn('Failed to get school_id:', err.message);
    return null;
  }
}

/**
 * Clear cached school_id (e.g., on logout)
 */
export function clearSchoolIdCache() {
  _cachedSchoolId = null;
  _cachedSchoolIdUser = null;
  _cachedSchoolInitials = null;
  _cachedSchoolInitialsSchool = null;
}

// ================================================================
// School initials - used to tag Cloudinary file names
// ================================================================

let _cachedSchoolInitials = null;
let _cachedSchoolInitialsSchool = null;

/**
 * Derive up to 3 uppercase initials from a school's name, mirroring the SQL
 * helper `school_initials(p_school_id)` in sql/046-per-school-staff-ids.sql.
 * e.g. "Sunshine International School" -> "SIS" ; unknown -> "SCH".
 */
export function getSchoolInitialsFromName(schoolName) {
  const clean = String(schoolName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ');
  const initials = clean
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
  return initials.slice(0, 3) || 'SCH';
}

/**
 * Resolve a school's initials from its id by reading the school name.
 * Caches the result per school id. Falls back to "SCH" when the lookup fails.
 */
export async function getSchoolInitials(schoolId) {
  if (!_supabaseForSchoolId || !schoolId) return 'SCH';
  if (_cachedSchoolInitials && _cachedSchoolInitialsSchool === schoolId) {
    return _cachedSchoolInitials;
  }
  try {
    let schoolName = null;
    // Prefer the per-school settings name, then the canonical schools.name.
    const { data: settings } = await _supabaseForSchoolId
      .from('school_settings')
      .select('school_name')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (settings?.school_name) {
      schoolName = settings.school_name;
    } else {
      const { data: school } = await _supabaseForSchoolId
        .from('schools')
        .select('name')
        .eq('id', schoolId)
        .maybeSingle();
      if (school?.name) schoolName = school.name;
    }
    const initials = getSchoolInitialsFromName(schoolName);
    _cachedSchoolInitials = initials;
    _cachedSchoolInitialsSchool = schoolId;
    return initials;
  } catch (err) {
    console.warn('Failed to resolve school initials:', err.message);
    return 'SCH';
  }
}

/**
 * Convenience wrapper returning the CURRENT user's school initials
 * (e.g. "SIS"), or "SCH" when no school is attached to the user.
 */
export async function getCurrentSchoolInitials() {
  const schoolId = await getCurrentSchoolId();
  return getSchoolInitials(schoolId);
}

// ================================================================
// Sub Admin Activity Logger
// ================================================================

let _supabaseForLogging = null;

export function initActivityLogger(supabase) {
  _supabaseForLogging = supabase;
}

/**
 * Log an activity performed by a sub admin.
 * Only logs if the current authenticated user has role 'sub_admin'.
 * @param {string} action - The action performed (e.g., "Created student", "Deleted fee record")
 * @param {string} entityType - The type of entity affected (e.g., "student", "fee", "class")
 * @param {string} entityDetails - Optional details about the entity (e.g., student name, ID, etc.)
 */
export async function logSubAdminActivity(action, entityType = 'general', entityDetails = null) {
  if (!_supabaseForLogging) return;
  try {
    const { data: { user } } = await _supabaseForLogging.auth.getUser();
    if (!user) return;

    // Check if the user is a sub_admin
    const { data: profile } = await _supabaseForLogging.from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'sub_admin') return;

    // Get the sub_admin record for this user
    const { data: subAdmin } = await _supabaseForLogging.from('sub_admins')
      .select('id, full_name, registration_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!subAdmin) return;

    // Insert the activity log
    await _supabaseForLogging.from('sub_admin_activities').insert([{
      sub_admin_id: subAdmin.id,
      sub_admin_name: subAdmin.full_name,
      registration_id: subAdmin.registration_id,
      action: action,
      entity_type: entityType,
      entity_details: entityDetails || null,
    }]);
  } catch (err) {
    console.warn('Failed to log sub admin activity:', err.message);
  }
}

/**
 * Log an activity performed by a logged-in teacher or accountant.
 * Resolves the current user's staff record from the teachers/accountants
 * tables (linked by user_id) and writes one row into `staff_activities`.
 *
 * Safe to call from anywhere: it silently returns unless the signed-in
 * user actually has a teacher/accountant record, so shared code (e.g. the
 * admin fees module used by both admin and accountant) can call it freely.
 *
 * @param {string} action - Human-readable action, e.g. "Recorded fee payment GH₵ 50"
 * @param {Object} [opts]
 * @param {string} [opts.role]       - Optional forced role ('teacher' | 'accountant').
 *                                     When omitted the profile table decides.
 * @param {string} [opts.entityType] - Optional category, e.g. 'payment', 'exam', 'attendance'
 * @param {string} [opts.entityDetails] - Optional detail string for the action
 */
export async function logStaffActivity(action, opts = {}) {
  if (!_supabaseForLogging) return;
  try {
    const { data: { user } } = await _supabaseForLogging.auth.getUser();
    if (!user) return;

    let role = opts.role || null;
    if (!role) {
      const { data: profile } = await _supabaseForLogging.from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      role = profile?.role || null;
    }
    if (role !== 'teacher' && role !== 'accountant') return;

    const table = role === 'teacher' ? 'teachers' : 'accountants';
    const { data: staff } = await _supabaseForLogging.from(table)
      .select('id, full_name, registration_id, school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!staff?.id) return;

    await _supabaseForLogging.from('staff_activities').insert([{
      school_id: staff.school_id || null,
      staff_id: staff.id,
      staff_type: role,
      staff_name: staff.full_name,
      staff_registration_id: staff.registration_id,
      action: action,
      entity_type: opts.entityType || 'general',
      entity_details: opts.entityDetails || null,
      performed_by_user_id: user.id,
    }]);
  } catch (err) {
    console.warn('Failed to log staff activity:', err.message);
  }
}

// ================================================================
// Term Helpers
// ================================================================

export function getNextTerm(term) {
  const terms = ['First', 'Second', 'Third'];
  const idx = terms.indexOf(term);
  return idx >= 0 && idx < 2 ? terms[idx + 1] : null;
}

export function getNextAcademicYear(currentYear) {
  if (!currentYear || !currentYear.includes('/')) {
    const y = new Date().getFullYear();
    return (y + 1) + '/' + (y + 2);
  }
  const parts = currentYear.split('/');
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  return (startYear + 1) + '/' + (endYear + 1);
}

export function getPrevAcademicYear(currentYear) {
  if (!currentYear || !currentYear.includes('/')) return '';
  const parts = currentYear.split('/');
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  return (startYear - 1) + '/' + (endYear - 1);
}

export function getTermDisplay(term) {
  const map = { 'First': 'First Term', 'Second': 'Second Term', 'Third': 'Third Term' };
  return map[term] || term;
}

export function getTermOrder() {
  return ['First', 'Second', 'Third'];
}

// ================================================================
// Academic Year Selector Generator
// ================================================================

/**
 * Generates HTML option elements for academic year select dropdowns.
 * Creates options from startYear to endYear in "YYYY/YYYY" format.
 * @param {number} startYear - The starting year (default: current year - 5)
 * @param {number} endYear - The ending year (default: current year + 20)
 * @param {string} selectedYear - The currently selected year to mark as selected
 * @returns {string} HTML option elements
 */
export function generateAcademicYearOptions(startYear, endYear, selectedYear) {
  const currentYear = new Date().getFullYear();
  const from = startYear || currentYear - 5;
  const to = endYear || currentYear + 20;
  let options = '';
  for (let y = from; y <= to; y++) {
    const yearStr = `${y}/${y + 1}`;
    const selected = yearStr === selectedYear ? 'selected' : '';
    options += `<option value="${yearStr}" ${selected}>${yearStr}</option>`;
  }
  return options;
}

/**
 * Returns the academic year string (e.g., "2025/2026") for the given date.
 * The academic year is calendar-based: for any date in year Y, the academic
 * year is "Y/(Y+1)". This is derived dynamically from the current date so it
 * is always in sync with "today" instead of being manually selected/stored.
 * @param {Date} date - The date to derive the academic year from (default: now)
 * @returns {string} Academic year in "YYYY/YYYY" format
 */
export function getCurrentAcademicYear(date = new Date()) {
  const y = date.getFullYear();
  return `${y}/${y + 1}`;
}

/**
 * Returns the default academic year string (e.g., "2025/2026").
 * Delegates to getCurrentAcademicYear so any dropdown that uses it
 * automatically selects the academic year derived from today's date.
 */
export function getDefaultAcademicYear() {
  return getCurrentAcademicYear();
}

// ================================================================
// Grade Helpers
// ================================================================

export function getGrade(average) {
  if (average >= 80) return { grade: 'A', desc: 'ADVANCE' };
  if (average >= 70) return { grade: 'P', desc: 'PROFICIENT' };
  if (average >= 60) return { grade: 'AP', desc: 'APPROACHING PROFICIENT' };
  if (average >= 40) return { grade: 'D', desc: 'DEVELOPING' };
  if (average >= 35) return { grade: 'B', desc: 'BEGINNING' };
  return { grade: 'F', desc: 'FAIL' };
}

export function getTeacherRemarks(average) {
  if (average >= 80) return 'Excellent performance! Keep up the great work.';
  if (average >= 70) return 'Very good performance. Can do even better with more effort.';
  if (average >= 60) return 'Good performance. Needs to work harder to reach the top.';
  if (average >= 40) return 'Satisfactory but needs significant improvement in all subjects.';
  if (average >= 35) return 'Below average. Requires remedial classes and extra attention.';
  return 'Poor performance. Urgent intervention and parent-teacher meeting required.';
}

export function getHeadTeacherRemarks(average) {
  if (average >= 80) return 'An outstanding performance worthy of commendation. The student has demonstrated excellence across all subjects. Keep nurturing this potential.';
  if (average >= 70) return 'A very good performance showing solid understanding of the curriculum. With continued dedication, the student can achieve even greater heights.';
  if (average >= 60) return 'Good effort has been shown this term. The student is progressing well but should focus more on challenging areas to improve further.';
  if (average >= 40) return 'The student is developing but needs to put in more effort across all subjects. Regular study and parental support are highly recommended.';
  if (average >= 35) return 'Performance is below expectations. The school recommends remedial classes and close monitoring. Parent-teacher collaboration is essential.';
  return 'Serious concern regarding academic progress. Immediate intervention is required. A meeting with parents and the class teacher is mandatory.';
}

export function getSubjectGrade(marks) {
  if (marks >= 80) return { grade: 'A', cls: 'grade-a' };
  if (marks >= 70) return { grade: 'B', cls: 'grade-b' };
  if (marks >= 60) return { grade: 'C', cls: 'grade-c' };
  if (marks >= 50) return { grade: 'D', cls: 'grade-d' };
  if (marks >= 40) return { grade: 'E', cls: 'grade-e' };
  return { grade: 'F', cls: 'grade-f' };
}

export function getPerformanceLevel(marks) {
  if (marks >= 80) return { text: 'Excellent', cls: 'excellent' };
  if (marks >= 70) return { text: 'Very Good', cls: 'very good' };
  if (marks >= 60) return { text: 'Good', cls: 'good' };
  if (marks >= 50) return { text: 'Credit', cls: 'credit' };
  if (marks >= 40) return { text: 'Pass', cls: 'pass' };
  return { text: 'Needs Improvement', cls: 'needs-improvement' };
}

// ================================================================
// Formatting Helpers
// ================================================================

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

export function formatCurrency(amount) {
  return Number(amount || 0).toFixed(2);
}

// ================================================================
// Photo & File Helpers
// ================================================================

export function validateImageFile(file, maxSizeMB = 5) {
  if (!file) return { valid: false, error: 'No file selected.' };
  if (!file.type.startsWith('image/')) return { valid: false, error: 'Please select an image file.' };
  if (file.size > maxSizeMB * 1024 * 1024) {
    const maxKB = Math.round(maxSizeMB * 1024);
    return { valid: false, error: `❌ Photo rejected! Maximum allowed size is ${maxKB}KB. Your photo is ${(file.size / 1024).toFixed(1)}KB. Please select a smaller photo.` };
  }
  return { valid: true, error: null };
}

export function previewFile(file, imgElement, placeholderElement, clearBtn, maxSizeMB = 5) {
  if (!file) return;
  const validation = validateImageFile(file, maxSizeMB);
  if (!validation.valid) {
    alert(validation.error);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    if (imgElement) {
      imgElement.src = e.target.result;
      imgElement.style.display = 'block';
    }
    if (placeholderElement) placeholderElement.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

/**
 * Uploads a file (image or document) and returns the public URL to store in the
 * database. Cloudinary is the PRIMARY store when it is configured — the returned
 * Cloudinary URL is saved into the same columns (student_photo_url, logo_url,
 * file_url, ...) so every <img>/<a> keeps working. When Cloudinary is not yet
 * configured, the upload falls back to the original Supabase Storage bucket.
 */
export async function uploadPhoto(supabaseClient, bucket, file, prefix) {
  if (!file) return null;

  // ---------- Cloudinary (primary for IMAGES only) ----------
  // Documents (PDFs etc.) bypass Cloudinary: this Cloudinary account blocks
  // public PDF/document delivery (HTTP 401 "deny or ACL failure"), so documents
  // must land in Supabase Storage to remain downloadable.
  if (file.type.startsWith('image/') && isCloudinaryReady()) {
    const cloudinaryFolders = {
      'student-photos': 'student_photos',
      'school-logos': 'school_logos',
      'teacher-documents': 'teacher_documents',
    };
    const cloudinaryUrl = await uploadToCloudinary(file, {
      prefix: `${bucket || 'uploads'}_${prefix || 'file'}`,
      folder: cloudinaryFolders[bucket] || 'uploads',
    });
    if (cloudinaryUrl) return cloudinaryUrl;
    console.warn('Cloudinary upload failed — falling back to Supabase Storage.');
  }

  // ---------- Supabase Storage (fallback / pre-Cloudinary) ----------
  const ext = file.name.split('.').pop();
  const fileName = `${prefix}_${Date.now()}.${ext}`;

  // Try the upload first — the bucket may already exist
  let { data: upData, error: upErr } = await supabaseClient.storage
    .from(bucket)
    .upload(fileName, file, { cacheControl: '3600', upsert: false });

  // If the upload failed because the bucket doesn't exist, try to create it
  if (upErr && (upErr.message.includes('Bucket not found') || upErr.message.includes('bucket not found'))) {
    console.warn(`Bucket "${bucket}" not found. Attempting to create it...`);
    const { error: createErr } = await supabaseClient.storage.createBucket(bucket, { public: true });
    if (createErr) {
      // If it already exists, that's fine — just retry the upload.
      // If it's an RLS error, the bucket must be created via SQL migration.
      if (!createErr.message.includes('already exists')) {
        console.warn(
          `Could not create bucket "${bucket}" automatically. ` +
          `Please run the SQL migration (sql/028-school-logo.sql) in the Supabase SQL Editor. ` +
          `Error: ${createErr.message}`
        );
        return null;
      }
    }
    // Retry the upload after ensuring the bucket exists
    const retry = await supabaseClient.storage
      .from(bucket)
      .upload(fileName, file, { cacheControl: '3600', upsert: false });
    upData = retry.data;
    upErr = retry.error;
  }

  if (upErr) {
    console.warn('Photo upload failed:', upErr.message);
    return null;
  }
  const { data: urlData } = supabaseClient.storage.from(bucket).getPublicUrl(fileName);
  return urlData.publicUrl;
}

// ================================================================
// Student name builder
// ================================================================

export function buildStudentName(first, middle, last) {
  return [first, middle, last].filter(Boolean).join(' ');
}

// ================================================================
// Role display
// ================================================================

export function getRoleDisplay(role) {
  return { admin: '👑 Admin', student: '🎓 Student', parent: '👨‍👩‍👧 Parent', sub_admin: '🔧 Sub Admin', super_admin: '⭐ Super Admin', teacher: '📚 Teacher', accountant: '🧾 Accountant' }[role] || 'User';
}

// ================================================================
// Status badges
// ================================================================

export function statusBadge(status) {
  if (status === 'paid') return '<span class="badge-confirmed">Paid</span>';
  if (status === 'partial') return '<span class="badge-unconfirmed">Partial</span>';
  if (status === 'admitted') return '<span class="status-badge status-admitted">Admitted</span>';
  if (status === 'pending') return '<span class="status-badge status-pending">Pending</span>';
  return `<span class="status-badge status-${status}">${status}</span>`;
}

export function portalBadge(confirmed) {
  return confirmed
    ? '<span class="badge-confirmed">✅ Confirmed</span>'
    : '<span class="badge-unconfirmed">⏳ Pending</span>';
}

// ================================================================
// CSV Parser
// ================================================================

export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ================================================================
// Print Common
// ================================================================

// Identifiers used by the print helpers below.
const PRINT_FRAME_ID = '__admissionPrintFrame';
const PRINT_STYLE_ID = '__admissionPrintStyles';
const PRINT_BOX_ID = '__admissionPrintBox';
// Container that holds the printable markup; used as the html2pdf.js source
// and the scoping target for the print document's own `body` styles.
const PRINT_PDF_SHEET_ID = '__admissionPdfSheet';
// Class added to <body> while the print mount is present; serves as a
// second, higher-specificity gate for the print isolation rules.
const PRINT_ACTIVE_CLASS = '__adh-print-active';
// The native-style action sheet shown on mobile that offers the print options.
const PRINT_SHEET_ID = '__admissionPrintSheet';
// The dynamic PDF-blob preview modal shown on mobile (paired with the Web Share API).
const PRINT_MODAL_ID = '__admissionPdfPreviewModal';
// Maximum <table> rows rendered per PDF page when splitting a large report table.
const TABLE_ROWS_PER_PAGE = 30;

/** True on iOS Safari / iPadOS (iframe content cannot be printed there). */
function detectIOSDevice() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS 13+ masks itself as a Mac desktop browser.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * True on any phone / tablet. Mobile engines cannot print <iframe> contents:
 * Android Chrome, WebView and Firefox show the right preview but save / print
 * the PARENT page instead, so they must print through the top-level document.
 */
function detectMobileDevice() {
  if (detectIOSDevice()) return true;
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return true;
  if (/Mobi|Tablet|Mobile|Windows Phone/i.test(ua)) return true;
  return false;
}

/**
 * Wait until every image inside `scope` (a document or an element) has loaded
 * before firing `onReady`. Mobile print engines capture the DOM when print()
 * runs, so unloaded images print as blank boxes. Falls back after ~20s.
 */
function waitForImagesReady(scope, onReady, tries = 0) {
  const maxTries = 200;
  let images = [];
  if (scope) {
    images = scope.images
      ? Array.from(scope.images)
      : Array.from(scope.querySelectorAll('img'));
  }
  const domReady = !scope || typeof scope.readyState === 'undefined' || scope.readyState === 'complete';
  const allLoaded = images.length === 0 || images.every((img) => img.complete);
  if ((domReady && allLoaded) || tries >= maxTries) {
    setTimeout(onReady, 80); // let the layout settle one more frame
    return;
  }
  setTimeout(() => waitForImagesReady(scope, onReady, tries + 1), 100);
}

/** Small loading overlay so slow image loads don't flash raw HTML. */
function createPrintOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(255,255,255,0.94);font-family:sans-serif;font-size:14px;' +
    'color:#334155;letter-spacing:0.3px;';
  overlay.textContent = '⏳ Preparing print preview…';
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Print using a real, visible iframe (desktop / non-mobile).
 *
 * Two things are critical on mobile:
 *  1. The frame must have a real rendered size — hidden or 0x0 frames print
 *     BLANK pages.
 *  2. It must stay in the DOM until the print dialog finishes. Removing it
 *     after a fixed 1 second (as the old code did) made the preview look
 *     correct but the saved PDF / print come out empty: the frame was
 *     already gone by the time the user confirmed the print job.
 */
function printViaIframe(html, title) {
  const old = document.getElementById(PRINT_FRAME_ID);
  if (old && old.parentNode) old.parentNode.removeChild(old);

  const overlay = createPrintOverlay();

  const iframe = document.createElement('iframe');
  iframe.id = PRINT_FRAME_ID;
  iframe.title = title || 'Print';
  // Visible, full-size — never `visibility:hidden` and never 0x0.
  iframe.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'border:0;margin:0;padding:0;background:#fff;z-index:2147483646;';

  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win.document;
  doc.open();
  doc.write(html);
  doc.close();

  let removed = false;
  let printed = false;
  let readyToPrint = false;

  const removeFrame = () => {
    if (removed) return;
    removed = true;
    try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) { /* noop */ }
    try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* noop */ }
  };

  const triggerPrint = () => {
    if (!readyToPrint || printed) return;
    printed = true;

    // Register cleanup listeners BEFORE calling print() so they catch
    // completion events even when print() blocks (desktop is synchronous).
    let cleanupFired = false;
    const scheduleRemove = () => {
      if (cleanupFired) return;
      cleanupFired = true;
      setTimeout(removeFrame, 300);
    };
    try { win.addEventListener('afterprint', scheduleRemove); } catch (e) { /* noop */ }
    try {
      if (typeof win.matchMedia === 'function') {
        const mql = win.matchMedia('print');
        const onChange = (e) => { if (!e.matches) scheduleRemove(); };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
      }
    } catch (e) { /* noop */ }
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      scheduleRemove();
    };
    window.addEventListener('focus', onFocus);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisibility);
        scheduleRemove();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    setTimeout(removeFrame, 120000); // absolute safety net

    try {
      // Drop the spinner just before the native dialog opens.
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      win.focus();
      win.print();
    } catch (e) {
      console.warn('Print failed:', e);
      removeFrame();
      alert('Printing is not available in this browser. Please use the browser menu to print.');
    }
  };

  // Print as soon as the content + images have rendered.
  waitForImagesReady(doc, () => { readyToPrint = true; triggerPrint(); });

  // Handle for legacy `win.focus(); win.print()` callers (de-duplicated).
  return {
    focus: () => { try { win.focus(); } catch (e) { /* noop */ } },
    print: triggerPrint,
    close: removeFrame
  };
}

/** Escape text for safe injection inside the preview toolbar. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build a safe PDF filename from a document title. */
function safePrintFilename(title) {
  return String(title || 'Document')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Document';
}

/**
 * Convert a base64 data-URI (from html2pdf `outputPdf('datauristring')`) back
 * into a Blob. Fallback for browsers/engines where `outputPdf('blob')` is not
 * natively supported by the bundled jsPDF build.
 */
function dataUriStringToBlob(dataUri) {
  const parts = String(dataUri).split(',');
  const meta = (parts[0] || '').match(/data:([^;]+)/);
  const mime = (meta && meta[1]) || 'application/pdf';
  const binary = atob(parts[1] || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}


/**
 * Scope a print document's own <style> text so its `body` rules (font, size,
 * padding) land on the preview / print layer instead of the app page. Only
 * standalone `body` selector tokens are rewritten — class names such as
 * `.receipt-body`, `.modal-body` or `tbody` are left untouched.
 */
function scopePrintStyles(cssText) {
  return cssText.replace(/(^|[\s{};,>+~()])body(?=[\s{:,>.])/g, '$1#' + PRINT_PDF_SHEET_ID);
}

/**
 * Mobile (Android + iOS) print flow — Dynamic PDF Blob Preview Modal.
 *
 * On phones and tablets this shows a full-screen print preview modal that:
 *   • generates a REAL A4 PDF on the fly with html2pdf.js, exports it as a
 *     Blob and renders it inline (`URL.createObjectURL` → <iframe>), so the
 *     user sees the exact document that will be printed or shared;
 *   • pairs the preview with the Web Share API — 📤 Share hands the PDF Blob
 *     to the device's native share sheet (WhatsApp, Email, Drive, Files…);
 *   • 🖨️ Print / Save as PDF still uses the platform's own native print dialog
 *     on the mounted document, so the printed output is the real, exact HTML
 *     (WYSIWYG with the PDF);
 *   • 💾 Download PDF saves the same Blob to Downloads / Files (on iOS Safari
 *     it opens the blob so the browser's Share sheet can "Save to Files").
 *
 * The mount is shared by every document type in the app: all modules reach
 * this through openPrintWindow(), so report cards, receipts, attendance grids,
 * class lists, teacher profiles and financial reports all get the same
 * preview + share + print experience.
 */

/**
 * Splits a print document into independent page sections so the mobile PDF
 * generator can render one small canvas per page. Rendering a whole class of
 * report cards — or one huge attendance table — through a single html2canvas
 * pass exceeds mobile canvas size/memory limits and produces blank/black pages.
 *
 * Returns:
 *   - each direct-child `.rc-container` report card, when there is more than
 *     one (batch report-card printing), or
 *   - row-chunks of a single large `<table>` (e.g. daily attendance reports),
 *     repeating the `<thead>` on every page and keeping the surrounding header/
 *     footer content on the first/last page, or
 *   - an empty array for every other document (those keep the single-pass path).
 */
function collectPageSections(pdfBody) {
  // 1) Batch report cards — each card becomes its own page.
  const cards = Array.from(pdfBody.children).filter(ch =>
    ch.classList && ch.classList.contains('rc-container')
  );
  if (cards.length > 1) return cards;

  // 2) A single large table — split it into row chunks.
  const tables = Array.from(pdfBody.querySelectorAll('table'));
  if (tables.length !== 1) return [];
  const table = tables[0];
  const tbody = table.querySelector('tbody');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
  if (rows.length <= TABLE_ROWS_PER_PAGE) return [];

  const thead = table.querySelector('thead');
  const tfoot = table.querySelector('tfoot');
  let sawTable = false;
  const before = [];
  const after = [];
  Array.from(pdfBody.children).forEach(ch => {
    if (ch === table) { sawTable = true; return; }
    (sawTable ? after : before).push(ch);
  });

  const sections = [];
  for (let i = 0; i < rows.length; i += TABLE_ROWS_PER_PAGE) {
    const wrap = document.createElement('div');
    if (i === 0) before.forEach(el => wrap.appendChild(el.cloneNode(true)));
    const chunk = table.cloneNode(false); // shallow: keeps class/id attributes
    if (thead) chunk.appendChild(thead.cloneNode(true));
    const body = document.createElement('tbody');
    rows.slice(i, i + TABLE_ROWS_PER_PAGE).forEach(r => body.appendChild(r.cloneNode(true)));
    chunk.appendChild(body);
    if (tfoot && i + TABLE_ROWS_PER_PAGE >= rows.length) chunk.appendChild(tfoot.cloneNode(true));
    wrap.appendChild(chunk);
    if (i + TABLE_ROWS_PER_PAGE >= rows.length) after.forEach(el => wrap.appendChild(el.cloneNode(true)));
    sections.push(wrap);
  }
  return sections;
}

/**
 * Renders a batch of independent pages (e.g. the many `.rc-container` report
 * cards of a whole class, or the row-chunks of a large attendance table) into
 * one PDF, one A4 page per section. html2pdf renders the whole source element
 * through a single html2canvas pass, so a full class or huge table would become
 * one enormous canvas that exceeds mobile canvas size/memory limits and throws
 * or renders blank/black pages during generation. Rendering each section on its
 * own keeps every pass to roughly one page, which stays well within limits.
 */
async function renderSectionedPdf(sections, options) {
  const A4_W = 210, A4_H = 297; // A4 portrait (mm)
  const PX_W = 794;             // A4 width at 96dpi (px)

  // The hidden mobile print mount (#PRINT_BOX_ID) is already placed far
  // off-screen (position:fixed; left:-99999px) by printViaNativeMobile, so we
  // render inside it rather than append a new fixed/absolute element to <body>.
  // html2canvas 1.0.0-alpha.12 (the build bundled inside html2pdf 0.10.1)
  // renders a position:fixed or position:absolute ROOT element as a completely
  // EMPTY canvas, so page sections rendered from a fixed holder produced blank
  // pages and the whole multi-page PDF failed (jsPDF "Invalid argument passed
  // to jsPDF.scale" once height collapsed to 0). Rendering from a normal-flow
  // (position:relative) child of the hidden box — the same structure the
  // single-pass path already relies on — captures the real content reliably.
  const host = document.getElementById(PRINT_BOX_ID) || document.body;

  // 1) Render each section to its own image — one small canvas at a time.
  const pages = [];
  for (let i = 0; i < sections.length; i++) {
    const holder = document.createElement('div');
    holder.style.cssText =
      'position:relative;display:block;left:0;top:0;width:' + PX_W + 'px;' +
      'overflow:visible;background:#ffffff;';
    const clone = sections[i].cloneNode(true);
    clone.style.cssText = (clone.style.cssText || '') +
      ';width:100%;max-width:' + PX_W + 'px;margin:0;box-shadow:none!important;border:0 none;';
    holder.appendChild(clone);
    host.appendChild(holder);
    try {
      const worker = window.html2pdf()
        .set({ html2canvas: options.html2canvas })
        .from(holder)
        .toCanvas();
      const canvas = await worker.get('canvas');
      if (canvas) {
        pages.push({
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          w: canvas.width,
          h: canvas.height
        });
      }
    } catch (e) {
      console.warn('Failed to render one page for the PDF:', e);
    } finally {
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    }
  }

  if (pages.length === 0) {
    throw new Error('No pages could be rendered for the PDF.');
  }

  // 2) Get a jsPDF instance (the bundle does not expose jsPDF as a global) via a
  //    throwaway worker, drop its blank first page, then place each page image on
  //    its own A4 page so the whole class fits in one multi-page PDF.
  const seed = document.createElement('div');
  // Rendered only as a throwaway blank page that is deleted below; keep it a
  // normal-flow element inside the hidden box too so the html2canvas pass never
  // has to rasterize a position:fixed root (which would render empty).
  seed.style.cssText = 'position:relative;display:block;left:0;top:0;width:' + PX_W + 'px;';
  seed.textContent = ' ';
  host.appendChild(seed);
  let pdf;
  try {
    pdf = await window.html2pdf().set(options).from(seed).toPdf().get('pdf');
  } finally {
    if (seed.parentNode) seed.parentNode.removeChild(seed);
  }
  if (pdf && typeof pdf.deletePage === 'function') pdf.deletePage(1);

  const margin = 6; // mm around each card on the page
  for (let i = 0; i < pages.length; i++) {
    pdf.addPage(); // (re)create the page — deletePage above leaves zero
    const p = pages[i];
    let wmm = A4_W - 2 * margin;
    let hmm = wmm * p.h / p.w;
    if (hmm > A4_H - 2 * margin) { hmm = A4_H - 2 * margin; wmm = hmm * p.w / p.h; }
    const x = (A4_W - wmm) / 2;
    const y = (A4_H - hmm) / 2;
    pdf.addImage(p.dataUrl, 'JPEG', x, y, wmm, hmm);
  }

  const blob = pdf.output('blob');
  if (blob instanceof Blob) return blob;
  return dataUriStringToBlob(pdf.output('datauristring'));
}

function printViaNativeMobile(html, title) {
  // Clean any leftover state from a previous run.
  removePrintMount();

  // Split the print document into its <style> blocks and <body> markup.
  let styles = '';
  let bodyHtml = html;
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    styles = Array.from(parsed.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    if (parsed.body) bodyHtml = parsed.body.innerHTML;
  } catch (e) {
    console.warn('Failed to parse print HTML, printing raw content:', e);
  }

  const styleEl = document.createElement('style');
  styleEl.id = PRINT_STYLE_ID;
  styleEl.textContent = scopePrintStyles(styles) + '\n' + buildMobilePrintCSS() + '\n' + buildPdfPreviewModalCSS();

  // Hidden print-only mount: real layout off-screen so images load and the
  // native print engine can capture exactly this document. The @media print
  // rules in buildMobilePrintCSS make it the ONLY printed content. Never
  // visible to the user.
  const box = document.createElement('div');
  box.id = PRINT_BOX_ID;
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<div id="' + PRINT_PDF_SHEET_ID + '" class="__adh-doc-sheet">' + bodyHtml + '</div>';

  document.body.appendChild(styleEl);
  document.body.appendChild(box);
  document.body.classList.add(PRINT_ACTIVE_CLASS);

  // ---------------------------------------------------------------
  // Dynamic PDF Blob Preview Modal
  // ---------------------------------------------------------------
  const modal = document.createElement('div');
  modal.id = PRINT_MODAL_ID;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Document PDF preview — ' + title);
  modal.innerHTML =
    '<div class="__adh-preview-toolbar">' +
      '<div class="__adh-preview-title-wrap">' +
        '<span class="__adh-preview-title">🗎 ' + escapeHtml(title || 'Print') + '</span>' +
        '<span class="__adh-preview-subtitle" id="__adhPreviewStatus">⏳ Generating PDF preview…</span>' +
      '</div>' +
      '<button type="button" class="__adh-preview-close" id="__adhPreviewClose" aria-label="Close preview">✕</button>' +
    '</div>' +
    '<div class="__adh-preview-body">' +
      '<div class="__adh-preview-spinner" id="__adhPreviewSpinner">' +
        '<span class="__adh-spinner-ring"></span>' +
        '<span class="__adh-spinner-text">Generating a PDF of this document…</span>' +
      '</div>' +
      '<div class="__adh-preview-banner" id="__adhPreviewBanner" hidden>' +
        'This device can\'t show the PDF inline — use Share, Download or Print below.' +
      '</div>' +
      '<iframe id="__adhPreviewFrame" title="' + escapeHtml(title) + ' PDF preview"></iframe>' +
    '</div>' +
    '<div class="__adh-preview-actions">' +
      '<button type="button" class="__adh-preview-btn __adh-preview-share" id="__adhPreviewShare">📤 Share</button>' +
      '<button type="button" class="__adh-preview-btn" id="__adhPreviewDownload">💾 Download</button>' +
      '<button type="button" class="__adh-preview-btn __adh-preview-primary" id="__adhPreviewPrint">🖨️ Print / Save</button>' +
    '</div>' +
    '<div class="__adh-preview-hint" id="__adhPreviewHint"></div>';
  document.body.appendChild(modal);

  const iframe = modal.querySelector('#__adhPreviewFrame');
  const spinner = modal.querySelector('#__adhPreviewSpinner');
  const banner = modal.querySelector('#__adhPreviewBanner');
  const closeBtn = modal.querySelector('#__adhPreviewClose');
  const shareBtn = modal.querySelector('#__adhPreviewShare');
  const downloadBtn = modal.querySelector('#__adhPreviewDownload');
  const printBtn = modal.querySelector('#__adhPreviewPrint');
  const statusEl = modal.querySelector('#__adhPreviewStatus');
  const hintEl = modal.querySelector('#__adhPreviewHint');

  let cleanedUp = false;
  let printed = false;
  let pdfBlob = null;
  let blobUrl = null;

  const setStatus = (text, ok) => {
    if (statusEl) {
      statusEl.textContent = text || '';
      statusEl.className = '__adh-preview-subtitle' + (ok ? ' __adh-preview-subtitle--ok' : '');
    }
    if (hintEl) {
      hintEl.textContent = text || '';
      hintEl.className = '__adh-preview-hint' + (ok ? ' __adh-preview-hint--ok' : '');
    }
  };
  const setBusy = (busy) => {
    if (!shareBtn || !downloadBtn || !printBtn) return;
    shareBtn.disabled = busy;
    downloadBtn.disabled = busy;
    printBtn.disabled = busy;
  };

  function onVisibility() {
    if (document.visibilityState === 'visible') scheduleCleanup();
  }

  function scheduleCleanup() { setTimeout(doCleanup, 300); }

  function doCleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    try { window.removeEventListener('afterprint', scheduleCleanup); } catch (e) { /* noop */ }
    document.removeEventListener('visibilitychange', onVisibility);
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch (e) { /* noop */ }
      blobUrl = null;
    }
    pdfBlob = null;
    removePrintMount();
  }

  function triggerPrint() {
    if (printed) return;
    printed = true;

    // Register completion signals BEFORE print() — mobile often lacks
    // afterprint, so also listen to media-query, focus and visibility changes.
    try { window.addEventListener('afterprint', scheduleCleanup); } catch (e) { /* noop */ }
    try {
      if (typeof window.matchMedia === 'function') {
        const mql = window.matchMedia('print');
        const onChange = (ev) => { if (!ev.matches) scheduleCleanup(); };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
      }
    } catch (e) { /* noop */ }
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      scheduleCleanup();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    setTimeout(doCleanup, 120000); // absolute safety net

    try {
      // Drop the preview modal so the platform print dialog is unobstructed.
      modal.style.display = 'none';
      window.focus();
      // Give the browser one frame to apply the print media rules before it
      // captures the page — keeps the saved/printed output identical to what
      // the platform's own print preview shows.
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch (e) {
          console.warn('Print failed:', e);
          doCleanup();
          alert('Printing is not available in this browser. Please use the browser menu to print.');
        }
      });
    } catch (e) {
      console.warn('Print failed:', e);
      doCleanup();
      alert('Printing is not available in this browser. Please use the browser menu to print.');
    }
  }

  // ---- PDF Blob generation (the live preview) -----
  function generatePdfPreview() {
    const pdfBody = document.getElementById(PRINT_PDF_SHEET_ID);
    if (!pdfBody) {
      spinner.hidden = true;
      setStatus('Preview unavailable — you can still print.', false);
      return;
    }
    if (typeof window.html2pdf !== 'function') {
      spinner.hidden = true;
      shareBtn.disabled = true;
      downloadBtn.disabled = true;
      setStatus('PDF engine unavailable — you can still print.', false);
      return;
    }
    waitForImagesReady(box, async () => {
      try {
        const options = {
          margin: [8, 8, 8, 8],
          filename: safePrintFilename(title) + '.pdf',
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff', logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        };
        // html2pdf Worker → export the PDF as a Blob for the inline preview.
        // A batch of report cards or a huge attendance table is too large for
        // html2canvas to render as a single canvas on mobile — it exceeds the
        // platform canvas size/memory limits and fails (or renders blank/black
        // pages) mid-generation. Detect those cases and render page-by-page
        // instead (one PDF page per report card / table row-chunk).
        const pageSections = collectPageSections(pdfBody);
        let blob;
        if (pageSections.length > 1) {
          blob = await renderSectionedPdf(pageSections, options);
        } else {
          const worker = window.html2pdf().set(options).from(pdfBody).toPdf();
          blob = await worker.outputPdf('blob');
          if (!(blob instanceof Blob)) {
            const dataUri = await worker.outputPdf('datauristring');
            blob = dataUriStringToBlob(dataUri);
          }
        }
        if (cleanedUp) return;
        pdfBlob = blob;
        blobUrl = URL.createObjectURL(blob);
        iframe.src = blobUrl;
        spinner.hidden = true;
        setStatus('PDF ready ✓ ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB — tap an action below.', true);
        // iOS Safari cannot render PDFs inline inside iframes — surface a hint.
        if (detectIOSDevice()) banner.hidden = false;
      } catch (err) {
        console.error('PDF preview generation failed:', err);
        spinner.hidden = true;
        setStatus('Preview failed — you can still print.', false);
      }
    });
  }

  // ---- Actions -----
  function triggerDownload() {
    if (!pdfBlob || !blobUrl) { setStatus('PDF not ready yet — please wait…', false); return; }
    const filename = safePrintFilename(title) + '.pdf';
    if (detectIOSDevice()) {
      // iOS Safari ignores the <a download> attribute — open the blob in a new
      // tab where Safari's reader/share sheet offers "Save to Files".
      setStatus('Opening PDF… tap the Share icon in the browser to save to Files.', false);
      const w = window.open(blobUrl, '_blank');
      if (!w) setStatus('Pop-up blocked — use 📤 Share instead.', false);
    } else {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
      setStatus('Downloading… check your Downloads folder.', true);
    }
  }

  async function triggerShare() {
    if (!pdfBlob) { setStatus('PDF not ready yet — please wait…', false); return; }
    const filename = safePrintFilename(title) + '.pdf';
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && typeof navigator.share === 'function') {
      try {
        await navigator.share({ files: [file], title: title || 'Document', text: title || 'Document' });
        setStatus('Shared ✓', true);
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user dismissed the sheet
        console.error('Web Share failed:', err);
        setStatus('Sharing failed — try Download instead.', false);
      }
    } else {
      // Browser without file sharing (e.g. desktop Windows) → download.
      setStatus('Sharing isn\'t supported here — downloading the PDF instead.', false);
      triggerDownload();
    }
  }

  closeBtn.addEventListener('click', doCleanup);
  printBtn.addEventListener('click', () => {
    try { modal.style.display = 'none'; } catch (e) { /* noop */ }
    triggerPrint();
  });
  downloadBtn.addEventListener('click', triggerDownload);
  shareBtn.addEventListener('click', () => {
    setBusy(true);
    triggerShare().finally(() => setBusy(false));
  });

  // Kick off the live PDF preview generation.
  generatePdfPreview();
  waitForImagesReady(box, () => {}); // warm-up also for the native print path

  // Handle for legacy `win.focus(); win.print()` callers. On mobile the
  // preview modal IS the UI, so a direct print() is intentionally ignored —
  // the modal's own 🖨️ Print / Save button opens the native dialog once.
  // Desktop iframes still auto-print as before.
  return {
    focus: () => { try { modal.focus(); } catch (e) { /* noop */ } },
    print: () => { /* no-op; the preview modal exposes the actions */ },
    close: doCleanup
  };
}

/**
 * CSS that:
 *  1. keeps the mobile print mount off-screen (there is no custom preview the
 *     user sees on the app page),
 *  2. styles the native-style action sheet that offers the print options, and
 *  3. isolates the printed output to exactly the mounted document — so the
 *     platform's own native print preview equals the saved PDF and the direct
 *     print, for every document type in the app.
 * It is injected AFTER the scoped print styles, so these rules win conflicts.
 */
function buildMobilePrintCSS() {
  const box = '#' + PRINT_BOX_ID;
  const sheet = '#' + PRINT_SHEET_ID;
  const docSheet = '#' + PRINT_PDF_SHEET_ID;
  return (
    /* ---- Hidden print-only mount (real layout so images load & engines capture it) ---- */
    box + '{' +
    'position:fixed!important;left:-99999px!important;top:0!important;' +
    'width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;' +
    'background:#fff!important;overflow:visible!important;z-index:-1!important;' +
    '}' +
    docSheet + '{' +
    'position:relative;display:block;background:#fff;width:100%;max-width:100%;' +
    '}' +
    /* ---- Native-style action sheet (the print options) ---- */
    sheet + '{' +
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-end;' +
    'justify-content:center;font:400 15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,' +
    '"Helvetica Neue",Arial,sans-serif;' +
    '}' +
    sheet + ' .__adh-sheet-backdrop{' +
    'position:absolute;inset:0;background:rgba(15,23,42,0.45);' +
    '}' +
    sheet + ' .__adh-sheet{' +
    'position:relative;z-index:1;width:min(100% - 1rem,480px);max-width:calc(100vw - 1rem);' +
    'background:#fff;border-radius:16px 16px 0 0;padding:0.5rem 0.9rem ' +
    'calc(0.9rem + env(safe-area-inset-bottom));box-shadow:0 -6px 28px rgba(15,23,42,0.22);' +
    '}' +
    sheet + ' .__adh-sheet-grip{' +
    'width:44px;height:5px;border-radius:3px;background:#cbd5e1;margin:0 auto 0.55rem;' +
    '}' +
    sheet + ' .__adh-sheet-title{' +
    'font-size:15px;font-weight:700;color:#0f172a;text-align:center;padding:0 0.25rem;' +
    '}' +
    sheet + ' .__adh-sheet-subtitle{' +
    'font-size:12px;color:#64748b;text-align:center;margin:0.15rem 0 0.65rem;' +
    '}' +
    sheet + ' .__adh-sheet-btn{' +
    'display:block;width:100%;border:0;border-radius:10px;padding:0.8rem 0.75rem;' +
    'margin-top:0.5rem;font:600 15px/1.2 inherit;color:#fff;background:#2563eb;' +
    'cursor:pointer;-webkit-tap-highlight-color:transparent;' +
    '}' +
    sheet + ' .__adh-sheet-btn:active{' +
    'opacity:0.85;transform:scale(0.99);' +
    '}' +
    sheet + ' .__adh-sheet-btn.__adh-sheet-cancel{' +
    'background:#e2e8f0;color:#334155;' +
    '}' +
    sheet + ' .__adh-sheet-btn[disabled]{opacity:0.6;}' +
    sheet + ' .__adh-sheet-hint{' +
    'text-align:center;font-size:12px;color:#334155;min-height:1.2em;margin-top:0.6rem;' +
    '}' +
    sheet + ' .__adh-sheet-hint.__adh-sheet-hint--ok{' +
    'color:#059669;font-weight:600;' +
    '}' +
    /* ---- Print isolation: ONLY the mounted document prints ---- */
    '@media print{' +
    'html,body{margin:0!important;padding:0!important;background:#fff!important;' +
    'height:auto!important;overflow:visible!important;}' +
    'body::before,body::after{display:none!important;content:none!important;}' +
    'body>*:not(' + box + '):not(script):not(style):not(link),' +
    'body.' + PRINT_ACTIVE_CLASS + '>*:not(' + box + '):not(script):not(style):not(link)' +
    '{display:none!important;}' +
    sheet + '{display:none!important;}' +
    box + '{' +
    'position:static!important;left:auto!important;top:auto!important;' +
    'width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;' +
    'margin:0!important;padding:0!important;' +
    'border:0 none!important;background:#fff!important;' +
    'box-shadow:none!important;overflow:visible!important;z-index:auto!important;' +
    '}' +
    box + ' tr,' + box + ' img{page-break-inside:avoid;}' +
    box + ',' + box + ' *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}' +
    '}'
  );
}

/** Build the CSS for the Dynamic PDF Blob Preview Modal shown on mobile. */
function buildPdfPreviewModalCSS() {
  const m = '#' + PRINT_MODAL_ID;
  return (
    m + '{' +
    'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;' +
    'background:#fff;font:400 15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,' +
    '"Helvetica Neue",Arial,sans-serif;' +
    '}' +
    /* Toolbar */
    m + ' .__adh-preview-toolbar{' +
    'display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.75rem;' +
    'border-bottom:1px solid #e2e8f0;background:#f8fafc;flex:0 0 auto;' +
    '}' +
    m + ' .__adh-preview-title-wrap{' +
    'flex:1;min-width:0;text-align:center;' +
    '}' +
    m + ' .__adh-preview-title{' +
    'display:block;font-size:15px;font-weight:700;color:#0f172a;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
    '}' +
    m + ' .__adh-preview-subtitle{' +
    'display:block;font-size:11px;color:#64748b;margin-top:0.15rem;min-height:1.2em;' +
    '}' +
    m + ' .__adh-preview-subtitle.__adh-preview-subtitle--ok{' +
    'color:#059669;font-weight:600;' +
    '}' +
    m + ' .__adh-preview-close{' +
    'flex:0 0 auto;border:0;background:rgba(15,23,42,0.08);color:#334155;' +
    'width:34px;height:34px;border-radius:50%;font-size:16px;line-height:1;' +
    'cursor:pointer;-webkit-tap-highlight-color:transparent;' +
    '}' +
    m + ' .__adh-preview-close:active{' +
    'opacity:0.75;transform:scale(0.95);' +
    '}' +
    /* Body — the live PDF preview area */
    m + ' .__adh-preview-body{' +
    'flex:1;min-height:0;position:relative;background:#e2e8f0;' +
    '}' +
    m + ' .__adh-preview-body iframe{' +
    'width:100%;height:100%;border:0;background:#fff;display:block;' +
    '}' +
    /* Spinner while the PDF blob is generated */
    m + ' .__adh-preview-spinner{' +
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:0.75rem;background:#fff;z-index:2;' +
    '}' +
    m + ' .__adh-preview-spinner[hidden]{display:none!important;}' +
    m + ' .__adh-spinner-ring{' +
    'width:44px;height:44px;border-radius:50%;border:4px solid #e2e8f0;' +
    'border-top-color:#2563eb;animation:__adhSpin 0.8s linear infinite;' +
    '}' +
    '@keyframes __adhSpin{' +
    'to{transform:rotate(360deg);}' +
    '}' +
    m + ' .__adh-spinner-text{' +
    'font-size:13px;color:#334155;' +
    '}' +
    /* Hint for iOS / webviews that cannot render PDFs inline */
    m + ' .__adh-preview-banner{' +
    'position:absolute;top:0.5rem;left:0.5rem;right:0.5rem;z-index:3;' +
    'background:#fffbeb;border:1px solid #fcd34d;color:#78350f;' +
    'border-radius:10px;padding:0.6rem 0.75rem;font-size:12px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.08);' +
    '}' +
    m + ' .__adh-preview-banner[hidden]{display:none!important;}' +
    /* Action bar */
    m + ' .__adh-preview-actions{' +
    'display:flex;gap:0.5rem;padding:0.6rem 0.75rem calc(0.6rem + env(safe-area-inset-bottom));' +
    'border-top:1px solid #e2e8f0;background:#fff;flex:0 0 auto;' +
    '}' +
    m + ' .__adh-preview-btn{' +
    'flex:1;border:0;border-radius:10px;padding:0.75rem 0.5rem;' +
    'font:600 13px/1.2 inherit;color:#334155;background:#e2e8f0;cursor:pointer;' +
    'min-height:44px;-webkit-tap-highlight-color:transparent;' +
    '}' +
    m + ' .__adh-preview-btn:active{' +
    'opacity:0.85;transform:scale(0.98);' +
    '}' +
    m + ' .__adh-preview-btn.__adh-preview-share{' +
    'background:#0d9488;color:#fff;' +
    '}' +
    m + ' .__adh-preview-btn.__adh-preview-primary{' +
    'background:#2563eb;color:#fff;' +
    '}' +
    m + ' .__adh-preview-btn[disabled]{opacity:0.5;}' +
    m + ' .__adh-preview-hint{' +
    'text-align:center;font-size:12px;color:#64748b;padding:0 0.75rem 0.5rem;' +
    'min-height:1.2em;flex:0 0 auto;' +
    '}' +
    m + ' .__adh-preview-hint.__adh-preview-hint--ok{' +
    'color:#059669;font-weight:600;' +
    '}' +
    /* Slightly roomier on tablets / landscape */
    '@media (min-width:700px){' +
    m + ' .__adh-preview-actions{justify-content:center;}' +
    m + ' .__adh-preview-btn{flex:1 1 200px;max-width:240px;}' +
    '}'
  );
}

/** Remove the mobile print mount (scoped styles, hidden document, action sheet, preview modal). */
function removePrintMount() {
  const s = document.getElementById(PRINT_STYLE_ID);
  if (s && s.parentNode) s.parentNode.removeChild(s);
  const b = document.getElementById(PRINT_BOX_ID);
  if (b && b.parentNode) b.parentNode.removeChild(b);
  const sh = document.getElementById(PRINT_SHEET_ID);
  if (sh && sh.parentNode) sh.parentNode.removeChild(sh);
  const pm = document.getElementById(PRINT_MODAL_ID);
  if (pm && pm.parentNode) pm.parentNode.removeChild(pm);
  document.body.classList.remove(PRINT_ACTIVE_CLASS);
}

/**
 * Print an HTML document on every platform.
 *
 * Desktop / non-mobile -> rendered in a real, visible iframe that is kept in
 *   the DOM until the print dialog finishes.
 * Mobile (iOS AND Android) -> the document is mounted into the top-level page
 *   and the app shows the Dynamic PDF Blob Preview Modal:
 *     • Live PDF preview — a real A4 PDF is generated on the fly with
 *       html2pdf.js, exported as a Blob (URL.createObjectURL) and shown
 *       inline, so the user sees the exact document;
 *     • 📤 Share — the Web Share API hands the PDF Blob to the device's
 *       native share sheet (WhatsApp, Email, Drive, Files…);
 *     • 💾 Download PDF — saves the same Blob to Downloads / Files;
 *     • 🖨️ Print / Save as PDF — opens the platform's own print dialog on the
 *       mounted document (printer, "Save as PDF" on Android, "Save to
 *       Files"/AirPrint on iOS).
 *
 * The returned handle keeps legacy `win.focus(); win.print()` callers working:
 * on desktop it de-dupes the native dialog, on mobile a direct print() is
 * intentionally a no-op because the preview modal exposes those actions.
 */
export function openPrintWindow(html, title = 'Print', width = 900, height = 700) {
  if (detectMobileDevice()) return printViaNativeMobile(html, title);
  return printViaIframe(html, title);
}

export function collectStyles() {
  let styles = '';
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.cssRules) {
        for (const rule of sheet.cssRules) {
          styles += rule.cssText + '\n';
        }
      }
    } catch (e) { /* skip cross-origin */ }
  }
  document.querySelectorAll('style').forEach(el => { styles += el.innerHTML + '\n'; });
  return styles;
}

/**
 * Add data-label attributes to all <td> elements in tables
 * based on their corresponding <th> header text.
 * This enables the mobile stacked card layout to show labels.
 */
export function applyTableLabels() {
  document.querySelectorAll('.app-table').forEach((table) => {
    const headerCells = [];
    const thead = table.querySelector('thead');
    if (!thead) return;
    thead.querySelectorAll('th').forEach((th) => {
      headerCells.push(th.textContent.trim());
    });
    if (headerCells.length === 0) return;
    table.querySelectorAll('tbody tr').forEach((row) => {
      row.querySelectorAll('td').forEach((td, index) => {
        if (index < headerCells.length) {
          td.setAttribute('data-label', headerCells[index]);
        }
      });
    });
  });
}
// ================================================================
// Admin — Reset Teacher / Accountant / Student Password Helpers
// ================================================================
// Backed by the #adminResetPasswordModal in index.html and the
// reset_teacher_password / reset_accountant_password /
// reset_student_password SECURITY DEFINER RPC functions
// (sql/039-reset-user-passwords.sql).

const RESET_PW_RPC_BY_TYPE = {
  teacher: { rpc: 'reset_teacher_password', payloadKey: 'p_teacher_id' },
  accountant: { rpc: 'reset_accountant_password', payloadKey: 'p_accountant_id' },
  student: { rpc: 'reset_student_password', payloadKey: 'p_student_id' },
};

/**
 * Opens the shared reset-password modal for a teacher, accountant or student.
 * @param {string} type - 'teacher' | 'accountant' | 'student'
 * @param {string} id - teacher/accountant UUID or student_id
 * @param {string} displayName - shown in the modal for confirmation
 */
window.openAdminResetPassword = function (type, id, displayName) {
  const modal = getEl('adminResetPasswordModal');
  if (!modal) {
    alert('Reset password modal not found. Please refresh the page.');
    return;
  }
  getEl('adminResetPwType').value = type;
  getEl('adminResetPwId').value = id;
  getEl('adminResetPwName').textContent = displayName;
  getEl('adminResetPwNewPassword').value = '';
  getEl('adminResetPwConfirmPassword').value = '';
  clearMessage('adminResetPwMessage');
  modal.style.display = 'flex';
};

/**
 * Closes the shared reset-password modal.
 */
window.closeAdminResetPasswordModal = function () {
  const modal = getEl('adminResetPasswordModal');
  if (modal) modal.style.display = 'none';
};

/**
 * Validates the form and calls the correct reset RPC.
 * Only school admins/sub-admins and the super admin are allowed by the RPCs.
 */
window.submitAdminResetPassword = async function () {
  const type = getEl('adminResetPwType').value;
  const id = getEl('adminResetPwId').value;
  const displayName = getEl('adminResetPwName').textContent;
  const newPassword = getEl('adminResetPwNewPassword').value;
  const confirmPassword = getEl('adminResetPwConfirmPassword').value;
  const btn = getEl('adminResetPwSubmitBtn');

  // Validate inputs
  if (!newPassword || newPassword.length < 6) {
    showMessage('adminResetPwMessage', 'Password must be at least 6 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage('adminResetPwMessage', 'Passwords do not match.', 'error');
    return;
  }

  // Confirm with the admin
  if (!confirm(`⚠️ RESET PASSWORD\n\nAre you sure you want to reset the password for "${displayName}"?\n\nThe account holder will need to use the new password to log in.`)) {
    return;
  }

  const mapping = RESET_PW_RPC_BY_TYPE[type];
  if (!mapping) {
    showMessage('adminResetPwMessage', 'Unknown account type.', 'error');
    return;
  }

  setLoading(btn, true, 'Resetting...');
  try {
    const supabase = window.supabaseClient;
    if (!supabase) throw new Error('Database client not ready. Please refresh the page.');

    const payload = { [mapping.payloadKey]: id, p_new_password: newPassword };
    const { data, error } = await supabase.rpc(mapping.rpc, payload);

    if (error) {
      showMessage('adminResetPwMessage', 'Error: ' + error.message, 'error');
      setLoading(btn, false, '🔑 Reset Password');
      return;
    }
    if (!data?.success) {
      showMessage('adminResetPwMessage', data?.error || 'Failed to reset password.', 'error');
      setLoading(btn, false, '🔑 Reset Password');
      return;
    }

    showMessage('adminResetPwMessage', `✅ Password reset successfully for "${displayName}". They can now log in with the new password.`, 'success');
    logSubAdminActivity(`Reset ${type} password for "${displayName}"`, type, displayName);
    setLoading(btn, false, '🔑 Reset Password');

    // Close the modal after a short delay
    setTimeout(() => {
      const modal = getEl('adminResetPasswordModal');
      if (modal) modal.style.display = 'none';
    }, 2000);
  } catch (err) {
    showMessage('adminResetPwMessage', 'Error: ' + err.message, 'error');
    setLoading(btn, false, '🔑 Reset Password');
  }
};
