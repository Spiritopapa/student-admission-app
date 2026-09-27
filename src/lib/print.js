/**
 * Minimal print helper: opens a print-styled window and triggers the
 * browser print dialog. Mirrors the legacy openPrintWindow() utility.
 *
 * The body HTML is kept intentionally plain (table/p/inline styles) so the
 * print output is identical across browsers and the school's printer.
 */
export function openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) {
    return null;
  }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${String(title).replace(/[<>&"]/g, '')}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 6px; }
    p, .meta { font-size: 12px; color: #444; margin: 2px 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #999; padding: 5px 7px; font-size: 11.5px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; }
    .right { text-align: right; }
    .total-row td { font-weight: 700; background: #f8fafc; }
    .print-btn { margin: 12px 0; padding: 8px 18px; font-size: 13px; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  ${bodyHtml}
  <button class="print-btn" onclick="window.print()">Print</button>
  <script>setTimeout(function(){ window.focus(); }, 200);<\/script>
</body>
</html>`);
  win.document.close();
  return win;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}