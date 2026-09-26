import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, EmptyState, Badge } from '../../components/ui';
import { fetchParentLinks, fetchWardApplication } from '../../lib/queries';
import { buildStudentName, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function ParentWards() {
  const { user } = useAuth();
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(true);

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
  }, [user]);

  if (loading) return <Spinner label="Loading wards..." />;

  return (
    <div>
      <PageHeader title="My Wards" subtitle="Students linked to your parent account." icon={Users} />

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
                    <img src={photo} alt={name} className="h-20 w-16 rounded-2xl object-cover ring-2 ring-brand-100" />
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
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No wards linked yet"
          message="Ask the school to link your account to your child's Student ID."
        />
      )}
    </div>
  );
}