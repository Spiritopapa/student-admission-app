import { useEffect, useState } from 'react';
import { MoveRight, FilePlus2 } from 'lucide-react';
import { useSchoolId } from '../../../hooks/useSchool';
import { useToast } from '../../../context/ToastContext';
import { Card, Button, Input, Select, Spinner, EmptyState } from '../../../components/ui';
import { supabase } from '../../../lib/supabase';
import { termLabel } from '../../../lib/format';
import { TERMS, currentAcademicYear } from '../../../lib/constants';

export default function CarryForwardTab() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Carry forward form
  const [cf, setCf] = useState({ className: '', fromYear: currentAcademicYear(), fromTerm: 'First', toYear: currentAcademicYear(), toTerm: 'First', amount: '' });
  const [cfBusy, setCfBusy] = useState(false);
  const [cfMsg, setCfMsg] = useState('');

  // Generate fee records form
  const [gen, setGen] = useState({ className: '', term: 'First' });
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  useEffect(() => {
    if (!schoolId) return;
    supabase
      .from('classes')
      .select('id, name')
      .eq('school_id', schoolId)
      .order('name')
      .then(({ data }) => {
        setClasses(data || []);
        setLoading(false);
      });
  }, [schoolId]);

  const setCfField = (key) => (e) => setCf((f) => ({ ...f, [key]: e.target.value }));
  const setGenField = (key) => (e) => setGen((f) => ({ ...f, [key]: e.target.value }));

  const runCarryForward = async () => {
    setCfMsg('');
    if (!cf.className || !cf.fromYear || !cf.fromTerm || !cf.toYear || !cf.toTerm) {
      setCfMsg('Please fill all fields.');
      return;
    }
    setCfBusy(true);
    let success = 0;
    let errors = 0;
    try {
      const { data: students } = await supabase.from('applications').select('student_id').eq('school_id', schoolId).eq('class_applying', cf.className);
      if (!students || !students.length) {
        setCfMsg('No students found in this class.');
        return;
      }
      for (const student of students) {
        try {
          const { data, error } = await supabase.rpc('promote_student_fees', {
            p_student_id: student.student_id,
            p_current_academic_year: cf.fromYear,
            p_current_term: cf.fromTerm,
            p_new_class_name: cf.className,
            p_new_academic_year: cf.toYear,
            p_new_term: cf.toTerm,
            p_new_fee_amount: Number(cf.amount || 0),
          });
          if (error || !data?.success) errors += 1;
          else success += 1;
        } catch (err) {
          errors += 1;
        }
      }
      setCfMsg(`Carry forward complete! Processed: ${students.length} · Success: ${success} · Errors: ${errors}`);
      toast.success('Carry forward complete', `${success} of ${students.length} students processed.`);
    } catch (err) {
      setCfMsg('Error: ' + err.message);
    } finally {
      setCfBusy(false);
    }
  };

  const runGenerate = async () => {
    setGenMsg('');
    if (!gen.className) {
      setGenMsg('Please select a class.');
      return;
    }
    setGenBusy(true);
    let created = 0;
    let skipped = 0;
    try {
      const { data: classFee } = await supabase
        .from('class_fees')
        .select('fee_amount, academic_year')
        .eq('class_name', gen.className)
        .eq('term', gen.term)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!classFee) {
        setGenMsg('No fee structure found for this class/term. Set the class fee structure first.');
        return;
      }
      const year = classFee.academic_year;
      const feeAmount = Number(classFee.fee_amount || 0);
      const { data: students } = await supabase.from('applications').select('student_id').eq('school_id', schoolId).eq('class_applying', gen.className);
      if (!students || !students.length) {
        setGenMsg('No students found in this class.');
        return;
      }
      for (const student of students) {
        const { data: existing } = await supabase
          .from('fees')
          .select('id, total_amount, amount_paid, debt, payment_status')
          .eq('student_id', student.student_id)
          .eq('academic_year', year)
          .eq('term', gen.term)
          .maybeSingle();
        if (existing) {
          const outstanding = Number(existing.total_amount) + Number(existing.debt || 0) - Number(existing.amount_paid);
          if (outstanding > 0 && existing.payment_status === 'paid') {
            await supabase.from('fees').update({ payment_status: 'unpaid' }).eq('id', existing.id);
          }
          skipped += 1;
          continue;
        }
        const { error } = await supabase.from('fees').insert({
          student_id: student.student_id,
          academic_year: year,
          term: gen.term,
          total_amount: feeAmount,
          amount_paid: 0,
          debt: 0,
          payment_status: feeAmount > 0 ? 'unpaid' : 'paid',
          school_id: schoolId,
        });
        if (!error) created += 1;
      }
      setGenMsg(`Complete! Created: ${created} · Skipped (already exist): ${skipped}`);
      toast.success('Fee records generated', `${created} created · ${skipped} skipped.`);
    } catch (err) {
      setGenMsg('Error: ' + err.message);
    } finally {
      setGenBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading classes..." />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <MoveRight className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-800">Bulk carry forward</h2>
            <p className="text-sm text-slate-500">Carry unpaid balances from one term to the next for every student in a class.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Select label="Class *" value={cf.className} onChange={setCfField('className')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input label="From year" value={cf.fromYear} onChange={setCfField('fromYear')} />
            <Select label="From term" value={cf.fromTerm} onChange={setCfField('fromTerm')}>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="To year" value={cf.toYear} onChange={setCfField('toYear')} />
            <Select label="To term" value={cf.toTerm} onChange={setCfField('toTerm')}>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <Input label="New fee amount (GHC)" type="number" min="0" step="0.01" value={cf.amount} onChange={setCfField('amount')} />
        </div>
        {cfMsg ? <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{cfMsg}</p> : null}
        <Button onClick={runCarryForward} loading={cfBusy} className="mt-5">
          <MoveRight className="h-4 w-4" aria-hidden="true" />
          Carry forward {cf.className ? `(${termLabel(cf.fromTerm)} → ${termLabel(cf.toTerm)})` : ''}
        </Button>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <FilePlus2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-800">Generate fee records</h2>
            <p className="text-sm text-slate-500">Create the per-student fee records for a class and term from the fee structure (existing records are preserved).</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Select label="Class *" value={gen.className} onChange={setGenField('className')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Term" value={gen.term} onChange={setGenField('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </Select>
        </div>
        {genMsg ? <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{genMsg}</p> : null}
        <Button onClick={runGenerate} loading={genBusy} className="mt-5">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Generate records
        </Button>
      </Card>

      {!classes.length ? (
        <div className="lg:col-span-2">
          <EmptyState title="No classes yet" message="Add classes before managing fees." />
        </div>
      ) : null}
    </div>
  );
}