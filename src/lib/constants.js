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
  // Full "YYYY/YYYY" format — matches every table (`class_fees.academic_year`,
  // `fees.academic_year`, `school_settings.academic_year`) and the legacy
  // app's getCurrentAcademicYear(). A 2-digit end year (e.g. "2026/27") would
  // silently fail every academic-year lookup.
  return `${startYear}/${startYear + 1}`;
}

/**
 * Academic-year list for <select> combos. Starts at the currently computed
 * academic year and adds `count` years forward, e.g.
 * ["2026/2027", "2027/2028", "2028/2029", ...]. Any `include` values (e.g. an
 * already-stored year on an existing record) are merged in (appended when not
 * part of the current + future run) so an existing selection never disappears.
 */
export function academicYearList(count = 5, include = []) {
  const current = Number(currentAcademicYear().split('/')[0]);
  const extra = new Set();
  (include || []).forEach((y) => {
    if (typeof y === 'string' && /^\d{4}\/\d{4}$/.test(y)) extra.add(y);
  });
  const years = [];
  for (let i = 0; i < count; i += 1) {
    const start = current + i;
    years.push(`${start}/${start + 1}`);
  }
  extra.forEach((y) => {
    if (!years.includes(y)) years.push(y);
  });
  return years;
}
