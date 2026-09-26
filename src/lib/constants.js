export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  SUB_ADMIN: 'sub_admin',
  TEACHER: 'teacher',
  ACCOUNTANT: 'accountant',
  STUDENT: 'student',
  PARENT: 'parent',
};

export const ROLE_LABELS = {
  super_admin: 'Super Administrator',
  admin: 'School Administrator',
  sub_admin: 'Sub Administrator',
  teacher: 'Teacher',
  accountant: 'Accountant',
  student: 'Student',
  parent: 'Parent',
};

export const TERMS = ['First', 'Second', 'Third'];

export const TERM_LABELS = {
  First: 'First Term',
  Second: 'Second Term',
  Third: 'Third Term',
};

export const PAYMENT_METHODS = [
  'cash',
  'mobile_money',
  'bank_transfer',
  'cheque',
  'other',
];

export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  other: 'Other',
};

export const GENDERS = ['Male', 'Female', 'Other'];

export const RELIGIONS = ['Christian', 'Muslim', 'Others'];

export const CLASS_LEVELS = ['creche', 'nursery', 'kg', 'primary', 'jhs'];

export const CLASS_LEVEL_LABELS = {
  creche: 'Creche',
  nursery: 'Nursery',
  kg: 'Kindergarten',
  primary: 'Primary',
  jhs: 'Junior High',
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const PRIORITY_LABELS = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const STORAGE_BUCKETS = {
  studentPhotos: 'student-photos',
  applications: 'applications',
  logos: 'school-logos',
  documents: 'documents',
};

export function currentAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}