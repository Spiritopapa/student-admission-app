import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { PageHeader, Card, Button, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';

const ROLE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'teacher', label: 'Teachers' },
  { key: 'accountant', label: 'Accountants' },
  { key: 'student', label: 'Students' },
];

const ROLE_BADGES = {
  teacher: { label: 'Teacher', tone: 'teal' },
  accountant: { label: 'Accountant', tone: 'amber' },
  student: { label: 'Student', tone: 'blue' },
};

/**
 * Consolidated school activity log: teachers & accountants from
 * `staff_activities` plus students from `student_activities`, newest first,
 * filterable by role and searchable.
 */
export default function AdminActivityLog() {
  const schoolId = useSchoolId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // normalized { id, created_at, role, actor, sub, action, entity, details }
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: staff }, { data: students }] = await Promise.all([
        supabase
          .from('staff_activities')
          .select('*')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('student_activities')
          .select('*')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      const normalized = [];
      (staff || []).forEach((a) =>
        normalized.push({
          id: a.id,
          created_at: a.created_at,
          role: a.staff_type || 'teacher',
          actor: a.staff_name,
          sub: a.staff_registration_id,
          action: a.action,
          entity: a.entity_type,
          details: a.entity_details,
        })
      );
      (students || []).forEach((a) =>
        normalized.push({
          id: a.id,
          created_at: a.created_at,
          role: 'student',
          actor: a.student_name,
          sub: a.class_name,
          action: a.action,
          entity: a.entity_type,
          details: a.entity_details,
        })
      );
      normalized.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setRows(normalized);
    } catch (err) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.role !== tab) return false;
      if (!needle) return true;
      return [r.actor, r.sub, r.action, r.entity, r.details].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [rows, tab, q]);

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Audit trail for teachers, accountants and students."
        icon={Activity}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Search actor, action or details..." />
        <div className="flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {ROLE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 text-sm text-slate-500">{filtered.length} event(s)</p>

      {loading ? (
        <Spinner label="Loading activity log..." />
      ) : filtered.length ? (
        <div className="space-y-2">
          {filtered.map((r) => {
            const badge = ROLE_BADGES[r.role] || { label: r.role, tone: 'slate' };
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{r.action}</p>
                    <p className="text-xs text-slate-400">
                      {r.actor || '—'}
                      {r.sub ? ` · ${r.sub}` : ''}
                      {r.entity && r.entity !== 'general' ? ` · ${r.entity}` : ''}
                      {r.details ? ` · ${r.details}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(r.created_at)}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          message="Logins, profile updates, attendance marking, fee payments and more will appear here."
        />
      )}
    </div>
  );
}