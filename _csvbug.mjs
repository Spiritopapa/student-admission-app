import { readFileSync } from 'node:fs';
const NativeURL = globalThis.URL; // keep the native constructor for file paths

// ---- browser API stubs needed by the real code ----
globalThis.window = { location: { href: 'http://localhost/index.html' } };
let capturedBlobText = '';
class BlobStub {
  constructor(parts) { this.__text = parts.join(''); }
}
globalThis.Blob = BlobStub;
function createObjectURL(blob) { capturedBlobText = blob && typeof blob.__text === 'string' ? blob.__text : ''; return 'blob:test'; }
function revokeObjectURL() {}
function createEl() {
  const el = { href: '', download: '', click() {} };
  Object.defineProperty(el, 'href', { set(v) { this._href = v; }, get() { return this._href; } });
  Object.defineProperty(el, 'download', { set(v) { this._download = v; }, get() { return this._download; } });
  return el;
}
globalThis.URL = { createObjectURL, revokeObjectURL };
globalThis.document = { createElement: () => createEl() };
globalThis.alert = (m) => { globalThis.__lastAlert = m; };

// ---- extract the real CSV section from admin-students.js ----
const src = readFileSync(new NativeURL('./js/modules/admin-students.js', import.meta.url), 'utf8');
const startMarker = '// CSV Export - Bulk Export Students Template';
const startIdx = src.indexOf(startMarker);
const endMarker = 'export function setupStudentCSVHandlers';
const endIdx = src.lastIndexOf(endMarker);
if (startIdx === -1 || endIdx === -1) { console.error('markers not found', startIdx, endIdx); process.exit(1); }
const csvSection = src.slice(startIdx, endIdx).trim();

// ---- minimal CSV parser matching utils.js ----
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ----------------------- FAKE DB -----------------------
const dbStudents = new Map(); // student_id -> row
let idCounter = 0;
const fakeSupabase = {
  rpc: async () => ({ data: `STU${String(++idCounter).padStart(3, '0')}` }),
  from: (table) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: null }),
      single: async () => ({ data: {} }),
      insert: async (rows) => {
        if (table === 'applications') for (const r of rows) dbStudents.set(r.student_id, { ...r });
        return { error: null };
      },
      upsert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    return chain;
  },
};

// ----------------------- GLOBALS -----------------------
const allStudents = [];
const els = {
  csvStudentsImportInput: { files: undefined, value: '' },
};
function getEl(id) { return els[id] || null; }
function getCurrentSchoolId() { return Promise.resolve('school-123'); }
function getCurrentAcademicYear() { return '2026/2027'; }
async function loadAllStudentsFn() {
  allStudents.length = 0;
  allStudents.push(...Array.from(dbStudents.values()).map(s => ({ ...s })));
  return;
}
function logSubAdminActivity() {}
function showMessage() {}

// ---------------- evaluate the actual functions ----------------
const factory = new Function(
  'parseCSVLine', 'getCurrentSchoolId', 'getCurrentAcademicYear', 'loadAllStudents', 'logSubAdminActivity',
  'showMessage', 'supabaseClient', 'getEl', 'allStudentsRef',
  `let allStudents = allStudentsRef;
   ${csvSection}
   return { studentsToCSV, exportStudentsCSV, importStudentsCSV };`
);
const module = factory(parseCSVLine, getCurrentSchoolId, getCurrentAcademicYear, loadAllStudentsFn,
  logSubAdminActivity, showMessage, fakeSupabase, getEl, allStudents);

allStudents.push(
  { student_id: 'STU101', first_name: 'Ama', middle_name: '', last_name: 'Mensah', class_applying: 'JHS 1A', term: 'First', gender: 'Female', religion: 'Christian', status: 'admitted', portal_confirmed: true, date_of_birth: '2010-01-01', parent_name: 'P', parent_contact: '055', school_id: 'school-123' },
  { student_id: 'STU102', first_name: 'Kofi', middle_name: 'K', last_name: 'Asante', class_applying: 'JHS 1A', term: 'First', gender: 'Male', religion: 'Christian', status: 'admitted', portal_confirmed: false, date_of_birth: '2010-02-02', parent_name: 'Q', parent_contact: '054', school_id: 'school-123' }
);

await module.exportStudentsCSV();
console.log('===== EXPORTED CSV (real code) =====');
console.log(capturedBlobText);
console.log('====================================');

const exportedText = capturedBlobText;
els.csvStudentsImportInput.files = [{ text: async () => exportedText }];
await module.importStudentsCSV();
console.log('===== ROWS STORED AFTER IMPORT (class_applying) =====');
for (const r of dbStudents.values()) console.log(' ', r.student_id, JSON.stringify(r.class_applying));
const imported = Array.from(dbStudents.values());
console.log('students whose class_applying === "JHS 1A":', imported.filter(s => s.class_applying === 'JHS 1A').length);