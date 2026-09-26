import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, BookOpen, LayoutDashboard, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, StatCard, EmptyState } from '../../components/ui';
import { supabase } from '../../lib/supabase';

export default function TeacherHome() {
  const { user, profile } = useAuth();
  const [teacher, setTeacher] = useState(null);
  const [classCount, setClassCount] = useState(null);

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
    if (!teacher?.class_taught) return;
    supabase
      .from('applications')
      .select('id')
      .eq('class_applying', teacher.class_taught)
      .eq('school_id', teacher.school_id)
      .eq('status', 'admitted')
      .then(({ data }) => setClassCount((data || []).length));
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
        <StatCard icon={Users} tone="blue" label="Students in class" value={classCount ?? '-'} sub={teacher.class_taught || 'No class assigned'} />
        <StatCard icon={BookOpen} tone="teal" label="Subject" value={teacher.subject || '-'} sub={teacher.registration_id || 'Teacher'} />
        <StatCard icon={BookOpen} tone="amber" label="Class" value={teacher.class_taught || '-'} sub={teacher.qualification || '—'} />
      </div>

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