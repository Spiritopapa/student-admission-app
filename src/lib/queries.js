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