import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  MessageSquare,
  FileText,
  Users,
  Settings,
  AlertCircle,
  Send,
  Plus,
  CheckCircle2,
  ArrowRight,
  Shield
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Meeting, MeetingChatMessage, MeetingActionItem, MeetingDecision, Project } from '../types/database';

interface MeetingRoomViewProps {
  meeting: Meeting;
  onLeaveMeeting: () => void;
}

export const MeetingRoomView: React.FC<MeetingRoomViewProps> = ({ meeting, onLeaveMeeting }) => {
  const { user, profile } = useAuth();

  // Pre-join state
  const [hasJoined, setHasJoined] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  // In-room UI panels
  const [activeSidePanel, setActiveSidePanel] = useState<'chat' | 'minutes' | 'participants' | null>(null);

  // Live media stream refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // In-meeting Chat State
  const [chatMessages, setChatMessages] = useState<MeetingChatMessage[]>([]);
  const [newChatMessage, setNewChatMessage] = useState('');

  // Meeting Minutes, Decisions & Action Items
  const [minutesNotes, setMinutesNotes] = useState('');
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [newDecisionText, setNewDecisionText] = useState('');
  const [newActionTitle, setNewActionTitle] = useState('');
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [selectedActionProject, setSelectedActionProject] = useState<string>(meeting.project_id || '');
  const [convertingActionId, setConvertingActionId] = useState<string | null>(null);

  // Token state from LiveKit backend
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitError, setLivekitError] = useState<string | null>(null);

  // Initialize camera and microphone preview for Pre-join
  useEffect(() => {
    let stream: MediaStream | null = null;
    async function startMedia() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: unknown) {
        console.warn('Media devices access error:', err);
        setDeviceError('Could not access camera or microphone. Please check browser permissions.');
        setCameraActive(false);
        setMicActive(false);
      }
    }

    startMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Fetch meeting minutes, decisions, and action items from Supabase
  const fetchMeetingRecords = async () => {
    if (!isSupabaseConfigured()) return;
    try {
      // 1. Chat
      const { data: chatData } = await supabase
        .from('meeting_chat_messages')
        .select('*')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (chatData) setChatMessages(chatData as MeetingChatMessage[]);

      // 2. Decisions
      const { data: decData } = await supabase
        .from('meeting_decisions')
        .select('*')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (decData) setDecisions(decData as MeetingDecision[]);

      // 3. Action Items
      const { data: actData } = await supabase
        .from('meeting_action_items')
        .select('*, project:projects(*)')
        .eq('meeting_id', meeting.id)
        .order('created_at', { ascending: true });
      if (actData) setActionItems(actData as MeetingActionItem[]);

      // 4. Projects for action item conversion
      const { data: pData } = await supabase.from('projects').select('*');
      if (pData) setProjectsList(pData as Project[]);
    } catch (err) {
      console.error('Failed to load meeting records:', err);
    }
  };

  useEffect(() => {
    fetchMeetingRecords();
  }, [meeting.id]);

  // Request LiveKit room token from backend server
  const requestRoomToken = async () => {
    try {
      const res = await fetch('/api/meet/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: meeting.livekit_room_name,
          participantIdentity: user?.id || 'guest-' + Math.random().toString(36).substring(7),
          participantName: profile?.full_name || user?.email?.split('@')[0] || 'Participant',
          isHost: meeting.host_id === user?.id,
        }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        setLivekitToken(data.token);
      } else if (data.error === 'LIVEKIT_NOT_CONFIGURED') {
        // Backend informs that LiveKit Cloud credentials are not configured yet
        setLivekitError(data.message);
      }
    } catch (err) {
      console.warn('Could not contact LiveKit token endpoint:', err);
    }
  };

  const handleJoinMeeting = async () => {
    await requestRoomToken();
    setHasJoined(true);
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCameraActive(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicActive(audioTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!screenSharing) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = displayStream;
        }
        setScreenSharing(true);
        displayStream.getVideoTracks()[0].onended = () => {
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
          setScreenSharing(false);
        };
      } else {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        setScreenSharing(false);
      }
    } catch (err) {
      console.warn('Screen share canceled or failed:', err);
    }
  };

  // Send Chat Message
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatMessage.trim()) return;

    const senderName = profile?.full_name || user?.email?.split('@')[0] || 'Team Member';
    const messageBody = newChatMessage.trim();
    setNewChatMessage('');

    const newMsg: MeetingChatMessage = {
      id: 'local-' + Date.now(),
      meeting_id: meeting.id,
      sender_id: user?.id,
      sender_name: senderName,
      message: messageBody,
      created_at: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, newMsg]);

    if (isSupabaseConfigured()) {
      await supabase.from('meeting_chat_messages').insert({
        meeting_id: meeting.id,
        sender_id: user?.id || null,
        sender_name: senderName,
        message: messageBody,
      });
    }
  };

  // Add Decision
  const handleAddDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecisionText.trim()) return;

    const text = newDecisionText.trim();
    setNewDecisionText('');

    if (isSupabaseConfigured()) {
      const { data } = await supabase
        .from('meeting_decisions')
        .insert({
          meeting_id: meeting.id,
          decision: text,
          decided_by: user?.id || null,
        })
        .select()
        .single();

      if (data) setDecisions((prev) => [...prev, data as MeetingDecision]);
    } else {
      setDecisions((prev) => [
        ...prev,
        {
          id: 'dec-' + Date.now(),
          meeting_id: meeting.id,
          decision: text,
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  // Add Action Item
  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActionTitle.trim()) return;

    const title = newActionTitle.trim();
    const dueDate = newActionDueDate || null;
    const projId = selectedActionProject || null;
    setNewActionTitle('');
    setNewActionDueDate('');

    if (isSupabaseConfigured()) {
      const { data } = await supabase
        .from('meeting_action_items')
        .insert({
          meeting_id: meeting.id,
          title,
          project_id: projId,
          due_date: dueDate,
          is_converted_to_task: false,
        })
        .select('*, project:projects(*)')
        .single();

      if (data) setActionItems((prev) => [...prev, data as MeetingActionItem]);
    } else {
      setActionItems((prev) => [
        ...prev,
        {
          id: 'act-' + Date.now(),
          meeting_id: meeting.id,
          title,
          project_id: projId || undefined,
          due_date: dueDate || undefined,
          is_converted_to_task: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    }
  };

  // CONVERT ACTION ITEM TO REAL PROJECT TASK (Section 11)
  const handleConvertActionItemToTask = async (actionItem: MeetingActionItem) => {
    if (!actionItem.project_id) {
      alert('Please assign a project to this action item before converting it to a task.');
      return;
    }

    setConvertingActionId(actionItem.id);
    try {
      const res = await fetch('/api/meet/action-items/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionItemId: actionItem.id,
          projectId: actionItem.project_id,
          title: actionItem.title,
          description: `Action item originating from meeting "${meeting.title}"`,
          dueDate: actionItem.due_date,
          createdBy: user?.id,
        }),
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

  // PRE-JOIN SCREEN
  if (!hasJoined) {
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
            <button
              onClick={onLeaveMeeting}
              className="text-xs text-blue-200 hover:text-white underline"
            >
              Cancel
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Camera Preview Tile */}
            <div className="relative aspect-video bg-[#0B1F3A] rounded-xl overflow-hidden flex items-center justify-center border border-[#123B73]">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              {!cameraActive && (
                <div className="text-center text-slate-400">
                  <VideoOff className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-semibold">Camera is turned off</p>
                </div>
              )}

              {/* Floating Camera / Mic Toggle on preview */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#0B1F3A]/80 backdrop-blur-xs p-2 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`p-3 rounded-full transition ${
                    micActive ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500 text-white'
                  }`}
                  aria-label={micActive ? 'Mute microphone' : 'Unmute microphone'}
                >
                  {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={toggleCamera}
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

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="text-left">
                <span className="text-xs text-[#65758B]">Joining as:</span>
                <div className="text-sm font-bold text-[#172B4D]">
                  {profile?.full_name || user?.email || 'Authorized Participant'}
                </div>
              </div>

              <button
                onClick={handleJoinMeeting}
                className="w-full sm:w-auto px-6 py-3 bg-[#123B73] hover:bg-[#2457A7] text-white font-bold text-sm rounded-xl transition shadow-md flex items-center justify-center gap-2"
              >
                <span>Join Meeting Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LIVE MEETING INTERFACE
  return (
    <div className="h-[calc(100vh-6rem)] bg-[#0B1F3A] rounded-2xl overflow-hidden flex flex-col text-white border border-[#123B73]">
      {/* Live Room Top Bar */}
      <div className="h-16 bg-[#123B73] px-4 py-2 flex items-center justify-between gap-3 border-b border-[#0B1F3A] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight text-white truncate max-w-[200px] sm:max-w-xs">{meeting.title}</h2>
            <div className="text-[10px] text-blue-200 truncate">
              Sam_Teck Meet • Room: <span className="font-mono">{meeting.slug}</span>
            </div>
          </div>
        </div>

        {livekitError && (
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] truncate max-w-sm">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Local preview active. Add LiveKit keys for multi-party mesh.</span>
          </div>
        )}

        <div className="flex items-center gap-2">
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
            onClick={onLeaveMeeting}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      {/* Center Layout: Video Canvas + Optional Side Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Video Surface */}
        <div className="flex-1 p-4 flex flex-col justify-between items-center relative overflow-hidden bg-[#071324]">
          {/* Main Video Tile */}
          <div className="w-full h-full max-w-4xl max-h-[70vh] aspect-video bg-[#0B1F3A] rounded-2xl overflow-hidden relative border border-[#123B73]/60 shadow-2xl flex items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraActive || screenSharing ? 'block' : 'hidden'}`}
            />

            {!cameraActive && !screenSharing && (
              <div className="text-center text-slate-400">
                <div className="w-20 h-20 rounded-full bg-[#123B73] border-2 border-blue-400/40 flex items-center justify-center font-bold text-2xl text-white mx-auto mb-3">
                  {profile?.full_name ? profile.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="font-semibold text-sm text-white">{profile?.full_name || 'You'}</div>
                <div className="text-xs text-blue-200">Camera Off</div>
              </div>
            )}

            {/* In-tile label */}
            <div className="absolute bottom-3 left-3 bg-[#0B1F3A]/80 px-2.5 py-1 rounded-lg text-xs font-medium text-white flex items-center gap-2 border border-white/10">
              <span>{profile?.full_name || 'You'} (Host)</span>
              {!micActive && <MicOff className="w-3 h-3 text-red-400" />}
              {screenSharing && <Monitor className="w-3 h-3 text-emerald-400" />}
            </div>
          </div>

          {/* Floating In-Meeting Controls Bar */}
          <div className="flex items-center gap-3 bg-[#123B73]/90 backdrop-blur-md px-6 py-3 rounded-2xl border border-blue-400/30 shadow-xl mt-3">
            <button
              onClick={toggleMic}
              className={`p-3 rounded-xl transition ${
                micActive ? 'bg-[#0B1F3A] hover:bg-[#071324] text-white' : 'bg-red-600 text-white'
              }`}
              title={micActive ? 'Mute' : 'Unmute'}
            >
              {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleCamera}
              className={`p-3 rounded-xl transition ${
                cameraActive ? 'bg-[#0B1F3A] hover:bg-[#071324] text-white' : 'bg-red-600 text-white'
              }`}
              title={cameraActive ? 'Stop Video' : 'Start Video'}
            >
              {cameraActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleScreenShare}
              className={`p-3 rounded-xl transition ${
                screenSharing ? 'bg-emerald-600 text-white' : 'bg-[#0B1F3A] hover:bg-[#071324] text-white'
              }`}
              title="Share Screen"
            >
              <Monitor className="w-5 h-5" />
            </button>

            <div className="h-6 w-px bg-white/20 mx-1" />

            <button
              onClick={onLeaveMeeting}
              className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition flex items-center gap-2 text-xs"
            >
              <PhoneOff className="w-4 h-4" />
              <span>End Call</span>
            </button>
          </div>
        </div>

        {/* Side Panel: Chat OR Minutes & Action Items */}
        {activeSidePanel && (
          <div className="w-80 sm:w-96 bg-[#0B1F3A] border-l border-[#123B73] flex flex-col h-full shrink-0">
            {/* Panel Header */}
            <div className="p-3 border-b border-[#123B73] flex items-center justify-between text-xs font-bold text-white bg-[#123B73]">
              <span>{activeSidePanel === 'chat' ? 'In-Meeting Chat' : 'Meeting Minutes & Action Items'}</span>
              <button onClick={() => setActiveSidePanel(null)} className="text-blue-200 hover:text-white">
                ✕
              </button>
            </div>

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
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="bg-[#123B73]/60 p-2 rounded-lg text-slate-100 break-words border border-[#2457A7]/30">
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendChatMessage} className="p-3 border-t border-[#123B73] flex gap-2">
                  <input
                    type="text"
                    placeholder="Type message..."
                    value={newChatMessage}
                    onChange={(e) => setNewChatMessage(e.target.value)}
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
                {/* Decisions Section */}
                <div>
                  <h4 className="font-bold text-blue-300 mb-2 flex items-center justify-between">
                    <span>Decisions Made ({decisions.length})</span>
                  </h4>
                  <form onSubmit={handleAddDecision} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Record a decision..."
                      value={newDecisionText}
                      onChange={(e) => setNewDecisionText(e.target.value)}
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

                {/* Follow-up Action Items with Conversion to Tasks */}
                <div className="pt-2 border-t border-[#123B73]">
                  <h4 className="font-bold text-blue-300 mb-2">Follow-Up Action Items</h4>
                  <form onSubmit={handleAddActionItem} className="space-y-2 mb-3 bg-[#123B73]/30 p-2.5 rounded-lg border border-[#2457A7]/40">
                    <input
                      type="text"
                      required
                      placeholder="Action item title..."
                      value={newActionTitle}
                      onChange={(e) => setNewActionTitle(e.target.value)}
                      className="w-full bg-[#0B1F3A] border border-[#2457A7] rounded px-2 py-1 text-xs text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedActionProject}
                        onChange={(e) => setSelectedActionProject(e.target.value)}
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
                        onChange={(e) => setNewActionDueDate(e.target.value)}
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
                      <div
                        key={act.id}
                        className="p-2.5 bg-[#123B73]/40 border border-[#2457A7]/40 rounded-lg space-y-1.5"
                      >
                        <div className="font-semibold text-white">{act.title}</div>
                        <div className="text-[10px] text-blue-200 flex items-center justify-between">
                          <span>{act.project?.name || 'No project linked'}</span>
                          {act.due_date && <span>Due {act.due_date}</span>}
                        </div>

                        {/* Convert to task button */}
                        <div className="pt-1">
                          {act.is_converted_to_task ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Converted to Project Task
                            </span>
                          ) : (
                            <button
                              onClick={() => handleConvertActionItemToTask(act)}
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
