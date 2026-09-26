import { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Eye, Trash2 } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Button, Input, Select, Badge, Spinner, EmptyState, SearchInput, Card } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, photoUrl } from '../../lib/storage';
import { GENDERS, RELIGIONS, TERMS, currentAcademicYear } from '../../lib/constants';
import { buildStudentName, formatDate } from '../../lib/format';
import { fetchClassFees } from '../../lib/queries';

const emptyForm = {
  first_name: '',
  middle_name: '',
  last_name: '',
  class_applying: '',
  term: 'First',
  date_of_birth: '',
  gender: 'Male',
  religion: 'Christian',
  parent_name: '',
  parent_contact: '',
  home_town: '',
  place_of_stay: '',
  previous_school: '',
};

export default function AdminStudents() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const [admitOpen, setAdmitOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: studentsData }, { data: classesData }] = await Promise.all([
        supabase
          .from('applications')
          .select('id, student_id, first_name, middle_name, last_name, class_applying, gender, status, student_photo_url, created_at, school_id')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false }),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setStudents(studentsData || []);
      setClasses(classesData || []);
    } catch (err) {
      toast.error('Could not load students', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
        const matchesQuery =
          !query ||
          name.includes(query.toLowerCase()) ||
          s.student_id.toLowerCase().includes(query.toLowerCase());
        const matchesClass = !classFilter || s.class_applying === classFilter;
        return matchesQuery && matchesClass;
      }),
    [students, query, classFilter]
  );

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const admitStudent = async () => {
    setFormError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setFormError('First and last name are required.');
      return;
    }
    if (!form.class_applying) {
      setFormError('Please select a class.');
      return;
    }
    if (!form.date_of_birth) {
      setFormError('Date of birth is required.');
      return;
    }
    if (!form.parent_name.trim() || !form.parent_contact.trim()) {
      setFormError('Parent name and contact are required.');
      return;
    }
    setBusy(true);
    try {
      const { data: studentId, error: idError } = await supabase.rpc('generate_student_id');
      if (idError || !studentId) throw new Error('Could not generate a student ID.');

      let photoValue = null;
      if (photoFile) {
        photoValue = await uploadFile(
          'student-photos',
          randomPath(`students/${studentId}`, photoFile.name),
          photoFile
        );
      }

      const { error: insertError } = await supabase.from('applications').insert([
        {
          student_id: studentId,
          school_id: schoolId,
          first_name: form.first_name.trim(),
          middle_name: form.middle_name.trim() || null,
          last_name: form.last_name.trim(),
          class_applying: form.class_applying,
          date_of_birth: form.date_of_birth,
          gender: form.gender,
          religion: form.religion,
          previous_school: form.previous_school.trim() || null,
          parent_name: form.parent_name.trim(),
          parent_contact: form.parent_contact.trim(),
          home_town: form.home_town.trim() || null,
          place_of_stay: form.place_of_stay.trim() || null,
          term: form.term,
          student_photo_url: photoValue,
          status: 'admitted',
        },
      ]);
      if (insertError) throw new Error(insertError.message);

      const academicYear = settings?.academic_year || currentAcademicYear();
      const classFee = await fetchClassFees(schoolId, form.class_applying, academicYear, form.term);
      if (classFee) {
        await supabase
          .from('fees')
          .upsert(
            [
              {
                student_id: studentId,
                academic_year: academicYear,
                term: form.term,
                total_amount: classFee.fee_amount || 0,
                amount_paid: 0,
                debt: 0,
                payment_status: Number(classFee.fee_amount || 0) > 0 ? 'unpaid' : 'paid',
                school_id: schoolId,
              },
            ],
            { onConflict: 'student_id,academic_year,term' }
          );
      }

      toast.success('Student admitted', `Student ID ${studentId} created.`);
      setAdmitOpen(false);
      setForm(emptyForm);
      setPhotoFile(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_student_completely', {
        p_student_id: deleting.student_id,
      });
      if (error) throw new Error(error.message);
      toast.success(
        'Student removed',
        `${buildStudentName(deleting.first_name, deleting.middle_name, deleting.last_name)} was deleted together with related records.`
      );
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete student', err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle={`${students.length} students currently on record.`}
        icon={Users}
        actions={
          <Button onClick={() => setAdmitOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Admit student
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name or Student ID..." />
        <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner label="Loading students..." />
      ) : filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center gap-3">
                {s.student_photo_url ? (
                  <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-14 w-12 rounded-xl object-cover ring-2 ring-brand-100" />
                ) : (
                  <span className="flex h-14 w-12 items-center justify-center rounded-xl bg-brand-50 text-lg font-extrabold text-brand-600">
                    {(s.first_name || 'S').charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="blue">{s.class_applying}</Badge>
                    <Badge tone={s.status === 'admitted' ? 'green' : 'amber'}>{s.status}</Badge>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3">
                <p className="text-xs text-slate-400">Joined {formatDate(s.created_at)}</p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setViewing(s)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600" aria-label="View details">
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeleting(s)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600" aria-label="Delete student">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No students found"
          message={students.length ? 'Try adjusting your search or filters.' : 'Admit your first student to get started.'}
          action={students.length ? null : <Button onClick={() => setAdmitOpen(true)}>Admit student</Button>}
        />
      )}

      <Modal open={admitOpen} onClose={() => setAdmitOpen(false)} title="Admit a new student" size="lg" footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="secondary" onClick={() => setAdmitOpen(false)}>
            Cancel
          </Button>
          <Button onClick={admitStudent} loading={busy}>
            Admit student
          </Button>
        </div>
      }>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="First name *" value={form.first_name} onChange={set('first_name')} />
          <Input label="Middle name" value={form.middle_name} onChange={set('middle_name')} />
          <Input label="Last name *" value={form.last_name} onChange={set('last_name')} />
          <Select label="Class *" value={form.class_applying} onChange={set('class_applying')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Term" value={form.term} onChange={set('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input label="Date of birth *" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().split('T')[0]} />
          <Select label="Gender" value={form.gender} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label="Religion" value={form.religion} onChange={set('religion')}>
            {RELIGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Input label="Parent / guardian name *" value={form.parent_name} onChange={set('parent_name')} />
          <Input label="Parent / guardian contact *" type="tel" value={form.parent_contact} onChange={set('parent_contact')} />
          <Input label="Home town" value={form.home_town} onChange={set('home_town')} />
          <Input label="Place of stay" value={form.place_of_stay} onChange={set('place_of_stay')} />
          <Input label="Previous school" value={form.previous_school} onChange={set('previous_school')} className="sm:col-span-2" />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-5">
          <PhotoUpload value={photoFile} onChange={setPhotoFile} maxMb={1} circle />
          {formError ? <Alert tone="error" className="w-full">{formError}</Alert> : null}
        </div>
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Student details" size="md">
        {viewing ? (
          <div>
            <div className="flex items-center gap-4">
              {viewing.student_photo_url ? (
                <img src={photoUrl(viewing.student_photo_url)} alt="Student" className="h-20 w-16 rounded-2xl object-cover ring-2 ring-brand-100" />
              ) : (
                <span className="flex h-20 w-16 items-center justify-center rounded-2xl bg-brand-50 text-2xl font-extrabold text-brand-600">
                  {(viewing.first_name || 'S').charAt(0)}
                </span>
              )}
              <div>
                <p className="text-base font-bold text-slate-900">
                  {buildStudentName(viewing.first_name, viewing.middle_name, viewing.last_name)}
                </p>
                <p className="font-mono text-xs text-slate-400">{viewing.student_id}</p>
                <div className="mt-1.5 flex gap-2">
                  <Badge tone="blue">{viewing.class_applying}</Badge>
                  <Badge tone={viewing.status === 'admitted' ? 'green' : 'amber'}>{viewing.status}</Badge>
                </div>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Detail label="Gender" value={viewing.gender} />
              <Detail label="Admitted" value={formatDate(viewing.created_at)} />
            </dl>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete student?"
        message={`This permanently removes ${deleting ? buildStudentName(deleting.first_name, deleting.middle_name, deleting.last_name) : 'this student'} together with their fees, attendance and results. This cannot be undone.`}
        confirmLabel="Delete student"
      />
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-700">{value || '-'}</dd>
    </div>
  );
}