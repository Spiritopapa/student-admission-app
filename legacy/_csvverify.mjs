/**
 * Verification harness for the refactored student CSV export / import code in
 * admin-students.js. Extracts the live CSV section, evaluates it with mocked
 * browser + Supabase clients, and asserts the important behaviours:
 *
 *   1. Export produces an RFC 4180 CSV (CRLF line endings, quoted commas).
 *   2. Export → import round-trip preserves class_applying (incl. commas).
 *   3. Excel "CSV UTF-8" files (BOM + CRLF + reordered headers) import cleanly.
 *   4. Date cells in DD/MM/YYYY and Excel serial form are normalised to ISO.
 *   5. Re-importing an exported file skips duplicates instead of re-inserting.
 *   6. Invalid rows are skipped with clear messages.
 *   7. The import template download contains header + example rows.
 *
 * Run: node _csvverify.mjs
 */

import { readFileSync } from 'node:fs';
const NativeURL = globalThis.URL; // keep the native constructor for file paths

// Load the real csv-utils module source (ESM) via a small CJS shim so this
// harness exercises the exact production parser/builder functions.
const csvUtilsSrc = readFileSync(new NativeURL('./js/modules/csv-utils.js', import.meta.url), 'utf8');
const { buildCSV, parseCSV } = new Function(
  `${csvUtilsSrc.replace(/^export\s+/gm, '')}\nreturn { buildCSV, parseCSV, escapeCSVCell };`
)();

// ---- browser API stubs needed by the extracted code ----
globalThis.window = { location: { href: 'http://localhost/index.html' } };
let capturedDownload = null;
globalThis.document = {
  createElement: () => {
    const el = { href: '', download: '', click() {} };
    Object.defineProperty(el, 'href', { set(v) { this._href = v; }, get() { return this._href; } });
    Object.defineProperty(el, 'download', { set(v) { this._download = v; }, get() { return this._download; } });
    return el;
  },
  body: { appendChild() {}, removeChild() {} },
};
globalThis.URL = {
  createObjectURL: (blob) => { capturedDownload = { blob, text: blob && blob.__text || '' }; return 'blob:test'; },
  revokeObjectURL() {},
};
class BlobStub { constructor(parts) { this.__text = (parts || []).join(''); } }
globalThis.Blob = BlobStub;
globalThis.alert = (m) => { globalThis.__lastAlert = m; };
globalThis.setTimeout = (fn) => {};

// ---- extract the live CSV section from admin-students.js ----
const src = readFileSync(new NativeURL('./js/modules/admin-students.js', import.meta.url), 'utf8');
const startMarker = '// CSV Export - Bulk Export Students Template';
const startIdx = src.indexOf(startMarker);
const endMarker = 'export function setupStudentCSVHandlers';
const endIdx = src.lastIndexOf(endMarker);
if (startIdx === -1 || endIdx === -1) { console.error('markers not found', startIdx, endIdx); process.exit(1); }
const csvSection = src.slice(startIdx, endIdx).trim();

// ---- browser download stub passed to the extracted code ----
function downloadCSVStub(filename, csv) { capturedDownload = { filename, csv }; }

// ----------------------- FAKE DB -----------------------
const dbStudents = new Map(); // student_id -> row
const dbFees = new Map();     // student_id|academic_year|term -> row
let idCounter = 0;

function seedStudent(id, extra = {}) {
  const row = {
    student_id: id,
    first_name: 'Ama',
    middle_name: '',
    last_name: 'Mensah',
    class_applying: 'JHS 1A',
    term: 'First',
    gender: 'Female',
    date_of_birth: '2010-01-01',
    religion: 'Christian',
    parent_name: 'Akosua Mensah',
    parent_contact: '0551234567',
    home_town: '',
    place_of_stay: '',
    teacher: '',
    previous_school: '',
    admission_date: null,
    status: 'admitted',
    portal_confirmed: false,
    sub_admin_approved: false,
    school_id: 'school-123',
    ...extra,
  };
  dbStudents.set(id, row);
  return row;
}

function makeQuery(table, params = {}) {
  const chain = {
    select(cols) { params.select = cols; return chain; },
    eq(col, v) { (params.eq = params.eq || {})[col] = v; return chain; },
    order(...a) { params.order = a; return chain; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    single() { return Promise.resolve({ data: {}, error: null }); },
    insert(rows) {
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        if (table === 'applications') dbStudents.set(r.student_id, { ...r });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert(rows) {
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        if (table === 'fees') dbFees.set(`${r.student_id}|${r.academic_year}|${r.term}`, { ...r });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve) {
      let data = [];
      if (table === 'applications') data = Array.from(dbStudents.values()).map((s) => ({ ...s }));
      else if (table === 'class_fees') {
        data = [
          { class_name: 'JHS 1A', term: 'First', fee_amount: 500, academic_year: '2026/2027' },
          { class_name: 'JHS 2A', term: 'Second', fee_amount: 600, academic_year: '2026/2027' },
        ];
      } else if (table === 'fees') data = Array.from(dbFees.values()).map((f) => ({ ...f }));
      else if (table === 'classes') data = configuredClassNames.map((name) => ({ name }));
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return chain;
}

const fakeSupabase = {
  rpc: async (fn) => {
    if (fn === 'generate_student_id') {
      return { data: `STU-${String(++idCounter).padStart(4, '0')}`, error: null };
    }
    return { data: null, error: null };
  },
  from: (table) => makeQuery(table),
};

// Classes configured for the school through the add-class (Classes) module.
const configuredClassNames = ['JHS 1A', 'JHS 1A, Morning', 'JHS 2A'];
function loadConfiguredClassesStub() { return Promise.resolve([...configuredClassNames]); }

// ----------------------- GLOBALS -----------------------
const allStudents = [];
const els = {
  adminStudentsClassFilter: { value: '' },
  adminStudentsGenderFilter: { value: '' },
  adminStudentsSearch: { value: '' },
  csvStudentsImportInput: { files: undefined, value: '' },
};
function getEl(id) { return els[id] || null; }
function getCurrentSchoolId() { return Promise.resolve('school-123'); }
function getCurrentAcademicYear() { return '2026/2027'; }
async function loadAllStudentsFn() {
  allStudents.length = 0;
  allStudents.push(...Array.from(dbStudents.values()).map((s) => ({ ...s })));
}
function logSubAdminActivity() {}
function showMessage() {}
function buildStudentName(f, m, l) { return [f, m, l].filter(Boolean).join(' '); }

// ---------------- evaluate the actual functions ----------------
const factory = new Function(
  'parseCSV', 'buildCSV', 'downloadCSV', 'buildStudentName',
  'getCurrentSchoolId', 'getCurrentAcademicYear', 'loadAllStudents',
  'logSubAdminActivity', 'showMessage', 'supabaseClient', 'getEl', 'allStudentsRef',
  'loadConfiguredClasses',
  `let allStudents = allStudentsRef;
   ${csvSection}
   return { studentsToCSV, exportStudentsCSV, importStudentsCSV, downloadStudentImportTemplate, buildStudentColumnMap, normalizeDateCell };`
);
const module = factory(
  parseCSV, buildCSV, downloadCSVStub, buildStudentName,
  getCurrentSchoolId, getCurrentAcademicYear, loadAllStudentsFn,
  logSubAdminActivity, showMessage, fakeSupabase, getEl, allStudents,
  loadConfiguredClassesStub
);
// ===================== TEST 1: EXPORT =====================
dbStudents.clear();
dbFees.clear();
idCounter = 0;
seedStudent('STU101', { first_name: 'Ama', middle_name: '', last_name: 'Mensah', class_applying: 'JHS 1A' });
seedStudent('STU102', { first_name: 'Kofi', middle_name: 'K', last_name: 'Asante', class_applying: 'JHS 1A, Morning', gender: 'Male', parent_contact: "'0549876543" });
await loadAllStudentsFn(); // populate the in-memory cache like a page load would

await module.exportStudentsCSV();
const exported = capturedDownload.csv;
console.log('===== EXPORTED CSV =====');
console.log(exported);
console.log('========================');

const hasCrlf = exported.includes('\r\n');
const headerLine = exported.split('\r\n')[0];
const classColIndex = headerLine.split(',').indexOf('Class');
const rows1 = parseCSV(exported);
const test1 = hasCrlf && rows1.length === 3 && rows1[2][classColIndex] === 'JHS 1A, Morning';
console.log(`[${test1 ? 'PASS' : 'FAIL'}] export: CRLF line endings + comma-class kept inside quotes -> ${JSON.stringify(rows1[2][classColIndex])}`);

// ===================== TEST 2: RE-IMPORT OF EXPORT SKIPS DUPLICATES =====================
const before = dbStudents.size;
els.csvStudentsImportInput.files = [{ name: 'export.csv', text: async () => exported }];
await module.importStudentsCSV();
const reimportAlert = globalThis.__lastAlert || '';
const test2 = dbStudents.size === before && reimportAlert.includes('already exists');
console.log(`[${test2 ? 'PASS' : 'FAIL'}] re-importing the exported file does NOT duplicate students (db ${dbStudents.size} === ${before})`);
console.log('  alert:', reimportAlert.split('\n')[0]);
globalThis.__lastAlert = undefined;

// ===================== TEST 3: ROUND-TRIP CLASS PRESERVATION =====================
// New students (names/D.O.B. not in the DB) imported from a CSV that mirrors the
// export template, including a class whose name contains a comma.
const roundTripCsv =
  'Student ID,First Name,Middle Name,Last Name,Class,Term,Gender,Date of Birth,Religion,Parent Name,Parent Contact,Home Town,Place of Stay,Teacher,Previous School,Admission Date,Status,Portal Confirmed\r\n' +
  ',Akosua,,Kwarteng,"JHS 1A, Morning",First,Female,2011-05-05,Christian,Ama Kwarteng,0551111111,,,Mrs. Owusu,,2026-09-01,admitted,No\r\n' +
  ',Kwame,,Boateng,JHS 2A,Second,Male,2012-06-06,Muslim,Kofi Boateng,0542222222,,,Mr. Ansah,,2026-09-01,pending,Yes\r\n';
const before3 = dbStudents.size;
els.csvStudentsImportInput.files = [{ name: 'round-trip.csv', text: async () => roundTripCsv }];
await module.importStudentsCSV();
globalThis.__lastAlert = undefined;
const importedRows = Array.from(dbStudents.values());
const kwarteng = importedRows.find((s) => s.last_name === 'Kwarteng');
const boateng = importedRows.find((s) => s.last_name === 'Boateng');
const feeRows = Array.from(dbFees.values());
const test3 = dbStudents.size === before3 + 2 &&
  kwarteng && kwarteng.class_applying === 'JHS 1A, Morning' &&
  boateng && boateng.class_applying === 'JHS 2A' && boateng.portal_confirmed === true && boateng.status === 'pending' &&
  feeRows.length === 2;
console.log(`[${test3 ? 'PASS' : 'FAIL'}] round-trip import preserves class values (incl. "JHS 1A, Morning") + creates fee records`);
console.log('  class_applying after import:', importedRows.map((s) => JSON.stringify(s.class_applying)).join(', '));

// ===================== TEST 4: NATURAL-KEY DUPLICATE SKIPPED =====================
const before4 = dbStudents.size;
els.csvStudentsImportInput.files = [{ name: 'round-trip.csv', text: async () => roundTripCsv }];
await module.importStudentsCSV();
const dupAlert = globalThis.__lastAlert || '';
const test4 = dbStudents.size === before4 && dupAlert.includes('duplicate');
console.log(`[${test4 ? 'PASS' : 'FAIL'}] re-importing the same new students is blocked by the natural-key duplicate check`);
console.log('  alert:', dupAlert.split('\n')[0]);
globalThis.__lastAlert = undefined;

// ===================== TEST 5: EXCEL BOM + CRLF + REORDERED/ALIASED HEADERS =====================
const excelCsv =
  '\uFEFFParent Phone,DOB,Class,Gender,Parent/Guardian Name,First Name,Surname,Term,Student ID,Religion,Portal Confirmed\r\n' +
  '0547777777,15/04/2013,JHS 2A,Male,Yaw Asante,Kofi,Asante,Second,,Muslim,No\r\n' +
  '0201234567,41379,JHS 1A,Female,Maame Appiah,Akua,Appiah,First,KOFI-01,Christian,Yes\r\n' +
  '0550000000,2012-01-01,JHS 1A,Male,Kwame Yeboah,Kwame,Yeboah,Third,,Others,No\r\n';
els.csvStudentsImportInput.files = [{ name: 'excel.csv', text: async () => excelCsv }];
await module.importStudentsCSV();
const kofiExcel = Array.from(dbStudents.values()).find((s) => s.first_name === 'Kofi' && s.class_applying === 'JHS 2A' && s.term === 'Second');
const akua = Array.from(dbStudents.values()).find((s) => s.student_id === 'KOFI-01');
const yeboah = Array.from(dbStudents.values()).find((s) => s.first_name === 'Kwame' && s.last_name === 'Yeboah');
const test5 = !!kofiExcel && kofiExcel.date_of_birth === '2013-04-15' &&
  !!akua && akua.date_of_birth === '2013-04-15' && akua.portal_confirmed === true &&
  !!yeboah && yeboah.gender === 'Male' && yeboah.religion === 'Others';
console.log(`[${test5 ? 'PASS' : 'FAIL'}] Excel BOM + CRLF + reordered/aliased headers import correctly`);
console.log('  DOB normalized (dd/mm and Excel serial):', kofiExcel && kofiExcel.date_of_birth, '|', akua && akua.date_of_birth);

// ===================== TEST 6: INVALID ROW SKIPPED WITH MESSAGE =====================
const badCsv =
  'Student ID,First Name,Last Name,Class,Term,Gender,Date of Birth,Religion,Parent Name,Parent Contact,Status,Portal Confirmed\n' +
  ',Valid,Student,JHS 1A,First,Male,2010-01-01,Christian,Parent One,0551111111,admitted,No\n' +
  ',NoParent,Student,JHS 1A,First,Male,2010-01-01,Christian,,,admitted,No\n';
els.csvStudentsImportInput.files = [{ name: 'bad.csv', text: async () => badCsv }];
await module.importStudentsCSV();
const invalidAlert = globalThis.__lastAlert || '';
const test6 = invalidAlert.includes('1 row(s) skipped') && invalidAlert.includes('Parent Name is required');
console.log(`[${test6 ? 'PASS' : 'FAIL'}] invalid row is skipped with a clear message`);
console.log('  alert:', invalidAlert.split('\n').slice(1, 3).join(' | '));
globalThis.__lastAlert = undefined;

// ===================== TEST 7: IMPORT TEMPLATE =====================
await module.downloadStudentImportTemplate();
const templateRows = parseCSV(capturedDownload.csv);
const test7 = capturedDownload.filename === 'student_import_template.csv' &&
  templateRows.length === 2 && templateRows[0].length === 18 && templateRows[1].length === 18;
console.log(`[${test7 ? 'PASS' : 'FAIL'}] import template downloads with header (18 cols) + one example row`);

// ===================== TEST 8: CLASS MUST EXIST (add-class connection) =====================
const before8 = dbStudents.size;
const classCsv =
  'Student ID,First Name,Last Name,Class,Term,Gender,Date of Birth,Religion,Parent Name,Parent Contact,Status,Portal Confirmed\n' +
  ',Esi,Ampofo,JHS 1A,First,Female,2013-03-03,Christian,Papa Ampofo,0553333333,admitted,No\n' +
  ',Efua,Sarkodie,Grade X,First,Female,2013-04-04,Christian,Papa Sarkodie,0554444444,admitted,No\n' +
  ',Abena,Owusu,jhs 1a,First,Female,2013-05-05,Christian,Papa Owusu,0555555555,admitted,No\n';
els.csvStudentsImportInput.files = [{ name: 'classes.csv', text: async () => classCsv }];
await module.importStudentsCSV();
const classAlert = globalThis.__lastAlert || '';
const ampofo = Array.from(dbStudents.values()).find((s) => s.first_name === 'Esi');
const sarkodie = Array.from(dbStudents.values()).find((s) => s.first_name === 'Efua');
const owusu = Array.from(dbStudents.values()).find((s) => s.first_name === 'Abena');
const test8 = dbStudents.size === before8 + 2 &&
  !!ampofo && ampofo.class_applying === 'JHS 1A' &&
  !sarkodie &&
  !!owusu && owusu.class_applying === 'JHS 1A' &&
  classAlert.includes('1 row(s) skipped') && classAlert.includes('does not exist');
console.log(`[${test8 ? 'PASS' : 'FAIL'}] import: class must exist in the Classes module (case-insensitive match, canonical name used)`);
console.log('  alert:', classAlert.split('\n').slice(1, 3).join(' | '));
globalThis.__lastAlert = undefined;

// ===================== SUMMARY =====================
const results = [test1, test2, test3, test4, test5, test6, test7, test8];
const passed = results.filter(Boolean).length;
console.log(`\n===== ${passed}/${results.length} checks passed =====`);
process.exitCode = passed === results.length ? 0 : 1;