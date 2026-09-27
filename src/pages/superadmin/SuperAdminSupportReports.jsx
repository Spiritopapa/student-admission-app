import { useEffect, useMemo, useState } from 'react';
import { LifeBuoy, Bug, Lightbulb, Inbox } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Spinner, EmptyState, Badge, Select } from '../../components/ui';
import { Modal, ConfirmDialog } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';

const STATUS_TONES = {
  new: 'amber',
  in_progress: 'blue',
  resolved: 'green',
};

export default function SuperAdminSupportReports() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('support_reports').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) toast.error('Could not load reports', error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  const updateStatus = async (row, status) => {
    const { error } = await supabase.from('support_reports').update({ status }).eq('id', row.id);
    if (error) toast.error('Could not update report', error.message);
    else {
      toast.success('Status updated', row.subject);
      if (viewing?.id === row.id) setViewing({ ...viewing, status });
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('support_reports').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete report', error.message);
    else toast.success('Report deleted', deleting.subject);
    setDeleting(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Support Reports"
        subtitle="Bug reports and suggestions submitted by users across schools."
        icon={LifeBuoy}
      />

      <div className="mb-4 max-w-xs">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
        </Select>
      </div>

      {loading ? (
        <Spinner label="Loading reports..." />
      ) : filtered.length ? (
        <div className="space-y-3">
          {filtered.map((row) => (
            <Card key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${row.report_type === 'bug' ? 'bg-rose-50 text-rose-600' : 'bg-amber-500/10 text-accent-600'}`}>
                  {row.report_type === 'bug' ? <Bug className="h-5 w-5" aria-hidden="true" /> : <Lightbulb className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{row.subject}</p>
                  <p className="text-xs text-slate-400">
                    {row.reporter_name || 'Unknown'} · {row.reporter_email || '-'} · {formatDateTime(row.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={row.report_type === 'bug' ? 'red' : 'amber'}>{row.report_type}</Badge>
                <Badge tone={STATUS_TONES[row.status] || 'slate'}>{row.status}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setViewing(row)}>
                  View
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Inbox} title="No support reports" message="Reports submitted from the dashboards will appear here." />
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.subject || 'Report'} size="md">
        {viewing ? (
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={viewing.report_type === 'bug' ? 'red' : 'amber'}>{viewing.report_type}</Badge>
              <Badge tone={STATUS_TONES[viewing.status] || 'slate'}>{viewing.status}</Badge>
              <Badge tone="slate">{viewing.reporter_name || 'Unknown'} · {viewing.reporter_email || '-'}</Badge>
            </div>
            {viewing.message ? <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{viewing.message}</p> : null}
            <p className="mt-3 text-xs text-slate-400">Submitted {formatDateTime(viewing.created_at)}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <span className="mr-1 text-sm font-semibold text-slate-600">Mark as:</span>
              {['new', 'in_progress', 'resolved'].map((s) => (
                <Button key={s} size="sm" variant={viewing.status === s ? 'primary' : 'secondary'} onClick={() => updateStatus(viewing, s)}>
                  {s.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete report?"
        message="This permanently removes the support report."
        confirmLabel="Delete"
      />
    </div>
  );
}