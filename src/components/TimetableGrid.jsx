const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const WEEKDAYS = DAYS.map((label, index) => ({ value: index + 1, label }));

function timeLabel(value) {
  if (!value) return '';
  return value.slice(0, 5);
}

export default function TimetableGrid({ entries, editable = false, onEdit, onDelete }) {
  const grouped = WEEKDAYS.map((day) => ({
    ...day,
    entries: entries
      .filter((entry) => Number(entry.weekday) === day.value)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {grouped.map((day) => (
        <section key={day.value} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <h3 className="bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{day.label}</h3>
          <div className="min-h-24 space-y-2 p-3">
            {day.entries.length ? day.entries.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-brand-100 bg-brand-50/60 p-3">
                <p className="text-xs font-semibold text-brand-700">{timeLabel(entry.starts_at)} – {timeLabel(entry.ends_at)}</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{entry.subject_name}</p>
                {entry.teacher?.full_name ? <p className="mt-1 text-xs text-slate-500">{entry.teacher.full_name}</p> : null}
                {entry.room ? <p className="mt-1 text-xs text-slate-500">Room: {entry.room}</p> : null}
                {editable ? <div className="mt-2 flex gap-3 text-xs font-semibold"><button type="button" className="text-brand-600 hover:underline" onClick={() => onEdit(entry)}>Edit</button><button type="button" className="text-rose-600 hover:underline" onClick={() => onDelete(entry)}>Delete</button></div> : null}
              </article>
            )) : <p className="py-3 text-center text-xs text-slate-400">No lessons</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
