import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Pencil, Trash2, ListChecks, Users } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { TERMS, currentAcademicYear, TERM_LABELS } from '../../lib/constants';
import { cedi, termLabel, buildStudentName } from '../../lib/format';

const TERM_ORDER = { First: 0, Second: 1, Third: 2 };

export default function AdminFees() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [tab, setTab] = useState('structure'); // structure | records
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordQuery, setRecordQuery] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    class_name: '',
    academic_year: currentAcademicYear(),
    term: 'First',
    fee_amount: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const [editRecord, setEditRecord] = useState(null);
  const [recordForm, setRecordForm] = useState({ total_amount: '', debt: '' });
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [deleteRecord, setDeleteRecord] = useState(null);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    Promise.all([
      supabase
        .from('class_fees')
        .select('*')
        .eq('school_id', schoolId)
        .order('academic_year', { ascending: false })
        .order('term'),
      supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
    ]).then(([{ data }, { data: classesData }]) => {
      setRows(data || []);
      setClasses(classesData || []);
      setLoading(false);
    });
  };

  const loadRecords = async () => {
    if (!schoolId) return;
    setRecordsLoading(true);
    try {
      const [{ data: feesData }, { data: appsData }] = await Promise.all([
        supabase.from('fees').select('*').eq('school_id', schoolId),
        supabase
          .from('applications')
          .select('student_id, first_name, middle_name, last_name, class_applying')
          .eq('school_id', schoolId),
      ]);
      const appMap = Object.fromEntries((appsData || []).map((a) => [a.student_id, a]));
      const list = (feesData || []).map((f) => ({
        ...f,
        app: appMap[f.student_id] || null,
        name: appMap[f.student_id] ? buildStudentName(appMap[f.student_id].first_name, appMap[f.student_id].middle_name, appMap[f.student_id].last_name) : f.student_id,
        className: appMap[f.student_id]?.class_applying || '',
      }));
      list.sort((a, b) => {
        const ay = (s) => Number(String(s.academic_year).split('/')[0] || 0);
        return ay(b.academic_year) - ay(a.academic_year) || TERM_ORDER[b.term] - TERM_ORDER[a.term];
      });
      setRecords(list);
    } catch (err) {
      toast.error('Could not load fee records', err.message);
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'records') loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, schoolId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filteredRecords = useMemo(() => {
    const q = recordQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) => r.name.toLowerCase().includes(q) || r.student_id.toLowerCase().includes(q) || (r.className || '').toLowerCase().includes(q)
    );
  }, [records, recordQuery]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = () => {
    setEditing(null);
    setForm({
      class_name: classes[0]?.name || '',
      academic_year: settings?.academic_year || currentAcademicYear(),
      term: 'First',
      fee_amount: '',
    });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      class_name: row.class_name,
      academic_year: row.academic_year,
      term: row.term,
      fee_amount: String(row.fee_amount),
    });
    setError('');
    setOpen(true);
  };

  // Creates/updates the per-student `fees` record for every student in the
  // class, mirroring the legacy "Set/Update Class Fee" flow. This is what
  // makes it possible to collect payments for existing students.
  const applyClassFeeToStudents = async (className, year, termName, amount) => {
    if (!schoolId) return { updated: 0, credits: 0 };
    const { data: students } = await supabase
      .from('applications')
      .select('student_id')
      .eq('school_id', schoolId)
      .eq('class_applying', className);
    let updated = 0;
    let credits = 0;
    for (const student of students || []) {
      const { data: existing } = await supabase
        .from('fees')
        .select('id, overpaid_amount')
        .eq('student_id', student.student_id)
        .eq('academic_year', year)
        .eq('term', termName)
        .maybeSingle();
      let effectiveAmount = amount;
      let remainingOverpaid = 0;
      if (existing) {
        // Apply any overpaid credit from a previous term.
        const { data: prevOverpaid } = await supabase
          .from('fees')
          .select('overpaid_amount')
          .eq('student_id', student.student_id)
          .gt('overpaid_amount', 0)
          .neq('id', existing.id)
          .order('academic_year', { ascending: false })
          .order('term', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (prevOverpaid && Number(prevOverpaid.overpaid_amount) > 0) {
          const credit = Number(prevOverpaid.overpaid_amount);
          effectiveAmount = Math.max(amount - credit, 0);
          remainingOverpaid = Math.max(credit - amount, 0);
          await supabase
            .from('fees')
            .update({ overpaid_amount: remainingOverpaid })
            .eq('student_id', student.student_id)
            .neq('id', existing.id)
            .gt('overpaid_amount', 0);
          if (credit > 0) credits += 1;
        }
        await supabase
          .from('fees')
          .update({ total_amount: amount, payment_status: amount > 0 ? 'unpaid' : 'paid' })
          .eq('id', existing.id);
        updated += 1;
      } else {
        await supabase.from('fees').insert({
          student_id: student.student_id,
          academic_year: year,
          term: termName,
          total_amount: effectiveAmount,
          amount_paid: 0,
          debt: 0,
          overpaid_amount: remainingOverpaid,
          payment_status: effectiveAmount > 0 ? 'unpaid' : 'paid',
          school_id: schoolId,
        });
        updated += 1;
      }
    }
    return { updated, credits };
  };

  const save = async () => {
    setError('');
    if (!form.class_name) {
      setError('Select a class.');
      return;
    }
    const amount = Number(form.fee_amount || 0);
    setBusy(true);
    try {
      const payload = {
        class_name: form.class_name,
        academic_year: form.academic_year,
        term: form.term,
        fee_amount: amount,
        school_id: schoolId,
      };
      if (editing) {
        const { error: updateError } = await supabase.from('class_fees').update(payload).eq('id', editing.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await supabase.from('class_fees').insert([payload]);
        if (insertError) throw new Error(insertError.message);
      }
      // Apply to every student in the class so the accountant can collect.
      const applied = await applyClassFeeToStudents(form.class_name, form.academic_year, form.term, amount);
      toast.success(
        editing ? 'Fee structure updated' : 'Fee structure added',
        `${form.class_name} - ${termLabel(form.term)} = GHC ${amount.toFixed(2)} · ${applied.updated} student fee record${applied.updated === 1 ? '' : 's'} updated/created${applied.credits ? ` · ${applied.credits} credit(s) applied` : ''}`
      );
      setOpen(false);
      load();
      if (tab === 'records') loadRecords();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('class_fees').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete fee structure', error.message);
    else toast.success('Fee structure deleted', `${deleting.class_name}`);
    setDeleting(null);
    load();
  };

  const openEditRecord = (record) => {
    setEditRecord(record);
    setRecordForm({ total_amount: String(record.total_amount ?? 0), debt: String(record.debt ?? 0) });
    setRecordError('');
  };

  const saveRecord = async () => {
    if (!editRecord) return;
    setRecordError('');
    const total = Number(recordForm.total_amount || 0);
    const debt = Number(recordForm.debt || 0);
    if (total < 0 || debt < 0) {
      setRecordError('Amounts cannot be negative.');
      return;
    }
    setRecordBusy(true);
    try {
      const { error } = await supabase.from('fees').update({ total_amount: total, debt }).eq('id', editRecord.id);
      if (error) throw new Error(error.message);
      toast.success('Fee record updated', `${editRecord.student_id} · ${termLabel(editRecord.term)} ${editRecord.academic_year}`);
      setEditRecord(null);
      loadRecords();
    } catch (err) {
      setRecordError(err.message);
    } finally {
      setRecordBusy(false);
    }
  };

  const confirmDeleteRecord = async () => {
    if (!deleteRecord) return;
    const { error } = await supabase.from('fees').delete().eq('id', deleteRecord.id);
    if (error) toast.error('Could not delete fee record', error.message);
    else toast.success('Fee record deleted', `${deleteRecord.student_id} · ${termLabel(deleteRecord.term)} ${deleteRecord.academic_year}`);
    setDeleteRecord(null);
    loadRecords();
  };

  return (
    <div>
      <PageHeader
        title="Fees"
        subtitle="Set class fee structures, apply them to students and manage fee records."
        icon={Wallet}
        actions={
          tab === 'structure' ? (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add fee structure
            </Button>
          ) : null
        }
      />

      <div className="mb-6 flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
        {[
          { value: 'structure', label: 'Class fee structure' },
          { value: 'records', label: 'Student fee records' },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${tab === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'records' ? (
        <>
          <div className="mb-4 max-w-sm">
            <SearchInput value={recordQuery} onChange={setRecordQuery} placeholder="Search by student, ID or class..." />
          </div>
          {recordsLoading ? (
            <Spinner label="Loading fee records..." />
          ) : filteredRecords.length ? (
            <div className="space-y-2">
              {filteredRecords.map((record) => {
                const balance = Number(record.total_amount || 0) + Number(record.debt || 0) - Number(record.amount_paid || 0);
                const status = balance <= 0 ? (Number(record.amount_paid) > 0 || Number(record.total_amount) === 0 ? 'paid' : 'unpaid') : record.payment_status || (Number(record.amount_paid) > 0 ? 'partial' : 'unpaid');
                return (
                  <Card key={record.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{record.name}</p>
                      <p className="text-xs text-slate-400">
                        {record.student_id} · {record.className || '—'} · {termLabel(record.term)} {record.academic_year}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-500">
                        Total {cedi(record.total_amount)} · Paid {cedi(record.amount_paid)}
                        {record.debt ? ` · Debt ${cedi(record.debt)}` : ''}
                      </span>
                      <Badge tone={status === 'paid' ? 'green' : status === 'partial' ? 'amber' : 'red'}>
                        {status} {balance > 0 ? `· Bal ${cedi(balance)}` : ''}
                      </Badge>
                      <button type="button" onClick={() => openEditRecord(record)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit fee record">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => setDeleteRecord(record)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete fee record">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No fee records found"
              message="Set a class fee structure and it is automatically applied to every student in that class."
              action={<Button onClick={() => setTab('structure')}>Go to fee structure</Button>}
            />
          )}
        </>
      ) : loading ? (
        <Spinner label="Loading fee structure..." />
      ) : rows.length ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
                  <Wallet className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{row.class_name}</p>
                  <p className="text-xs text-slate-400">
                    {row.academic_year} · {termLabel(row.term)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="amber">{cedi(row.fee_amount)}</Badge>
                <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit fee structure">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete fee structure">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Wallet}
          title="No fee structures yet"
          message="Add the term fee for each class. New students admitted to a class automatically get this fee, and existing students get a fee record when the structure is saved."
          action={<Button onClick={openAdd}>Add fee structure</Button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit fee structure' : 'Add fee structure'}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              Save
            </Button>
          </div>
        }
      >
        {error ? (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Class *" value={form.class_name} onChange={set('class_name')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Academic year" value={form.academic_year} onChange={set('academic_year')} />
          <Select label="Term" value={form.term} onChange={set('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {TERM_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input label="Fee amount (GHC)" type="number" min="0" step="0.01" value={form.fee_amount} onChange={set('fee_amount')} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete fee structure?"
        message={`This removes the fee for ${deleting?.class_name || 'this class'}. Existing student fee records are not changed.`}
      />

      <Modal open={!!editRecord} onClose={() => setEditRecord(null)} title="Edit fee record" size="sm">
        {recordError ? (
          <Alert tone="error" className="mb-4">
            {recordError}
          </Alert>
        ) : null}
        {editRecord ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {editRecord.student_id} · {termLabel(editRecord.term)} {editRecord.academic_year} · Already paid {cedi(editRecord.amount_paid)}
            </p>
            <Input
              label="Total amount (GHC)"
              type="number"
              min="0"
              step="0.01"
              value={recordForm.total_amount}
              onChange={(e) => setRecordForm((f) => ({ ...f, total_amount: e.target.value }))}
            />
            <Input
              label="Additional debt (GHC)"
              type="number"
              min="0"
              step="0.01"
              value={recordForm.debt}
              onChange={(e) => setRecordForm((f) => ({ ...f, debt: e.target.value }))}
            />
          </div>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={() => setEditRecord(null)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={saveRecord} loading={recordBusy} className="flex-1">
            Save record
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteRecord}
        onClose={() => setDeleteRecord(null)}
        onConfirm={confirmDeleteRecord}
        title="Delete fee record?"
        message="This permanently removes the fee record. Payments already made for it are not removed."
        confirmLabel="Delete record"
      />
    </div>
  );
}