import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

export type ToastType = 'error' | 'success' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number; // ms before auto-dismiss
  closeLabel?: string; // localized accessible name for the close button
}

const STYLES: Record<ToastType, { Icon: React.ComponentType<{ size?: number; className?: string }>; accent: string; border: string }> = {
  error: { Icon: AlertTriangle, accent: 'text-rose-400', border: 'border-rose-500/40' },
  success: { Icon: CheckCircle, accent: 'text-emerald-400', border: 'border-emerald-500/40' },
  info: { Icon: Info, accent: 'text-indigo-400', border: 'border-indigo-500/40' },
};

// In-app toast replacing native alert(). Slides in below the floating header,
// auto-dismisses, and is announced to screen readers.
export const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose, duration = 4500, closeLabel = 'Close' }) => {
  const { Icon, accent, border } = STYLES[type];

  useEffect(() => {
    const id = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(id);
  }, [message, duration, onClose]);

  return (
    <div
      className="fixed left-0 right-0 z-[200] flex justify-center px-4 pointer-events-none"
      style={{ top: 'calc(var(--header-h, 5rem) + 0.5rem)' }}
    >
      <div
        role="alert"
        aria-live="assertive"
        className={`pointer-events-auto flex items-center gap-3 w-full max-w-sm bg-slate-800/95 backdrop-blur-md border ${border} rounded-2xl shadow-2xl px-4 py-3 animate-slide-down`}
      >
        <span className={`shrink-0 ${accent}`}><Icon size={20} /></span>
        <p className="flex-1 min-w-0 text-sm font-medium text-slate-100 leading-snug">{message}</p>
        <button
          onClick={onClose}
          aria-label={closeLabel}
          className="shrink-0 -mr-1 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
