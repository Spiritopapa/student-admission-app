/**
 * Shared utilities for the Multi-Choice Assessments module.
 * Used by admin-assessments.js, teacher-assessments.js and assessment-taking.js
 */

// ================================================================
// HTML escaping for safe innerHTML interpolation
// ================================================================
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================================================================
// Bulk question parser
// Accepts tab-separated or CSV text, supports:
//   - a header row (detected automatically)
//   - '#' comments
//   - carry-forward of empty subject / class / topic
// Columns: subject, class, topic, question, A, B, C, D, correct, explanation
// ================================================================
export function parseBulkQuestions(text, defaultSubject, defaultClass) {
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else current += ch;
    }
    result.push(current);
    return result;
  };

  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  let carrySubject = (defaultSubject || '').trim();
  let carryClass = (defaultClass || '').trim();
  let carryTopic = '';
  let headerSeen = false;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    // Detect header (contains keyword 'question' or 'correct')
    const probe = line.toLowerCase();
    if (!headerSeen && (/question/.test(probe) || /subject/.test(probe))) {
      headerSeen = true;
      return;
    }
    headerSeen = true; // any remaining line is data once the first data row is seen

    let vals;
    if (line.includes('\t')) vals = line.split('\t');
    else vals = parseCSVLine(line);

    // Trim all
    vals = vals.map((v) => (v == null ? '' : String(v).trim()));

    let subject = vals[0] || '';
    let cls = vals[1] || '';
    let topic = vals[2] || '';
    const question = vals[3] || '';
    const optA = vals[4] || '';
    const optB = vals[5] || '';
    const optC = vals[6] || '';
    const optD = vals[7] || '';
    let correct = (vals[8] || '').toUpperCase();
    const explain = vals[9] || '';

    if (subject) carrySubject = subject;
    else subject = carrySubject;

    if (cls) carryClass = cls;
    else cls = carryClass;

    if (topic) carryTopic = topic;
    else topic = carryTopic;

    if (!question) return;
    if (!subject) return;
    if (!['A', 'B', 'C', 'D'].includes(correct)) {
      throw new Error(`Row ${idx + 1}: invalid/missing correct option "${vals[8] || ''}" (must be A, B, C or D).`);
    }

    rows.push({
      subject,
      class_name: cls || null,
      topic: topic || null,
      question_text: question,
      option_a: optA,
      option_b: optB,
      option_c: optC,
      option_d: optD,
      correct_option: correct,
      explanation: explain || null,
    });
  });

  return rows;
}

// ================================================================
// Insert rows in chunks (Supabase cap ~1000 rows per insert)
// ================================================================
export async function insertRowsChunked(supabase, table, rows, chunkSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}

// ================================================================
// Download a CSV template
// ================================================================
export function downloadTemplate(name) {
  const header = ['subject', 'class', 'topic', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'correct', 'explanation'];
  const sample = [
    ['Mathematics', 'JHS 2', 'Fractions', '1/2 + 1/4 = ?', '1/2', '3/4', '1/4', '2/3', 'B', 'Common denominator is 4'],
    ['Mathematics', 'JHS 2', 'Fractions', 'Which fraction equals 0.5?', '3/4', '1/2', '1/3', '2/5', 'B', ''],
  ];
  const csv = [header.join(','), ...sample.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))]
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'assessment-questions'}-template.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ================================================================
// Stable hash to seed "randomization" client-side (per student)
// Keeps per-question previews stable for a given browser session.
// ================================================================
export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
// ================================================================
// Print shell builder (shared by student result & admin/teacher results)
// ================================================================
export function buildPrintShell(title, bodyHtml) {
  return `<html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:1.25rem;color:#1e293b;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .ph{text-align:center;margin-bottom:1rem;}
  .ph h2{margin:0.1rem 0;color:#111827;font-size:1.25rem;}
  .ph h3{margin:0.15rem 0;font-weight:700;color:#0f172a;}
  .ph p{margin:0.2rem 0;color:#64748b;font-size:0.85rem;}
  table{width:100%;border-collapse:collapse;margin-top:0.75rem;}
  th,td{border:1px solid #cbd5e1;padding:0.5rem;text-align:left;font-size:0.85rem;vertical-align:top;}
  th{background:#eef2ff;color:#1e293b;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;}
  tr{page-break-inside:avoid;}
  .pf{margin-top:1.25rem;text-align:center;font-size:0.75rem;color:#64748b;}
  .score-hero{text-align:center;padding:1rem 0 0.75rem;}
  .score-hero .big{font-size:2rem;font-weight:800;}
  .score-hero .meta{color:#64748b;font-size:0.85rem;}
  .rs-passed{color:#065f46;} .rs-failed{color:#b91c1c;}
  .to-badge{display:inline-block;padding:0.15rem 0.7rem;border-radius:999px;font-weight:700;font-size:0.8rem;}
  .to-badge.s{background:#dcfce7;color:#065f46;} .to-badge.f{background:#fee2e2;color:#b91c1c;}
  .answer-row{border:1px solid #e2e8f0;border-left:4px solid #6366f1;border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.6rem;page-break-inside:avoid;}
  .answer-row .q{font-weight:700;margin-bottom:0.35rem;}
  .opt{font-size:0.85rem;margin:0.15rem 0;}
  .right{color:#065f46;font-weight:600;} .wrong{color:#b91c1c;font-weight:600;}
  @media print{body{padding:0;margin:0;} .no-print{display:none!important;}}
</style></head>
<body>${bodyHtml}<div class="pf">Student Admission Portal · ${esc(title)} · Generated: ${new Date().toLocaleString()}</div></body></html>`;
}