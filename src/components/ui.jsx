import { forwardRef } from 'react';
import { motion } from 'framer-motion';
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

export function StatCard({ icon: Icon, tone = 'blue', label, value, sub, onClick }) {
  const tones = {
    blue: 'from-brand-500 to-brand-600',
    green: 'from-emerald-500 to-teal-600',
    amber: 'from-accent-500 to-accent-600',
    teal: 'from-teal-500 to-cyan-600',
    red: 'from-rose-500 to-rose-600',
  };
  return (
    <motion.div
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-card ${
        onClick ? 'cursor-pointer' : ''
      } bg-gradient-to-br ${tones[tone]}`}
    >
      <Icon
        className="absolute -right-3 -top-3 h-16 w-16 opacity-15"
        aria-hidden="true"
      />
      <p className="text-xs font-medium uppercase tracking-wide text-white/80">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub ? <p className="mt-1 text-xs text-white/75">{sub}</p> : null}
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