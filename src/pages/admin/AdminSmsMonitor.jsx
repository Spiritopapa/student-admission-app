import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Send, XCircle, RotateCw, RefreshCw, Eye } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { Modal } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';

export default function AdminSmsMonitor() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [logs, setLogs] = useState([]);
  const [studentMap, setStudentMap] = useState({});
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // all | sent | failed
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);
  const [resendBusy, setResendBusy] = useState(null);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: school }, { data: rows }] = await Promise.all([
        supabase.from('schools').select('sms_enabled, name').eq('id', schoolId).maybeSingle(),
        supabase.from('sms_logs').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(200),
      ]);
      setSmsEnabled(school?.sms_enabled !== false);
      const list = rows || [];
      const ids = [...new Set(list.map((l) => l.student_id).filter(Boolean))];
      let map = {};
      if (ids.length) {
        const { data: apps } = await supabase
          .from('applications')
          .select('student_id, first_name, middle_name, last_name')
          .in('student_id', ids);
        map = Object.fromEntries((apps || []).map((a) => [a.student_id, a]));
      }
      setLogs(list);
      setStudentMap(map);
    } catch (err) {
      toast.error('Could not load SMS logs', err.message);
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
    return logs.filter((l) => {
      if (tab === 'sent' && !l.success) return false;
      if (tab === 'failed' && l.success) return false;
      if (q) {
        const app = studentMap[l.student_id];
        const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : '';
        const hay = `${l.recipient || ''} ${l.receipt_number || ''} ${l.message || ''} ${name} ${l.error || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, tab, query, studentMap]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = logs.filter((l) => l.success && (l.created_at || '').slice(0, 10) === today).length;
    return {
      total: logs.length,
      sent: logs.filter((l) => l.success).length,
      failed: logs.filter((l) => !l.success).length,
      sentToday,
    };
  }, [logs]);

  const resend = async (log) => {
    if (!smsEnabled) {
      toast.error('SMS disabled', 'The Super Admin has disabled SMS for this school.');
      return;
    }
    setResendBusy(log.id);
    try {
      const res = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: log.recipient, message: log.message || '' }),
      });
      const resp = await res.json().catch(() => null);
      const success = Boolean(resp && resp.success);
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('sms_logs').insert({
        school_id: schoolId || log.school_id || null,
        student_id: log.student_id || null,
        receipt_number: log.receipt_number || null,
        recipient: log.recipient || null,
        message: log.message || null,
        sender_id: (resp && resp.sender_id) || log.sender_id || null,
        status: (resp && resp.status) || null,
        success,
        provider_response: (resp && resp.providerRaw) || null,
        error: success ? null : ((resp && (resp.error || resp.message)) || 'Gateway error'),
        created_by: user?.id || null,
      });
      toast[success ? 'success' : 'error'](success ? 'SMS resent' : 'Resend failed', success ? `Sent to ${log.recipient}` : 'See the new row in the list.');
      if (detail && detail.id === log.id) setDetail(null);
      load();
    } catch (err) {
      toast.error('Resend error', err.message);
    } finally {
      setResendBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="SMS Monitoring"
        subtitle="Audit trail of every SMS sent through the school gateway."
        icon={MessageSquare}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={smsEnabled ? 'green' : 'red'}>{smsEnabled ? 'SMS enabled' : 'SMS disabled for this school'}</Badge>
        <Badge tone="slate">{stats.total} total</Badge>
        <Badge tone="green">{stats.sent} sent</Badge>
        <Badge tone="red">{stats.failed} failed</Badge>
        <Badge tone="blue">{stats.sentToday} sent today</Badge>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {[
            { value: 'all', label: 'All' },
            { value: 'sent', label: 'Sent' },
            { value: 'failed', label: 'Failed/Unsent' },
          ].map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-full sm:max-w-xs">
          <SearchInput value={query} onChange={setQuery} placeholder="Search phone, receipt, student..." />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading SMS logs..." />
      ) : filtered.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filtered.map((log) => {
              const app = studentMap[log.student_id];
              const name = app ? [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ') : '';
              return (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${log.success ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {log.success ? <Send className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{name || log.recipient || 'Unknown recipient'}</p>
                    <p className="truncate text-xs text-slate-400">
                      {log.recipient || '—'} · {log.receipt_number ? `Receipt ${log.receipt_number} · ` : ''}
                      {formatDateTime(log.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {log.success ? <Badge tone="green">Sent</Badge> : <Badge tone="red">{log.error ? 'Failed' : 'Unsent'}</Badge>}
                    <button type="button" onClick={() => setDetail(log)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="View SMS detail">
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {!log.success ? (
                      <Button size="sm" variant="secondary" onClick={() => resend(log)} loading={resendBusy === log.id} disabled={resendBusy !== null}>
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Resend
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <EmptyState icon={MessageSquare} title="No SMS logs" message="SMS logs appear here when receipts are issued with parent SMS notifications." />
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title="SMS details" size="md">
        {detail ? (
          <div className="space-y-3 text-sm">
            <Row label="Recipient" value={detail.recipient || '-'} />
            {studentMap[detail.student_id] ? (
              <Row label="Student" value={[studentMap[detail.student_id].first_name, studentMap[detail.student_id].middle_name, studentMap[detail.student_id].last_name].filter(Boolean).join(' ')} />
            ) : null}
            <Row label="Receipt" value={detail.receipt_number || '-'} />
            <Row label="Status" value={detail.status || (detail.success ? 'sent' : 'failed')} />
            <Row label="Sender ID" value={detail.sender_id || '-'} />
            <Row label="Sent at" value={formatDateTime(detail.created_at)} />
            {detail.message ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Message</p>
                <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-slate-700">{detail.message}</p>
              </div>
            ) : null}
            {detail.error ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Error</p>
                <p className="mt-1 rounded-xl bg-rose-50 px-3 py-2 text-rose-700">{detail.error}</p>
              </div>
            ) : null}
            {detail.provider_response ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Provider response</p>
                <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-slate-700">{detail.provider_response}</p>
              </div>
            ) : null}
            {!detail.success ? (
              <Button onClick={() => resend(detail)} loading={resendBusy === detail.id} className="w-full">
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                Resend SMS
              </Button>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-right font-semibold text-slate-700">{value}</p>
    </div>
  );
}