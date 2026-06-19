import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

// Accessible confirmation modal used before destructive actions (delete / clear).
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, message, confirmLabel, cancelLabel, onConfirm, onCancel, destructive = true,
}) => {
  const ref = useDialog<HTMLDivElement>(onCancel);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative pointer-events-auto w-full max-w-xs bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 animate-fade-in"
      >
        <div className="flex flex-col items-center text-center">
          <span className={`w-12 h-12 rounded-full grid place-items-center mb-3 ${destructive ? 'bg-red-500/15 text-red-400' : 'bg-indigo-500/15 text-indigo-400'}`}>
            <AlertTriangle size={24} />
          </span>
          <h3 className="text-lg font-bold text-white mb-1">{title}</h3>
          <p className="text-sm text-slate-400 mb-5 leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors ${
              destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
