-- ====================================================================
-- 20261016160000 — DOCUMENT STORAGE POLICES (corrected, additive)
-- ====================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Section 16 of 20261016150000_member_workspace.sql tried to create the
-- storage policies in a single `DO` block. In PL/pgSQL an exception rolls
-- back *every* statement in that block, and because the block ended with
-- `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` the failure was invisible. The
-- bucket itself was created by a separate block, so the net result was a
-- private `documents` bucket with no policies at all — every browser upload
-- was rejected with "new row violates row-level security policy".
--
-- This migration re-creates the policies, one statement per block so a single
-- failure cannot roll back the rest, and finishes with a verification step
-- that names whatever is still missing.
--
-- LAYOUT
-- ------
--     documents/{organization_id}/{user_id}/{timestamp}_{file_name}
--
-- so `storage.foldername(name)` = ['documents', orgId, userId]. The
-- application now moves file bytes through the authenticated `/api/documents/*`
-- endpoints, which write to exactly this layout; these policies are the
-- database-side defence in depth for anything that talks to storage directly.
-- ====================================================================

-- ------------------------------------------------------------------
-- 1. Bucket (idempotent)
-- ------------------------------------------------------------------
DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('documents', 'documents', FALSE, 52428800)
    ON CONFLICT (id) DO NOTHING;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] bucket not created: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------
-- 2. Members of the owning organisation may read their org's files
-- ------------------------------------------------------------------
DO $$
BEGIN
    DROP POLICY IF EXISTS "Org members can read documents" ON storage.objects;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] could not drop old SELECT policy: %', SQLERRM;
END $$;

DO $$
BEGIN
    CREATE POLICY "Org members can read documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.organizations o
            WHERE o.id::text = ANY (storage.foldername(name))
              AND public.is_org_member(o.id)
        )
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] SELECT policy not created: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------
-- 3. Members may upload only into their own folder inside their org
-- ------------------------------------------------------------------
DO $$
BEGIN
    DROP POLICY IF EXISTS "Org members can upload documents" ON storage.objects;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] could not drop old INSERT policy: %', SQLERRM;
END $$;

DO $$
BEGIN
    CREATE POLICY "Org members can upload documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.organizations o
            WHERE o.id::text = ANY (storage.foldername(name))
              AND public.is_org_member(o.id)
        )
        AND (storage.foldername(name))[3] = auth.uid()::text
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] INSERT policy not created: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------
-- 4. Updaters: the owner of the file, or leadership
-- ------------------------------------------------------------------
DO $$
BEGIN
    DROP POLICY IF EXISTS "Uploaders can manage their documents" ON storage.objects;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] could not drop old UPDATE policy: %', SQLERRM;
END $$;

DO $$
BEGIN
    CREATE POLICY "Uploaders can manage their documents"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND ((storage.foldername(name))[3] = auth.uid()::text OR public.is_leadership())
    )
    WITH CHECK (bucket_id = 'documents');
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] UPDATE policy not created: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------
-- 5. Deleters: the owner of the file, or leadership
-- ------------------------------------------------------------------
DO $$
BEGIN
    DROP POLICY IF EXISTS "Uploaders can delete their documents" ON storage.objects;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] could not drop old DELETE policy: %', SQLERRM;
END $$;

DO $$
BEGIN
    CREATE POLICY "Uploaders can delete their documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND ((storage.foldername(name))[3] = auth.uid()::text OR public.is_leadership())
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '[documents] DELETE policy not created: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------
-- 6. Verification — name whatever is still missing instead of failing
--    silently the way the previous attempt did.
-- ------------------------------------------------------------------
DO $$
DECLARE
    missing TEXT := '';
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Org members can upload documents'
    ) THEN
        missing := missing || ' INSERT';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Org members can read documents'
    ) THEN
        missing := missing || ' SELECT';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Uploaders can delete their documents'
    ) THEN
        missing := missing || ' DELETE';
    END IF;

    IF missing = '' THEN
        RAISE NOTICE '[documents] all storage policies are in place.';
    ELSE
        RAISE WARNING '[documents] these storage policies are MISSING:%. The SQL role running this migration cannot manage storage.objects — create them in the Supabase dashboard under Storage -> policies, or leave it to the /api/documents/* endpoints.', missing;
    END IF;
END $$;
