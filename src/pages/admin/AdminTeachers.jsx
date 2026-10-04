import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UserRound, Plus, Trash2, BadgeCheck, Activity, Eye, Pencil, KeyRound,
  Unlink, Download, Upload, Printer, RefreshCw,
} from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput, Switch } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import ActivityLogModal from '../../components/ActivityLogModal';
import { supabase } from '../../lib/supabase';
import { buildCSV, parseCSV, downloadCSV } from '../../lib/csv';
import { formatDate } from '../../lib/format';
import { openPrintWindow, escapeHtml } from '../../lib/print';

const TEACHER_CSV_HEADERS = ['Registration ID', 'Full Name *', 'Email', 'Phone', 'Staff Type', 'Class(es)', 'Subject(s)', 'Qualification'];
const esc = escapeHtml;

function emptyForm() {
  return {
    registration_id: '',
    full_name: '',
    email: '',
    phone: '',
    qualification: '',
    date_joined: new Date().toISOString().split('T')[0],
    staff_type: 'teaching',
    is_transport_collector: false,
    classes: [], // selected class names
    subjectsByClass: {}, // { class_name: [subject, ...] }
  };
}

export default function AdminTeachers() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [assignMap, setAssignMap] = useState({}); // teacher_id -> [{ class_name, subject_name }]
  const [classes, setClasses] = useState([]); // [{ id, name }]
  const [classSubjectMap, setClassSubjectMap] = useState({}); // class_name -> [subject, ...]
  const [subjects, setSubjects] = useState([]); // global subject names
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [open, setOpen] = useState(false); // add / edit modal
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activityTarget, setActivityTarget] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const importInputRef = useRef(null);
  const [importing, setImporting] = useState(false);

  const load = () => {
    if (!schoolId) return;
    setLoading(true);
    Promise.all([
      supabase.from('teachers').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
      supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      supabase.from('subjects').select('name').eq('school_id', schoolId),
      supabase.from('class_subjects').select('class_name, subject_name').eq('school_id', schoolId),
      supabase.from('teacher_classes_subjects').select('teacher_id, class_name, subject_name').eq('school_id', schoolId),
    ])
      .then(([{ data }, { data: classRows }, { data: subjectRows }, { data: csRows }, { data: assignRows }]) => {
        setRows(data || []);
        setClasses(classRows || []);
        setSubjects([...new Set((subjectRows || []).map((s) => s.name).filter(Boolean))].sort());
        const csMap = {};
        (csRows || []).forEach((r) => {
          if (!r.class_name || !r.subject_name) return;
          if (!csMap[r.class_name]) csMap[r.class_name] = [];
          if (!csMap[r.class_name].includes(r.subject_name)) csMap[r.class_name].push(r.subject_name);
        });
        setClassSubjectMap(csMap);
        const amap = {};
        (assignRows || []).forEach((a) => {
          if (!a.teacher_id) return;
          if (!amap[a.teacher_id]) amap[a.teacher_id] = [];
          amap[a.teacher_id].push(a);
        });
        setAssignMap(amap);
        setLoading(false);
      })
      .catch((err) => {
        toast.error('Could not load teachers', err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);
const stats = useMemo(() => {
    const teaching = rows.filter((t) => t.staff_type !== 'non_teaching').length;
    return {
      total: rows.length,
      teaching,
      nonTeaching: rows.length - teaching,
      approved: rows.filter((t) => t.is_approved).length,
      registered: rows.filter((t) => t.user_id).length,
    };
  }, [rows]);

  const allClasses = useMemo(() => {
    const set = new Set(classes.map((c) => c.name));
    rows.forEach((t) =>
      String(t.class_taught || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .forEach((c) => set.add(c))
    );
    Object.values(assignMap).flat().forEach((a) => {
      if (a.class_name) set.add(a.class_name);
    });
    return [...set].sort();
  }, [classes, rows, assignMap]);

  const teacherClassesOf = (t) => {
    const names = (assignMap[t.id] || []).map((a) => a.class_name).filter(Boolean);
    if (names.length) return [...new Set(names)];
    return String(t.class_taught || '').split(',').map((c) => c.trim()).filter(Boolean);
  };
  const teacherSubjectsOf = (t) => {
    const subs = (assignMap[t.id] || []).map((a) => a.subject_name).filter(Boolean);
    if (subs.length) return [...new Set(subs)];
    return String(t.subject || '').split(',').map((s) => s.trim()).filter(Boolean);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((t) => {
      if (q && ![t.full_name, t.registration_id, t.email, t.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (classFilter) {
        const inCsv = String(t.class_taught || '').split(',').map((c) => c.trim()).includes(classFilter);
        const inJunction = (assignMap[t.id] || []).some((a) => a.class_name === classFilter);
        if (!inCsv && !inJunction) return false;
      }
      if (typeFilter === 'teaching' && t.staff_type === 'non_teaching') return false;
      if (typeFilter === 'non_teaching' && t.staff_type !== 'non_teaching') return false;
      if (statusFilter === 'approved' && !t.is_approved) return false;
      if (statusFilter === 'pending' && t.is_approved) return false;
      if (statusFilter === 'registered' && !t.user_id) return false;
      return true;
    });
  }, [rows, query, classFilter, typeFilter, statusFilter, assignMap]);

  const subjectsFor = (className) => {
    const canonical = classSubjectMap[className];
    return canonical && canonical.length ? canonical : subjects;
  };
/* ----------------------------- form ----------------------------- */
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value }));

  const toggleFormClass = (name) => {
    setForm((f) => {
      const classes = f.classes.includes(name) ? f.classes.filter((c) => c !== name) : [...f.classes, name];
      const subjectsByClass = { ...f.subjectsByClass };
      if (!classes.includes(name)) delete subjectsByClass[name];
      else if (!subjectsByClass[name]) subjectsByClass[name] = [];
      return { ...f, classes, subjectsByClass };
    });
  };

  const toggleFormSubject = (className, subject) => {
    setForm((f) => {
      const cur = f.subjectsByClass[className] || [];
      const next = cur.includes(subject) ? cur.filter((s) => s !== subject) : [...cur, subject];
      return { ...f, subjectsByClass: { ...f.subjectsByClass, [className]: next } };
    });
  };

  const saveAssignments = async (teacherId, subjectsByClass) => {
    await supabase.from('teacher_classes_subjects').delete().eq('teacher_id', teacherId);
    const rowsToInsert = [];
    Object.entries(subjectsByClass || {}).forEach(([className, subs]) => {
      (subs || []).forEach((sub) => {
        if (sub) rowsToInsert.push({ teacher_id: teacherId, class_name: className, subject_name: sub, school_id: schoolId });
      });
    });
    if (rowsToInsert.length) {
      const { error } = await supabase.from('teacher_classes_subjects').insert(rowsToInsert);
      if (error) console.warn('Assignment warning:', error.message);
    }
  };

  const save = async () => {
    setError('');
    const fullName = form.full_name.trim();
    if (!fullName) {
      setError('Full name is required.');
      return;
    }
    const isTeaching = form.staff_type !== 'non_teaching';
    const classList = isTeaching ? (form.classes || []) : [];
    const subjectList = [...new Set(Object.values(form.subjectsByClass || {}).flat())];
    setBusy(true);
    try {
      let teacherId = editing?.id;
      let regId = form.registration_id || null;
      const base = {
        full_name: fullName,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        qualification: form.qualification.trim() || null,
        date_joined: form.date_joined || null,
        staff_type: form.staff_type,
        is_transport_collector: !!form.is_transport_collector,
        class_taught: classList.length ? classList.join(', ') : null,
        subject: subjectList.length ? subjectList.join(', ') : null,
      };
      if (editing) {
        const { error: upErr } = await supabase.from('teachers').update(base).eq('id', teacherId);
        if (upErr) throw new Error(upErr.message);
      } else {
        if (!regId) {
          const { data: rid, error: idErr } = await supabase.rpc('generate_teacher_id', { p_school_id: schoolId });
          if (idErr || !rid) throw new Error('Could not generate a Teacher ID.');
          regId = rid;
        }
        const { data: ins, error: insErr } = await supabase
          .from('teachers')
          .insert([{ ...base, registration_id: regId, school_id: schoolId, is_active: true, is_approved: false }])
          .select();
        if (insErr) throw new Error(insErr.message);
        teacherId = ins?.[0]?.id;
        if (!teacherId) throw new Error('Teacher record was not created.');
      }
      await saveAssignments(teacherId, form.subjectsByClass);
      toast.success(editing ? 'Teacher updated' : 'Teacher added', `${fullName}${editing ? '' : ` (${regId})`}.`);
      setOpen(false);
      setEditing(null);
      setForm(emptyForm());
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
const openAdd = async () => {
    setError('');
    setEditing(null);
    setForm(emptyForm());
    try {
      const { data: regId } = await supabase.rpc('generate_teacher_id', { p_school_id: schoolId });
      if (regId) setForm((f) => ({ ...f, registration_id: regId }));
    } catch (err) {
      // best effort — ID is generated on save if missing
    }
    setOpen(true);
  };

  const openEdit = (teacher) => {
    setError('');
    const byClass = {};
    const asign = assignMap[teacher.id] || [];
    asign.forEach((a) => {
      if (!a.class_name) return;
      if (!byClass[a.class_name]) byClass[a.class_name] = [];
      if (a.subject_name && !byClass[a.class_name].includes(a.subject_name)) byClass[a.class_name].push(a.subject_name);
    });
    const legacyClasses = String(teacher.class_taught || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!asign.length && legacyClasses.length) {
      const legacySubjects = String(teacher.subject || '').split(',').map((s) => s.trim()).filter(Boolean);
      legacyClasses.forEach((c) => {
        byClass[c] = legacySubjects.slice();
      });
    }
    setForm({
      registration_id: teacher.registration_id || '',
      full_name: teacher.full_name || '',
      email: teacher.email || '',
      phone: teacher.phone || '',
      qualification: teacher.qualification || '',
      date_joined: String(teacher.date_joined || '').slice(0, 10),
      staff_type: teacher.staff_type === 'non_teaching' ? 'non_teaching' : 'teaching',
      is_transport_collector: !!teacher.is_transport_collector,
      classes: Object.keys(byClass),
      subjectsByClass: byClass,
    });
    setEditing(teacher);
    setOpen(true);
  };

  const toggleApproval = async (teacher, approved) => {
    const { error } = await supabase.from('teachers').update({ is_approved: approved }).eq('id', teacher.id);
    if (error) toast.error('Could not update approval', error.message);
    else {
      toast.success(approved ? 'Teacher approved' : 'Approval removed', teacher.full_name);
      load();
    }
  };

  const toggleCollector = async (teacher, value) => {
    const { error } = await supabase.from('teachers').update({ is_transport_collector: value }).eq('id', teacher.id);
    if (error) toast.error('Could not update flag', error.message);
    else {
      toast.success('Transport collector flag updated', teacher.full_name);
      load();
    }
  };

  const resetPassword = async () => {
    if (!passwordTarget || password.length < 6) {
      if (passwordTarget) setError('Password must be at least 6 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await supabase.rpc('reset_teacher_password', {
        p_teacher_id: passwordTarget.id,
        p_new_password: password,
      });
      if (error) throw new Error(error.message);
      toast.success('Password reset', `New password set for ${passwordTarget.full_name}.`);
      setPasswordTarget(null);
      setPassword('');
    } catch (err) {
      toast.error('Could not reset password', err.message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const unlink = async (teacher) => {
    if (!teacher.user_id) {
      toast.info('Not registered yet', `${teacher.full_name} has not registered for the portal.`);
      return;
    }
    const { error } = await supabase.from('teachers').update({ user_id: null }).eq('id', teacher.id);
    if (error) toast.error('Could not unlink account', error.message);
    else {
      toast.success('Account unlinked', `${teacher.full_name} can register again.`);
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc('delete_teacher_completely', { p_teacher_id: deleting.id });
    if (error) toast.error('Could not delete teacher', error.message);
    else toast.success('Teacher deleted', deleting.full_name);
    setDeleteBusy(false);
    setDeleting(null);
    load();
  };
const subjectsOfClassFor = (t, className) => {
    const rows = (assignMap[t.id] || []).filter((a) => a.class_name === className);
    if (rows.length) return [...new Set(rows.map((a) => a.subject_name).filter(Boolean))];
    return teacherSubjectsOf(t);
  };

  const printTeacher = (t) => {
    const clases = teacherClassesOf(t);
    const rowsHtml = clases.length
      ? clases
          .map((c) => `<tr><td>${esc(c)}</td><td>${esc(subjectsOfClassFor(t, c).join(', ') || '—')}</td></tr>`)
          .join('')
      : '<tr><td colspan="2">None assigned.</td></tr>';
    openPrintWindow(`Teacher Profile — ${t.full_name}`, `
      <h1>Teacher Profile</h1>
      <p><b>${esc(t.full_name)}</b> (${esc(t.registration_id || '—')})</p>
      <p>Staff type: ${t.staff_type === 'non_teaching' ? 'Non-Teaching' : 'Teaching'} · ${t.is_active === false ? 'Inactive' : 'Active'}</p>
      <p>Email: ${esc(t.email || '—')} · Phone: ${esc(t.phone || '—')}</p>
      <p>Qualification: ${esc(t.qualification || '—')} · Joined: ${t.date_joined ? formatDate(t.date_joined) : '—'}</p>
      <h2>Classes &amp; Subjects</h2>
      <table>
        <thead><tr><th>Class</th><th>Subjects</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `);
  };

  const exportCsv = () => {
    if (!filtered.length) {
      toast.error('No teachers to export', 'Try adjusting the filters.');
      return;
    }
    const body = filtered.map((t) => [
      t.registration_id || '', t.full_name || '', t.email || '', t.phone || '',
      t.staff_type === 'non_teaching' ? 'Non-Teaching' : 'Teaching',
      (t.class_taught || '').replace(/, /g, ';'),
      (t.subject || '').replace(/, /g, ';'),
      t.qualification || '',
    ]);
    downloadCSV(`teachers_${new Date().toISOString().slice(0, 10)}.csv`, buildCSV([TEACHER_CSV_HEADERS, ...body]));
    toast.success('CSV exported', `${filtered.length} teacher(s) exported.`);
  };

  const downloadTemplate = () => {
    const example = ['', 'Kwame Mensah', 'kwame@school.org', '0551234567', 'Teaching', 'JHS 1;JHS 2', 'Mathematics;Science', 'B.Ed'];
    downloadCSV('teacher_import_template.csv', buildCSV([TEACHER_CSV_HEADERS, example]));
    toast.success('Template downloaded', 'Fill in the rows (keep the header) and use Import CSV.');
  };

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCSV(text).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
      if (parsed.length < 2) throw new Error('The file must have a header row and at least one data row.');
      const header = parsed[0].map((h) => String(h ?? '').replace('\uFEFF', '').trim().toLowerCase().replace(/\s+/g, ' '));
      const col = (aliases) => (r) => {
        const names = aliases.map((n) => n.toLowerCase().replace(/\s+/g, ' '));
        const idx = header.findIndex((h) => names.includes(h) || names.some((n) => h.includes(n)));
        return idx >= 0 ? String(r[idx] ?? '').trim() : '';
      };
      const getName = col(['full name', 'name', 'teacher name']);
      const getEmail = col(['email']);
      const getPhone = col(['phone', 'mobile']);
      const getType = col(['staff type', 'type', 'staff']);
      const getClasses = col(['classes', 'class(es)', 'class taught', 'class']);
      const getSubjects = col(['subjects', 'subject(s)', 'subject']);
      const getQualification = col(['qualification', 'quals']);
      let created = 0;
      let skipped = 0;
      for (const r of parsed.slice(1)) {
        const fn = getName(r);
        if (!fn) {
          skipped += 1;
          continue;
        }
        const isTeaching = !['non_teaching', 'non teaching', 'non-teaching', 'no'].includes(getType(r).toLowerCase());
        const classList = getClasses(r).split(/[;,]/).map((c) => c.trim()).filter(Boolean);
        const subjectList = getSubjects(r).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        const { data: regId, error: idErr } = await supabase.rpc('generate_teacher_id', { p_school_id: schoolId });
        if (idErr || !regId) {
          skipped += 1;
          continue;
        }
        const { data: inserted, error: insErr } = await supabase
          .from('teachers')
          .insert([{
            registration_id: regId,
            full_name: fn,
            email: getEmail(r) || null,
            phone: getPhone(r) || null,
            qualification: getQualification(r) || null,
            staff_type: isTeaching ? 'teaching' : 'non_teaching',
            is_transport_collector: false,
            class_taught: isTeaching && classList.length ? classList.join(', ') : null,
            subject: isTeaching && subjectList.length ? subjectList.join(', ') : null,
            school_id: schoolId,
            is_active: true,
            is_approved: false,
          }])
          .select();
        if (insErr) {
          skipped += 1;
          continue;
        }
        const teacherId = inserted?.[0]?.id;
        if (teacherId && isTeaching && classList.length) {
          const assignmentRows = [];
          classList.forEach((cls) => {
            (subjectList.length ? subjectList : subjectsFor(cls)).forEach((sub) => {
              if (sub) assignmentRows.push({ teacher_id: teacherId, class_name: cls, subject_name: sub, school_id: schoolId });
            });
          });
          if (assignmentRows.length) await supabase.from('teacher_classes_subjects').insert(assignmentRows);
        }
        created += 1;
      }
      toast.success('CSV import complete', `${created} teacher(s) created${skipped ? `, ${skipped} skipped` : ''}.`);
      load();
    } catch (err) {
      toast.error('CSV import failed', err.message);
    } finally {
      setImporting(false);
    }
  };
return (
    <div>
      <PageHeader
        title="Staff & Teachers"
        subtitle="Teaching and non-teaching staff — class & subject assignments, portal access and audit trail."
        icon={UserRound}
        actions={
          <>
            <Button variant="secondary" onClick={downloadTemplate}>
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV template
            </Button>
            <Button variant="secondary" onClick={() => importInputRef.current?.click()} loading={importing}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import CSV
            </Button>
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </Button>
            <Button onClick={() => { setError(''); openAdd(); }}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add teacher
            </Button>
          </>
        }
      />
      <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total staff', value: stats.total, tone: 'blue' },
          { label: 'Teaching', value: stats.teaching, tone: 'teal' },
          { label: 'Non-teaching', value: stats.nonTeaching, tone: 'slate' },
          { label: 'Approved', value: stats.approved, tone: 'green' },
          { label: 'Registered', value: stats.registered, tone: 'amber' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
            <p className="text-[11px] text-slate-400">{s.label}</p>
            <p className="text-base font-bold text-slate-800">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, ID, email or phone..." className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="w-40">
            <option value="">All classes</option>
            {allClasses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40">
            <option value="">All staff</option>
            <option value="teaching">Teaching</option>
            <option value="non_teaching">Non-teaching</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="registered">Registered</option>
          </Select>
        </div>
      </div>
{loading ? (
        <Spinner label="Loading staff..." />
      ) : filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((teacher) => (
            <Card key={teacher.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blend-soft text-white">
                  <UserRound className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{teacher.full_name}</p>
                  <p className="font-mono text-xs text-slate-400">{teacher.registration_id || '—'} · joined {formatDate(teacher.date_joined || teacher.created_at)}</p>
                </div>
                <button type="button" onClick={() => setDeleting(teacher)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete teacher">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={teacher.staff_type === 'non_teaching' ? 'slate' : 'teal'}>
                  {teacher.staff_type === 'non_teaching' ? 'Non-Teaching' : 'Teaching'}
                </Badge>
                {teacher.user_id ? <Badge tone="blue">Registered</Badge> : <Badge tone="slate">Not registered</Badge>}
                {teacher.is_approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Pending approval</Badge>}
                {teacher.is_transport_collector ? <Badge tone="blue">Transport collector</Badge> : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {teacherClassesOf(teacher).map((c) => (
                  <Badge key={c} tone="slate">{c}</Badge>
                ))}
              </div>

              <div className="mt-2 space-y-1 text-xs text-slate-500">
                {teacher.email ? <p>Email: {teacher.email}</p> : null}
                {teacher.phone ? <p>Phone: {teacher.phone}</p> : null}
                {teacher.qualification ? <p>Qualification: {teacher.qualification}</p> : null}
                {(() => {
                  const subs = teacherSubjectsOf(teacher);
                  return subs.length ? <p>Subjects: {subs.join(', ')}</p> : null;
                })()}
              </div>

              <div className="mt-4 space-y-2.5 border-t border-slate-50 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Portal access</span>
                  <Switch checked={!!teacher.is_approved} onChange={(v) => toggleApproval(teacher, v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                    <BadgeCheck className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                    Transport collector
                  </span>
                  <Switch checked={!!teacher.is_transport_collector} onChange={(v) => toggleCollector(teacher, v)} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setViewing(teacher)}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  View
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openEdit(teacher)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setError(''); setPassword(''); setPasswordTarget(teacher); }}>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  Password
                </Button>
                <Button size="sm" variant="ghost" onClick={() => unlink(teacher)}>
                  <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                  Unlink
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setActivityTarget(teacher)}>
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  Activity
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : rows.length ? (
        <EmptyState
          icon={UserRound}
          title="No staff match"
          message="Try adjusting the search or filters."
          action={
            <Button variant="secondary" onClick={() => { setQuery(''); setClassFilter(''); setTypeFilter(''); setStatusFilter(''); }}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={UserRound}
          title="No staff yet"
          message="Add teachers so they can register for the portal, or import them from a CSV file."
          action={<Button onClick={() => { setError(''); openAdd(); }}>Add teacher</Button>}
        />
      )}
<Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit teacher: ${editing.full_name}` : 'Add a teacher'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Create teacher'}
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
          <Input label="Full name *" value={form.full_name} onChange={set('full_name')} />
          <Input label="Registration ID" value={form.registration_id} onChange={set('registration_id')} disabled={!!editing} hint="Auto-generated — change only if needed." />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
          <Input label="Phone" type="tel" value={form.phone} onChange={setPhone} />
          <Input label="Qualification" value={form.qualification} onChange={set('qualification')} />
          <Input label="Date joined" type="date" value={form.date_joined} onChange={set('date_joined')} />
          <Select label="Staff type" value={form.staff_type} onChange={set('staff_type')}>
            <option value="teaching">Teaching</option>
            <option value="non_teaching">Non-teaching</option>
          </Select>
          <div className="flex items-end">
            <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              <input type="checkbox" checked={form.is_transport_collector} onChange={(e) => setForm((f) => ({ ...f, is_transport_collector: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
              Transport collector
            </label>
          </div>
        </div>

        {form.staff_type === 'non_teaching' ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Non-teaching staff have no class or subject assignments.
          </p>
        ) : (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="mb-1.5 text-sm font-medium text-slate-600">
              Classes taught <span className="font-normal text-slate-400">(tap classes, then pick subjects for each)</span>
            </p>
            {classes.length ? (
              <div className="flex flex-wrap gap-1.5">
                {classes.map((c) => {
                  const active = form.classes.includes(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleFormClass(c.name)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No classes configured yet — add classes under the Classes page first.</p>
            )}
            {form.classes.map((cls) => {
              const pool = subjectsFor(cls);
              const chosen = form.subjectsByClass[cls] || [];
              return (
                <div key={cls} className="mt-2.5 rounded-xl border border-slate-100 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-600">Subjects — {cls}</p>
                  {pool.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {pool.map((sub) => {
                        const on = chosen.includes(sub);
                        return (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => toggleFormSubject(cls, sub)}
                            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                          >
                            {sub}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400">No subjects configured for this class yet.</p>
                  )}
                </div>
              );
            })}
            {form.classes.length === 0 ? <p className="mt-2 text-xs text-slate-400">No classes selected.</p> : null}
          </div>
        )}
      </Modal>
<Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={`Teacher details: ${viewing?.full_name || ''}`}
        size="md"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setViewing(null)} className="flex-1">
              Close
            </Button>
            <Button onClick={() => viewing && printTeacher(viewing)} className="flex-1">
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print profile
            </Button>
          </div>
        }
      >
        {(() => {
          const t = viewing;
          if (!t) return null;
          const cs = teacherClassesOf(t);
          return (
            <div className="space-y-2 text-sm">
              <p><span className="text-slate-500">ID:</span> {t.registration_id || '—'}</p>
              <p><span className="text-slate-500">Type:</span> {t.staff_type === 'non_teaching' ? 'Non-Teaching' : 'Teaching'}</p>
              <p><span className="text-slate-500">Email:</span> {t.email || '—'}</p>
              <p><span className="text-slate-500">Phone:</span> {t.phone || '—'}</p>
              <p><span className="text-slate-500">Qualification:</span> {t.qualification || '—'}</p>
              <p><span className="text-slate-500">Joined:</span> {t.date_joined ? formatDate(t.date_joined) : '—'}</p>
              <p><span className="text-slate-500">Status:</span> {t.user_id ? 'Registered' : 'Not registered'} · {t.is_approved ? 'Approved' : 'Pending approval'}</p>
              <div className="border-t border-slate-100 pt-2">
                <p className="font-semibold text-slate-700">Classes & Subjects</p>
                {cs.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {cs.map((c) => (
                      <li key={c}>
                        {c}: <span className="text-slate-500">{subjectsOfClassFor(t, c).join(', ') || '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">No classes assigned.</p>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!passwordTarget} onClose={() => setPasswordTarget(null)} title={`Reset password: ${passwordTarget?.full_name || ''}`} size="sm">
        <Input
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 6 characters"
          autoComplete="new-password"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setPasswordTarget(null)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={resetPassword} loading={passwordBusy} className="flex-1">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Set password
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete teacher?"
        message={`This permanently removes ${deleting?.full_name || 'this teacher'} and all related records: class & subject assignments, portal account, attendance, assessments and marks. This cannot be undone.`}
        confirmLabel="Delete teacher"
      />

      <ActivityLogModal
        open={!!activityTarget}
        person={activityTarget ? { id: activityTarget.id, display: activityTarget.full_name, sub: activityTarget.registration_id, role: 'teacher' } : null}
        onClose={() => setActivityTarget(null)}
      />
    </div>
  );
}