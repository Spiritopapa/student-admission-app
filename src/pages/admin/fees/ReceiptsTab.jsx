import { useEffect, useMemo, useState } from 'react';
import { ReceiptText, Eye, Trash2, Search } from 'lucide-react';
import { useSchoolId } from '../../../hooks/useSchool';
import { useToast } from '../../../context/ToastContext';
import { Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput } from '../../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../../components/ui-extras';
import ReceiptModal from '../../../components/ReceiptModal';
import { supabase } from '../../../lib/supabase';
import { cedi, formatDateTime } from '../../../lib/format';

export default function ReceiptsTab() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [receipts, setReceipts] = useState([]);
  const [appsMap, setAppsMap] = useState({});
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const [view, setView] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Bulk delete panel
  const [bulkClass, setBulkClass] = useState('');
  const [bulkFrom, setBulkFrom] = useState('');
  const [bulkTo, setBulkTo] = useState('');
  const [previewRows, setPreviewRows] = useState(null);
  const [previewMsg, setPreviewMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: receiptsData }, { data: appsData }, { data: classRows }] = await Promise.all([
        supabase.from('receipts').select('*').eq('school_id', schoolId).order('receipt_date', { ascending: false }).limit(1000),
        supabase.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('school_id', schoolId),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setReceipts(receiptsData || []);
      setAppsMap(Object.fromEntries((appsData || []).map((a) => [a.student_id, a])));
      setClasses(classRows || []);
    } catch (err) {
      toast.error('Could not load receipts', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return receipts.filter((r) => {
      const app = appsMap[r.student_id];
      const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ').toLowerCase() : '';
      if (q && !r.receipt_number.toLowerCase().includes(q) && !(r.student_id || '').toLowerCase().includes(q) && !name.includes(q)) return false;
      if (fromDate && new Date(r.receipt_date) < new Date(fromDate + 'T00:00:00')) return false;
      if (toDate && new Date(r.receipt_date) > new Date(toDate + 'T23:59:59')) return false;
      if (classFilter && app?.class_applying !== classFilter) return false;
      return true;
    });
  }, [receipts, appsMap, query, fromDate, toDate, classFilter]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = filtered
      .filter((r) => (r.receipt_date || '').slice(0, 10) === today)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return { count: filtered.length, total, todayTotal };
  }, [filtered]);

  const studentName = (r) => {
    const app = appsMap[r.student_id];
    return app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : r.student_id;
  };

  const confirmDeleteReceipt = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_receipt', { p_receipt_id: deleting.id });
      if (error) throw new Error(error.message);
      toast.success('Receipt deleted', deleting.receipt_number);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete receipt', err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const runPreview = async () => {
    setPreviewMsg('');
    setPreviewRows(null);
    if (!bulkClass) {
      setPreviewMsg('Select a class.');
      return;
    }
    try {
      const { data: students } = await supabase
        .from('applications')
        .select('student_id')
        .eq('school_id', schoolId)
        .eq('class_applying', bulkClass);
      const ids = (students || []).map((s) => s.student_id);
      if (!ids.length) {
        setPreviewMsg('No students found in this class.');
        return;
      }
      let q = supabase.from('receipts').select('*').in('student_id', ids).eq('school_id', schoolId).order('receipt_date', { ascending: false });
      if (bulkFrom) q = q.gte('receipt_date', bulkFrom + 'T00:00:00');
      if (bulkTo) q = q.lte('receipt_date', bulkTo + 'T23:59:59.999');
      const { data } = await q;
      setPreviewRows(data || []);
      if (!data || !data.length) setPreviewMsg('No receipts found for the selected class and date range.');
    } catch (err) {
      setPreviewRows(null);
      setPreviewMsg('Error loading receipts: ' + err.message);
    }
  };

  const runBulkDelete = async () => {
    setBulkBusy(true);
    try {
      const { data, error } = await supabase.rpc('delete_receipts_by_class_date', {
        p_class_name: bulkClass,
        p_date_from: bulkFrom || null,
        p_date_to: bulkTo || null,
        p_school_id: schoolId,
      });
      if (error) throw new Error(error.message);
      toast.success('Receipts deleted', `Removed ${data?.receipt_count ?? 0} receipt(s) — payments reversed.`);
      setConfirmDelete(false);
      setPreviewRows(null);
      setPreviewMsg('');
      load();
    } catch (err) {
      toast.error('Could not delete receipts', err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone="slate">{summary.count} receipt(s)</Badge>
        <Badge tone="green">Total {cedi(summary.total)}</Badge>
        <Badge tone="blue">Today {cedi(summary.todayTotal)}</Badge>
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="w-full lg:max-w-xs">
          <SearchInput value={query} onChange={setQuery} placeholder="Search receipt number, student..." />
        </div>
        <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From" />
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To" />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading receipts..." />
      ) : filtered.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <ReceiptText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold text-slate-800">{r.receipt_number}</p>
                  <p className="truncate text-xs text-slate-400">
                    {studentName(r)} ({r.student_id}) · {r.term} {r.academic_year} · {formatDateTime(r.receipt_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="amber">{cedi(r.amount)}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setView(r)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    View
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState icon={Search} title="No receipts found" message="Adjust the search/filters or issue new receipts from fee payments." />
      )}

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold text-slate-800">Delete receipts by class & date</h2>
        <p className="mt-1 text-xs text-slate-500">Deletes every receipt (and reverses the payment) for the selected class within a date range.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Class *" value={bulkClass} onChange={(e) => setBulkClass(e.target.value)}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="From date" type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
          <Input label="To date" type="date" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
          <div className="flex items-end">
            <Button variant="secondary" onClick={runPreview} className="w-full">
              Preview receipts
            </Button>
          </div>
        </div>
        {previewMsg ? <Alert tone="error" className="mt-3">{previewMsg}</Alert> : null}
        {previewRows && previewRows.length ? (
          <div className="mt-4">
            <Alert tone="warning" className="mb-3">
              Found <b>{previewRows.length}</b> receipt(s) totaling{' '}
              <b>{cedi(previewRows.reduce((s, r) => s + Number(r.amount || 0), 0))}</b> that will be deleted. Payments will be reversed on the students' fee records.
            </Alert>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-100">
              {previewRows.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="font-mono text-slate-600">{r.receipt_number} · {studentName(r)}</span>
                  <b className="text-slate-700">{cedi(r.amount)}</b>
                </div>
              ))}
            </div>
            <Button variant="danger" className="mt-3" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete {previewRows.length} receipt(s)
            </Button>
          </div>
        ) : null}
      </Card>

      <ReceiptModal receipt={view} onClose={() => setView(null)} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDeleteReceipt}
        loading={deleteBusy}
        title="Delete receipt?"
        message="This deletes the receipt and reverses the payment from the student's fee records."
        confirmLabel="Delete receipt"
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={runBulkDelete}
        loading={bulkBusy}
        title="Delete receipts?"
        message={`Are you sure? ${previewRows?.length || 0} receipt(s) will be permanently deleted and the payments reversed. This cannot be undone.`}
        confirmLabel="Delete all"
      />
    </div>
  );
}