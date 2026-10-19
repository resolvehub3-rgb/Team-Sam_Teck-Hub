-- Google Meet integration for Sam_Teck Hub.
--
-- Adds the Google meeting-space identifiers next to the internal meeting
-- record so Sam_Teck Hub can hand an authorised member the real join link
-- produced by the Google Meet REST API.
--
-- Design rules honoured here:
--   * Non-destructive: only ADD COLUMN, one index, and one metadata-only
--     column rename. Existing meeting rows and their values are preserved.
--   * No row-level security policy is created or altered, so the meetings
--     INSERT ... RETURNING behaviour verified by 20261018120000 and by
--     scripts/check-migrations.ts is untouched.
--   * Safe to run more than once: every statement is guarded.
--
-- The provider column is renamed away from the removed LiveKit integration.
-- RENAME COLUMN is metadata-only: no rows are written, no values change, and
-- the column's UNIQUE and NOT NULL constraints travel with it.

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'meetings'
           AND column_name  = 'livekit_room_name'
      )
  AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'meetings'
           AND column_name  = 'room_name'
      ) THEN
    ALTER TABLE public.meetings RENAME COLUMN livekit_room_name TO room_name;
  END IF;
END $$;

-- Google meeting-space resource name, e.g. `spaces/AbCdEfGhIjKlMnOp`.
-- This is Google's stable identifier for the space. A meeting code is
-- deliberately NOT stored as the key: Google dissociates codes from spaces
-- and can reuse them, so the resource name is the only durable handle.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_space_name TEXT;

-- The join link Google returns for the space, e.g. https://meet.google.com/abc-mnop-xyz.
-- Written only by the server from the Google API response - never invented
-- client-side and never parsed out of a typed meeting code.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_meeting_uri TEXT;

-- Lifecycle of the server-side provisioning call:
--   pending  - no attempt made yet
--   synced   - a space exists and google_meeting_uri is set
--   failed   - the last attempt failed; google_last_error explains why
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_sync_status TEXT NOT NULL DEFAULT 'pending';

-- Sanitised, user-presentable reason for the most recent failure. Must never
-- contain an access token, refresh token or client secret.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_last_error TEXT;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

-- Partial unique index: a space is linked to at most one internal meeting,
-- while the vast majority of rows (no space yet) stay unconstrained and NULL
-- values remain freely allowed.
CREATE UNIQUE INDEX IF NOT EXISTS meetings_google_space_name_key
  ON public.meetings (google_space_name)
  WHERE google_space_name IS NOT NULL;

COMMENT ON COLUMN public.meetings.google_space_name IS
  'Google Meet meeting-space resource name (spaces/{id}) returned by the Meet REST API.';
COMMENT ON COLUMN public.meetings.google_meeting_uri IS
  'Join link returned by Google for the space. Server-written only; open in a new tab.';
COMMENT ON COLUMN public.meetings.google_sync_status IS
  'pending | synced | failed — state of the server-side space provisioning call.';
