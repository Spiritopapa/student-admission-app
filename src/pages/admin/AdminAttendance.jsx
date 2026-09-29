import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Save, Sun, CalendarX2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';
import { currentAcademicYear } from '../../lib/constants';

export default function AdminAttendance() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const [className, setClassName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [marks, setMarks] = useState({});
  const [existing, setExisting] = useState([]);
  const [eventDay, setEventDay] = useState(null);
  const [saving, setSaving] = useState(false);

  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState({ date: new Date().toISOString().split('T')[0], event_type: 'holiday', label: '', notes: '' });
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState('');

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: classRows }, { data: settingsRows }] = await Promise.all([
          supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
          supabase.from('school_settings').select('academic_year, current_term').eq('school_id', schoolId).maybeSingle(),
        ]);
        setClasses(classRows || []);
        setSettings(settingsRows || null);
      } catch (err) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [schoolId]);

  const loadClassData = async (cls) => {
    if (!cls || !schoolId) return;
    setLoading(true);
    try {
      const [{ data: studentRows }, { data: attRows }] = await Promise.all([
        supabase
          .from('applications')
          .select('*')
          .eq('school_id', schoolId)
          .eq('class_applying', cls)
          .eq('status', 'admitted')
          .order('last_name'),
        supabase.from('attendance').select('*').eq('class_name', cls).eq('date', date).eq('school_id', schoolId),
      ]);
      setStudents(studentRows || []);
      setMarks(Object.fromEntries((attRows || []).map((r) => [r.student_id, r.status])));
      setExisting(attRows || []);
      const { data: event } = await supabase
        .from('attendance_event_days')
        .select('*')
        .eq('school_id', schoolId)
        .eq('date', date)
        .maybeSingle();
      setEventDay(event || null);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (className) loadClassData(className);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, date, schoolId]);

  const presentCount = useMemo(
    () => students.filter((s) => (marks[s.student_id] || 'present') === 'present').length,
    [students, marks]
  );

  const saveAttendance = async () => {
    if (!className || !students.length) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = students.map((s) => ({
        student_id: s.student_id,
        date,
        status: marks[s.student_id] === 'absent' ? 'absent' : 'present',
        class_name: className,
        academic_year: settings?.academic_year || currentAcademicYear(),
        term: settings?.current_term || 'First',
        remarks: '',
        marked_by: user?.id || null,
        school_id: schoolId,
      }));
      if (existing.length) {
        await supabase.from('attendance').delete().in('id', existing.map((e) => e.id));
      }
      const { error } = await supabase.from('attendance').insert(rows);
      if (error) throw new Error(error.message);
      toast.success('Attendance saved', `${rows.length} students marked for ${date}.`);
    } catch (err) {
      toast.error('Could not save attendance', err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEventDay = async () => {
    setEventError('');
    if (!eventForm.date) {
      setEventError('Pick a date.');
      return;
    }
    setEventBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('attendance_event_days').insert([
        {
          school_id: schoolId,
          date: eventForm.date,
          event_type: eventForm.event_type,
          label: eventForm.label.trim(),
          notes: eventForm.notes.trim(),
          created_by: user?.id || null,
        },
      ]);
      if (error) throw new Error(error.message);
      toast.success('Event day added', `${formatDate(eventForm.date)} · ${eventForm.label || eventForm.event_type}`);
      setEventOpen(false);
      loadClassData(className);
    } catch (err) {
      setEventError(err.message);
    } finally {
      setEventBusy(false);
    }
  };

  const removeEventDay = async () => {
    if (!eventDay) return;
    const { error } = await supabase.from('attendance_event_days').delete().eq('id', eventDay.id);
    if (error) toast.error('Could not remove event day', error.message);
    else toast.success('Event day removed', formatDate(eventDay.date));
    setEventDay(null);
  };

  return (
    <div>
      <PageHeader
        title="Attendance Management"
        subtitle="Mark the register for any class on any day."
        icon={CalendarCheck}
        actions={
          <Button onClick={saveAttendance} loading={saving} disabled={!className || !students.length}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save attendance
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Select label="Class *" value={className} onChange={(e) => setClassName(e.target.value)}>
          <option value="">Select class...</option>
          {classes.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
        <div className="flex items-end">
          <Button variant="secondary" onClick={() => { setEventForm({ date, event_type: 'holiday', label: '', notes: '' }); setEventError(''); setEventOpen(true); }} className="w-full">
            <CalendarX2 className="h-4 w-4" aria-hidden="true" />
            Mark event / holiday
          </Button>
        </div>
      </div>

      {eventDay ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <div>
            <b>{eventDay.label || (eventDay.event_type === 'holiday' ? 'Holiday' : 'Special day')}</b>
            <span className="ml-2 text-sm">on {formatDate(eventDay.date)}</span>
            <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              {eventDay.event_type}
            </span>
            {eventDay.notes ? <p className="mt-1 text-sm">{eventDay.notes}</p> : null}
          </div>
          <button type="button" onClick={removeEventDay} className="btn-ghost text-sm">
            Remove
          </button>
        </div>
      ) : null}

      {!className ? (
        <EmptyState icon={CalendarCheck} title="Pick a class" message="Select a class and date to mark attendance." />
      ) : loading ? (
        <Spinner label="Loading class..." />
      ) : students.length ? (
        <>
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100">
              {students.map((s) => {
                const present = (marks[s.student_id] || 'present') === 'present';
                return (
                  <div key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      {s.student_photo_url ? (
                        <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-10 w-9 rounded-lg object-cover ring-1 ring-slate-100" />
                      ) : (
                        <span className="flex h-10 w-9 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                          {(s.first_name || 'S').charAt(0)}
                        </span>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{buildStudentName(s.first_name, s.middle_name, s.last_name)}</p>
                        <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'present' }))}
                        className={`badge cursor-pointer transition-colors ${present ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                      >
                        Present
                      </button>
                      <button
                        type="button"
                        onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'absent' }))}
                        className={`badge cursor-pointer transition-colors ${!present ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                      >
                        Absent
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Badge tone="green">{presentCount} present</Badge>
            <Badge tone="red">{students.length - presentCount} absent</Badge>
            <Badge tone="slate">{existing.length ? 'Previously saved — editing' : 'New register'}</Badge>
          </div>
        </>
      ) : (
        <EmptyState icon={CalendarCheck} title="No students in this class" message="This class has no admitted students to mark." />
      )}

      <Modal open={eventOpen} onClose={() => setEventOpen(false)} title="Mark event / holiday" size="sm">
        {eventError ? (
          <Alert tone="error" className="mb-4">
            {eventError}
          </Alert>
        ) : null}
        <div className="space-y-4">
          <Input label="Date *" type="date" value={eventForm.date} onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))} />
          <Select label="Type *" value={eventForm.event_type} onChange={(e) => setEventForm((f) => ({ ...f, event_type: e.target.value }))}>
            <option value="holiday">Holiday (no school)</option>
            <option value="manual">Manual / special day</option>
          </Select>
          <Input label="Label" value={eventForm.label} onChange={(e) => setEventForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Sports day" />
          <Input label="Notes" value={eventForm.notes} onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={() => setEventOpen(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={saveEventDay} loading={eventBusy} className="flex-1">
            <Sun className="h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}