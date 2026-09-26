import { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONES = {
  success: {
    ring: 'ring-emerald-400/40',
    badge: 'bg-emerald-50 text-emerald-700',
  },
  error: {
    ring: 'ring-rose-400/40',
    badge: 'bg-rose-50 text-rose-700',
  },
  info: {
    ring: 'ring-brand-300/40',
    badge: 'bg-brand-50 text-brand-700',
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, title, message) => {
    const id = Date.now() + Math.random().toString(36).slice(2, 7);
    setToasts((list) => [...list.slice(-3), { id, type, title, message }]);
    setTimeout(() => dismiss(id), 5200);
  }, [dismiss]);

  const value = {
    success: (title, message) => push('success', title, message),
    error: (title, message) => push('error', title, message),
    info: (title, message) => push('info', title, message),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-0 top-0 z-[70] flex flex-col gap-3 px-4 pt-4 sm:pr-6">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: -18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.28 }}
                className={`flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-card ${TONES[t.type].ring} ring-2`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[t.type].badge}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                  {t.message ? (
                    <p className="mt-0.5 text-sm leading-snug text-slate-600">{t.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}