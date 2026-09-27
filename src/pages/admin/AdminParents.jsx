import { useEffect, useMemo, useState } from 'react';
import { Users, UsersRound } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, SearchInput, Select } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';

export default function AdminParents() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | hasWards | noWards

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      let q = supabase.from('profiles').select('*').eq('role', 'parent').eq('school_id', schoolId).order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const parents = data || [];
      const enriched = await Promise.all(
        parents.map(async (p) => {
          const { data: links } = await supabase
            .from('parent_links')
            .select('student_id')
            .eq('parent_user_id', p.id);
          return { ...p, wardCount: links?.length || 0 };
        })
      );
      setRows(enriched);
    } catch (err) {
      toast.error('Could not load parents', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      const matchesQuery =
        !q || `${p.full_name} ${p.email || ''}`.toLowerCase().includes(q);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'hasWards' && p.wardCount > 0) ||
        (filter === 'noWards' && p.wardCount === 0);
      return matchesQuery && matchesFilter;
    });
  }, [rows, query, filter]);

  return (
    <div>
      <PageHeader
        title="Parents / Guardians"
        subtitle="Accounts linked to students as parents or guardians."
        icon={Users}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full max-w-sm">
          <SearchInput value={query} onChange={setQuery} placeholder="Search parents..." />
        </div>
        <div className="w-48">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All parents</option>
            <option value="hasWards">With wards</option>
            <option value="noWards">No wards</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading parents..." />
      ) : filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                  <UsersRound className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{p.full_name || 'Unnamed parent'}</p>
                  <p className="truncate text-xs text-slate-400">{p.email || '-'}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3">
                <Badge tone={p.wardCount > 0 ? 'green' : 'slate'}>
                  {p.wardCount} linked ward{p.wardCount === 1 ? '' : 's'}
                </Badge>
                <span className="text-xs text-slate-400">{formatDate(p.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No parents found"
          message="Parents appear here once they register and link their child's Student ID."
        />
      )}
    </div>
  );
}