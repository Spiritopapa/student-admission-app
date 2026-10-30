import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Wallet, ReceiptText, Building2, ArrowRight, RefreshCw, AlertTriangle, UserCircle } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useAccountant } from '../../hooks/useAccountant';
import { PageHeader, Card, Spinner, StatCard, Button, EmptyState } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { cedi } from '../../lib/format';
import { currentAcademicYear, ROLE_LABELS } from '../../lib/constants';
import { useModuleLock } from '../../context/ModuleLockContext';

export default function AccountantHome() {
  const schoolId = useSchoolId();
  const { isModuleLocked } = useModuleLock();
  const { fullName, firstName, registrationId, photo, loading: nameLoading } = useAccountant();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const [{ data: todayReceipts, error: todayErr }, { data: allReceipts, error: allErr }] = await Promise.all([
          supabase
            .from('receipts')
            .select('amount, receipt_date')
            .eq('school_id', schoolId)
            .gte('receipt_date', today)
            .lt('receipt_date', tomorrow),
          supabase.from('receipts').select('amount').eq('school_id', schoolId),
        ]);
        if (cancelled) return;

        if (!todayErr && !allErr) {
          const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
          setStats({
            todayCount: (todayReceipts || []).length,
            todayTotal: Math.round(sum(todayReceipts)),
            total: Math.round(sum(allReceipts)),
            count: (allReceipts || []).length,
          });
          return;
        }

        // The receipts source is unavailable (older deployment / schema drift).
        // Fall back to payment_transactions so the dashboard still loads real
        // collection figures instead of getting stuck.
        const tx = await supabase
          .from('payment_transactions')
          .select('amount_paid, payment_date')
          .eq('school_id', schoolId);
        if (cancelled) return;
        if (!tx.error) {
          const rows = tx.data || [];
          const dayRows = rows.filter((r) => (r.payment_date || '').slice(0, 10) === today);
          const sum = (arr) => arr.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
          setStats({
            todayCount: dayRows.length,
            todayTotal: Math.round(sum(dayRows)),
            total: Math.round(sum(rows)),
            count: rows.length,
          });
          return;
        }
        throw new Error(todayErr?.message || allErr?.message || tx?.error?.message || 'Could not load fee collection data.');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load fee collection data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, attempt]);

  if (!schoolId) {
    return (
      <EmptyState
        icon={Building2}
        title="No school linked"
        message="This accountant account is not linked to a school yet. Ask the school administrator to link your account, then sign out and back in."
      />
    );
  }

  if (isModuleLocked('fees')) {
    return <EmptyState icon={Wallet} title="Fees Management is locked" message="The Super Administrator has disabled fee collection features for this school." />;
  }

  if (loading && !stats) return <Spinner label="Loading dashboard..." />;

  if (!stats && error) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="Could not load the dashboard"
        message={`${error} Check that the school's receipts / payment records are available, then try again.`}
        action={
          <Button onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    );
  }

  if (!stats) return <Spinner label="Loading dashboard..." />;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName || 'Accountant'}`}
        subtitle={`Fee collections summary for ${currentAcademicYear()}`}
        icon={LayoutDashboard}
        actions={
          <Link to="/accountant/collect" className="btn-primary">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Collect payment
          </Link>
        }
      />

      {/* Accountant identity: the name shown here comes from the accountant's
          own `accountants` record (the authoritative, admin-locked value) and
          falls back to the signed-in profile name when no record is linked. */}
      <Card className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {photo ? (
            <img
              src={photo}
              alt={fullName || 'Accountant'}
              className="img-zoom h-16 w-16 shrink-0 rounded-2xl object-cover ring-2 ring-brand-100"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blend text-xl font-extrabold text-white shadow-card">
              {(fullName || 'A').charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Signed in as accountant
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-slate-900">
              {nameLoading && !fullName ? (
                <span className="text-slate-400">Loading name...</span>
              ) : (
                fullName || 'Accountant'
              )}
            </h2>
            {registrationId ? (
              <p className="mt-1 text-sm font-medium text-slate-500">
                Accountant ID: <span className="font-semibold text-slate-700">{registrationId}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <UserCircle className="h-5 w-5 text-brand-600" aria-hidden="true" />
          {ROLE_LABELS.accountant}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} tone="teal" label="Collected today" value={cedi(stats.todayTotal)} sub={`${stats.todayCount} receipts issued`} index={0} />
        <StatCard icon={ReceiptText} tone="blue" label="Total receipts" value={stats.count} sub="All-time for this school" index={1} />
        <StatCard icon={Wallet} tone="amber" label="Total collected" value={cedi(stats.total)} sub="Cumulative receipts amount" index={2} />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

        <Link to="/accountant/debtors" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Debtors</h3>
          <p className="mt-1 text-sm text-slate-500">Students with outstanding fee balances.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-rose-600">
            View debtors
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>
      </div>
    </div>
  );
}
