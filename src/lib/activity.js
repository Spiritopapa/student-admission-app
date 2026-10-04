import { supabase } from './supabase';

/**
 * Activity logging for the admission portal.
 *
 * Mirrors the legacy app's audit trail:
 *   - teachers & accountants  -> `staff_activities`
 *   - students                -> `student_activities`
 *   - sub admins              -> `sub_admin_activities`
 *
 * Loggers resolve the signed-in user's record (teachers/accountants are linked
 * by user_id; students link via applications.user_id) and write one row per
 * significant action. Every call is fail-safe — a logging error never breaks
 * the caller's flow.
 */

async function currentUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  } catch (err) {
    return null;
  }
}

function buildName(app) {
  return [app?.first_name, app?.middle_name, app?.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Log an activity performed by a logged-in teacher or accountant.
 * Silently returns unless the signed-in user actually has a teacher /
 * accountant record for the given role, so shared code can call it freely.
 *
 * @param {string} action - e.g. "Recorded fee payment of GHC 50"
 * @param {object} [opts]
 * @param {string} [opts.role]        - 'teacher' | 'accountant' (required)
 * @param {string} [opts.entityType]  - e.g. 'payment', 'attendance', 'exam'
 * @param {string} [opts.entityDetails] - optional detail string
 */
export async function logStaffActivity(action, { role = '', entityType = 'general', entityDetails = null } = {}) {
  const user = await currentUser();
  if (!user) return;
  const table = role === 'teacher' ? 'teachers' : role === 'accountant' ? 'accountants' : null;
  if (!table) return;
  try {
    const { data: staff } = await supabase
      .from(table)
      .select('id, full_name, registration_id, school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!staff?.id) return;
    await supabase.from('staff_activities').insert([
      {
        school_id: staff.school_id,
        staff_id: staff.id,
        staff_type: role,
        staff_name: staff.full_name,
        staff_registration_id: staff.registration_id,
        action,
        entity_type: entityType,
        entity_details: entityDetails || null,
        performed_by_user_id: user.id,
      },
    ]);
  } catch (err) {
    console.warn('Failed to log staff activity:', err.message);
  }
}

/**
 * Log an activity performed by a logged-in student.
 * Resolves the student from `applications` through user_id.
 */
export async function logStudentActivity(action, { entityType = 'general', entityDetails = null } = {}) {
  const user = await currentUser();
  if (!user) return;
  try {
    // Prefer the applications.user_id link; fall back to the metadata student ID
    // small window where a fresh login has not been linked yet.
    const { data: app } = await supabase
      .from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying, school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!app?.student_id) return;
    await supabase.from('student_activities').insert([
      {
        school_id: app.school_id,
        student_id: app.student_id,
        student_name: buildName(app) || app.student_id,
        class_name: app.class_applying,
        action,
        entity_type: entityType,
        entity_details: entityDetails || null,
        performed_by_user_id: user.id,
      },
    ]);
  } catch (err) {
    console.warn('Failed to log student activity:', err.message);
  }
}

/** Log an activity performed by a logged-in sub admin. */
export async function logSubAdminActivity(action, { entityType = 'general', entityDetails = null } = {}) {
  const user = await currentUser();
  if (!user) return;
  try {
    const { data: sub } = await supabase
      .from('sub_admins')
      .select('id, full_name, registration_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!sub?.id) return;
    await supabase.from('sub_admin_activities').insert([
      {
        sub_admin_id: sub.id,
        sub_admin_name: sub.full_name,
        registration_id: sub.registration_id,
        action,
        entity_type: entityType,
        entity_details: entityDetails || null,
      },
    ]);
  } catch (err) {
    console.warn('Failed to log sub admin activity:', err.message);
  }
}

/**
 * Route an activity to the correct table based on the signed-in profile role.
 * Safe from any page: admins/super admins are silently ignored (no log table).
 */
export async function logActivityForCurrentUser(action, opts = {}) {
  const user = await currentUser();
  if (!user) return;
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const role = String(profile?.role || '').toLowerCase();
    if (role === 'teacher' || role === 'accountant') return logStaffActivity(action, { ...opts, role });
    if (role === 'student') return logStudentActivity(action, opts);
    if (role === 'sub_admin') return logSubAdminActivity(action, opts);
  } catch (err) {
    // fail-safe
  }
}