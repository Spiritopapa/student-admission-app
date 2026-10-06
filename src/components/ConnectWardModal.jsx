import { useState } from 'react';
import { Link2, CheckCircle2 } from 'lucide-react';
import { Button, Input } from './ui';
import { Modal, Alert } from './ui-extras';
import { useToast } from '../context/ToastContext';
import { linkWardToParent } from '../lib/queries';

/**
 * Connect-a-Ward modal for the parent dashboard.
 * Lets a parent link their account to a student by entering the Student ID.
 * On success it calls `onLinked()` (so the caller can reload its ward list),
 * then closes.
 */
export default function ConnectWardModal({ open, onClose, onLinked }) {
  const toast = useToast();
  const [studentId, setStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const reset = () => {
    setStudentId('');
    setError('');
    setDone(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const id = studentId.trim();
    if (!id) {
      setError('Enter your child’s Student ID (e.g. STU-ABC12).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await linkWardToParent(id);
      setBusy(false);
      setDone(true);
      toast.success('Ward connected', `${id} is now linked to your account.`);
    } catch (err) {
      setBusy(false);
      setError(err.message || 'Could not link the ward. Please try again.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect a ward"
      size="sm"
      footer={
        done ? (
          <Button
            onClick={() => {
              onLinked?.();
              close();
            }}
            className="w-full"
          >
            Done
          </Button>
        ) : (
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={close} className="flex-1">
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} className="flex-1">
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Link student
            </Button>
          </div>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-800">Ward connected successfully</p>
          <p className="text-xs text-slate-500">
            The student is now linked to your parent account. You can follow their progress from the dashboard.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Enter your child’s Student ID (printed on their admission letter / report card). The student will appear on your
            dashboard immediately.
          </p>
          {error ? (
            <Alert tone="error">{error}</Alert>
          ) : null}
          <Input
            label="Student ID *"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="e.g. STU-ABC12"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Tip: the Student ID is linked when the contact number on your profile matches the school’s record for that student.
            If it doesn’t link, ask the school to add you from their Parents screen.
          </p>
        </div>
      )}
    </Modal>
  );
}