import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Shared building blocks for the Member Workspace so every page keeps the
 * same loading / empty / error discipline and the same visual language as
 * the rest of Sam_Teck Hub.
 */

export const PageHeader: React.FC<{
  title: string;
  description: string;
  icon: React.ElementType;
  actions?: React.ReactNode;
}> = ({ title, description, icon: Icon, actions }) => (
  <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div className="flex items-start gap-3 min-w-0">
      <div className="p-2 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] shrink-0">
        <Icon className="w-5 h-5 text-[#123B73]" />
      </div>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-[#172B4D] truncate">{title}</h1>
        <p className="text-xs text-[#65758B] mt-0.5">{description}</p>
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading your records…' }) => (
  <div className="py-12 text-center text-xs text-[#65758B]" role="status" aria-live="polite">
    <div className="animate-spin w-5 h-5 border-2 border-[#123B73] border-t-transparent rounded-full mx-auto mb-2" />
    {label}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex flex-wrap items-center justify-between gap-3" role="alert">
    <div className="flex items-center gap-2 min-w-0">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 font-semibold underline hover:text-red-900 shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Try again
      </button>
    )}
  </div>
);

export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="bg-white rounded-xl border border-[#DCE5F0] p-10 text-center max-w-lg mx-auto shadow-xs">
    <Icon className="w-10 h-10 text-[#65758B]/40 mx-auto mb-3" />
    <h3 className="text-sm font-bold text-[#172B4D]">{title}</h3>
    <p className="text-xs text-[#65758B] mt-1.5 mb-5 max-w-sm mx-auto">{description}</p>
    {action}
  </div>
);

export const SectionCard: React.FC<{
  title: string;
  icon: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon: Icon, action, children }) => (
  <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs">
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#DCE5F0]">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#123B73]" />
        <h2 className="text-sm font-bold text-[#172B4D]">{title}</h2>
      </div>
      {action}
    </div>
    {children}
  </div>
);

/** Neutral status chip used across tasks, meetings and ideas. */
export const Chip: React.FC<{ children: React.ReactNode; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = ({
  children,
  tone = 'neutral',
}) => {
  const tones = {
    neutral: 'bg-slate-50 text-slate-700 border-slate-200',
    info: 'bg-blue-50 text-[#123B73] border-[#DCE5F0]',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
  } as const;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${tones[tone]}`}
    >
      {children}
    </span>
  );
};

/** Primary / secondary button styles shared by the member pages. */
export const buttonStyles = {
  primary:
    'px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'px-3.5 py-2 border border-[#DCE5F0] bg-white text-[#172B4D] hover:bg-[#F5F8FC] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed',
};
