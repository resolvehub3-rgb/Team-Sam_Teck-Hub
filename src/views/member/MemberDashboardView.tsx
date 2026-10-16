import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckSquare,
  Clock,
  AlertTriangle,
  FolderKanban,
  Video,
  Bell,
  Megaphone,
  Lightbulb,
  GraduationCap,
  CalendarDays,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Announcement, Department, Idea, Meeting, Project, Task } from '../../types/database';
import { filterOverdueTasks, isTaskDueSoon } from '../../utils/rules';
import { getErrorMessage, formatDate, initialsOf, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, buttonStyles } from '../../components/ui';
import { NavigationTab } from '../../utils/routes';

interface MemberDashboardViewProps {
  onNavigate: (tab: NavigationTab) => void;
  unreadCount: number;
}

/** Priority ordering used everywhere in My Tasks so views agree. */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const MemberDashboardView: React.FC<MemberDashboardViewProps> = ({ onNavigate, unreadCount }) => {
  const { user, profile, organization } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [department, setDepartment] = useState<Department | null>(null);

  const fetchDashboard = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured() || !user) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);

      try {
        // Every query below returns only what RLS already authorises, so the
        // dashboard can never show another member's private work.
        const [taskRes, projectRes, meetingRes, ideaRes] = await Promise.all([
          supabase
            .from('tasks')
            .select('*, project:projects(*)')
            .eq('assignee_id', user.id)
            .order('due_date', { ascending: true, nullsFirst: false }),
          supabase.from('projects').select('*').order('created_at', { ascending: false }),
          supabase.from('meetings').select('*, host:profiles(*)').order('start_time', { ascending: true }),
          supabase.from('ideas').select('*').order('created_at', { ascending: false }).limit(50),
        ]);

        if (taskRes.error) throw taskRes.error;
        if (projectRes.error) throw projectRes.error;
        if (meetingRes.error) throw meetingRes.error;

        setTasks((taskRes.data as Task[]) || []);
        setProjects((projectRes.data as Project[]) || []);
        setMeetings((meetingRes.data as Meeting[]) || []);
        setIdeas((ideaRes.data as Idea[]) || []);

        let annQuery = supabase
          .from('announcements')
          // `announcement_reads` adds a second path from announcements to
          // profiles, so the author relationship must be named explicitly.
          .select('*, author:profiles!author_id(*)')
          .order('created_at', { ascending: false })
          .limit(4);
        if (organization?.id) annQuery = annQuery.eq('organization_id', organization.id);
        const { data: annData } = await annQuery;
        setAnnouncements((annData as Announcement[]) || []);

        if (profile?.department_id) {
          const { data: dep } = await supabase
            .from('departments')
            .select('*')
            .eq('id', profile.department_id)
            .maybeSingle();
          setDepartment((dep as Department) || null);
        } else {
          setDepartment(null);
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not load your workspace.'));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [user?.id, organization?.id, profile?.department_id]
  );

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Derived strictly from the records above — a metric with no rows is 0.
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const overdueTasks = filterOverdueTasks(tasks);
  const dueSoonTasks = tasks.filter((t) => t.status !== 'done' && isTaskDueSoon(t.due_date));
  const now = Date.now();
  const upcomingMeetings = meetings.filter(
    (m) => (m.status === 'scheduled' || m.status === 'live') && new Date(m.start_time).getTime() + m.duration_minutes * 60000 > now
  );
  const myIdeas = ideas.filter((i) => i.author_id === user?.id);
  const pendingIdeas = myIdeas.filter((i) => i.status === 'submitted' || i.status === 'under_review');

  const firstName = (profile?.full_name || user?.email?.split('@')[0] || 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const productivityMessage =
    openTasks.length === 0 && upcomingMeetings.length === 0
      ? 'Nothing is assigned to you right now. Browse your projects or submit an idea to get moving.'
      : overdueTasks.length > 0
        ? `You have ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? '' : 's'} — clear those first.`
        : dueSoonTasks.length > 0
          ? `You have ${dueSoonTasks.length} task${dueSoonTasks.length === 1 ? '' : 's'} due in the next three days.`
          : inProgressTasks.length > 0
            ? `You are making progress on ${inProgressTasks.length} task${inProgressTasks.length === 1 ? '' : 's'}.`
            : 'Your schedule is clear. Use the time to learn or explore an idea.';

  const metrics = [
    { label: 'Assigned to me', value: openTasks.length, icon: CheckSquare, color: 'text-[#123B73]', tab: 'tasks' as NavigationTab },
    { label: 'In progress', value: inProgressTasks.length, icon: Clock, color: 'text-amber-600', tab: 'tasks' as NavigationTab },
    { label: 'Due soon', value: dueSoonTasks.length, icon: CalendarDays, color: 'text-blue-600', tab: 'tasks' as NavigationTab },
    { label: 'Overdue', value: overdueTasks.length, icon: AlertTriangle, color: 'text-red-600', tab: 'tasks' as NavigationTab },
    { label: 'My projects', value: projects.length, icon: FolderKanban, color: 'text-indigo-600', tab: 'projects' as NavigationTab },
    { label: 'Upcoming meetings', value: upcomingMeetings.length, icon: Video, color: 'text-emerald-600', tab: 'meetings' as NavigationTab },
    { label: 'My ideas', value: myIdeas.length, icon: Lightbulb, color: 'text-amber-600', tab: 'innovation' as NavigationTab },
  ];

  const previewTasks = openTasks
    .slice()
    .sort((a, b) => {
      const aOverdue = overdueTasks.some((t) => t.id === a.id) ? 0 : 1;
      const bOverdue = overdueTasks.some((t) => t.id === b.id) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const rank = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      if (rank !== 0) return rank;
      return new Date(a.due_date || '2999-01-01').getTime() - new Date(b.due_date || '2999-01-01').getTime();
    })
    .slice(0, 4);

  const statusTone = (status: string) => {
    switch (status) {
      case 'done':
        return 'success';
      case 'in_progress':
        return 'warning';
      case 'blocked':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
        icon={CheckSquare}
        actions={
          <button
            onClick={() => fetchDashboard()}
            disabled={loading}
            className="p-2 border border-[#DCE5F0] hover:bg-[#F5F8FC] text-[#65758B] rounded-lg text-xs font-medium transition"
            title="Refresh your records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#123B73]' : ''}`} />
          </button>
        }
      />

      {/* Welcome band */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center gap-4">
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.full_name || 'Your profile'}
            className="w-14 h-14 rounded-full object-cover border border-[#DCE5F0] shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-[#123B73] text-white flex items-center justify-center text-lg font-bold shrink-0">
            {initialsOf(profile?.full_name || user?.email)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[#172B4D]">{profile?.full_name || user?.email}</h2>
            {department && <Chip tone="info">{department.name}</Chip>}
            {profile?.job_title && <Chip>{profile.job_title}</Chip>}
          </div>
          <p className="text-xs text-[#65758B] mt-1">{productivityMessage}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button onClick={() => onNavigate('tasks')} className={buttonStyles.primary}>
            <CheckSquare className="w-3.5 h-3.5" />
            My Tasks
          </button>
          <button onClick={() => onNavigate('innovation')} className={buttonStyles.secondary}>
            <Lightbulb className="w-3.5 h-3.5" />
            Submit Idea
          </button>
          <button onClick={() => onNavigate('learning')} className={buttonStyles.secondary}>
            <GraduationCap className="w-3.5 h-3.5" />
            Learning
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => fetchDashboard()} />}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Querying your authorized records…" />
        </div>
      ) : (
        <>
          {/* Personal overview — genuine zeros when there are no records */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {metrics.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.label}
                  onClick={() => onNavigate(m.tab)}
                  className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs text-left hover:border-[#123B73] transition"
                >
                  <div className="flex items-center justify-between text-[#65758B] text-[11px] font-medium mb-1">
                    <span>{m.label}</span>
                    <Icon className={`w-4 h-4 ${m.color}`} />
                  </div>
                  <div className="text-2xl font-extrabold text-[#172B4D]">{m.value}</div>
                </button>
              );
            })}
            <button
              onClick={() => onNavigate('notifications')}
              className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs text-left hover:border-[#123B73] transition"
            >
              <div className="flex items-center justify-between text-[#65758B] text-[11px] font-medium mb-1">
                <span>Unread notifications</span>
                <Bell className="w-4 h-4 text-red-500" />
              </div>
              <div className="text-2xl font-extrabold text-[#172B4D]">{unreadCount}</div>
              <div className="text-[10px] text-[#65758B] mt-1">Live from the notification centre</div>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* My tasks preview */}
              <SectionCard
                title="My Tasks"
                icon={CheckSquare}
                action={
                  <button
                    onClick={() => onNavigate('tasks')}
                    className="text-xs text-[#123B73] hover:underline font-semibold flex items-center gap-1"
                  >
                    View all <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                }
              >
                {previewTasks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#65758B]">
                    <CheckSquare className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                    <p className="font-medium text-[#172B4D]">No open tasks assigned to you</p>
                    <p className="mt-1">When a project lead assigns you work, it appears here straight away.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#DCE5F0]">
                    {previewTasks.map((task) => {
                      const isOverdue = overdueTasks.some((t) => t.id === task.id);
                      return (
                        <button
                          key={task.id}
                          onClick={() => onNavigate('tasks')}
                          className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F5F8FC] px-2 rounded-lg transition"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-[#172B4D] truncate">{task.title}</div>
                            <div className="text-[11px] text-[#65758B] truncate">
                              {task.project?.name || 'No project'}
                              {task.due_date ? ` · Due ${formatDate(task.due_date)}` : ' · No due date'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isOverdue && <Chip tone="danger">Overdue</Chip>}
                            <Chip tone={statusTone(task.status) as 'neutral'}>{task.status.replace('_', ' ')}</Chip>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Announcements */}
              <SectionCard
                title="Announcements"
                icon={Megaphone}
                action={
                  <button
                    onClick={() => onNavigate('messages')}
                    className="text-xs text-[#123B73] hover:underline font-semibold"
                  >
                    View all
                  </button>
                }
              >
                {announcements.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#65758B]">
                    <Megaphone className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                    <p className="font-medium text-[#172B4D]">No announcements yet</p>
                    <p className="mt-1">Team updates from leadership will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {announcements.map((ann) => (
                      <div key={ann.id} className="p-3 rounded-lg border border-[#DCE5F0] bg-white">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-xs text-[#172B4D] truncate">{ann.title}</div>
                          {ann.is_pinned && <Chip tone="warning">Pinned</Chip>}
                        </div>
                        <p className="text-[11px] text-[#65758B] mt-1 line-clamp-2">{ann.content}</p>
                        <div className="text-[10px] text-[#65758B]/80 mt-2">
                          {ann.author?.full_name || 'Leadership'} · {formatRelativeTime(ann.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="space-y-6">
              {/* Meetings preview */}
              <SectionCard
                title="Upcoming Meetings"
                icon={Video}
                action={
                  <button
                    onClick={() => onNavigate('meetings')}
                    className="text-xs text-[#123B73] hover:underline font-semibold"
                  >
                    View all
                  </button>
                }
              >
                {upcomingMeetings.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#65758B]">
                    <Video className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                    <p className="font-medium text-[#172B4D]">No upcoming meetings</p>
                    <p className="mt-1">Sessions you are invited to will show up here.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {upcomingMeetings.slice(0, 4).map((meeting) => (
                      <button
                        key={meeting.id}
                        onClick={() => onNavigate('meetings')}
                        className="w-full p-3 rounded-lg border border-[#DCE5F0] hover:border-[#123B73] bg-[#F5F8FC]/50 text-left transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-xs text-[#172B4D] truncate">{meeting.title}</div>
                          {meeting.status === 'live' && <Chip tone="danger">Live</Chip>}
                        </div>
                        <div className="text-[11px] text-[#65758B] mt-1">
                          {formatDate(meeting.start_time, { month: 'short', day: 'numeric' })} ·{' '}
                          {new Date(meeting.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                          {meeting.duration_minutes} min
                        </div>
                        <div className="text-[10px] text-[#65758B]/80 mt-1">
                          {meeting.host?.full_name ? `Hosted by ${meeting.host.full_name}` : 'Host to be confirmed'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Innovation */}
              <div className="bg-gradient-to-br from-[#123B73] to-[#0B1F3A] text-white rounded-xl p-5 shadow-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-amber-300" />
                  <h3 className="font-bold text-sm">Innovation Lab</h3>
                </div>
                <p className="text-xs text-blue-100/90 mb-4">
                  {pendingIdeas.length > 0
                    ? `${pendingIdeas.length} of your idea${pendingIdeas.length === 1 ? ' is' : 's are'} still under review.`
                    : 'Turn a problem you have noticed into a proposal the team can build.'}
                </p>
                <button
                  onClick={() => onNavigate('innovation')}
                  className="w-full py-2 bg-white hover:bg-blue-50 text-[#123B73] font-semibold text-xs rounded-lg transition"
                >
                  Open Innovation Lab
                </button>
              </div>

              <SectionCard title="Team Size" icon={Megaphone}>
                <p className="text-xs text-[#65758B]">
                  {organization ? (
                    <>
                      You are a member of <span className="font-semibold text-[#172B4D]">{organization.name}</span>.
                    </>
                  ) : (
                    'Your account is not currently linked to an organisation.'
                  )}
                </p>
              </SectionCard>
            </div>
          </div>

          {openTasks.length === 0 && projects.length === 0 && meetings.length === 0 && (
            <EmptyState
              icon={FolderKanban}
              title="Your workspace is ready"
              description="Nothing has been assigned to you yet. Explore your projects, or propose an idea in the Innovation Lab to get involved."
              action={
                <button onClick={() => onNavigate('projects')} className={buttonStyles.primary}>
                  <FolderKanban className="w-3.5 h-3.5" />
                  Browse projects
                </button>
              }
            />
          )}
        </>
      )}
    </div>
  );
};
