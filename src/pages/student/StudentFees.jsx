import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ReceiptText, History } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, Badge, EmptyState } from '../../components/ui';
import { Tabs } from '../../components/ui-extras';
import ReceiptModal from '../../components/ReceiptModal';
import {
  fetchStudentFees,
  fetchStudentTransactions,
  fetchStudentReceipts,
} from '../../lib/queries';
import { cedi, formatDateTime, termLabel } from '../../lib/format';

export default function StudentFees() {
  const { application, loading } = useStudentApplication();
  const [fees, setFees] = useState([]);
  const [txs, setTxs] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [tab, setTab] = useState('fees');
  const [activeReceipt, setActiveReceipt] = useState(null);

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    Promise.all([
      fetchStudentFees(application.student_id),
      fetchStudentTransactions(application.student_id),
      fetchStudentReceipts(application.student_id),
    ])
      .then(([f, t, r]) => {
        if (cancelled) return;
        setFees(f);
        setTxs(t);
        setReceipts(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [application]);

  if (loading) return <Spinner label="Loading fees..." />;
  if (!application) return <EmptyState title="No student record" />;

  const totals = fees.reduce(
    (acc, fee) => {
      acc.total += Number(fee.total_amount || 0);
      acc.paid += Number(fee.amount_paid || 0);
      return acc;
    },
    { total: 0, paid: 0 }
  );
  const balance = totals.total - totals.paid;

  return (
    <div>
      <PageHeader title="Fee Details" subtitle="Term fees, payments and receipts for the current academic year." icon={Wallet} />
      <ReceiptModal receipt={activeReceipt} onClose={() => setActiveReceipt(null)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-brand-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total billed</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{cedi(totals.total)}</p>
        </Card>
        <Card className="border-l-4 border-l-teal-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Amount paid</p>
          <p className="mt-1 text-xl font-bold text-teal-700">{cedi(totals.paid)}</p>
        </Card>
        <Card className="border-l-4 border-l-accent-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Balance</p>
          <p className="mt-1 text-xl font-bold text-accent-600">{cedi(balance)}</p>
        </Card>
      </div>

      <Tabs
        className="mt-6"
        tabs={[
          { value: 'fees', label: 'Term fees', icon: Wallet },
          { value: 'payments', label: 'Payment history', icon: History },
          { value: 'receipts', label: 'Receipts', icon: ReceiptText },
        ]}
        active={tab}
        onChange={setTab}
      />

      <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
        {tab === 'fees' ? (
          <div className="space-y-4">
            {fees.length ? (
              fees.map((fee) => (
                <Card key={fee.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        {fee.academic_year} - {termLabel(fee.term)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">Student fee record</p>
                    </div>
                    <Badge
                      tone={
                        fee.payment_status === 'paid'
                          ? 'green'
                          : fee.payment_status === 'partial'
                            ? 'amber'
                            : 'red'
                      }
                    >
                      {fee.payment_status}
                    </Badge>
                  </div>
                  <div className="mt-4">
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-2 rounded-full ${
                          fee.payment_status === 'paid'
                            ? 'bg-emerald-500'
                            : fee.payment_status === 'partial'
                              ? 'bg-accent-500'
                              : 'bg-rose-400'
                        }`}
                        style={{
                          width: `${
                            fee.total_amount ? Math.min(100, (Number(fee.amount_paid) / Number(fee.total_amount)) * 100) : 0
                          }%`,
                        }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
                        <p className="text-sm font-bold text-slate-800">{cedi(fee.total_amount)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Paid</p>
                        <p className="text-sm font-bold text-teal-700">{cedi(fee.amount_paid)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Balance</p>
                        <p className="text-sm font-bold text-accent-600">
                          {cedi(Number(fee.balance) >= 0 ? fee.balance : 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <EmptyState
                icon={Wallet}
                title="No fee records"
                message="Your school has not set up fees for your class yet."
              />
            )}
          </div>
        ) : null}

        {tab === 'payments' ? (
          <Card className="overflow-hidden">
            {txs.length ? (
              <div className="divide-y divide-slate-100">
                {txs.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{cedi(tx.amount_paid)}</p>
                      <p className="text-xs text-slate-400">
                        {formatDateTime(tx.payment_date)} · {tx.payment_method}
                      </p>
                    </div>
                    {tx.reference_number ? (
                      <span className="font-mono text-xs text-slate-400">{tx.reference_number}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  icon={History}
                  title="No payments yet"
                  message="Payments made at the school office will appear here."
                />
              </div>
            )}
          </Card>
        ) : null}

        {tab === 'receipts' ? (
          <div className="space-y-3">
            {receipts.length ? (
              receipts.map((receipt) => (
                <button
                  key={receipt.id}
                  type="button"
                  onClick={() => setActiveReceipt(receipt)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-soft transition-all hover:border-brand-300 hover:shadow-card"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <ReceiptText className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-800">{receipt.receipt_number}</p>
                      <p className="text-xs text-slate-400">
                        {formatDateTime(receipt.receipt_date)} · {cedi(receipt.amount)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-brand-600">View receipt</span>
                </button>
              ))
            ) : (
              <EmptyState
                icon={ReceiptText}
                title="No receipts yet"
                message="Every fee payment you make comes with a verified receipt."
              />
            )}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}