import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Wallet, Award, CalendarCheck, Megaphone, GraduationCap, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStudentApplication } from '../../hooks/useSchool';
import { StatCard, Card, Spinner, EmptyState, Badge, PageHeader } from '../../components/ui';
import {
  fetchStudentFees,
  fetchStudentTransactions,
  fetchStudentReceipts,
  fetchStudentAttendance,
  fetchActiveAnnouncements,
  fetchExamsForStudent,
  fetchResultsForExam,
} from '../../lib/queries';
import { photoUrl } from '../../lib/storage';
import { cedi, buildStudentName, formatDate, getPerformanceLevel, termLabel } from '../../lib/format';
import { currentAcademicYear } from '../../lib/constants';

const fade = {
  hidden: { opacity: 0, y: 18 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.45, delay: i * 0.08 } }),
};

export default function StudentHome() {
  const { user } = useAuth();
  const { application, loading: appLoading } = useStudentApplication();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    const load = async () => {
      const studentId = application.student_id;
      const [fees, txs, , attendance, announcements, exams] = await Promise.all([
        fetchStudentFees(studentId),
        fetchStudentTransactions(studentId),
        fetchStudentReceipts(studentId),
        fetchStudentAttendance(studentId),
        fetchActiveAnnouncements(application.school_id),
        fetchExamsForStudent(application.school_id),
      ]);

      let performance = null;
      for (const exam of exams) {
        const results = await fetchResultsForExam(studentId, exam.id);
        if (results.length) {
          const avg =
            results.reduce((s, r) => s + Number(r.marks_obtained || 0), 0) / results.length;
          performance = { exam, average: Math.round(avg), level: getPerformanceLevel(avg) };
          break;
        }
      }

      const year = currentAcademicYear();
      const currentFee = fees.find((f) => f.academic_year === year) || fees[0];
      const totalPaid = txs.reduce((s, t) => s + Number(t.amount_paid || 0), 0);
      const balance = currentFee
        ? Number(currentFee.balance || currentFee.total_amount - currentFee.amount_paid) || 0
        : 0;

      const att = { present: 0, absent: 0 };
      attendance.forEach((r) => {
        if (r.status === 'present') att.present += 1;
        else att.absent += 1;
      });
      const attTotal = att.present + att.absent;
      const attPct = attTotal ? Math.round((att.present / attTotal) * 100) : 0;

      if (!cancelled) {
        setSummary({ fees, txs, announcements, performance, totalPaid, balance, attPct, att, currentFee });
      }
    };
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [application]);

  if (appLoading || (application && !summary)) return <Spinner label="Loading your dashboard..." />;

  if (!application) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Welcome to your student portal"
        message="No student record is linked to this account yet. Ask your Sub Administrator to confirm your admission, then sign out and back in."
      />
    );
  }

  const photo = application.student_photo_url ? photoUrl(application.student_photo_url) : null;
  const name = buildStudentName(application.first_name, application.middle_name, application.last_name);
  const latest = summary.announcements[0];

  return (
    <motion.div initial="hidden" animate="show" variants={fade}>
      <PageHeader
        title={`Hello, ${application.first_name || 'Student'}`}
        subtitle={summary.currentFee ? `${application.class_applying} - ${summary.currentFee.academic_year}` : application.class_applying}
        icon={GraduationCap}
        actions={
          <Link to="/dashboard/profile" className="btn-secondary">
            View profile
          </Link>
        }
      />

      <motion.div variants={fade} custom={1} className="relative mb-6 overflow-hidden rounded-3xl bg-blend p-6 text-white shadow-card sm:p-8">
        <div className="absolute inset-0 bg-blend-radial" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          {photo ? (
            <img src={photo} alt="Student" className="h-24 w-20 rounded-2xl object-cover ring-4 ring-white/25" />
          ) : (
            <span className="flex h-24 w-20 items-center justify-center rounded-2xl bg-white/20 text-2xl font-extrabold backdrop-blur">
              {name.charAt(0)}
            </span>
          )}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Student ID</p>
            <p className="mt-0.5 font-mono text-sm font-bold">{application.student_id}</p>
            <h2 className="mt-2 text-2xl font-extrabold">{name}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="bg-white/20 text-white ring-white/30">{application.class_applying}</Badge>
              <Badge className="bg-white/20 text-white ring-white/30">
                {termLabel(summary.currentFee?.term || 'First')}
              </Badge>
              <Badge className="bg-white/20 text-white ring-white/30">
                {application.status === 'admitted' ? 'Admitted' : 'Pending'}
              </Badge>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="blue" label="Fee balance" value={cedi(summary.balance)} sub={`${summary.txs.length} payments recorded`} />
        <StatCard icon={CalendarCheck} tone="teal" label="Attendance" value={summary.attTotal ? `${summary.attPct}%` : '-'} sub={`${summary.att.present} present / ${summary.att.absent} absent`} />
        <StatCard icon={Award} tone="amber" label="Latest average" value={summary.performance ? `${summary.performance.average}%` : '-'} sub={summary.performance?.level?.text || 'No results yet'} />
        <StatCard icon={Megaphone} tone="green" label="Announcements" value={summary.announcements.length} sub="Live updates from your school" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <motion.div variants={fade} custom={2} className="lg:col-span-2">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Wallet className="h-4 w-4 text-brand-600" aria-hidden="true" />
              Fee details
            </h3>
            {summary.fees.length ? (
              <div className="mt-4 space-y-3">
                {summary.fees.slice(0, 4).map((fee) => (
                  <div key={fee.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {fee.academic_year} - {termLabel(fee.term)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Paid {cedi(fee.amount_paid)} of {cedi(fee.total_amount)}
                      </p>
                    </div>
                    <span
                      className={`badge ${
                        fee.payment_status === 'paid'
                          ? 'bg-emerald-50 text-emerald-700'
                          : fee.payment_status === 'partial'
                            ? 'bg-accent-500/10 text-accent-600'
                            : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {fee.payment_status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">No fee records available yet.</p>
            )}
            <Link to="/dashboard/fees" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
              View full fee details
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Card>
        </motion.div>

        <motion.div variants={fade} custom={3}>
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Megaphone className="h-4 w-4 text-teal-600" aria-hidden="true" />
              Latest announcement
            </h3>
            {latest ? (
              <div className="mt-4">
                <span
                  className={`badge ${
                    latest.priority === 'urgent'
                      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                      : latest.priority === 'high'
                        ? 'bg-accent-500/10 text-accent-600 ring-1 ring-accent-500/30'
                        : 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                  }`}
                >
                  {latest.priority}
                </span>
                <p className="mt-2 text-sm font-bold text-slate-800">{latest.title}</p>
                <p className="mt-1 line-clamp-3 text-sm text-slate-500">{latest.content}</p>
                <p className="mt-2 text-xs text-slate-400">{formatDate(latest.created_at)}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">Nothing new right now.</p>
            )}
            <Link to="/dashboard/announcements" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-600 hover:text-teal-700">
              View all
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}