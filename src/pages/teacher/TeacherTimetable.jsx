import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Spinner, EmptyState } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import TimetableGrid from '../../components/TimetableGrid';

export default function TeacherTimetable() { const { user } = useAuth(); const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!user) return; (async () => { const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', user.id).maybeSingle(); if (teacher) { const { data } = await supabase.from('timetable_entries').select('*, teacher:teachers(full_name)').eq('teacher_id', teacher.id); setEntries(data || []); } setLoading(false); })(); }, [user]); if (loading) return <Spinner label="Loading timetable..." />; return <div><PageHeader title="My Timetable" subtitle="Your scheduled teaching lessons this week." icon={CalendarClock} />{entries.length ? <TimetableGrid entries={entries} /> : <EmptyState icon={CalendarClock} title="No lessons assigned" message="Ask an administrator to add your lessons to the timetable." />}</div>; }
