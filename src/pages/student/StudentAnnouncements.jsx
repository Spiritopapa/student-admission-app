import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, Badge } from '../../components/ui';
import { fetchActiveAnnouncements } from '../../lib/queries';
import { formatDateTime } from '../../lib/format';

export default function StudentAnnouncements() {
  const { application, loading } = useStudentApplication();
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    fetchActiveAnnouncements(application.school_id)
      .then((rows) => {
        if (!cancelled) setAnnouncements(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [application]);

  if (loading) return <Spinner label="Loading announcements..." />;
  if (!application) return <EmptyState title="No student record" />;

  return (
    <div>
      <PageHeader title="Announcements" subtitle="News and notices shared by your school." icon={Megaphone} />

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
        <EmptyState
          icon={Megaphone}
          title="Nothing to show"
          message="Your school has not posted any announcements yet."
        />
      )}
    </div>
  );
}