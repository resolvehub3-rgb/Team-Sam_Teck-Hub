-- ====================================================================
-- 20261016170000_member_removal_realtime.sql
--
-- Supports removing a member from Team & Member Management:
--
--   1. Publish `organization_memberships` to realtime so every open admin
--      screen drops a removed member immediately, with no refresh.
--   2. `reassign_member_records`, a single atomic function that hands a
--      departing member's work to a reserved "former member" identity.
--
-- Why a function rather than a series of client updates:
--
--   Eight columns reference profiles(id) ON DELETE RESTRICT — projects.owner_id,
--   tasks.created_by, meeting_minutes.recorded_by, and the five learning and
--   business tables. Deleting the account while those still point at the member
--   is refused by the database. Several more are ON DELETE CASCADE —
--   meetings.host_id, ideas.author_id, announcements.author_id — so deleting
--   the account without reassigning first would silently take meetings, ideas,
--   announcements and documents away from everyone else who can see them.
--
--   Reassigning column by column from the server leaves a partial state if any
--   one statement fails: some tables handed over, some not, and no way to tell
--   which. Wrapping the whole handover in one function makes it all-or-nothing.
--
-- SECURITY DEFINER is required here because the function writes across many
-- tables, so row-level security is set aside. That makes the checks at the top
-- load-bearing: the caller's identity comes from auth.uid(), read from the
-- verified JWT and never from the request body, and every guard below is
-- re-evaluated inside the function. The server repeats the same rules so users
-- get a clear message, but they hold even if the server did not.
--
-- The function deliberately stops at reassignment. The irreversible step —
-- deleting the auth user — stays with GoTrue, called by the server afterwards.
-- ====================================================================

-- 1. Publish membership changes to subscribed clients.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'organization_memberships'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_memberships;
        RAISE NOTICE 'Added public.organization_memberships to supabase_realtime.';
    ELSE
        RAISE NOTICE 'public.organization_memberships is already in supabase_realtime.';
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        RAISE WARNING 'Publication supabase_realtime does not exist; roster changes will only appear after a refresh.';
    WHEN insufficient_privilege THEN
        RAISE WARNING 'Insufficient privilege to publish public.organization_memberships; roster changes will only appear after a refresh.';
END;
$$;

-- 2. Realtime filters events through row-level security, so the roster has to
--    be readable by org members or a removal simply never reaches them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_memberships'
          AND policyname = 'Memberships readable by org members'
    ) THEN
        CREATE POLICY "Memberships readable by org members"
        ON public.organization_memberships FOR SELECT
        TO authenticated
        USING (public.is_org_member(organization_id));
        RAISE NOTICE 'Created "Memberships readable by org members".';
    ELSE
        RAISE NOTICE '"Memberships readable by org members" already exists.';
    END IF;
END;
$$;

-- 3. Hand a departing member's authorship to the former-member profile.
--
--    `p_former` is deliberately passed in rather than looked up, so this
--    function never creates accounts. The server creates the former-member
--    identity first, and refuses the removal outright if it cannot.
CREATE OR REPLACE FUNCTION public.reassign_member_records(
    p_member UUID,
    p_former UUID,
    p_org UUID,
    p_confirm_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_caller_role user_role;
    v_target_role user_role;
    v_target_email TEXT;
    v_moved JSONB := '{}'::JSONB;
    v_total INTEGER := 0;
    v_count INTEGER;
    rec RECORD;
BEGIN
    -- --- 1. Who is asking -------------------------------------------------
    -- auth.uid() is NULL only when there is no signed-in user, which the
    -- server has already rejected; keeping the check here means the function
    -- is never usable without an identity.
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.role INTO v_caller_role
    FROM public.organization_memberships om
    WHERE om.user_id = v_caller
      AND om.organization_id = p_org
      AND om.is_active = TRUE;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'You are not an active member of this organisation.';
    END IF;

    IF v_caller_role NOT IN ('super_admin', 'team_leader', 'assistant_leader') THEN
        RAISE EXCEPTION 'Only leadership can remove members.';
    END IF;

    -- Guarded here as well as in the UI so a leader cannot lock themselves out.
    IF v_caller = p_member THEN
        RAISE EXCEPTION 'You cannot remove your own account.';
    END IF;

    -- --- 2. The target, inside the caller's own organisation --------------
    -- Scoped by organisation so an administrator of one workspace cannot
    -- reach into another by guessing a user id.
    SELECT om.role INTO v_target_role
    FROM public.organization_memberships om
    WHERE om.user_id = p_member
      AND om.organization_id = p_org
      AND om.is_active = TRUE;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'That member is not in your organisation.';
    END IF;

    -- user_role is declared most-senior-first, so comparing the enum values IS
    -- comparing seniority: a leader may remove only those strictly below them.
    -- This also makes the last super_admin impossible to remove, so a
    -- workspace can never be left without an administrator.
    IF v_target_role <= v_caller_role THEN
        RAISE EXCEPTION 'You cannot remove a member whose role is equal to or above your own.';
    END IF;

    -- --- 3. Explicit confirmation -----------------------------------------
    -- Re-read from the database instead of trusting the value that reached the
    -- server, so the check cannot drift from the account actually being
    -- removed.
    SELECT p.email INTO v_target_email
    FROM public.profiles p
    WHERE p.id = p_member;

    IF v_target_email IS NULL
       OR lower(v_target_email) <> lower(coalesce(p_confirm_email, '')) THEN
        RAISE EXCEPTION 'That does not match the member''s email address. Nothing was removed.';
    END IF;

    -- --- 4. Hand over the work, all or nothing ----------------------------
    -- The first group is ON DELETE RESTRICT: without this the delete is
    -- refused. The second is ON DELETE CASCADE: without this the database
    -- would destroy shared records that were never this member's to remove.
    -- Personal rows — notifications, votes, participation, project membership
    -- — are absent on purpose and leave with the account.
    FOR rec IN
        SELECT * FROM (VALUES
            ('projects',           'owner_id',    TRUE),
            ('tasks',              'created_by',  FALSE),
            ('meeting_minutes',    'recorded_by', FALSE),
            ('learning_resources', 'created_by',  TRUE),
            ('learning_paths',     'created_by',  TRUE),
            ('learning_assignments','created_by', FALSE),
            ('business_proposals', 'created_by',  TRUE),
            ('expense_records',    'recorded_by', TRUE),
            ('meetings',           'host_id',     TRUE),
            ('ideas',              'author_id',   TRUE),
            ('announcements',      'author_id',   TRUE),
            ('documents',          'uploaded_by', TRUE),
            ('invitations',        'invited_by',  TRUE),
            ('task_comments',      'user_id',     FALSE),
            ('task_attachments',   'uploaded_by', FALSE),
            ('idea_reviews',       'reviewer_id', FALSE),
            ('learning_submissions','user_id',    FALSE)
        ) AS t(tbl, col, org_scoped)
    LOOP
        IF rec.org_scoped THEN
            EXECUTE format(
                'UPDATE public.%I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
                rec.tbl, rec.col, rec.col
            ) USING p_former, p_member, p_org;
        ELSE
            EXECUTE format(
                'UPDATE public.%I SET %I = $1 WHERE %I = $2',
                rec.tbl, rec.col, rec.col
            ) USING p_former, p_member;
        END IF;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count > 0 THEN
            v_moved := v_moved || jsonb_build_object(rec.tbl, v_count);
            v_total := v_total + v_count;
        END IF;
    END LOOP;

    -- Rows are counted here rather than in the server so the reported totals
    -- describe the same transaction that moved them.
    RETURN jsonb_build_object(
        'success', TRUE,
        'moved', v_moved,
        'total', v_total,
        'removed_member', p_member,
        'former_member', p_former
    );
END;
$$;

-- Only the authenticated role may call this, and only for its own organisation
-- (the organisation is checked inside against the caller's membership).
REVOKE ALL ON FUNCTION public.reassign_member_records(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_member_records(UUID, UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_member_records(UUID, UUID, UUID, TEXT) TO authenticated;

-- ====================================================================
-- Verification. Run after applying. The first two should be TRUE/1; the
-- third should return 0 for a real member, which is the intended outcome
-- before any handover runs.
-- ====================================================================
-- SELECT EXISTS (
--     SELECT 1 FROM pg_publication_tables
--     WHERE pubname = 'supabase_realtime'
--       AND schemaname = 'public'
--       AND tablename = 'organization_memberships'
-- ) AS membership_is_published;
--
-- SELECT COUNT(*) AS org_members_read_policy_count
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'organization_memberships'
--   AND policyname = 'Memberships readable by org members';
--
-- SELECT COUNT(*) AS reassign_function_exists
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'reassign_member_records';
