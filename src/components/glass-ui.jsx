import { forwardRef } from 'react';
import { motion } from 'framer-motion';

/* ------------------------------------------------------------------
   GlassCard — reusable frosted-glass container
   ------------------------------------------------------------------ */

const ELEVATIONS = {
  sm: {
    light: 'shadow-glass-sm',
    dark: 'shadow-glass-sm',
  },
  md: {
    light: 'shadow-glass',
    dark: 'shadow-glass',
  },
  lg: {
    light: 'shadow-glass-lg',
    dark: 'shadow-glass-lg',
  },
};

export const GlassCard = forwardRef(function GlassCard(
  {
    children,
    className = '',
    elevation = 'md',
    hover = true,
    animate = true,
    initialY = 16,
    delay = 0,
    onClick,
    style,
    ...props
  },
  ref
) {
  return (
    <motion.div
      ref={ref}
      initial={animate ? { opacity: 0, y: initialY } : false}
      animate={animate ? { opacity: 1, y: 0 } : false}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={hover ? { y: -2, transition: { duration: 0.2 } } : false}
      whileTap={hover ? { scale: 0.99 } : false}
      onClick={onClick}
      className={`
        glass-card relative rounded-2xl p-5
        ${ELEVATIONS[elevation]?.light ?? ELEVATIONS.md.light}
        ${className}
      `}
      style={style}
      {...props}
    >
      {children}
    </motion.div>
  );
});

/* ------------------------------------------------------------------
   GlassStatCard — compact stat/metric card with icon
   ------------------------------------------------------------------ */

export function GlassStatCard({
  icon: Icon,
  label,
  value,
  subtext,
  tone = 'brand',
  className = '',
  delay = 0,
  onClick,
}) {
  const iconBg = {
    brand: 'bg-brand-50 text-brand-600',
    teal: 'bg-teal-50 text-teal-600',
    accent: 'bg-accent-500/10 text-accent-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  };

  return (
    <GlassCard elevation="sm" hover className={className} delay={delay} onClick={onClick}>
      <div className="flex items-start gap-3.5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg[tone] ?? iconBg.brand}`}>
          {Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{value}</p>
          {subtext ? <p className="mt-0.5 text-xs text-slate-400">{subtext}</p> : null}
        </div>
      </div>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------
   GlassSection — glass container for page sections
   ------------------------------------------------------------------ */

export function GlassSection({
  children,
  className = '',
  padded = true,
  ...props
}) {
  return (
    <div
      className={`
        glass-panel-heavy rounded-2xl
        ${padded ? 'p-5 sm:p-6 lg:p-8' : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------
   GlassBadge — frosted glass badge with optional label/value
   ------------------------------------------------------------------ */

export function GlassBadge({ 
  label, 
  value, 
  children, 
  className = '', 
  tone = 'brand' 
}) {
  const tones = {
    brand: 'bg-brand-500/10 text-brand-700 border-brand-200/40',
    teal: 'bg-teal-500/10 text-teal-700 border-teal-200/40',
    accent: 'bg-accent-500/10 text-accent-700 border-accent-200/40',
    emerald: 'bg-emerald-500/10 text-emerald-700 border-emerald-200/40',
    rose: 'bg-rose-500/10 text-rose-700 border-rose-200/40',
    slate: 'bg-slate-500/10 text-slate-600 border-slate-200/40',
  };

  const toneStyle = tones[tone] ?? tones.brand;

  if (label && value !== undefined) {
    return (
      <div className={`inline-flex flex-col items-center gap-0.5 rounded-full border px-3 py-2 backdrop-blur-sm ${toneStyle} ${className}`}>
        <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">{label}</span>
        <span className="text-xs font-bold tabular-nums">{value}</span>
      </div>
    );
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold
        backdrop-blur-sm
        ${toneStyle}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------
   GlassTabs — frosted glass tab bar
   ------------------------------------------------------------------ */

export function GlassTabs({ tabs, active, onChange, className = '' }) {
  return (
    <div
      className={`
        glass-chip flex gap-1 overflow-x-auto rounded-xl p-1.5
        ${className}
      `}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={`
              flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all
              ${
                isActive
                  ? 'glass-panel-heavy text-brand-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }
            `}
          >
            {tab.icon ? <tab.icon className="h-4 w-4" aria-hidden="true" /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   GlassInput — frosted glass form input
   ------------------------------------------------------------------ */

export function GlassInput({ label, error, hint, className = '', ...props }) {
  return (
    <div className={className}>
      {label ? <label className="label">{label}</label> : null}
      <input
        className={`glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 ${
          error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''
        }`}
        {...props}
      />
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   GlassButton — frosted glass button
   ------------------------------------------------------------------ */

export function GlassButton({
  children,
  variant = 'default',
  size = 'md',
  icon,
  className = '',
  ...props
}) {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-sm',
  };

  return (
    <button
      className={`glass-btn inline-flex items-center justify-center gap-2 rounded-xl font-semibold ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------
   GlassDivider — subtle glass separator
   ------------------------------------------------------------------ */

export function GlassDivider({ className = '' }) {
  return <hr className={`glass-divider ${className}`} />;
}

/* ------------------------------------------------------------------
   GlassSkeleton — shimmer loading placeholder
   ------------------------------------------------------------------ */

export function GlassSkeleton({ className = '' }) {
  return <div className={`glass-shimmer rounded-xl ${className}`} />;
}

/* ------------------------------------------------------------------
   GlassAvatar — frosted glass avatar
   ------------------------------------------------------------------ */

export function GlassAvatar({ src, alt, size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-14 w-14',
    xl: 'h-20 w-20',
  };

  return (
    <span
      className={`
        glass-icon relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full
        ${sizes[size] ?? sizes.md}
        ${className}
      `}
    >
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="text-sm font-bold text-slate-500">{alt?.charAt(0)?.toUpperCase() ?? '?'}</span>
      )}
    </span>
  );
}
