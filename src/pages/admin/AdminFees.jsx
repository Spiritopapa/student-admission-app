import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Pencil, Trash2, LayoutGrid, ChevronDown, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { TERMS, currentAcademicYear, academicYearList, TERM_LABELS } from '../../lib/constants';
import { cedi, termLabel } from '../../lib/format';
import StudentFeesTab from './fees/StudentFeesTab';
import DebtorsTab from './fees/DebtorsTab';
import ReceiptsTab from './fees/ReceiptsTab';
import CarryForwardTab from './fees/CarryForwardTab';

const TABS = [
  { value: 'structure', label: 'Fee Structure' },
  { value: 'students', label: 'Student Fees' },
  { value: 'debtors', label: 'Debtors' },
  { value: 'receipts', label: 'Receipts' },
  { value: 'carry', label: 'Carry Forward' },
];

const yearStart = (y) => Number(String(y || '').split('/')[0] || 0);

export default function AdminFees() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [tab, setTab] = useState('structure');
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

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
  const [openClasses, setOpenClasses] = useState({}); // class_name -> expanded (collapsible fee structure)

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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  // Group the fee structure rows by class so the list stays compact — every
  // class is a collapsible section, and only classes that already have at
  // least one term/amount configured appear at all.
  const grouped = useMemo(() => {
    const map = {};
    (rows || []).forEach((r) => {
      if (!map[r.class_name]) map[r.class_name] = [];
      map[r.class_name].push(r);
    });
    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const terms = map[name];
        const yearSet = [...new Set(terms.map((r) => r.academic_year))];
        const latestYear = yearSet.slice().sort((a, b) => yearStart(b) - yearStart(a))[0] || '';
        const latestYearTotal = terms
          .filter((r) => r.academic_year === latestYear)
          .reduce((s, r) => s + Number(r.fee_amount || 0), 0);
        return { class_name: name, terms, years: yearSet.length, latestYear, latestYearTotal };
      });
  }, [rows]);

  const toggleClass = (name) => setOpenClasses((prev) => ({ ...prev, [name]: !prev[name] }));
  const expandAll = () => setOpenClasses(Object.fromEntries(grouped.map((g) => [g.class_name, true])));
  const collapseAll = () => setOpenClasses({});

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const openAdd = (className) => {
    setEditing(null);
    setForm({
      class_name: className || classes[0]?.name || '',
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
        .select('id, overpaid_amount, amount_paid')
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
        // Update existing fee record with the new amount, keeping the status
        // consistent with what the student has already paid this term.
        const existingPaid = Number(existing.amount_paid || 0);
        const newBalance = amount - existingPaid;
        await supabase
          .from('fees')
          .update({
            total_amount: amount,
            payment_status: newBalance <= 0 ? 'paid' : existingPaid > 0 ? 'partial' : 'unpaid',
          })
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      // Legacy behaviour: deleting a class fee structure also removes the
      // per-student fee records for that class/term (receipts/payments kept).
      const { data: students } = await supabase
        .from('applications')
        .select('student_id')
        .eq('school_id', schoolId)
        .eq('class_applying', deleting.class_name);
      if (students && students.length) {
        await supabase
          .from('fees')
          .delete()
          .in('student_id', students.map((s) => s.student_id))
          .eq('academic_year', deleting.academic_year)
          .eq('term', deleting.term);
      }
      const { error } = await supabase.from('class_fees').delete().eq('id', deleting.id);
      if (error) throw new Error(error.message);
      toast.success('Fee structure deleted', `${deleting.class_name} — fee records removed for ${students?.length || 0} student(s).`);
    } catch (err) {
      toast.error('Could not delete fee structure', err.message);
    }
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Fees"
        subtitle="Set class fee structures, apply them to students and manage fee records."
        icon={Wallet}
        actions={
          tab === 'structure' ? (
            <Button onClick={() => openAdd()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add fee structure
            </Button>
          ) : null
        }
      />

      <div className="mb-6 flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
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

      {tab === 'students' ? (
        <StudentFeesTab />
      ) : tab === 'debtors' ? (
        <DebtorsTab />
      ) : tab === 'receipts' ? (
        <ReceiptsTab />
      ) : tab === 'carry' ? (
        <CarryForwardTab />
      ) : loading ? (
        <Spinner label="Loading fee structure..." />
      ) : rows.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              {grouped.length} class{grouped.length === 1 ? '' : 'es'} · {rows.length} term fee{rows.length === 1 ? '' : 's'} configured
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={expandAll}>
                <ChevronsDown className="h-3.5 w-3.5" aria-hidden="true" />
                Expand all
              </Button>
              <Button size="sm" variant="secondary" onClick={collapseAll}>
                <ChevronsUp className="h-3.5 w-3.5" aria-hidden="true" />
                Collapse all
              </Button>
            </div>
          </div>

          {grouped.map((group) => {
            const isOpen = !!openClasses[group.class_name];
            return (
              <Card key={group.class_name} className="overflow-hidden p-0">
                <button
                  type="button"
                  onClick={() => toggleClass(group.class_name)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
                      <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{group.class_name}</p>
                      <p className="text-xs text-slate-400">
                        {group.terms.length} term fee{group.terms.length === 1 ? '' : 's'} · {group.years} academic year{group.years === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {group.latestYearTotal > 0 ? (
                      <Badge tone="amber">
                        {cedi(group.latestYearTotal)} for {group.latestYear}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-slate-400">{isOpen ? 'Click to hide' : 'Click to expand'}</span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 p-3">
                    {group.terms.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-slate-400">{row.academic_year}</span>
                          <span className="text-sm font-semibold text-slate-700">{termLabel(row.term)} Term</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge tone="amber">{cedi(row.fee_amount)}</Badge>
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                            aria-label={`Edit ${row.class_name} ${termLabel(row.term)} Term fee`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(row)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Delete ${row.class_name} ${termLabel(row.term)} Term fee`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => openAdd(group.class_name)}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add term for {group.class_name}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Wallet}
          title="No fee structures yet"
          message="Add the term fee for each class. New students admitted to a class automatically get this fee, and existing students get a fee record when the structure is saved."
          action={<Button onClick={() => openAdd()}>Add fee structure</Button>}
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
          <Select label="Academic year" value={form.academic_year || currentAcademicYear()} onChange={set('academic_year')}>
            {academicYearList(6, [form.academic_year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
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
        message={`This removes the fee for ${deleting?.class_name || 'this class'} together with the fee records for every student in that class/term. Receipts and payment transactions are preserved.`}
      />
    </div>
  );
}