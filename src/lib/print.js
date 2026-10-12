/**
 * Minimal print helper. Opens a print-styled window AND, inside the native
 * Android app, an in-app print sheet preview with Print / Save as PDF
 * (system print dialog) + Save HTML copy.
 */
import { isMobileShell, mobilePrint, mobilePrintPdf, onNativeAction } from "./mobileHost";

function buildPrintDocument(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>` + String(title).replace(/[<>&"]/g, "") + `</title>
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
  ` + bodyHtml + `
  <button class="print-btn" onclick="window.print()">Print</button>
  <script>setTimeout(function(){ window.focus(); }, 200);</script>
</body>
</html>`;
}

export function openPrintWindow(title, bodyHtml) {
  return openPrintFullDocument(title, buildPrintDocument(title, bodyHtml));
}

/**
 * Variant for callers that already have a complete standalone HTML document
 * (report-card builders, etc.). Same desktop popup / mobile sheet behaviour
 * as openPrintWindow.
 */
export function openPrintFullDocument(title, fullHtml) {
  if (isMobileShell()) {
    showMobilePrintSheet(title, fullHtml);
    return null;
  }
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return null;
  win.document.write(fullHtml);
  win.document.close();
  return win;
}

const PRINT_SHEET_ID = "srMobilePrintSheet";

function showMobilePrintSheet(title, doc) {
  if (document.getElementById(PRINT_SHEET_ID)) return;

  const sheet = document.createElement("div");
  sheet.id = PRINT_SHEET_ID;
  sheet.setAttribute("style", "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:#fff;display:flex;flex-direction:column;");

  const bar = document.createElement("div");
  bar.setAttribute("style", "display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #e2e8f0;box-shadow:0 1px 2px #cbd5e1;");
  bar.innerHTML =
    `<button type="button" data-sr-act="print" style="background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;">Save PDF</button>` +
    `<button type="button" data-sr-act="save" style="background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;padding:6px 13px;font-size:13px;font-weight:500;">Save HTML copy</button>` +
    `<button type="button" data-sr-act="close" style="background:#fff;color:#dc2626;border:1px solid #fecaca;border-radius:8px;padding:6px 13px;font-size:13px;font-weight:500;">Close</button>` +
    `<span data-sr-act="title" style="color:#475569;font-size:12px;font-weight:600;margin-left:auto;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">` +
    String(title ?? "").replace(/[<>&"]/g, "") + `</span>`;

  const status = document.createElement("span");
  status.id = "srPrintStatus";
  status.style.color = "#0f766e";
  status.style.fontSize = "12px";
  status.hidden = true;
  bar.appendChild(status);

  const frame = document.createElement("iframe");
  frame.id = "srPrintFrame";
  frame.setAttribute("style", "flex:1;border:0;width:100%;height:100%;");
  frame.setAttribute("srcdoc", doc);

  sheet.appendChild(bar);
  sheet.appendChild(frame);
  document.body.appendChild(sheet);

  if (!document.querySelector("style[data-sr-print]")) {
    const css = document.createElement("style");
    css.setAttribute("data-sr-print", "1");
    css.textContent =
      `@media print { body * { visibility: hidden; } #` + PRINT_SHEET_ID +
      `, #` + PRINT_SHEET_ID + ` * { visibility: visible; } #` + PRINT_SHEET_ID +
      ` { position: absolute !important; left:0; top:0; width:100%; } }`;
    document.head.appendChild(css);
  }

  let statusHideTimer = null;
  const setStatus = (text, tone, autoHideMs = 5000) => {
    status.hidden = false;
    status.style.color = tone === "err" ? "#dc2626" : "#0f766e";
    status.textContent = text;
    if (statusHideTimer) clearTimeout(statusHideTimer);
    if (autoHideMs > 0) statusHideTimer = setTimeout(() => { status.hidden = true; }, autoHideMs);
  };

  bar.querySelector("[data-sr-act=close]").addEventListener("click", () => {
    document.body.removeChild(sheet);
  });
  bar.querySelector("[data-sr-act=print]").addEventListener("click", () => {
    // Hand the document to the native app, which renders a REAL PDF
    // headlessly and stores it in the device Downloads (window.print() is a
    // no-op in a WebView). The native side falls back to the system print
    // dialog ("Save as PDF") if headless rendering fails.
    if (mobilePrintPdf(title ?? "Document", doc)) {
      setStatus("Preparing your PDF... it will be saved to Downloads.", "ok", 0);
      clearTimeout(printAckTimer);
      printAckTimer = setTimeout(() => {
        setStatus("PDF export needs the latest SchoolRunner app - use Save HTML copy.", "err");
      }, 30000);
      return;
    }
    try { window.print(); } catch (err) { setStatus("Printing unavailable here - use Save HTML copy.", "err"); }
  });
  bar.querySelector("[data-sr-act=save]").addEventListener("click", () => {
    if (mobilePrint(title ?? "Document", doc)) setStatus("Saving to SchoolRunner/Print...", "ok");
    else setStatus("Could not save on this device.", "err");
  });
}

// The native shell reports the PDF result: "saved:<file>" (written to the
// device Downloads), "dialog" (system print dialog opened as a fallback) or
// "failed".
let printAckTimer = null;

onNativeAction("printPdf", (result) => {
  if (printAckTimer) {
    clearTimeout(printAckTimer);
    printAckTimer = null;
  }
  const status = document.getElementById("srPrintStatus");
  if (!status) return;
  const value = String(result ?? "");
  status.hidden = false;
  if (value.startsWith("saved:")) {
    status.style.color = "#0f766e";
    status.textContent = "PDF saved to Downloads: " + value.slice(6);
  } else if (value === "dialog") {
    status.style.color = "#0f766e";
    status.textContent = "Print dialog open - choose Save as PDF (or a printer).";
  } else {
    status.style.color = "#dc2626";
    status.textContent = "Could not create the PDF - use Save HTML copy.";
  }
});

onNativeAction("print", (name) => {
  const status = document.getElementById("srPrintStatus");
  if (!status) return;
  status.hidden = false;
  status.style.color = "#0f766e";
  status.textContent = "Saved to SchoolRunner/Print: " + String(name ?? "");
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}