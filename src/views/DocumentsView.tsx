import React, { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  Download,
  FolderKanban,
  File,
  X,
  Search,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { DocumentItem, Project } from '../types/database';

export const DocumentsView: React.FC = () => {
  const { user, organization } = useAuth();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [docCategory, setDocCategory] = useState('Specification');
  const [docProjectId, setDocProjectId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const fetchDocuments = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('documents').select('*, uploader:profiles(*)').order('created_at', { ascending: false });
      if (organization?.id) query = query.eq('organization_id', organization.id);
      const { data } = await query;
      setDocuments((data as DocumentItem[]) || []);

      const { data: pData } = await supabase.from('projects').select('*');
      if (pData) setProjects(pData as Project[]);
    } catch (err) {
      console.error('Error fetching documents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [organization?.id]);

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !user) return;
    setIsUploading(true);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const fileName = selectedFile ? selectedFile.name : `${docTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`;
      const filePath = `documents/${orgId}/${Date.now()}_${fileName}`;

      // If a real file is attached and storage bucket exists, upload to Supabase Storage
      if (selectedFile && isSupabaseConfigured()) {
        try {
          await supabase.storage.from('documents').upload(filePath, selectedFile);
        } catch (storageErr) {
          console.warn('Storage upload note:', storageErr);
        }
      }

      // Record metadata in public.documents
      if (isSupabaseConfigured()) {
        const { error } = await supabase.from('documents').insert({
          organization_id: orgId,
          project_id: docProjectId || null,
          title: docTitle.trim(),
          description: docDesc.trim() || null,
          category: docCategory,
          file_path: filePath,
          file_name: fileName,
          file_size: selectedFile ? selectedFile.size : 1024,
          mime_type: selectedFile ? selectedFile.type : 'application/pdf',
          uploaded_by: user.id,
        });

        if (error) throw error;
      }

      setShowUploadModal(false);
      setDocTitle('');
      setDocDesc('');
      setSelectedFile(null);
      fetchDocuments();
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#123B73]" />
            Document & File Repository
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Project deliverables, architectural specs, and meeting documentation with private storage.
          </p>
        </div>

        <button
          onClick={() => setShowUploadModal(true)}
          className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload Document
        </button>
      </div>

      {documents.length === 0 ? (
        /* Honest empty state */
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center max-w-xl mx-auto shadow-xs">
          <File className="w-12 h-12 text-[#65758B]/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-[#172B4D]">No documents uploaded</h3>
          <p className="text-xs text-[#65758B] mt-1.5 mb-6">
            Upload technical documents, design specifications, or reports linked to projects and meetings.
          </p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
          >
            Upload First Document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-[#123B73] border border-[#DCE5F0] uppercase">
                    {doc.category}
                  </span>
                  <span className="text-[#65758B]">
                    {doc.file_size ? `${Math.round(doc.file_size / 1024)} KB` : ''}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#172B4D]">{doc.title}</h3>
                {doc.description && (
                  <p className="text-xs text-[#65758B] line-clamp-2">{doc.description}</p>
                )}
                <div className="text-[11px] font-mono text-[#65758B] truncate">{doc.file_name}</div>
              </div>

              <div className="pt-2 border-t border-[#DCE5F0] flex items-center justify-between text-xs">
                <span className="text-[11px] text-[#65758B]">
                  By: {doc.uploader?.full_name || 'Member'}
                </span>
                <span className="text-[10px] text-[#65758B]">
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* UPLOAD MODAL */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Upload Document</h2>
              <button onClick={() => setShowUploadModal(false)} className="text-[#65758B] hover:text-[#172B4D]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadDocument} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Document Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Architecture Overview Spec"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Brief summary of file contents..."
                  value={docDesc}
                  onChange={(e) => setDocDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Category</label>
                  <select
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="Specification">Technical Specification</option>
                    <option value="Architecture">System Architecture</option>
                    <option value="MeetingMinutes">Meeting Minutes</option>
                    <option value="Financial">Financial / Budget</option>
                    <option value="General">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Linked Project</label>
                  <select
                    value={docProjectId}
                    onChange={(e) => setDocProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="">No Project Linked</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Select File</label>
                <input
                  type="file"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  className="w-full text-xs text-[#65758B] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#123B73] hover:file:bg-blue-100"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isUploading ? 'Uploading...' : 'Save Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
