import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Search,
  BadgeCheck,
  Building2,
  User,
  Hash,
  CalendarDays,
  Wallet,
  CircleCheck,
  CircleX,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Input } from '../../components/ui';
import { Alert, Tabs } from '../../components/ui-extras';
import { cedi, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function VerifyReceipt() {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get('t') || searchParams.get('key') || '';
  const initialReceipt = searchParams.get('r') || '';
  const [lookup, setLookup] = useState(initialToken || initialReceipt || '');
  const [lookupType, setLookupType] = useState(initialToken ? 'token' : 'receipt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [invalid, setInvalid] = useState(false);

  const query = async (value) => {
    setError('');
    setReceipt(null);
    setInvalid(false);
    const term = (value || '').trim();
    if (!term) {
      setError('Enter the receipt number or verification token.');
      return;
    }
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_receipt_for_verification', {
        p_lookup: term,
      });
      if (rpcError) throw rpcError;
      if (!data) {
        setInvalid(true);
        return;
      }
      setReceipt(data);
    } catch (err) {
      setError('We could not verify this receipt right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialToken || initialReceipt) {
      query(initialToken || initialReceipt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    query(lookup);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Verify a receipt
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter the receipt number printed on the receipt, or paste the QR token shown to you.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card"
      >
        <Tabs
          tabs={[
            { value: 'receipt', label: 'Receipt number' },
            { value: 'token', label: 'QR token' },
          ]}
          active={lookupType}
          onChange={setLookupType}
          className="mb-5"
        />
        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder={lookupType === 'receipt' ? 'e.g. RCP-SIN-000001' : 'Paste the verification token'}
            className="flex-1"
          />
          <Button type="submit" loading={busy} className="sm:w-auto">
            {!busy ? <Search className="h-4 w-4" aria-hidden="true" /> : null}
            Verify
          </Button>
        </form>

        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}

        {invalid ? (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <CircleX className="h-12 w-12 text-rose-500" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-rose-800">Receipt not found</h2>
            <p className="mt-1 max-w-sm text-sm text-rose-700">
              No receipt matches this {lookupType === 'receipt' ? 'number' : 'token'}. Please check
              the details and try again.
            </p>
          </div>
        ) : null}

        {receipt ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 overflow-hidden rounded-2xl border border-emerald-200"
          >
            <div className="flex items-center justify-between bg-emerald-500 px-5 py-3 text-white">
              <span className="flex items-center gap-2 text-sm font-bold">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" />
                Verified authentic
              </span>
              <span className="text-xs font-semibold text-emerald-50">
                {formatDate(new Date().toISOString())}
              </span>
            </div>
            <div className="bg-white p-5">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                {receipt.school_logo_url ? (
                  <img
                    src={photoUrl(receipt.school_logo_url) || receipt.school_logo_url}
                    alt="School logo"
                    className="h-12 w-12 rounded-xl object-contain ring-1 ring-slate-100"
                  />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blend text-white">
                    <Building2 className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
                <div>
                  <p className="text-base font-bold text-slate-900">{receipt.school_name}</p>
                  <p className="text-xs text-slate-400">
                    {receipt.academic_year} - {receipt.term} Term
                  </p>
                </div>
              </div>

              <dl className="mt-4 space-y-2.5">
                <VerifyRow icon={Hash} label="Receipt number" value={receipt.receipt_number} mono />
                <VerifyRow icon={CalendarDays} label="Date issued" value={receipt.receipt_date} />
                <VerifyRow icon={User} label="Student" value={receipt.student_name} />
                <VerifyRow icon={User} label="Student ID" value={receipt.student_id} />
                <VerifyRow icon={Building2} label="Class" value={receipt.student_class} />
                <VerifyRow icon={Wallet} label="Amount paid" value={cedi(receipt.total_paid)} strong />
                {Number(receipt.remaining_balance) > 0 ? (
                  <VerifyRow icon={Wallet} label="Remaining balance" value={cedi(receipt.remaining_balance)} />
                ) : (
                  <VerifyRow icon={CircleCheck} label="Status" value="Fully settled" />
                )}
                <VerifyRow icon={Wallet} label="Payment method" value={receipt.payment_method} />
              </dl>
            </div>
          </motion.div>
        ) : null}
      </motion.div>
    </div>
  );
}

function VerifyRow({ icon: Icon, label, value, mono, strong }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={`text-right text-sm ${
          strong ? 'font-extrabold text-emerald-700' : 'font-semibold text-slate-800'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value || '-'}
      </dd>
    </div>
  );
}