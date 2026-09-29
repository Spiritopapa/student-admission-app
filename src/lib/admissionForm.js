/**
 * admissionForm.js — Printable Student Admission Form (React port)
 * -----------------------------------------------------------------
 * Ports the legacy vanilla `admission-form.js` module so the new React app
 * auto-opens a polished, standalone HTML "Student Admission Form" the moment
 * a student is admitted. It shows ALL student information, the class (term)
 * fee, every additional admission item with its amount, and the total term
 * fee, plus signature lines suitable for printing / signing.
 *
 * The built markup is passed to the shared openPrintWindow() helper so the
 * preview/print experience matches the rest of the app.
 */

import { buildStudentName, formatCurrency, formatDate, termLabel } from './format';
import { openPrintWindow, escapeHtml } from './print';
import { photoUrl } from './storage';

/**
 * Build the printable admission form body (the content rendered inside the
 * shared print window). Inline styles are used so the output is identical
 * across browsers and the school's printer.
 */
export function buildAdmissionFormBody(params = {}) {
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

  const fullName = buildStudentName(student.first_name, student.middle_name, student.last_name);
  const logoFallback = (schoolName || 'S').trim().charAt(0).toUpperCase() || 'S';
  const logoHtml = schoolLogoUrl
    ? `<img src="${escapeHtml(schoolLogoUrl)}" alt="School Logo" style="width:64px;height:64px;object-fit:contain;border-radius:10px;border:1px solid #cbd5e1;padding:2px;background:#fff;" />`
    : `<div style="width:64px;height:64px;border-radius:12px;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;">${logoFallback}</div>`;

  const studentPhoto = student.student_photo_url ? photoUrl(student.student_photo_url) : '';
  const photoHtml = studentPhoto
    ? `<img src="${escapeHtml(studentPhoto)}" alt="Student Photo" style="width:104px;height:124px;object-fit:cover;border-radius:10px;border:2px solid #cbd5e1;" />`
    : `<div style="width:104px;height:124px;border-radius:10px;border:2px dashed #cbd5e1;background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;">Student<br>Photo</div>`;

  const itemRows = (items && items.length > 0)
    ? items.map(
        (it) => `
        <tr>
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:left;">${escapeHtml(it.name)}</td>
          <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:right;">GHC ${formatCurrency(it.amount)}</td>
        </tr>`
      ).join('')
    : '';

  const itemSection = items && items.length > 0
    ? `
        <tr style="background:#eef2ff;">
          <td colspan="2" style="padding:0.55rem 1rem;border:1px solid #e2e8f0;font-weight:700;color:#1e40af;">Additional Admission Fees</td>
        </tr>
        ${itemRows}`
    : '';

  const infoRow = (label, value) => `
    <tr>
      <td style="padding:0.5rem 0.9rem;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#334155;width:42%;">${escapeHtml(label)}</td>
      <td style="padding:0.5rem 0.9rem;border:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(value)}</td>
    </tr>`;

  const generatedAt = formatDate(new Date().toISOString());

  return `
  <div style="max-width:820px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,0.12);font-family:'Segoe UI',system-ui,-apple-system,Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:14px;line-height:1.5;padding:2rem 2.2rem;">
    <style>
      @media print { body { margin: 0 !important; } }
      .section-title {
        display: flex; align-items: center; gap: 0.5rem;
        background: #eef2ff; color: #1e40af; font-weight: 700; font-size: 0.98rem;
        padding: 0.45rem 0.9rem; border-radius: 8px; margin: 1.1rem 0 0.6rem;
      }
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
      table.details { width: 100%; border-collapse: collapse; }
    </style>
<div class="page-inner">
      <!-- ===== HEADER ===== -->
      <div style="display:flex;align-items:center;gap:1rem;border-bottom:3px solid #1e3a5f;padding-bottom:0.9rem;">
        ${logoHtml}
        <div style="flex:1;text-align:center;">
          <h1 style="margin:0.15rem 0 0;font-size:1.5rem;letter-spacing:0.03em;color:#1e3a5f;">Student Admission Form</h1>
          <p style="margin:0.25rem 0 0;color:#64748b;font-size:0.85rem;">${escapeHtml(schoolName)} &middot; Official Document</p>
          <span style="display:inline-block;background:#1e3a5f;color:#fff;font-weight:700;padding:0.32rem 0.9rem;border-radius:20px;font-size:0.78rem;margin-top:0.35rem;">Admitted &middot; ${escapeHtml(studentId)}</span>
        </div>
      </div>

      <!-- ===== META ===== -->
      <div style="display:flex;justify-content:space-between;gap:1rem;margin:1.1rem 0 0.4rem;font-size:0.95rem;color:#334155;">
        <div><strong>Academic Year:</strong> ${escapeHtml(academicYear)}</div>
        <div><strong>Term:</strong> ${escapeHtml(termLabel(term))}</div>
        <div><strong>Admission Date:</strong> ${student.admission_date ? escapeHtml(formatDate(student.admission_date)) : '—'}</div>
      </div>

      <!-- ===== STUDENT INFO ===== -->
      <div class="section-title">&#128221; Student Information</div>
      <div style="display:flex;gap:1.4rem;margin-top:0.9rem;">
        <div style="flex:0 0 auto;">${photoHtml}</div>
        <table class="details">
          <tbody>
            ${infoRow('Full Name', fullName)}
            ${infoRow('Student ID', studentId)}
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
${
        includeFees
          ? `
      <!-- ===== FEES ===== -->
      <div class="section-title">&#128176; Term Fees (${escapeHtml(academicYear)} &middot; ${escapeHtml(termLabel(term))})</div>
      <table class="details">
        <tbody>
          <tr style="background:#eff6ff;">
            <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;font-weight:700;color:#1e40af;">Class (Term) Fee</td>
            <td style="padding:0.55rem 1rem;border:1px solid #e2e8f0;text-align:right;font-weight:600;">GHC ${formatCurrency(classFee)}</td>
          </tr>
          ${itemSection}
          <tr style="background:#1e3a5f;color:#fff;font-weight:800;font-size:1.02rem;">
            <td style="padding:0.6rem 1rem;border:1px solid #1e3a5f;">TOTAL TERM FEE</td>
            <td style="padding:0.6rem 1rem;border:1px solid #1e3a5f;text-align:right;">GHC ${formatCurrency(totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <p class="note">
        This form confirms that <strong>${escapeHtml(fullName)}</strong> has been admitted
        to <strong>${escapeHtml(schoolName)}</strong> for the
        <strong>${escapeHtml(termLabel(term))}</strong> of the
        <strong>${escapeHtml(academicYear)}</strong> academic year. The total term fee payable
        is <strong>GHC ${formatCurrency(totalAmount)}</strong>. Items marked under
        &ldquo;Additional Admission Fees&rdquo; are charges agreed at admission.
      </p>`
          : `
      <p class="note">
        This form confirms that <strong>${escapeHtml(fullName)}</strong> has been admitted
        to <strong>${escapeHtml(schoolName)}</strong> for the
        <strong>${escapeHtml(termLabel(term))}</strong> of the
        <strong>${escapeHtml(academicYear)}</strong> academic year.
      </p>`
      }

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

      <div class="footer">Generated by the Student Admission Portal &middot; ${escapeHtml(schoolName)} &middot; ${escapeHtml(generatedAt)}</div>
    </div>
  </div>`;
}

/**
 * Open / print the generated admission form through the app's print window.
 * @returns {Window|null} the print handle (null when popups are blocked).
 */
export function openAdmissionForm(params, title = 'Student Admission Form') {
  const body = buildAdmissionFormBody(params);
  return openPrintWindow(title, body);
}