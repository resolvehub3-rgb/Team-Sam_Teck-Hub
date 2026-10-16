import React, { useState, useEffect } from 'react';
import {
  Lightbulb,
  Plus,
  CheckCircle2,
  Clock,
  ArrowRight,
  Filter,
  Search,
  MessageSquare,
  ThumbsUp,
  X,
  Send,
  FolderKanban
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Idea, IdeaStatus, IdeaReview } from '../types/database';

const IDEA_STAGES: { id: IdeaStatus; label: string; color: string }[] = [
  { id: 'submitted', label: 'Submitted', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'under_review', label: 'Under Review', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'needs_revision', label: 'Needs Revision', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'approved', label: 'Approved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'in_development', label: 'In Development', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'launched', label: 'Launched', color: 'bg-green-100 text-green-800 border-green-300' },
];

export const InnovationLabView: React.FC = () => {
  const { user, organization, role } = useAuth();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);

  // Submit Idea Modal
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [title, setTitle] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [targetUsers, setTargetUsers] = useState('');
  const [proposedSolution, setProposedSolution] = useState('');
  const [expectedValue, setExpectedValue] = useState('');
  const [estimatedEffort, setEstimatedEffort] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Review Form
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'needs_revision' | 'rejected' | 'deferred'>('approved');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [convertingIdeaId, setConvertingIdeaId] = useState<string | null>(null);

  const canReview = role === 'super_admin' || role === 'team_leader' || role === 'assistant_leader' || role === 'department_lead';

  const fetchIdeas = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('ideas')
        .select('*, author:profiles(*), reviews:idea_reviews(*)')
        .order('created_at', { ascending: false });
      if (organization?.id) {
        query = query.eq('organization_id', organization.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      const list = (data as Idea[]) || [];
      setIdeas(list);
      if (list.length > 0 && !selectedIdea) {
        setSelectedIdea(list[0]);
      }
    } catch (err) {
      console.error('Error fetching ideas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIdeas();
  }, [organization?.id]);

  // Submit Idea to Supabase
  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !problemStatement.trim() || !proposedSolution.trim() || !user) return;
    setIsSubmitting(true);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase
        .from('ideas')
        .insert({
          organization_id: orgId,
          author_id: user.id,
          title: title.trim(),
          problem_statement: problemStatement.trim(),
          target_users: targetUsers.trim(),
          proposed_solution: proposedSolution.trim(),
          expected_value: expectedValue.trim() || null,
          estimated_effort: estimatedEffort.trim() || null,
          estimated_cost: parseFloat(estimatedCost) || 0,
          status: 'submitted',
        })
        .select('*, author:profiles(*)')
        .single();

      if (error) throw error;

      setShowSubmitModal(false);
      setTitle('');
      setProblemStatement('');
      setProposedSolution('');
      fetchIdeas();
      if (data) setSelectedIdea(data as Idea);
    } catch (err) {
      alert('Failed to submit idea: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Review to Supabase
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIdea || !reviewFeedback.trim() || !user) return;
    setIsSubmittingReview(true);

    try {
      // 1. Insert Review
      const { error: revErr } = await supabase.from('idea_reviews').insert({
        idea_id: selectedIdea.id,
        reviewer_id: user.id,
        feedback: reviewFeedback.trim(),
        decision: reviewDecision,
      });
      if (revErr) throw revErr;

      // 2. Update Idea Status
      const newStatus: IdeaStatus =
        reviewDecision === 'approved' ? 'approved' : reviewDecision === 'needs_revision' ? 'needs_revision' : 'rejected';

      await supabase
        .from('ideas')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', selectedIdea.id);

      setReviewFeedback('');
      fetchIdeas();
      setSelectedIdea({ ...selectedIdea, status: newStatus });
    } catch (err) {
      alert('Failed to save review: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Convert Approved Idea directly to a Project
  const handleConvertIdeaToProject = async (idea: Idea) => {
    if (!user) return;
    setConvertingIdeaId(idea.id);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 25);

      // 1. Create Project
      const { data: projData, error: projErr } = await supabase
        .from('projects')
        .insert({
          organization_id: orgId,
          name: idea.title,
          slug,
          description: idea.proposed_solution,
          objectives: idea.problem_statement,
          scope: idea.target_users,
          owner_id: user.id,
          status: 'planning',
          budget: idea.estimated_cost || 0,
        })
        .select()
        .single();

      if (projErr) throw projErr;

      // 2. Update Idea record
      await supabase
        .from('ideas')
        .update({
          status: 'in_development',
          converted_project_id: projData.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', idea.id);

      alert(`Idea converted to project "${idea.title}". View it on the Projects tab.`);
      fetchIdeas();
    } catch (err) {
      alert('Conversion failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setConvertingIdeaId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-500" />
            Innovation Lab & Product Pipeline
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Transform ideas and problem statements into vetted products, experiments, and active projects.
          </p>
        </div>

        <button
          onClick={() => setShowSubmitModal(true)}
          className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Submit Idea
        </button>
      </div>

      {ideas.length === 0 ? (
        /* Honest empty state */
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center max-w-xl mx-auto shadow-xs">
          <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
            <Lightbulb className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-base font-bold text-[#172B4D]">No innovation proposals yet</h2>
          <p className="text-xs text-[#65758B] mt-1.5 mb-6">
            Propose a new solution, technology experiment, or product concept. Authorized reviewers will assess impact and convert viable ideas into projects.
          </p>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="px-4 py-2.5 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
          >
            Submit First Proposal
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Proposals List */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#65758B]">
              Submissions ({ideas.length})
            </h2>
            <div className="space-y-2">
              {ideas.map((idea) => {
                const isSelected = selectedIdea?.id === idea.id;
                return (
                  <div
                    key={idea.id}
                    onClick={() => setSelectedIdea(idea)}
                    className={`p-4 rounded-xl border cursor-pointer transition text-xs space-y-1.5 ${
                      isSelected
                        ? 'bg-white border-[#123B73] shadow-md ring-1 ring-[#123B73]'
                        : 'bg-white border-[#DCE5F0] hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#172B4D] line-clamp-1">{idea.title}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-[#123B73] border border-[#DCE5F0]">
                        {idea.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#65758B] line-clamp-2">
                      {idea.proposed_solution}
                    </p>
                    <div className="text-[10px] text-[#65758B]/80 pt-1 flex items-center justify-between">
                      <span>By: {idea.author?.full_name || 'Member'}</span>
                      <span>{new Date(idea.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 2 Columns: Detailed Proposal View & Review Drawer */}
          {selectedIdea && (
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-xl border border-[#DCE5F0] p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#DCE5F0] pb-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                      Proposal Details
                    </span>
                    <h2 className="text-lg font-bold text-[#172B4D]">{selectedIdea.title}</h2>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedIdea.status === 'approved' && !selectedIdea.converted_project_id && (
                      <button
                        onClick={() => handleConvertIdeaToProject(selectedIdea)}
                        disabled={convertingIdeaId === selectedIdea.id}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <FolderKanban className="w-3.5 h-3.5" />
                        <span>Convert to Project</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <h3 className="font-bold text-[#172B4D] text-xs mb-1">Problem Statement</h3>
                    <p className="text-[#65758B] bg-[#F5F8FC] p-3 rounded-lg border border-[#DCE5F0]">
                      {selectedIdea.problem_statement}
                    </p>
                  </div>

                  <div>
                    <h3 className="font-bold text-[#172B4D] text-xs mb-1">Target Users & Audience</h3>
                    <p className="text-[#65758B] bg-[#F5F8FC] p-3 rounded-lg border border-[#DCE5F0]">
                      {selectedIdea.target_users}
                    </p>
                  </div>

                  <div>
                    <h3 className="font-bold text-[#172B4D] text-xs mb-1">Proposed Solution</h3>
                    <p className="text-[#65758B] bg-[#F5F8FC] p-3 rounded-lg border border-[#DCE5F0]">
                      {selectedIdea.proposed_solution}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 bg-[#F5F8FC] rounded-lg border border-[#DCE5F0]">
                      <span className="text-[#65758B] text-[11px]">Estimated Effort:</span>
                      <div className="font-bold text-[#172B4D] mt-0.5">{selectedIdea.estimated_effort || 'TBD'}</div>
                    </div>
                    <div className="p-3 bg-[#F5F8FC] rounded-lg border border-[#DCE5F0]">
                      <span className="text-[#65758B] text-[11px]">Estimated Budget:</span>
                      <div className="font-bold text-[#172B4D] mt-0.5">
                        {selectedIdea.estimated_cost ? `${selectedIdea.estimated_cost}` : 'None'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Structured Review Form (Authorized reviewers only) */}
                {canReview && (
                  <div className="pt-4 border-t border-[#DCE5F0] space-y-3">
                    <h3 className="font-bold text-[#172B4D] text-xs">Leadership Evaluation & Review</h3>
                    <form onSubmit={handleSubmitReview} className="space-y-3">
                      <textarea
                        rows={2}
                        required
                        placeholder="Provide formal review feedback and recommendations..."
                        value={reviewFeedback}
                        onChange={(e) => setReviewFeedback(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <select
                          value={reviewDecision}
                          onChange={(e) => setReviewDecision(e.target.value as unknown as 'approved' | 'needs_revision' | 'rejected' | 'deferred')}
                          className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg font-semibold"
                        >
                          <option value="approved">Approve Proposal</option>
                          <option value="needs_revision">Request Revisions</option>
                          <option value="rejected">Reject Proposal</option>
                          <option value="deferred">Defer Decision</option>
                        </select>
                        <button
                          type="submit"
                          disabled={isSubmittingReview}
                          className="px-4 py-1.5 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                        >
                          {isSubmittingReview ? 'Submitting...' : 'Record Review'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBMIT IDEA MODAL */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Submit Innovation Proposal</h2>
              <button onClick={() => setShowSubmitModal(false)} className="text-[#65758B] hover:text-[#172B4D]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitIdea} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed Cache for Meeting Transcripts"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Problem Statement *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="What problem are you solving and why does it matter?"
                  value={problemStatement}
                  onChange={(e) => setProblemStatement(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Target Users *</label>
                <input
                  type="text"
                  required
                  placeholder="Who benefits? (e.g. Project managers, researchers)"
                  value={targetUsers}
                  onChange={(e) => setTargetUsers(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Proposed Solution *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe your architecture, tool, or approach..."
                  value={proposedSolution}
                  onChange={(e) => setProposedSolution(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Estimated Effort</label>
                  <input
                    type="text"
                    placeholder="e.g. 2 weeks, 1 sprint"
                    value={estimatedEffort}
                    onChange={(e) => setEstimatedEffort(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Estimated Cost</label>
                  <input
                    type="number"
                    value={estimatedCost}
                    onChange={(e) => setEstimatedCost(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
