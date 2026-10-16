import React, { useCallback, useEffect, useState } from 'react';
import {
  FolderKanban,
  Search,
  Calendar,
  Users,
  CheckSquare,
  FileText,
  Video,
  Target,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Meeting, Milestone, Project, Task } from '../../types/database';
import { calculateTaskProgress } from '../../utils/rules';
import { describeAccessError, formatDate, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard } from '../../components/ui';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  planning: 'neutral',
  active: 'info',
  on_hold: 'warning',
  in_review: 'warning',
  completed: 'success',
  archived: 'neutral',
};

/**
 * Read-only project workspace for members. Creating, deleting, budgeting and
 * team management stay with leadership and are neither offered here nor
 * permitted by the database policies.
 */
export const MemberProjectsView: React.FC = () => {
  const { organization } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [documents, setDocuments] = useState<{ id: string; title: string; file_name: string; created_at: string }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchProjects = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        let query = supabase.from('projects').select('*').order('updated_at', { ascending: false });
        if (organization?.id) query = query.eq('organization_id', organization.id);
        const { data, error: err } = await query;
        if (err) throw err;
        setProjects((data as Project[]) || []);
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [organization?.id]
  );

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const openProject = useCallback(async (project: Project) => {
    setSelected(project);
    setDetailLoading(true);
    try {
      const [tRes, mRes, meetRes, dRes] = await Promise.all([
        supabase.from('tasks').select('*').eq('project_id', project.id).order('due_date', { ascending: true }),
        supabase.from('milestones').select('*').eq('project_id', project.id).order('due_date', { ascending: true }),
        supabase.from('meetings').select('*').eq('project_id', project.id).order('start_time', { ascending: true }),
        supabase.from('documents').select('id, title, file_name, created_at').eq('project_id', project.id).order('created_at', { ascending: false }),
      ]);
      setTasks((tRes.data as Task[]) || []);
      setMilestones((mRes.data as Milestone[]) || []);
      setMeetings((meetRes.data as Meeting[]) || []);
      setDocuments((dRes.data as typeof documents) || []);
    } catch (err: unknown) {
      setError(describeAccessError(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setTasks([]);
      setMilestones([]);
      setMeetings([]);
      setDocuments([]);
    }
  }, [selected?.id]);

  const visible = projects.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
  });

  const progress = selected ? calculateTaskProgress(tasks) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Projects"
        description="Projects you own, manage, sit on, or hold tasks in."
        icon={FolderKanban}
        actions={
          <button onClick={() => fetchProjects()} disabled={loading} className="px-3.5 py-2 border border-[#DCE5F0] bg-white hover:bg-[#F5F8FC] rounded-lg text-xs font-semibold transition disabled:opacity-50">
            Refresh
          </button>
        }
      />

      <div className="bg-white p-3.5 rounded-xl border border-[#DCE5F0] shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-[#65758B] absolute left-3 top-2.5" />
          <input
            type="search"
            placeholder="Search your projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73]"
            aria-label="Search projects"
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading your projects…" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchProjects()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={projects.length === 0 ? 'You are not on any projects yet' : 'No projects match your search'}
          description={
            projects.length === 0
              ? 'You will see a project here as soon as a lead adds you to its team or assigns you a task inside it.'
              : 'Try a different search term.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((project) => (
            <button
              key={project.id}
              onClick={() => openProject(project)}
              className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs text-left hover:border-[#123B73] transition space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-[#172B4D]">{project.name}</h3>
                <Chip tone={STATUS_TONE[project.status] || 'neutral'}>{project.status.replace('_', ' ')}</Chip>
              </div>
              {project.description && <p className="text-xs text-[#65758B] line-clamp-2">{project.description}</p>}
              <div className="text-[11px] text-[#65758B] flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {project.target_end_date ? `Target ${formatDate(project.target_end_date)}` : 'No target date'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {project.priority} priority
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* PROJECT DETAIL */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-3xl h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl shadow-xl border border-[#DCE5F0] flex flex-col">
            <div className="px-5 py-4 border-b border-[#DCE5F0] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-[#172B4D]">{selected.name}</h2>
                  <Chip tone={STATUS_TONE[selected.status] || 'neutral'}>{selected.status.replace('_', ' ')}</Chip>
                </div>
                <div className="text-[11px] text-[#65758B] mt-0.5">
                  {selected.target_end_date ? `Target completion ${formatDate(selected.target_end_date)}` : 'No target completion date'}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 text-[#65758B] hover:text-[#172B4D] rounded-lg"
                aria-label="Close project details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {detailLoading ? (
                <LoadingState label="Loading project records…" />
              ) : (
                <>
                  {selected.objectives && (
                    <div className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                      <h3 className="text-xs font-bold text-[#172B4D] mb-1">Objectives</h3>
                      <p className="text-xs text-[#65758B] whitespace-pre-wrap">{selected.objectives}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border border-[#DCE5F0]">
                      <div className="text-[11px] text-[#65758B]">Completion</div>
                      <div className="text-lg font-extrabold text-[#172B4D]">{progress}%</div>
                    </div>
                    <div className="p-3 rounded-lg border border-[#DCE5F0]">
                      <div className="text-[11px] text-[#65758B]">Tasks</div>
                      <div className="text-lg font-extrabold text-[#172B4D]">{tasks.length}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-[#DCE5F0]">
                      <div className="text-[11px] text-[#65758B]">Milestones</div>
                      <div className="text-lg font-extrabold text-[#172B4D]">{milestones.length}</div>
                    </div>
                  </div>

                  <div className="h-2 rounded-full bg-[#F5F8FC] border border-[#DCE5F0] overflow-hidden">
                    <div className="h-full bg-[#123B73] transition-all" style={{ width: `${progress}%` }} />
                  </div>

                  <SectionCard title="Milestones" icon={Target}>
                    {milestones.length === 0 ? (
                      <p className="text-xs text-[#65758B]">No milestones recorded for this project.</p>
                    ) : (
                      <div className="divide-y divide-[#DCE5F0]">
                        {milestones.map((m) => (
                          <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#172B4D] truncate">{m.title}</div>
                              <div className="text-[11px] text-[#65758B]">
                                {m.due_date ? `Due ${formatDate(m.due_date)}` : 'No due date'}
                              </div>
                            </div>
                            <Chip tone={m.is_completed ? 'success' : 'neutral'}>
                              {m.is_completed ? 'Completed' : 'Open'}
                            </Chip>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Related meetings" icon={Video}>
                    {meetings.length === 0 ? (
                      <p className="text-xs text-[#65758B]">No meetings are linked to this project.</p>
                    ) : (
                      <div className="divide-y divide-[#DCE5F0]">
                        {meetings.map((m) => (
                          <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#172B4D] truncate">{m.title}</div>
                              <div className="text-[11px] text-[#65758B]">{formatDate(m.start_time)}</div>
                            </div>
                            <Chip>{m.status}</Chip>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Project documents" icon={FileText}>
                    {documents.length === 0 ? (
                      <p className="text-xs text-[#65758B]">No documents are linked to this project.</p>
                    ) : (
                      <div className="divide-y divide-[#DCE5F0]">
                        {documents.map((d) => (
                          <div key={d.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#172B4D] truncate">{d.title}</div>
                              <div className="text-[11px] text-[#65758B] truncate">{d.file_name}</div>
                            </div>
                            <span className="text-[11px] text-[#65758B] shrink-0">{formatRelativeTime(d.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Your tasks in this project" icon={CheckSquare}>
                    {tasks.length === 0 ? (
                      <p className="text-xs text-[#65758B]">No tasks are recorded in this project.</p>
                    ) : (
                      <div className="divide-y divide-[#DCE5F0]">
                        {tasks.map((t) => (
                          <div key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#172B4D] truncate">{t.title}</div>
                              <div className="text-[11px] text-[#65758B]">
                                {t.due_date ? `Due ${formatDate(t.due_date)}` : 'No due date'}
                              </div>
                            </div>
                            <Chip tone={t.status === 'done' ? 'success' : 'neutral'}>{t.status.replace('_', ' ')}</Chip>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <div className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-[11px] text-[#65758B] flex items-start gap-2">
                    <Users className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#123B73]" />
                    <span>
                      Project settings, budgets and team membership are managed by your project manager or team leads.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
