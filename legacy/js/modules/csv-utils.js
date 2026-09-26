/**
 * csv-utils.js — Shared, RFC 4180–compliant CSV helpers.
 *
 * Used by the admin Students tab (bulk export / import) and available to any
 * future module that needs spreadsheet import/export. All helpers are plain
 * JavaScript (no browser-only APIs) except `downloadCSV`, which triggers a
 * client-side file download.
 */

// ================================================================
// Cell escaping / document building
// ================================================================

/**
 * Escape a single CSV cell. A cell is wrapped in double quotes when it contains
 * a comma, double quote, carriage return or line feed, or when it starts/ends
 * with whitespace (so Excel keeps the value verbatim). Embedded quotes are
 * doubled per RFC 4180.
 */
export function escapeCSVCell(val) {
  const str = String(val ?? '');
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\r') ||
    str.includes('\n') ||
    /^[\t ]/u.test(str) ||
    /[\t ]$/u.test(str)
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a complete CSV document from an array of rows (each row is an array of
 * cells). Uses CRLF line endings (RFC 4180) plus a trailing newline so the file
 * opens cleanly in Excel, Google Sheets and Numbers on every platform.
 */
export function buildCSV(rows) {
  return rows.map((row) => row.map(escapeCSVCell).join(',')).join('\r\n') + '\r\n';
}

// ================================================================
// Parsing
// ================================================================

/**
 * Parse a CSV document into rows of cells. Handles:
 *  - a UTF-8 Byte Order Mark (Excel “CSV UTF-8” files start with \uFEFF)
 *  - CRLF, LF and bare-CR line endings (files from Windows, macOS / Numbers)
 *  - quoted fields containing commas, escaped quotes ("") and line breaks
 *  - a missing trailing newline (last row still returned)
 *
 * @param {string} text Raw file contents.
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  let i = 0;

  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted field is an escaped quote.
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { pushCell(); i += 1; continue; }
    if (ch === '\r') {
      pushRow();
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') { pushRow(); i += 1; continue; }
    cell += ch;
    i += 1;
  }
  // Flush a trailing cell/row when the document does not end with a newline.
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

// ================================================================
// Download
// ================================================================

/**
 * Trigger a client-side download of a CSV document.
 *
 * A UTF-8 BOM is prepended by default so Excel recognises the file as UTF-8
 * (important for names with accented characters); disable it only when the
 * caller already adds one. Returns the Blob for callers that need it.
 */
export function downloadCSV(filename, csv, { withBom = true } = {}) {
  const blob = new Blob([withBom ? '\uFEFF' : '', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}