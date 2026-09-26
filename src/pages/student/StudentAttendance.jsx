import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CircleCheckBig, CircleX, CalendarDays } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, Select, Badge } from '../../components/ui';
import { fetchStudentAttendance } from '../../lib/queries';
import { formatDate, termLabel } from '../../lib/format';
import { TERMS } from '../../lib/constants';

export default function StudentAttendance() {
  const { application, loading } = useStudentApplication();
  const [records, setRecords] = useState([]);
  const [year, setYear] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    fetchStudentAttendance(application.student_id)
      .then((rows) => {
        if (cancelled) return;
        setRecords(rows);
        const first = rows[0];
        if (first) {
          setYear(first.academic_year);
          setTerm(first.term);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [application]);

  const years = useMemo(() => [...new Set(records.map((r) => r.academic_year))], [records]);

  const filtered = useMemo(
    () => records.filter((r) => (!year || r.academic_year === year) && (!term || r.term === term)),
    [records, year, term]
  );

  const stats = useMemo(() => {
    const present = filtered.filter((r) => r.status === 'present').length;
    const absent = filtered.filter((r) => r.status === 'absent').length;
    return {
      present,
      absent,
      total: filtered.length,
      pct: filtered.length ? Math.round((present / filtered.length) * 100) : 0,
    };
  }, [filtered]);

  if (loading) return <Spinner label="Loading attendance..." />;
  if (!application) return <EmptyState title="No student record" />;

  return (
    <div>
      <PageHeader title="My Attendance" subtitle="Daily presence records with your per-term summary." icon={CalendarCheck} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <CircleCheckBig className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-slate-400">Days present</p>
              <p className="text-xl font-bold text-teal-700">{stats.present}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
              <CircleX className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-slate-400">Days absent</p>
              <p className="text-xl font-bold text-rose-600">{stats.absent}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-slate-400">Total recorded</p>
              <p className="text-xl font-bold text-slate-800">{stats.total}</p>
            </div>
          </div>
        </Card>
        <Card className="border-l-4 border-l-teal-500 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attendance rate</p>
          <p className="mt-1 text-xl font-bold text-teal-700">{stats.total ? `${stats.pct}%` : '-'}</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Select label="Academic year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>
          <option value="">All terms</option>
          {TERMS.map((t) => (
            <option key={t} value={t}>
              {termLabel(t)}
            </option>
          ))}
        </Select>
      </div>

      <Card className="mt-5 overflow-hidden">
        {filtered.length ? (
          <div className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${
                      r.status === 'present' ? 'bg-teal-50 text-teal-600' : 'bg-rose-50 text-rose-500'
                    }`}
                  >
                    {r.status === 'present' ? (
                      <CircleCheckBig className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <CircleX className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{formatDate(r.date)}</p>
                    <p className="text-xs text-slate-400">
                      {r.academic_year} - {termLabel(r.term)}
                    </p>
                  </div>
                </div>
                <Badge tone={r.status === 'present' ? 'green' : 'red'}>{r.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={CalendarCheck}
              title="No attendance records"
              message="Attendance records will appear here after your teachers mark the daily register."
            />
          </div>
        )}
      </Card>
    </div>
  );
}