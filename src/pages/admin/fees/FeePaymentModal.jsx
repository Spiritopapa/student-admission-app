import { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Input, Select } from '../../../components/ui';
import { Modal, Alert } from '../../../components/ui-extras';
import { useToast } from '../../../context/ToastContext';
import ReceiptModal from '../../../components/ReceiptModal';
import { supabase } from '../../../lib/supabase';
import { fetchStudentFees } from '../../../lib/queries';
import { sendStudentPaymentSms, fetchSchoolContact } from '../../../lib/api';
import { buildStudentName, termLabel } from '../../../lib/format';
import { TERMS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, currentAcademicYear } from '../../../lib/constants';

const TERM_ORDER = { First: 0, Second: 1, Third: 2 };
const yearStart = (y) => Number(String(y || '').split('/')[0] || 0);

export default function FeePaymentModal({ open, student, onClose, onPaid }) {
  const toast = useToast();
  const [feeInfo, setFeeInfo] = useState([]);
  const [year, setYear] = useState(currentAcademicYear());
  const [term, setTerm] = useState('First');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [receiptForModal, setReceiptForModal] = useState(null);
  const [schoolContact, setSchoolContact] = useState({ name: '', phone: '' });

  useEffect(() => {
    if (!open || !student) return;
    setFeeInfo([]);
    setAmount('');
    setReference('');
    setNotes('');
    setError('');
    setReceiptForModal(null);
    fetchSchoolContact(student.school_id).then((contact) => setSchoolContact(contact || { name: '', phone: '' }));
    (async () => {
      try {
        const fees = await fetchStudentFees(student.student_id);
        setFeeInfo(fees);
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
            const nextStart = yearStart(last.academic_year) + 1;
            setYear(`${nextStart}/${nextStart + 1}`);
            setTerm('First');
          }
        }
      } catch (err) {
        // ignore
      }
    })();
  }, [open, student]);

  const sortedFees = useMemo(
    () => [...feeInfo].sort((a, b) => yearStart(a.academic_year) - yearStart(b.academic_year) || TERM_ORDER[a.term] - TERM_ORDER[b.term]),
    [feeInfo]
  );
  const outstandingOf = (f) => Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0);
  const targetFee = useMemo(() => sortedFees.find((f) => f.academic_year === year && f.term === term) || null, [sortedFees, year, term]);
  const outstanding = targetFee ? outstandingOf(targetFee) : 0;

  const hasPriorBalance = useMemo(() => {
    const targetStart = yearStart(year) * 10 + TERM_ORDER[term];
    return sortedFees.some((f) => {
      if (f.academic_year === year && f.term === term) return false;
      return yearStart(f.academic_year) * 10 + TERM_ORDER[f.term] < targetStart && outstandingOf(f) > 0;
    });
  }, [sortedFees, year, term]);

  const ensureFeeRecord = async () => {
    if (targetFee) return targetFee;
    const { data: classFee } = await supabase
      .from('class_fees')
      .select('*')
      .eq('class_name', student.class_applying)
      .eq('academic_year', year)
      .eq('term', term)
      .eq('school_id', student.school_id)
      .maybeSingle();
    if (!classFee) return null;
    const feeAmount = Number(classFee.fee_amount || 0);
    const { error } = await supabase.from('fees').insert({
      student_id: student.student_id,
      academic_year: year,
      term,
      total_amount: feeAmount,
      amount_paid: 0,
      debt: 0,
      payment_status: feeAmount > 0 ? 'unpaid' : 'paid',
      school_id: student.school_id,
    });
    if (error) throw new Error(error.message);
    return { total_amount: feeAmount, debt: 0, amount_paid: 0 };
  };

  const submit = async () => {
    setError('');
    const amt = Number(amount || 0);
    if (!student) return;
    if (amt <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (hasPriorBalance) {
      setError('A previous term still has an outstanding balance. Clear it first before paying this term.');
      return;
    }
    if (outstanding > 0 && amt > outstanding) {
      setError(`Overpayment prevented. Outstanding is GHC ${outstanding.toFixed(2)} — enter an amount equal to or less than that.`);
      return;
    }
    setBusy(true);
    try {
      const fee = await ensureFeeRecord();
      if (!fee) {
        throw new Error('No fee record exists for this year/term. Set the class fee structure first so the record can be created.');
      }
      const due = Number(fee.total_amount) + Number(fee.debt || 0);
      const paid = Number(fee.amount_paid || 0);
      if (due - paid <= 0) {
        throw new Error(`${termLabel(term)} ${year} is already fully paid.`);
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: rpcError } = await supabase.rpc('process_fee_payment', {
        p_student_id: student.student_id,
        p_academic_year: year,
        p_term: term,
        p_amount: amt,
        p_payment_method: method,
        p_reference_number: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_recorded_by: user?.id,
        p_school_id: student.school_id,
        p_payment_date: payDate ? new Date(payDate).toISOString() : null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data || !data.success) throw new Error(data?.error || 'Payment could not be processed.');

      if (sendSms && student.parent_contact) {
        const brand = schoolContact.name ? `${schoolContact.name}: ` : '';
        const contact = schoolContact.phone ? ` For any assistance, call ${schoolContact.phone}.` : '';
        const message = `${brand}Fee payment of GHC ${(Number(data.amount_paid) || amt).toFixed(2)} received for ${data.student_name || student.first_name}. Receipt: ${data.receipt_number}. Paid for ${data.academic_year} ${termLabel(data.term)}. Thank you.${contact}`;
        const sms = await sendStudentPaymentSms({
          schoolId: student.school_id,
          studentId: student.student_id,
          receiptNumber: data.receipt_number,
          phone: student.parent_contact,
          message,
        });
        if (!sms.success) {
          toast.info('Payment recorded', sms.error || 'Receipt issued but the SMS could not be delivered.');
        } else {
          toast.success('Payment recorded & SMS sent', `Receipt ${data.receipt_number}`);
        }
      } else {
        toast.success('Payment recorded', `Receipt ${data.receipt_number} issued.`);
      }

      if (data.receipt_id) {
        const { data: stored } = await supabase.from('receipts').select('*').eq('id', data.receipt_id).maybeSingle();
        if (stored) setReceiptForModal(stored);
      }
      onPaid?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record payment — ${student ? buildStudentName(student.first_name, student.middle_name, student.last_name) : ''}`}
      size="md"
      footer={
        <div className="flex w-full gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Close
          </Button>
          <Button onClick={submit} loading={busy} className="flex-1">
            <Send className="h-4 w-4" aria-hidden="true" />
            Record payment
          </Button>
        </div>
      }
    >
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {student ? (
        <>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-bold text-slate-800">
              {buildStudentName(student.first_name, student.middle_name, student.last_name)}
            </p>
            <p className="font-mono text-xs text-slate-400">{student.student_id} · {student.class_applying}</p>
            {sortedFees.map((f) => {
              const bal = outstandingOf(f);
              return (
                <div key={f.id} className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{termLabel(f.term)} {f.academic_year}</span>
                  <span className={bal > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                    {bal > 0 ? `GHC ${bal.toFixed(2)} due` : 'Paid'}
                  </span>
                </div>
              );
            })}
            {hasPriorBalance ? (
              <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700">
                A previous term is unpaid — clear it before paying {termLabel(term)} {year}.
              </p>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Input label="Academic year" value={year} onChange={(e) => setYear(e.target.value)} />
            <Select label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {termLabel(t)}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-3 space-y-3">
            <Input
              label={outstanding > 0 ? `Amount (GHC) * — outstanding GHC ${outstanding.toFixed(2)}` : 'Amount (GHC) *'}
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={outstanding > 0 ? `GHC ${outstanding.toFixed(2)}` : '0.00'}
            />
            {outstanding > 0 ? (
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(String(outstanding))}>
                  Use outstanding (GHC {outstanding.toFixed(2)})
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
            <Input label="Payment date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
            <Input label="Reference number" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="(optional)" />
            <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(optional)" />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
              Notify parent by SMS
            </label>
          </div>
        </>
      ) : null}
      <ReceiptModal receipt={receiptForModal} onClose={() => setReceiptForModal(null)} />
    </Modal>
  );
}