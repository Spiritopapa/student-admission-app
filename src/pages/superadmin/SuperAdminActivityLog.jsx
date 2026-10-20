import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { PageHeader, Card, Button, Spinner, EmptyState, Badge, SearchInput, Select } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';

const ROLE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'School Admins' },
  { key: 'sub_admin', label: 'Sub Admins' },
];

const ROLE_BADGES = {
  admin: { label: 'School Admin', tone: 'green' },
  sub_admin: { label: 'Sub Admin', tone: 'slate' },
};

/**
 * Super Admin activity log for EVERY school admin across ALL schools.
 *
 * Merges two sources (newest first, filterable by school / role / text):
 *   - `staff_activities` where staff_type = 'admin'  (school admins — rows
 *     written by logAdminActivity; RLS already lets super admins read all)
 *   - `sub_admin_activities`                        (sub admins — school_id
 *     backfilled by migration 088 for the school filter)
 */
export default function SuperAdminActivityLog() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // { id, created_at, role, actor, reg, school_id, action, entity, details }
  const [schools, setSchools] = useState([]);
  const [tab, setTab] = useState('all');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [q, setQ] = useState('');
  const [attempt, setAttempt] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: adminActs, error: adminErr }, { data: subActs, error: subErr }, { data: schoolRows }] =
        await Promise.all([
          supabase
            .from('staff_activities')
            .select('*')
            .eq('staff_type', 'admin')
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase
            .from('sub_admin_activities')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase.from('schools').select('id, name, registration_id').order('name'),
        ]);
      if (adminErr || subErr) throw new Error(adminErr?.message || subErr?.message);
      const normalized = [];
      (adminActs || []).forEach((a) =>
        normalized.push({
          id: `sa-${a.id}`,
          created_at: a.created_at,
          role: 'admin',
          actor: a.staff_name,
          reg: a.staff_registration_id,
          school_id: a.school_id || null,
          action: a.action,
          entity: a.entity_type,
          details: a.entity_details,
        })
      );
      (subActs || []).forEach((a) =>
        normalized.push({
          id: `sua-${a.id}`,
          created_at: a.created_at,
          role: 'sub_admin',
          actor: a.sub_admin_name,
          reg: a.registration_id,
          school_id: a.school_id || null,
          action: a.action,
          entity: a.entity_type,
          details: a.entity_details,
        })
      );
      normalized.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setRows(normalized);
      setSchools(schoolRows || []);
    } catch (err) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const schoolNameById = useMemo(
    () => Object.fromEntries((schools || []).map((s) => [s.id, s.name])),
    [schools]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.role !== tab) return false;
      if (schoolFilter && r.school_id !== schoolFilter) return false;
      if (!needle) return true;
      const school = r.school_id ? schoolNameById[r.school_id] : '';
      return [r.actor, r.reg, r.action, r.entity, r.details, school].some((v) =>
        String(v || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, tab, schoolFilter, q, schoolNameById]);

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Audit trail for every school admin (school administrators & sub admins) across all schools."
        icon={Activity}
        actions={
          <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full lg:max-w-xs">
          <SearchInput value={q} onChange={setQ} placeholder="Search admin, action, school or details..." />
        </div>
        <div className="w-full lg:max-w-xs">
          <Select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}>
            <option value="">All schools</option>
            {(schools || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {ROLE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
                tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
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
            const school = r.school_id ? schoolNameById[r.school_id] : null;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{r.action}</p>
                    <p className="text-xs text-slate-400">
                      {r.actor || '—'}
                      {r.reg ? ` · ${r.reg}` : ''}
                      {school ? ` · ${school}` : ' · No school linked'}
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
          title="No school admin activity yet"
          message="Logins, profile updates, fee-structure changes, student admissions and other admin actions will appear here as soon as school admins start working."
        />
      )}
    </div>
  );
}
