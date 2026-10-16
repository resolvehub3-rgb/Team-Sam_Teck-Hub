import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Plus,
  BookOpen,
  CheckCircle2,
  Calendar,
  ExternalLink,
  FileText,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { LearningResource, LearningAssignment } from '../types/database';

export const LearningView: React.FC = () => {
  const { user, organization, role } = useAuth();
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [assignments, setAssignments] = useState<LearningAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddResource, setShowAddResource] = useState(false);
  const [resTitle, setResTitle] = useState('');
  const [resDesc, setResDesc] = useState('');
  const [resCategory, setResCategory] = useState<'Technology' | 'Business' | 'Research' | 'Innovation'>('Technology');
  const [resType, setResType] = useState<'article' | 'video' | 'document' | 'course'>('document');
  const [resUrl, setResUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canManageLearning = role === 'super_admin' || role === 'team_leader' || role === 'department_lead';

  const fetchLearningData = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Resources
      let resQuery = supabase.from('learning_resources').select('*, creator:profiles(*)').order('created_at', { ascending: false });
      if (organization?.id) {
        resQuery = resQuery.eq('organization_id', organization.id);
      }
      const { data: resData } = await resQuery;
      setResources((resData as LearningResource[]) || []);

      // 2. Assignments
      const { data: assData } = await supabase.from('learning_assignments').select('*').order('created_at', { ascending: false });
      setAssignments((assData as LearningAssignment[]) || []);
    } catch (err) {
      console.error('Error fetching learning records:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLearningData();
  }, [organization?.id]);

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resTitle.trim() || !user) return;
    setIsSubmitting(true);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase
        .from('learning_resources')
        .insert({
          organization_id: orgId,
          title: resTitle.trim(),
          description: resDesc.trim() || null,
          category: resCategory,
          content_type: resType,
          url: resUrl.trim() || null,
          created_by: user.id,
        })
        .select('*, creator:profiles(*)')
        .single();

      if (error) throw error;

      setShowAddResource(false);
      setResTitle('');
      setResDesc('');
      setResUrl('');
      fetchLearningData();
    } catch (err) {
      alert('Failed to add resource: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-[#123B73]" />
            Learning & Professional Development
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Knowledge base, courses, assignments, and skill mastery for team members.
          </p>
        </div>

        {canManageLearning && (
          <button
            onClick={() => setShowAddResource(true)}
            className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Resource
          </button>
        )}
      </div>

      {resources.length === 0 ? (
        /* Honest empty state */
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center max-w-xl mx-auto shadow-xs">
          <BookOpen className="w-12 h-12 text-[#65758B]/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-[#172B4D]">No learning resources yet</h3>
          <p className="text-xs text-[#65758B] mt-1.5 mb-6">
            Curate technical documentation, courses, research papers, and assignments for your team.
          </p>
          {canManageLearning && (
            <button
              onClick={() => setShowAddResource(true)}
              className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
            >
              Add First Resource
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {resources.map((res) => (
            <div
              key={res.id}
              className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-[#123B73] border border-[#DCE5F0] uppercase tracking-wider">
                    {res.category}
                  </span>
                  <span className="text-[#65758B] uppercase">{res.content_type}</span>
                </div>
                <h3 className="text-sm font-bold text-[#172B4D]">{res.title}</h3>
                {res.description && (
                  <p className="text-xs text-[#65758B] line-clamp-3">{res.description}</p>
                )}
              </div>

              <div className="pt-2 border-t border-[#DCE5F0] flex items-center justify-between text-xs">
                <span className="text-[11px] text-[#65758B]">
                  By: {res.creator?.full_name || 'Instructor'}
                </span>
                {res.url && (
                  <a
                    href={res.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#123B73] hover:underline font-semibold"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD RESOURCE MODAL */}
      {showAddResource && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Add Learning Resource</h2>
              <button onClick={() => setShowAddResource(false)} className="text-[#65758B] hover:text-[#172B4D]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateResource} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Clean Architecture in TypeScript"
                  value={resTitle}
                  onChange={(e) => setResTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Summary of learning outcomes..."
                  value={resDesc}
                  onChange={(e) => setResDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Category</label>
                  <select
                    value={resCategory}
                    onChange={(e) => setResCategory(e.target.value as unknown as 'Technology' | 'Business' | 'Research' | 'Innovation')}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="Technology">Technology</option>
                    <option value="Business">Business</option>
                    <option value="Research">Research</option>
                    <option value="Innovation">Innovation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Content Type</label>
                  <select
                    value={resType}
                    onChange={(e) => setResType(e.target.value as unknown as 'article' | 'video' | 'document' | 'course')}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="document">Document / Spec</option>
                    <option value="course">Course Module</option>
                    <option value="article">Technical Article</option>
                    <option value="video">Video Lecture</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Resource URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={resUrl}
                  onChange={(e) => setResUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowAddResource(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmitting ? 'Saving...' : 'Add Resource'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
