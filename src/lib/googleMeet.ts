/**
 * Google Meet integration for Sam_Teck Hub — the network-facing half.
 *
 * The pure state model lives in `googleMeetCore.ts` and is re-exported here,
 * so callers only ever import this module.
 *
 * WHAT THIS FILE CAN AND CANNOT DO
 *
 * Google Meet's conference UI cannot be rendered inside Sam_Teck Hub:
 *
 *   * `meet.google.com/<meeting-code>` responds with `X-Frame-Options:
 *     SAMEORIGIN`, which every browser enforces against a cross-origin
 *     <iframe>. There is no supported override.
 *   * Google's Meet Embed SDK Web no longer exists — the documentation URLs,
 *     the sitemap entries and the hosted `embed.js` all return 404, and the
 *     current SDK overview lists only the Add-ons SDK, the REST API and the
 *     Media API.
 *   * The Meet REST API creates and manages meeting spaces. It returns JSON —
 *     a space name and a `meetingUri`. It has no video, audio or UI surface.
 *
 * So the genuine, supported capability this module uses is: ask our own
 * server (which holds the OAuth credentials the browser must never see) to
 * create a meeting space, store the resource name and join link, and open
 * that link in a new tab. Nothing here fakes an in-page call, and no control
 * here pretends to be a microphone, camera or participant tile.
 */

import { getAuthHeader } from './supabase';
import {
  GoogleMeetApiError,
  GoogleMeetJoinState,
  GoogleMeetMeetingShape,
  GoogleMeetSpace,
  googleMeetJoinState,
  isConfigurationProblem,
  isGoogleMeetUri,
} from './googleMeetCore';

// Re-export the pure model so consumers have a single import site.
export {
  GoogleMeetApiError,
  googleMeetJoinState,
  isConfigurationProblem,
  isGoogleMeetUri,
};
export type { GoogleMeetJoinState, GoogleMeetMeetingShape, GoogleMeetSpace };

/**
 * Ask the server to create (or return) the Google Meet space for a meeting.
 *
 * The browser sends only the meeting id and the caller's own session token.
 * The OAuth client id, client secret and refresh token stay on the server and
 * are never present in any Vite `VITE_*` variable.
 */
export async function createGoogleMeetSpace(meetingId: string): Promise<GoogleMeetSpace> {
  const headers = await getAuthHeader();
  const res = await fetch('/api/meet/google/space', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ meetingId }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    name?: string;
    meetingUri?: string;
    cached?: boolean;
  };

  if (!res.ok || !body.name || !isGoogleMeetUri(body.meetingUri)) {
    // `message` is the human explanation; `error` is either a machine code or
    // a fallback. Never surface a stack, a token or a raw upstream body.
    throw new GoogleMeetApiError(
      body.message || body.error || 'Google Meet link creation failed.',
      body.error || 'GOOGLE_MEET_LINK_FAILED',
      res.status
    );
  }

  return { name: body.name, meetingUri: body.meetingUri, cached: Boolean(body.cached) };
}

/** Read back the stored link, used to refresh a list without mutating it. */
export async function fetchGoogleMeetSpace(meetingId: string): Promise<GoogleMeetSpace> {
  const headers = await getAuthHeader();
  const res = await fetch(`/api/meet/google/space/${encodeURIComponent(meetingId)}`, {
    headers,
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    name?: string;
    meetingUri?: string;
  };

  if (!res.ok || !body.name || !isGoogleMeetUri(body.meetingUri)) {
    throw new GoogleMeetApiError(
      body.message || body.error || 'The Google Meet link could not be read.',
      body.error || 'GOOGLE_MEET_LINK_FAILED',
      res.status
    );
  }
  return { name: body.name, meetingUri: body.meetingUri, cached: true };
}

/**
 * Open a join link in a new tab.
 *
 * Called synchronously from a click handler so browser popup blockers allow
 * it. `noopener` prevents the new page from reaching back into Sam_Teck Hub.
 */
export function openGoogleMeet(uri: string): void {
  if (!isGoogleMeetUri(uri)) return;
  window.open(uri, '_blank', 'noopener,noreferrer');
}

/**
 * Open a blank tab synchronously, at the exact moment of the click.
 *
 * Browsers only allow a new window while the user's activation is fresh, so
 * callers that must await the network first (create a meeting row, then ask
 * Google for a space) open this first and point it at the join link
 * afterwards. Returns null when a popup blocker refuses, or outside a browser.
 */
export function openBlankTab(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('about:blank', '_blank');
}

/** Point a pre-opened tab at a validated join link. No-op for bad input. */
export function navigateTab(popup: Window | null | undefined, uri: string): void {
  if (!isGoogleMeetUri(uri)) return;
  if (popup && !popup.closed) {
    // Detach before navigating so the Meet tab cannot script this app.
    try {
      popup.opener = null;
    } catch {
      /* cross-origin hardening: ignore */
    }
    popup.location.replace(uri);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(uri, '_blank', 'noopener,noreferrer');
  }
}

/** Close a pre-opened tab, used when provisioning fails. */
export function discardTab(popup: Window | null | undefined): void {
  if (popup && !popup.closed) popup.close();
}

/**
 * Provision a space and open it.
 *
 * Pass the tab opened synchronously by the click (`openBlankTab`) so the
 * browser does not treat the navigation as an unsolicited popup; omit it and
 * one is opened here instead — correct when nothing has awaited yet.
 *
 * Returns the state to re-render with. On failure the tab is closed again, so
 * a member is never left staring at a blank page.
 */
export async function provisionAndOpenGoogleMeet(
  meetingId: string,
  popup?: Window | null
): Promise<{ uri: string | null; error?: GoogleMeetApiError }> {
  const target = popup !== undefined ? popup : openBlankTab();

  try {
    const space = await createGoogleMeetSpace(meetingId);
    if (!isGoogleMeetUri(space.meetingUri)) {
      // A link we cannot vouch for is never opened, even if it came from us.
      throw new GoogleMeetApiError('Google returned no usable meeting link.', 'BAD_RESPONSE', 502);
    }
    navigateTab(target, space.meetingUri);
    return { uri: space.meetingUri };
  } catch (err) {
    discardTab(target);
    const apiErr =
      err instanceof GoogleMeetApiError
        ? err
        : new GoogleMeetApiError(
            err instanceof Error ? err.message : 'Google Meet link creation failed.',
            'UNKNOWN',
            0
          );
    return { uri: null, error: apiErr };
  }
}
