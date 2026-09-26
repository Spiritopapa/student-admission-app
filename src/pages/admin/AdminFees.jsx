import { useEffect, useState } from 'react';
import { Wallet, Plus, Pencil, Trash2 } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { TERMS, currentAcademicYear, TERM_LABELS } from '../../lib/constants';
import { cedi, termLabel } from '../../lib/format';

export default function AdminFees() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
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
        toast.success('Fee structure updated', `${form.class_name} - ${termLabel(form.term)}`);
      } else {
        const { error: insertError } = await supabase.from('class_fees').insert([payload]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Fee structure added', `${form.class_name} - ${termLabel(form.term)}`);
      }
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
    const { error } = await supabase.from('class_fees').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete fee structure', error.message);
    else toast.success('Fee structure deleted', `${deleting.class_name}`);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Fee Structure"
        subtitle="Set the term fee for every class and term."
        icon={Wallet}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add fee structure
          </Button>
        }
      />

      {loading ? (
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
          message="Add the term fee for each class. New students admitted to a class automatically get this fee."
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
    </div>
  );
}