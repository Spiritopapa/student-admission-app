import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarRange,
  CalendarX2,
  Save,
  Printer,
  Sun,
  ListChecks,
  FileBarChart,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput } from '../../components/ui';
import { Alert } from '../../components/ui-extras';
import MonthlyAttendanceGrid from '../../components/MonthlyAttendanceGrid';
import { supabase } from '../../lib/supabase';
import { buildStudentName, formatDate, termLabel } from '../../lib/format';
import { photoUrl } from '../../lib/storage';
import { TERMS, currentAcademicYear } from '../../lib/constants';
import {
  EVENT_TYPE_LABELS,
  fetchEventDays,
  fetchSchoolName,
  fetchSchoolSettings,
  buildDateRange,
  buildEventDayMap,
  printMonthlyGrid,
  printReport,
  saveAttendanceBatch,
} from '../../lib/attendance';

const TABS = [
  { key: 'daily', label: 'Daily Register', icon: CalendarCheck },
  { key: 'monthly', label: '30-Day Register', icon: CalendarRange },
  { key: 'report', label: 'Reports', icon: FileBarChart },
  { key: 'events', label: 'Event Days', icon: Sun },
];

function dailyMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AdminAttendance() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [tab, setTab] = useState('daily');
  const [classes, setClasses] = useState([]);
  const [settings, setSettings] = useState(null);
  const [eventDays, setEventDays] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);

  // Daily register state
  const [className, setClassName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gender, setGender] = useState('');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});
  const [dailyLoading, setDailyLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 30-day register state
  const [mStart, setMStart] = useState(dailyMonthStart());
  const [mClass, setMClass] = useState('');
  const [mGender, setMGender] = useState('');
  const [monthlyCache, setMonthlyCache] = useState([]);
  const [monthlyDates, setMonthlyDates] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [busyStudentId, setBusyStudentId] = useState(null);

  // Report state
  const [repClass, setRepClass] = useState('');
  const [repGender, setRepGender] = useState('');
  const [repTerm, setRepTerm] = useState('');
  const [repFrom, setRepFrom] = useState('');
  const [repTo, setRepTo] = useState('');
  const [repSearch, setRepSearch] = useState('');
  const [repMode, setRepMode] = useState('summary');
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Event day inline form state
  const [eventForm, setEventForm] = useState({ date: new Date().toISOString().split('T')[0], event_type: 'holiday', label: '', notes: '' });
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState('');

  const eventDayMap = useMemo(() => buildEventDayMap(eventDays), [eventDays]);
  const currentEventDay = eventDayMap[date] || null;

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      setInitialLoading(true);
      try {
        const [classRows, settingsRows, days] = await Promise.all([
          supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
          fetchSchoolSettings(schoolId),
          fetchEventDays(schoolId),
        ]);
        setClasses(classRows.data || []);
        setSettings(settingsRows);
        setEventDays(days);
      } catch (err) {
        // ignore
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [schoolId]);

  const reloadEventDays = async () => {
    if (!schoolId) return;
    const days = await fetchEventDays(schoolId);
    setEventDays(days);
  };

  // ---------------- Daily register ----------------
  const loadDaily = async () => {
    if (!className || !date || !schoolId) return;
    setDailyLoading(true);
    try {
      const [studentRows, attRows] = await Promise.all([
        supabase
          .from('applications')
          .select('*')
          .eq('school_id', schoolId)
          .eq('class_applying', className)
          .eq('status', 'admitted')
          .order('last_name'),
        supabase.from('attendance').select('*').eq('class_name', className).eq('date', date).eq('school_id', schoolId),
      ]);
      setStudents(studentRows.data || []);
      setMarks(Object.fromEntries((attRows.data || []).map((r) => [r.student_id, r.status])));
    } catch (err) {
      toast.error('Could not load attendance', err.message);
    } finally {
      setDailyLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'daily') return;
    loadDaily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, className, date, schoolId]);
const saveDaily = async () => {
    if (!className || !students.length) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = visibleStudents.map((s) => ({
        student_id: s.student_id,
        date,
        status: marks[s.student_id] === 'absent' ? 'absent' : 'present',
        class_name: className,
        academic_year: settings?.academic_year || currentAcademicYear(),
        term: settings?.current_term || 'First',
        remarks: '',
        marked_by: user?.id || null,
        school_id: schoolId,
      }));
      const res = await saveAttendanceBatch({ rows, schoolId });
      toast.success('Attendance saved', `${res.saved} new, ${res.updated} updated.`);
    } catch (err) {
      toast.error('Could not save attendance', err.message);
    } finally {
      setSaving(false);
    }
  };

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (gender && s.gender !== gender) return false;
      if (!q) return true;
      const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
      return name.includes(q) || s.student_id.toLowerCase().includes(q);
    });
  }, [students, gender, search]);

  const presentCount = visibleStudents.filter((s) => (marks[s.student_id] || 'present') === 'present').length;
  const hasExisting = visibleStudents.some((s) => marks[s.student_id] !== undefined);

  // ---------------- 30-day register ----------------
  const loadMonthly = async () => {
    if (!mStart || !mClass || !schoolId) return;
    setMonthlyLoading(true);
    try {
      const dates = buildDateRange(mStart, 30);
      const [settingsRows, studentRows, attRows] = await Promise.all([
        fetchSchoolSettings(schoolId),
        supabase
          .from('applications')
          .select('student_id, first_name, middle_name, last_name, class_applying, gender')
          .eq('school_id', schoolId)
          .eq('class_applying', mClass)
          .eq('status', 'admitted')
          .order('first_name'),
        supabase
          .from('attendance')
          .select('*')
          .eq('school_id', schoolId)
          .eq('class_name', mClass)
          .gte('date', dates[0])
          .lte('date', dates[dates.length - 1]),
      ]);
      const yearTerm = settingsRows;
      const attMap = {};
      (attRows.data || []).forEach((r) => {
        if (!attMap[r.student_id]) attMap[r.student_id] = {};
        attMap[r.student_id][r.date] = r.status;
      });
      const cache = (studentRows.data || [])
        .map((s) => {
          const days = {};
          const studentAtt = attMap[s.student_id] || {};
          dates.forEach((d) => {
            days[d] = studentAtt[d] || 'unmarked';
          });
          return {
            student_id: s.student_id,
            name: buildStudentName(s.first_name, s.middle_name, s.last_name),
            class_applying: s.class_applying,
            academic_year: yearTerm.academic_year,
            term: yearTerm.current_term,
            days,
          };
        })
        .filter((s) => !mGender || s.gender === mGender);
      setMonthlyCache(cache);
      setMonthlyDates(dates);
    } catch (err) {
      toast.error('Could not load 30-day register', err.message);
    } finally {
      setMonthlyLoading(false);
    }
  };
const toggleMonthlyCell = (studentId, dateStr) => {
    setMonthlyCache((prev) =>
      prev.map((s) => {
        if (s.student_id !== studentId) return s;
        const order = ['unmarked', 'present', 'absent'];
        const next = order[(order.indexOf(s.days[dateStr] || 'unmarked') + 1) % 3];
        return { ...s, days: { ...s.days, [dateStr]: next } };
      })
    );
  };

  const toggleMonthlyDay = (dateStr) => {
    setMonthlyCache((prev) => {
      const allPresent = prev.length > 0 && prev.every((s) => (s.days[dateStr] || 'unmarked') === 'present');
      const status = allPresent ? 'absent' : 'present';
      return prev.map((s) => ({ ...s, days: { ...s.days, [dateStr]: status } }));
    });
  };

  const setAllMonthly = (status) => {
    if (!monthlyDates.length) return;
    setMonthlyCache((prev) =>
      prev.map((s) => {
        const days = { ...s.days };
        monthlyDates.forEach((d) => {
          days[d] = status;
        });
        return { ...s, days };
      })
    );
  };

  const resetMonthly = () => {
    if (!monthlyDates.length) return;
    if (!window.confirm('Are you sure you want to reset all attendance markings? This will clear all cells.')) return;
    setMonthlyCache((prev) =>
      prev.map((s) => {
        const days = { ...s.days };
        monthlyDates.forEach((d) => {
          days[d] = 'unmarked';
        });
        return { ...s, days };
      })
    );
  };

  const saveMonthlyAll = async () => {
    if (!monthlyCache.length) return;
    setMonthlyBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = [];
      const unmarkedKeys = [];
      monthlyCache.forEach((s) => {
        monthlyDates.forEach((d) => {
          const status = s.days[d] || 'unmarked';
          if (status === 'unmarked') {
            unmarkedKeys.push(`${s.student_id}|${d}`);
            return;
          }
          rows.push({
            student_id: s.student_id,
            date: d,
            status,
            class_name: s.class_applying,
            academic_year: s.academic_year,
            term: s.term,
            remarks: '',
            marked_by: user?.id || null,
            school_id: schoolId,
          });
        });
      });
      const res = await saveAttendanceBatch({ rows, unmarkedKeys, schoolId });
      const parts = [];
      if (res.saved) parts.push(`${res.saved} new`);
      if (res.updated) parts.push(`${res.updated} updated`);
      if (res.deleted) parts.push(`${res.deleted} removed`);
      toast.success('30-Day attendance saved', parts.join(', ') || 'No changes');
    } catch (err) {
      toast.error('Could not save 30-day attendance', err.message);
    } finally {
      setMonthlyBusy(false);
    }
  };

  const saveMonthlyStudent = async (studentId) => {
    const student = monthlyCache.find((s) => s.student_id === studentId);
    if (!student) return;
    setBusyStudentId(studentId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = [];
      const unmarkedKeys = [];
      monthlyDates.forEach((d) => {
        const status = student.days[d] || 'unmarked';
        if (status === 'unmarked') {
          unmarkedKeys.push(`${student.student_id}|${d}`);
          return;
        }
        rows.push({
          student_id: student.student_id,
          date: d,
          status,
          class_name: student.class_applying,
          academic_year: student.academic_year,
          term: student.term,
          remarks: '',
          marked_by: user?.id || null,
          school_id: schoolId,
        });
      });
      const res = await saveAttendanceBatch({ rows, unmarkedKeys, schoolId });
      toast.success(`Saved ${student.name}`, `${res.saved} new, ${res.updated} updated, ${res.deleted} removed.`);
    } catch (err) {
      toast.error('Could not save student attendance', err.message);
    } finally {
      setBusyStudentId(null);
    }
  };

  const printMonthly = async () => {
    if (!monthlyCache.length) return;
    const name = await fetchSchoolName(schoolId);
    printMonthlyGrid({
      schoolName: name,
      startDate: mStart,
      classFilter: mClass,
      gender: mGender,
      dates: monthlyDates,
      rows: monthlyCache,
      eventDays,
    });
  };
// ---------------- Reports ----------------
  const loadReport = async () => {
    if (!schoolId) return;
    setReportLoading(true);
    try {
      const yearTerm = await fetchSchoolSettings(schoolId);
      let q = supabase.from('attendance').select('*').eq('academic_year', yearTerm.academic_year);
      if (schoolId) q = q.eq('school_id', schoolId);
      if (repTerm) q = q.eq('term', repTerm);
      if (repFrom) q = q.gte('date', repFrom);
      if (repTo) q = q.lte('date', repTo);
      q = q.order('date', { ascending: false }).order('student_id', { ascending: true });
      const { data: attRecords, error } = await q;
      if (error) throw new Error(error.message);
      if (!attRecords || attRecords.length === 0) {
        setReportData({ records: [], appMap: new Map(), yearTerm });
        return;
      }
      const studentIds = [...new Set(attRecords.map((r) => r.student_id))];
      let appsQ = supabase
        .from('applications')
        .select('student_id, first_name, middle_name, last_name, class_applying, gender')
        .in('student_id', studentIds);
      if (schoolId) appsQ = appsQ.eq('school_id', schoolId);
      if (repClass) appsQ = appsQ.eq('class_applying', repClass);
      const { data: apps } = await appsQ;
      const appMap = new Map((apps || []).map((a) => [a.student_id, a]));

      const qLower = repSearch.trim().toLowerCase();
      const filtered = attRecords.filter((r) => {
        const app = appMap.get(r.student_id);
        if (repClass && app?.class_applying !== repClass && r.class_name !== repClass) return false;
        if (repGender && (app?.gender || 'Male') !== repGender) return false;
        if (qLower) {
          const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id;
          if (!name.toLowerCase().includes(qLower) && !r.student_id.toLowerCase().includes(qLower)) return false;
        }
        return true;
      });
      setReportData({ records: filtered, appMap, yearTerm });
    } catch (err) {
      toast.error('Could not load the report', err.message);
    } finally {
      setReportLoading(false);
    }
  };

  const reportSummaryRows = useMemo(() => {
    if (!reportData) return [];
    const byStudent = {};
    reportData.records.forEach((r) => {
      if (!byStudent[r.student_id]) byStudent[r.student_id] = { total: 0, present: 0, absent: 0 };
      byStudent[r.student_id].total += 1;
      byStudent[r.student_id][r.status] += 1;
    });
    return Object.entries(byStudent)
      .map(([sid, stats]) => {
        const app = reportData.appMap.get(sid);
        return {
          sid,
          name: app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : sid,
          class: app?.class_applying || '',
          ...stats,
          pct: stats.total ? Math.round((stats.present / stats.total) * 100) : 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [reportData]);

  const reportDailyRows = useMemo(() => {
    if (!reportData) return [];
    const byDate = {};
    reportData.records.forEach((r) => {
      if (!byDate[r.date]) byDate[r.date] = { present: 0, absent: 0 };
      byDate[r.date][r.status] += 1;
    });
    return Object.entries(byDate)
      .map(([date, stats]) => ({ date, ...stats, total: stats.present + stats.absent }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [reportData]);
const buildReportTableHtml = () => {
    const esc = (v) => String(v ?? '').replace(/[<>&"]/g, '');
    if (repMode === 'summary') {
      return `<table><thead><tr><th>Student</th><th>ID</th><th>Class</th><th class="tc">Present</th><th class="tc">Absent</th><th class="tc">Total</th><th class="tc">%</th></tr></thead><tbody>${reportSummaryRows
        .map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${esc(r.sid)}</td><td>${esc(r.class)}</td><td class="tc">${r.present}</td><td class="tc">${r.absent}</td><td class="tc">${r.total}</td><td class="tc">${r.pct}%</td></tr>`
        )
        .join('')}</tbody></table>`;
    }
    return `<table><thead><tr><th>Date</th><th class="tc">Present</th><th class="tc">Absent</th><th class="tc">Total</th></tr></thead><tbody>${reportDailyRows
      .map((r) => `<tr><td>${r.date}</td><td class="tc">${r.present}</td><td class="tc">${r.absent}</td><td class="tc">${r.total}</td></tr>`)
      .join('')}</tbody></table>`;
  };

  const printReportNow = () => {
    if (!reportData) return;
    fetchSchoolName(schoolId).then((name) => {
      const dateLabel = repFrom && repTo ? (repFrom === repTo ? repFrom : `${repFrom} to ${repTo}`) : 'All Dates';
      const subtitle = `Class: ${repClass || 'All'} | Gender: ${repGender || 'All'} | Term: ${repTerm ? termLabel(repTerm) : 'All'} | Dates: ${dateLabel}`;
      printReport({
        schoolName: name,
        title: `Attendance Report — ${repMode === 'summary' ? 'Summary View' : 'Daily View'}`,
        subtitle,
        tableHtml: buildReportTableHtml(),
      });
    });
  };

  // ---------------- Event days ----------------
  const saveEventDay = async () => {
    setEventError('');
    if (!eventForm.date) {
      setEventError('Pick a date.');
      return;
    }
    if (eventDayMap[eventForm.date]) {
      setEventError(`An event day already exists for ${eventForm.date}. Delete it first to replace it.`);
      return;
    }
    setEventBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('attendance_event_days').insert([
        {
          school_id: schoolId,
          date: eventForm.date,
          event_type: eventForm.event_type,
          label: eventForm.label.trim(),
          notes: eventForm.notes.trim(),
          created_by: user?.id || null,
        },
      ]);
      if (error) throw new Error(error.message);
      toast.success('Event day added', `${formatDate(eventForm.date)} · ${eventForm.label || eventForm.event_type}`);
      setEventForm({ date: new Date().toISOString().split('T')[0], event_type: eventForm.event_type, label: '', notes: '' });
      reloadEventDays();
    } catch (err) {
      setEventError(err.message);
    } finally {
      setEventBusy(false);
    }
  };

  const removeEventDay = async (eventDay) => {
    if (!window.confirm('Delete this event day? The day will no longer be indicated as an event day (attendance records are untouched).')) return;
    const { error } = await supabase.from('attendance_event_days').delete().eq('id', eventDay.id);
    if (error) toast.error('Could not remove event day', error.message);
    else toast.success('Event day deleted', formatDate(eventDay.date));
    reloadEventDays();
  };

  return (
    <div>
      <PageHeader
        title="Attendance Management"
        subtitle="Daily registers, 30-day bulk marking, reports and event days."
        icon={CalendarCheck}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      {initialLoading ? (
        <Spinner label="Loading attendance tools..." />
      ) : tab === 'daily' ? (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Class *" value={className} onChange={(e) => setClassName(e.target.value)}>
              <option value="">Select class...</option>
              {classes.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
            <Select label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">All genders</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
            <SearchInput value={search} onChange={setSearch} placeholder="Search students..." />
          </div>

          {currentEventDay ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              <div>
                <b>Calendar note:</b> {formatDate(date)} is marked as <b>{EVENT_TYPE_LABELS[currentEventDay.event_type] || currentEventDay.event_type}</b>
                {currentEventDay.label ? `: ${currentEventDay.label}` : ''}
                {currentEventDay.notes ? ` — ${currentEventDay.notes}` : ''}
              </div>
              <button type="button" onClick={() => removeEventDay(currentEventDay)} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-rose-700 hover:text-rose-800">
                <CalendarX2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </button>
            </div>
          ) : null}

          {!className ? (
            <EmptyState icon={CalendarCheck} title="Pick a class" message="Select a class and date to mark attendance." />
          ) : dailyLoading ? (
            <Spinner label="Loading class..." />
          ) : visibleStudents.length ? (
<>
              <Card className="overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {visibleStudents.map((s) => {
                    const present = (marks[s.student_id] || 'present') === 'present';
                    return (
                      <div key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          {s.student_photo_url ? (
                            <img src={photoUrl(s.student_photo_url)} alt="Student" className="img-zoom h-10 w-9 rounded-lg object-cover ring-1 ring-slate-100" />
                          ) : (
                            <span className="flex h-10 w-9 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
                              {(s.first_name || 'S').charAt(0)}
                            </span>
                          )}
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{buildStudentName(s.first_name, s.middle_name, s.last_name)}</p>
                            <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'present' }))}
                            className={`badge cursor-pointer transition-colors ${present ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                          >
                            <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                            Present
                          </button>
                          <button
                            type="button"
                            onClick={() => setMarks((m) => ({ ...m, [s.student_id]: 'absent' }))}
                            className={`badge cursor-pointer transition-colors ${!present ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                          >
                            <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                            Absent
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="green">{presentCount} present</Badge>
                <Badge tone="red">{visibleStudents.length - presentCount} absent</Badge>
                <Badge tone="slate">{hasExisting ? 'Previously saved — editing' : 'New register'}</Badge>
                <Button onClick={saveDaily} loading={saving} className="ml-auto">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save attendance
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon={CalendarCheck} title="No students found" message="No admitted students match these filters." />
          )}
        </>
      ) : tab === 'monthly' ? (
<>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Start date *" type="date" value={mStart} onChange={(e) => setMStart(e.target.value)} />
            <Select label="Class *" value={mClass} onChange={(e) => setMClass(e.target.value)}>
              <option value="">Select class...</option>
              {classes.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Gender" value={mGender} onChange={(e) => setMGender(e.target.value)}>
              <option value="">All genders</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
            <div className="flex items-end">
              <Button variant="secondary" onClick={loadMonthly} loading={monthlyLoading} className="w-full">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Load 30-Day Grid
              </Button>
            </div>
          </div>

          {monthlyCache.length ? (
            <>
              <MonthlyAttendanceGrid
                cache={monthlyCache}
                dates={monthlyDates}
                eventDays={eventDays}
                onToggleCell={toggleMonthlyCell}
                onToggleDay={toggleMonthlyDay}
                onSaveStudent={saveMonthlyStudent}
                busyStudentId={busyStudentId}
              />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAllMonthly('present')}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Set All Present
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAllMonthly('absent')}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Set All Absent
                </Button>
                <Button variant="danger" size="sm" onClick={resetMonthly}>
                  Reset
                </Button>
                <Button variant="teal" size="sm" onClick={printMonthly}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Print
                </Button>
                <Button onClick={saveMonthlyAll} loading={monthlyBusy} className="ml-auto">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save All Changes
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Tip: click a day cell to cycle unmarked → present → absent. Click a day column header to mark every
                student for that day. Hover a row and click its save button to save one student.
              </p>
            </>
          ) : (
            <EmptyState
              icon={CalendarRange}
              title="30-Day Register"
              message="Pick a start date and class, then click “Load 30-Day Grid” to begin."
            />
          )}
        </>
      ) : tab === 'report' ? (
<>
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select label="Class" value={repClass} onChange={(e) => setRepClass(e.target.value)}>
                <option value="">All classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select label="Gender" value={repGender} onChange={(e) => setRepGender(e.target.value)}>
                <option value="">All genders</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </Select>
              <Select label="Term" value={repTerm} onChange={(e) => setRepTerm(e.target.value)}>
                <option value="">All terms</option>
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {termLabel(t)}
                  </option>
                ))}
              </Select>
              <Input label="Date from" type="date" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} />
              <Input label="Date to" type="date" value={repTo} onChange={(e) => setRepTo(e.target.value)} />
              <SearchInput value={repSearch} onChange={setRepSearch} placeholder="Search students..." />
              <div className="flex items-end">
                <Button variant="secondary" onClick={loadReport} loading={reportLoading} className="w-full">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Refresh report
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant={repMode === 'summary' ? 'brand' : 'secondary'} onClick={() => setRepMode('summary')}>
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Summary View
              </Button>
              <Button size="sm" variant={repMode === 'daily' ? 'brand' : 'secondary'} onClick={() => setRepMode('daily')}>
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                Daily View
              </Button>
              <Button size="sm" variant="teal" onClick={printReportNow} disabled={!reportData || !reportData.records.length}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print report
              </Button>
            </div>
          </Card>

          {reportData ? (
            <Card className="mt-4 overflow-hidden">
              {reportData.records.length ? (
                <div className="max-h-[65vh] overflow-x-auto overflow-y-auto">
                  {repMode === 'summary' ? (
<table className="table w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Class</th>
                          <th className="px-3 py-2 text-right">Present</th>
                          <th className="px-3 py-2 text-right">Absent</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportSummaryRows.map((r) => (
                          <tr key={r.sid} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 font-semibold text-slate-800">{r.name}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.sid}</td>
                            <td className="px-3 py-2 text-slate-500">{r.class || '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-600">{r.present}</td>
                            <td className="px-3 py-2 text-right font-semibold text-rose-500">{r.absent}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{r.total}</td>
                            <td className="px-3 py-2 text-right font-semibold text-teal-600">{r.pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="table w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2 text-right">Present</th>
                          <th className="px-3 py-2 text-right">Absent</th>
                          <th className="px-3 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportDailyRows.map((r) => (
                          <tr key={r.date} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 font-semibold text-slate-800">{formatDate(r.date)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-600">{r.present}</td>
                            <td className="px-3 py-2 text-right font-semibold text-rose-500">{r.absent}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{r.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="p-6">
                  <EmptyState
                    icon={FileBarChart}
                    title="No attendance records"
                    message="No records match the current filters for this academic year. Adjust the filters and refresh."
                  />
                </div>
              )}
            </Card>
          ) : (
            <EmptyState
              icon={FileBarChart}
              title="Attendance report"
              message="Set the filters above and press “Refresh report” to build per-student or per-day attendance summaries."
            />
          )}
        </>
      ) : (
        <>
          <Card className="p-5">
            {eventError ? (
              <Alert tone="error" className="mb-4">
                {eventError}
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input label="Date *" type="date" value={eventForm.date} onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))} />
              <Select label="Type *" value={eventForm.event_type} onChange={(e) => setEventForm((f) => ({ ...f, event_type: e.target.value }))}>
                <option value="holiday">Holiday (no school)</option>
                <option value="manual">Manual / special day</option>
              </Select>
              <Input label="Label *" value={eventForm.label} onChange={(e) => setEventForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Sports day" />
              <Input label="Notes" value={eventForm.notes} onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <Button onClick={saveEventDay} loading={eventBusy} className="mt-4">
              <Sun className="h-4 w-4" aria-hidden="true" />
              Add event day
            </Button>
          </Card>

          <Card className="mt-4 overflow-hidden">
            {eventDays.length ? (
              <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
                {eventDays.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {formatDate(e.date)}
                        <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                          {EVENT_TYPE_LABELS[e.event_type] || e.event_type}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {e.label || 'No label'}
                        {e.notes ? ` · ${e.notes}` : ''}
                      </p>
                    </div>
                    <button type="button" onClick={() => removeEventDay(e)} className="rounded-lg px-2 py-1 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  icon={Sun}
                  title="No event days marked"
                  message="Mark holidays and special days here. They appear as highlights in the daily banner and the 30-day grid."
                />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}