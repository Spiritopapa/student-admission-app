import { useEffect, useState } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { Building2, ShieldCheck, ExternalLink, Printer } from 'lucide-react';
import { Modal } from './ui-extras';
import { Button } from './ui';
import { cedi } from '../lib/format';
import { supabase, RECEIPT_VERIFY_BASE_URL } from '../lib/supabase';
import { photoUrl, resolveFileUrl } from '../lib/storage';
import { openPrintWindow, escapeHtml } from '../lib/print';

function buildVerifyLink(receipt) {
  const token = receipt.verification_token || receipt.receipt_data?.verification_token || '';
  const base = RECEIPT_VERIFY_BASE_URL || window.location.origin;
  if (token) return `${base}/verify-receipt?t=${encodeURIComponent(String(token))}`;
  return `${base}/verify-receipt?r=${encodeURIComponent(receipt.receipt_number || '')}`;
}

export default function ReceiptModal({ receipt, onClose }) {
  const [schoolLogo, setSchoolLogo] = useState('');
  const [schoolName, setSchoolName] = useState('School');

  // Resolve the school logo for the receipt. New receipts are expected to embed
  // it in receipt_data, but older receipts are not — so we fall back to the
  // school's current logo so every receipt (and its print-out) shows it.
  useEffect(() => {
    if (!receipt) return;
    let cancelled = false;
    const rdata = receipt.receipt_data || {};
    const embedded = photoUrl(rdata.school_logo_url) || resolveFileUrl(rdata.school_logo_url) || '';
    setSchoolLogo(embedded);
    setSchoolName(rdata.school_name || 'School');
    if (embedded || !receipt.school_id) return undefined;
    (async () => {
      try {
        const { data: ss } = await supabase
          .from('school_settings')
          .select('school_name, logo_url')
          .eq('school_id', receipt.school_id)
          .maybeSingle();
        let logo = ss?.logo_url || '';
        let name = ss?.school_name || rdata.school_name || 'School';
        if (!logo) {
          const { data: sch } = await supabase
            .from('schools')
            .select('name, logo_url')
            .eq('id', receipt.school_id)
            .maybeSingle();
          logo = sch?.logo_url || '';
          if (name === 'School' && sch?.name) name = sch.name;
        }
        if (!cancelled) {
          setSchoolLogo(photoUrl(logo) || resolveFileUrl(logo) || '');
          setSchoolName(name);
        }
      } catch (err) {
        // best-effort: keep whatever is already resolved
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receipt]);

  if (!receipt) return null;
  const data = receipt.receipt_data || {};
  const verifyLink = buildVerifyLink(receipt);
  const receiptDate = new Date(receipt.receipt_date).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Exact moment the payment was processed (receipt_date may be a back-dated
  // payment date, so the true processing time lives on created_at).
  const processedAt = new Date(receipt.created_at || receipt.receipt_date).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const generatedBy = data.processed_by
    ? `${data.processed_by}${data.processed_by_label ? ` (${data.processed_by_label})` : ''}`
    : 'School staff';
  const balance = Number(data.balance_after ?? data.remaining_balance) || 0;

  // Build a clean, print-friendly receipt document. The QR is read from a
  // hidden on-screen QRCodeCanvas (canvas pixel data can't be cloned via
  // innerHTML, so we serialize it to a data-URL <img> for the print window).
  const printReceipt = () => {
    const canvas = document.getElementById('printableReceiptQr');
    let qrImg = '';
    if (canvas && typeof canvas.toDataURL === 'function') {
      try {
        qrImg = `<img src="${canvas.toDataURL('image/png')}" alt="Receipt QR" style="width:110px;height:110px;display:inline-block;border-radius:10px;" />`;
      } catch (err) {
        console.warn('QR serialization for print failed:', err.message);
      }
    }

    const row = (label, value, strong = false) => `
      <tr>
        <td style="padding:5px;border-bottom:1px solid #ececec;color:#666;font-size:12px;">${escapeHtml(label)}</td>
        <td style="padding:5px;border-bottom:1px solid #ececec;text-align:right;font-size:12px;font-weight:${strong ? '800' : '600'};color:${strong ? '#166534' : '#111'};">${escapeHtml(value)}</td>
      </tr>`;

    const body = `
    <div style="max-width:400px;margin:0 auto;font-family:'Courier New',Courier,monospace;color:#111;position:relative;">
      ${schoolLogo ? `<img src="${escapeHtml(schoolLogo)}" alt="" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:250px;height:250px;object-fit:contain;opacity:0.10;pointer-events:none;" />` : ''}
      <div style="position:relative;">
        <div style="text-align:center;border-bottom:2px dashed #333;padding-bottom:10px;margin-bottom:10px;">
          ${schoolLogo ? `<img src="${escapeHtml(schoolLogo)}" alt="School logo" style="width:56px;height:56px;object-fit:contain;display:inline-block;margin-bottom:4px;" />` : ''}
          <div style="font-size:18px;font-weight:bold;">${escapeHtml(schoolName)}</div>
          <div style="font-size:14px;font-weight:bold;letter-spacing:2px;margin:5px 0;">PAYMENT RECEIPT</div>
          <div style="font-size:12px;color:#666;">${escapeHtml(receipt.receipt_number)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Date', receiptDate)}
          ${row('Student', data.student_name || receipt.student_id)}
          ${row('Student ID', receipt.student_id)}
          ${row('Class', data.class || '-')}
          ${row('Academic Year', `${receipt.academic_year} - ${receipt.term} Term`)}
          ${row('Amount Paid', cedi(receipt.amount), true)}
          ${row('Payment Method', data.payment_method || receipt.payment_method || 'Cash')}
          ${row('Reference', data.reference_number || '-')}
          ${row('Generated By', generatedBy)}
          ${row('Processed At', processedAt)}
          ${balance ? row('Remaining Balance', cedi(balance), true) : ''}
        </table>
        <div style="text-align:center;margin:14px 0 6px;">${qrImg || ''}</div>
        <div style="text-align:center;border-top:2px dashed #333;padding-top:10px;margin-top:10px;">
          <div style="font-size:14px;font-weight:bold;">Thank you</div>
          <div style="font-size:11px;color:#666;margin-top:5px;">Scan the QR code to verify this receipt.</div>
          <div style="font-size:10px;color:#666;margin-top:4px;">${escapeHtml(verifyLink)}</div>
          <div style="font-size:10px;color:#999;margin-top:6px;">Generated by the Student Admission Portal</div>
        </div>
      </div>
    </div>`;

    openPrintWindow(`Receipt ${receipt.receipt_number}`, body);
  };

  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={`Receipt ${receipt.receipt_number}`}
      size="md"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="secondary" onClick={printReceipt}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print receipt
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        {schoolLogo ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <img src={schoolLogo} alt="" className="h-52 w-52 object-contain opacity-10" />
          </div>
        ) : null}
        <div className="relative">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {schoolLogo ? (
              <img src={schoolLogo} alt="School logo" className="h-12 w-12 rounded-xl object-contain bg-white p-1 ring-1 ring-slate-100" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blend text-white">
                <Building2 className="h-6 w-6" aria-hidden="true" />
              </span>
            )}
            <div>
              <p className="text-sm font-bold text-slate-800">{schoolName}</p>
              <p className="text-xs text-slate-400">
                {receipt.academic_year} - {receipt.term} Term
              </p>
            </div>
          </div>
          <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Verified
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Item label="Receipt number" value={receipt.receipt_number} mono />
          <Item label="Date" value={receiptDate} />
          <Item label="Student" value={data.student_name || receipt.student_id} />
          <Item label="Student ID" value={receipt.student_id} mono />
          <Item label="Class" value={data.class || '-'} />
          <Item label="Amount paid" value={cedi(receipt.amount)} strong />
          <Item label="Payment method" value={data.payment_method || receipt.payment_method || 'Cash'} />
          <Item label="Reference" value={data.reference_number || '-'} mono />
          <Item label="Generated by" value={generatedBy} />
          <Item label="Processed at" value={processedAt} />
        </dl>

        {balance && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Remaining balance: {cedi(balance)}
          </p>
        )}
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Scan to verify this receipt
        </p>
        <div className="rounded-xl bg-white p-3 shadow-soft">
          <QRCodeSVG value={verifyLink} size={128} level="M" />
        </div>
        <a
          href={verifyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open verification page
        </a>
      </div>

      {/* Off-screen canvas used only to serialize the QR into the print document. */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', left: -9999, top: -9999, width: 0, height: 0, overflow: 'hidden' }}
      >
        <QRCodeCanvas id="printableReceiptQr" value={verifyLink} size={256} level="M" />
      </div>
    </Modal>
  );
}

function Item({ label, value, mono, strong }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-semibold text-slate-800 ${strong ? 'text-emerald-700' : ''} ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '-'}
      </dd>
    </div>
  );
}