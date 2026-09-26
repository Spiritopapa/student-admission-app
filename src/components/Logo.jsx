import { GraduationCap } from 'lucide-react';

export function Logo({ size = 'md', light = false }) {
  const sizes = {
    sm: 'h-9 w-9 rounded-xl',
    md: 'h-11 w-11 rounded-2xl',
    lg: 'h-14 w-14 rounded-2xl',
  };
  const iconSizes = {
    sm: 'h-5 w-5',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };
  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  };
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`inline-flex items-center justify-center bg-blend text-white shadow-card ${sizes[size]}`}
      >
        <GraduationCap className={iconSizes[size]} aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className={`font-extrabold tracking-tight ${textSizes[size]} ${light ? 'text-white' : 'text-slate-900'}`}>
          School<span className="text-brand-600">Runner</span>
        </p>
        {size === 'lg' ? (
          <p className="text-xs font-medium text-slate-400">Streamline. Manage. Excel.</p>
        ) : null}
      </div>
    </div>
  );
}

export function BrandTagline() {
  return (
    <p className="bg-gradient-to-r from-brand-600 via-teal-600 to-accent-500 bg-clip-text text-transparent">
      Streamline. Manage. Excel.
    </p>
  );
}