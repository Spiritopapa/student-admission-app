import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { buildStudentName } from '../../lib/format';
import { photoUrl } from '../../lib/storage';

export default function TeacherStudents() {
  const { user } = useAuth();
  const [teacher, setTeacher] = useState(null);
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: teacherData } = await supabase
          .from('teachers')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        setTeacher(teacherData || null);
        if (teacherData?.class_taught) {
          const { data } = await supabase
            .from('applications')
            .select('*')
            .eq('class_applying', teacherData.class_taught)
            .eq('school_id', teacherData.school_id)
            .order('last_name')
            .eq('status', 'admitted');
          setStudents(data || []);
        }
      } catch (err) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <Spinner label="Loading class list..." />;
  if (!teacher?.class_taught) {
    return <EmptyState icon={Users} title="No class assigned" message="The administrator has not assigned you a class yet." />;
  }

  const filtered = students.filter((s) => {
    const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
    return !query || name.includes(query.toLowerCase()) || s.student_id.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div>
      <PageHeader title="My Class" subtitle={`Students in ${teacher.class_taught}`} icon={Users} />
      <SearchInput value={query} onChange={setQuery} placeholder="Search students..." className="mb-5 max-w-sm" />

      {filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center gap-3">
                {s.student_photo_url ? (
                  <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-14 w-12 rounded-xl object-cover ring-2 ring-brand-100" />
                ) : (
                  <span className="flex h-14 w-12 items-center justify-center rounded-xl bg-brand-50 text-lg font-extrabold text-brand-600">
                    {(s.first_name || 'S').charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                  <div className="mt-1"><Badge tone="blue">{s.class_applying}</Badge></div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} title="No students found" message="No students are enrolled in this class yet." />
      )}
    </div>
  );
}