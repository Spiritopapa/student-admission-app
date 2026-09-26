import { useEffect, useState } from 'react';
import { CalendarCheck, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Button, Input, Badge } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { buildStudentName } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function TeacherAttendance() {
  const { user } = useAuth();
  const toast = useToast();
  const [teacher, setTeacher] = useState(null);
  const [students, setStudents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [marks, setMarks] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: teacherData } = await supabase
          .from('teachers')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        setTeacher(teacherData || null);
        if (teacherData?.school_id) {
          const { data: settingsData } = await supabase
            .from('school_settings')
            .select('academic_year, current_term')
            .eq('school_id', teacherData.school_id)
            .maybeSingle();
          setSettings(settingsData || null);
        }
        if (teacherData?.class_taught) {
          const { data } = await supabase
            .from('applications')
            .select('*')
            .eq('class_applying', teacherData.class_taught)
            .eq('school_id', teacherData.school_id)
            .eq('status', 'admitted')
            .order('last_name');
          setStudents(data || []);
          setMarks(Object.fromEntries((data || []).map((s) => [s.student_id, 'present'])));
        }
      } catch (err) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <Spinner label="Loading class..." />;
  if (!teacher?.class_taught || !students.length) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No students to mark"
        message="You need a class with enrolled students to mark attendance."
      />
    );
  }

  const saveAttendance = async () => {
    setSaving(true);
    const rows = students.map((s) => ({
      student_id: s.student_id,
      date,
      status: marks[s.student_id] || 'absent',
      class_name: teacher.class_taught,
      academic_year: settings?.academic_year || '2025/2026',
      term: settings?.current_term || 'First',
      marked_by: user.id,
      school_id: teacher.school_id,
    }));

    try {
      const { data: existing } = await supabase
        .from('attendance')
        .select('id, student_id')
        .eq('date', date)
        .eq('class_name', teacher.class_taught);
      if (existing && existing.length) {
        await supabase
          .from('attendance')
          .delete()
          .in('id', existing.map((e) => e.id));
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

  return (
    <div>
      <PageHeader
        title="Daily Attendance"
        subtitle={`Mark the register for ${teacher.class_taught}`}
        icon={CalendarCheck}
        actions={
          <Button onClick={saveAttendance} loading={saving}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save attendance
          </Button>
        }
      />

      <div className="mb-5 max-w-xs">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {students.map((s) => {
            const present = marks[s.student_id] === 'present' || marks[s.student_id] === undefined;
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
                    <p className="text-sm font-semibold text-slate-800">
                      {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                    </p>
                    <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'present' }))}
                    className={`badge cursor-pointer transition-colors ${
                      present ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                    }`}
                  >
                    Present
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'absent' }))}
                    className={`badge cursor-pointer transition-colors ${
                      !present ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                    }`}
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
        <Badge tone="green">
          {Object.entries(marks).filter(([, v]) => v === 'present' || v === undefined).length} present
        </Badge>
        <Badge tone="red">
          {Object.entries(marks).filter(([, v]) => v === 'absent').length} absent
        </Badge>
      </div>
    </div>
  );
}