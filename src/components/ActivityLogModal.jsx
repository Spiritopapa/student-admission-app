import { useEffect, useState } from 'react';
import { Activity, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import { Modal, ConfirmDialog } from './ui-extras';
import { Spinner, EmptyState, Button } from './ui';
import { useToast } from '../context/ToastContext';

const ROLE_LABELS = { teacher: 'Teacher', accountant: 'Accountant', student: 'Student' };

/**
 * Shared activity-log viewer used from the Teachers, Accountants and Students
 * admin pages. Loads `staff_activities` (teacher / accountant) or
 * `student_activities` (student) for one person and offers a "Clear all logs"
 * action — mirroring the legacy admin Activity modals.
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {object|null} p.person - { id, display, sub, role } where
 *                                  role is 'teacher' | 'accountant' | 'student'
 * @param {function} p.onClose
 */
export default function ActivityLogModal({ open, person = null, onClose }) {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const source = () => {
    if (!person) return null;
    if (person.role === 'student') {
      return {
        table: 'student_activities',
        where: (q) => q.eq('student_id', person.id),
      };
    }
    return {
      table: 'staff_activities',
      where: (q) => q.eq('staff_id', person.id).eq('staff_type', person.role),
    };
  };

  const load = async () => {
    const src = source();
    if (!open || !src) return;
    setLoading(true);
    try {
      const q = supabase.from(src.table).select('*');
      src.where(q);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      setList(data || []);
    } catch (err) {
      toast.error('Could not load activities', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person]);

  const clearLogs = async () => {
    const src = source();
    if (!src) return;
    setClearing(true);
    try {
      const q = supabase.from(src.table).delete();
      src.where(q);
      const { error } = await q;
      if (error) throw new Error(error.message);
      setConfirmClear(false);
      setList([]);
      toast.success('Activity log cleared', `All logs for ${person?.display || 'this person'} were removed.`);
    } catch (err) {
      toast.error('Could not clear logs', err.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Activity log: ${person?.display || ''}`}
        subtitle={person ? `${ROLE_LABELS[person.role] || person.role}${person.sub ? ` · ${person.sub}` : ''}` : ''}
        size="lg"
        footer={
          list.length ? (
            <div className="flex w-full gap-2">
              <Button variant="danger" onClick={() => setConfirmClear(true)} className="flex-1">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Clear all logs
              </Button>
            </div>
          ) : null
        }
      >
        {loading ? (
          <Spinner label="Loading activities..." />
        ) : list.length ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {list.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{a.action}</p>
                  <p className="text-xs text-slate-400">
                    {a.entity_type || '-'} · {a.entity_details || '-'}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-slate-400">{formatDateTime(a.created_at)}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Activity} title="No activity logged" message="Nothing has been recorded for this person yet." />
        )}
      </Modal>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearLogs}
        loading={clearing}
        title="Clear activity log?"
        message={`This deletes every logged activity for ${person?.display || 'this person'}. This cannot be undone.`}
        confirmLabel="Clear all logs"
      />
    </>
  );
}