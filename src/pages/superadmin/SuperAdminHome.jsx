import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { School, FileCheck2, Users, Building2, ArrowRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, StatCard, Badge, Button } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';

const TRIAL_EXPIRING_SOON_DAYS = 3;

export default function SuperAdminHome() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [trialSchools, setTrialSchools] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          { count: schools },
          { count: pendingApps },
          { count: students },
          { count: teachers },
          { data: trials },
        ] = await Promise.all([
          supabase.from('schools').select('id', { count: 'exact', head: true }),
          supabase.from('school_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('applications').select('id', { count: 'exact', head: true }),
          supabase.from('teachers').select('id', { count: 'exact', head: true }),
          supabase.from('schools').select('id, name, registration_id, trial_ends_at').eq('plan_version', 'trial'),
        ]);
        if (!cancelled) {
          setStats({ schools, pendingApps, students, teachers });
          setTrialSchools(trials || []);
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const expired = [];
  const expiring = [];
  trialSchools.forEach((s) => {
    if (!s.trial_ends_at) return;
    const end = new Date(s.trial_ends_at);
    const diffDays = Math.ceil((end - now) / 86400000);
    if (end < now) expired.push({ ...s, end });
    else if (diffDays <= TRIAL_EXPIRING_SOON_DAYS) expiring.push({ ...s, end, diffDays });
  });

  if (!stats) return <Spinner label="Loading platform overview..." />;

  return (
    <div>
      <PageHeader
        title={`Hello, ${profile?.full_name?.split(' ')[0] || 'Super Admin'}`}
        subtitle="Platform-wide overview of schools and activity."
        icon={Building2}
      />

      {(expired.length > 0 || expiring.length > 0) && (
        <Card className="mb-6 p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-slate-800">Trial alerts</h3>
            <Badge tone="red">{expired.length} expired</Badge>
            <Badge tone="amber">{expiring.length} expiring soon</Badge>
          </div>
          <div className="mt-4 space-y-2">
            {expired.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5"
              >
                <div className="text-sm text-rose-900">
                  <strong>{s.name}</strong>
                  <span className="ml-2 text-xs text-rose-700">
                    {s.registration_id} — trial expired on {formatDate(s.end)}
                  </span>
                </div>
                <Link to="/superadmin/schools">
                  <Button size="sm" variant="secondary">
                    View
                  </Button>
                </Link>
              </div>
            ))}
            {expiring.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5"
              >
                <div className="text-sm text-amber-900">
                  <strong>{s.name}</strong>
                  <span className="ml-2 text-xs text-amber-700">
                    {s.registration_id} — trial ends in {s.diffDays} day{s.diffDays === 1 ? '' : 's'} ({formatDate(s.end)})
                  </span>
                </div>
                <Link to="/superadmin/schools">
                  <Button size="sm" variant="secondary">
                    View
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={School} tone="blue" label="Schools" value={stats.schools} sub="Registered institutions" index={0} />
        <StatCard icon={FileCheck2} tone="amber" label="Pending applications" value={stats.pendingApps} sub="Awaiting your review" index={1} />
        <StatCard icon={Users} tone="teal" label="Students" value={stats.students} sub="Across all schools" index={2} />
        <StatCard icon={Users} tone="green" label="Teachers" value={stats.teachers} sub="Across all schools" index={3} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Link to="/superadmin/schools" className="card block p-5 transition-shadow hover:shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <School className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-bold text-slate-800">Manage schools</h3>
          <p className="mt-1 text-sm text-slate-500">
            Add schools, approve, edit plans, manage module locks and reset passwords.
          </p>
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