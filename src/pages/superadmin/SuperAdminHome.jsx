import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { School, FileCheck2, Users, Building2, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, StatCard } from '../../components/ui';
import { supabase } from '../../lib/supabase';

export default function SuperAdminHome() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ count: schools }, { count: pendingApps }, { count: students }, { count: teachers }] =
          await Promise.all([
            supabase.from('schools').select('id', { count: 'exact', head: true }),
            supabase.from('school_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('applications').select('id', { count: 'exact', head: true }),
            supabase.from('teachers').select('id', { count: 'exact', head: true }),
          ]);
        if (!cancelled) setStats({ schools, pendingApps, students, teachers });
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) return <Spinner label="Loading platform overview..." />;

  return (
    <div>
      <PageHeader
        title={`Hello, ${profile?.full_name?.split(' ')[0] || 'Super Admin'}`}
        subtitle="Platform-wide overview of schools and activity."
        icon={Building2}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={School} tone="blue" label="Schools" value={stats.schools} sub="Registered institutions" />
        <StatCard icon={FileCheck2} tone="amber" label="Pending applications" value={stats.pendingApps} sub="Awaiting your review" />
        <StatCard icon={Users} tone="teal" label="Students" value={stats.students} sub="Across all schools" />
        <StatCard icon={Users} tone="green" label="Teachers" value={stats.teachers} sub="Across all schools" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Link to="/superadmin/schools" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <School className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Manage schools</h3>
          <p className="mt-1 text-sm text-slate-500">Approve schools, reset passwords and view registrations.</p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
            Open schools
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>

        <Link to="/superadmin/applications" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">School applications</h3>
          <p className="mt-1 text-sm text-slate-500">
            Review schools that have applied to join the platform.
          </p>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-600">
            Review queue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </Link>
      </div>
    </div>
  );
}