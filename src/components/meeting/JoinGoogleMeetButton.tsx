import React, { useState } from 'react';
import { AlertCircle, ExternalLink, Link2, Loader2, RefreshCw, Video } from 'lucide-react';
import {
  GoogleMeetApiError,
  GoogleMeetSpace,
  GoogleMeetJoinState,
  googleMeetJoinState,
  isConfigurationProblem,
  openGoogleMeet,
  provisionAndOpenGoogleMeet,
} from '../../lib/googleMeet';
import type { GoogleMeetMeetingShape } from '../../lib/googleMeet';

interface JoinGoogleMeetButtonProps {
  meeting: GoogleMeetMeetingShape;
  /** Host or leadership for this meeting: decides whether we may create a link. */
  canManage: boolean;
  /** Compact variant for dense list rows. */
  compact?: boolean;
  /** Notified after a link is created so the parent can refresh its list. */
  onSpaceCreated?: (space: GoogleMeetSpace) => void;
}

/**
 * The single place Sam_Teck Hub decides what "Join Meeting" can do.
 *
 * It only ever performs real actions:
 *   * opens a validated https://meet.google.com/ link in a new tab, or
 *   * asks the server to create a Google Meet space and opens the link Google
 *     returned, or
 *   * explains why neither is possible right now.
 *
 * It never draws a microphone, camera or participant control — Meet's own
 * interface owns those, and they cannot be embedded here.
 */
export const JoinGoogleMeetButton: React.FC<JoinGoogleMeetButtonProps> = ({
  meeting,
  canManage,
  compact = false,
  onSpaceCreated,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GoogleMeetApiError | null>(null);
  // Set after a successful provisioning so this row flips to "ready" at once,
  // without waiting for the parent to refetch.
  const [createdUri, setCreatedUri] = useState<string | null>(null);

  const state: GoogleMeetJoinState = googleMeetJoinState(
    createdUri ? { ...meeting, google_meeting_uri: createdUri, google_sync_status: 'synced' } : meeting,
    canManage
  );

  const handleProvision = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await provisionAndOpenGoogleMeet(meeting.id);
    setBusy(false);

    if (result.uri) {
      setCreatedUri(result.uri);
      onSpaceCreated?.({
        name: '',
        meetingUri: result.uri,
        cached: false,
      });
    } else if (result.error) {
      setError(result.error);
    }
  };

  // --- Ended -------------------------------------------------------------
  if (state.kind === 'ended') {
    return (
      <span className="px-4 py-2 bg-slate-100 text-[#65758B] text-xs font-semibold rounded-lg border border-[#DCE5F0]">
        Meeting ended
      </span>
    );
  }

  const btnBase = compact
    ? 'px-3.5 py-1.5 text-xs font-bold rounded-lg transition shadow-xs flex items-center gap-1.5'
    : 'px-4 py-2 text-xs font-bold rounded-lg transition shadow-xs flex items-center gap-1.5';

  const notice = error ? (
    <div
      role="alert"
      className={`mt-2 flex items-start gap-1.5 text-[11px] leading-snug ${
        isConfigurationProblem(error) ? 'text-[#2457A7]' : 'text-red-600'
      }`}
    >
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>
        {isConfigurationProblem(error)
          ? 'Google Meet is not connected to this deployment yet. A Super Administrator must add the Google OAuth credentials on the server.'
          : error.message}
        {canManage && !isConfigurationProblem(error) ? ' You can retry.' : ''}
      </span>
    </div>
  ) : null;

  // --- Link ready: open it ----------------------------------------------
  if (state.kind === 'link_ready') {
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={() => openGoogleMeet(state.uri)}
          className={`${btnBase} bg-[#123B73] hover:bg-[#2457A7] text-white`}
          title="Opens meet.google.com in a new tab"
        >
          <Video className={compact ? 'w-3.5 h-3.5' : 'w-3.5 h-3.5'} />
          <span>Join in Google Meet</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </button>
        {!compact && (
          <span className="mt-1 text-[10px] text-[#65758B]">
            Opens meet.google.com in a new tab
          </span>
        )}
        {notice}
      </div>
    );
  }

  // --- Failed ------------------------------------------------------------
  if (state.kind === 'failed') {
    return (
      <div className="flex flex-col items-end">
        {canManage ? (
          <button
            onClick={handleProvision}
            disabled={busy}
            className={`${btnBase} bg-[#123B73] hover:bg-[#2457A7] text-white disabled:opacity-60`}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {busy ? 'Creating…' : 'Retry link creation'}
          </button>
        ) : (
          <span className="px-4 py-2 bg-slate-100 text-[#65758B] text-xs font-semibold rounded-lg border border-[#DCE5F0]">
            Link unavailable
          </span>
        )}
        {!error && (
          <span className="mt-1 max-w-[22rem] text-right text-[10px] leading-snug text-red-600">
            {state.message}
          </span>
        )}
        {notice}
      </div>
    );
  }

  // --- No link yet -------------------------------------------------------
  return (
    <div className="flex flex-col items-end">
      {canManage ? (
        <button
          onClick={handleProvision}
          disabled={busy}
          className={`${btnBase} bg-[#123B73] hover:bg-[#2457A7] text-white disabled:opacity-60`}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Link2 className="w-3.5 h-3.5" />
          )}
          {busy ? 'Creating Google Meet link…' : 'Create Google Meet link'}
        </button>
      ) : (
        <span
          className="px-4 py-2 bg-slate-100 text-[#65758B] text-xs font-semibold rounded-lg border border-[#DCE5F0]"
          title="An organiser or team leader still has to create the Google Meet link."
        >
          Link not ready
        </span>
      )}
      {!busy && !canManage && (
        <span className="mt-1 text-[10px] text-[#65758B]">
          Waiting for the organiser to create it
        </span>
      )}
      {notice}
    </div>
  );
};
