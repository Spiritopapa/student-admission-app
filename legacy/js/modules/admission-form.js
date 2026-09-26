/**
 * Student Admission Form (standalone print document)
 * -------------------------------------------------
 * Builds a modern, self-contained HTML "Student Admission Form" that is
 * auto-opened right after a student is admitted. It shows ALL student
 * information, the class (term) fee, every additional admission item with
 * its amount, and the total term fee.
 *
 * The generated document works with openPrintWindow() so it renders in the
 * app's preview/print experience on desktop and mobile.
 */

import { formatCurrency, formatDate, openPrintWindow } from './utils.js';

/** Escape a string for safe insertion into HTML. */
function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** e.g. "First" -> "First Term" */
function termLabel(term) {
  const t = String(term || '');
  return (/^(First|Second|Third)$/.test(t) ? t + ' Term' : t);
}

/** Build the full HTML document (head styles + body). */
export function buildAdmissionFormHTML(params) {
  const {
    studentId = '',
    student = {},
    schoolName = 'My School',
    schoolLogoUrl = '',
    academicYear = '',
    term = 'First',
    classFee = 0,
    items = [],
    totalAmount = 0,
    includeFees = true,
  } = params;

  const fullName = `${student.first_name || ''} ${student.middle_name || ''} ${student.last_name || ''}`.replace(/\s+/g, ' ').trim();
  const logoFallback = (schoolName || 'S').trim().charAt(0).toUpperCase() || 'S';
  const logoHtml = schoolLogoUrl
    ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo" style="width:64px;height:64px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;padding:2px;background:#fff;" />`
    : `<div style="width:64px;height:64px;border-radius:12px;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;">${logoFallback}</div>`;

  const photoHtml = student.student_photo_url
    ? `<img src="${esc(student.student_photo_url)}" alt="Student Photo" style="width:104px;height:124px;object-fit:cover;border-radius:10px;border:2px solid #cbd5e1;" />`
    : `<div style="width:104px;height:124px;border-radius:10px;border:2px dashed #cbd5e1;background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;">Student<br>Photo</div>`;

  const itemRows = (items && items.length > 0)
    ? items.map((it) => `
        <tr>
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:left;">${esc(it.name)}</td>
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:right;">GHC ${formatCurrency(it.amount)}</td>
        </tr>`).join('')
    : '';

  const itemSection = items && items.length > 0 ? `
        <tr style="background:#eef2ff;">
          <td colspan="2" style="padding:0.55rem 1rem;border:1px solid #e2e8f0;font-weight:700;color:#1e40af;">Additional Admission Fees</td>
        </tr>
        ${itemRows}
      ` : '';

  const infoRow = (label, value) => `
    <tr>
      <td style="padding:0.5rem 0.9rem;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#334155;width:42%;">${esc(label)}</td>
      <td style="padding:0.5rem 0.9rem;border:1px solid #e2e8f0;color:#0f172a;">${esc(value)}</td>
    </tr>`;

  const generatedAt = formatDate(new Date().toISOString());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Student Admission Form - ${esc(fullName)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f5f9; }
    @media print { html, body { background: #fff; } }
    .page {
      max-width: 820px; margin: 1.2rem auto; padding: 2rem 2.2rem;
      background: #fff; border-radius: 16px; box-shadow: 0 10px 30px rgba(15,23,42,0.12);
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #0f172a; font-size: 14px; line-height: 1.5;
    }
    @media print {
      .page { max-width: 100%; margin: 0; padding: 1.2rem; box-shadow: none; border-radius: 0; }
    }
    .header { display: flex; align-items: center; gap: 1rem; border-bottom: 3px solid #1e3a5f; padding-bottom: 0.9rem; }
    .header-right { flex: 1; text-align: center; }
    .header-right h1 { margin: 0.15rem 0 0; font-size: 1.5rem; letter-spacing: 0.03em; color: #1e3a5f; }
    .header-right .sub { margin: 0.25rem 0 0; color: #64748b; font-size: 0.85rem; }
    .badge {
      display: inline-block; background: #1e3a5f; color: #fff; font-weight: 700;
      padding: 0.32rem 0.9rem; border-radius: 20px; font-size: 0.78rem; margin-top: 0.35rem;
    }
    .meta { display: flex; justify-content: space-between; gap: 1rem; margin: 1.1rem 0 0.4rem; font-size: 0.95rem; color: #334155; }
    .meta strong { color: #0f172a; }
    .photo-card { display: flex; gap: 1.4rem; margin-top: 0.9rem; }
    .photo-frame { flex: 0 0 auto; }
    .section-title {
      display: flex; align-items: center; gap: 0.5rem;
      background: #eef2ff; color: #1e40af; font-weight: 700; font-size: 0.98rem;
      padding: 0.45rem 0.9rem; border-radius: 8px; margin: 1.1rem 0 0.6rem;
    }
    table.details { width: 100%; border-collapse: collapse; }
    .note { margin-top: 1rem; font-size: 0.82rem; color: #64748b; }
    .signatures { display: flex; gap: 2rem; margin-top: 2.2rem; }
    .signature-box { flex: 1; text-align: center; }
    .sign-line { border-bottom: 1px solid #94a3b8; height: 2.4rem; }
    .signature-box .label { color: #475569; font-size: 0.82rem; margin-top: 0.4rem; }
    .footer {
      margin-top: 1.4rem; text-align: center; color: #94a3b8; font-size: 0.75rem;
      border-top: 1px solid #e2e8f0; padding-top: 0.5rem;
    }
    .stamp {
      text-align: right; color: #1e3a5f; font-weight: 700; font-size: 0.85rem;
      letter-spacing: 0.05em; margin-top: 0.3rem;
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- ===== HEADER ===== -->
    <div class="header">
      ${logoHtml}
      <div class="header-right">
        <h1>Student Admission Form</h1>
        <p class="sub">${esc(schoolName)} &middot; Official Document</p>
        <span class="badge">Admitted &middot; ${esc(studentId)}</span>
      </div>
    </div>

    <!-- ===== META ===== -->
    <div class="meta">
      <div><strong>Academic Year:</strong> ${esc(academicYear)}</div>
      <div><strong>Term:</strong> ${esc(termLabel(term))}</div>
      <div><strong>Admission Date:</strong> ${esc(student.admission_date ? formatDate(student.admission_date) : '—')}</div>
    </div>

    <!-- ===== STUDENT INFO ===== -->
    <div class="section-title">&#128221; Student Information</div>
    <div class="photo-card">
      <div class="photo-frame">${photoHtml}</div>
      <table class="details">
        <tbody>
          ${infoRow('Full Name', fullName)}
          ${infoRow('Gender', student.gender || '—')}
          ${infoRow('Date of Birth', student.date_of_birth ? formatDate(student.date_of_birth) : '—')}
          ${infoRow('Religion', student.religion || '—')}
          ${infoRow('Class / Grade', student.class_applying || '—')}
          ${infoRow('Form Teacher', student.teacher || '—')}
          ${infoRow('Previous School', student.previous_school || '—')}
        </tbody>
      </table>
    </div>

    <!-- ===== PARENT / CONTACT ===== -->
    <div class="section-title">&#128101; Parent / Guardian &amp; Contact</div>
    <table class="details">
      <tbody>
        ${infoRow('Parent / Guardian Name', student.parent_name || '—')}
        ${infoRow('Parent / Guardian Contact', student.parent_contact || '—')}
        ${infoRow('Home Town', student.home_town || '—')}
        ${infoRow('Place of Stay', student.place_of_stay || '—')}
      </tbody>
    </table>

    ${includeFees ? `
    <!-- ===== FEES ===== -->
    <div class="section-title">&#128176; Term Fees (${esc(academicYear)} &middot; ${esc(termLabel(term))})</div>
    <table class="details">
      <tbody>
        <tr style="background:#eff6ff;">
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;font-weight:700;color:#1e40af;">Class (Term) Fee</td>
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:right;font-weight:600;">GHC ${formatCurrency(classFee)}</td>
        </tr>
        ${itemSection}
        <tr style="padding:0.6rem 1rem;border:1px solid #e2e8f0;background:#1e3a5f;color:#fff;font-weight:800;font-size:1.02rem;">
          <td style="padding:0.6rem 1rem;">TOTAL TERM FEE</td>
          <td style="padding:0.6rem 1rem;text-align:right;">GHC ${formatCurrency(totalAmount)}</td>
        </tr>
      </tbody>
    </table>` : ''}

    ${includeFees
      ? `<p class="note">
      This form confirms that <strong>${esc(fullName)}</strong> has been admitted
      to <strong>${esc(schoolName)}</strong> for the
      <strong>${esc(termLabel(term))}</strong> of the
      <strong>${esc(academicYear)}</strong> academic year. The total term fee payable
      is <strong>GHC ${formatCurrency(totalAmount)}</strong>. Items marked under
      &ldquo;Additional Admission Fees&rdquo; are charges agreed at admission.
    </p>`
      : `<p class="note">
      This form confirms that <strong>${esc(fullName)}</strong> has been admitted
      to <strong>${esc(schoolName)}</strong> for the
      <strong>${esc(termLabel(term))}</strong> of the
      <strong>${esc(academicYear)}</strong> academic year.
    </p>`}

    <!-- ===== SIGNATURES ===== -->
    <div class="signatures">
      <div class="signature-box">
        <div class="sign-line"></div>
        <div class="label">Parent / Guardian Signature</div>
      </div>
      <div class="signature-box">
        <div class="sign-line"></div>
        <div class="label">Headmaster / Administrator Signature</div>
      </div>
    </div>
    <div class="stamp">Stamp &amp; Seal</div>

    <div class="footer">Generated by the Student Admission Portal &middot; ${esc(schoolName)} &middot; ${esc(generatedAt)}</div>
  </div>
</body>
</html>`;
}

/**
 * Open / print the generated admission form through the app's print window.
 * @returns {Window|null} the print handle (used by legacy win.focus() callers).
 */
export function openAdmissionForm(params, title = 'Student Admission Form') {
  const html = buildAdmissionFormHTML(params);
  return openPrintWindow(html, title, 900, 800);
}