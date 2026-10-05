import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, BookOpen, UserRound, Wallet, LayoutDashboard, ArrowRight,
  RefreshCw, Clock, CheckCircle2, CalendarCheck, Bus, TrendingUp,
} from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, Badge, StatCard, Button } from '../../components/ui';
import { Modal } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName, cedi, formatDate } from '../../lib/format';
import { photoUrl } from '../../lib/storage';
import { currentAcademicYear } from '../../lib/constants';

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(numerator, denominator) {
  const denom = Number(denominator);
  if (!(denom > 0)) return '0%';
  const num = Math.max(Number(numerator) || 0, 0);
  const display = Math.round((num / denom) * 1000) / 10;
  return `${Number.isInteger(display) ? display : display.toFixed(1)}%`;
}

function sumAmount(rows, key) {
  return (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

// Total / Collected / Outstanding horizontal bar row used inside the
// "Fees by Class" chart. Bars scale against the largest value in the chart.
function BarRow({ label, value, max, color }) {
  const w = max > 0 ? (Number(value) || 0) / max : 0;
  const widthPct = Math.min(w * 100, 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-slate-400">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full ${color}`}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-[11px] font-semibold text-slate-600">
        GHC {fmtMoney(value)}
      </span>
    </div>
  );
}

// Student population stacked bar (Male + Female segments) per class.
function StudentPopulationChart({ population }) {
  if (!population.length) {
    return <p className="text-sm text-slate-400">No students yet. Admit your first student to see the population breakdown.</p>;
  }
  const maxCount = Math.max(...population.map((p) => p.total), 1);
  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden="true" />
          Male
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-pink-400" aria-hidden="true" />
          Female
        </span>
        <span className="ml-auto font-semibold text-slate-500">Total</span>
      </div>
      <div className="mt-4 space-y-3">
        {population.map((p) => {
          const heightPct = Math.max((p.total / maxCount) * 100, p.total > 0 ? 6 : 0);
          const maleFlex = p.male || 0.5;
          const femaleFlex = p.female || 0.5;
          return (
            <div key={p.className} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-right text-xs font-medium text-slate-500" title={p.className}>
                {p.className}
              </span>
              <div className="h-6 flex-1 overflow-hidden rounded-lg bg-slate-100" title={`${p.male || 0} male · ${p.female || 0} female`}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${heightPct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="flex h-full"
                >
                  <div className="h-full bg-brand-500/80" style={{ flex: maleFlex }} title={`${p.male || 0} male`} />
                  <div className="h-full bg-pink-400/80" style={{ flex: femaleFlex }} title={`${p.female || 0} female`} />
                </motion.div>
              </div>
              <span className="w-32 shrink-0 text-right text-xs tabular-nums">
                <span className="font-bold text-brand-600">M {p.male || 0}</span>
                <span className="mx-1 text-slate-300">·</span>
                <span className="font-bold text-pink-500">F {p.female || 0}</span>
                <span className="mx-1 text-slate-300">·</span>
                <span className="font-bold text-slate-700">{p.total}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// Fees by Class: for each class show Total expected / Collected / Outstanding
// grouped bars so the admin can compare collection health across classes.
function FeesByClassChart({ rows }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">No fee data yet. Set the fee structure in the Fees module to see it here.</p>;
  }
  const maxValue = Math.max(
    ...rows.map((r) => Math.max(r.totalFees, r.collected, r.outstanding)),
    1
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" aria-hidden="true" />
          Total fees
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Collected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
          Outstanding
        </span>
      </div>
      <div className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
        {rows.map((r) => (
          <div key={r.className} className="rounded-xl border border-slate-100 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">{r.className}</span>
              <span className="text-xs text-slate-400">
                Collected <strong className="text-emerald-600">{pct(r.collected, r.totalFees)}</strong>
              </span>
            </div>
            <BarRow label="Total" value={r.totalFees} max={maxValue} color="bg-indigo-500" />
            <BarRow label="Collected" value={r.collected} max={maxValue} color="bg-emerald-500" />
            <BarRow label="Outstanding" value={r.outstanding} max={maxValue} color="bg-amber-500" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-slate-800',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    blue: 'text-brand-600',
  };
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold leading-tight ${tones[tone]}`}>{value}</p>
    </div>
  );
}

// Clickable Paid / Partial / Unpaid chips on the fee overview card. Tapping a
// chip opens the list of students whose aggregate balance falls in that status.
const STATUS_META = {
  paid: { label: 'Paid', toneCls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  partial: { label: 'Partial', toneCls: 'bg-accent-500/10 text-accent-600 ring-1 ring-accent-500/30' },
  unpaid: { label: 'Unpaid', toneCls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
};

export default function AdminHome() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Fee overview card: the status whose student list is currently open in the modal.
  const [statusModal, setStatusModal] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setRefreshing(true);
    try {
      const todayISO = new Date().toISOString().slice(0, 10);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);

      const [
        { data: students },
        { data: classes },
        { data: teachers },
        { data: fees },
        { data: attendance },
        { data: paymentsToday },
        { data: transportToday },
        { data: lockedRows },
      ] = await Promise.all([
        supabase
          .from('applications')
          .select('student_id, first_name, middle_name, last_name, class_applying, gender, status, portal_confirmed, student_photo_url, created_at')
          .eq('school_id', schoolId),
        supabase.from('classes').select('name').eq('school_id', schoolId).order('created_at', { ascending: true }),
        supabase.from('teachers').select('id').eq('school_id', schoolId),
        supabase
          .from('fees')
          .select('student_id, total_amount, amount_paid, debt, payment_status')
          .eq('school_id', schoolId),
        supabase.from('attendance').select('class_name, status').eq('date', todayISO).eq('school_id', schoolId),
        supabase
          .from('payment_transactions')
          .select('amount_paid')
          .gte('payment_date', dayStart.toISOString())
          .lte('payment_date', dayEnd.toISOString())
          .eq('school_id', schoolId),
        supabase
          .from('transport_fee_payments')
          .select('fee_amount')
          .eq('collection_date', todayISO)
          .eq('school_id', schoolId),
        supabase
          .from('school_modules')
          .select('module_name')
          .eq('school_id', schoolId)
          .eq('is_locked', true),
      ]);

      const studentsArr = students || [];
      const feesArr = fees || [];
      const classOrder = (classes || []).map((c) => c.name);
      const orderClasses = (names) => {
        const seen = new Set();
        const ordered = [];
        classOrder.forEach((n) => {
          if (names.includes(n) && !seen.has(n)) {
            ordered.push(n);
            seen.add(n);
          }
        });
        const rest = names.filter((n) => !seen.has(n)).sort((a, b) => a.localeCompare(b));
        return [...ordered, ...rest];
      };
// Student population by class, split by gender.
      const popMap = {};
      const studentClassMap = {};
      studentsArr.forEach((s) => {
        const cls = s.class_applying || 'Unassigned';
        if (!popMap[cls]) popMap[cls] = { total: 0, male: 0, female: 0 };
        popMap[cls].total += 1;
        if (s.gender === 'Female') popMap[cls].female += 1;
        else popMap[cls].male += 1;
        if (s.student_id) studentClassMap[s.student_id] = cls;
      });
      const population = orderClasses(Object.keys(popMap)).map((cls) => ({ className: cls, ...popMap[cls] }));

      // Fees aggregated across the whole school + per class. Classes with zero
      // fee records still appear so admins see all classes early in the year.
      const ensure = (map, cls) => {
        if (!map[cls]) map[cls] = { totalFees: 0, collected: 0, outstanding: 0 };
        return map[cls];
      };
      const feeClassMap = {};
      studentsArr.forEach((s) => {
        ensure(feeClassMap, s.class_applying || 'Unassigned');
      });
      let totalAmount = 0;
      let totalPaid = 0;
      feesArr.forEach((f) => {
        const total = (Number(f.total_amount) || 0) + (Number(f.debt) || 0);
        const paid = Number(f.amount_paid) || 0;
        totalAmount += total;
        totalPaid += paid;
        const cls = studentClassMap[f.student_id] || 'Unassigned';
        const row = ensure(feeClassMap, cls);
        row.totalFees += total;
        row.collected += paid;
        row.outstanding += Math.max(total - paid, 0);
      });

      // Per-student fee status (aggregated across every fee record of the
      // student): balance <= 0 -> paid, balance > 0 with something paid ->
      // partial, otherwise unpaid. These lists power the clickable Paid /
      // Partial / Unpaid chips on the fee overview card.
      const feeAgg = {};
      feesArr.forEach((f) => {
        const total = (Number(f.total_amount) || 0) + (Number(f.debt) || 0);
        const paid = Number(f.amount_paid) || 0;
        const g = feeAgg[f.student_id] || (feeAgg[f.student_id] = { total: 0, paid: 0 });
        g.total += Math.max(total, 0);
        g.paid += Math.max(paid, 0);
      });
      const feeStatusLists = { paid: [], partial: [], unpaid: [] };
      studentsArr.forEach((s) => {
        const g = feeAgg[s.student_id];
        if (!g) return; // no fees billed for this student yet
        const balance = Math.max(g.total - g.paid, 0);
        const status = balance <= 0 ? 'paid' : g.paid > 0 ? 'partial' : 'unpaid';
        feeStatusLists[status].push({
          id: s.id || s.student_id,
          name: buildStudentName(s.first_name, s.middle_name, s.last_name),
          student_id: s.student_id,
          classApp: s.class_applying || 'Unassigned',
          photo: s.student_photo_url ? photoUrl(s.student_photo_url) : null,
          initial: (s.first_name || 'S').charAt(0).toUpperCase(),
          balance,
        });
      });
      const feesByClass = orderClasses(Object.keys(feeClassMap)).map((cls) => ({
        className: cls,
        ...feeClassMap[cls],
      }));

      // Today's attendance per class (present / absent only).
      const attMap = {};
      (attendance || []).forEach((r) => {
        if (!r.class_name) return;
        if (!attMap[r.class_name]) attMap[r.class_name] = { class_name: r.class_name, present: 0, absent: 0 };
        if (r.status === 'present') attMap[r.class_name].present += 1;
        else if (r.status === 'absent') attMap[r.class_name].absent += 1;
      });
      const attendanceToday = Object.values(attMap).sort((a, b) => a.class_name.localeCompare(b.class_name));

      const locked = new Set((lockedRows || []).map((r) => r.module_name));

      setData({
        studentCount: studentsArr.length,
        admittedCount: studentsArr.filter((s) => s.status === 'admitted').length,
        portalPendingCount: studentsArr.filter((s) => !s.portal_confirmed).length,
        femaleCount: studentsArr.filter((s) => s.gender === 'Female').length,
        maleCount: studentsArr.filter((s) => s.gender === 'Male').length,
        teacherCount: (teachers || []).length,
        classCount: (classes || []).length,
        students: studentsArr,
        population,
        feeStats: {
          totalAmount,
          totalPaid,
          totalBalance: Math.max(totalAmount - totalPaid, 0),
          paidCount: feeStatusLists.paid.length,
          partialCount: feeStatusLists.partial.length,
          unpaidCount: feeStatusLists.unpaid.length,
        },
        feeStatusLists,
        feesByClass,
        schoolFeesToday: sumAmount(paymentsToday, 'amount_paid'),
        transportToday: sumAmount(transportToday, 'fee_amount'),
        attendanceToday,
        lockedModules: locked,
      });
    } catch (err) {
      console.warn('Dashboard load error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (schoolId) load();
  }, [schoolId, load]);

  if (!schoolId) return <Spinner label="Loading school..." />;
  if (!data) return <Spinner label="Loading your dashboard..." />;

  const recent = data.students.slice(0, 6);
  const showFees = !data.lockedModules.has('fees');
  const showAttendance = !data.lockedModules.has('attendance');
  const { feeStats } = data;
  const collectionRate = pct(feeStats.totalPaid, feeStats.totalAmount);
  const collectionPct = feeStats.totalAmount > 0 ? Math.min((feeStats.totalPaid / feeStats.totalAmount) * 100, 100) : 0;
return (
    <div>
      <PageHeader
        title={settings?.school_name || 'School Dashboard'}
        subtitle={`Academic year ${currentAcademicYear()} - ${settings?.current_term || 'First'} Term · ${data.classCount} classes`}
        icon={LayoutDashboard}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={load} loading={refreshing}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
            <Link to="/admin/students" className="btn-primary">
              <Users className="h-4 w-4" aria-hidden="true" />
              Manage students
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} tone="blue" label="Students" value={data.studentCount} sub={`${data.admittedCount} admitted`} index={0} />
        <StatCard icon={CheckCircle2} tone="green" label="Admitted" value={data.admittedCount} sub="Currently enrolled" index={1} />
        <StatCard icon={Clock} tone="amber" label="Awaiting portal" value={data.portalPendingCount} sub="Not yet confirmed" index={2} />
        <StatCard icon={Users} tone="red" label="Female" value={data.femaleCount} sub="Students" index={3} />
        <StatCard icon={UserRound} tone="teal" label="Male" value={data.maleCount} sub="Students" index={4} />
        <StatCard icon={BookOpen} tone="slate" label="Teachers" value={data.teacherCount} sub="Teaching staff" index={5} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Student population by class</h3>
            <Link to="/admin/classes" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
              Classes
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-1 text-xs text-slate-400">Enrolment across classes, split by gender.</p>
          <div className="mt-4">
            <StudentPopulationChart population={data.population} />
          </div>
        </Card>

        {showFees ? (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <Wallet className="h-4 w-4 text-accent-500" aria-hidden="true" />
                Fee overview
              </h3>
              <Link to="/admin/fees" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                Fees
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniStat label="Total expected" value={cedi(Math.round(feeStats.totalAmount))} />
              <MiniStat label="Collected" value={cedi(Math.round(feeStats.totalPaid))} tone="green" />
              <MiniStat label="Outstanding" value={cedi(Math.round(feeStats.totalBalance))} tone="amber" />
              <MiniStat label="Collection rate" value={collectionRate} tone="blue" />
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Overall collection progress</span>
                <span className="font-semibold text-slate-600">{collectionRate}</span>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${collectionPct}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex flex-wrap gap-2 text-xs">
                {(['paid', 'partial', 'unpaid']).map((key) => {
                  const meta = STATUS_META[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusModal(key)}
                      className={`badge cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${meta.toneCls}`}
                      title={`View all ${meta.label} students`}
                    >
                      {feeStats[`${key}Count`]} {meta.label.toLowerCase()}
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">Click a status to open the list of students.</p>
            </div>

            <div className="mt-4 space-y-2 border-t border-slate-50 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                  School fees collected today
                </span>
                <span className="font-bold text-emerald-600">{cedi(Math.round(data.schoolFeesToday))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Bus className="h-3.5 w-3.5 text-cyan-500" aria-hidden="true" />
                  Transport collected today
                </span>
                <span className="font-bold text-cyan-600">{cedi(Math.round(data.transportToday))}</span>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-800">Fee overview</h3>
            <p className="mt-2 text-sm text-slate-400">The fees module is currently locked for this school.</p>
          </Card>
        )}
      </div>
<div className="mt-6 grid gap-6 lg:grid-cols-2">
        {showFees ? (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <TrendingUp className="h-4 w-4 text-brand-500" aria-hidden="true" />
                Fees by class
              </h3>
              <Link to="/admin/fees" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                Fees
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-1 text-xs text-slate-400">Total, collected and outstanding fees per class.</p>
            <div className="mt-4">
              <FeesByClassChart rows={data.feesByClass} />
            </div>
          </Card>
        ) : null}

        {showAttendance ? (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <CalendarCheck className="h-4 w-4 text-teal-500" aria-hidden="true" />
                Attendance today
              </h3>
              <Link to="/admin/attendance" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                Attendance
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-1 text-xs text-slate-400">Present vs absent per class for today.</p>
            <div className="mt-4">
              {data.attendanceToday.length ? (
                <div className="space-y-3">
                  {data.attendanceToday.map((a) => {
                    const total = a.present + a.absent;
                    const presentPct = total > 0 ? (a.present / total) * 100 : 0;
                    return (
                      <div key={a.class_name}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">{a.class_name}</span>
                          <span className="text-slate-400">
                            <span className="font-bold text-emerald-600">{a.present} present</span> · {a.absent} absent
                          </span>
                        </div>
                        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${presentPct}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No attendance marked yet for today.</p>
              )}
            </div>
          </Card>
        ) : null}

        {!showFees && !showAttendance ? (
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-800">Analytics</h3>
            <p className="mt-2 text-sm text-slate-400">
              Fee and attendance charts are hidden because those modules are locked for this school.
            </p>
          </Card>
        ) : null}
      </div>
<div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Recent students</h3>
            <Link to="/admin/students" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          {recent.length ? (
            <div className="mt-4 divide-y divide-slate-50">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2.5">
                  {s.student_photo_url ? (
                    <img src={photoUrl(s.student_photo_url)} alt="Student" className="img-zoom h-10 w-10 rounded-lg object-cover ring-1 ring-slate-100" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                      {(s.first_name || 'S').charAt(0)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.class_applying} · {formatDate(s.created_at)}
                    </p>
                  </div>
                  <Badge tone={s.status === 'admitted' ? 'green' : 'amber'}>{s.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No students yet. Admit your first student to get started.</p>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-bold text-slate-800">Quick actions</h3>
          <div className="mt-4 space-y-2">
            <Link to="/admin/students" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <Users className="h-4 w-4 text-brand-500" aria-hidden="true" />
              Admit a student
            </Link>
            <Link to="/admin/classes" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <BookOpen className="h-4 w-4 text-teal-500" aria-hidden="true" />
              Manage classes
            </Link>
            <Link to="/admin/teachers" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <UserRound className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              Add staff
            </Link>
            <Link to="/admin/fees" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700">
              <Wallet className="h-4 w-4 text-accent-500" aria-hidden="true" />
              Fee structure
            </Link>
          </div>
        </div>
      </div>

      <Modal
        open={!!statusModal}
        onClose={() => setStatusModal(null)}
        size="md"
        title={
          statusModal
            ? `${STATUS_META[statusModal].label} students (${data.feeStatusLists[statusModal].length})`
            : ''
        }
        footer={
          <Link
            to="/admin/fees"
            onClick={() => setStatusModal(null)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-soft transition-colors hover:bg-brand-700"
          >
            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
            Open fees module
          </Link>
        }
      >
        {statusModal ? (
          data.feeStatusLists[statusModal].length ? (
            <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {data.feeStatusLists[statusModal].map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2.5">
                  {s.photo ? (
                    <img
                      src={s.photo}
                      alt="Student"
                      className="img-zoom h-11 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-100"
                    />
                  ) : (
                    <span className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                      {s.initial}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {s.student_id} · {s.classApp}
                    </p>
                  </div>
                  <span className={`badge shrink-0 ${STATUS_META[statusModal].toneCls}`} title="Outstanding balance">
                    {statusModal === 'paid' ? 'Cleared' : cedi(Math.round(s.balance))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No students in this fee status yet.</p>
          )
        ) : null}
      </Modal>
    </div>
  );
}