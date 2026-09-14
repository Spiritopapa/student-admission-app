function escapeCSVCell(val) {
  const str = String(val ?? '');
  return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
}

function studentsToCSV(students) {
  const header = [
    'Student ID','First Name','Middle Name','Last Name','Class','Term','Gender','Date of Birth','Religion','Parent Name','Parent Contact','Home Town','Place of Stay','Teacher','Previous School','Admission Date','Status','Portal Confirmed'
  ];
  const rows = [header];
  students.forEach(s => {
    rows.push([
      s.student_id || '', s.first_name || '', s.middle_name || '', s.last_name || '', s.class_applying || '',
      s.term || '', s.gender || 'Male', s.date_of_birth || '', s.religion || 'Christian', s.parent_name || '',
      s.parent_contact || '', s.home_town || '', s.place_of_stay || '', s.teacher || '', s.previous_school || '',
      s.admission_date || '', s.status || 'admitted', s.portal_confirmed ? 'Yes' : 'No'
    ]);
  });
  return rows.map(r => r.map(escapeCSVCell).join(',')).join('\n');
}

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

const sample = [
  { student_id: 'STU001', first_name: 'Ama', middle_name: '', last_name: 'Mensah', class_applying: 'JHS 1A', term: 'First', gender: 'Female', date_of_birth: '2010-01-01', religion: 'Christian', status: 'admitted', portal_confirmed: true },
  { student_id: 'STU002', first_name: 'Kofi', middle_name: 'Kwame', last_name: 'Asante', class_applying: 'JHS 1A, Morning', term: 'Second', gender: 'Male', status: 'pending', portal_confirmed: false }
];
const csv = studentsToCSV(sample);
console.log('===== EXPORTED CSV =====');
console.log(csv);
console.log('=======================');

// simulate import
const lines = csv.split('\n').filter(l => l.trim());
const header = parseCSVLine(lines[0]);
const colMap = {};
const expectedCols = ['Student ID','First Name','Middle Name','Last Name','Class','Term','Gender','Date of Birth','Religion','Parent Name','Parent Contact','Home Town','Place of Stay','Teacher','Previous School','Admission Date','Status','Portal Confirmed'];
expectedCols.forEach(col => {
  const idx = header.findIndex(h => h.toLowerCase().trim() === col.toLowerCase().trim());
  if (idx >= 0) colMap[col] = idx;
});
console.log('colMap:', JSON.stringify(colMap));
console.log('Class detected:', 'Class' in colMap);
for (let i = 1; i < lines.length; i++) {
  const vals = parseCSVLine(lines[i]);
  const getVal = (col) => (colMap[col] !== undefined ? vals[colMap[col]]?.trim() || '' : '');
  console.log('Row', i, 'Class =', JSON.stringify(getVal('Class')));
}
function simulateImport(csvText, label, expectedClasses) {
  const lines = csvText.split('\n').filter(l => l.trim());
  const header = parseCSVLine(lines[0]);
  const colMap = {};
  const expectedCols = ['Student ID','First Name','Middle Name','Last Name','Class','Term','Gender','Date of Birth','Religion','Parent Name','Parent Contact','Home Town','Place of Stay','Teacher','Previous School','Admission Date','Status','Portal Confirmed'];
  expectedCols.forEach(col => {
    const idx = header.findIndex(h => h.toLowerCase().trim() === col.toLowerCase().trim());
    if (idx >= 0) colMap[col] = idx;
  });
  const classFound = 'Class' in colMap;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const getVal = (col) => (colMap[col] !== undefined ? vals[colMap[col]]?.trim() || '' : '');
    rows.push(getVal('Class'));
  }
  const ok = classFound && rows.every((v, i) => v === expectedClasses[i]);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label} -> Class detected: ${classFound}, values: ${JSON.stringify(rows)}`);
}

simulateImport(csv, 'plain exported CSV', ['JHS 1A', 'JHS 1A, Morning']);

const excelLike = '\ufeff' + csv.split('\n').map(l => l + '\r').join('\n');
simulateImport(excelLike, 'Excel UTF-8 BOM + CRLF', ['JHS 1A', 'JHS 1A, Morning']);

const sample2 = [
  { student_id: 'STU001', first_name: 'Ama', middle_name: '', last_name: 'Mensah', class_applying: 'JHS 1A', term: 'First' },
  { student_id: 'STU002', first_name: 'Kofi', middle_name: '', last_name: 'Asante', class_applying: 'JHS 1A', term: 'First' }
];
const cols2 = ['Student ID','First Name','Middle Name','Last Name','Class','Term'];
const reorderCsv = [
  cols2.join(','),
  sample2.map(s => [s.student_id, s.first_name, s.middle_name, s.last_name, s.term, s.class_applying].join(',')).join('\n')
].join('\n');
simulateImport(reorderCsv, 'reordered columns (Class moved to last)', ['JHS 1A', 'JHS 1A']);
