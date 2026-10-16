import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Download,
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Video,
  Lightbulb,
  FileSpreadsheet
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Project, Task, Meeting, Idea } from '../types/database';
import { filterOverdueTasks, calculateTaskProgress } from '../utils/rules';

export const ReportsView: React.FC = () => {
  const { organization } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReports() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data: p } = await supabase.from('projects').select('*');
        if (p) setProjects(p as Project[]);

        const { data: t } = await supabase.from('tasks').select('*');
        if (t) setTasks(t as Task[]);

        const { data: m } = await supabase.from('meetings').select('*');
        if (m) setMeetings(m as Meeting[]);

        const { data: i } = await supabase.from('ideas').select('*');
        if (i) setIdeas(i as Idea[]);
      } catch (err) {
        console.error('Reports load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadReports();
  }, [organization?.id]);

  // Derived real stats
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'done').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  const overdueTasks = filterOverdueTasks(tasks);
  const completionRate = calculateTaskProgress(tasks);

  // Export Tasks to CSV
  const exportTasksCSV = () => {
    if (tasks.length === 0) {
      alert('No task records to export.');
      return;
    }

    const headers = ['ID', 'Title', 'Status', 'Priority', 'Due Date', 'Created At'];
    const rows = tasks.map((t) => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.due_date || '',
      t.created_at,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sam_teck_tasks_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#123B73]" />
            Reports & Accountability
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Database-driven audit metrics, project completion ratios, and exportable reports.
          </p>
        </div>

        <button
          onClick={exportTasksCSV}
          disabled={tasks.length === 0}
          className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          Export Tasks CSV
        </button>
      </div>

      {/* KPI Cards: STRICT REAL METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Overall Task Completion</span>
          <div className="text-2xl font-extrabold text-[#172B4D] mt-1">{completionRate}%</div>
          <span className="text-[11px] text-[#65758B]">
            {completedTasks} of {totalTasks} tasks done
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">In Progress</span>
          <div className="text-2xl font-extrabold text-amber-600 mt-1">{inProgressTasks}</div>
          <span className="text-[11px] text-[#65758B]">Active execution</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Blocked Tasks</span>
          <div className="text-2xl font-extrabold text-red-600 mt-1">{blockedTasks}</div>
          <span className="text-[11px] text-[#65758B]">Requires escalation</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Overdue Work</span>
          <div className="text-2xl font-extrabold text-red-700 mt-1">{overdueTasks.length}</div>
          <span className="text-[11px] text-[#65758B]">Past target deadline</span>
        </div>
      </div>

      {/* Status Breakdown Charts / Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#172B4D]">Task Distribution by Status</h2>
          {totalTasks === 0 ? (
            <div className="py-8 text-center text-xs text-[#65758B]">
              No task data available yet. Create tasks to see analytics.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between font-semibold mb-1">
                  <span>Done</span>
                  <span>{completedTasks}</span>
                </div>
                <div className="w-full bg-[#DCE5F0] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold mb-1">
                  <span>In Progress</span>
                  <span>{inProgressTasks}</span>
                </div>
                <div className="w-full bg-[#DCE5F0] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full"
                    style={{ width: `${(inProgressTasks / totalTasks) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold mb-1">
                  <span>Blocked</span>
                  <span>{blockedTasks}</span>
                </div>
                <div className="w-full bg-[#DCE5F0] h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-red-500 h-full"
                    style={{ width: `${(blockedTasks / totalTasks) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#172B4D]">Innovation Pipeline Distribution</h2>
          {ideas.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#65758B]">
              No ideas submitted yet.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-[#DCE5F0]">
                <span>Submitted</span>
                <span className="font-bold">{ideas.filter((i) => i.status === 'submitted').length}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#DCE5F0]">
                <span>Approved</span>
                <span className="font-bold text-emerald-600">
                  {ideas.filter((i) => i.status === 'approved').length}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#DCE5F0]">
                <span>In Development</span>
                <span className="font-bold text-blue-600">
                  {ideas.filter((i) => i.status === 'in_development').length}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
