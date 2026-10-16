import React, { useState, useEffect } from 'react';
import {
  Video,
  Plus,
  Calendar,
  Clock,
  Users,
  ArrowRight,
  Shield,
  FileText,
  X,
  Radio,
  CheckCircle2,
  Trash2,
  Loader2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Meeting, Project } from '../types/database';
import { MeetingRoomView } from './MeetingRoomView';

// Supabase/Postgrest errors are plain objects, not Error instances.
const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
};

interface SamTeckMeetViewProps {
  initialMeetingSlug?: string;
  onClearMeetingSlug?: () => void;
}

export const SamTeckMeetView: React.FC<SamTeckMeetViewProps> = ({
  initialMeetingSlug,
  onClearMeetingSlug,
}) => {
  const { user, organization, hasPermission } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  // Delete Meeting
  const canDeleteMeeting = hasPermission('delete_meeting');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Meeting | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Schedule Modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [newDuration, setNewDuration] = useState('45');
  const [newProjectId, setNewProjectId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // `silent` avoids flipping the loading spinner — used by realtime refreshes
  // and by post-delete refreshes so the list doesn't blank out.
  const fetchMeetings = async (opts: { silent?: boolean } = {}) => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    if (!opts.silent) setLoading(true);
    try {
      let query = supabase.from('meetings').select('*, host:profiles(*), project:projects(*)').order('start_time', { ascending: true });
      if (organization?.id) {
        query = query.eq('organization_id', organization.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      const list = (data as Meeting[]) || [];
      setMeetings(list);

      // If initial slug is specified, auto-join
      if (initialMeetingSlug) {
        const found = list.find((m) => m.slug === initialMeetingSlug);
        if (found) {
          setActiveMeeting(found);
        }
      }

      // Fetch projects for meeting linking
      const { data: pData } = await supabase.from('projects').select('*');
      if (pData) setProjects(pData as Project[]);
    } catch (err) {
      console.error('Error fetching meetings:', err);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, [organization?.id, initialMeetingSlug]);

  // REALTIME: subscribe to meetings changes so a delete (by anyone) is
  // reflected on every connected client immediately.
  useEffect(() => {
    if (!isSupabaseConfigured() || !organization?.id) return;

    const channel = supabase
      .channel(`meetings-org-${organization.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meetings', filter: `organization_id=eq.${organization.id}` },
        (payload) => {
          // Optimistic removal keeps the UI instant even if the refetch is slow.
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id?: string };
            if (oldRow?.id) {
              setMeetings((prev) => prev.filter((m) => m.id !== oldRow.id));
            }
          }
          fetchMeetings({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organization?.id]);

  // Handle Instant Meeting Launch
  const handleLaunchInstantMeeting = async () => {
    if (!user) return;
    const randomSlug = 'meet-' + Math.random().toString(36).substring(2, 9);
    const roomName = 'samteck-' + randomSlug;
    const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';

    const instantMeeting: Meeting = {
      id: 'local-' + Date.now(),
      organization_id: orgId,
      title: 'Instant Collaboration Session',
      slug: randomSlug,
      host_id: user.id,
      start_time: new Date().toISOString(),
      duration_minutes: 60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'live',
      livekit_room_name: roomName,
      is_private: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('meetings')
          .insert({
            organization_id: orgId,
            title: instantMeeting.title,
            slug: instantMeeting.slug,
            host_id: user.id,
            start_time: instantMeeting.start_time,
            duration_minutes: 60,
            timezone: instantMeeting.timezone,
            status: 'live',
            livekit_room_name: roomName,
          })
          .select('*, host:profiles(*)')
          .single();

        if (!error && data) {
          setActiveMeeting(data as Meeting);
          return;
        }
      } catch (err) {
        console.warn('Could not persist instant meeting to DB:', err);
      }
    }

    setActiveMeeting(instantMeeting);
  };

  // Schedule Meeting in Supabase
  const handleScheduleMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate || !user) return;

    if (!isSupabaseConfigured()) {
      alert(
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env (or use Database Setup in the banner), then run the migration.'
      );
      return;
    }

    if (!organization?.id) {
      alert(
        'Your account is not linked to an organization yet, so the meeting cannot be saved. ' +
          'This usually means the organization_memberships row is missing for your user.'
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const slug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20) + '-' + Math.random().toString(36).substring(2, 6);
      const roomName = 'samteck-' + slug;
      const startDateTime = new Date(`${newDate}T${newTime}:00`).toISOString();
      const orgId = organization.id;

      const { data, error } = await supabase
        .from('meetings')
        .insert({
          organization_id: orgId,
          title: newTitle.trim(),
          slug,
          description: newDesc.trim() || null,
          project_id: newProjectId || null,
          host_id: user.id,
          start_time: startDateTime,
          duration_minutes: parseInt(newDuration, 10) || 45,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          status: 'scheduled',
          livekit_room_name: roomName,
        })
        .select('*, host:profiles(*), project:projects(*)')
        .single();

      if (error) throw error;

      setShowScheduleModal(false);
      setNewTitle('');
      setNewDesc('');
      fetchMeetings();
      if (data) {
        setMeetings((prev) => [data as Meeting, ...prev]);
      }
    } catch (err) {
      console.error('Error creating meeting:', err);
      const msg = getErrorMessage(err, 'Unknown error');
      const details =
        err && typeof err === 'object' && 'details' in err && (err as { details?: string }).details
          ? ` (${(err as { details: string }).details})`
          : '';
      alert('Failed to schedule meeting: ' + msg + details);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete an upcoming session. Super-admin only, enforced server-side by RLS.
  const handleDeleteMeeting = async () => {
    const target = confirmDelete;
    if (!target) return;

    setDeletingId(target.id);
    setDeleteError(null);

    try {
      const { error } = await supabase.from('meetings').delete().eq('id', target.id);
      if (error) throw error;

      // Remove locally right away; the realtime subscription keeps other
      // clients in sync.
      setMeetings((prev) => prev.filter((m) => m.id !== target.id));
      setConfirmDelete(null);

      await supabase.from('audit_logs').insert({
        user_id: user?.id || null,
        user_email: user?.email || null,
        action: 'MEETING_DELETED',
        target_entity: 'meetings',
        target_id: target.id,
        details: { title: target.title, slug: target.slug, start_time: target.start_time },
      });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Unknown error');
      setDeleteError(
        msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('row-level')
          ? 'You do not have permission to delete sessions. Only a Super Administrator can do this.'
          : `Failed to delete session: ${msg}`
      );
    } finally {
      setDeletingId(null);
    }
  };

  // If in an active meeting, render MeetingRoomView
  if (activeMeeting) {
    return (
      <MeetingRoomView
        meeting={activeMeeting}
        onLeaveMeeting={() => {
          setActiveMeeting(null);
          if (onClearMeetingSlug) onClearMeetingSlug();
          fetchMeetings();
        }}
      />
    );
  }

  const upcomingMeetings = meetings.filter((m) => m.status === 'scheduled' || m.status === 'live');
  const pastMeetings = meetings.filter((m) => m.status === 'completed' || m.status === 'cancelled');

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200">
              <Video className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#172B4D]">
                Sam_Teck Meet: Native Virtual Meetings
              </h1>
              <p className="text-xs text-[#65758B]">
                Branded real-time audio, video, screen share, and meeting minutes with task integration.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleLaunchInstantMeeting}
            className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            Start Instant Meeting
          </button>
          <button
            onClick={() => setShowScheduleModal(true)}
            className="px-3.5 py-2 bg-[#2457A7] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Calendar className="w-3.5 h-3.5" />
            Schedule Session
          </button>
        </div>
      </div>

      {/* Main Content: Meetings List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Upcoming Sessions */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-bold text-[#172B4D]">Upcoming Sessions ({upcomingMeetings.length})</h2>

          {loading ? (
            <div className="py-12 bg-white rounded-xl border border-[#DCE5F0] text-center text-xs text-[#65758B]">
              <div className="animate-spin w-5 h-5 border-2 border-[#123B73] border-t-transparent rounded-full mx-auto mb-2" />
              Loading virtual meeting schedule from Supabase...
            </div>
          ) : upcomingMeetings.length === 0 ? (
            /* Honest empty state */
            <div className="bg-white rounded-xl border border-[#DCE5F0] p-12 text-center shadow-xs">
              <Video className="w-12 h-12 text-[#65758B]/40 mx-auto mb-3" />
              <h3 className="text-base font-bold text-[#172B4D]">No upcoming meetings</h3>
              <p className="text-xs text-[#65758B] max-w-sm mx-auto mt-1 mb-6">
                Schedule a team standup, design review, or client consultation, or launch an instant room right now.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleLaunchInstantMeeting}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  Start Instant Meeting
                </button>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="px-4 py-2 border border-[#DCE5F0] text-[#172B4D] hover:bg-slate-50 text-xs font-semibold rounded-lg transition"
                >
                  Schedule for Later
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingMeetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#123B73] transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#172B4D]">{meeting.title}</span>
                      {meeting.status === 'live' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500 text-white animate-pulse">
                          LIVE NOW
                        </span>
                      )}
                    </div>
                    {meeting.description && (
                      <p className="text-xs text-[#65758B] line-clamp-1">{meeting.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-[11px] text-[#65758B] pt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#123B73]" />
                        {new Date(meeting.start_time).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#123B73]" />
                        {new Date(meeting.start_time).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        ({meeting.duration_minutes}m)
                      </span>
                      {meeting.project && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#123B73] font-medium">
                          {meeting.project.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveMeeting(meeting)}
                      className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-bold rounded-lg transition shadow-xs flex items-center gap-1.5"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Join Room</span>
                    </button>

                    {canDeleteMeeting && (
                      <button
                        onClick={() => {
                          setDeleteError(null);
                          setConfirmDelete(meeting);
                        }}
                        disabled={deletingId === meeting.id}
                        aria-label={`Delete ${meeting.title}`}
                        title="Delete session"
                        className="px-2.5 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 text-xs font-bold rounded-lg transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {deletingId === meeting.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 1 Col: Platform Guidelines & Past Meetings */}
        <div className="space-y-6">
          {/* Security & Features Box */}
          <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#123B73] flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-[#123B73]" />
              Sam_Teck Meet Security
            </h3>
            <ul className="text-xs text-[#65758B] space-y-2">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>WebRTC encrypted real-time audio and video.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>Non-guessable room tokens with strict TTL.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>Minutes & Action items convert directly into project tasks.</span>
              </li>
            </ul>
          </div>

          {/* Past Meetings List */}
          <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs">
            <h3 className="text-xs font-bold text-[#172B4D] mb-3">Past Session Records</h3>
            {pastMeetings.length === 0 ? (
              <div className="text-xs text-[#65758B] py-4 text-center">
                No archived session records yet.
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {pastMeetings.slice(0, 5).map((m) => (
                  <div key={m.id} className="p-2.5 rounded-lg border border-[#DCE5F0] bg-[#F5F8FC]/50">
                    <div className="font-semibold text-[#172B4D]">{m.title}</div>
                    <div className="text-[10px] text-[#65758B]">
                      {new Date(m.start_time).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SCHEDULE MEETING MODAL */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Schedule Virtual Meeting</h2>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-[#65758B] hover:text-[#172B4D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleScheduleMeeting} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Meeting Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Weekly Engineering Sync & Roadmap"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Description & Agenda
                </label>
                <textarea
                  rows={2}
                  placeholder="Outline key discussion points and objectives..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Time *</label>
                  <input
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Duration (Minutes)
                  </label>
                  <select
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="90">90 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                    Link to Project (Optional)
                  </label>
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="">No Project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmitting ? 'Scheduling...' : 'Confirm Meeting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg border border-red-200">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h2 className="text-base font-bold text-[#172B4D]">Delete Session</h2>
            </div>

            <p className="text-xs text-[#65758B]">
              Permanently delete <span className="font-semibold text-[#172B4D]">"{confirmDelete.title}"</span>?
              This removes it for everyone in the workspace and cannot be undone.
            </p>

            {deleteError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {deleteError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2 border-t border-[#DCE5F0]">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(null);
                  setDeleteError(null);
                }}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteMeeting}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingId === confirmDelete.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Session
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
