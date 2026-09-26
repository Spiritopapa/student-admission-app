import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, BookOpen, UserRound, Wallet, LayoutDashboard, ArrowRight } from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, Badge, StatCard } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { buildStudentName, cedi, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';
import { currentAcademicYear } from '../../lib/constants';

export default function AdminHome() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: students }, { data: classes }, { data: teachers }, { data: fees }] =
          await Promise.all([
            supabase
              .from('applications')
              .select('id, student_id, first_name, middle_name, last_name, class_applying, status, student_photo_url, created_at')
              .eq('school_id', schoolId)
              .order('created_at', { ascending: false }),
            supabase.from('classes').select('id').eq('school_id', schoolId),
            supabase.from('teachers').select('id').eq('school_id', schoolId),
            supabase.from('fees').select('balance, amount_paid').eq('school_id', schoolId),
          ]);
        if (cancelled) return;
        const collected = (fees || []).reduce((s, f) => s + Number(f.amount_paid || 0), 0);
        const outstanding = (fees || []).reduce(
          (s, f) => s + (Number(f.balance) > 0 ? Number(f.balance) : 0),
          0
        );
        setStats({
          students: students || [],
          studentCount: (students || []).length,
          classCount: (classes || []).length,
          teacherCount: (teachers || []).length,
          collectedRound: Math.round(collected),
          outstandingRound: Math.round(outstanding),
        });
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  if (!schoolId) return <Spinner label="Loading school..." />;
  if (!stats) return <Spinner label="Loading your dashboard..." />;

  const recent = stats.students.slice(0, 6);

  return (
    <div>
      <PageHeader
        title={settings?.school_name || 'School Dashboard'}
        subtitle={`Academic year ${settings?.academic_year || currentAcademicYear()} - ${settings?.current_term || 'First'} Term`}
        icon={LayoutDashboard}
        actions={
          <Link to="/admin/students" className="btn-primary">
            <Users className="h-4 w-4" aria-hidden="true" />
            Manage students
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} tone="blue" label="Students" value={stats.studentCount} sub="Enrolled and pending" />
        <StatCard icon={BookOpen} tone="teal" label="Classes" value={stats.classCount} sub="Active classes" />
        <StatCard icon={UserRound} tone="green" label="Teachers" value={stats.teacherCount} sub="Teaching staff" />
        <StatCard icon={Wallet} tone="amber" label="Fees collected" value={cedi(stats.collectedRound)} sub={`${cedi(stats.outstandingRound)} outstanding`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Recent students</h3>
            <Link to="/admin/students" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          {recent.length ? (
            <div className="mt-4 divide-y divide-slate-50">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2.5">
                  {s.student_photo_url ? (
                    <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-100" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                      {(s.first_name || 'S').charAt(0)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.class_applying} · {formatDate(s.created_at)}
                    </p>
                  </div>
                  <Badge tone={s.status === 'admitted' ? 'green' : 'amber'}>{s.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              No students yet. Admit your first student to get started.
            </p>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-bold text-slate-800">Quick actions</h3>
          <div className="mt-4 space-y-2">
            <Link to="/admin/students" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <Users className="h-4 w-4 text-brand-500" aria-hidden="true" />
              Admit a student
            </Link>
            <Link to="/admin/classes" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <BookOpen className="h-4 w-4 text-teal-500" aria-hidden="true" />
              Manage classes
            </Link>
            <Link to="/admin/teachers" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <UserRound className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              Add staff
            </Link>
            <Link to="/admin/fees" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <Wallet className="h-4 w-4 text-accent-500" aria-hidden="true" />
              Fee structure
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}