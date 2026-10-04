/**
 * Shared teacher profile-field definitions (mirrors the legacy staff form and
 * the teachers table columns added by sql/023 + sql/029).
 *
 * Each entry: [formKey, label, type, options?]
 * Used by the admin staff module (AdminTeachers.jsx) and the staff self
 * profile page (ProfilePage.jsx) so both sides expose the SAME fields.
 */

export const PERSONAL_FIELDS = [
  ['first_name', 'First name', 'text'],
  ['middle_name', 'Middle name', 'text'],
  ['surname', 'Surname', 'text'],
  ['dob', 'Date of birth', 'date'],
  ['gender', 'Gender', 'select', ['Male', 'Female']],
  ['region', 'Region', 'text'],
  ['marital_status', 'Marital status', 'select', ['Single', 'Married', 'Divorced', 'Widowed']],
  ['disability', 'Disability', 'text'],
  ['place_of_birth', 'Place of birth', 'text'],
  ['nationality', 'Nationality', 'text'],
  ['religion', 'Religion', 'text'],
];

export const IDENTIFICATION_FIELDS = [
  ['staff_id', 'Staff ID', 'text'],
  ['mobile_number', 'Mobile number', 'tel'],
  ['ghana_card_number', 'Ghana card number', 'text'],
  ['tin_number', 'TIN number', 'text'],
  ['ntc_number', 'NTC number', 'text'],
  ['ssnit_number', 'SSNIT number', 'text'],
  ['certificate_number', 'Certificate number', 'text'],
  ['emis_code', 'EMIS code', 'text'],
];

export const APPOINTMENT_FIELDS = [
  ['date_first_appointment_district', 'First appointment (district)', 'date'],
  ['date_transfer_last_school', 'Transfer to last school', 'date'],
  ['date_promoted_present_rank', 'Promoted to present rank', 'date'],
  ['date_last_upgrading', 'Last upgrading', 'date'],
  ['school_name', 'School name', 'text'],
  ['school_region', 'School region', 'text'],
  ['circuit', 'Circuit', 'text'],
  ['district', 'District', 'text'],
];

export const RANK_FIELDS = [
  ['rank', 'Rank', 'text'],
  ['salary_scale', 'Salary scale', 'text'],
  ['salary_step', 'Salary step', 'text'],
];

export const EDUCATION_FIELDS = [
  ['date_assumption_district', 'Assumption (district)', 'date'],
  ['date_assumption_present_station', 'Assumption (present station)', 'date'],
  ['college_attended', 'College attended', 'text'],
  ['shs_attended', 'Senior high school', 'text'],
  ['salary_level', 'Salary level', 'text'],
  ['bank_account_name', 'Bank account name', 'text'],
  ['bank_account_number', 'Bank account number', 'text'],
  ['account_branch', 'Account branch', 'text'],
  ['home_town', 'Home town', 'text'],
  ['area_of_specialization', 'Area of specialisation', 'text'],
  ['professional_qualification', 'Professional qualification', 'text'],
  ['academic_qualification', 'Academic qualification', 'text'],
];

export const TEACHER_FIELD_GROUPS = [
  ['Personal information', PERSONAL_FIELDS],
  ['Identification', IDENTIFICATION_FIELDS],
  ['Appointment & school', APPOINTMENT_FIELDS],
  ['Rank & salary', RANK_FIELDS],
  ['Education & additional info', EDUCATION_FIELDS],
];

export const TEACHER_FIELD_KEYS = [
  ...PERSONAL_FIELDS,
  ...IDENTIFICATION_FIELDS,
  ...APPOINTMENT_FIELDS,
  ...RANK_FIELDS,
  ...EDUCATION_FIELDS,
].map((f) => f[0]);

export function fieldLabel(key) {
  for (const [, fields] of TEACHER_FIELD_GROUPS) {
    const hit = fields.find((f) => f[0] === key);
    if (hit) return hit[1];
  }
  return key;
}