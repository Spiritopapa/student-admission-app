import { memo } from 'react';
import { Check, X, Minus, Save } from 'lucide-react';
import {
  isWeekend,
  WEEKDAYS_SHORT,
  EVENT_TYPE_LABELS,
  buildEventDayMap,
  monthlyStats,
} from '../lib/attendance';
import { Badge } from './ui';

/**
 * 30-day attendance grid. Mirrors the legacy vanilla "checkbox mode":
 *  - click a day cell to cycle unmarked -> present -> absent
 *  - click a day column header to mark every student present/absent for that day
 *  - weekends and event days are highlighted, event days carry a badge/tooltip
 *  - optional per-student save button
 *
 * The parent owns the data (cache + dates) and passes callbacks that mutate it.
 */
function MonthlyAttendanceGrid({ cache, dates, eventDays, onToggleCell, onToggleDay, onSaveStudent, busyStudentId }) {
  const rows = cache || [];
  const eventMap = buildEventDayMap(eventDays);
  const stats = monthlyStats(rows, dates);

  const cellClass = (status, date, locked) => {
    const weekend = isWeekend(date) ? 'bg-slate-50' : '';
    const lock = locked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer';
    if (status === 'present') return `h-10 w-full ${lock} text-center text-sm font-bold text-emerald-600 hover:bg-emerald-200 ${weekend} bg-emerald-100`;
    if (status === 'absent') return `h-10 w-full ${lock} text-center text-sm font-bold text-rose-500 hover:bg-rose-200 ${weekend} bg-rose-100`;
    return `h-10 w-full ${lock} text-center text-base font-bold text-slate-300 ${weekend} hover:bg-slate-100`;
  };

  const StatusCell = ({ status }) => {
    if (status === 'present') return <span className="inline-flex items-center justify-center"><Check className="h-4 w-4" aria-hidden="true" /></span>;
    if (status === 'absent') return <span className="inline-flex items-center justify-center"><X className="h-4 w-4" aria-hidden="true" /></span>;
    return <span className="inline-flex items-center justify-center text-slate-300"><Minus className="h-4 w-4" aria-hidden="true" /></span>;
  };
return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-900 text-white">
              {onSaveStudent ? (
                <th className="border border-slate-700 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide">Save</th>
              ) : null}
              <th className="border border-slate-700 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Student Name</th>
              <th className="border border-slate-700 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">ID</th>
              {dates.map((date) => {
                const d = new Date(`${date}T00:00:00`);
                const ev = eventMap[date];
                const weekend = isWeekend(date);
                return (
                  <th
                    key={date}
                    className={`border border-slate-700 px-0 py-1 align-bottom ${weekend ? 'bg-slate-600' : ''} ${ev ? 'bg-amber-500/80 text-amber-50' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleDay?.(date)}
                      title={`${date} (${d.toLocaleDateString('en', { weekday: 'long' })}) — click to mark all present/absent`}
                      className="block w-full px-1 py-1 text-center"
                    >
                      <span className="block text-xs font-bold leading-tight">{d.getDate()}</span>
                      <span className="block text-[9px] font-medium leading-tight opacity-80">{WEEKDAYS_SHORT[d.getDay()]}</span>
                      {ev ? (
                        <span
                          className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[9px]"
                          title={`${EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}: ${ev.label || ''}${ev.notes ? ` — ${ev.notes}` : ''}`}
                        >
                          {ev.event_type === 'holiday' ? '☀' : '★'}
                        </span>
                      ) : null}
                    </button>
                  </th>
                );
              })}
              <th className="border border-slate-700 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide">✓/✗</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((student) => {
              let present = 0;
              let marked = 0;
              dates.forEach((date) => {
                const status = student.days[date] || 'unmarked';
                if (status === 'present') present += 1;
                if (status !== 'unmarked') marked += 1;
              });
              return (
                <tr key={student.student_id} className="group border-b border-slate-100 last:border-0 odd:bg-white even:bg-slate-50/50">
                  {onSaveStudent ? (
                    <td className="border border-slate-100 px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => onSaveStudent(student.student_id)}
                        disabled={busyStudentId === student.student_id}
                        title="Save this student's attendance"
                        className="rounded-md p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-teal-50 hover:text-teal-600 group-hover:opacity-100 disabled:opacity-40"
                      >
                        <Save className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap border border-slate-100 px-3 py-1.5 font-semibold text-slate-800">
                    {student.name}
                  </td>
                  <td className="whitespace-nowrap border border-slate-100 px-2 py-1.5 font-mono text-xs text-slate-400">{student.student_id}</td>
                  {dates.map((date) => {
                    const status = student.days[date] || 'unmarked';
                    return (
                      <td key={date} className={`border border-slate-100 p-0 ${isWeekend(date) ? 'bg-slate-50' : ''}`}>
                        <button
                          type="button"
                          className={cellClass(status, date, student.is_locked)}
                          onClick={() => !student.is_locked && onToggleCell?.(student.student_id, date)}
                        >
                          <StatusCell status={status} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="border border-slate-100 px-2 py-1.5 text-center font-mono text-xs font-semibold text-slate-500">
                    {present}/{marked}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone="green">Present: {stats.present}</Badge>
        <Badge tone="red">Absent: {stats.absent}</Badge>
        <Badge tone="slate">Total marked: {stats.total}</Badge>
        {stats.total ? <Badge tone="blue">Rate: {stats.pct}%</Badge> : null}
        {dates.some((d) => eventMap[d]) ? (
          <Badge tone="amber">{dates.filter((d) => eventMap[d]).length} event day{dates.filter((d) => eventMap[d]).length === 1 ? '' : 's'} in range</Badge>
        ) : null}
      </div>
    </div>
  );
}

export default memo(MonthlyAttendanceGrid);