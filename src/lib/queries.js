import { supabase } from './supabase';

export async function fetchStudentFees(studentId) {
  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('student_id', studentId)
    .order('academic_year', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchStudentTransactions(studentId) {
  const { data, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('student_id', studentId)
    .order('payment_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchStudentReceipts(studentId) {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('student_id', studentId)
    .order('receipt_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchStudentAttendance(studentId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchActiveAnnouncements(schoolId) {
  let q = supabase.from('announcements').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchExamsForStudent(schoolId) {
  let q = supabase.from('exams').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchResultsForExam(studentId, examId) {
  const { data, error } = await supabase
    .from('exam_results')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchStudentDetailsForExam(studentId, examId) {
  const { data, error } = await supabase
    .from('exam_student_details')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function fetchPublishedAssessments(schoolId, className) {
  let q = supabase
    .from('assessments')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  if (schoolId) q = q.eq('school_id', schoolId);
  if (className) q = q.eq('class_name', className);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchAssessmentAttempts(studentId) {
  const { data, error } = await supabase
    .from('assessment_attempts')
    .select('*')
    .eq('student_id', studentId)
    .order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchParentLinks(parentUserId) {
  const { data, error } = await supabase
    .from('parent_links')
    .select('*')
    .eq('parent_user_id', parentUserId);
  if (error) throw new Error(error.message);
  return data || [];
}

// Parent self-service: connect a ward using its Student ID. The backend applies
// a contact guard (ward's parent_contact must be empty or match the parent's
// phone/email on file). Returns the RPC result or throws a friendly error.
export async function linkWardToParent(studentId) {
  const { data, error } = await supabase.rpc('link_ward_to_parent', { p_student_id: studentId });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not link the ward.');
  return data;
}

export async function unlinkWardFromParent(studentId) {
  const { data, error } = await supabase.rpc('unlink_ward', { p_student_id: studentId });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not unlink the ward.');
  return data;
}

export async function fetchWardApplication(studentId) {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function fetchSchoolName(schoolId) {
  if (!schoolId) return 'My School';
  const { data: settings } = await supabase
    .from('school_settings')
    .select('school_name, logo_url')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (settings?.school_name) return settings.school_name;
  const { data: school } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return school?.name || 'My School';
}

export async function fetchClassFees(schoolId, className, academicYear, term) {
  let q = supabase
    .from('class_fees')
    .select('*')
    .eq('class_name', className)
    .eq('academic_year', academicYear)
    .eq('term', term);
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function fetchAdmissionItems(schoolId) {
  let q = supabase.from('admission_items').select('*');
  if (schoolId) q = q.eq('school_id', schoolId);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * All the class names a teacher is assigned to: merged from the legacy
 * `teachers.class_taught` CSV column and the `teacher_classes_subjects`
 * junction table (multi-class / multi-subject assignments). Used by the
 * teacher dashboards (My Class / Attendance / Home) so a teacher assigned to
 * several classes sees every one of them.
 */
export async function fetchTeacherClassSet(teacherId, classTaught) {
  const set = new Set();
  String(classTaught || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .forEach((c) => set.add(c));
  if (teacherId) {
    try {
      const { data } = await supabase
        .from('teacher_classes_subjects')
        .select('class_name')
        .eq('teacher_id', teacherId);
      (data || []).forEach((a) => {
        if (a.class_name) set.add(a.class_name);
      });
    } catch (err) {
      // best effort
    }
  }
  return [...set].sort();
}