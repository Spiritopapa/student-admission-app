import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { PageHeader, Spinner, EmptyState } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import TimetableGrid from '../../components/TimetableGrid';

export default function StudentTimetable() { const { application, loading } = useStudentApplication(); const [entries, setEntries] = useState([]); const [busy, setBusy] = useState(true); useEffect(() => { if (!application) return; supabase.from('timetable_entries').select('*, teacher:teachers(full_name)').eq('school_id', application.school_id).eq('class_name', application.class_applying).then(({ data }) => { setEntries(data || []); setBusy(false); }); }, [application]); if (loading || busy) return <Spinner label="Loading timetable..." />; if (!application) return <EmptyState title="No student record" />; return <div><PageHeader title="My Timetable" subtitle={`Weekly lessons for ${application.class_applying}.`} icon={CalendarClock} />{entries.length ? <TimetableGrid entries={entries} /> : <EmptyState icon={CalendarClock} title="No timetable published" message="Your school has not scheduled lessons for this class yet." />}</div>; }
