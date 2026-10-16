import React, { useState } from 'react';
import { Bell, CheckCheck, Filter, Sparkles, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import { NavigationTab } from '../../utils/routes';
import { formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, buttonStyles } from '../../components/ui';
import { NotificationItem } from '../../types/database';

const TYPE_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  task: 'info',
  meeting: 'warning',
  announcement: 'info',
  idea: 'success',
  system: 'neutral',
};

const TYPE_LABEL: Record<string, string> = {
  task: 'Task',
  meeting: 'Meeting',
  announcement: 'Announcement',
  idea: 'Innovation',
  system: 'System',
};

/**
 * Notification centre. Rows are restricted to the signed-in user by RLS and
 * stream in over Supabase Realtime, so the count is always a real value.
 */
export const MemberNotificationsView: React.FC<{ onNavigate: (tab: NavigationTab) => void }> = ({ onNavigate }) => {
  const { user } = useAuth();
  const { notifications, unreadCount, loading, error, refresh, markRead, markAllRead } = useNotifications(user?.id);
  const [scope, setScope] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = scope === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;

  const open = async (n: NotificationItem) => {
    if (!n.is_read) {
      const ok = await markRead(n.id);
      if (!ok) setActionError('The notification could not be marked as read.');
    }
    if (n.link_url) {
      const tab = n.link_url.replace(/^\/workspace\//, '') as NavigationTab;
      if (tab && tab !== n.link_url) onNavigate(tab);
    }
  };

  const handleMarkAll = async () => {
    setBusy(true);
    setActionError(null);
    const ok = await markAllRead();
    if (!ok) setActionError('Not every notification could be marked as read.');
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Task assignments, meeting invitations, idea feedback and announcements."
        icon={Bell}
        actions={
          <>
            <button onClick={() => refresh()} disabled={loading} className={buttonStyles.secondary}>
              Refresh
            </button>
            <button onClick={handleMarkAll} disabled={busy || unreadCount === 0} className={buttonStyles.primary}>
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all as read
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <div className="text-[11px] text-[#65758B] font-medium">Unread</div>
          <div className={`text-2xl font-extrabold ${unreadCount > 0 ? 'text-red-600' : 'text-[#172B4D]'}`}>
            {unreadCount}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <div className="text-[11px] text-[#65758B] font-medium">Total (last 100)</div>
          <div className="text-2xl font-extrabold text-[#172B4D]">{notifications.length}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <div className="text-[11px] text-[#65758B] font-medium">Delivery</div>
          <div className="text-xs font-bold text-emerald-600 mt-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            {user ? 'Real-time for your account' : 'Not signed in'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-[#65758B]" />
        {(['all', 'unread'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition ${
              scope === s
                ? 'bg-[#123B73] text-white border-[#123B73]'
                : 'bg-white text-[#172B4D] border-[#DCE5F0] hover:bg-[#F5F8FC]'
            }`}
          >
            {s === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={() => refresh()} />}
      {actionError && <ErrorState message={actionError} onRetry={() => setActionError(null)} />}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading notifications…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={scope === 'unread' ? 'You are all caught up' : 'No notifications yet'}
          description={
            scope === 'unread'
              ? 'There are no unread notifications on your account.'
              : 'You will receive a notification when a task is assigned to you, you are invited to a meeting, your idea receives a decision, or leadership publishes an announcement.'
          }
          action={
            scope === 'unread' ? (
              <button onClick={() => setScope('all')} className={buttonStyles.secondary}>
                Show all notifications
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-[#DCE5F0] divide-y divide-[#DCE5F0] shadow-xs overflow-hidden">
          {visible.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={`w-full text-left p-4 flex items-start gap-3 transition ${
                n.is_read ? 'hover:bg-[#F5F8FC]/60' : 'bg-blue-50/40 hover:bg-blue-50/70'
              }`}
            >
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.is_read ? 'bg-[#DCE5F0]' : 'bg-[#2457A7]'}`}
                aria-label={n.is_read ? 'Read' : 'Unread'}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm text-[#172B4D]">{n.title}</span>
                  <Chip tone={TYPE_TONE[n.type] || 'neutral'}>{TYPE_LABEL[n.type] || n.type}</Chip>
                  {!n.is_read && <Chip tone="info">Unread</Chip>}
                </span>
                <span className="block text-xs text-[#65758B] mt-1 whitespace-pre-wrap">{n.message}</span>
                <span className="block text-[11px] text-[#65758B] mt-1.5">{formatRelativeTime(n.created_at)}</span>
              </span>
              {n.link_url && (
                <span className="text-[11px] font-semibold text-[#123B73] shrink-0 hidden sm:block">Open</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 rounded-xl bg-[#F5F8FC] border border-[#DCE5F0] text-[11px] text-[#65758B] flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#123B73]" />
        <span>
          Notifications are created by database triggers on real events — they cannot be generated by editing this page.
          You only ever receive rows addressed to your own account.
        </span>
      </div>
    </div>
  );
};
