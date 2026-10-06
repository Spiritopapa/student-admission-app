import { useEffect, useState } from 'react';
import { Users, UserPlus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button } from '../../components/ui';
import ConnectWardModal from '../../components/ConnectWardModal';
import { fetchParentLinks, fetchWardApplication, unlinkWardFromParent } from '../../lib/queries';
import { buildStudentName, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function ParentWards() {
  const { user } = useAuth();
  const toast = useToast();
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [unlinking, setUnlinking] = useState(false);

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
        if (!cancelled) setWards(populated);
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

  const removeWard = async (studentId, name) => {
    if (!window.confirm(`Remove ${name} (${studentId}) from your account? You can connect them again any time.`)) return;
    setUnlinking(true);
    try {
      await unlinkWardFromParent(studentId);
      toast.success('Ward removed', `${studentId} was unlinked from your account.`);
      setRefresh((r) => r + 1);
    } catch (err) {
      toast.error('Could not unlink ward', err.message);
    } finally {
      setUnlinking(false);
    }
  };

  if (loading) return <Spinner label="Loading wards..." />;

  return (
    <div>
      <PageHeader
        title="My Wards"
        subtitle="Students linked to your parent account."
        icon={Users}
        actions={
          <Button variant="secondary" onClick={() => setConnectOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Connect a ward
          </Button>
        }
      />

      {wards.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {wards.map((ward) => {
            const app = ward.application;
            const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
            const photo = app.student_photo_url ? photoUrl(app.student_photo_url) : null;
            const fields = [
              ['Student ID', app.student_id],
              ['Class', app.class_applying],
              ['Gender', app.gender],
              ['Date of birth', formatDate(app.date_of_birth)],
              ['Home town', app.home_town || '-'],
              ['Place of stay', app.place_of_stay || '-'],
            ];
            return (
              <Card key={ward.id} className="p-5">
                <div className="flex items-center gap-4">
                  {photo ? (
                    <img src={photo} alt={name} className="img-zoom h-20 w-16 rounded-2xl object-cover ring-2 ring-brand-100" />
                  ) : (
                    <span className="flex h-20 w-16 items-center justify-center rounded-2xl bg-brand-50 text-2xl font-extrabold text-brand-600">
                      {name.charAt(0)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-slate-900">{name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <Badge tone={app.status === 'admitted' ? 'green' : 'amber'}>{app.status}</Badge>
                      <Badge tone="blue">{app.class_applying}</Badge>
                    </div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-4">
                  {fields.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
                      <dd className="mt-0.5 truncate text-sm font-semibold text-slate-700">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex justify-end border-t border-slate-50 pt-3">
                  <Button size="sm" variant="ghost" onClick={() => removeWard(app.student_id, name)} disabled={unlinking}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No wards linked yet"
          message="Connect your child's Student ID to start following their progress."
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