/**
 * Unit tests for the pure Google Meet state model.
 *
 * These cover the decisions that decide what "Join Meeting" shows and what is
 * allowed to reach `window.open`. The link validator in particular is a
 * security boundary: it is the last check before a URL is handed to the
 * browser, so every scheme- and host-confusion case is pinned here.
 *
 * Run with: pnpm test:meet
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GoogleMeetApiError,
  googleMeetJoinState,
  isConfigurationProblem,
  isGoogleMeetUri,
} from './googleMeetCore';

const VALID_URI = 'https://meet.google.com/abc-mnop-xyz';

test('isGoogleMeetUri accepts a normal meeting link', () => {
  assert.equal(isGoogleMeetUri(VALID_URI), true);
});

test('isGoogleMeetUri rejects a link to a subdomain that only looks like Meet', () => {
  assert.equal(isGoogleMeetUri('https://meet.google.com.evil.example/abc-mnop-xyz'), false);
});

test('isGoogleMeetUri rejects lookalike hostnames', () => {
  assert.equal(isGoogleMeetUri('https://meet.google.com.example.com/abc'), false);
  assert.equal(isGoogleMeetUri('https://meetxgoogle.com/abc'), false);
  assert.equal(isGoogleMeetUri('https://meet-google.com/abc'), false);
});

test('isGoogleMeetUri rejects insecure http', () => {
  assert.equal(isGoogleMeetUri('http://meet.google.com/abc-mnop-xyz'), false);
});

test('isGoogleMeetUri rejects a non-https scheme entirely', () => {
  assert.equal(isGoogleMeetUri('javascript:alert(1)'), false);
  assert.equal(isGoogleMeetUri('data:text/html,<script>'), false);
  assert.equal(isGoogleMeetUri('file:///etc/passwd'), false);
});

test('isGoogleMeetUri rejects empty and non-string values', () => {
  assert.equal(isGoogleMeetUri(''), false);
  assert.equal(isGoogleMeetUri(null), false);
  assert.equal(isGoogleMeetUri(undefined), false);
  assert.equal(isGoogleMeetUri(123), false);
  assert.equal(isGoogleMeetUri({ meetingUri: VALID_URI }), false);
  assert.equal(isGoogleMeetUri(['https://meet.google.com/abc']), false);
});

test('isGoogleMeetUri rejects unparseable input', () => {
  assert.equal(isGoogleMeetUri('not a url at all'), false);
  assert.equal(isGoogleMeetUri('https://'), false);
});

test('join state is "ended" for a completed meeting even with a link stored', () => {
  const state = googleMeetJoinState(
    { id: 'm1', status: 'completed', google_meeting_uri: VALID_URI },
    true
  );
  assert.deepEqual(state, { kind: 'ended' });
});

test('join state is "ended" for a cancelled meeting', () => {
  assert.deepEqual(googleMeetJoinState({ id: 'm1', status: 'cancelled' }, true), { kind: 'ended' });
});

test('join state is "link_ready" and carries the exact stored URI', () => {
  const state = googleMeetJoinState(
    { id: 'm1', status: 'live', google_meeting_uri: VALID_URI },
    false
  );
  assert.deepEqual(state, { kind: 'link_ready', uri: VALID_URI });
});

test('a live meeting with no link yet needs provisioning, for managers', () => {
  assert.deepEqual(
    googleMeetJoinState({ id: 'm1', status: 'live' }, true),
    { kind: 'needs_provisioning', canManage: true }
  );
});

test('a live meeting with no link needs provisioning, non-managers cannot create one', () => {
  assert.deepEqual(
    googleMeetJoinState({ id: 'm1', status: 'scheduled' }, false),
    { kind: 'needs_provisioning', canManage: false }
  );
});

test('a corrupted link is never reported as ready', () => {
  const state = googleMeetJoinState(
    {
      id: 'm1',
      status: 'live',
      google_meeting_uri: 'javascript:alert(document.cookie)',
      google_sync_status: 'synced',
    },
    false
  );
  // Not link_ready — the validator refused it, so we fall through to
  // provisioning rather than handing that string to window.open.
  assert.deepEqual(state, { kind: 'needs_provisioning', canManage: false });
});

test('a failed sync reports the stored reason and who may retry', () => {
  const state = googleMeetJoinState(
    {
      id: 'm1',
      status: 'live',
      google_sync_status: 'failed',
      google_last_error: 'Google is rate-limiting meeting-space creation right now.',
    },
    true
  );
  assert.deepEqual(state, {
    kind: 'failed',
    message: 'Google is rate-limiting meeting-space creation right now.',
    canManage: true,
  });
});

test('a failed sync with a blank reason still explains itself', () => {
  const state = googleMeetJoinState(
    { id: 'm1', status: 'live', google_sync_status: 'failed', google_last_error: '   ' },
    false
  );
  assert.deepEqual(state, {
    kind: 'failed',
    message: 'The Google Meet link could not be created.',
    canManage: false,
  });
});

test('an ended meeting wins over a stored failure', () => {
  const state = googleMeetJoinState(
    { id: 'm1', status: 'completed', google_sync_status: 'failed' },
    true
  );
  assert.deepEqual(state, { kind: 'ended' });
});

test('a valid link wins over a stale failure flag', () => {
  const state = googleMeetJoinState(
    {
      id: 'm1',
      status: 'live',
      google_meeting_uri: VALID_URI,
      google_sync_status: 'failed',
      google_last_error: 'stale',
    },
    false
  );
  assert.deepEqual(state, { kind: 'link_ready', uri: VALID_URI });
});

test('isConfigurationProblem recognises the missing-credentials code', () => {
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'GOOGLE_MEET_NOT_CONFIGURED', 503)), true);
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'GOOGLE_MEET_AUTH_FAILED', 503)), true);
});

test('isConfigurationProblem recognises 503 and 401 by status', () => {
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'OTHER', 503)), true);
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'OTHER', 401)), true);
});

test('isConfigurationProblem ignores ordinary failures and absent errors', () => {
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'GOOGLE_MEET_LINK_FAILED', 502)), false);
  assert.equal(isConfigurationProblem(new GoogleMeetApiError('x', 'RATE_LIMIT', 429)), false);
  assert.equal(isConfigurationProblem(undefined), false);
  assert.equal(isConfigurationProblem(null), false);
});

test('GoogleMeetApiError keeps its message, code and status', () => {
  const err = new GoogleMeetApiError('boom', 'GOOGLE_MEET_LINK_FAILED', 502);
  assert.equal(err.message, 'boom');
  assert.equal(err.code, 'GOOGLE_MEET_LINK_FAILED');
  assert.equal(err.status, 502);
  assert.equal(err.name, 'GoogleMeetApiError');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof GoogleMeetApiError);
});
