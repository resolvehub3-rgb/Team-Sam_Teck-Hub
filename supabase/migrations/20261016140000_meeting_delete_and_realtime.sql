-- ====================================================================
-- FIX: Meeting deletion restricted to super_admin + realtime enabled
-- Version: 20261016140000
--
-- 1. The earlier RLS migration granted DELETE on public.meetings to every
--    active org member. That is too broad — only super_admin may remove a
--    scheduled session. Replace that policy with a role-scoped one.
--
-- 2. public.meetings is not in the supabase_realtime publication, so no
--    postgres_changes events are emitted and every client would only see
--    its own optimistic update. Add the table so deletes propagate to all
--    connected clients instantly.
-- ====================================================================

-- Helper: is the caller an active super_admin in any organization?
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE user_id = auth.uid()
        AND role = 'super_admin'
        AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 1. Replace the overly-broad delete policy with a super_admin-only one.
DROP POLICY IF EXISTS "Meetings deletable by org members" ON public.meetings;
DROP POLICY IF EXISTS "Meetings deletable by super admins" ON public.meetings;

CREATE POLICY "Meetings deletable by super admins"
ON public.meetings FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- 2. Enable realtime for meetings so deletes/inserts reach every client.
--    Guarded: the table may already be in the publication.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'meetings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
    END IF;
EXCEPTION
    -- Publication may not exist on non-Supabase Postgres; realtime simply
    -- stays disabled rather than the whole migration failing.
    WHEN undefined_object THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- Realtime DELETE events only carry the primary key unless replica identity
-- is FULL, which is what lets clients remove the right row.
ALTER TABLE public.meetings REPLICA IDENTITY FULL;
