import { useEffect, useMemo, useState } from 'react';
import { ReceiptText, Building2, RefreshCw } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { PageHeader, Spinner, EmptyState, SearchInput, Badge, Input, Select, Button } from '../../components/ui';
import ReceiptModal from '../../components/ReceiptModal';
import { supabase } from '../../lib/supabase';
import { cedi, formatDateTime } from '../../lib/format';

export default function AccountantReceipts() {
  const schoolId = useSchoolId();
  const [receipts, setReceipts] = useState([]);
  const [appsMap, setAppsMap] = useState({});
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    Promise.all([
      supabase
        .from('receipts')
        .select('*')
        .eq('school_id', schoolId)
        .order('receipt_date', { ascending: false })
        .limit(1000),
      supabase
        .from('applications')
        .select('student_id, first_name, middle_name, last_name, class_applying')
        .eq('school_id', schoolId),
      supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
    ])
      .then(([{ data }, { data: appsData }, { data: classRows }]) => {
        setReceipts(data || []);
        setAppsMap(Object.fromEntries((appsData || []).map((a) => [a.student_id, a])));
        setClasses(classRows || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Could not load receipts.');
        setLoading(false);
      });
  }, [schoolId, attempt]);

  const studentName = (r) => {
    const app = appsMap[r.student_id];
    return app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : r.student_id;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return receipts.filter((r) => {
      const app = appsMap[r.student_id];
      const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ').toLowerCase() : '';
      if (q && !r.receipt_number.toLowerCase().includes(q) && !(r.student_id || '').toLowerCase().includes(q) && !name.includes(q)) return false;
      if (classFilter && app?.class_applying !== classFilter) return false;
      if (fromDate && new Date(r.receipt_date) < new Date(fromDate + 'T00:00:00')) return false;
      if (toDate && new Date(r.receipt_date) > new Date(toDate + 'T23:59:59')) return false;
      return true;
    });
  }, [receipts, appsMap, query, classFilter, fromDate, toDate]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = filtered
      .filter((r) => (r.receipt_date || '').slice(0, 10) === today)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return { count: filtered.length, total, todayTotal };
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Receipts"
        subtitle="Every receipt issued for this school."
        icon={ReceiptText}
      />
      <ReceiptModal receipt={active} onClose={() => setActive(null)} />

      {!schoolId ? (
        <EmptyState
          icon={Building2}
          title="No school linked"
          message="This accountant account is not linked to a school yet. Ask the school administrator to link your account, then sign out and back in."
        />
      ) : loading ? (
        <Spinner label="Loading receipts..." />
      ) : error ? (
        <EmptyState
          icon={ReceiptText}
          title="Could not load receipts"
          message={`${error} Check that the school's receipt records are available, then try again.`}
          action={
            <Button onClick={() => setAttempt((a) => a + 1)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="slate">{summary.count} receipt(s)</Badge>
        <Badge tone="green">Total {cedi(summary.total)}</Badge>
        <Badge tone="blue">Today {cedi(summary.todayTotal)}</Badge>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="w-full lg:max-w-xs">
          <SearchInput value={query} onChange={setQuery} placeholder="Search receipt, student name or ID..." />
        </div>
        <div className="w-full lg:w-48">
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From" />
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To" />
        </div>
      </div>

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
                    {studentName(receipt)} ({receipt.student_id}) · {formatDateTime(receipt.receipt_date)}
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
          message={receipts.length ? 'Try different search or filters.' : 'Receipts issued at this school will appear here.'}
        />
      )}
        </>
      )}
    </div>
  );
}