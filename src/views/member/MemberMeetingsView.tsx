import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Video,
  MapPin,
  Clock,
  CalendarDays,
  Users,
  CheckCircle2,
  FileText,
  Phone,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Meeting, MeetingActionItem, MeetingDecision, MeetingMinutes } from '../../types/database';
import { describeAccessError, formatDate, formatDateTime, formatRelativeTime } from '../../utils/format';
import { Chip, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, buttonStyles } from '../../components/ui';
import { JoinGoogleMeetButton } from '../../components/meeting/JoinGoogleMeetButton';

type MeetingTab = 'upcoming' | 'invited' | 'previous';

/** Roles the server accepts as able to provision a Google Meet space. */
const MEETING_LEAD_ROLES = new Set([
  'super_admin',
  'team_leader',
  'assistant_leader',
  'project_manager',
  'department_lead',
]);

/** Physical / hybrid sessions carry a location; virtual ones never show one. */
function meetingKind(m: Meeting): 'virtual' | 'physical' | 'hybrid' {
  const url = (m.meeting_url || '').toLowerCase();
  if (url.includes('meet.google.com') || url.includes('zoom.us')) {
    return m.meeting_url ? 'hybrid' : 'virtual';
  }
  const hasVirtualSession = Boolean(m.google_meeting_uri || m.room_name);
  return hasVirtualSession && m.status !== 'completed'
    ? m.meeting_url
      ? 'hybrid'
      : 'virtual'
    : 'physical';
}

export const MemberMeetingsView: React.FC<{
  /** Meeting opened by a `/meet/:slug` deep link. */
  initialMeetingSlug?: string;
  /** Called when the member closes a meeting opened from a deep link. */
  onLeaveMeeting?: () => void;
}> = ({ initialMeetingSlug, onLeaveMeeting }) => {
  const { user, organization, role } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MeetingTab>('upcoming');
  // The open meeting-details panel. Minutes, decisions and action items live
  // here, and so does the real Google Meet join link.
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);

  const active = meetings.find((m) => m.id === openMeetingId) ?? null;

  /** Mirrors the server's rule for who may create a Google Meet space. */
  const canManageMeeting = (m: Meeting) =>
    m.host_id === user?.id || (typeof role === 'string' && MEETING_LEAD_ROLES.has(role));

  const [minutes, setMinutes] = useState<MeetingMinutes[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);

  const fetchMeetings = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured() || !user) {
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from('meetings')
          .select('*, host:profiles(full_name, email, avatar_url)')
          .order('start_time', { ascending: false });
        if (organization?.id) query = query.eq('organization_id', organization.id);

        const { data, error: err } = await query;
        if (err) throw err;

        // RLS already restricts this to meetings the member may attend; the
        // invitation list decides which tab they appear under.
        const rows = (data as Meeting[]) || [];
        setMeetings(rows);

        const { data: invData } = await supabase
          .from('meeting_invitations')
          .select('meeting_id, status')
          .eq('user_id', user.id);
        setInvitedIds(new Set((invData || []).map((r) => r.meeting_id as string)));
      } catch (err: unknown) {
        setError(describeAccessError(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [user?.id, organization?.id]
  );

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // A shared `/meet/:slug` link must land on the meeting it names rather than
  // a list the recipient then has to search. Opened once so "Back to
  // meetings" sticks, and never while another meeting is already open.
  useEffect(() => {
    if (!initialMeetingSlug || loading || openMeetingId) return;
    const match = meetings.find(
      (m) => m.slug === initialMeetingSlug || m.room_name === initialMeetingSlug
    );
    if (match) setOpenMeetingId(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMeetingSlug, loading, meetings, openMeetingId]);

  // Meeting follow-up: minutes, decisions and any action items assigned out.
  useEffect(() => {
    if (!active) {
      setMinutes([]);
      setDecisions([]);
      setActionItems([]);
      return;
    }
    (async () => {
      const [minRes, decRes, actRes] = await Promise.all([
        supabase.from('meeting_minutes').select('*').eq('meeting_id', active.id).order('created_at', { ascending: false }),
        supabase.from('meeting_decisions').select('*').eq('meeting_id', active.id).order('created_at', { ascending: true }),
        supabase.from('meeting_action_items').select('*, assignee:profiles(full_name)').eq('meeting_id', active.id).order('created_at', { ascending: true }),
      ]);
      setMinutes((minRes.data as MeetingMinutes[]) || []);
      setDecisions((decRes.data as MeetingDecision[]) || []);
      setActionItems((actRes.data as MeetingActionItem[]) || []);
    })();
  }, [active?.id]);

  const now = Date.now();

  const lists = useMemo(() => {
    const endsAt = (m: Meeting) => new Date(m.start_time).getTime() + m.duration_minutes * 60000;
    const upcoming = meetings
      .filter((m) => (m.status === 'scheduled' || m.status === 'live') && (m.status === 'live' || endsAt(m) >= now))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const previous = meetings
      .filter((m) => m.status === 'completed' || m.status === 'cancelled' || endsAt(m) < now)
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    const invited = upcoming.filter((m) => invitedIds.has(m.id));
    return { upcoming, previous, invited };
  }, [meetings, invitedIds, now]);

  const respondToInvite = async (meeting: Meeting, status: 'accepted' | 'declined') => {
    if (!user) return;
    setError(null);
    try {
      const { error: err } = await supabase
        .from('meeting_invitations')
        .update({ status })
        .eq('meeting_id', meeting.id)
        .eq('user_id', user.id);
      if (err) throw err;
      await fetchMeetings({ silent: true });
    } catch (err: unknown) {
      setError(describeAccessError(err));
    }
  };

  // "Back to meetings" closes the details panel. Ending the Google Meet call
  // itself is an explicit action inside Google's own interface (or the host's
  // "End meeting" control) — closing this page never ends it for anyone.
  const handleBackToList = () => {
    setOpenMeetingId(null);
    onLeaveMeeting?.();
  };

  if (active) {
    return (
      <div className="space-y-4">
        <button onClick={handleBackToList} className={`${buttonStyles.secondary} w-fit`}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to meetings
        </button>

        <MeetingDetailsHeader
          meeting={active}
          canManage={canManageMeeting(active)}
          onBack={handleBackToList}
          onSpaceCreated={(uri) =>
            setMeetings((prev) =>
              prev.map((m) =>
                m.id === active.id
                  ? { ...m, google_meeting_uri: uri, google_sync_status: 'synced', google_last_error: null }
                  : m
              )
            )
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SectionCard title="Minutes & notes" icon={FileText}>
            {minutes.length === 0 ? (
              <p className="text-xs text-[#65758B]">No minutes have been published for this meeting.</p>
            ) : (
              <div className="space-y-3">
                {minutes.map((m) => (
                  <div key={m.id} className="p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Chip tone={m.is_finalized ? 'success' : 'warning'}>
                        {m.is_finalized ? 'Final' : 'Draft'}
                      </Chip>
                      <span className="text-[10px] text-[#65758B]">{formatRelativeTime(m.created_at)}</span>
                    </div>
                    {m.summary && <p className="text-xs text-[#65758B] whitespace-pre-wrap">{m.summary}</p>}
                    {m.discussion_notes && (
                      <p className="text-xs text-[#65758B] mt-2 whitespace-pre-wrap">{m.discussion_notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Decisions" icon={CheckCircle2}>
            {decisions.length === 0 ? (
              <p className="text-xs text-[#65758B]">No decisions were recorded.</p>
            ) : (
              <ul className="space-y-2">
                {decisions.map((d) => (
                  <li key={d.id} className="p-2.5 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-xs">
                    <div className="font-semibold text-[#172B4D]">{d.decision}</div>
                    {d.context && <div className="text-[11px] text-[#65758B] mt-1">{d.context}</div>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Action items" icon={Users}>
            {actionItems.length === 0 ? (
              <p className="text-xs text-[#65758B]">No action items came out of this meeting.</p>
            ) : (
              <div className="divide-y divide-[#DCE5F0]">
                {actionItems.map((a) => (
                  <div key={a.id} className="py-2.5 text-xs">
                    <div className="font-semibold text-[#172B4D]">{a.title}</div>
                    <div className="text-[11px] text-[#65758B] mt-0.5">
                      {a.assignee?.full_name || 'Unassigned'}
                      {a.due_date ? ` · Due ${formatDate(a.due_date)}` : ''}
                    </div>
                    <div className="mt-1">
                      {a.is_converted_to_task ? (
                        <Chip tone="success">Added to project tasks</Chip>
                      ) : (
                        <Chip tone="neutral">Not yet a task</Chip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    );
  }

  const visible = tab === 'upcoming' ? lists.upcoming : tab === 'invited' ? lists.invited : lists.previous;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Meetings"
        description="Sessions you host, are invited to, or attended previously."
        icon={Video}
        actions={
          <button onClick={() => fetchMeetings()} disabled={loading} className={buttonStyles.secondary}>
            Refresh
          </button>
        }
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Meeting filters">
        {([
          { id: 'upcoming', label: `Upcoming (${lists.upcoming.length})` },
          { id: 'invited', label: `Invited (${lists.invited.length})` },
          { id: 'previous', label: `Previous (${lists.previous.length})` },
        ] as { id: MeetingTab; label: string }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
              tab === t.id
                ? 'bg-[#123B73] text-white border-[#123B73]'
                : 'bg-white text-[#172B4D] border-[#DCE5F0] hover:bg-[#F5F8FC]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={() => fetchMeetings()} />}

      {loading ? (
        <div className="bg-white rounded-xl border border-[#DCE5F0] shadow-xs">
          <LoadingState label="Loading your meetings…" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Video}
          title={
            tab === 'upcoming'
              ? 'No upcoming meetings'
              : tab === 'invited'
                ? 'No pending invitations'
                : 'No previous meetings yet'
          }
          description={
            tab === 'invited'
              ? 'When someone invites you to a session it appears here so you can accept or decline.'
              : 'Sessions scheduled by you or your team appear here. Your team lead decides who can create meetings.'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((meeting) => {
            const kind = meetingKind(meeting);
            const isHost = meeting.host_id === user?.id;
            const invitation = invitedIds.has(meeting.id);
            const isLive = meeting.status === 'live';
            const canJoin = (isHost || invitation || kind !== 'physical') && meeting.status !== 'completed' && meeting.status !== 'cancelled';

            return (
              <div key={meeting.id} className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-[#172B4D]">{meeting.title}</h3>
                      {isLive && <Chip tone="danger">Live now</Chip>}
                      <Chip tone={kind === 'physical' ? 'warning' : kind === 'hybrid' ? 'info' : 'neutral'}>
                        {kind}
                      </Chip>
                      {isHost && <Chip tone="info">You are the host</Chip>}
                    </div>
                    {meeting.description && (
                      <p className="text-xs text-[#65758B] mt-1 line-clamp-2">{meeting.description}</p>
                    )}

                    <div className="text-[11px] text-[#65758B] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        {formatDateTime(meeting.start_time)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {meeting.duration_minutes} minutes
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {meeting.host?.full_name || 'Host to be confirmed'}
                      </span>
                      {(kind === 'physical' || kind === 'hybrid') && meeting.meeting_url && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {meeting.meeting_url}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {meeting.timezone}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {invitation && !isLive && meeting.status === 'scheduled' && (
                      <>
                        <button onClick={() => respondToInvite(meeting, 'accepted')} className={buttonStyles.primary}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Accept
                        </button>
                        <button onClick={() => respondToInvite(meeting, 'declined')} className={buttonStyles.secondary}>
                          Decline
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => setOpenMeetingId(meeting.id)}
                      className={buttonStyles.secondary}
                      title="Minutes, decisions and action items"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Details
                    </button>

                    {canJoin && (
                      <JoinGoogleMeetButton
                        meeting={meeting}
                        canManage={canManageMeeting(meeting)}
                        compact
                        onSpaceCreated={(space) =>
                          setMeetings((prev) =>
                            prev.map((m) =>
                              m.id === meeting.id
                                ? {
                                    ...m,
                                    google_meeting_uri: space.meetingUri,
                                    google_sync_status: 'synced',
                                    google_last_error: null,
                                  }
                                : m
                            )
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Header of the open meeting: the facts a member needs before joining, the
 * real Google Meet link, and an honest statement of what the link does.
 *
 * Deliberately contains no microphone, camera or participant controls —
 * Google Meet owns those and cannot be rendered inside Sam_Teck Hub, so
 * drawing them here would be a button that does nothing.
 */
const MeetingDetailsHeader: React.FC<{
  meeting: Meeting;
  canManage: boolean;
  onBack: () => void;
  onSpaceCreated?: (uri: string) => void;
}> = ({ meeting, canManage, onBack, onSpaceCreated }) => (
  <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs">
    <button onClick={onBack} className={`${buttonStyles.secondary} w-fit mb-4`}>
      <ArrowLeft className="w-3.5 h-3.5" />
      Back to meetings
    </button>

    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold text-[#172B4D]">{meeting.title}</h2>
          {meeting.status === 'live' && <Chip tone="danger">Live now</Chip>}
          <Chip tone={meeting.status === 'completed' ? 'neutral' : 'info'}>{meeting.status}</Chip>
        </div>

        {meeting.description && (
          <p className="text-xs text-[#65758B] whitespace-pre-wrap">{meeting.description}</p>
        )}

        <div className="text-[11px] text-[#65758B] flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            {formatDateTime(meeting.start_time)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {meeting.duration_minutes} minutes
          </span>
          <span className="inline-flex items-center gap-1">
            <Phone className="w-3 h-3" />
            {meeting.timezone}
          </span>
        </div>

        <p className="text-[11px] text-[#65758B] max-w-xl leading-relaxed">
          Joining opens <span className="font-semibold text-[#172B4D]">meet.google.com in a new
          tab</span>. Google Meet cannot be displayed inside Sam_Teck Hub, and leaving this page
          never ends the call for anyone else.
        </p>
      </div>

      <div className="shrink-0">
        <JoinGoogleMeetButton
          meeting={meeting}
          canManage={canManage}
          onSpaceCreated={(space) => onSpaceCreated?.(space.meetingUri)}
        />
      </div>
    </div>
  </div>
);
