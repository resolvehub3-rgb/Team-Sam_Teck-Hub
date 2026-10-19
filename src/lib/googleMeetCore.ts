/**
 * Pure Google Meet state logic — no I/O, no imports.
 *
 * Kept separate from `googleMeet.ts` (which talks to the network and pulls in
 * the Supabase client) so this module can be unit-tested directly, following
 * the same split the repository already uses for `meetingSession.ts`.
 *
 * WHY THE SCOPE IS THIS NARROW
 *
 * Google Meet's conference UI cannot be rendered inside Sam_Teck Hub:
 *
 *   * `meet.google.com/<meeting-code>` responds with `X-Frame-Options:
 *     SAMEORIGIN`, which browsers enforce against a cross-origin <iframe>.
 *   * Google's Meet Embed SDK Web no longer exists — every documentation URL
 *     and the hosted `embed.js` return 404, and the current SDK overview lists
 *     only the Add-ons SDK, the REST API and the Media API.
 *   * The Meet REST API creates and manages meeting spaces; it has no video,
 *     audio or UI surface at all.
 *
 * So the genuine, supported capability modelled here is: a meeting may have a
 * Google-created join link, which is opened in a new tab. Nothing in this file
 * describes or permits a fake in-page call.
 */

/** The slice of a meeting row this module needs. */
export interface GoogleMeetMeetingShape {
  id: string;
  status: string;
  google_meeting_uri?: string | null;
  google_sync_status?: string | null;
  google_last_error?: string | null;
}

/** Response shape returned by POST/GET /api/meet/google/space. */
export interface GoogleMeetSpace {
  name: string;
  meetingUri: string;
  cached: boolean;
}

/** Every state a "Join Meeting" button can honestly be in. */
export type GoogleMeetJoinState =
  /** The meeting is over; there is nothing to join. */
  | { kind: 'ended' }
  /** A real link exists — open it in a new tab. */
  | { kind: 'link_ready'; uri: string }
  /** No link yet. `canManage` decides whether we offer to create one. */
  | { kind: 'needs_provisioning'; canManage: boolean }
  /** The last attempt failed; carry the server's explanation. */
  | { kind: 'failed'; message: string; canManage: boolean };

/**
 * Validate a join link.
 *
 * Deliberately strict: only `https://meet.google.com/...`. The server writes
 * this value from Google's own response, but it is checked again here so a
 * corrupted or tampered row can never be handed to `window.open`.
 */
export function isGoogleMeetUri(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meet.google.com';
  } catch {
    return false;
  }
}

/** Derive the button state. Pure, so it is covered by unit tests. */
export function googleMeetJoinState(
  meeting: GoogleMeetMeetingShape,
  canManage: boolean
): GoogleMeetJoinState {
  if (meeting.status === 'completed' || meeting.status === 'cancelled') {
    return { kind: 'ended' };
  }

  const uri = meeting.google_meeting_uri;
  if (isGoogleMeetUri(uri)) {
    return { kind: 'link_ready', uri };
  }

  if (meeting.google_sync_status === 'failed') {
    const stored = typeof meeting.google_last_error === 'string' ? meeting.google_last_error.trim() : '';
    return {
      kind: 'failed',
      message: stored || 'The Google Meet link could not be created.',
      canManage,
    };
  }

  return { kind: 'needs_provisioning', canManage };
}

/** Error raised by our own API, carrying a code the UI can branch on. */
export class GoogleMeetApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GoogleMeetApiError';
  }
}

/** True when the server reported the integration as absent or unauthorised. */
export function isConfigurationProblem(err: GoogleMeetApiError | undefined | null): boolean {
  if (!err) return false;
  return (
    err.code === 'GOOGLE_MEET_NOT_CONFIGURED' ||
    err.code === 'GOOGLE_MEET_AUTH_FAILED' ||
    err.status === 503 ||
    err.status === 401
  );
}
