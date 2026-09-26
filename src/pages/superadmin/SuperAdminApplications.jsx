import { useEffect, useState } from 'react';
import { FileCheck2, Check, X, Trash2, Mail, Phone, MapPin } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';

const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };

export default function SuperAdminApplications() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    setLoading(true);
    let q = supabase.from('school_applications').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    q.then(({ data, error }) => {
      if (!error) setRows(data || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const setStatus = async (row, status) => {
    const { error } = await supabase.from('school_applications').update({ status }).eq('id', row.id);
    if (error) toast.error('Could not update application', error.message);
    else {
      toast.success(status === 'approved' ? 'Application approved' : 'Application rejected', row.school_name);
      load();
    }
  };

  return (
    <div>
      <PageHeader title="School Applications" subtitle="Schools that have asked to join the platform." icon={FileCheck2} />

      <div className="mb-5 flex gap-2">
        {['pending', 'all', 'approved', 'rejected'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-xl px-3.5 py-2 text-sm font-semibold capitalize transition-colors ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading applications..." />
      ) : rows.length ? (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[row.status] || 'amber'} className="capitalize">
                      {row.status}
                    </Badge>
                    <h3 className="text-base font-bold text-slate-800">{row.school_name}</h3>
                    <span className="text-xs text-slate-400">{formatDateTime(row.created_at)}</span>
                  </div>
                  <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <p className="flex items-center gap-2 text-slate-600">
                      <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      {row.admin_email}
                    </p>
                    <p className="flex items-center gap-2 text-slate-600">
                      <Phone className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      {row.admin_phone || 'No phone'}
                    </p>
                    <p className="flex items-center gap-2 text-slate-600">
                      <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      {row.location || 'No location'} · {row.school_type}
                    </p>
                    <p className="text-slate-600">
                      Population: {row.student_population || '-'} · Admin: {row.admin_name}
                    </p>
                  </div>
                  {row.message ? (
                    <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      {row.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {row.status === 'pending' ? (
                    <Button onClick={() => setStatus(row, 'approved')}>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Approve
                    </Button>
                  ) : null}
                  {row.status !== 'rejected' ? (
                    <Button variant="secondary" onClick={() => setStatus(row, 'rejected')}>
                      <X className="h-4 w-4" aria-hidden="true" />
                      Reject
                    </Button>
                  ) : null}
                  <Button variant="danger" onClick={() => setDeleting(row)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileCheck2}
          title="No applications"
          message={filter === 'pending' ? 'No applications are waiting for review right now.' : 'No applications match this filter.'}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const { error } = await supabase.from('school_applications').delete().eq('id', deleting.id);
          if (error) toast.error('Could not delete application', error.message);
          else toast.success('Application deleted', deleting.school_name);
          setDeleting(null);
          load();
        }}
        title="Delete application?"
        message={`This permanently removes the application from ${deleting?.school_name || 'this school'}. This cannot be undone.`}
      />
    </div>
  );
}