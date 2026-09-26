import { useEffect, useState } from 'react';
import { Wallet, ReceiptText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, EmptyState, Badge } from '../../components/ui';
import ReceiptModal from '../../components/ReceiptModal';
import { fetchParentLinks, fetchWardApplication, fetchStudentFees, fetchStudentReceipts } from '../../lib/queries';
import { buildStudentName, cedi, formatDateTime, termLabel } from '../../lib/format';

export default function ParentFees() {
  const { user } = useAuth();
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeReceipt, setActiveReceipt] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const links = await fetchParentLinks(user.id);
        const rows = await Promise.all(
          links.map(async (l) => {
            const app = await fetchWardApplication(l.student_id);
            if (!app) return null;
            const [fees, receipts] = await Promise.all([fetchStudentFees(app.student_id), fetchStudentReceipts(app.student_id)]);
            return { app, fees, receipts };
          })
        );
        if (!cancelled) setWards(rows.filter(Boolean));
      } catch (err) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return <Spinner label="Loading ward fees..." />;

  return (
    <div>
      <PageHeader title="Ward Fees" subtitle="Fees, balances and receipts for your children." icon={Wallet} />
      <ReceiptModal receipt={activeReceipt} onClose={() => setActiveReceipt(null)} />

      {wards.length ? (
        <div className="space-y-6">
          {wards.map(({ app, fees, receipts }) => {
            const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
            return (
              <div key={app.student_id}>
                <h2 className="mb-3 text-sm font-bold text-slate-700">{name} · {app.student_id}</h2>
                {fees.length ? (
                  <div className="space-y-3">
                    {fees.map((fee) => (
                      <Card key={fee.id} className="p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-bold text-slate-800">
                            {fee.academic_year} - {termLabel(fee.term)}
                          </p>
                          <Badge
                            tone={fee.payment_status === 'paid' ? 'green' : fee.payment_status === 'partial' ? 'amber' : 'red'}
                          >
                            {fee.payment_status}
                          </Badge>
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
                            <p className="text-sm font-bold text-accent-600">{cedi(fee.balance >= 0 ? fee.balance : 0)}</p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No fee records for this ward.</p>
                )}

                {receipts.length ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Receipts</p>
                    {receipts.map((receipt) => (
                      <button
                        key={receipt.id}
                        type="button"
                        onClick={() => setActiveReceipt(receipt)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-soft transition-colors hover:border-brand-300"
                      >
                        <span className="flex items-center gap-2 font-mono text-sm font-bold text-slate-800">
                          <ReceiptText className="h-4 w-4 text-brand-500" aria-hidden="true" />
                          {receipt.receipt_number}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(receipt.receipt_date)} · {cedi(receipt.amount)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Wallet} title="No wards linked" message="Link a student to see their fees." />
      )}
    </div>
  );
}