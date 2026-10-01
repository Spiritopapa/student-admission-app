import { forwardRef, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, Search, Inbox } from 'lucide-react';

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, ...props },
  ref
) {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-sm',
  };
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    teal: 'btn-teal',
    amber: 'btn-amber',
    danger: 'btn-danger',
    ghost: 'btn-ghost',
  };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className = '', children, ...props }) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Input({ label, error, hint, className = '', ...props }) {
  return (
    <div className={className}>
      {label ? <label className="label">{label}</label> : null}
      <input
        className={`input ${error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
        {...props}
      />
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={className}>
      {label ? <label className="label">{label}</label> : null}
      <select className="input" {...props}>
        {children}
      </select>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function Textarea({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label ? <label className="label">{label}</label> : null}
      <textarea className={`input min-h-[90px] ${error ? 'border-rose-300' : ''}`} {...props} />
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  amber: 'bg-accent-500/10 text-accent-600 ring-1 ring-accent-500/30',
  blue: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  slate: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  teal: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
};

export function Badge({ tone = 'slate', className = '', children }) {
  return <span className={`badge ${TONES[tone]} ${className}`}>{children}</span>;
}

export function IconBadge({ tone = 'blue', icon: Icon, size = 'md', className = '' }) {
  const tones = {
    blue: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-accent-500/10 text-accent-600',
    teal: 'bg-teal-50 text-teal-600',
    red: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-500',
  };
  const sizes = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' };
  const iconSizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl ${tones[tone]} ${sizes[size]} ${className}`}
    >
      {Icon ? <Icon className={iconSizes[size]} aria-hidden="true" /> : null}
    </span>
  );
}

export function Spinner({ label = 'Loading...', className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-14 text-slate-400 ${className}`}
    >
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" aria-hidden="true" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-soft">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      {title ? <h3 className="mt-1 text-sm font-semibold text-slate-700">{title}</h3> : null}
      {message ? <p className="max-w-sm text-sm text-slate-500">{message}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * StatCard — professional dashboard metric card.
 * Clean white surface with a tone-coloured border + left accent bar
 * (border/color accents only — no heavy gradient fill). Numbers count up with
 * an ease-out curve once the card scrolls into view and smoothly transition
 * whenever the value changes (e.g. after a live refresh).
 * ------------------------------------------------------------------------- */
const STAT_TONES = {
  blue: {
    card: 'border-brand-200 hover:border-brand-400',
    bar: 'bg-brand-500',
    chip: 'bg-brand-50 text-brand-600',
    value: 'text-brand-700',
    dot: 'bg-brand-500',
  },
  green: {
    card: 'border-emerald-200 hover:border-emerald-400',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-600',
    value: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  amber: {
    card: 'border-amber-300 hover:border-amber-400',
    bar: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700',
    value: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  teal: {
    card: 'border-teal-300 hover:border-teal-400',
    bar: 'bg-teal-500',
    chip: 'bg-teal-50 text-teal-700',
    value: 'text-teal-700',
    dot: 'bg-teal-500',
  },
  red: {
    card: 'border-rose-300 hover:border-rose-400',
    bar: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700',
    value: 'text-rose-700',
    dot: 'bg-rose-500',
  },
  slate: {
    card: 'border-slate-300 hover:border-slate-400',
    bar: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600',
    value: 'text-slate-700',
    dot: 'bg-slate-400',
  },
};

/* Pulls the numeric core out of formatted values like "GHC 1,234.50", "87%"
 * or "12" so it can be animated while the prefix/suffix stay stable. */
function splitValue(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw === '-' || raw === '—' || raw === 'N/A') return null;
  const grouped = /,\d{3}/.test(raw);
  const m = raw.split(',').join('').match(/^(.*?)(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const num = Number(m[2]);
  if (!Number.isFinite(num)) return null;
  return {
    prefix: m[1],
    num,
    suffix: m[3],
    decimals: m[2].includes('.') ? m[2].split('.')[1].length : 0,
    grouped,
  };
}

function formatStatNumber(parsed, num) {
  const s = num.toLocaleString('en-US', {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
  });
  return parsed.grouped ? s : s.split(',').join('');
}

const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/* Animated counter. Counts 0 → value with an ease-out curve once `started`
 * flips true and re-animates from the current number whenever `value` changes,
 * so live refreshes transition smoothly instead of jumping. */
function CountUp({ value, started = false, delay = 0, duration = 1050, className = '' }) {
  const reduced = useReducedMotion();
  const parsed = splitValue(value);
  const [display, setDisplay] = useState(reduced ? parsed?.num : null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduced || !started || !parsed) return;
    let raf = 0;
    const from = fromRef.current;
    const to = parsed.num;
    const begin = performance.now();
    const tick = (now) => {
      const t = Math.min(Math.max(now - begin - delay, 0) / duration, 1);
      const current = from + (to - from) * easeOutExpo(t);
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, parsed?.num, reduced, delay, duration]);

  if (!parsed) return <span className={className}>{String(value ?? '')}</span>;

  const shown = reduced || display === null ? parsed.num : display;
  return (
    <span className={className}>
      {parsed.prefix}
      {formatStatNumber(parsed, shown)}
      {parsed.suffix}
    </span>
  );
}

export function StatCard({ icon: Icon, tone = 'blue', label, value, sub, onClick, index = 0 }) {
  const t = STAT_TONES[tone] || STAT_TONES.blue;
  const [entered, setEntered] = useState(false);
  const delay = Math.min(Math.max(index, 0), 6) * 0.07;
  const valueSize = String(value ?? '').length > 14 ? 'text-xl' : 'text-2xl';
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay, ease: 'easeOut' } }}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      onViewportEnter={() => setEntered(true)}
      whileHover={{ y: -3, transition: { duration: 0.18, ease: 'easeOut' } }}
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border bg-white shadow-soft hover:shadow-card ${
        t.card
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} aria-hidden="true" />
      <div className="px-4 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">
            {label}
          </p>
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${t.chip}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className={`mt-1.5 tabular-nums font-bold tracking-tight ${valueSize} ${t.value}`}>
          <CountUp value={value} started={entered} delay={delay} />
        </p>
        {sub ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
            {sub}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9"
      />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <div className="flex items-center gap-2.5">
      {label ? <span className="text-sm text-slate-600">{label}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blend text-white shadow-card">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : null}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}