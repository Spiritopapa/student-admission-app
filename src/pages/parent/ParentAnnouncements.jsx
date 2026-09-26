import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, EmptyState, Badge } from '../../components/ui';
import { fetchParentLinks, fetchActiveAnnouncements } from '../../lib/queries';
import { formatDateTime } from '../../lib/format';

export default function ParentAnnouncements() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const links = await fetchParentLinks(user.id);
        const schoolId = links[0]?.school_id || null;
        const rows = await fetchActiveAnnouncements(schoolId);
        if (!cancelled) setAnnouncements(rows);
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

  if (loading) return <Spinner label="Loading announcements..." />;

  return (
    <div>
      <PageHeader title="Announcements" subtitle="News shared by your child's school." icon={Megaphone} />

      {announcements.length ? (
        <div className="space-y-4">
          {announcements.map((item) => (
            <Card key={item.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge
                  tone={item.priority === 'urgent' ? 'red' : item.priority === 'high' ? 'amber' : 'blue'}
                  className="uppercase"
                >
                  {item.priority}
                </Badge>
                <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-800">{item.title}</h3>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">{item.content}</p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Megaphone} title="Nothing to show" message="Your school has not posted any announcements yet." />
      )}
    </div>
  );
}