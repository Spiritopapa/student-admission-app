import { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Input, Select } from '../../../components/ui';
import { Modal, Alert } from '../../../components/ui-extras';
import { useToast } from '../../../context/ToastContext';
import ReceiptModal from '../../../components/ReceiptModal';
import { supabase } from '../../../lib/supabase';
import { fetchStudentFees } from '../../../lib/queries';
import { sendStudentPaymentSms, fetchSchoolContact, outstandingBalanceAfterPayment } from '../../../lib/api';
import { buildStudentName, termLabel } from '../../../lib/format';
import { orderFees, feeBalance, totalOutstanding, waterfallAllocations } from '../../../lib/feeMath';
import { TERMS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, currentAcademicYear, academicYearList } from '../../../lib/constants';

const TERM_ORDER = { First: 0, Second: 1, Third: 2 };
const yearStart = (y) => Number(String(y || '').split('/')[0] || 0);

export default function FeePaymentModal({ open, student, students = null, onClose, onPaid }) {
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

  // `selected` is the student the payment is being recorded for. `student`
  // comes from the triggering row; the in-modal search bar lets the clerk
  // switch to any other student without closing the window.
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setSelected(student || null);
    setSearch('');
    setError('');
  }, [student]);

  useEffect(() => {
    if (!open || !selected) return;
    setFeeInfo([]);
    setAmount('');
    setReference('');
    setNotes('');
    setError('');
    setReceiptForModal(null);
    fetchSchoolContact(selected.school_id).then((contact) => setSchoolContact(contact || { name: '', phone: '' }));
    (async () => {
      try {
        const fees = await fetchStudentFees(selected.student_id);
        setFeeInfo(fees);
        const sorted = [...(fees || [])].sort(
          (a, b) => yearStart(a.academic_year) - yearStart(b.academic_year) || TERM_ORDER[a.term] - TERM_ORDER[b.term]
        );
        const unpaid = sorted.find((f) => feeBalance(f) > 0);
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
  }, [open, selected]);

  const sortedFees = useMemo(() => orderFees(feeInfo), [feeInfo]);
  const outstandingOf = (f) => feeBalance(f);
  const targetFee = useMemo(() => sortedFees.find((f) => f.academic_year === year && f.term === term) || null, [sortedFees, year, term]);
  // Total owed across ALL terms — a payment is waterfalled oldest-first, so the
  // cap is the student's whole outstanding balance, not just the selected term.
  const outstanding = useMemo(() => totalOutstanding(feeInfo), [feeInfo]);

  // Preview of how the entered amount will be applied (oldest term first).
  const allocations = useMemo(
    () => waterfallAllocations(sortedFees, Number(amount || 0)).allocations,
    [sortedFees, amount]
  );

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q.length < 2 || !Array.isArray(students)) return [];
    return students
      .filter((s) => {
        const haystack =
          `${buildStudentName(s.first_name, s.middle_name, s.last_name)} ${s.student_id}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [students, search]);

  const pickStudent = (s) => {
    setSelected(s);
    setSearch('');
    setError('');
  };

  const ensureFeeRecord = async () => {
    if (targetFee) return targetFee;
    const { data: classFee } = await supabase
      .from('class_fees')
      .select('*')
      .eq('class_name', selected?.class_applying)
      .eq('academic_year', year)
      .eq('term', term)
      .eq('school_id', selected?.school_id)
      .maybeSingle();
    if (!classFee) return null;
    const feeAmount = Number(classFee.fee_amount || 0);
    const { error } = await supabase.from('fees').insert({
      student_id: selected?.student_id,
      academic_year: year,
      term,
      total_amount: feeAmount,
      amount_paid: 0,
      debt: 0,
      payment_status: feeAmount > 0 ? 'unpaid' : 'paid',
      school_id: selected?.school_id,
    });
    if (error) throw new Error(error.message);
    return { total_amount: feeAmount, debt: 0, amount_paid: 0 };
  };

  const submit = async () => {
    setError('');
    const amt = Number(amount || 0);
    if (!selected) return;
    if (amt <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (outstanding <= 0) {
      setError('All fee records for this student are already fully settled.');
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
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: rpcError } = await supabase.rpc('process_fee_payment', {
        p_student_id: selected.student_id,
        p_academic_year: year,
        p_term: term,
        p_amount: amt,
        p_payment_method: method,
        p_reference_number: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_recorded_by: user?.id,
        p_school_id: selected.school_id,
        p_payment_date: payDate ? new Date(payDate).toISOString() : null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data || !data.success) throw new Error(data?.error || 'Payment could not be processed.');

      if (sendSms && selected.parent_contact) {
        const brand = schoolContact.name ? `${schoolContact.name}: ` : '';
        const contact = schoolContact.phone ? ` For any assistance, call ${schoolContact.phone}.` : '';
        const balanceAfter = outstandingBalanceAfterPayment({ data, feeRecords: feeInfo, year, term });
        const balancePart =
          balanceAfter > 0
            ? ` Remaining balance: GHC ${balanceAfter.toFixed(2)}.`
            : " Your ward's fees are fully settled.";
        const message = `${brand}Fee payment of GHC ${(Number(data.amount_paid) || amt).toFixed(2)} received for ${data.student_name || selected.first_name}. Receipt: ${data.receipt_number}. Paid for ${data.academic_year} ${termLabel(data.term)}.${balancePart} Thank you.${contact}`;
        const sms = await sendStudentPaymentSms({
          schoolId: selected.school_id,
          studentId: selected.student_id,
          receiptNumber: data.receipt_number,
          phone: selected.parent_contact,
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
      title={`Record payment — ${selected ? buildStudentName(selected.first_name, selected.middle_name, selected.last_name) : ''}`}
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
      {Array.isArray(students) && students.length ? (
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <label className="mb-1.5 block text-sm font-medium text-slate-600" htmlFor="feePayStudentSearch">
            Search student
          </label>
          <Input
            id="feePayStudentSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a name or ID to switch student..."
            className="w-full"
          />
          {searchMatches.length ? (
            <div className="mt-1 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5">
              {searchMatches.map((s) => (
                <button
                  key={s.student_id}
                  type="button"
                  onClick={() => pickStudent(s)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                    selected?.student_id === s.student_id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-100'
                  }`}
                >
                  <span className="truncate font-medium">{buildStudentName(s.first_name, s.middle_name, s.last_name)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">{s.student_id} · {s.class_applying}</span>
                </button>
              ))}
            </div>
          ) : search.trim().length >= 2 ? (
            <p className="mt-1 text-xs text-slate-400">No students match "{search.trim()}".</p>
          ) : null}
          <p className="mt-1.5 text-xs text-slate-500">
            Recording payment for:&nbsp;
            <b>{selected ? `${buildStudentName(selected.first_name, selected.middle_name, selected.last_name)} (${selected.student_id})` : '—'}</b>
          </p>
        </div>
      ) : null}
      {selected ? (
        <>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-bold text-slate-800">
              {buildStudentName(selected.first_name, selected.middle_name, selected.last_name)}
            </p>
            <p className="font-mono text-xs text-slate-400">{selected.student_id} · {selected.class_applying}</p>
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
            {allocations.length ? (
              <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs">
                <p className="font-semibold text-amber-800">This payment settles the oldest balance(s) first:</p>
                {allocations.map((a, i) => (
                  <p key={`${a.fee_id}-${i}`} className="text-amber-700">
                    GHC {Number(a.amount).toFixed(2)} → {a.term} {a.academic_year}
                  </p>
                ))}
                <p className="mt-0.5 text-[11px] text-amber-600">Receipt is issued for {termLabel(term)} {year}.</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Select label="Academic year" value={year} onChange={(e) => setYear(e.target.value)}>
              {academicYearList(6, [year]).map((y) => (
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