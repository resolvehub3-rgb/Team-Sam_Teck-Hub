import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lightbulb, Plus, X, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Idea, IdeaStatus } from '../../types/database';
import { describeAccessError, formatDate, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, buttonStyles } from '../../components/ui';

const STATUS_LABEL: Record<IdeaStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  needs_revision: 'Needs Revision',
  approved: 'Approved',
  in_development: 'In Development',
  testing: 'Testing',
  launched: 'Implemented',
  deferred: 'Deferred',
  rejected: 'Declined',
};

const STATUS_TONE: Record<IdeaStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  submitted: 'neutral',
  under_review: 'info',
  needs_revision: 'warning',
  approved: 'info',
  in_development: 'info',
  testing: 'warning',
  launched: 'success',
  deferred: 'warning',
  rejected: 'danger',
};

/** Pipeline stages a submitted idea may sit in, shown as a progress trail. */
const PIPELINE: IdeaStatus[] = ['submitted', 'under_review', 'approved', 'in_development', 'testing', 'launched'];

interface IdeaReviewRow {
  id: string;
  idea_id: string;
  reviewer_id: string;
  feedback: string;
  decision: string;
  created_at: string;
  reviewer?: { full_name?: string; email?: string } | null;
}

type IdeaScope = 'mine' | 'all';

export const MemberInnovationView: React.FC = () => {
  const { user, organization } = useAuth();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [reviews, setReviews] = useState<Record<string, IdeaReviewRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scope, setScope] = useState<IdeaScope>('mine');

  // Submission form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [targetUsers, setTargetUsers] = useState('');
  const [solution, setSolution] = useState('');
  const [expectedValue, setExpectedValue] = useState('');
  const [effort, setEffort] = useState('');
  const [category, setCategory] = useState<string>('Technology');
  const [skills, setSkills] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchIdeas = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('ideas')
          .select('*, author:profiles(full_name, email)')
          .order('created_at', { ascending: false });
        if (organization?.id) query = query.eq('organization_id', organization.id);
        const { data, error: err } = await query;
        if (err) throw err;
        const rows = (data as Idea[]) || [];
        setIdeas(rows);

        if (rows.length > 0) {
          const { data: revData } = await supabase
            .from('idea_reviews')
            .select('*, reviewer:profiles(full_name, email)')
            .in('idea_id', rows.map((r) => r.id));
          const grouped: Record<string, IdeaReviewRow[]> = {};
          for (const r of (revData as IdeaReviewRow[]) || []) {
            (grouped[r.idea_id] ||= []).push(r);
          }
          setReviews(grouped);
        } else {
          setReviews({});
        }
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [organization?.id]
  );

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  const submitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organization) return;

    if (!title.trim() || !problem.trim() || !targetUsers.trim() || !solution.trim()) {
      setFormError('Title, problem statement, target users and proposed solution are all required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const { error: err } = await supabase.from('ideas').insert({
        organization_id: organization.id,
        author_id: user.id,
        title: title.trim(),
        problem_statement: problem.trim(),
        target_users: targetUsers.trim(),
        proposed_solution: solution.trim(),
        expected_value: expectedValue.trim() || null,
        estimated_effort: effort || null,
        // Category is captured as a required skill tag — the schema has no
        // separate category column, so nothing is invented.
        required_skills: skills.trim()
          ? skills.split(',').map((s) => s.trim()).filter(Boolean)
          : [category],
        status: 'submitted',
      });
      if (err) throw err;

      setShowForm(false);
      setTitle('');
      setProblem('');
      setTargetUsers('');
      setSolution('');
      setExpectedValue('');
      setEffort('');
      setSkills('');
      setSuccess('Your idea was submitted. Leadership will review it and you will be notified of the decision.');
      await fetchIdeas({ silent: true });
      setScope('mine');
    } catch (err: unknown) {
      setFormError(describeAccessError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const mine = useMemo(() => ideas.filter((i) => i.author_id === user?.id), [ideas, user?.id]);
  const visible = scope === 'mine' ? mine : ideas;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Innovation Lab"
        description="Propose solutions, follow their progress, and read the feedback on them."
        icon={Lightbulb}
        actions={
          <button onClick={() => setShowForm(true)} className={buttonStyles.primary}>
            <Plus className="w-3.5 h-3.5" />
            Submit an idea
          </button>
        }
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Idea scope">
        {([
          { id: 'mine', label: `My submissions (${mine.length})` },
          { id: 'all', label: `Shared with the team (${ideas.length})` },
        ] as { id: IdeaScope; label: string }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
              scope === t.id
                ? 'bg-[#123B73] text-white border-[#123B73]'
                : 'bg-white text-[#172B4D] border-[#DCE5F0] hover:bg-[#F5F8FC]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={() => fetchIdeas()} />}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" role="status">
          {success}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading ideas…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={scope === 'mine' ? 'You have not submitted an idea yet' : 'No ideas have been shared yet'}
          description={
            scope === 'mine'
              ? 'Innovation is one of Team Sam_Teck’s four objectives. Describe a problem you have noticed and propose how to solve it.'
              : 'Once a teammate submits an idea it appears here so you can follow its progress.'
          }
          action={
            scope === 'mine' ? (
              <button onClick={() => setShowForm(true)} className={buttonStyles.primary}>
                <Plus className="w-3.5 h-3.5" />
                Submit your first idea
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((idea) => {
            const ideaReviews = reviews[idea.id] || [];
            const isMine = idea.author_id === user?.id;
            const pipelineIndex = PIPELINE.indexOf(idea.status);

            return (
              <article key={idea.id} className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-[#172B4D]">{idea.title}</h3>
                      <Chip tone={STATUS_TONE[idea.status]}>{STATUS_LABEL[idea.status]}</Chip>
                      {isMine && <Chip tone="info">Your idea</Chip>}
                    </div>
                    <div className="text-[11px] text-[#65758B] mt-1">
                      {(idea.author as unknown as { full_name?: string })?.full_name || 'A teammate'} ·{' '}
                      {formatDate(idea.created_at)}
                    </div>
                  </div>

                  <button
                    onClick={() => setExpanded(expanded === idea.id ? null : idea.id)}
                    className="text-xs font-semibold text-[#123B73] hover:underline flex items-center gap-1 shrink-0"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {ideaReviews.length} feedback
                  </button>
                </div>

                {/* Progress through the review pipeline — only shown when the
                    idea is actually in the pipeline. */}
                {pipelineIndex >= 0 && idea.status !== 'rejected' && idea.status !== 'deferred' && (
                  <div className="mt-3 flex items-center gap-1 flex-wrap">
                    {PIPELINE.map((s, idx) => (
                      <React.Fragment key={s}>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            idx <= pipelineIndex
                              ? 'bg-[#123B73] text-white border-[#123B73]'
                              : 'bg-white text-[#65758B] border-[#DCE5F0]'
                          }`}
                        >
                          {STATUS_LABEL[s]}
                        </span>
                        {idx < PIPELINE.length - 1 && <span className="text-[#DCE5F0]">—</span>}
                      </React.Fragment>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-[#172B4D] mb-1">Problem being solved</div>
                    <p className="text-[#65758B] whitespace-pre-wrap line-clamp-4">{idea.problem_statement}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-[#172B4D] mb-1">Proposed solution</div>
                    <p className="text-[#65758B] whitespace-pre-wrap line-clamp-4">{idea.proposed_solution}</p>
                  </div>
                </div>

                {idea.expected_value && (
                  <div className="mt-3 text-xs">
                    <span className="font-semibold text-[#172B4D]">Expected value: </span>
                    <span className="text-[#65758B]">{idea.expected_value}</span>
                  </div>
                )}

                {expanded === idea.id && (
                  <div className="mt-4 pt-4 border-t border-[#DCE5F0] space-y-3">
                    <div className="text-xs">
                      <div className="font-semibold text-[#172B4D] mb-1">Who it is for</div>
                      <p className="text-[#65758B] whitespace-pre-wrap">{idea.target_users}</p>
                    </div>

                    <div className="text-xs">
                      <div className="font-semibold text-[#172B4D] mb-1">Feedback from review</div>
                      {ideaReviews.length === 0 ? (
                        <p className="text-[#65758B]">
                          No review has been recorded yet. Leadership will review this idea in due course.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {ideaReviews.map((r) => (
                            <div key={r.id} className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-[#172B4D]">
                                  {r.reviewer?.full_name || r.reviewer?.email || 'A reviewer'}
                                </span>
                                <Chip
                                  tone={
                                    r.decision === 'approved'
                                      ? 'success'
                                      : r.decision === 'rejected'
                                        ? 'danger'
                                        : 'warning'
                                  }
                                >
                                  {r.decision.replace('_', ' ')}
                                </Chip>
                              </div>
                              <p className="text-[#65758B] mt-1 whitespace-pre-wrap">{r.feedback}</p>
                              <div className="text-[10px] text-[#65758B] mt-1">{formatRelativeTime(r.created_at)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-[11px] text-[#65758B] flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#123B73]" />
                      <span>
                        Idea status is decided by leadership only — you cannot approve your own idea.
                      </span>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* SUBMISSION MODAL */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-xl shadow-xl border border-[#DCE5F0] flex flex-col">
            <div className="px-5 py-4 border-b border-[#DCE5F0] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#172B4D]">Submit an idea</h2>
              <button onClick={() => setShowForm(false)} className="text-[#65758B] hover:text-[#172B4D]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitIdea} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="idea-title" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Title *
                </label>
                <input
                  id="idea-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Automated invoice reconciliation"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label htmlFor="idea-problem" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Problem being solved *
                </label>
                <textarea
                  id="idea-problem"
                  rows={3}
                  required
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="What is going wrong today, and who does it affect?"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none resize-none"
                />
              </div>

              <div>
                <label htmlFor="idea-users" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Who benefits *
                </label>
                <input
                  id="idea-users"
                  type="text"
                  required
                  value={targetUsers}
                  onChange={(e) => setTargetUsers(e.target.value)}
                  placeholder="e.g. Finance team and our clients"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="idea-solution" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Proposed solution *
                </label>
                <textarea
                  id="idea-solution"
                  rows={4}
                  required
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  placeholder="How would you fix it?"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none resize-none"
                />
              </div>

              <div>
                <label htmlFor="idea-value" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Expected benefit
                </label>
                <textarea
                  id="idea-value"
                  rows={2}
                  value={expectedValue}
                  onChange={(e) => setExpectedValue(e.target.value)}
                  placeholder="Time saved, revenue gained, risk removed…"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="idea-category" className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Category
                  </label>
                  <select
                    id="idea-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option>Technology</option>
                    <option>Business</option>
                    <option>Learning</option>
                    <option>Innovation</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="idea-effort" className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Estimated effort
                  </label>
                  <select
                    id="idea-effort"
                    value={effort}
                    onChange={(e) => setEffort(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="">Not sure yet</option>
                    <option value="Small — under a week">Small — under a week</option>
                    <option value="Medium — a few weeks">Medium — a few weeks</option>
                    <option value="Large — a quarter or more">Large — a quarter or more</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="idea-skills" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Skills needed (comma separated)
                </label>
                <input
                  id="idea-skills"
                  type="text"
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="e.g. PostgreSQL, React, Data Analysis"
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button type="button" onClick={() => setShowForm(false)} className={buttonStyles.secondary}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className={buttonStyles.primary}>
                  {submitting ? 'Submitting…' : 'Submit idea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
