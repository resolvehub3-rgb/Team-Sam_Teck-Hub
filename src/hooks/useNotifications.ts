import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { NotificationItem } from '../types/database';
import { getErrorMessage } from '../utils/format';

interface UseNotificationsResult {
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  markRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
}

/**
 * Live notification centre for the signed-in member.
 *
 * Reads only rows owned by the caller (enforced by RLS) and subscribes to
 * Supabase Realtime so a task assignment or meeting invitation appears
 * without a refresh. The subscription is always torn down on unmount.
 */
export function useNotifications(userId?: string): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Supabase channels are keyed by name and this hook may be mounted more
  // than once for the same user (shell + notification page). Reusing a channel
  // that is already subscribed throws, so every instance gets its own suffix.
  const channelIdRef = useRef<string | null>(null);
  if (channelIdRef.current === null) {
    channelIdRef.current = Math.random().toString(36).slice(2, 10);
  }

  const refresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured() || !userId) {
        setNotifications([]);
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      try {
        const { data, error: err } = await supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (err) throw err;
        if (!mounted.current) return;
        setNotifications((data as NotificationItem[]) || []);
        setError(null);
      } catch (err: unknown) {
        if (!mounted.current) return;
        setError(getErrorMessage(err, 'Could not load notifications.'));
      } finally {
        if (mounted.current && !opts.silent) setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: rows are scoped to this user by RLS, so no filter is required
  // beyond the table itself — but filtering keeps traffic minimal.
  useEffect(() => {
    if (!isSupabaseConfigured() || !userId) return;

    const channel = supabase
      .channel(`notifications-${userId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          refresh({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const markRead = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return false;
    const previous = notifications;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));

    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);

    if (err) {
      setNotifications(previous);
      setError(getErrorMessage(err, 'Could not mark the notification as read.'));
      return false;
    }
    return true;
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    if (!isSupabaseConfigured()) return false;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return true;

    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', unreadIds);

    if (err) {
      setNotifications(previous);
      setError(getErrorMessage(err, 'Could not mark all notifications as read.'));
      return false;
    }
    return true;
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}
