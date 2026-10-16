import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Search,
  Filter,
  MessageSquare,
  Paperclip,
  Send,
  Upload,
  X,
  Clock,
  AlertTriangle,
  FolderKanban,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured, getAuthHeader } from '../../lib/supabase';
import { Project, Task, TaskPriority, TaskStatus } from '../../types/database';
import { filterOverdueTasks, isTaskDueSoon } from '../../utils/rules';
import { describeAccessError, formatDate, formatRelativeTime, formatBytes } from '../../utils/format';
import { Chip, ErrorState, LoadingState, PageHeader, buttonStyles } from '../../components/ui';

/**
 * Status transitions a task holder is allowed to make. Anything outside this
 * map is a privileged change and is not offered to a member.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['todo', 'in_progress'],
  todo: ['in_progress', 'blocked', 'backlog'],
  in_progress: ['in_review', 'blocked', 'todo'],
  in_review: ['done', 'in_progress'],
  blocked: ['in_progress', 'todo'],
  done: ['in_progress'],
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
};

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface TaskCommentRow {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: { full_name?: string; email?: string } | null;
}

interface TaskAttachmentRow {
  id: string;
  task_id: string;
  file_name: string;
  file_path: string;
  file_size?: number | null;
  mime_type?: string | null;
  uploaded_by: string;
  created_at: string;
}

type SortKey = 'due' | 'priority' | 'updated';

export const MemberTasksView: React.FC = () => {
  const { user, organization } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | 'overdue' | 'soon' | 'none'>('all');
  const [sortBy, setSortBy] = useState<SortKey>('due');

  // Detail panel
  const [selected, setSelected] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskCommentRow[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachmentRow[]>([]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchTasks = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured() || !user) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        // RLS limits this to work the member is genuinely part of; the
        // client-side filter then narrows it to "my" tasks.
        const { data, error: err } = await supabase
          .from('tasks')
          .select('*, project:projects(*)')
          .order('updated_at', { ascending: false });
        if (err) throw err;

        const mine = ((data as Task[]) || []).filter(
          (t) => t.assignee_id === user.id || t.created_by === user.id
        );
        setTasks(mine);

        const { data: pData } = await supabase.from('projects').select('*');
        setProjects((pData as Project[]) || []);
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const loadDetail = useCallback(async (taskId: string) => {
    const [cRes, aRes] = await Promise.all([
      supabase
        .from('task_comments')
        .select('*, user:profiles(full_name, email)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true }),
      supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
    ]);
    setComments((cRes.data as TaskCommentRow[]) || []);
    setAttachments((aRes.data as TaskAttachmentRow[]) || []);
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected.id);
    else {
      setComments([]);
      setAttachments([]);
    }
  }, [selected?.id, loadDetail]);

  const overdue = useMemo(() => filterOverdueTasks(tasks), [tasks]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (projectFilter !== 'all' && t.project_id !== projectFilter) return false;
      if (deadlineFilter === 'overdue' && !overdue.some((o) => o.id === t.id)) return false;
      if (deadlineFilter === 'soon' && !isTaskDueSoon(t.due_date)) return false;
      if (deadlineFilter === 'none' && t.due_date) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.project?.name || '').toLowerCase().includes(q)
      );
    });

    list = list.slice().sort((a, b) => {
      if (sortBy === 'priority') {
        const rank = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
        if (rank !== 0) return rank;
      }
      if (sortBy === 'updated') {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
      // Default: overdue first, then by due date, undated last.
      const aOver = overdue.some((o) => o.id === a.id) ? 0 : 1;
      const bOver = overdue.some((o) => o.id === b.id) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return new Date(a.due_date || '2999-01-01').getTime() - new Date(b.due_date || '2999-01-01').getTime();
    });

    return list;
  }, [tasks, search, statusFilter, priorityFilter, projectFilter, deadlineFilter, sortBy, overdue]);

  const applyUpdate = async (taskId: string, patch: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      const { error: err } = await supabase
        .from('tasks')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (err) throw err;
      setSuccess(successMsg);
      await fetchTasks({ silent: true });
      setSelected((prev) => (prev && prev.id === taskId ? { ...prev, ...(patch as Partial<Task>) } : prev));
    } catch (err: unknown) {
      setActionError(describeAccessError(err));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (task: Task, next: TaskStatus) => applyUpdate(task.id, { status: next }, `Status updated to ${STATUS_LABEL[next]}.`);

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !newComment.trim() || !user) return;
    setBusy(true);
    setActionError(null);
    try {
      const { error: err } = await supabase.from('task_comments').insert({
        task_id: selected.id,
        user_id: user.id,
        content: newComment.trim(),
      });
      if (err) throw err;
      setNewComment('');
      await loadDetail(selected.id);
    } catch (err: unknown) {
      setActionError(describeAccessError(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadAttachment = async (file: File) => {
    if (!selected || !user || !organization) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionError(`Files must be 10 MB or smaller — "${file.name}" is ${formatBytes(file.size)}.`);
      return;
    }
    setUploading(true);
    setActionError(null);
    try {
      // Bytes go through the authenticated server, which scopes the path to
      // this organisation and this user. The task link lives on the
      // `task_attachments` row, not in the path.
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-file-name': file.name,
          ...(await getAuthHeader()),
        },
        body: file,
      });
      const data: { path?: string; error?: string } = await res.json().catch(() => ({ error: 'No response was received.' }));
      if (!res.ok || !data.path) {
        throw new Error(data.error || 'The file could not be uploaded. Try again.');
      }

      const { error: dbErr } = await supabase.from('task_attachments').insert({
        task_id: selected.id,
        file_name: file.name,
        file_path: data.path,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: user.id,
      });
      if (dbErr) throw dbErr;

      await loadDetail(selected.id);
    } catch (err: unknown) {
      setActionError(describeAccessError(err));
    } finally {
      setUploading(false);
    }
  };

  const downloadAttachment = async (att: TaskAttachmentRow) => {
    setActionError(null);
    try {
      // The server re-checks that the caller is an active member of the
      // file's organisation before minting a short-lived link.
      const res = await fetch('/api/documents/download-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ path: att.file_path }),
      });
      const data: { url?: string; error?: string } = await res.json().catch(() => ({ error: 'No response was received.' }));
      if (!res.ok || !data.url) {
        setActionError(data.error || 'This file could not be opened. It may have been removed by its uploader.');
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('This file could not be opened. Check your connection and try again.');
    }
  };

  const counts = {
    all: tasks.length,
    open: tasks.filter((t) => t.status !== 'done').length,
    overdue: overdue.length,
    dueSoon: tasks.filter((t) => t.status !== 'done' && isTaskDueSoon(t.due_date)).length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Tasks"
        description="Work assigned to you, plus tasks you have created."
        icon={CheckSquare}
        actions={
          <button onClick={() => fetchTasks()} disabled={loading} className={buttonStyles.secondary}>
            Refresh
          </button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open', value: counts.open },
          { label: 'Due soon', value: counts.dueSoon },
          { label: 'Overdue', value: counts.overdue, danger: true },
          { label: 'Total assigned', value: counts.all },
        ].map((s) => (
          <div key={s.label} className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
            <div className="text-[11px] text-[#65758B] font-medium">{s.label}</div>
            <div className={`text-xl font-extrabold ${s.danger && s.value > 0 ? 'text-red-600' : 'text-[#172B4D]'}`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="bg-white p-3.5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#65758B] absolute left-3 top-2.5" />
          <input
            type="search"
            placeholder="Search your tasks by title, description or project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73]"
            aria-label="Search tasks"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-[#65758B]" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as 'all' | TaskPriority)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none max-w-[200px]"
            aria-label="Filter by project"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={deadlineFilter}
            onChange={(e) => setDeadlineFilter(e.target.value as 'all' | 'overdue' | 'soon' | 'none')}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
            aria-label="Filter by deadline"
          >
            <option value="all">Any deadline</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Due within 3 days</option>
            <option value="none">No deadline</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none ml-auto"
            aria-label="Sort tasks"
          >
            <option value="due">Sort by deadline</option>
            <option value="priority">Sort by priority</option>
            <option value="updated">Sort by recent activity</option>
          </select>
        </div>
      </div>

      {actionError && <ErrorState message={actionError} onRetry={() => setActionError(null)} />}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" role="status">
          {success}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading your tasks…" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchTasks()} />
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center max-w-lg mx-auto shadow-xs">
          <CheckSquare className="w-12 h-12 text-[#65758B]/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-[#172B4D]">
            {tasks.length === 0 ? 'No tasks assigned to you yet' : 'No tasks match these filters'}
          </h3>
          <p className="text-xs text-[#65758B] mt-1.5 mb-5 max-w-sm mx-auto">
            {tasks.length === 0
              ? 'When a project manager or team lead assigns you work, it appears here and you get a notification.'
              : 'Try clearing a filter or changing the search term.'}
          </p>
          {tasks.length > 0 && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setPriorityFilter('all');
                setProjectFilter('all');
                setDeadlineFilter('all');
              }}
              className={buttonStyles.secondary}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#DCE5F0] divide-y divide-[#DCE5F0] shadow-xs overflow-hidden">
          {visible.map((task) => {
            const isOverdue = overdue.some((o) => o.id === task.id);
            const dueSoon = !isOverdue && isTaskDueSoon(task.due_date);
            const canTransition = ALLOWED_TRANSITIONS[task.status]?.length > 0;
            return (
              <div key={task.id} className="p-4 hover:bg-[#F5F8FC]/60 transition">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button onClick={() => setSelected(task)} className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-[#172B4D]">{task.title}</span>
                      {isOverdue && <Chip tone="danger">Overdue</Chip>}
                      {dueSoon && <Chip tone="warning">Due soon</Chip>}
                    </div>
                    {task.description && (
                      <p className="text-xs text-[#65758B] mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="text-[11px] text-[#65758B] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <FolderKanban className="w-3 h-3" />
                        {task.project?.name || 'No project'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {task.due_date ? `Due ${formatDate(task.due_date)}` : 'No due date'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        Updated {formatRelativeTime(task.updated_at)}
                      </span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <Chip tone={task.priority === 'urgent' || task.priority === 'high' ? 'danger' : 'neutral'}>
                      {task.priority}
                    </Chip>
                    <Chip tone={task.status === 'done' ? 'success' : task.status === 'in_progress' ? 'warning' : 'neutral'}>
                      {STATUS_LABEL[task.status]}
                    </Chip>
                    {canTransition && (
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value) changeStatus(task, e.target.value as TaskStatus);
                        }}
                        className="px-2 py-1.5 text-[11px] border border-[#DCE5F0] rounded-lg bg-white focus:outline-none disabled:opacity-50"
                        aria-label={`Change status of ${task.title}`}
                      >
                        <option value="">Change status…</option>
                        {(ALLOWED_TRANSITIONS[task.status] || []).map((s) => (
                          <option key={s} value={s}>
                            → {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => setSelected(task)}
                      className="p-1.5 text-[#65758B] hover:text-[#123B73] hover:bg-white rounded-lg border border-transparent hover:border-[#DCE5F0]"
                      aria-label={`Open ${task.title}`}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DETAIL PANEL */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-end sm:justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl shadow-xl border border-[#DCE5F0] flex flex-col">
            <div className="px-5 py-4 border-b border-[#DCE5F0] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#172B4D]">{selected.title}</h2>
                <div className="text-[11px] text-[#65758B] mt-0.5 flex flex-wrap gap-x-3">
                  <span>{selected.project?.name || 'No project'}</span>
                  <span>{selected.due_date ? `Due ${formatDate(selected.due_date)}` : 'No due date'}</span>
                  <span>Priority: {selected.priority}</span>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 text-[#65758B] hover:text-[#172B4D] rounded-lg"
                aria-label="Close task details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {selected.description && (
                <div>
                  <h3 className="text-xs font-bold text-[#172B4D] mb-1.5">Description</h3>
                  <p className="text-xs text-[#65758B] whitespace-pre-wrap">{selected.description}</p>
                </div>
              )}

              {selected.acceptance_criteria && (
                <div className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                  <h3 className="text-xs font-bold text-[#172B4D] mb-1.5">Acceptance criteria</h3>
                  <p className="text-xs text-[#65758B] whitespace-pre-wrap">{selected.acceptance_criteria}</p>
                </div>
              )}

              {/* Status transitions the member may actually make */}
              <div>
                <h3 className="text-xs font-bold text-[#172B4D] mb-2">Update status</h3>
                <div className="flex flex-wrap gap-2">
                  {(ALLOWED_TRANSITIONS[selected.status] || []).map((s) => (
                    <button
                      key={s}
                      disabled={busy}
                      onClick={() => changeStatus(selected, s)}
                      className={buttonStyles.secondary}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                  {(ALLOWED_TRANSITIONS[selected.status] || []).length === 0 && (
                    <p className="text-xs text-[#65758B]">
                      No further transitions are available to you on this task.
                    </p>
                  )}
                </div>
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-[#172B4D] flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" />
                    Attachments ({attachments.length})
                  </h3>
                  <label className={`${buttonStyles.secondary} cursor-pointer`}>
                    <Upload className="w-3.5 h-3.5" />
                    {uploading ? 'Uploading…' : 'Attach file'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAttachment(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-[#65758B]">No files attached to this task.</p>
                ) : (
                  <div className="space-y-1.5">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#DCE5F0] text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-[#172B4D] truncate">{att.file_name}</div>
                          <div className="text-[11px] text-[#65758B]">
                            {formatBytes(att.file_size)} · {formatRelativeTime(att.created_at)}
                          </div>
                        </div>
                        <button
                          onClick={() => downloadAttachment(att)}
                          className="text-[#123B73] font-semibold hover:underline shrink-0"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Comments / progress updates */}
              <div>
                <h3 className="text-xs font-bold text-[#172B4D] mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Progress updates ({comments.length})
                </h3>
                {comments.length === 0 ? (
                  <p className="text-xs text-[#65758B]">No updates yet. Add the first one below.</p>
                ) : (
                  <div className="space-y-2.5 mb-3">
                    {comments.map((c) => (
                      <div key={c.id} className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#172B4D]">
                            {c.user?.full_name || c.user?.email || 'A team member'}
                          </span>
                          <span className="text-[10px] text-[#65758B]">{formatRelativeTime(c.created_at)}</span>
                        </div>
                        <p className="text-xs text-[#65758B] mt-1 whitespace-pre-wrap">{c.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={addComment} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Share progress, blockers, or a handover note…"
                    className="flex-1 px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73] resize-none"
                    aria-label="Progress update"
                  />
                  <button type="submit" disabled={busy || !newComment.trim()} className={buttonStyles.primary}>
                    <Send className="w-3.5 h-3.5" />
                    Post
                  </button>
                </form>
              </div>

              {selected.status === 'blocked' && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>This task is marked as blocked. Add an update explaining what is holding it up.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
