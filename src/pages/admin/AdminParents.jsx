import { useEffect, useMemo, useState } from 'react';
import { Users, UsersRound, Link2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, SearchInput, Select, Button, Input } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';

export default function AdminParents() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | hasWards | noWards

  // Link-a-ward modal
  const [linking, setLinking] = useState(null);
  const [wardInput, setWardInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  // Unlink confirmation
  const [unlink, setUnlink] = useState(null); // { parent, studentId }
  const [unlinkBusy, setUnlinkBusy] = useState(false);

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
          const ids = (links || []).map((l) => l.student_id);
          return { ...p, wardCount: ids.length, wardIds: ids };
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

  const openLinkModal = (parent) => {
    setLinking(parent);
    setWardInput('');
    setLinkError('');
  };

  const confirmLink = async () => {
    const sid = wardInput.trim();
    if (!sid || !linking) {
      setLinkError('Enter a valid Student ID.');
      return;
    }
    setLinkBusy(true);
    setLinkError('');
    try {
      const { data, error } = await supabase.rpc('admin_link_parent_ward', {
        p_parent_user_id: linking.id,
        p_student_id: sid,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Could not link ward.');
      toast.success('Ward linked', `${sid} linked to ${linking.full_name || 'this parent'}.`);
      setLinking(null);
      load();
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinkBusy(false);
    }
  };

  const confirmUnlink = async () => {
    if (!unlink) return;
    setUnlinkBusy(true);
    try {
      const { data, error } = await supabase.rpc('admin_unlink_parent_ward', {
        p_parent_user_id: unlink.parent.id,
        p_student_id: unlink.studentId,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Could not unlink ward.');
      toast.success('Ward unlinked', `${unlink.studentId} removed from ${unlink.parent.full_name || 'this parent'}.`);
      setUnlink(null);
      load();
    } catch (err) {
      toast.error('Could not unlink ward', err.message);
      setUnlink(null);
    } finally {
      setUnlinkBusy(false);
    }
  };

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
              {p.wardIds?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.wardIds.map((sid) => (
                    <span key={sid} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 font-mono text-xs font-semibold text-brand-700">
                      {sid}
                      <button
                        type="button"
                        onClick={() => setUnlink({ parent: p, studentId: sid })}
                        className="text-brand-400 transition-colors hover:text-rose-600"
                        aria-label={`Unlink ${sid}`}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400">No wards linked yet.</p>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3">
                <Badge tone={p.wardCount > 0 ? 'green' : 'slate'}>
                  {p.wardCount} linked ward{p.wardCount === 1 ? '' : 's'}
                </Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{formatDate(p.created_at)}</span>
                  <Button size="sm" variant="secondary" onClick={() => openLinkModal(p)}>
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Link ward
                  </Button>
                </div>
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

      <Modal
        open={!!linking}
        onClose={() => setLinking(null)}
        title={`Link a ward — ${linking?.full_name || 'Parent'}`}
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setLinking(null)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={confirmLink} loading={linkBusy} className="flex-1">
              Link student
            </Button>
          </div>
        }
      >
        {linkError ? (
          <Alert tone="error" className="mb-4">
            {linkError}
          </Alert>
        ) : null}
        <Input
          label="Ward's Student ID *"
          value={wardInput}
          onChange={(e) => setWardInput(e.target.value)}
          placeholder="e.g. STU-ABC12"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmLink();
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={!!unlink}
        onClose={() => setUnlink(null)}
        onConfirm={confirmUnlink}
        loading={unlinkBusy}
        title="Unlink ward?"
        message={`Remove ${unlink?.studentId || ''} from ${unlink?.parent?.full_name || 'this parent'}'s account? The parent can reconnect it later.`}
        confirmLabel="Unlink ward"
      />
    </div>
  );
}