import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Search, CheckCircle2, ReceiptText, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Badge, SearchInput, Spinner } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import ReceiptModal from '../../components/ReceiptModal';
import { supabase } from '../../lib/supabase';
import { fetchStudentFees } from '../../lib/queries';
import { sendStudentPaymentSms } from '../../lib/api';
import { buildStudentName, cedi, termLabel } from '../../lib/format';
import { TERMS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, currentAcademicYear } from '../../lib/constants';
import { photoUrl } from '../../lib/storage';

export default function AccountantCollect() {
  const { user } = useAuth();
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [feeInfo, setFeeInfo] = useState(null);
  const [year, setYear] = useState(settings?.academic_year || currentAcademicYear());
  const [term, setTerm] = useState(settings?.current_term || 'First');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [result, setResult] = useState(null);
  const [receiptForModal, setReceiptForModal] = useState(null);

  useEffect(() => {
    if (!schoolId) return;
    supabase
      .from('applications')
      .select('*')
      .eq('school_id', schoolId)
      .eq('status', 'admitted')
      .order('last_name')
      .then(({ data }) => setStudents(data || []));
  }, [schoolId]);

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
        return (
          !query ||
          name.includes(query.toLowerCase()) ||
          s.student_id.toLowerCase().includes(query.toLowerCase())
        );
      }),
    [students, query]
  );

  const loadFeeInfo = async (student) => {
    setSelected(student);
    setFeeInfo(null);
    try {
      const fees = await fetchStudentFees(student.student_id);
      setFeeInfo(fees);
    } catch (err) {
      // ignore
    }
  };

  const suggestedFee = useMemo(() => {
    if (!selected) return '';
    const fee = (feeInfo || []).find(
      (f) => f.academic_year === year && f.term === term
    );
    return fee ? Number(fee.balance >= 0 ? fee.balance : 0) : '';
  }, [selected, feeInfo, year, term]);

  const processPayment = async () => {
    if (!selected) {
      toast.error('Select a student', 'Search and choose the student paying.');
      return;
    }
    const amt = Number(amount || 0);
    if (amt <= 0) {
      toast.error('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('process_fee_payment', {
        p_student_id: selected.student_id,
        p_academic_year: year,
        p_term: term,
        p_amount: amt,
        p_payment_method: method,
        p_reference_number: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_recorded_by: user?.id,
        p_school_id: schoolId,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) throw new Error(data?.error || 'Payment could not be processed.');
      setResult(data);

      if (sendSms && selected.parent_contact) {
        const message = `Fee payment of GHC ${data.amount_paid?.toFixed?.(2) || Number(data.amount_paid || amt).toFixed(2)} received for ${data.student_name || selected.first_name}. Receipt: ${data.receipt_number}. Paid for ${data.academic_year} ${termLabel(data.term)}. Thank you.`;
        const sms = await sendStudentPaymentSms({
          schoolId,
          studentId: selected.student_id,
          receiptNumber: data.receipt_number,
          phone: selected.parent_contact,
          message,
        });
        if (!sms.success) {
          toast.info('Payment recorded', sms.error || 'Receipt issued but the SMS could not be delivered.');
        }
      } else {
        toast.success('Payment recorded', `Receipt ${data.receipt_number} issued.`);
      }

      setAmount('');
      setReference('');
      setNotes('');
      loadFeeInfo(selected);
    } catch (err) {
      toast.error('Payment failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async () => {
    if (!result) return;
    const { data } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', result.receipt_id)
      .maybeSingle();
    setReceiptForModal(data || null);
  };

  return (
    <div>
      <PageHeader title="Collect Payment" subtitle="Record a fee payment and issue a verified receipt." icon={Wallet} />
      <ReceiptModal receipt={receiptForModal} onClose={() => setReceiptForModal(null)} />

      {result ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center"
        >
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-card">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-emerald-900">Payment recorded</h2>
          <p className="mt-1 text-sm text-emerald-800">
            GHC {Number(result.amount_paid || 0).toFixed(2)} from {result.student_name} ·{' '}
            {result.receipt_number}
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Remaining balance: GHC {Number(result.remaining_balance || 0).toFixed(2)}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={openReceipt}>
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              View receipt
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setSelected(null);
                setFeeInfo(null);
              }}
            >
              New payment
            </Button>
          </div>
        </motion.div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-3">
            <h3 className="text-sm font-bold text-slate-800">1. Choose the student</h3>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name or Student ID..." className="mt-3" />
            <div className="mt-3 max-h-80 divide-y divide-slate-50 overflow-y-auto rounded-xl border border-slate-100">
              {filtered.length ? (
                filtered.map((s) => {
                  const active = selected?.student_id === s.student_id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => loadFeeInfo(s)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      {s.student_photo_url ? (
                        <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-9 w-8 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-9 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                          {(s.first_name || 'S').charAt(0)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                        </p>
                        <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                      </div>
                      <Badge tone="blue">{s.class_applying}</Badge>
                    </button>
                  );
                })
              ) : (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  No students match your search.
                </p>
              )}
            </div>
          </div>

          <div className="card p-5 lg:col-span-2">
            <h3 className="text-sm font-bold text-slate-800">2. Record the payment</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-bold text-slate-800">
                    {buildStudentName(selected.first_name, selected.middle_name, selected.last_name)}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{selected.student_id}</p>
                  {suggestedFee ? (
                    <p className="mt-1 text-xs font-semibold text-accent-600">
                      Outstanding for {termLabel(term)}: GHC {Number(suggestedFee).toFixed(2)}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Select label="Academic year" value={year} onChange={(e) => setYear(e.target.value)}>
                    {[...new Set([settings?.academic_year, currentAcademicYear()].filter(Boolean))].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </Select>
                  <Select label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>
                    {TERMS.map((t) => (
                      <option key={t} value={t}>
                        {termLabel(t)}
                      </option>
                    ))}
                  </Select>
                </div>

                <Input
                  label="Amount (GHC) *"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={suggestedFee ? `Suggested: ${suggestedFee}` : 'e.g. 650.00'}
                />
                <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Reference number"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="(optional)"
                />
                <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(optional)" />

                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={sendSms}
                    onChange={(e) => setSendSms(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  Notify parent by SMS
                </label>

                <Button onClick={processPayment} loading={busy} className="w-full">
                  {!busy ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
                  Process payment
                </Button>
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-slate-400">
                Select a student from the list to continue.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}