-- ====================================================================
-- FIX: Member invitations — real invite emails & acceptance flow
-- Version: 20261016130000
--
-- The previous flow inserted an invitations row and reported success,
-- but never sent an email and had no page to accept the token.
--
-- 1. invitations.user_id  -> links the invite to the Supabase auth user
--                             created by auth.admin.inviteUserWithOtp,
--                             so acceptance does not need an email lookup.
-- 2. RLS policies         -> invitations had RLS enabled with NO policy,
--                             so org members could not list pending invites.
-- 3. DELETE policy        -> lets admins revoke an outstanding invitation.
-- ====================================================================

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_user ON public.invitations(user_id);

-- Allow re-inviting the same address: drop a superseded outstanding invite
-- for the same email before inserting a fresh one.
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_token_key;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_token_key UNIQUE (token);

-- RLS policies for invitations (none existed before).
DROP POLICY IF EXISTS "Invitations viewable by org members" ON public.invitations;
CREATE POLICY "Invitations viewable by org members"
ON public.invitations FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id) OR invited_by = auth.uid());

DROP POLICY IF EXISTS "Invitations insertable by org members" ON public.invitations;
CREATE POLICY "Invitations insertable by org members"
ON public.invitations FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND invited_by = auth.uid());

DROP POLICY IF EXISTS "Invitations updatable by inviter or org admins" ON public.invitations;
CREATE POLICY "Invitations updatable by inviter or org admins"
ON public.invitations FOR UPDATE
TO authenticated
USING (invited_by = auth.uid() OR public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Invitations deletable by inviter or org admins" ON public.invitations;
CREATE POLICY "Invitations deletable by inviter or org admins"
ON public.invitations FOR DELETE
TO authenticated
USING (invited_by = auth.uid() OR public.is_org_member(organization_id));
