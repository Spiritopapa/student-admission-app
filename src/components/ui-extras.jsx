import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  };
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={`relative max-h-[92vh] w-full ${sizes[size]} overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl`}
          >
            {title ? (
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
                <h3 className="text-base font-semibold text-slate-800">{title}</h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <div className="px-5 py-5">{children}</div>
            {footer ? (
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = active === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              isActive ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.icon ? <tab.icon className="h-4 w-4" aria-hidden="true" /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className = '' }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-accent-500/40 bg-accent-500/10 text-accent-700',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]} ${className}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary bg-rose-600 hover:bg-rose-700"
          >
            {loading ? 'Deleting...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
    </Modal>
  );
}