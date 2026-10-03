import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Trash2, ReceiptText, Printer, Search, Eye, Pencil, FileText } from 'lucide-react';
import { useSchoolId } from '../../../hooks/useSchool';
import { useToast } from '../../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput } from '../../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../../components/ui-extras';
import ReceiptModal from '../../../components/ReceiptModal';
import FeePaymentModal from './FeePaymentModal';
import { supabase } from '../../../lib/supabase';
import { buildStudentName, cedi, formatDate, termLabel } from '../../../lib/format';
import { TERMS, TERM_LABELS, currentAcademicYear, academicYearList } from '../../../lib/constants';
import { openPrintWindow, escapeHtml } from '../../../lib/print';
import { photoUrl } from '../../../lib/storage';
import { printTermlyBills, fetchTermClosingDate } from '../../../lib/termBill';

const TERM_ORDER = { First: 0, Second: 1, Third: 2 };
const yearStart = (y) => Number(String(y || '').split('/')[0] || 0);

export default function StudentFeesTab() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState([]);
  const [records, setRecords] = useState([]);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [termFilter, setTermFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [paying, setPaying] = useState(null);
  const [editingFees, setEditingFees] = useState(null);
  const [editRows, setEditRows] = useState([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [receiptsFor, setReceiptsFor] = useState(null);
  const [studentReceipts, setStudentReceipts] = useState([]);
  const [receiptView, setReceiptView] = useState(null);
  const [deleteReceipt, setDeleteReceipt] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [classes, setClasses] = useState([]);

  // Termly bill print dialog
  const [billOpen, setBillOpen] = useState(false);
  const [billScope, setBillScope] = useState(null); // { kind: 'all' } | { kind: 'one', row }
  const [billYear, setBillYear] = useState(currentAcademicYear());
  const [billTerm, setBillTerm] = useState('First');
  const [billClosing, setBillClosing] = useState('');
  const [billBusy, setBillBusy] = useState(false);
  const [billClass, setBillClass] = useState(''); // class filter for bulk print
  const [billMode, setBillMode] = useState('all'); // 'all' | 'one'
  const [billStudentId, setBillStudentId] = useState('');

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: appsData }, { data: feesData }, { data: classRows }] = await Promise.all([
        supabase
          .from('applications')
          .select('id, student_id, first_name, middle_name, last_name, class_applying, status, student_photo_url, parent_contact, school_id')
          .eq('school_id', schoolId)
          .order('last_name'),
        supabase.from('fees').select('*').eq('school_id', schoolId),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setApps(appsData || []);
      setRecords(feesData || []);
      setClasses(classRows || []);
    } catch (err) {
      toast.error('Could not load fee records', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const feeMap = useMemo(() => {
    const map = {};
    records.forEach((f) => {
      if (!map[f.student_id]) map[f.student_id] = [];
      map[f.student_id].push(f);
    });
    return map;
  }, [records]);

  const appMap = useMemo(() => Object.fromEntries(apps.map((a) => [a.student_id, a])), [apps]);

  const statusOf = (fees) => {
    const unpaid = fees.some((f) => Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid) > 0);
    if (unpaid) return 'unpaid';
    const partial = fees.some((f) => Number(f.amount_paid) > 0);
    return partial ? 'partial' : 'paid';
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = apps.filter((s) => {
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
      if (q && !name.includes(q) && !s.student_id.toLowerCase().includes(q)) return false;
      if (classFilter && s.class_applying !== classFilter) return false;
      const scoped = termFilter ? (feeMap[s.student_id] || []).filter((f) => f.term === termFilter) : feeMap[s.student_id] || [];
      if (statusFilter && statusOf(scoped) !== statusFilter) return false;
      return true;
    });
    return filtered.map((s) => {
      const fees = (feeMap[s.student_id] || [])
        .slice()
        .sort((a, b) => yearStart(a.academic_year) - yearStart(b.academic_year) || TERM_ORDER[a.term] - TERM_ORDER[b.term]);
      const totalBalance = fees.reduce(
        (sum, f) => sum + Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0),
        0
      );
      return { app: s, fees, totalBalance };
    });
  }, [apps, feeMap, search, classFilter, termFilter, statusFilter]);

  const grandBalance = useMemo(() => rows.reduce((s, r) => s + r.totalBalance, 0), [rows]);

  const openEditFees = (app) => {
    const fees = (feeMap[app.student_id] || []).map((f) => ({
      id: f.id,
      academic_year: f.academic_year,
      term: f.term,
      total_amount: String(f.total_amount ?? 0),
      amount_paid: String(f.amount_paid ?? 0),
      debt: String(f.debt ?? 0),
      payment_status: f.payment_status || 'unpaid',
    }));
    setEditRows(fees);
    setEditingFees(app);
    setEditError('');
  };

  const setEdit = (index, key, value) => {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  };

  const addEditRow = () => {
    setEditRows((prev) => [
      ...prev,
      { id: '', academic_year: currentAcademicYear(), term: 'First', total_amount: '0', amount_paid: '0', debt: '0', payment_status: 'unpaid' },
    ]);
  };

  const saveFees = async () => {
    if (!editingFees) return;
    setEditError('');
    setEditBusy(true);
    let updated = 0;
    try {
      for (const r of editRows) {
        if (!r.academic_year || !r.term) continue;
        const payload = {
          academic_year: r.academic_year,
          term: r.term,
          total_amount: Number(r.total_amount || 0),
          amount_paid: Number(r.amount_paid || 0),
          debt: Number(r.debt || 0),
          payment_status: r.payment_status,
        };
        if (r.id) {
          const { error } = await supabase.from('fees').update(payload).eq('id', r.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from('fees').insert([{ ...payload, student_id: editingFees.student_id, school_id: schoolId }]);
          if (error) throw new Error(error.message);
        }
        updated += 1;
      }
      toast.success('Fee records updated', `${updated} record(s) saved for ${editingFees.student_id}.`);
      setEditingFees(null);
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const openReceipts = async (app) => {
    setReceiptsFor(app);
    setStudentReceipts([]);
    const { data } = await supabase
      .from('receipts')
      .select('*')
      .eq('student_id', app.student_id)
      .eq('school_id', schoolId)
      .order('receipt_date', { ascending: false });
    setStudentReceipts(data || []);
  };

  const confirmDeleteReceipt = async () => {
    if (!deleteReceipt) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_receipt', { p_receipt_id: deleteReceipt.id });
      if (error) throw new Error(error.message);
      toast.success('Receipt deleted', deleteReceipt.receipt_number);
      setDeleteReceipt(null);
      if (receiptsFor) openReceipts(receiptsFor);
      load();
    } catch (err) {
      toast.error('Could not delete receipt', err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const printReminder = (row) => {
    const { app, fees, totalBalance } = row;
    const rowsHtml = fees
      .map((f) => {
        const bal = Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0);
        return `<tr><td>${escapeHtml(f.term)} Term ${escapeHtml(f.academic_year)}</td><td class="right">${cedi(f.total_amount)}</td><td class="right">${cedi(f.amount_paid)}</td><td class="right">${cedi(bal)}</td></tr>`;
      })
      .join('');
    openPrintWindow('Fee reminder', `
      <h1>Fee Reminder</h1>
      <p>Student: <b>${escapeHtml(buildStudentName(app.first_name, app.middle_name, app.last_name))}</b> (${escapeHtml(app.student_id)})</p>
      <p>Class: ${escapeHtml(app.class_applying)}</p>
      <table>
        <thead><tr><th>Term</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tr class="total-row"><td colspan="3">Total outstanding</td><td class="right">${cedi(totalBalance)}</td></tr>
      </table>
      <p>Please settle the outstanding balance at the school's accounts office. Thank you.</p>
    `);
  };

  const printList = () => {
    const body = rows
      .map((r) => {
        const termCell =
          r.fees
            .filter((f) => !termFilter || f.term === termFilter)
            .map((f) => {
              const bal = Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0);
              return `${escapeHtml(f.term)} ${escapeHtml(f.academic_year)}: T ${cedi(f.total_amount)} P ${cedi(f.amount_paid)} B ${cedi(bal)}`;
            })
            .join('<br/>') || '<em>No fee records</em>';
        return `<tr>
          <td>${escapeHtml(r.app.student_id)}</td>
          <td>${escapeHtml(buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name))}</td>
          <td>${escapeHtml(r.app.class_applying)}</td>
          <td>${termCell}</td>
          <td class="right"><b>${cedi(r.totalBalance)}</b></td>
        </tr>`;
      })
      .join('');
    openPrintWindow('Student fee list', `
      <h1>Student Fees</h1>
      <p>${escapeHtml(classFilter ? `Class: ${classFilter}` : 'All classes')}${termFilter ? ` · Term: ${termFilter}` : ''} · ${rows.length} student(s)</p>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Fee details</th><th class="right">Total balance</th></tr></thead>
        <tbody>${body}</tbody>
        <tr class="total-row"><td colspan="4">Total outstanding</td><td class="right">${cedi(grandBalance)}</td></tr>
      </table>
    `);
  };

const openBillDialog = (scope) => {
    setBillScope(scope);
    setBillYear(currentAcademicYear());
    setBillTerm(termFilter || 'First');
    setBillClass(classFilter || '');
    setBillMode(scope?.kind === 'one' ? 'one' : 'all');
    setBillStudentId(scope?.kind === 'one' && scope.row ? scope.row.app.student_id : '');
    setBillClosing('');
    setBillOpen(true);
  };

  useEffect(() => {
    if (!billOpen || billBusy) return;
    let cancelled = false;
    fetchTermClosingDate(schoolId, billYear, billTerm).then((date) => {
      if (!cancelled && date) setBillClosing(date || '');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billOpen, billYear, billTerm, schoolId]);

  const billTargetRows = useMemo(
    () => rows.filter((r) => !billClass || r.app.class_applying === billClass),
    [rows, billClass]
  );

  const doPrintBills = async () => {
    if (!billScope) return;
    let targets;
    if (billMode === 'one') {
      const found = rows.find((r) => r.app.student_id === billStudentId);
      if (!found) {
        toast.error('Select a student', 'Choose the student whose bill you want to print.');
        return;
      }
      targets = [found.app];
    } else {
      targets = billTargetRows.map((r) => r.app);
    }
    setBillBusy(true);
    try {
      const count = await printTermlyBills({
        schoolId,
        students: targets,
        year: billYear,
        term: billTerm,
        closingDate: billClosing || null,
      });
      if (!count) {
        toast.error('Nothing to print', 'No students match the selected filters.');
        return;
      }
      toast.success('Termly bills printed', `${count} bill(s) generated for ${billTerm} Term ${billYear}.`);
      setBillOpen(false);
    } catch (err) {
      toast.error('Could not print bills', err.message);
    } finally {
      setBillBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="w-full sm:col-span-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search student name or ID..." />
          </div>
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
              <option value="">All terms</option>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {TERM_LABELS[t]}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All status</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">
            {rows.length} student(s) · Outstanding <b className="text-rose-600">{cedi(grandBalance)}</b>
          </span>
          <Button variant="secondary" onClick={printList} disabled={!rows.length}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print list
          </Button>
          <Button variant="secondary" onClick={() => openBillDialog({ kind: 'all' })} disabled={!rows.length}>
            <FileText className="h-4 w-4" aria-hidden="true" />
            Print termly bills
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading student fees..." />
      ) : rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const status = statusOf(row.fees);
            return (
              <Card key={row.app.id} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {row.app.student_photo_url ? (
                      <img src={photoUrl(row.app.student_photo_url)} alt="Student" className="h-12 w-10 rounded-lg object-cover ring-1 ring-slate-100" />
                    ) : (
                      <span className="flex h-12 w-10 items-center justify-center rounded-lg bg-brand-50 text-base font-bold text-brand-600">
                        {(row.app.first_name || 'S').charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{buildStudentName(row.app.first_name, row.app.middle_name, row.app.last_name)}</p>
                      <p className="font-mono text-xs text-slate-400">{row.app.student_id} · {row.app.class_applying}</p>
                    </div>
                    <Badge tone={status === 'paid' ? 'green' : status === 'partial' ? 'amber' : 'red'}>{status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Total balance</p>
                      <p className="text-sm font-bold text-rose-600">{cedi(row.totalBalance)}</p>
                    </div>
                    <Button size="sm" onClick={() => setPaying(row.app)}>
                      <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                      Pay
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openEditFees(row.app)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit Fees
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openReceipts(row.app)}>
                      <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                      Receipts
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => printReminder(row)}>
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                      Reminder
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openBillDialog({ kind: 'one', row })}>
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Bill
                    </Button>
                  </div>
                </div>
                {row.fees.length ? (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-50 pt-3 text-xs">
                    {row.fees.map((f) => {
                      const bal = Math.max(Number(f.total_amount) + Number(f.debt || 0) - Number(f.amount_paid), 0);
                      return (
                        <span key={f.id} className="text-slate-500">
                          <b className="text-slate-700">{termLabel(f.term)} {f.academic_year}:</b> Total {cedi(f.total_amount)} · Paid {cedi(f.amount_paid)}
                          {f.debt ? ` · Debt ${cedi(f.debt)}` : ''} ·{' '}
                          <span className={bal > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>Bal {cedi(bal)}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="No students match"
          message="Adjust the search or filters — or set the class fee structure to generate fee records."
          action={<Button onClick={() => { setSearch(''); setClassFilter(''); setTermFilter(''); setStatusFilter(''); }}>Clear filters</Button>}
        />
      )}

      <FeePaymentModal open={!!paying} student={paying} onClose={() => setPaying(null)} onPaid={load} />
<Modal
        open={billOpen}
        onClose={() => setBillOpen(false)}
        title="Print termly bills"
        subtitle={`${billTerm} Term ${billYear}${billClass ? ` · ${billClass}` : ''}`}
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setBillOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={doPrintBills} loading={billBusy} disabled={billMode === 'one' && !billStudentId} className="flex-1">
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {billMode === 'one' ? 'bill' : `${billTargetRows.length} bills`}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select label="Class" value={billClass} onChange={(e) => setBillClass(e.target.value)}>
            <option value="">
              All classes ({rows.length})
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-600">Print</p>
            <div className="flex gap-2">
              <Button size="sm" variant={billMode === 'all' ? 'brand' : 'secondary'} onClick={() => setBillMode('all')}>
                All students
              </Button>
              <Button
                size="sm"
                variant={billMode === 'one' ? 'brand' : 'secondary'}
                onClick={() => {
                  setBillMode('one');
                  if (!billTargetRows.find((r) => r.app.student_id === billStudentId)) {
                    setBillStudentId(billTargetRows[0]?.app.student_id || '');
                  }
                }}
              >
                One student
              </Button>
            </div>
          </div>
          {billMode === 'one' ? (
            <Select label="Student" value={billStudentId} onChange={(e) => setBillStudentId(e.target.value)}>
              <option value="">Select student...</option>
              {billTargetRows.map((r) => (
                <option key={r.app.student_id} value={r.app.student_id}>
                  {buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name)} ({r.app.student_id})
                </option>
              ))}
            </Select>
          ) : null}
          <Select label="Academic year" value={billYear} onChange={(e) => setBillYear(e.target.value)}>
            {academicYearList(6, [billYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Select label="Term" value={billTerm} onChange={(e) => setBillTerm(e.target.value)}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {TERM_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input
            label="Closing / vacation date"
            type="date"
            value={billClosing}
            onChange={(e) => setBillClosing(e.target.value)}
            hint="Auto-filled from the term's exam closing date — change it if your school closes on a different day."
          />
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Each bill shows the term's charges, debt brought forward, itemised payments, the outstanding balance and the
            next term's class fee structure.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!editingFees}
        onClose={() => setEditingFees(null)}
        title={`Edit fee records — ${editingFees ? buildStudentName(editingFees.first_name, editingFees.middle_name, editingFees.last_name) : ''}`}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setEditingFees(null)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveFees} loading={editBusy} className="flex-1">
              Save changes
            </Button>
          </div>
        }
      >
        {editError ? (
          <Alert tone="error" className="mb-4">
            {editError}
          </Alert>
        ) : null}
        {editingFees ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Add or update fee records for each term.</p>
              <Button size="sm" variant="ghost" onClick={addEditRow}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add term
              </Button>
            </div>
            {editRows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-6">
                <Input label="Year" value={r.academic_year} onChange={(e) => setEdit(i, 'academic_year', e.target.value)} />
                <Select label="Term" value={r.term} onChange={(e) => setEdit(i, 'term', e.target.value)}>
                  {TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <Input label="Total" type="number" min="0" step="0.01" value={r.total_amount} onChange={(e) => setEdit(i, 'total_amount', e.target.value)} />
                <Input label="Paid" type="number" min="0" step="0.01" value={r.amount_paid} onChange={(e) => setEdit(i, 'amount_paid', e.target.value)} />
                <Input label="Debt" type="number" min="0" step="0.01" value={r.debt} onChange={(e) => setEdit(i, 'debt', e.target.value)} />
                <Select label="Status" value={r.payment_status} onChange={(e) => setEdit(i, 'payment_status', e.target.value)}>
                  <option value="paid">paid</option>
                  <option value="partial">partial</option>
                  <option value="unpaid">unpaid</option>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!receiptsFor} onClose={() => setReceiptsFor(null)} title={`Receipts — ${receiptsFor ? receiptsFor.student_id : ''}`} size="lg">
        {studentReceipts.length ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {studentReceipts.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div>
                  <p className="font-mono text-sm font-bold text-slate-800">{r.receipt_number}</p>
                  <p className="text-xs text-slate-400">
                    {r.term} {r.academic_year} · {formatDate(r.receipt_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <b className="text-sm text-slate-800">{cedi(r.amount)}</b>
                  <Button size="sm" variant="secondary" onClick={() => setReceiptView(r)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    View
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteReceipt(r)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ReceiptText} title="No receipts" message="Payments recorded for this student will appear here." />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteReceipt}
        onClose={() => setDeleteReceipt(null)}
        onConfirm={confirmDeleteReceipt}
        loading={deleteBusy}
        title="Delete receipt?"
        message="This deletes the receipt and reverses the payment from the student's fee records."
        confirmLabel="Delete receipt"
      />

      <ReceiptModal receipt={receiptView} onClose={() => setReceiptView(null)} />
    </div>
  );
}