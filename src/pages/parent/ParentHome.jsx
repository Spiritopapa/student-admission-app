import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Wallet, Megaphone, ArrowRight, UserRound, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, EmptyState, StatCard, Button } from '../../components/ui';
import ConnectWardModal from '../../components/ConnectWardModal';
import { fetchParentLinks, fetchWardApplication, fetchStudentFees, fetchStudentReceipts, fetchActiveAnnouncements } from '../../lib/queries';
import { buildStudentName, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function ParentHome() {
  const { user, profile } = useAuth();
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ fees: 0, receipts: 0, announcements: 0 });
  const [connectOpen, setConnectOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const links = await fetchParentLinks(user.id);
        const apps = await Promise.all(links.map((l) => fetchWardApplication(l.student_id)));
        const populated = links
          .map((link, i) => ({ ...link, application: apps[i] }))
          .filter((l) => l.application);
        if (cancelled) return;
        setWards(populated);
        const [fees, receipts, announcements] = await Promise.all([
          Promise.all(populated.map((w) => fetchStudentFees(w.application.student_id))),
          Promise.all(populated.map((w) => fetchStudentReceipts(w.application.student_id))),
          fetchActiveAnnouncements(populated[0]?.application?.school_id),
        ]);
        if (cancelled) return;
        setTotals({
          fees: fees.flat().reduce((s, f) => s + Number(f.balance || 0), 0),
          receipts: receipts.flat().length,
          announcements: (announcements || []).length,
        });
      } catch (err) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refresh]);

  if (loading) return <Spinner label="Loading parent dashboard..." />;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.full_name?.split(' ')[0] || 'Parent'}`}
        subtitle="Follow your ward's progress at a glance."
        icon={UserRound}
        actions={
          <Button variant="secondary" onClick={() => setConnectOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Connect a ward
          </Button>
        }
      />

      {wards.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={Users} tone="blue" label="Wards" value={wards.length} sub="Linked students" index={0} />
            <StatCard icon={Wallet} tone="amber" label="Total balance" value={totals.fees.toFixed(2)} sub="Across all wards" index={1} />
            <StatCard icon={Megaphone} tone="green" label="Receipts" value={totals.receipts} sub="Verified payments" index={2} />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {wards.map((ward) => {
              const app = ward.application;
              const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
              const photo = app.student_photo_url ? photoUrl(app.student_photo_url) : null;
              return (
                <Card key={ward.id} className="p-4">
                  <div className="flex items-center gap-4">
                    {photo ? (
                      <img src={photo} alt={name} className="img-zoom h-16 w-14 rounded-xl object-cover ring-2 ring-brand-100" />
                    ) : (
                      <span className="flex h-16 w-14 items-center justify-center rounded-xl bg-brand-50 text-xl font-extrabold text-brand-600">
                        {name.charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{name}</p>
                      <p className="font-mono text-xs text-slate-400">{app.student_id}</p>
                      <p className="text-xs text-slate-400">
                        {app.class_applying} · Status:
                        <span className={app.status === 'admitted' ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>
                          {' '}{app.status}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3">
                    <p className="text-xs text-slate-400">Admitted {formatDate(app.admission_date)}</p>
                    <Link to="/parent/fees" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                      View fees
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="No wards linked yet"
          message="Connect your child's Student ID below, or ask the school to link your account. Refreshes automatically after linking."
          action={
            <Button onClick={() => setConnectOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Connect a ward
            </Button>
          }
        />
      )}

      <ConnectWardModal open={connectOpen} onClose={() => setConnectOpen(false)} onLinked={() => setRefresh((r) => r + 1)} />
    </div>
  );
}