import { useState } from 'react';
import { DatabaseBackup, Download, Upload, ShieldAlert } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Spinner } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';

const BACKUP_TABLES = [
  'applications',
  'teachers',
  'accountants',
  'classes',
  'subjects',
  'class_fees',
  'fees',
  'receipts',
  'payment_transactions',
  'attendance',
  'announcements',
  'exams',
  'exam_subjects',
  'exam_results',
  'exam_student_details',
  'assessment_questions',
  'assessments',
  'income_expense_categories',
  'income_expenses',
  'transport_routes',
  'transport_enrollments',
  'transport_fee_payments',
  'grading_systems',
  'school_settings',
  'parent_links',
];

export default function AdminBackupRestore() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [files, setFiles] = useState(null);
  const [preview, setPreview] = useState(null);

  const doExport = async () => {
    if (!schoolId) return;
    setExporting(true);
    try {
      const report = {};
      await Promise.all(
        BACKUP_TABLES.map(async (table) => {
          const { data } = await supabase.from(table).select('*').eq('school_id', schoolId);
          report[table] = data || [];
        })
      );
      const blob = new Blob(
        [JSON.stringify({ app: 'student-admission-portal', exported_at: new Date().toISOString(), school_id: schoolId, tables: report }, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `school_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded', `${Object.values(report).reduce((s, r) => s + r.length, 0)} records exported.`);
    } catch (err) {
      toast.error('Could not export backup', err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleFile = (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setFiles(file);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.tables || typeof parsed.tables !== 'object') {
          throw new Error('Not a valid backup file');
        }
        const counts = Object.entries(parsed.tables).map(([table, rows]) => ({ table, count: Array.isArray(rows) ? rows.length : 0 }));
        setPreview({ parsed, counts });
        toast.success('Backup loaded', `${counts.reduce((s, c) => s + c.count, 0)} records ready to restore.`);
      } catch (err) {
        setPreview(null);
        toast.error('Invalid backup file', err.message);
      }
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const { parsed } = preview;
      let restored = 0;
      for (const [table, rows] of Object.entries(parsed.tables)) {
        if (!BACKUP_TABLES.includes(table) || !Array.isArray(rows) || !rows.length) continue;
        const scoped = rows.map((r) => ({ ...r, school_id: schoolId }));
        const { error } = await supabase.from(table).upsert(scoped);
        if (error) throw new Error(`${table}: ${error.message}`);
        restored += rows.length;
      }
      toast.success('Backup restored', `${restored} records restored to this school.`);
      setPreview(null);
      setFiles(null);
    } catch (err) {
      toast.error('Could not restore backup', err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Backup & Restore"
        subtitle="Download a full copy of your school data, or restore a previous backup."
        icon={DatabaseBackup}
      />

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <DatabaseBackup className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-800">Download backup</h2>
            <p className="text-sm text-slate-500">Exports all school records as a JSON file.</p>
          </div>
        </div>
        <Button onClick={doExport} loading={exporting} className="mt-5">
          <Download className="h-4 w-4" aria-hidden="true" />
          {exporting ? 'Exporting...' : 'Download backup'}
        </Button>
      </Card>

      <Card className="mt-6 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-accent-600">
            <Upload className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-800">Restore backup</h2>
            <p className="text-sm text-slate-500">Replaces existing records for the imported tables.</p>
          </div>
        </div>

        <label className="mt-5 block cursor-pointer rounded-xl border-2 border-dashed border-slate-200 p-6 text-center transition-colors hover:border-brand-300">
          <input type="file" accept="application/json" className="hidden" onChange={(e) => handleFile(e.target.files)} />
          {files ? (
            <span className="text-sm font-semibold text-brand-700">{files.name}</span>
          ) : (
            <span className="text-sm text-slate-500">Click to choose a backup JSON file</span>
          )}
        </label>

        {preview ? (
          <div className="mt-5">
            <Alert tone="warning" className="mb-4">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <b>Restoring replaces existing data.</b>{' '}
                  <span className="text-xs">Records for each table are upserted by ID. Table rows not present in the backup are left untouched.</span>
                </div>
              </div>
            </Alert>
            <div className="mb-5 flex flex-wrap gap-2">
              {preview.counts
                .filter((c) => c.count > 0)
                .map((c) => (
                  <span key={c.table} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {c.table}: {c.count}
                  </span>
                ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setPreview(null); setFiles(null); }} className="flex-1">
                Cancel
              </Button>
              <Button onClick={doImport} loading={importing} className="flex-1">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Restore data
              </Button>
            </div>
          </div>
        ) : null}

        {importing ? <Spinner label="Restoring data..." /> : null}
      </Card>
    </div>
  );
}