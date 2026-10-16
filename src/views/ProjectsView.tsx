import React, { useEffect, useState } from 'react';
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  Calendar,
  User,
  ArrowRight,
  X,
  Target
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Project, Task, TaskStatus, TaskPriority, Milestone } from '../types/database';
import { calculateTaskProgress } from '../utils/rules';

const KANBAN_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  { id: 'todo', label: 'To Do', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'in_review', label: 'In Review', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'blocked', label: 'Blocked', color: 'bg-red-50 text-red-700 border-red-200' },
  { id: 'done', label: 'Done', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

export const ProjectsView: React.FC = () => {
  const { user, organization, role } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'milestones'>('board');

  // Modals
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);

  // New Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectObjectives, setNewProjectObjectives] = useState('');
  const [newProjectPriority, setNewProjectPriority] = useState<TaskPriority>('medium');
  const [newProjectStartDate, setNewProjectStartDate] = useState('');
  const [newProjectEndDate, setNewProjectEndDate] = useState('');
  const [newProjectBudget, setNewProjectBudget] = useState('0');
  const [isSubmittingProject, setIsSubmittingProject] = useState(false);

  // New Task Form State
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('todo');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskCriteria, setNewTaskCriteria] = useState('');
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  const fetchProjects = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (organization?.id) {
        query = query.eq('organization_id', organization.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      const list = (data as Project[]) || [];
      setProjects(list);
      if (list.length > 0 && !selectedProject) {
        setSelectedProject(list[0]);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectDetails = async (projectId: string) => {
    try {
      // 1. Fetch tasks
      const { data: taskData, error: taskErr } = await supabase
        .from('tasks')
        .select('*, assignee:profiles(*)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (taskErr) throw taskErr;
      setTasks((taskData as Task[]) || []);

      // 2. Fetch milestones
      const { data: mData, error: mErr } = await supabase
        .from('milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('due_date', { ascending: true });
      if (mErr) throw mErr;
      setMilestones((mData as Milestone[]) || []);
    } catch (err) {
      console.error('Error fetching project tasks & milestones:', err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [organization?.id]);

  useEffect(() => {
    if (selectedProject?.id) {
      fetchProjectDetails(selectedProject.id);
    } else {
      setTasks([]);
      setMilestones([]);
    }
  }, [selectedProject?.id]);

  // Handle Real Task Status Update in Supabase
  const handleUpdateTaskStatus = async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabase
          .from('tasks')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', taskId);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to update task status in Supabase:', err);
        if (selectedProject) fetchProjectDetails(selectedProject.id);
      }
    }
  };

  // Create Project in Supabase
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    setIsSubmittingProject(true);

    try {
      const slug = newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';

      const { data, error } = await supabase
        .from('projects')
        .insert({
          organization_id: orgId,
          name: newProjectName.trim(),
          slug,
          description: newProjectDesc.trim() || null,
          objectives: newProjectObjectives.trim() || null,
          owner_id: user.id,
          priority: newProjectPriority,
          target_start_date: newProjectStartDate || null,
          target_end_date: newProjectEndDate || null,
          budget: parseFloat(newProjectBudget) || 0,
          status: 'planning',
        })
        .select()
        .single();

      if (error) throw error;

      setShowCreateProject(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setNewProjectObjectives('');
      fetchProjects();
      if (data) setSelectedProject(data as Project);
    } catch (err) {
      console.error('Failed to insert project into Supabase:', err);
      alert('Error creating project: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingProject(false);
    }
  };

  // Create Task in Supabase
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedProject || !user) return;
    setIsSubmittingTask(true);

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          project_id: selectedProject.id,
          title: newTaskTitle.trim(),
          description: newTaskDesc.trim() || null,
          status: newTaskStatus,
          priority: newTaskPriority,
          due_date: newTaskDueDate || null,
          acceptance_criteria: newTaskCriteria.trim() || null,
          created_by: user.id,
        })
        .select('*, assignee:profiles(*)')
        .single();

      if (error) throw error;

      setShowCreateTask(false);
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskCriteria('');
      if (data) {
        setTasks((prev) => [data as Task, ...prev]);
      }
    } catch (err) {
      console.error('Failed to insert task into Supabase:', err);
      alert('Error creating task: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const projectProgress = calculateTaskProgress(tasks);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-[#123B73]" />
            Project & Task Management
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Deliverables, Kanban board, milestones, and status workflows persisted in Supabase.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateProject(true)}
            className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        /* Honest empty state when no projects in database */
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center max-w-xl mx-auto shadow-xs">
          <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto mb-4">
            <FolderKanban className="w-8 h-8 text-[#123B73]" />
          </div>
          <h2 className="text-lg font-bold text-[#172B4D]">No projects yet</h2>
          <p className="text-xs text-[#65758B] mt-1.5 mb-6">
            Create your first project to start tracking work, assigning tasks to team members, and collaborating on milestones.
          </p>
          <button
            onClick={() => setShowCreateProject(true)}
            className="px-4 py-2.5 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition shadow-xs inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </button>
        </div>
      ) : (
        /* Workspace layout: Project Selector Bar + Active Project Workboard */
        <div className="space-y-6">
          {/* Project selector dropdown/chips */}
          <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-[#65758B]">Select Project:</label>
              <select
                value={selectedProject?.id || ''}
                onChange={(e) => {
                  const proj = projects.find((p) => p.id === e.target.value);
                  if (proj) setSelectedProject(proj);
                }}
                className="text-xs font-semibold text-[#172B4D] bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#123B73]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            </div>

            {selectedProject && (
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[#65758B]">Progress:</span>
                  <div className="w-24 bg-[#DCE5F0] rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-[#123B73] h-full transition-all duration-300"
                      style={{ width: `${projectProgress}%` }}
                    />
                  </div>
                  <span className="font-bold text-[#172B4D]">{projectProgress}%</span>
                </div>

                <button
                  onClick={() => setShowCreateTask(true)}
                  className="px-3 py-1.5 bg-[#2457A7] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Task
                </button>
              </div>
            )}
          </div>

          {/* Project Details Tabs */}
          {selectedProject && (
            <div className="space-y-4">
              <div className="flex border-b border-[#DCE5F0] text-xs font-semibold space-x-4">
                <button
                  onClick={() => setActiveTab('board')}
                  className={`pb-2.5 transition border-b-2 ${
                    activeTab === 'board'
                      ? 'border-[#123B73] text-[#123B73]'
                      : 'border-transparent text-[#65758B] hover:text-[#172B4D]'
                  }`}
                >
                  Kanban Board ({tasks.length})
                </button>
                <button
                  onClick={() => setActiveTab('list')}
                  className={`pb-2.5 transition border-b-2 ${
                    activeTab === 'list'
                      ? 'border-[#123B73] text-[#123B73]'
                      : 'border-transparent text-[#65758B] hover:text-[#172B4D]'
                  }`}
                >
                  Task List
                </button>
                <button
                  onClick={() => setActiveTab('milestones')}
                  className={`pb-2.5 transition border-b-2 ${
                    activeTab === 'milestones'
                      ? 'border-[#123B73] text-[#123B73]'
                      : 'border-transparent text-[#65758B] hover:text-[#172B4D]'
                  }`}
                >
                  Milestones ({milestones.length})
                </button>
              </div>

              {/* 1. KANBAN BOARD */}
              {activeTab === 'board' && (
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto pb-4">
                  {KANBAN_COLUMNS.map((col) => {
                    const columnTasks = tasks.filter((t) => t.status === col.id);
                    return (
                      <div
                        key={col.id}
                        className="bg-white rounded-xl border border-[#DCE5F0] p-3 flex flex-col min-w-[200px] shadow-xs"
                      >
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#DCE5F0]">
                          <span className="text-xs font-bold text-[#172B4D]">{col.label}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#F5F8FC] border border-[#DCE5F0] text-[#65758B]">
                            {columnTasks.length}
                          </span>
                        </div>

                        <div className="space-y-2.5 flex-1 min-h-[220px]">
                          {columnTasks.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-[11px] text-[#65758B]/50 border border-dashed border-[#DCE5F0] rounded-lg p-3 text-center">
                              No tasks
                            </div>
                          ) : (
                            columnTasks.map((task) => (
                              <div
                                key={task.id}
                                className="bg-[#F5F8FC] p-2.5 rounded-lg border border-[#DCE5F0] text-xs space-y-2 hover:border-[#123B73] transition"
                              >
                                <div className="font-semibold text-[#172B4D] leading-snug">
                                  {task.title}
                                </div>
                                {task.description && (
                                  <p className="text-[11px] text-[#65758B] line-clamp-2">
                                    {task.description}
                                  </p>
                                )}

                                <div className="flex items-center justify-between pt-1 border-t border-[#DCE5F0]/60 text-[10px] text-[#65758B]">
                                  <span className="capitalize font-medium">{task.priority}</span>
                                  {task.due_date && <span>Due {task.due_date}</span>}
                                </div>

                                {/* Status movement picker */}
                                <div className="pt-1 flex items-center justify-between">
                                  <select
                                    value={task.status}
                                    onChange={(e) =>
                                      handleUpdateTaskStatus(task.id, e.target.value as TaskStatus)
                                    }
                                    className="w-full text-[10px] font-semibold bg-white border border-[#DCE5F0] rounded px-1.5 py-1 text-[#172B4D] focus:outline-none"
                                  >
                                    {KANBAN_COLUMNS.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        Move to {c.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. TASK LIST VIEW */}
              {activeTab === 'list' && (
                <div className="bg-white rounded-xl border border-[#DCE5F0] overflow-hidden shadow-xs">
                  {tasks.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[#65758B]">
                      No tasks created for this project yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F5F8FC] border-b border-[#DCE5F0] text-[#65758B] font-semibold">
                          <tr>
                            <th className="px-4 py-3">Task Title</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Priority</th>
                            <th className="px-4 py-3">Due Date</th>
                            <th className="px-4 py-3">Assignee</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE5F0]">
                          {tasks.map((task) => (
                            <tr key={task.id} className="hover:bg-[#F5F8FC]/50">
                              <td className="px-4 py-3 font-medium text-[#172B4D]">
                                {task.title}
                                {task.acceptance_criteria && (
                                  <p className="text-[10px] text-[#65758B] mt-0.5">
                                    Criteria: {task.acceptance_criteria}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-[#123B73] border border-[#DCE5F0]">
                                  {task.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 capitalize text-[#172B4D]">
                                {task.priority}
                              </td>
                              <td className="px-4 py-3 text-[#65758B]">
                                {task.due_date || 'None'}
                              </td>
                              <td className="px-4 py-3 text-[#65758B]">
                                {task.assignee?.full_name || 'Unassigned'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 3. MILESTONES VIEW */}
              {activeTab === 'milestones' && (
                <div className="bg-white rounded-xl border border-[#DCE5F0] p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-[#172B4D]">Project Milestones</h3>
                  </div>
                  {milestones.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#65758B] border border-dashed border-[#DCE5F0] rounded-lg p-6">
                      <Target className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
                      <p className="font-semibold text-[#172B4D]">No milestones defined</p>
                      <p className="text-[11px] text-[#65758B] mt-1">
                        Break your project down into key deliverables and target dates.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {milestones.map((m) => (
                        <div
                          key={m.id}
                          className="p-3.5 rounded-lg border border-[#DCE5F0] bg-[#F5F8FC]/50 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-semibold text-xs text-[#172B4D]">{m.title}</div>
                            {m.description && (
                              <p className="text-[11px] text-[#65758B] mt-0.5">{m.description}</p>
                            )}
                          </div>
                          <div className="text-right text-xs">
                            <span className="text-[#65758B]">Target: {m.due_date || 'TBD'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CREATE PROJECT MODAL */}
      {showCreateProject && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Create New Project</h2>
              <button
                onClick={() => setShowCreateProject(false)}
                className="text-[#65758B] hover:text-[#172B4D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NextGen Web Platform"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Scope & Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Outline the scope and deliverable goals..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Priority</label>
                  <select
                    value={newProjectPriority}
                    onChange={(e) => setNewProjectPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Allocated Budget (GHS / USD)
                  </label>
                  <input
                    type="number"
                    value={newProjectBudget}
                    onChange={(e) => setNewProjectBudget(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={newProjectStartDate}
                    onChange={(e) => setNewProjectStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Target End Date
                  </label>
                  <input
                    type="date"
                    value={newProjectEndDate}
                    onChange={(e) => setNewProjectEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowCreateProject(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingProject}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmittingProject ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE TASK MODAL */}
      {showCreateTask && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Add New Task</h2>
              <button
                onClick={() => setShowCreateTask(false)}
                className="text-[#65758B] hover:text-[#172B4D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Implement authentication middleware"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Task details and technical requirements..."
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Status</label>
                  <select
                    value={newTaskStatus}
                    onChange={(e) => setNewTaskStatus(e.target.value as TaskStatus)}
                    className="w-full px-2 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
                  >
                    {KANBAN_COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                    className="w-full px-2 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Acceptance Criteria
                </label>
                <input
                  type="text"
                  placeholder="e.g. Unit tests pass and code merged to main"
                  value={newTaskCriteria}
                  onChange={(e) => setNewTaskCriteria(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowCreateTask(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTask}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmittingTask ? 'Adding...' : 'Add Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
