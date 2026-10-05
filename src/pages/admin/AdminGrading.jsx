import { useEffect, useMemo, useState } from 'react';
import { Gauge, Plus, Pencil, Trash2, RotateCcw, Copy, School, ClipboardCheck, RefreshCw, Layers } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Spinner, EmptyState, Badge, Select, StatCard } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import {
  DEFAULT_GRADES,
  GRADE_CLASSES,
  GRADE_OPTIONS,
  sortScaleRows,
  resolveScale,
  groupScaleRows,
  clearGradingScaleCache,
} from '../../lib/gradingScale';

const emptyForm = {
  subject_name: '',
  grade_label: '',
  min_score: '',
  max_score: '100',
  description: '',
  color_class: 'grade-b',
  sort_order: '',
};

// Scope value for the school-wide scale (grading_systems.class_name NULL).
const SCOPE_ALL = '';

export default function AdminGrading() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]); // every grading_systems row for the school
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [scope, setScope] = useState(SCOPE_ALL); // '' = school-wide, else a class name
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, action, label }
  const [busyAction, setBusyAction] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: grades }, { data: classRows }, { data: subjectRows }] = await Promise.all([
        supabase.from('grading_systems').select('*').eq('school_id', schoolId),
        supabase.from('classes').select('name').eq('school_id', schoolId).order('created_at', { ascending: true }),
        supabase.from('subjects').select('name').eq('school_id', schoolId).order('name'),
      ]);
      const allRows = sortScaleRows(grades || []);
      const schoolSubjects = (subjectRows || []).map((s) => s.name);
      const presentSubjects = [...new Set(allRows.map((r) => r.subject_name).filter(Boolean))];
      setRows(allRows);
      setClasses((classRows || []).map((c) => c.name));
      setSubjects([...new Set([...schoolSubjects, ...presentSubjects])].sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      toast.error('Could not load grading systems', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const isClassScope = scope !== SCOPE_ALL;
  // Rows that belong to the currently selected scope (class_name matches or NULL).
  const scopeRows = useMemo(() => rows.filter((r) => String(r.class_name || '') === scope), [rows, scope]);
  const groups = useMemo(() => groupScaleRows(scopeRows), [scopeRows]);
  const effective = useMemo(() => resolveScale(rows, scope), [rows, scope]);

  const classCustomCount = classes.filter((c) => rows.some((r) => String(r.class_name || '') === c)).length;
  const subjectCount = new Set(rows.map((r) => r.subject_name).filter(Boolean)).size;
  const schoolOverallCount = rows.filter((r) => !r.subject_name && !String(r.class_name || '')).length;

  const nextSort = (list) => (list.length ? Math.max(...list.map((r) => Number(r.sort_order) || 0)) + 1 : 1);
const openAdd = (subjectName = '') => {
    setEditing(null);
    setForm({
      ...emptyForm,
      subject_name: subjectName,
      sort_order: String(nextSort(scopeRows.filter((r) => String(r.subject_name || '') === subjectName))),
    });
    setError('');
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      subject_name: row.subject_name || '',
      grade_label: row.grade_label,
      min_score: String(row.min_score),
      max_score: row.max_score != null ? String(row.max_score) : '100',
      description: row.description || '',
      color_class: row.color_class || 'grade-b',
      sort_order: String(row.sort_order != null ? row.sort_order : nextSort(scopeRows)),
    });
    setError('');
    setOpen(true);
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const label = form.grade_label.trim();
    const min = parseFloat(form.min_score);
    const max = form.max_score !== '' ? parseFloat(form.max_score) : 100;
    if (!label) return 'Grade label is required.';
    if (!Number.isFinite(min)) return 'Minimum score is required.';
    if (min < 0 || min > 100 || (Number.isFinite(max) && (max < 0 || max > 100)))
      return 'Scores must be between 0 and 100.';
    if (Number.isFinite(max) && max < min) return 'Maximum score cannot be below the minimum.';
    const subj = form.subject_name.trim() || null;
    const others = scopeRows.filter((r) => r.id !== editing?.id && (r.subject_name || null) === subj);
    const overlapping = others.some((o) => {
      const oMin = Number(o.min_score);
      const oMax = Number(o.max_score ?? 100);
      return min <= oMax && (Number.isFinite(max) ? max >= oMin : 100 >= oMin);
    });
    if (overlapping) return 'This score range overlaps an existing band in the same scope.';
    if (others.some((o) => Number(o.min_score) === min))
      return 'A band with this minimum score already exists in the same scope.';
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    const payload = {
      school_id: schoolId,
      class_name: scope || null,
      subject_name: form.subject_name.trim() || null,
      grade_label: form.grade_label.trim(),
      min_score: parseFloat(form.min_score),
      max_score: form.max_score !== '' ? parseFloat(form.max_score) : 100,
      description: form.description.trim(),
      color_class: form.color_class || 'grade-b',
      sort_order: form.sort_order !== '' ? Math.round(parseFloat(form.sort_order)) : nextSort(scopeRows),
    };
    try {
      if (editing) {
        const { error: up } = await supabase.from('grading_systems').update(payload).eq('id', editing.id);
        if (up) throw new Error(up.message);
        toast.success('Grade updated', `${payload.grade_label} (${payload.subject_name || 'Overall'})`);
      } else {
        const { error: ins } = await supabase.from('grading_systems').insert([payload]);
        if (ins) throw new Error(ins.message);
        toast.success('Grade added', `${payload.grade_label} (${payload.subject_name || 'Overall'})`);
      }
      clearGradingScaleCache();
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
      const { error } = await supabase.from('grading_systems').delete().eq('id', deleting.id);
      if (error) toast.error('Could not delete grade', error.message);
      else toast.success('Grade deleted', deleting.grade_label);
    } finally {
      clearGradingScaleCache();
      setDeleting(null);
      load();
    }
  };
// Replaces the ENTIRE selected scope (overall + subject bands) with default A-F.
  const resetScope = async () => {
    if (!confirm) return;
    setBusyAction(true);
    try {
      let q = supabase.from('grading_systems').delete().eq('school_id', schoolId);
      q = isClassScope ? q.eq('class_name', scope) : q.is('class_name', null);
      const { error: del } = await q;
      if (del) throw new Error(del.message);
      const bands = DEFAULT_GRADES.map((g) => ({
        school_id: schoolId,
        class_name: scope || null,
        subject_name: null,
        grade_label: g.grade_label,
        min_score: g.min_score,
        max_score: g.max_score,
        description: g.description,
        color_class: g.color_class,
        sort_order: g.sort_order,
      }));
      const { error: ins } = await supabase.from('grading_systems').insert(bands);
      if (ins) throw new Error(ins.message);
      toast.success('Grading reset', `Restored the default A–F scale for ${isClassScope ? scope : 'the whole school'}.`);
      clearGradingScaleCache();
      load();
    } catch (err) {
      toast.error('Could not reset grading', err.message);
    } finally {
      setBusyAction(false);
      setConfirm(null);
    }
  };

  // Copies every school-wide row into the selected class (creates the override).
  const copyFromSchool = async () => {
    if (!confirm) return;
    setBusyAction(true);
    try {
      const schoolRows = rows.filter((r) => !String(r.class_name || ''));
      if (!schoolRows.length) throw new Error('There is no school-wide scale to copy yet. Add one first.');
      const { error: del } = await supabase
        .from('grading_systems')
        .delete()
        .eq('school_id', schoolId)
        .eq('class_name', scope);
      if (del) throw new Error(del.message);
      const copies = schoolRows.map((r) => ({
        school_id: schoolId,
        class_name: scope,
        subject_name: r.subject_name || null,
        grade_label: r.grade_label,
        min_score: r.min_score,
        max_score: r.max_score ?? 100,
        description: r.description || '',
        color_class: r.color_class || 'grade-b',
        sort_order: r.sort_order || 0,
      }));
      const { error: ins } = await supabase.from('grading_systems').insert(copies);
      if (ins) throw new Error(ins.message);
      toast.success('Class scale created', `${scope} now has its own copy of the school-wide scale.`);
      clearGradingScaleCache();
      load();
    } catch (err) {
      toast.error('Could not copy scale', err.message);
    } finally {
      setBusyAction(false);
      setConfirm(null);
    }
  };

  // Deletes the class override so the class inherits the school-wide scale.
  const removeOverride = async () => {
    if (!confirm) return;
    setBusyAction(true);
    try {
      const { error } = await supabase
        .from('grading_systems')
        .delete()
        .eq('school_id', schoolId)
        .eq('class_name', scope);
      if (error) throw new Error(error.message);
      toast.success('Override removed', `${scope} now inherits the school-wide scale.`);
      clearGradingScaleCache();
      load();
    } catch (err) {
      toast.error('Could not remove override', err.message);
    } finally {
      setBusyAction(false);
      setConfirm(null);
    }
  };

  if (loading) return <Spinner label="Loading grading systems..." />;

  const scopeLabel = isClassScope ? `Class ${scope}` : 'School-wide (all classes)';
  const sourceBadge = isClassScope
    ? scopeRows.length
      ? { text: 'Custom class scale', tone: 'blue' }
      : effective.source === 'default'
        ? { text: 'Inherits system default', tone: 'slate' }
        : { text: 'Inherits school-wide scale', tone: 'teal' }
    : schoolOverallCount
      ? { text: 'School-wide scale configured', tone: 'teal' }
      : { text: 'Using system default A–F', tone: 'slate' };

  return (
    <div>
      <PageHeader
        title="Grading System"
        subtitle="Configure grade boundaries for the whole school or per class."
        icon={Gauge}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button onClick={() => openAdd('')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add grade
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={School} tone="blue" label="Classes" value={classes.length} sub={`${classCustomCount} with own scale`} />
        <StatCard icon={Layers} tone="green" label="Class custom scales" value={classCustomCount} sub="Override school-wide" />
        <StatCard icon={ClipboardCheck} tone="amber" label="Subjects scaled" value={subjectCount} sub="Per-subject bands" />
        <StatCard icon={Gauge} tone="teal" label="School-wide bands" value={schoolOverallCount} sub="Overall A–F default" />
      </div>
{/* Scope manager */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${GRADE_CLASSES[effective.rows[0]?.color_class || 'grade-b']}`}>
              <Gauge className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                Editing: {scopeLabel}
                <Badge tone={sourceBadge.tone}>{sourceBadge.text}</Badge>
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                {isClassScope
                  ? scopeRows.length
                    ? 'This class has its own grading scale. Adjust the bands below.'
                    : `No custom bands yet — ${scope} inherits the scale shown. Create a class-specific scale to make changes.`
                  : 'Bands that apply to every class unless a class defines its own scale.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="" value={scope} onChange={(e) => setScope(e.target.value)} className="w-64">
              <option value={SCOPE_ALL}>School-wide (all classes)</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {rows.some((r) => String(r.class_name || '') === c) ? ' · custom' : ''}
                </option>
              ))}
            </Select>
            {isClassScope && scopeRows.length ? (
              <Button variant="secondary" onClick={() => setConfirm({ title: 'Remove class override?', message: `${scope} will go back to inheriting the school-wide scale. All of its own bands will be deleted.`, label: 'Remove override', action: removeOverride })} loading={busyAction}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove override
              </Button>
            ) : null}
            {isClassScope && !scopeRows.length ? (
              <Button onClick={() => setConfirm({ title: 'Create class-specific scale?', message: `This copies the current school-wide scale into ${scope} as its own editable scale. You can then customise the bands without affecting other classes.`, label: 'Copy school-wide scale', action: copyFromSchool })} loading={busyAction}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy school-wide scale
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => setConfirm({ title: 'Reset this scale to defaults?', message: `All bands configured for ${scopeLabel} (including subject-specific ones) will be replaced with the default A–F scale.`, label: 'Reset to default A–F', action: resetScope })} loading={busyAction}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to defaults
            </Button>
          </div>
        </div>

        {!scopeRows.length ? (
          <EmptyState
            icon={Gauge}
            title={isClassScope ? 'This class inherits a scale' : 'No bands configured yet'}
            message={
              isClassScope
                ? 'Tap “Copy school-wide scale” to give this class its own editable copy, or edit the scale for the whole school above.'
                : 'Add overall grade bands, or press “Reset to defaults” to install the standard A–F scale.'
            }
            className="mt-4"
          />
        ) : (
          <div className="mt-4 space-y-4">
            <BandList
              title="Overall grading (all subjects)"
              subtitle="Applied when a subject has no specific bands"
              rows={groups.overall}
              inherited={!isClassScope && effective.source === 'default'}
              onAdd={() => openAdd('')}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
            {Object.keys(groups.bySubject).map((sub) => (
              <BandList
                key={sub}
                title={`${sub} · subject specific`}
                subtitle={`Only ${sub} uses these bands`}
                rows={groups.bySubject[sub]}
                onAdd={() => openAdd(sub)}
                onEdit={openEdit}
                onDelete={setDeleting}
              />
            ))}
          </div>
        )}
      </Card>
{/* How grading resolves per class */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <ClipboardCheck className="h-4 w-4 text-brand-500" aria-hidden="true" />
            How grading resolves per class
          </h3>
          <span className="text-xs text-slate-400">A class scale always wins over the school-wide scale.</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Scope</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Overall bands</th>
                <th className="py-2">Subject-specific</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[{ name: 'School-wide', scopeVal: SCOPE_ALL }, ...classes.map((c) => ({ name: c, scopeVal: c }))].map(({ name, scopeVal }) => {
                const own = rows.filter((r) => String(r.class_name || '') === scopeVal);
                const eff = resolveScale(rows, scopeVal);
                const src = own.length
                  ? { text: 'Own class scale', tone: 'blue' }
                  : eff.source === 'school'
                    ? { text: 'School-wide scale', tone: 'teal' }
                    : { text: 'System default', tone: 'slate' };
                const overall = eff.rows.filter((r) => !String(r.subject_name || '')).length;
                const subs = [...new Set(eff.rows.map((r) => r.subject_name).filter(Boolean))];
                return (
                  <tr key={name}>
                    <td className="py-2 pr-3 font-semibold text-slate-800">{name}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={src.tone}>{src.text}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{overall} band{overall === 1 ? '' : 's'}</td>
                    <td className="py-2 text-slate-500">{subs.length ? subs.join(', ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit grade band' : `Add a grade band · ${scopeLabel}`}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Add band'}
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
          <Select label="Subject (blank = overall)" value={form.subject_name} onChange={set('subject_name')}>
            <option value="">— Overall —</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input label="Grade label *" value={form.grade_label} onChange={set('grade_label')} placeholder="e.g. A" />
          <Input label="Minimum score (%) *" type="number" min="0" max="100" step="0.01" value={form.min_score} onChange={set('min_score')} />
          <Input label="Maximum score (%)" type="number" min="0" max="100" step="0.01" value={form.max_score} onChange={set('max_score')} />
          <Input label="Description" value={form.description} onChange={set('description')} placeholder="e.g. Advance" />
          <Select label="Colour" value={form.color_class} onChange={set('color_class')}>
            {GRADE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt.replace('grade-', '').toUpperCase()}
              </option>
            ))}
          </Select>
          <Input label="Sort order" type="number" value={form.sort_order} onChange={set('sort_order')} placeholder="1 = highest" />
        </div>
      </Modal>
<ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete grade band?"
        message={`This removes ${deleting?.grade_label || 'the band'} from ${scopeLabel}. Existing results keep their recorded grades.`}
      />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={confirm?.action}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.label}
        loading={busyAction}
      />
    </div>
  );
}

// Editable table of grade bands for one group (overall or a subject).
function BandList({ title, subtitle, rows = [], inherited = false, onAdd, onEdit, onDelete }) {
  return (
    <div className="rounded-xl border border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
        <div>
          <p className="text-sm font-bold text-slate-700">{title}</p>
          <p className="text-xs text-slate-400">{inherited ? 'Inherited system default · add bands to customise' : subtitle}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add band
        </Button>
      </div>
      {rows.length ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2">Grade</th>
              <th className="px-2 py-2">Range</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2 text-center">Sort</th>
              <th className="px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2">
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-extrabold ${GRADE_CLASSES[row.color_class] || 'bg-brand-50 text-brand-700'}`}>
                    {row.grade_label}
                  </span>
                </td>
                <td className="px-2 py-2 font-semibold text-slate-700">
                  {row.min_score} – {row.max_score ?? 100}
                </td>
                <td className="px-2 py-2 text-slate-500">{row.description || '—'}</td>
                <td className="px-2 py-2 text-center text-slate-500">{row.sort_order ?? '—'}</td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onEdit(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label={`Edit ${row.grade_label}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onDelete(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${row.grade_label}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-4 text-sm text-slate-400">No bands in this group yet.</p>
      )}
    </div>
  );
}