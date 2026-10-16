import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Search,
  Upload,
  Download,
  X,
  FolderKanban,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured, getAuthHeader } from '../../lib/supabase';
import { DocumentItem, Project } from '../../types/database';
import { describeAccessError, formatBytes, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, buttonStyles } from '../../components/ui';

const CATEGORIES = ['Specification', 'Design', 'Report', 'Policy', 'Reference', 'Other'] as const;
// Mirrors MAX_DOCUMENT_BYTES in server.ts. Vercel caps request bodies at
// 4.5 MB, so the server accepts 4 MB; keeping this identical means the browser
// rejects an oversized file with a readable message rather than letting it
// travel to the server and fail there.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Document library for members. Files live in a private storage bucket
 * under `documents/{orgId}/…`; the storage policy checks membership of that
 * organisation, so nothing is publicly reachable.
 *
 * Upload failures are surfaced — a document row is never written for a file
 * that did not actually land in storage.
 */
export const MemberDocumentsView: React.FC = () => {
  const { user, organization } = useAuth();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');

  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [projectId, setProjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchDocuments = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('documents')
          .select('*, uploader:profiles(full_name, email)')
          .order('created_at', { ascending: false });
        if (organization?.id) query = query.eq('organization_id', organization.id);

        const [docRes, projRes] = await Promise.all([
          query,
          supabase.from('projects').select('*').order('name', { ascending: true }),
        ]);
        if (docRes.error) throw docRes.error;
        setDocuments((docRes.data as DocumentItem[]) || []);
        setProjects((projRes.data as Project[]) || []);
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [organization?.id]
  );

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (projectFilter !== 'all' && d.project_id !== projectFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.file_name || '').toLowerCase().includes(q)
      );
    });
  }, [documents, search, projectFilter]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organization) return;
    if (!title.trim()) {
      setFormError('A title is required.');
      return;
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setFormError(`Files must be 4 MB or smaller - "${file.name}" is ${formatBytes(file.size)}.`);
      return;
    }

    setUploading(true);
    setFormError(null);
    try {
      let filePath: string | null = null;

      if (file) {
        // Bytes go through the authenticated server: it scopes the path to
        // this organisation and this user, and storage policy creation is not
        // something every project can apply from the SQL editor.
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-file-name': file.name,
            ...(await getAuthHeader()),
          },
          body: file,
        });
        const data: { path?: string; error?: string } = await res.json().catch(() => ({ error: 'No response was received.' }));

        if (!res.ok) {
          setFormError(
            data.error ? `The file could not be uploaded: ${data.error}` : 'The file could not be uploaded. Try again.'
          );
          return; // never record metadata for a file that was not stored
        }
        if (!data.path) {
          setFormError('The upload did not return a storage path, so no record was created.');
          return;
        }
        filePath = data.path;
      }

      const { error: dbErr } = await supabase.from('documents').insert({
        organization_id: organization.id,
        project_id: projectId || null,
        title: title.trim(),
        description: description.trim() || null,
        file_name: file?.name || `${title.trim()}.txt`,
        file_path: filePath || '',
        file_size: file?.size ?? 0,
        mime_type: file?.type || null,
        category,
        uploaded_by: user.id,
      });
      if (dbErr) throw dbErr;

      setShowUpload(false);
      setTitle('');
      setDescription('');
      setFile(null);
      setProjectId('');
      setSuccess(filePath ? `"${title.trim()}" uploaded successfully.` : `"${title.trim()}" saved to the document library.`);
      await fetchDocuments({ silent: true });
    } catch (err: unknown) {
      setFormError(describeAccessError(err));
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc: DocumentItem) => {
    if (!doc.file_path) {
      setError('This entry is a metadata-only record with no stored file.');
      return;
    }
    setError(null);
    try {
      // The server re-checks that the caller is an active member of the
      // document's organisation before minting a short-lived link.
      const res = await fetch(`/api/documents/${doc.id}/download`, { headers: await getAuthHeader() });
      const data: { url?: string; error?: string } = await res.json().catch(() => ({ error: 'No response was received.' }));
      if (!res.ok || !data.url) {
        setError(data.error || 'This file could not be opened. It may have been moved or removed by its uploader.');
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('This file could not be opened. Check your connection and try again.');
    }
  };

  const remove = async (doc: DocumentItem) => {
    if (!window.confirm(`Remove "${doc.title}" from the document library? This cannot be undone.`)) return;
    setError(null);
    try {
      const { error: err } = await supabase.from('documents').delete().eq('id', doc.id);
      if (err) throw err;
      if (doc.file_path) {
        const res = await fetch('/api/documents/delete-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
          body: JSON.stringify({ path: doc.file_path }),
        });
        if (!res.ok) {
          const data: { error?: string } = await res.json().catch(() => ({ error: 'No response was received.' }));
          setError(`"${doc.title}" was removed from the library, but its stored file could not be deleted: ${data.error || 'unknown error'}`);
          await fetchDocuments({ silent: true });
          return;
        }
      }
      setSuccess(`"${doc.title}" was removed.`);
      await fetchDocuments({ silent: true });
    } catch (err: unknown) {
      setError(describeAccessError(err));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Files shared with your organisation, searchable by project and category."
        icon={FileText}
        actions={
          <>
            <button onClick={() => fetchDocuments()} disabled={loading} className={buttonStyles.secondary}>
              Refresh
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className={buttonStyles.primary}
              disabled={!organization}
              title={organization ? undefined : 'Your account is not linked to an organisation yet.'}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload file
            </button>
          </>
        }
      />

      <div className="bg-white p-3.5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#65758B] absolute left-3 top-2.5" />
          <input
            type="search"
            placeholder="Search documents by title, description or file name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73]"
            aria-label="Search documents"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-[#DCE5F0] rounded-lg max-w-[240px]"
            aria-label="Filter by project"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-[#65758B] self-center">
            {visible.length} of {documents.length} document{documents.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => fetchDocuments()} />}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" role="status">
          {success}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading documents…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={documents.length === 0 ? 'No documents shared yet' : 'No documents match your search'}
          description={
            documents.length === 0
              ? 'Upload a specification, report or reference file and it becomes available to everyone authorised in your organisation.'
              : 'Try a different search term or clear the project filter.'
          }
          action={
            documents.length > 0 ? (
              <button
                onClick={() => {
                  setSearch('');
                  setProjectFilter('all');
                }}
                className={buttonStyles.secondary}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-[#DCE5F0] divide-y divide-[#DCE5F0] shadow-xs overflow-hidden">
          {visible.map((doc) => {
            const isMine = doc.uploaded_by === user?.id;
            const uploader = (doc.uploader as unknown as { full_name?: string; email?: string }) || {};
            return (
              <div key={doc.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#F5F8FC]/60">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] shrink-0">
                    <FileText className="w-4 h-4 text-[#123B73]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-[#172B4D] truncate">{doc.title}</span>
                      <Chip tone="neutral">{doc.category}</Chip>
                      {isMine && <Chip tone="info">Uploaded by you</Chip>}
                    </div>
                    <div className="text-[11px] text-[#65758B] mt-1 flex flex-wrap gap-x-3">
                      <span className="truncate">{doc.file_name}</span>
                      <span>{formatBytes(doc.file_size)}</span>
                      <span>{formatRelativeTime(doc.created_at)}</span>
                      <span className="truncate">
                        {uploader.full_name || uploader.email || 'A team member'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => download(doc)}
                    disabled={!doc.file_path}
                    className="px-3 py-1.5 border border-[#DCE5F0] bg-white text-xs font-semibold text-[#123B73] rounded-lg hover:bg-[#F5F8FC] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5 inline mr-1" />
                    Open
                  </button>
                  <button
                    onClick={() => remove(doc)}
                    className="p-2 border border-[#DCE5F0] bg-white text-red-500 rounded-lg hover:bg-red-50"
                    aria-label={`Delete ${doc.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UPLOAD MODAL */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl shadow-xl border border-[#DCE5F0] flex flex-col">
            <div className="px-5 py-4 border-b border-[#DCE5F0] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#172B4D]">Upload a document</h2>
              <button onClick={() => setShowUpload(false)} className="text-[#65758B] hover:text-[#172B4D]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={upload} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="doc-title" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Title *
                </label>
                <input
                  id="doc-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label htmlFor="doc-desc" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Description
                </label>
                <textarea
                  id="doc-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="doc-cat" className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Category
                  </label>
                  <select
                    id="doc-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="doc-proj" className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Project
                  </label>
                  <select
                    id="doc-proj"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 border border-dashed border-[#DCE5F0] rounded-lg bg-[#F5F8FC]">
                <label htmlFor="doc-file" className="block text-xs font-semibold text-[#172B4D] mb-2">
                  File (optional, max 10 MB)
                </label>
                <input
                  id="doc-file"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-[#65758B]"
                />
                {file && (
                  <div className="text-[11px] text-[#65758B] mt-1.5">
                    {file.name} · {formatBytes(file.size)}
                  </div>
                )}
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button type="button" onClick={() => setShowUpload(false)} className={buttonStyles.secondary}>
                  Cancel
                </button>
                <button type="submit" disabled={uploading} className={buttonStyles.primary}>
                  {uploading ? (
                    'Uploading…'
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Save document
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
