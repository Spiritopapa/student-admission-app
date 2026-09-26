import { QRCodeSVG } from 'qrcode.react';
import { Building2, ShieldCheck, ExternalLink } from 'lucide-react';
import { Modal } from './ui-extras';
import { cedi } from '../lib/format';
import { RECEIPT_VERIFY_BASE_URL } from '../lib/supabase';
import { photoUrl, resolveFileUrl } from '../lib/storage';

function buildVerifyLink(receipt) {
  const token = receipt.verification_token || receipt.receipt_data?.verification_token || '';
  const base = RECEIPT_VERIFY_BASE_URL || window.location.origin;
  if (token) return `${base}/verify-receipt?t=${encodeURIComponent(String(token))}`;
  return `${base}/verify-receipt?r=${encodeURIComponent(receipt.receipt_number || '')}`;
}

export default function ReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;
  const data = receipt.receipt_data || {};
  const verifyLink = buildVerifyLink(receipt);
  const schoolLogo = photoUrl(data.school_logo_url) || resolveFileUrl(data.school_logo_url) || '';

  return (
    <Modal open={!!receipt} onClose={onClose} title={`Receipt ${receipt.receipt_number}`} size="md">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
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
              <p className="text-sm font-bold text-slate-800">{data.school_name || 'School'}</p>
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
          <Item label="Date" value={new Date(receipt.receipt_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
          <Item label="Student" value={data.student_name || receipt.student_id} />
          <Item label="Student ID" value={receipt.student_id} mono />
          <Item label="Class" value={data.class || receipt.student_id || '-'} />
          <Item label="Amount paid" value={cedi(receipt.amount)} strong />
          <Item label="Payment method" value={data.payment_method || receipt.payment_method || 'Cash'} />
          <Item label="Reference" value={data.reference_number || '-'} mono />
        </dl>

        {data.balance_after || data.remaining_balance ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Remaining balance: {cedi(Number(data.balance_after ?? data.remaining_balance) || 0)}
          </p>
        ) : null}
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