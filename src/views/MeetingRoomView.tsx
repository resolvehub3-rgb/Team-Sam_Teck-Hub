import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  MessageSquare,
  FileText,
  Users,
  AlertCircle,
  Send,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Volume2,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useAudioPlayback,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  type TrackReference
} from '@livekit/components-react';
import {
  ConnectionState,
  MediaDeviceFailure,
  Track,
  type Participant
} from 'livekit-client';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Meeting, MeetingChatMessage, MeetingActionItem, MeetingDecision, Project } from '../types/database';

interface MeetingRoomViewProps {
  meeting: Meeting;
  onLeaveMeeting: () => void;
}

/** Everything the server authorised for this join, minted by /api/meet/token. */
interface RoomSession {
  token: string;
  serverUrl: string;
  roomName: string;
  identity: string;
  isHost: boolean;
}

const initialsOf = (name?: string) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

/** Human wording for the SDK's device-failure codes. */
const describeDeviceFailure = (failure?: MediaDeviceFailure, kind?: MediaDeviceKind): string => {
  const device = kind === 'audioinput' ? 'microphone' : kind === 'videoinput' ? 'camera' : 'device';
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return `Permission for your ${device} was denied. Allow access in your browser's address-bar settings, then rejoin.`;
    case MediaDeviceFailure.NotFound:
      return `No ${device} was found on this device. You can still join to listen and watch.`;
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${device} is being used by another application. Close it and rejoin.`;
    default:
      return `Your ${device} could not be started. You can still join to listen and watch.`;
  }
};

/** Plain-language text for a failed microphone / camera / screen-share action. */
const describeMediaError = (err: unknown, what: string): string => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `The browser blocked ${what}. Allow access in the address-bar settings and try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No usable ${what === 'screen sharing' ? 'screen' : 'device'} is available for ${what}.`;
  }
  if (name === 'NotSupportedError') {
    return what === 'screen sharing'
      ? 'Screen sharing is not supported in this browser. Try Chrome, Edge or Firefox.'
      : `${what} is not supported in this browser.`;
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return `Could not update ${what}${detail}.`;
};

export const MeetingRoomView: React.FC<MeetingRoomViewProps> = ({ meeting, onLeaveMeeting }) => {
  const { user, profile } = useAuth();

  /**
   * Host identity is derived from the meeting record the server authorised —
   * meetings.host_id was pinned to auth.uid() by the INSERT policy, so this
   * comparison cannot be influenced by anything in the browser.
   */
  const isHost = Boolean(user && meeting.host_id === user.id);
  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Participant';

  // ---- Pre-join device check -------------------------------------------------
  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const stopPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        previewStreamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        setDeviceError(null);
      } catch (err) {
        // Never block the join on a missing device or a denied permission:
        // the room itself reports media problems through the SDK, and a
        // participant must always be able to join to listen.
        console.warn('Media devices access error:', err);
        if (!cancelled) {
          setDeviceError(describeMediaError(err, 'your camera or microphone'));
          setCameraActive(false);
          setMicActive(false);
        }
      }
    };

    startPreview();
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [stopPreview]);

  const togglePreviewMic = () => {
    setMicActive((prev) => {
      const next = !prev;
      previewStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  };

  const togglePreviewCamera = () => {
    setCameraActive((prev) => {
      const next = !prev;
      previewStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  };

  // ---- Room session (server-authorised) --------------------------------------
  const [session, setSession] = useState<RoomSession | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const intentionalLeaveRef = useRef(false);

  /**
   * Ask the server for a room token. The server verifies our Supabase
   * session, the meeting record, our membership and our role, and derives
   * the identity and host flag itself — the browser never decides who it is.
   */
  const requestRoomToken = useCallback(async (): Promise<'ok' | 'not_configured' | 'error'> => {
    try {
      const sessionToken = await supabase.auth.getSession().then((s) => s.data.session?.access_token);
      if (!sessionToken) {
        setJoinError('Your session has expired. Sign in again before joining the meeting.');
        return 'error';
      }

      if (!meeting.livekit_room_name) {
        setJoinError('This meeting has no virtual room configured, so it cannot be joined online.');
        return 'error';
      }

      const res = await fetch('/api/meet/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ roomName: meeting.livekit_room_name })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token && data.serverUrl) {
        setSession({
          token: data.token,
          serverUrl: data.serverUrl,
          roomName: data.roomName || meeting.livekit_room_name,
          identity: data.identity || user?.id || '',
          isHost: Boolean(data.isHost)
        });
        setJoinError(null);
        return 'ok';
      }
      if (data.error === 'LIVEKIT_NOT_CONFIGURED') {
        setJoinError(
          data.message ||
            'LiveKit is not configured on this deployment yet, so meetings cannot connect.'
        );
        return 'not_configured';
      }
      setJoinError(data.message || data.error || 'The meeting room could not be opened.');
      return 'error';
    } catch (err) {
      console.warn('Could not contact the meeting token endpoint:', err);
      setJoinError('Could not reach the meeting service. Check your connection and try again.');
      return 'error';
    }
  }, [meeting.livekit_room_name, user?.id]);

  const handleJoinMeeting = useCallback(async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      // Release the preview's devices before the room asks for them, so the
      // browser never has to arbitrate between two live capture sessions.
      stopPreview();
      const outcome = await requestRoomToken();
      if (outcome === 'error') {
        // Bring the preview back when the join did not go through.
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null);
        if (stream) {
          previewStreamRef.current = stream;
          if (previewRef.current) previewRef.current.srcObject = stream;
        }
      }
      // On 'ok' the room takes over the devices; on 'not_configured' we stay
      // on this screen with a clear explanation instead of a fake room.
    } finally {
      setJoining(false);
    }
  }, [joining, requestRoomToken, stopPreview]);

  // ---- Meeting records: chat, decisions, action items -------------------------
  const [chatMessages, setChatMessages] = useState<MeetingChatMessage[]>([]);
  const [newChatMessage, setNewChatMessage] = useState('');
  const [minutesNotes, setMinutesNotes] = useState('');
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [newDecisionText, setNewDecisionText] = useState('');
  const [newActionTitle, setNewActionTitle] = useState('');
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [selectedActionProject, setSelectedActionProject] = useState<string>(meeting.project_id || '');
  const [convertingActionId, setConvertingActionId] = useState<string | null>(null);
  const [actionItemError, setActionItemError] = useState<string | null>(null);

  const fetchMeetingRecords = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data: chatData } = await supabase
        .from('meeting_chat_messages')
        .select('*')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (chatData) setChatMessages(chatData as MeetingChatMessage[]);

      const { data: decData } = await supabase
        .from('meeting_decisions')
        .select('*')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (decData) setDecisions(decData as MeetingDecision[]);

      const { data: actData } = await supabase
        .from('meeting_action_items')
        .select('*, project:projects(*)')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (actData) setActionItems(actData as MeetingActionItem[]);

      const { data: pData } = await supabase.from('projects').select('*');
      if (pData) setProjectsList(pData as Project[]);
    } catch (err) {
      console.error('Failed to load meeting records:', err);
    }
  }, [meeting.id]);

  useEffect(() => {
    fetchMeetingRecords();
  }, [fetchMeetingRecords]);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatMessage.trim()) return;

    const senderName = displayName;
    const messageBody = newChatMessage.trim();
    setNewChatMessage('');

    const newMsg: MeetingChatMessage = {
      id: 'local-' + Date.now(),
      meeting_id: meeting.id,
      sender_id: user?.id,
      sender_name: senderName,
      message: messageBody,
      created_at: new Date().toISOString()
    };

    setChatMessages((prev) => [...prev, newMsg]);

    if (isSupabaseConfigured()) {
      await supabase.from('meeting_chat_messages').insert({
        meeting_id: meeting.id,
        sender_id: user?.id || null,
        sender_name: senderName,
        message: messageBody
      });
    }
  };

  const handleAddDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecisionText.trim()) return;

    const text = newDecisionText.trim();
    setNewDecisionText('');

    if (isSupabaseConfigured()) {
      const { data } = await supabase
        .from('meeting_decisions')
        .insert({ meeting_id: meeting.id, decision: text, decided_by: user?.id || null })
        .select()
        .single();

      if (data) setDecisions((prev) => [...prev, data as MeetingDecision]);
    } else {
      setDecisions((prev) => [
        ...prev,
        { id: 'dec-' + Date.now(), meeting_id: meeting.id, decision: text, created_at: new Date().toISOString() }
      ]);
    }
  };

  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActionTitle.trim()) return;

    const title = newActionTitle.trim();
    const dueDate = newActionDueDate || null;
    const projId = selectedActionProject || null;
    setNewActionTitle('');
    setNewActionDueDate('');
    setActionItemError(null);

    if (!isSupabaseConfigured()) {
      setActionItemError('Supabase is not configured, so action items cannot be recorded.');
      return;
    }

    const { data, error } = await supabase
      .from('meeting_action_items')
      .insert({
        meeting_id: meeting.id,
        title,
        project_id: projId,
        due_date: dueDate,
        is_converted_to_task: false
      })
      .select('*, project:projects(*)')
      .single();

    if (error || !data) {
      setNewActionTitle(title);
      setNewActionDueDate(dueDate || '');
      setSelectedActionProject(projId || '');
      setActionItemError(
        error?.message ||
          'The action item could not be saved. You may not have permission to add one to this meeting.'
      );
      return;
    }

    setActionItems((prev) => [...prev, data as MeetingActionItem]);
  };

  const handleConvertActionItemToTask = async (actionItem: MeetingActionItem) => {
    if (!actionItem.project_id) {
      alert('Please assign a project to this action item before converting it to a task.');
      return;
    }

    setConvertingActionId(actionItem.id);
    try {
      const sessionToken = await supabase.auth.getSession().then((s) => s.data.session?.access_token);
      if (!sessionToken) {
        throw new Error('Your session has expired. Sign in again before converting this action item.');
      }

      const res = await fetch('/api/meet/action-items/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          actionItemId: actionItem.id,
          projectId: actionItem.project_id,
          title: actionItem.title,
          description: `Action item originating from meeting "${meeting.title}"`,
          dueDate: actionItem.due_date
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Conversion failed');
      }

      setActionItems((prev) =>
        prev.map((item) =>
          item.id === actionItem.id ? { ...item, is_converted_to_task: true, task_id: data.taskId } : item
        )
      );
    } catch (err: unknown) {
      alert('Error converting to task: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setConvertingActionId(null);
    }
  };

  // ---- Room lifecycle ---------------------------------------------------------
  const handleRoomConnected = useCallback(() => {
    // A scheduled session becomes "live" the moment its host actually enters
    // the room, so every member's meeting list shows the truth. Best-effort:
    // the RLS UPDATE policy already allows the host of their own meeting.
    if (isHost && meeting.status === 'scheduled' && isSupabaseConfigured()) {
      supabase
        .from('meetings')
        .update({ status: 'live', actual_start_time: new Date().toISOString() })
        .eq('id', meeting.id)
        .then(({ error }) => {
          if (error) console.warn('Could not mark meeting live:', error.message);
        });
    }
  }, [isHost, meeting.id, meeting.status]);

  const handleLeaveMeeting = useCallback(() => {
    intentionalLeaveRef.current = true;
    setSession(null);
    onLeaveMeeting();
  }, [onLeaveMeeting]);

  // ---- Pre-join screen --------------------------------------------------------
  if (!session) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl border border-[#DCE5F0] overflow-hidden">
          <div className="bg-[#123B73] p-5 text-white flex items-center justify-between border-b border-[#0B1F3A]">
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-emerald-400" />
              <div>
                <h2 className="text-base font-bold">Sam_Teck Meet: Pre-Join Device Check</h2>
                <p className="text-xs text-blue-200">Room: {meeting.title}</p>
              </div>
            </div>
            <button onClick={onLeaveMeeting} className="text-xs text-blue-200 hover:text-white underline">
              Cancel
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="relative aspect-video bg-[#0B1F3A] rounded-xl overflow-hidden flex items-center justify-center border border-[#123B73]">
              <video
                ref={previewRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              {!cameraActive && (
                <div className="text-center text-slate-400">
                  <div className="w-16 h-16 rounded-full bg-[#123B73] border-2 border-blue-400/40 flex items-center justify-center font-bold text-xl text-white mx-auto mb-2">
                    {initialsOf(displayName)}
                  </div>
                  <p className="text-xs font-semibold">Camera is turned off</p>
                </div>
              )}

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#0B1F3A]/80 backdrop-blur-xs p-2 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={togglePreviewMic}
                  className={`p-3 rounded-full transition ${
                    micActive ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500 text-white'
                  }`}
                  aria-label={micActive ? 'Mute microphone' : 'Unmute microphone'}
                >
                  {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={togglePreviewCamera}
                  className={`p-3 rounded-full transition ${
                    cameraActive ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500 text-white'
                  }`}
                  aria-label={cameraActive ? 'Turn off camera' : 'Turn on camera'}
                >
                  {cameraActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {deviceError && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deviceError}</span>
              </div>
            )}

            {joinError && (
              <div
                className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{joinError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="text-left">
                <span className="text-xs text-[#65758B]">Joining as:</span>
                <div className="text-sm font-bold text-[#172B4D] flex items-center gap-2">
                  {displayName}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isHost ? 'bg-[#123B73] text-white' : 'bg-slate-100 text-[#65758B]'
                    }`}
                  >
                    {isHost ? 'Host' : 'Participant'}
                  </span>
                </div>
              </div>

              <button
                onClick={handleJoinMeeting}
                disabled={joining}
                className="w-full sm:w-auto px-6 py-3 bg-[#123B73] hover:bg-[#2457A7] text-white font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {joining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Authorising…</span>
                  </>
                ) : (
                  <>
                    <span>Join Meeting Now</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Live room --------------------------------------------------------------
  return (
    <LiveKitRoom
      key={session.token}
      token={session.token}
      serverUrl={session.serverUrl}
      connect
      audio={micActive}
      video={cameraActive}
      options={{
        // Adaptive subscription + dynacast keep many-participant rooms
        // usable on modest connections by scaling down what each client
        // subscribes to and pausing what nobody is looking at.
        dynacast: true,
        adaptiveStream: true
      }}
      onConnected={handleRoomConnected}
      onError={(error) => console.warn('Meeting room error:', error.message)}
      onMediaDeviceFailure={(failure, kind) => setDeviceError(describeDeviceFailure(failure, kind))}
    >
      <RoomAudioRenderer />
      <InMeetingStage
        meeting={meeting}
        displayName={displayName}
        session={session}
        onLeave={handleLeaveMeeting}
        deviceError={deviceError}
        onDismissDeviceError={() => setDeviceError(null)}
        chatMessages={chatMessages}
        newChatMessage={newChatMessage}
        onNewChatMessageChange={setNewChatMessage}
        onSendChatMessage={handleSendChatMessage}
        minutesNotes={minutesNotes}
        onMinutesNotesChange={setMinutesNotes}
        decisions={decisions}
        newDecisionText={newDecisionText}
        onNewDecisionTextChange={setNewDecisionText}
        onAddDecision={handleAddDecision}
        actionItems={actionItems}
        newActionTitle={newActionTitle}
        onNewActionTitleChange={setNewActionTitle}
        newActionDueDate={newActionDueDate}
        onNewActionDueDateChange={setNewActionDueDate}
        selectedActionProject={selectedActionProject}
        onSelectActionProject={setSelectedActionProject}
        projectsList={projectsList}
        actionItemError={actionItemError}
        convertingActionId={convertingActionId}
        onAddActionItem={handleAddActionItem}
        onConvertActionItem={handleConvertActionItemToTask}
      />
    </LiveKitRoom>
  );
};

// ---------------------------------------------------------------------------
// In-meeting stage: everything below renders inside the LiveKitRoom context.
// ---------------------------------------------------------------------------

interface InMeetingStageProps {
  meeting: Meeting;
  displayName: string;
  session: RoomSession;
  onLeave: () => void;
  deviceError: string | null;
  onDismissDeviceError: () => void;
  chatMessages: MeetingChatMessage[];
  newChatMessage: string;
  onNewChatMessageChange: (value: string) => void;
  onSendChatMessage: (e: React.FormEvent) => void;
  minutesNotes: string;
  onMinutesNotesChange: (value: string) => void;
  decisions: MeetingDecision[];
  newDecisionText: string;
  onNewDecisionTextChange: (value: string) => void;
  onAddDecision: (e: React.FormEvent) => void;
  actionItems: MeetingActionItem[];
  newActionTitle: string;
  onNewActionTitleChange: (value: string) => void;
  newActionDueDate: string;
  onNewActionDueDateChange: (value: string) => void;
  selectedActionProject: string;
  onSelectActionProject: (value: string) => void;
  projectsList: Project[];
  actionItemError: string | null;
  convertingActionId: string | null;
  onAddActionItem: (e: React.FormEvent) => void;
  onConvertActionItem: (item: MeetingActionItem) => void;
}

const InMeetingStage: React.FC<InMeetingStageProps> = ({
  meeting,
  displayName,
  session,
  onLeave,
  deviceError,
  onDismissDeviceError,
  chatMessages,
  newChatMessage,
  onNewChatMessageChange,
  onSendChatMessage,
  minutesNotes,
  onMinutesNotesChange,
  decisions,
  newDecisionText,
  onNewDecisionTextChange,
  onAddDecision,
  actionItems,
  newActionTitle,
  onNewActionTitleChange,
  newActionDueDate,
  onNewActionDueDateChange,
  selectedActionProject,
  onSelectActionProject,
  projectsList,
  actionItemError,
  convertingActionId,
  onAddActionItem,
  onConvertActionItem
}) => {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const { canPlayAudio, startAudio } = useAudioPlayback();

  const cameraTracks = useTracks([Track.Source.Camera]);
  const screenTracks = useTracks([Track.Source.ScreenShare]);

  const [activeSidePanel, setActiveSidePanel] = useState<'chat' | 'minutes' | 'participants' | null>(null);
  const [mediaBusy, setMediaBusy] = useState<'mic' | 'camera' | 'screen' | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Expose the connected room for automated verification in development
  // builds only. It holds no credentials the browser does not already have.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __samTeckMeetingRoom?: unknown };
    w.__samTeckMeetingRoom = room;
    return () => {
      if (w.__samTeckMeetingRoom === room) delete w.__samTeckMeetingRoom;
    };
  }, [room]);

  // ---- Media controls ---------------------------------------------------------
  const toggleMic = async () => {
    if (mediaBusy) return;
    setMediaBusy('mic');
    setMediaError(null);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (err) {
      console.warn('Microphone toggle failed:', err);
      setMediaError(describeMediaError(err, 'your microphone'));
    } finally {
      setMediaBusy(null);
    }
  };

  const toggleCamera = async () => {
    if (mediaBusy) return;
    setMediaBusy('camera');
    setMediaError(null);
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      console.warn('Camera toggle failed:', err);
      setMediaError(describeMediaError(err, 'your camera'));
    } finally {
      setMediaBusy(null);
    }
  };

  const toggleScreenShare = async () => {
    if (mediaBusy) return;
    setMediaBusy('screen');
    setMediaError(null);
    try {
      if (isScreenShareEnabled) {
        // Stops the capture and unpublishes the track; every other client
        // drops the presentation immediately.
        await localParticipant.setScreenShareEnabled(false);
      } else {
        // Opens the browser's native picker. `audio: true` offers tab/system
        // audio where the browser supports it (Chrome/Edge); other browsers
        // simply omit that option. Cancelling the picker throws, which is
        // reported as an informational message, not an error state.
        await localParticipant.setScreenShareEnabled(true, {
          audio: true,
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          contentHint: 'detail'
        });
      }
    } catch (err) {
      console.warn('Screen share toggle failed:', err);
      const name = err instanceof Error ? err.name : '';
      if (name !== 'NotAllowedError') {
        setMediaError(describeMediaError(err, 'screen sharing'));
      }
    } finally {
      setMediaBusy(null);
    }
  };

  const handleLeave = () => onLeave();

  // ---- Roster derived state ---------------------------------------------------
  const cameraByIdentity = useMemo(() => {
    const map = new Map<string, TrackReference>();
    for (const ref of cameraTracks) map.set(ref.participant.identity, ref);
    return map;
  }, [cameraTracks]);

  const orderedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.isLocal) return -1;
      if (b.isLocal) return 1;
      const at = a.joinedAt?.getTime() ?? 0;
      const bt = b.joinedAt?.getTime() ?? 0;
      return at - bt;
    });
  }, [participants]);

  const remoteCount = participants.filter((p) => !p.isLocal).length;

  // A screen share in progress gets the prominent surface. Remote shares win
  // over one's own so the viewer always sees what others are presenting.
  const activeScreenRef = useMemo(() => {
    const live = screenTracks.filter((ref) => !ref.publication.isMuted && ref.publication.track);
    if (live.length === 0) return null;
    return live.find((ref) => !ref.participant.isLocal) || live[0];
  }, [screenTracks]);

  const connectionLabel =
    connectionState === ConnectionState.Connected
      ? 'Connected'
      : connectionState === ConnectionState.Reconnecting
        ? 'Reconnecting…'
        : connectionState === ConnectionState.Connecting
          ? 'Joining…'
          : 'Disconnected';

  const isSharingScreen = (p: Participant) => {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    return Boolean(pub && !pub.isMuted);
  };
  const isMicOn = (p: Participant) => {
    const pub = p.getTrackPublication(Track.Source.Microphone);
    return Boolean(pub && !pub.isMuted);
  };
  const isCamOn = (p: Participant) => {
    const pub = p.getTrackPublication(Track.Source.Camera);
    return Boolean(pub && !pub.isMuted);
  };

  const nameOf = (p: Participant) =>
    p.name || p.identity.slice(0, 8) || (p.isLocal ? displayName : 'Participant');

  const isRoomHost = (p: Participant) => p.identity === meeting.host_id;

  const tileChrome = (p: Participant, extra?: React.ReactNode) => (
    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
      <div className="flex items-center gap-1.5 bg-[#0B1F3A]/85 px-2 py-1 rounded-lg text-[11px] font-semibold text-white min-w-0">
        <span className="truncate">{nameOf(p)}</span>
        {p.isLocal && <span className="text-blue-300 shrink-0">(You)</span>}
        {isRoomHost(p) && (
          <span className="px-1 py-px rounded bg-emerald-500/90 text-[9px] font-bold uppercase tracking-wider shrink-0">
            Host
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {extra}
        {!isMicOn(p) && <MicOff className="w-3.5 h-3.5 text-red-400" />}
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-6rem)] bg-[#0B1F3A] rounded-2xl overflow-hidden flex flex-col text-white border border-[#123B73]">
      {/* Top bar */}
      <div className="h-16 bg-[#123B73] px-4 py-2 flex items-center justify-between gap-3 border-b border-[#0B1F3A] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              connectionState === ConnectionState.Connected
                ? 'bg-emerald-400 animate-pulse'
                : connectionState === ConnectionState.Reconnecting
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-slate-400'
            }`}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight text-white truncate max-w-[200px] sm:max-w-xs">
              {meeting.title}
            </h2>
            <div className="text-[10px] text-blue-200 truncate flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 ${
                  connectionState === ConnectionState.Connected
                    ? 'text-emerald-300'
                    : connectionState === ConnectionState.Reconnecting
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }`}
              >
                {connectionState === ConnectionState.Connected ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {connectionLabel}
              </span>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {participants.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'participants' ? null : 'participants')}
            className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSidePanel === 'participants' ? 'bg-[#0B1F3A] text-white' : 'hover:bg-[#2457A7] text-blue-100'
            }`}
            title="Participants"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">People</span>
            <span className="w-4 h-4 rounded-full bg-[#0B1F3A] text-[10px] flex items-center justify-center">
              {participants.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'chat' ? null : 'chat')}
            className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSidePanel === 'chat' ? 'bg-[#0B1F3A] text-white' : 'hover:bg-[#2457A7] text-blue-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
            {chatMessages.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#0B1F3A] text-[10px] flex items-center justify-center">
                {chatMessages.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'minutes' ? null : 'minutes')}
            className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSidePanel === 'minutes' ? 'bg-[#0B1F3A] text-white' : 'hover:bg-[#2457A7] text-blue-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Agenda & Minutes</span>
          </button>

          <button
            onClick={handleLeave}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      {/* Banners */}
      <div className="shrink-0">
        {!canPlayAudio && connectionState === ConnectionState.Connected && (
          <button
            onClick={() => startAudio()}
            className="w-full px-4 py-2 bg-amber-500/90 text-[#0B1F3A] text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-400"
          >
            <Volume2 className="w-4 h-4" />
            Your browser is blocking audio playback — click to enable sound
          </button>
        )}
        {(deviceError || mediaError) && (
          <div className="px-4 py-2 bg-amber-500/20 border-b border-amber-500/30 text-[11px] text-amber-200 flex items-start justify-between gap-3">
            <span className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{mediaError || deviceError}</span>
            </span>
            <button
              onClick={() => {
                setMediaError(null);
                onDismissDeviceError();
              }}
              className="text-amber-200 hover:text-white shrink-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Main surface */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-3 sm:p-4 flex flex-col gap-3 overflow-hidden">
          {connectionState !== ConnectionState.Connected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-300" />
              <div className="text-sm font-semibold">
                {connectionState === ConnectionState.Reconnecting
                  ? 'Connection lost — reconnecting…'
                  : 'Connecting to the meeting…'}
              </div>
              <p className="text-xs text-blue-200 max-w-sm">
                Your camera and microphone will resume automatically once the connection is restored.
              </p>
            </div>
          ) : (
            <>
              {/* Prominent screen-sharing surface */}
              {activeScreenRef && (
                <div className="relative bg-black rounded-xl overflow-hidden border border-[#123B73] flex items-center justify-center shrink-0 h-[45%] min-h-[180px]">
                  <VideoTrack trackRef={activeScreenRef} className="w-full h-full object-contain" />
                  <div className="absolute top-2 left-2 bg-[#0B1F3A]/85 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-2">
                    <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {nameOf(activeScreenRef.participant)}
                      {activeScreenRef.participant.isLocal ? ' (You)' : ''} is presenting
                    </span>
                  </div>
                </div>
              )}

              {/* Camera gallery */}
              <div
                className={`flex-1 min-h-0 ${
                  activeScreenRef
                    ? 'flex gap-3 overflow-x-auto pb-1'
                    : `grid gap-3 content-center ${
                        participants.length <= 1
                          ? 'grid-cols-1'
                          : participants.length <= 4
                            ? 'grid-cols-1 sm:grid-cols-2'
                            : 'grid-cols-2 lg:grid-cols-3'
                      }`
                }`}
              >
                {orderedParticipants.map((p) => {
                  const trackRef = cameraByIdentity.get(p.identity);
                  const showVideo = Boolean(trackRef && !trackRef.publication.isMuted);
                  return (
                    <div
                      key={p.identity}
                      className={`relative bg-[#123B73] rounded-xl overflow-hidden border border-[#2457A7]/40 flex items-center justify-center ${
                        activeScreenRef
                          ? 'shrink-0 w-40 sm:w-48 aspect-video'
                          : 'aspect-video w-full'
                      }`}
                    >
                      {showVideo && trackRef ? (
                        <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center">
                          <div className="w-14 h-14 rounded-full bg-[#2457A7] border-2 border-blue-400/40 flex items-center justify-center font-bold text-lg text-white mx-auto mb-1.5">
                            {initialsOf(nameOf(p))}
                          </div>
                          <div className="text-[11px] text-blue-200">
                            {isCamOn(p) ? 'Starting camera…' : 'Camera off'}
                          </div>
                        </div>
                      )}
                      {tileChrome(p, isSharingScreen(p) ? <Monitor className="w-3.5 h-3.5 text-emerald-400" /> : null)}
                    </div>
                  );
                })}

                {remoteCount === 0 && (
                  <div
                    className={`${
                      activeScreenRef
                        ? 'shrink-0 w-56 aspect-video'
                        : 'col-span-full'
                    } flex flex-col items-center justify-center text-center gap-2 p-4 border border-dashed border-[#2457A7]/60 rounded-xl bg-[#0B1F3A]/60`}
                  >
                    <Users className="w-6 h-6 text-blue-300/70" />
                    <div className="text-xs font-semibold text-blue-100">Waiting for others to join…</div>
                    <p className="text-[11px] text-blue-200/80 max-w-xs">
                      Share this meeting from Sam_Teck Hub — only members of your workspace who are
                      authorised for this session can enter.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Control bar */}
          <div className="flex items-center justify-center gap-3 bg-[#123B73]/90 backdrop-blur-md px-4 sm:px-6 py-3 rounded-2xl border border-blue-400/30 shadow-xl shrink-0">
            <button
              onClick={toggleMic}
              disabled={mediaBusy === 'mic'}
              className={`p-3 rounded-xl transition disabled:opacity-60 ${
                isMicrophoneEnabled ? 'bg-[#0B1F3A] hover:bg-[#071324] text-white' : 'bg-red-600 text-white'
              }`}
              title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={!isMicrophoneEnabled}
            >
              {mediaBusy === 'mic' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isMicrophoneEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={toggleCamera}
              disabled={mediaBusy === 'camera'}
              className={`p-3 rounded-xl transition disabled:opacity-60 ${
                isCameraEnabled ? 'bg-[#0B1F3A] hover:bg-[#071324] text-white' : 'bg-red-600 text-white'
              }`}
              title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              aria-pressed={!isCameraEnabled}
            >
              {mediaBusy === 'camera' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCameraEnabled ? (
                <Video className="w-5 h-5" />
              ) : (
                <VideoOff className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={toggleScreenShare}
              disabled={mediaBusy === 'screen'}
              className={`p-3 rounded-xl transition disabled:opacity-60 ${
                isScreenShareEnabled ? 'bg-emerald-600 text-white' : 'bg-[#0B1F3A] hover:bg-[#071324] text-white'
              }`}
              title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}
              aria-pressed={isScreenShareEnabled}
            >
              {mediaBusy === 'screen' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isScreenShareEnabled ? (
                <MonitorOff className="w-5 h-5" />
              ) : (
                <Monitor className="w-5 h-5" />
              )}
            </button>

            <div className="h-6 w-px bg-white/20 mx-1" />

            <button
              onClick={handleLeave}
              className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition flex items-center gap-2 text-xs"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave</span>
            </button>
          </div>
        </div>

        {/* Side panel */}
        {activeSidePanel && (
          <div className="w-80 sm:w-96 bg-[#0B1F3A] border-l border-[#123B73] flex flex-col h-full shrink-0">
            <div className="p-3 border-b border-[#123B73] flex items-center justify-between text-xs font-bold text-white bg-[#123B73]">
              <span>
                {activeSidePanel === 'participants'
                  ? `Participants (${participants.length})`
                  : activeSidePanel === 'chat'
                    ? 'In-Meeting Chat'
                    : 'Meeting Minutes & Action Items'}
              </span>
              <button onClick={() => setActiveSidePanel(null)} className="text-blue-200 hover:text-white">
                ✕
              </button>
            </div>

            {/* PARTICIPANTS PANEL — sourced from the LiveKit room itself */}
            {activeSidePanel === 'participants' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {orderedParticipants.map((p) => (
                  <div
                    key={p.identity}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-[#123B73]/50 border border-[#2457A7]/40"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#2457A7] flex items-center justify-center text-[11px] font-bold shrink-0">
                      {initialsOf(nameOf(p))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">{nameOf(p)}</span>
                        {p.isLocal && <span className="text-[10px] text-blue-300 shrink-0">(You)</span>}
                        {isRoomHost(p) && (
                          <span className="px-1 py-px rounded bg-emerald-500/90 text-[9px] font-bold uppercase tracking-wider shrink-0">
                            Host
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-blue-200/80">
                        {p.connectionQuality === 'good'
                          ? 'Strong connection'
                          : p.connectionQuality === 'poor'
                            ? 'Weak connection'
                            : p.connectionQuality === 'lost'
                              ? 'Connection lost'
                              : 'Connecting…'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isMicOn(p) ? (
                        <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <MicOff className="w-3.5 h-3.5 text-red-400" />
                      )}
                      {isCamOn(p) ? (
                        <Video className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <VideoOff className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      {isSharingScreen(p) && <Monitor className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* CHAT PANEL */}
            {activeSidePanel === 'chat' && (
              <div className="flex-1 flex flex-col justify-between overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {chatMessages.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-400">
                      No messages yet. Chat messages are persisted securely in Supabase.
                    </div>
                  ) : (
                    chatMessages.map((msg) => (
                      <div key={msg.id} className="text-xs space-y-0.5">
                        <div className="flex items-center justify-between text-[10px] text-blue-300">
                          <span className="font-semibold">{msg.sender_name}</span>
                          <span>
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <div className="bg-[#123B73]/60 p-2 rounded-lg text-slate-100 break-words border border-[#2457A7]/30">
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={onSendChatMessage} className="p-3 border-t border-[#123B73] flex gap-2">
                  <input
                    type="text"
                    placeholder="Type message..."
                    value={newChatMessage}
                    onChange={(e) => onNewChatMessageChange(e.target.value)}
                    className="flex-1 bg-[#123B73]/50 border border-[#2457A7] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-[#2457A7] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}

            {/* MINUTES & ACTION ITEMS PANEL */}
            {activeSidePanel === 'minutes' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
                <div>
                  <h4 className="font-bold text-blue-300 mb-2 flex items-center justify-between">
                    <span>Decisions Made ({decisions.length})</span>
                  </h4>
                  <form onSubmit={onAddDecision} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Record a decision..."
                      value={newDecisionText}
                      onChange={(e) => onNewDecisionTextChange(e.target.value)}
                      className="flex-1 bg-[#123B73]/50 border border-[#2457A7] rounded px-2.5 py-1 text-xs text-white"
                    />
                    <button type="submit" className="px-2 py-1 bg-[#2457A7] text-white rounded font-semibold text-xs">
                      +
                    </button>
                  </form>
                  <div className="space-y-1.5">
                    {decisions.map((dec) => (
                      <div key={dec.id} className="p-2 bg-[#123B73]/40 border border-[#2457A7]/40 rounded text-slate-200">
                        {dec.decision}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-blue-300 mb-2">Live notes</h4>
                  <textarea
                    rows={4}
                    value={minutesNotes}
                    onChange={(e) => onMinutesNotesChange(e.target.value)}
                    placeholder="Type discussion notes as the meeting progresses..."
                    className="w-full bg-[#123B73]/50 border border-[#2457A7] rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none resize-none"
                  />
                </div>

                <div className="pt-2 border-t border-[#123B73]">
                  <h4 className="font-bold text-blue-300 mb-2">Follow-Up Action Items</h4>
                  {actionItemError && (
                    <div className="mb-2 p-2 bg-red-500/15 border border-red-400/40 rounded text-[11px] text-red-200" role="alert">
                      {actionItemError}
                    </div>
                  )}
                  <form onSubmit={onAddActionItem} className="space-y-2 mb-3 bg-[#123B73]/30 p-2.5 rounded-lg border border-[#2457A7]/40">
                    <input
                      type="text"
                      required
                      placeholder="Action item title..."
                      value={newActionTitle}
                      onChange={(e) => onNewActionTitleChange(e.target.value)}
                      className="w-full bg-[#0B1F3A] border border-[#2457A7] rounded px-2 py-1 text-xs text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedActionProject}
                        onChange={(e) => onSelectActionProject(e.target.value)}
                        className="bg-[#0B1F3A] border border-[#2457A7] rounded px-1.5 py-1 text-[11px] text-white"
                      >
                        <option value="">Link Project...</option>
                        {projectsList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={newActionDueDate}
                        onChange={(e) => onNewActionDueDateChange(e.target.value)}
                        className="bg-[#0B1F3A] border border-[#2457A7] rounded px-1.5 py-1 text-[11px] text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1 bg-[#2457A7] hover:bg-blue-600 text-white rounded text-xs font-semibold"
                    >
                      Add Action Item
                    </button>
                  </form>

                  <div className="space-y-2">
                    {actionItems.map((act) => (
                      <div key={act.id} className="p-2.5 bg-[#123B73]/40 border border-[#2457A7]/40 rounded-lg space-y-1.5">
                        <div className="font-semibold text-white">{act.title}</div>
                        <div className="text-[10px] text-blue-200 flex items-center justify-between">
                          <span>{act.project?.name || 'No project linked'}</span>
                          {act.due_date && <span>Due {act.due_date}</span>}
                        </div>

                        <div className="pt-1">
                          {act.is_converted_to_task ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Converted to Project Task
                            </span>
                          ) : (
                            <button
                              onClick={() => onConvertActionItem(act)}
                              disabled={convertingActionId === act.id}
                              className="w-full py-1 bg-[#2457A7] hover:bg-blue-600 text-white rounded text-[10px] font-semibold transition"
                            >
                              {convertingActionId === act.id ? 'Converting...' : 'Convert to Real Task →'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
