import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Pin, Check, RefreshCw, MessageSquare, FolderKanban } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Announcement, Project, Task } from '../../types/database';
import { describeAccessError, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard } from '../../components/ui';

/**
 * Announcements and team activity the member is authorised to see.
 *
 * Read state lives in public.announcement_reads (one row per member per
 * announcement) so "unread" is a genuine record rather than a visual guess.
 * There is no private messaging here because the schema has no direct
 * messaging model — inventing one would be an insecure addition.
 */
export const MemberMessagesView: React.FC = () => {
  const { user, organization } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured() || !user) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        let annQuery = supabase
          .from('announcements')
          // `announcement_reads` creates a second path from announcements to
          // profiles, so the author relationship must be named explicitly.
          .select('*, author:profiles!author_id(full_name, email, avatar_url)')
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false });
        if (organization?.id) annQuery = annQuery.eq('organization_id', organization.id);
        const { data: annData, error: annErr } = await annQuery;
        if (annErr) throw annErr;
        setAnnouncements((annData as Announcement[]) || []);

        const { data: readData } = await supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', user.id);
        setReadIds(new Set((readData || []).map((r) => r.announcement_id as string)));

        // Team updates derived from real records the member is part of.
        const [taskRes, projRes] = await Promise.all([
          supabase
            .from('tasks')
            .select('*, project:projects(name)')
            .order('updated_at', { ascending: false })
            .limit(25),
          supabase.from('projects').select('*').order('updated_at', { ascending: false }).limit(10),
        ]);
        const myTasks = ((taskRes.data as Task[]) || []).filter(
          (t) => t.assignee_id === user.id || t.created_by === user.id
        );
        setTasks(myTasks);
        setProjects((projRes.data as Project[]) || []);
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [user?.id, organization?.id]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const markRead = async (announcement: Announcement) => {
    if (!user || readIds.has(announcement.id)) return;
    setBusy(true);
    try {
      const { error: err } = await supabase
        .from('announcement_reads')
        .upsert({ announcement_id: announcement.id, user_id: user.id }, { onConflict: 'announcement_id,user_id' });
      if (err) throw err;
      setReadIds((prev) => new Set(prev).add(announcement.id));
    } catch (err: unknown) {
      setError(describeAccessError(err));
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    if (!user || announcements.length === 0) return;
    setBusy(true);
    try {
      const rows = announcements
        .filter((a) => !readIds.has(a.id))
        .map((a) => ({ announcement_id: a.id, user_id: user.id }));
      if (rows.length === 0) return;
      const { error: err } = await supabase
        .from('announcement_reads')
        .upsert(rows, { onConflict: 'announcement_id,user_id' });
      if (err) throw err;
      setReadIds(new Set(announcements.map((a) => a.id)));
    } catch (err: unknown) {
      setError(describeAccessError(err));
    } finally {
      setBusy(false);
    }
  };

  const unread = announcements.filter((a) => !readIds.has(a.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Messages & Announcements"
        description="Team updates from leadership and the activity around your work."
        icon={Megaphone}
        actions={
          <>
            <button onClick={() => fetchData()} disabled={loading} className="p-2 border border-[#DCE5F0] bg-white hover:bg-[#F5F8FC] rounded-lg text-xs transition disabled:opacity-50" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#123B73]' : ''}`} />
            </button>
            <button onClick={markAllRead} disabled={busy || unread.length === 0} className="px-3.5 py-2 border border-[#DCE5F0] bg-white hover:bg-[#F5F8FC] rounded-lg text-xs font-semibold transition disabled:opacity-50">
              Mark all as read
            </button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => fetchData()} />}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading announcements…" />
        </div>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="When leadership publishes an update it appears here and you receive a notification. Announcements are written by team leads — members do not post to the whole organisation."
        />
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-[#65758B]">
            {unread.length} unread of {announcements.length} announcement{announcements.length === 1 ? '' : 's'}
          </div>
          {announcements.map((ann) => {
            const isRead = readIds.has(ann.id);
            return (
              <article
                key={ann.id}
                className={`bg-white p-5 rounded-xl border shadow-xs ${
                  isRead ? 'border-[#DCE5F0]' : 'border-[#2457A7]/40 bg-blue-50/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-[#172B4D]">{ann.title}</h3>
                      {ann.is_pinned && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                          <Pin className="w-3 h-3" />
                          Pinned
                        </span>
                      )}
                      {!isRead && <Chip tone="info">Unread</Chip>}
                    </div>
                    <p className="text-xs text-[#65758B] mt-2 whitespace-pre-wrap">{ann.content}</p>
                    <div className="text-[11px] text-[#65758B] mt-3">
                      {ann.author?.full_name || ann.author?.email || 'Leadership'} ·{' '}
                      {formatRelativeTime(ann.created_at)}
                    </div>
                  </div>

                  {!isRead && (
                    <button
                      onClick={() => markRead(ann)}
                      disabled={busy}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE5F0] bg-white text-[11px] font-semibold text-[#123B73] hover:bg-[#F5F8FC] disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Mark read
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Team activity derived from real records — no synthetic feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Recent activity on your tasks" icon={MessageSquare}>
          {tasks.length === 0 ? (
            <p className="text-xs text-[#65758B]">
              No task activity yet. Tasks assigned to you or created by you will show their latest changes here.
            </p>
          ) : (
            <div className="divide-y divide-[#DCE5F0]">
              {tasks.slice(0, 8).map((t) => (
                <div key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#172B4D] truncate">{t.title}</div>
                    <div className="text-[11px] text-[#65758B] truncate">{t.project?.name || 'No project'}</div>
                  </div>
                  <span className="text-[11px] text-[#65758B] shrink-0">{formatRelativeTime(t.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent project updates" icon={FolderKanban}>
          {projects.length === 0 ? (
            <p className="text-xs text-[#65758B]">
              You are not following any projects yet. Projects appear here once you join their team or are assigned work.
            </p>
          ) : (
            <div className="divide-y divide-[#DCE5F0]">
              {projects.slice(0, 8).map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#172B4D] truncate">{p.name}</div>
                    <div className="text-[11px] text-[#65758B] capitalize">{p.status.replace('_', ' ')}</div>
                  </div>
                  <span className="text-[11px] text-[#65758B] shrink-0">{formatRelativeTime(p.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
