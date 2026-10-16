import React, { useEffect, useState } from 'react';
import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Video,
  Lightbulb,
  Plus,
  Users,
  Megaphone,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Project, Task, Meeting, Announcement, Idea } from '../types/database';
import { filterOverdueTasks, isTaskDueSoon } from '../utils/rules';

interface DashboardViewProps {
  onNavigateTab: (tab: string) => void;
  onOpenCreateProject: () => void;
  onOpenScheduleMeeting: () => void;
  onOpenSubmitIdea: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateTab,
  onOpenCreateProject,
  onOpenScheduleMeeting,
  onOpenSubmitIdea,
}) => {
  const { organization, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [activeMembersCount, setActiveMembersCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Projects
      let projectQuery = supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (organization?.id) {
        projectQuery = projectQuery.eq('organization_id', organization.id);
      }
      const { data: projectData, error: projErr } = await projectQuery;
      if (projErr) throw projErr;
      setProjects((projectData as Project[]) || []);

      // 2. Tasks
      const { data: taskData, error: taskErr } = await supabase
        .from('tasks')
        .select('*, project:projects(*)')
        .order('due_date', { ascending: true });
      if (taskErr) throw taskErr;
      setTasks((taskData as Task[]) || []);

      // 3. Meetings
      let meetingQuery = supabase.from('meetings').select('*').order('start_time', { ascending: true });
      if (organization?.id) {
        meetingQuery = meetingQuery.eq('organization_id', organization.id);
      }
      const { data: meetingData, error: meetErr } = await meetingQuery;
      if (meetErr) throw meetErr;
      setMeetings((meetingData as Meeting[]) || []);

      // 4. Announcements
      let annQuery = supabase.from('announcements').select('*, author:profiles(*)').order('created_at', { ascending: false }).limit(5);
      if (organization?.id) {
        annQuery = annQuery.eq('organization_id', organization.id);
      }
      const { data: annData } = await annQuery;
      setAnnouncements((annData as Announcement[]) || []);

      // 5. Ideas
      let ideaQuery = supabase.from('ideas').select('*').order('created_at', { ascending: false });
      if (organization?.id) {
        ideaQuery = ideaQuery.eq('organization_id', organization.id);
      }
      const { data: ideaData } = await ideaQuery;
      setIdeas((ideaData as Idea[]) || []);

      // 6. Active Members Count
      let memberQuery = supabase
        .from('organization_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      if (organization?.id) {
        memberQuery = memberQuery.eq('organization_id', organization.id);
      }
      const { count: memberCount } = await memberQuery;
      setActiveMembersCount(memberCount || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to query database records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [organization?.id]);

  // Derived calculations from actual records (STRICT: 0 when empty)
  const activeProjectsCount = projects.filter((p) => p.status === 'active').length;
  const projectsRequiringAttention = projects.filter((p) => p.status === 'on_hold' || p.priority === 'urgent').length;
  const overdueTasks = filterOverdueTasks(tasks);
  const tasksDueSoon = tasks.filter((t) => t.status !== 'done' && isTaskDueSoon(t.due_date));
  const upcomingMeetings = meetings.filter((m) => m.status === 'scheduled' || m.status === 'live');
  const pendingIdeasCount = ideas.filter((i) => i.status === 'submitted' || i.status === 'under_review').length;

  return (
    <div className="space-y-6">
      {/* Top Banner & Primary Actions */}
      <div className="bg-white p-6 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#172B4D]">
            Leadership & Operations Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-[#65758B] mt-0.5">
            Real-time telemetry and operational metrics queried directly from your organization database.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="p-2 border border-[#DCE5F0] hover:bg-[#F5F8FC] text-[#65758B] rounded-lg text-xs font-medium transition"
            title="Refresh database records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#123B73]' : ''}`} />
          </button>
          <button
            onClick={onOpenCreateProject}
            className="px-3 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Project
          </button>
          <button
            onClick={onOpenScheduleMeeting}
            className="px-3 py-2 bg-[#2457A7] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Video className="w-3.5 h-3.5" />
            Schedule Meet
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchDashboardData}
            className="text-xs font-semibold underline hover:text-red-900"
          >
            Retry Query
          </button>
        </div>
      )}

      {/* KPI Cards Grid - STRICT REAL DATA: 0 when empty */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Projects */}
        <div
          onClick={() => onNavigateTab('projects')}
          className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs cursor-pointer hover:border-[#123B73] transition"
        >
          <div className="flex items-center justify-between text-[#65758B] text-xs font-medium mb-1">
            <span>Active Projects</span>
            <FolderKanban className="w-4 h-4 text-[#123B73]" />
          </div>
          <div className="text-2xl font-extrabold text-[#172B4D]">
            {loading ? '-' : activeProjectsCount}
          </div>
          <div className="text-[11px] text-[#65758B] mt-1 flex items-center justify-between">
            <span>{projects.length} Total Registered</span>
            {projectsRequiringAttention > 0 && (
              <span className="text-amber-600 font-semibold">{projectsRequiringAttention} need attention</span>
            )}
          </div>
        </div>

        {/* Tasks Due Soon */}
        <div
          onClick={() => onNavigateTab('projects')}
          className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs cursor-pointer hover:border-[#123B73] transition"
        >
          <div className="flex items-center justify-between text-[#65758B] text-xs font-medium mb-1">
            <span>Tasks Due Soon</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-[#172B4D]">
            {loading ? '-' : tasksDueSoon.length}
          </div>
          <div className="text-[11px] text-[#65758B] mt-1 flex items-center justify-between">
            <span>Due in ≤ 3 days</span>
            {overdueTasks.length > 0 && (
              <span className="text-red-600 font-bold">{overdueTasks.length} overdue</span>
            )}
          </div>
        </div>

        {/* Upcoming Meetings */}
        <div
          onClick={() => onNavigateTab('meet')}
          className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs cursor-pointer hover:border-[#123B73] transition"
        >
          <div className="flex items-center justify-between text-[#65758B] text-xs font-medium mb-1">
            <span>Upcoming Meetings</span>
            <Video className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-[#172B4D]">
            {loading ? '-' : upcomingMeetings.length}
          </div>
          <div className="text-[11px] text-[#65758B] mt-1">
            <span>Sam_Teck Meet Sessions</span>
          </div>
        </div>

        {/* Active Members */}
        <div
          onClick={() => onNavigateTab('members')}
          className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs cursor-pointer hover:border-[#123B73] transition"
        >
          <div className="flex items-center justify-between text-[#65758B] text-xs font-medium mb-1">
            <span>Active Team Members</span>
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-extrabold text-[#172B4D]">
            {loading ? '-' : activeMembersCount}
          </div>
          <div className="text-[11px] text-[#65758B] mt-1">
            <span>Authorized Org Members</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Projects Overview + Meetings & Announcements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Projects & Tasks Status */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Projects List or Empty State */}
          <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#DCE5F0]">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-[#123B73]" />
                <h2 className="text-sm font-bold text-[#172B4D]">Recent Projects</h2>
              </div>
              <button
                onClick={() => onNavigateTab('projects')}
                className="text-xs text-[#123B73] hover:underline font-semibold flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-[#65758B]">
                <div className="animate-spin w-5 h-5 border-2 border-[#123B73] border-t-transparent rounded-full mx-auto mb-2" />
                Querying projects from Supabase...
              </div>
            ) : projects.length === 0 ? (
              <div className="py-10 text-center border-2 border-dashed border-[#DCE5F0] rounded-lg p-6">
                <FolderKanban className="w-10 h-10 text-[#65758B]/40 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-[#172B4D]">No projects yet</h3>
                <p className="text-xs text-[#65758B] max-w-sm mx-auto mt-1 mb-4">
                  Create your first project to start tracking deliverables, assigning tasks, and organizing milestones.
                </p>
                <button
                  onClick={onOpenCreateProject}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition shadow-xs"
                >
                  Create Project
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#DCE5F0]">
                {projects.slice(0, 5).map((project) => (
                  <div
                    key={project.id}
                    onClick={() => onNavigateTab('projects')}
                    className="py-3 flex items-center justify-between hover:bg-[#F5F8FC] px-2 rounded-lg cursor-pointer transition"
                  >
                    <div>
                      <div className="font-semibold text-xs text-[#172B4D]">{project.name}</div>
                      <div className="text-[11px] text-[#65758B] line-clamp-1">
                        {project.description || 'No description provided'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-[#123B73] border border-[#DCE5F0]">
                        {project.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Overdue / Attention Tasks */}
          <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#DCE5F0]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-bold text-[#172B4D]">Tasks Requiring Attention</h2>
              </div>
              <button
                onClick={() => onNavigateTab('projects')}
                className="text-xs text-[#123B73] hover:underline font-semibold"
              >
                Task Board
              </button>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-[#65758B]">Loading task records...</div>
            ) : overdueTasks.length === 0 && tasksDueSoon.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#65758B]">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-70" />
                <span>No overdue tasks. All scheduled tasks are on track.</span>
              </div>
            ) : (
              <div className="divide-y divide-[#DCE5F0]">
                {overdueTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-red-600 mr-2">[OVERDUE]</span>
                      <span className="font-medium text-[#172B4D]">{task.title}</span>
                    </div>
                    <span className="text-[11px] text-[#65758B]">Due: {task.due_date}</span>
                  </div>
                ))}
                {tasksDueSoon.slice(0, 3).map((task) => (
                  <div key={task.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-amber-600 mr-2">[DUE SOON]</span>
                      <span className="font-medium text-[#172B4D]">{task.title}</span>
                    </div>
                    <span className="text-[11px] text-[#65758B]">Due: {task.due_date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: Upcoming Meetings & Announcements */}
        <div className="space-y-6">
          {/* Upcoming Sam_Teck Meet Sessions */}
          <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#DCE5F0]">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-[#172B4D]">Sam_Teck Meet</h2>
              </div>
              <button
                onClick={onOpenScheduleMeeting}
                className="text-xs text-[#123B73] hover:underline font-semibold"
              >
                + Schedule
              </button>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-[#65758B]">Loading sessions...</div>
            ) : upcomingMeetings.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#65758B]">
                <Video className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                <p className="font-medium text-[#172B4D]">No upcoming meetings</p>
                <p className="text-[11px] text-[#65758B] mt-1 mb-3">
                  Schedule virtual collaboration sessions with LiveKit real-time video.
                </p>
                <button
                  onClick={onOpenScheduleMeeting}
                  className="px-3 py-1.5 bg-[#2457A7] text-white rounded text-xs font-semibold hover:bg-blue-600 transition"
                >
                  Schedule Session
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {upcomingMeetings.slice(0, 3).map((meeting) => (
                  <div
                    key={meeting.id}
                    onClick={() => onNavigateTab('meet')}
                    className="p-3 rounded-lg border border-[#DCE5F0] hover:border-[#123B73] bg-[#F5F8FC]/50 cursor-pointer transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-xs text-[#172B4D]">{meeting.title}</div>
                      {meeting.status === 'live' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500 text-white animate-pulse">
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#65758B] mt-1">
                      {new Date(meeting.start_time).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })} ({meeting.duration_minutes} min)
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Announcements */}
          <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#DCE5F0]">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-[#123B73]" />
                <h2 className="text-sm font-bold text-[#172B4D]">Team Announcements</h2>
              </div>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-[#65758B]">Loading announcements...</div>
            ) : announcements.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#65758B]">
                <Megaphone className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                <p className="font-medium text-[#172B4D]">No announcements yet</p>
                <p className="text-[11px] text-[#65758B] mt-1">
                  Leadership updates and team announcements will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {announcements.map((ann) => (
                  <div key={ann.id} className="p-3 rounded-lg border border-[#DCE5F0] bg-white">
                    <div className="font-semibold text-xs text-[#172B4D]">{ann.title}</div>
                    <p className="text-[11px] text-[#65758B] mt-1 line-clamp-2">{ann.content}</p>
                    <div className="text-[10px] text-[#65758B]/80 mt-2">
                      {new Date(ann.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Innovation Quick Card */}
          <div className="bg-gradient-to-br from-[#123B73] to-[#0B1F3A] text-white rounded-xl p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-amber-300" />
              <h3 className="font-bold text-sm">Innovation Lab</h3>
            </div>
            <p className="text-xs text-blue-100/90 mb-4">
              {pendingIdeasCount > 0
                ? `${pendingIdeasCount} proposal${pendingIdeasCount > 1 ? 's' : ''} awaiting review`
                : 'Turn your technology ideas and problem statements into completed projects.'}
            </p>
            <button
              onClick={onOpenSubmitIdea}
              className="w-full py-2 bg-white hover:bg-blue-50 text-[#123B73] font-semibold text-xs rounded-lg transition"
            >
              Submit Idea Proposal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
