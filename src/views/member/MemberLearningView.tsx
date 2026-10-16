import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GraduationCap,
  Search,
  BookOpen,
  CheckCircle2,
  Play,
  ExternalLink,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { LearningProgress, LearningResource } from '../../types/database';
import { describeAccessError, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, buttonStyles } from '../../components/ui';

const CATEGORIES = ['Technology', 'Business', 'Research', 'Innovation'] as const;
const TYPES = ['article', 'video', 'document', 'course'] as const;

interface ProgressKey {
  resourceId: string;
}

/**
 * Learning Centre for members: browse the resources leadership has published,
 * resume where you left off, and record genuine completion. Resources are
 * read-only here — publishing is limited to leadership by the RLS policy.
 */
export const MemberLearningView: React.FC = () => {
  const { user } = useAuth();
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [progress, setProgress] = useState<LearningProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | string>('all');
  const [type, setType] = useState<'all' | string>('all');
  const [progressFilter, setProgressFilter] = useState<'all' | 'new' | 'in_progress' | 'completed'>('all');

  const [active, setActive] = useState<LearningResource | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        const res = await supabase.from('learning_resources').select('*').order('created_at', { ascending: false });
        if (res.error) throw res.error;
        setResources((res.data as LearningResource[]) || []);

        if (user) {
          const pr = await supabase.from('learning_progress').select('*');
          if (pr.error) throw pr.error;
          setProgress(((pr.data as LearningProgress[]) || []).filter((p) => p.user_id === user.id));
        }
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const progressFor = useMemo(() => {
    const map = new Map<string, LearningProgress>();
    for (const p of progress) if (p.resource_id) map.set(p.resource_id, p);
    return map;
  }, [progress]);

  const stateOf = (id: string): 'new' | 'in_progress' | 'completed' => {
    const p = progressFor.get(id);
    if (!p) return 'new';
    if (p.is_completed) return 'completed';
    if ((p.progress_percent || 0) > 0) return 'in_progress';
    return 'new';
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (type !== 'all' && r.content_type !== type) return false;
      if (progressFilter !== 'all' && stateOf(r.id) !== progressFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.url || '').toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, search, category, type, progressFilter, progressFor]);

  const completedCount = resources.filter((r) => stateOf(r.id) === 'completed').length;
  const inProgressCount = resources.filter((r) => stateOf(r.id) === 'in_progress').length;

  const saveProgress = async (resource: LearningResource, percent: number, completed: boolean) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const existing = progressFor.get(resource.id);
      const payload = {
        user_id: user.id,
        resource_id: resource.id,
        progress_percent: Math.max(0, Math.min(100, percent)),
        is_completed: completed,
        completed_at: completed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error: err } = await supabase.from('learning_progress').update(payload).eq('id', existing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('learning_progress').insert(payload);
        if (err) throw err;
      }

      setSuccess(completed ? 'Marked as complete.' : `Progress saved at ${payload.progress_percent}%.`);
      await fetchData({ silent: true });
    } catch (err: unknown) {
      setError(describeAccessError(err));
    } finally {
      setBusy(false);
    }
  };

  const openResource = (r: LearningResource) => setActive(r);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Learning Centre"
        description="Courses, articles and materials published for your development."
        icon={GraduationCap}
        actions={
          <button onClick={() => fetchData()} disabled={loading} className={buttonStyles.secondary}>
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Available resources', value: resources.length },
          { label: 'In progress', value: inProgressCount },
          { label: 'Completed', value: completedCount },
        ].map((s) => (
          <div key={s.label} className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
            <div className="text-[11px] text-[#65758B] font-medium">{s.label}</div>
            <div className="text-xl font-extrabold text-[#172B4D]">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white p-3.5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#65758B] absolute left-3 top-2.5" />
          <input
            type="search"
            placeholder="Search learning resources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73]"
            aria-label="Search learning resources"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
            aria-label="Filter by type"
          >
            <option value="all">All formats</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={progressFilter}
            onChange={(e) => setProgressFilter(e.target.value as 'all' | 'new' | 'in_progress' | 'completed')}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg"
            aria-label="Filter by progress"
          >
            <option value="all">Any progress</option>
            <option value="new">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => fetchData()} />}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" role="status">
          {success}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading learning resources…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={resources.length === 0 ? 'No learning resources published yet' : 'No resources match these filters'}
          description={
            resources.length === 0
              ? 'Your learning administrators publish courses, documents, videos and reading here. None have been added yet.'
              : 'Try clearing a filter or changing your search term.'
          }
          action={
            resources.length > 0 ? (
              <button
                onClick={() => {
                  setSearch('');
                  setCategory('all');
                  setType('all');
                  setProgressFilter('all');
                }}
                className={buttonStyles.secondary}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((r) => {
            const state = stateOf(r.id);
            const pct = progressFor.get(r.id)?.progress_percent || 0;
            return (
              <div key={r.id} className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                    <BookOpen className="w-4 h-4 text-[#123B73]" />
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    <Chip>{r.content_type}</Chip>
                    <Chip tone={state === 'completed' ? 'success' : state === 'in_progress' ? 'warning' : 'neutral'}>
                      {state === 'completed' ? 'Completed' : state === 'in_progress' ? `${pct}% done` : 'Not started'}
                    </Chip>
                  </div>
                </div>

                <h3 className="text-sm font-bold text-[#172B4D] mt-3">{r.title}</h3>
                {r.description && <p className="text-xs text-[#65758B] mt-1.5 line-clamp-3">{r.description}</p>}
                <div className="text-[11px] text-[#65758B] mt-2">
                  {r.category} · added {formatRelativeTime(r.created_at)}
                </div>

                <div className="mt-auto pt-4 flex gap-2">
                  <button onClick={() => openResource(r)} className={`${buttonStyles.primary} flex-1 justify-center`}>
                    <Play className="w-3.5 h-3.5" />
                    {state === 'new' ? 'Start' : state === 'in_progress' ? 'Resume' : 'Review'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* RESOURCE DETAIL */}
      {active && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl shadow-xl border border-[#DCE5F0] flex flex-col">
            <div className="px-5 py-4 border-b border-[#DCE5F0] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#172B4D]">{active.title}</h2>
                <div className="text-[11px] text-[#65758B] mt-0.5">
                  {active.content_type} · {active.category}
                </div>
              </div>
              <button onClick={() => setActive(null)} className="text-[#65758B] hover:text-[#172B4D]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {active.description && <p className="text-xs text-[#65758B] whitespace-pre-wrap">{active.description}</p>}

              {active.url ? (
                <a
                  href={active.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buttonStyles.primary} w-fit`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open resource
                </a>
              ) : (
                <div className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-xs text-[#65758B]">
                  This resource has no external link. Record your progress below once you have worked through it.
                </div>
              )}

              <SectionCard title="Your progress" icon={CheckCircle2}>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#65758B] mb-1.5">
                      <span>Completion</span>
                      <span className="font-semibold text-[#172B4D]">
                        {progressFor.get(active.id)?.progress_percent || 0}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#F5F8FC] border border-[#DCE5F0] overflow-hidden">
                      <div
                        className="h-full bg-[#123B73] transition-all"
                        style={{ width: `${progressFor.get(active.id)?.progress_percent || 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[10, 50, 75].map((p) => (
                      <button
                        key={p}
                        disabled={busy}
                        onClick={() => saveProgress(active, p, false)}
                        className={buttonStyles.secondary}
                      >
                        Set {p}%
                      </button>
                    ))}
                    <button
                      disabled={busy}
                      onClick={() => saveProgress(active, 100, true)}
                      className={buttonStyles.primary}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark as complete
                    </button>
                  </div>

                  <p className="text-[11px] text-[#65758B]">
                    Your progress is stored against your own account only — no one else sees it, and it cannot be edited
                    by other members.
                  </p>
                </div>
              </SectionCard>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
