-- ====================================================================
-- Sam_Teck Hub: FIX meetings RLS — "new row violates row-level security
-- policy for table meetings" on every INSERT ... RETURNING
-- Version: 20261018120000
-- Run AFTER 20261016150000_member_workspace.sql (and all earlier ones).
-- ====================================================================
--
-- ROOT CAUSE (verified live against the production database)
-- ----------------------------------------------------------
-- public.meetings had RLS enabled and a correct INSERT policy
-- (WITH CHECK (is_org_member(organization_id) AND host_id = auth.uid())),
-- which is why isolated probes gave contradictory results:
--
--   * plain INSERT (Prefer: return=minimal)        -> 201 OK
--   * plain SELECT                                -> 200 OK
--   * INSERT ... RETURNING (what PostgREST sends
--     for `.insert().select()`, the normal way a
--     browser client creates a meeting and reads
--     the new row back)                           -> 403
--       "new row violates row-level security
--        policy for table meetings"
--
-- INSERT ... RETURNING makes Postgres re-check the SELECT policy against
-- the brand-new row inside the SAME statement. The SELECT policy was
--
--     USING (public.can_view_meeting(id))
--
-- and can_view_meeting()'s body re-queries public.meetings itself:
--
--     SELECT EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = m_id ...)
--
-- A query started inside a policy cannot see the row the outer INSERT
-- statement has not yet made visible to its command counter, so for the
-- row being inserted the EXISTS is always FALSE, the SELECT policy denies
-- it, and Postgres reports the failure with the misleading
-- "new row violates row-level security policy" message. Verified live for
-- every role (team_member, team_leader, super_admin) and for public and
-- private meetings alike: the insert itself always passed WITH CHECK,
-- which is why a separate follow-up SELECT then found the new row.
--
-- THE FIX
-- -------
-- The meetings SELECT policy now evaluates the new row's OWN columns
-- (organization_id, is_private, host_id) — always available during
-- RETURNING — and only joins out to meeting_invitations /
-- meeting_participants, which can never hold rows for a meeting that is
-- being inserted right now. No policy on public.meetings may query
-- public.meetings again; that self-reference is what broke RETURNING.
--
-- While rewriting, the role checks were made organisation-scoped, which
-- the product rules (src/utils/rules.ts) require:
--   * INSERT: an active membership row in THAT organisation holding a
--     scheduling role (everyone except `guest`, mirroring `manage_meeting`)
--     AND host_id = auth.uid(), so a submitted creator id can never be
--     spoofed and a member cannot schedule into another team.
--   * SELECT/UPDATE leadership override: checked against the caller's
--     membership row in the meeting's own organisation, so being a leader
--     in one team grants nothing in another.
--   * DELETE: unchanged — super administrators only.
--
-- Idempotent and fail-closed: no rows are deleted, RLS stays enabled, and
-- every statement can be re-run safely.
-- ====================================================================

-- 1. RLS must remain enabled (fail-closed even if it was ever disabled).
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- ====================================================================
-- 2. Authorisation helpers (per-organisation, membership-table based)
--
--    Both are SECURITY DEFINER with a pinned search_path so they read the
--    membership table regardless of the caller's context, and neither
--    queries public.meetings, so they can never recurse into the policies
--    that use them.
-- ====================================================================

-- Mirrors the frontend `manage_meeting` rule: every active member whose
-- role is not `guest` may schedule meetings in that organisation.
CREATE OR REPLACE FUNCTION public.can_schedule_meeting(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        WHERE om.organization_id = p_org_id
          AND om.user_id = auth.uid()
          AND om.is_active = TRUE
          AND om.role IN (
              'super_admin', 'team_leader', 'assistant_leader',
              'project_manager', 'department_lead', 'team_member'
          )
    );
$$;

-- Mirrors the frontend leadership tier for meeting management: the
-- caller's membership row in the meeting's OWN organisation must hold a
-- leadership/management role. A role in one team grants nothing in
-- another.
CREATE OR REPLACE FUNCTION public.can_manage_meetings_in(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        WHERE om.organization_id = p_org_id
          AND om.user_id = auth.uid()
          AND om.is_active = TRUE
          AND om.role IN (
              'super_admin', 'team_leader', 'assistant_leader',
              'project_manager', 'department_lead'
          )
    );
$$;

-- Only the authenticated role evaluates these through policies; the anon
-- role must not be able to probe them.
REVOKE ALL ON FUNCTION public.can_schedule_meeting(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_schedule_meeting(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_manage_meetings_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_meetings_in(UUID) TO authenticated, service_role;

-- ====================================================================
-- 3. Replace every policy on public.meetings with the canonical set
--
--    The live database has drifted from the migration files before (see
--    git history), so instead of trusting individual DROP POLICY names we
--    sweep every existing policy on this one table and recreate the
--    intended set below. This touches no other table and no data; if the
--    script stops midway the table is left with fewer policies (fail
--    closed — reads and writes are denied), never with open access.
-- ====================================================================
DO $$
DECLARE pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'meetings'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.meetings', pol.policyname);
    END LOOP;
END $$;

-- 3a. SELECT — org members see public meetings, meetings they host,
--     private meetings they manage in that org, and private meetings
--     they are invited to or participating in.
--
--     Evaluated on the row's own columns, never by re-querying
--     public.meetings (see root cause above). The EXISTS subqueries touch
--     only meeting_invitations / meeting_participants, which hold no rows
--     for a meeting mid-insert, and whose own policies cannot loop back
--     into a meetings re-check (can_view_meeting is SECURITY DEFINER).
CREATE POLICY "Meetings viewable by authorised users"
ON public.meetings FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        is_private = FALSE
        OR host_id = auth.uid()
        OR public.can_manage_meetings_in(organization_id)
        OR EXISTS (
            SELECT 1 FROM public.meeting_invitations mi
            WHERE mi.meeting_id = meetings.id AND mi.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.meeting_participants mp
            WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()
        )
    )
);

-- 3b. INSERT — the caller must be the meeting's host, and their own
--     active membership row in the submitted organisation must grant
--     scheduling there. Only auth.uid() and the membership table are
--     trusted; nothing in the payload is believed about who the creator
--     is, so impersonation and cross-team scheduling are both rejected.
CREATE POLICY "Meetings insertable by authorised users"
ON public.meetings FOR INSERT
TO authenticated
WITH CHECK (
    host_id = auth.uid()
    AND public.can_schedule_meeting(organization_id)
);

-- 3c. UPDATE — the host of a meeting in an organisation they belong to,
--     or a leader of that same organisation. WITH CHECK mirrors USING so
--     an update can neither move a meeting into an organisation the
--     caller cannot schedule in, nor change the host to someone else and
--     keep control of the row.
CREATE POLICY "Meetings updatable by host or leads (scoped)"
ON public.meetings FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (host_id = auth.uid() OR public.can_manage_meetings_in(organization_id))
)
WITH CHECK (
    public.is_org_member(organization_id)
    AND (host_id = auth.uid() OR public.can_manage_meetings_in(organization_id))
);

-- 3d. DELETE — unchanged intent: super administrators only.
CREATE POLICY "Meetings deletable by super admins"
ON public.meetings FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- ====================================================================
-- 4. INVARIANT FOR FUTURE POLICY WORK
--
--     No policy on public.meetings may query public.meetings again,
--     directly or through a SECURITY DEFINER function. INSERT ...
--     RETURNING checks the SELECT policy against the row being inserted
--     within the same statement, and such a self-reference can never see
--     that row — every `.insert().select()` call in the app would break
--     again with "new row violates row-level security policy for table
--     meetings". Evaluate the row's own columns instead.
--     scripts/check-migrations.ts enforces this on new migrations.
-- ====================================================================
