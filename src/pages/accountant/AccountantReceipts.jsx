import { useEffect, useState } from 'react';
import { ReceiptText, Search } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, SearchInput, Badge } from '../../components/ui';
import ReceiptModal from '../../components/ReceiptModal';
import { supabase } from '../../lib/supabase';
import { cedi, formatDateTime } from '../../lib/format';

export default function AccountantReceipts() {
  const schoolId = useSchoolId();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!schoolId) return;
    supabase
      .from('receipts')
      .select('*')
      .eq('school_id', schoolId)
      .order('receipt_date', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setReceipts(data || []);
        setLoading(false);
      });
  }, [schoolId]);

  const filtered = receipts.filter(
    (r) =>
      !query ||
      r.receipt_number.toLowerCase().includes(query.toLowerCase()) ||
      (r.student_id || '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Receipts"
        subtitle="Every receipt issued for this school (latest 200 shown)."
        icon={ReceiptText}
      />
      <ReceiptModal receipt={active} onClose={() => setActive(null)} />

      <SearchInput value={query} onChange={setQuery} placeholder="Search by receipt number or Student ID..." className="mb-5 max-w-sm" />

      {loading ? (
        <Spinner label="Loading receipts..." />
      ) : filtered.length ? (
        <div className="space-y-3">
          {filtered.map((receipt) => (
            <button
              key={receipt.id}
              type="button"
              onClick={() => setActive(receipt)}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-soft transition-all hover:border-brand-300 hover:shadow-card"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <ReceiptText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-mono text-sm font-bold text-slate-800">{receipt.receipt_number}</p>
                  <p className="text-xs text-slate-400">
                    Student {receipt.student_id} · {formatDateTime(receipt.receipt_date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="amber">{cedi(receipt.amount)}</Badge>
                <span className="text-xs font-semibold text-brand-600">View</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title="No receipts found"
          message={receipts.length ? 'Try a different search.' : 'Receipts issued at this school will appear here.'}
        />
      )}
    </div>
  );
}