import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, BookOpen, LayoutDashboard, ArrowRight, CalendarCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, StatCard, EmptyState } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { fetchTeacherClassSet } from '../../lib/queries';

export default function TeacherHome() {
  const { user, profile } = useAuth();
  const [teacher, setTeacher] = useState(null);
  const [classCount, setClassCount] = useState(null);
  const [todayAtt, setTodayAtt] = useState(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('teachers')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setTeacher(data || null));
  }, [user]);

  useEffect(() => {
    if (!teacher?.id) return;
    (async () => {
      const classNames = await fetchTeacherClassSet(teacher.id, teacher.class_taught);
      if (!classNames.length) return;
      const { data } = await supabase
        .from('applications')
        .select('id')
        .eq('school_id', teacher.school_id)
        .eq('status', 'admitted')
        .in('class_applying', classNames);
      setClassCount((data || []).length);
    })();
  }, [teacher]);

  // Today's attendance summary across all of the teacher's assigned classes.
  useEffect(() => {
    if (!teacher?.school_id) return;
    let cancelled = false;
    (async () => {
      try {
        const classSet = new Set();
        if (teacher.class_taught) {
          teacher.class_taught
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
            .forEach((c) => classSet.add(c));
        }
        if (teacher.id) {
          const { data: assignments } = await supabase
            .from('teacher_classes_subjects')
            .select('class_name')
            .eq('teacher_id', teacher.id);
          (assignments || []).forEach((a) => a.class_name && classSet.add(a.class_name));
        }
        const classNames = [...classSet];
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
          .from('attendance')
          .select('class_name, status')
          .eq('date', today)
          .eq('school_id', teacher.school_id)
          .in('class_name', classNames.length ? classNames : ['__none__']);
        const grouped = {};
        (data || []).forEach((r) => {
          if (!r.class_name) return;
          if (!grouped[r.class_name]) grouped[r.class_name] = { present: 0, absent: 0 };
          if (r.status === 'present') grouped[r.class_name].present += 1;
          else if (r.status === 'absent') grouped[r.class_name].absent += 1;
        });
        if (!cancelled) {
          setTodayAtt({
            today,
            rows: Object.entries(grouped)
              .map(([className, s]) => ({ className, ...s }))
              .sort((a, b) => a.className.localeCompare(b.className)),
          });
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teacher]);

  if (!user || !teacher) return <Spinner label="Loading your dashboard..." />;

  return (
    <div>
      <PageHeader
        title={`Hello, ${profile?.full_name?.split(' ')[0] || 'Teacher'}`}
        subtitle={teacher.class_taught ? `Class teacher for ${teacher.class_taught}` : 'Teaching staff'}
        icon={LayoutDashboard}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={Users} tone="blue" label="Students in class" value={classCount ?? '-'} sub={teacher.class_taught || 'No class assigned'} index={0} />
        <StatCard icon={BookOpen} tone="teal" label="Subject" value={teacher.subject || '-'} sub={teacher.registration_id || 'Teacher'} index={1} />
        <StatCard icon={BookOpen} tone="amber" label="Class" value={teacher.class_taught || '-'} sub={teacher.qualification || '—'} index={2} />
      </div>

      {todayAtt ? (
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <CalendarCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
              Today's Attendance
            </h3>
            <span className="text-xs text-slate-400">{todayAtt.today}</span>
          </div>
          {todayAtt.rows.length ? (
            <div className="divide-y divide-slate-100">
              {todayAtt.rows.map((r) => (
                <div key={r.className} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-sm font-semibold text-slate-700">{r.className}</span>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-emerald-600">{r.present} present</span>
                    <span className="font-semibold text-rose-500">{r.absent} absent</span>
                    <span className="font-semibold text-slate-500">{r.present + r.absent} total</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-slate-400">No attendance marked yet today for your classes.</p>
          )}
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Link to="/teacher/students" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Users className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">My Class</h3>
          <p className="mt-1 text-sm text-slate-500">View the students in {teacher.class_taught || 'your class'}.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
            Open class list
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>

        <Link to="/teacher/attendance" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Attendance</h3>
          <p className="mt-1 text-sm text-slate-500">Mark the daily register for your class.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-600">
            Mark attendance
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>

        <EmptyState
          icon={BookOpen}
          title={teacher.class_taught ? `Welcome to ${teacher.class_taught}` : 'No class assigned'}
          message="Ask the administrator to assign you a class if this looks incorrect."
        />
      </div>
    </div>
  );
}