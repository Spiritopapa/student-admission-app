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
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [result, setResult] = useState(null);
  const [receiptForModal, setReceiptForModal] = useState(null);
  const [balanceMap, setBalanceMap] = useState({});

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

  // Load every school fee record once and build per-student outstanding totals.
  useEffect(() => {
    if (!schoolId) return;
    supabase
      .from('fees')
      .select('student_id, total_amount, amount_paid, debt')
      .eq('school_id', schoolId)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((f) => {
          const bal = Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0);
          map[f.student_id] = (map[f.student_id] || 0) + bal;
        });
        setBalanceMap(map);
      });
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

  const TERM_ORDER = { First: 0, Second: 1, Third: 2 };
  const yearStart = (y) => Number(String(y || '').split('/')[0] || 0);

  const sortedFees = useMemo(
    () => [...(feeInfo || [])].sort((a, b) => yearStart(a.academic_year) - yearStart(b.academic_year) || TERM_ORDER[a.term] - TERM_ORDER[b.term]),
    [feeInfo]
  );

  const outstandingOf = (f) => Math.max((Number(f.total_amount) + Number(f.debt || 0)) - Number(f.amount_paid), 0);

  // The earliest unpaid term (chronological); null if everything is cleared.
  const earliestUnpaid = useMemo(() => sortedFees.find((f) => outstandingOf(f) > 0) || null, [sortedFees]);

  // A prior term with an outstanding balance that blocks paying a later term.
  const priorBalance = useMemo(() => {
    if (!earliestUnpaid) return null;
    const targetStart = yearStart(year) * 10 + TERM_ORDER[term];
    const dueStart = yearStart(earliestUnpaid.academic_year) * 10 + TERM_ORDER[earliestUnpaid.term];
    return dueStart < targetStart ? earliestUnpaid : null;
  }, [earliestUnpaid, year, term]);

  const targetFee = useMemo(() => sortedFees.find((f) => f.academic_year === year && f.term === term) || null, [sortedFees, year, term]);

  const outstanding = useMemo(() => (targetFee ? outstandingOf(targetFee) : 0), [targetFee]);

  const loadFeeInfo = async (student) => {
    setSelected(student);
    setFeeInfo(null);
    try {
      const fees = await fetchStudentFees(student.student_id);
      setFeeInfo(fees);
      // Auto-select the year/term to collect for:
      const sorted = [...(fees || [])].sort(
        (a, b) => yearStart(a.academic_year) - yearStart(b.academic_year) || TERM_ORDER[a.term] - TERM_ORDER[b.term]
      );
      const unpaid = sorted.find((f) => Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid) > 0);
      if (unpaid) {
        setYear(unpaid.academic_year);
        setTerm(unpaid.term);
      } else if (sorted.length) {
        const last = sorted[sorted.length - 1];
        if (TERM_ORDER[last.term] < 2) {
          setYear(last.academic_year);
          setTerm(TERMS[TERM_ORDER[last.term] + 1]);
        } else {
          const next = (yearStart(last.academic_year) + 1) + '/' + String((yearStart(last.academic_year) + 2)).slice(-2);
          setYear(next);
          setTerm('First');
        }
      }
    } catch (err) {
      // ignore
    }
  };

  // Creates a fee record on the spot (from the class fee structure) so a
  // student whose term has no record yet can still be collected from.
  const ensureFeeRecord = async () => {
    if (targetFee) return targetFee;
    const { data: classFee } = await supabase
      .from('class_fees')
      .select('*')
      .eq('class_name', selected.class_applying)
      .eq('academic_year', year)
      .eq('term', term)
      .eq('school_id', schoolId)
      .maybeSingle();
    const feeAmount = Number(classFee?.fee_amount || 0);
    if (!classFee && !selected.fee_override) {
      return null;
    }
    const { error } = await supabase.from('fees').insert({
      student_id: selected.student_id,
      academic_year: year,
      term,
      total_amount: feeAmount,
      amount_paid: 0,
      debt: 0,
      payment_status: feeAmount > 0 ? 'unpaid' : 'paid',
      school_id: schoolId,
    });
    if (error) throw new Error(error.message);
    return { total_amount: feeAmount, debt: 0, amount_paid: 0 };
  };

  const suggestedFee = outstanding || '';

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
    // Prior-term gate: a later term cannot be paid before an earlier one is cleared.
    if (priorBalance) {
      toast.error(
        'Previous term unpaid',
        `Cannot pay for ${termLabel(term)} ${year}. ${priorBalance.term} Term ${priorBalance.academic_year} still has GHC ${outstandingOf(priorBalance).toFixed(2)} outstanding. Clear it first.`
      );
      return;
    }
    setBusy(true);
    try {
      const fee = await ensureFeeRecord();
      if (!fee) {
        throw new Error('No fee record exists for this year/term. Ask the admin to set the class fee structure first.');
      }
      const due = Number(fee.total_amount) + Number(fee.debt || 0);
      const paid = Number(fee.amount_paid || 0);
      const outstandingDue = Math.max(due - paid, 0);
      if (outstandingDue <= 0) {
        throw new Error(`${termLabel(term)} ${year} is already fully paid for this student.`);
      }
      if (amt > outstandingDue) {
        toast.error('Overpayment prevented', `Outstanding is GHC ${outstandingDue.toFixed(2)}. Enter an amount equal to or less than that.`);
        setBusy(false);
        return;
      }
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
        p_payment_date: payDate ? new Date(payDate).toISOString() : null,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) throw new Error(data?.error || 'Payment could not be processed.');
      setResult(data);

      if (sendSms && selected.parent_contact) {
        const message = `Fee payment of GHC ${(Number(data.amount_paid) || amt).toFixed(2)} received for ${data.student_name || selected.first_name}. Receipt: ${data.receipt_number}. Paid for ${data.academic_year} ${termLabel(data.term)}. Thank you.`;
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
                      {balanceMap[s.student_id] > 0 ? (
                        <Badge tone="red">GHC {Number(balanceMap[s.student_id]).toFixed(2)}</Badge>
                      ) : (
                        <Badge tone="green">Cleared</Badge>
                      )}
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
                  <p className="font-mono text-xs text-slate-400">{selected.student_id} · {selected.class_applying}</p>

                  {feeInfo?.length ? (
                    <div className="mt-3 space-y-1.5">
                      {sortedFees.map((f) => {
                        const bal = outstandingOf(f);
                        const paidStatus = bal <= 0 ? (Number(f.amount_paid) > 0 || Number(f.total_amount) === 0 ? 'paid' : 'unpaid') : Number(f.amount_paid) > 0 ? 'partial' : 'unpaid';
                        return (
                          <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-600">
                              {termLabel(f.term)} {f.academic_year}
                            </span>
                            <span className={bal > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                              {paidStatus === 'paid' ? 'Paid' : `GHC ${bal.toFixed(2)} due`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-400">No fee records yet — a record will be created from the class fee structure on payment.</p>
                  )}

                  {priorBalance ? (
                    <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700">
                      Cannot pay {termLabel(term)} until {priorBalance.term} {priorBalance.academic_year} (GHC {outstandingOf(priorBalance).toFixed(2)}) is cleared.
                    </p>
                  ) : suggestedFee ? (
                    <p className="mt-2 text-xs font-semibold text-accent-600">
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
                {suggestedFee && Number(suggestedFee) > 0 ? (
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(String(suggestedFee))}>
                      Use outstanding (GHC {Number(suggestedFee).toFixed(2)})
                    </Button>
                  </div>
                ) : null}
                <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Payment date"
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
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