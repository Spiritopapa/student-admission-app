import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Wallet, ReceiptText, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSchoolId } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, StatCard } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { cedi } from '../../lib/format';
import { currentAcademicYear } from '../../lib/constants';

export default function AccountantHome() {
  const { profile } = useAuth();
  const schoolId = useSchoolId();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [{ data: todayReceipts }, { data: allReceipts }] = await Promise.all([
          supabase.from('receipts').select('amount').eq('school_id', schoolId).gte('receipt_date', today).lt('receipt_date', new Date(Date.now() + 86400000).toISOString().slice(0, 10)),
          supabase.from('receipts').select('amount').eq('school_id', schoolId),
        ]);
        if (cancelled) return;
        const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
        setStats({
          todayCount: (todayReceipts || []).length,
          todayTotal: Math.round(sum(todayReceipts)),
          total: Math.round(sum(allReceipts)),
          count: (allReceipts || []).length,
        });
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  if (!stats) return <Spinner label="Loading dashboard..." />;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.full_name?.split(' ')[0] || 'Accountant'}`}
        subtitle={`Fee collections summary for ${currentAcademicYear()}`}
        icon={LayoutDashboard}
        actions={
          <Link to="/accountant/collect" className="btn-primary">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Collect payment
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} tone="teal" label="Collected today" value={cedi(stats.todayTotal)} sub={`${stats.todayCount} receipts issued`} />
        <StatCard icon={ReceiptText} tone="blue" label="Total receipts" value={stats.count} sub="All-time for this school" />
        <StatCard icon={Wallet} tone="amber" label="Total collected" value={cedi(stats.total)} sub="Cumulative receipts amount" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Link to="/accountant/collect" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <Wallet className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Record a payment</h3>
          <p className="mt-1 text-sm text-slate-500">Search for a student, enter the amount and issue a verified receipt.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-600">
            Start collecting
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>

        <Link to="/accountant/receipts" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Receipt history</h3>
          <p className="mt-1 text-sm text-slate-500">Browse every receipt issued for this school.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
            View receipts
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>
      </div>
    </div>
  );
}