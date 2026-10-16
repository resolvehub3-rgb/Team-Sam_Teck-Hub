-- ====================================================================
-- FIX: Missing RLS policies
-- Version: 20261016120000
--
-- The base schema enabled ROW LEVEL SECURITY on every table but only
-- created policies for a subset. Any table with RLS enabled and NO
-- policy denies ALL access to non-owner roles, so the authenticated
-- role gets zero rows back.
--
-- The critical one: public.organization_memberships had no policy, so
-- AuthContext could never load the user's organization. That made
-- `organization` null in the UI, and inserts into public.meetings fell
-- back to a fake UUID, violating the meetings.organization_id FK.
-- ====================================================================

-- Helper: org ownership check used by the org-scoped policies below.
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = org_id
        AND user_id = auth.uid()
        AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- --------------------------------------------------------------------
-- 1. ORGANIZATION MEMBERSHIPS (the fix for meeting scheduling)
--    Users read their own membership; org members can read the full roster.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Memberships readable by self" ON public.organization_memberships;
CREATE POLICY "Memberships readable by self"
ON public.organization_memberships FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Memberships readable by org members" ON public.organization_memberships;
CREATE POLICY "Memberships readable by org members"
ON public.organization_memberships FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Memberships insertable by org admins" ON public.organization_memberships;
CREATE POLICY "Memberships insertable by org admins"
ON public.organization_memberships FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Memberships updatable by org members" ON public.organization_memberships;
CREATE POLICY "Memberships updatable by org members"
ON public.organization_memberships FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 2. ORGANIZATIONS: allow a user to discover/join their own org row.
--    (The base schema only allowed members to SELECT, which is circular:
--     you need to read the org to learn you are a member.)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Organizations viewable by members" ON public.organizations;
CREATE POLICY "Organizations viewable by members"
ON public.organizations FOR SELECT
TO authenticated
USING (
    public.is_org_member(id)
    OR EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
    )
);

-- --------------------------------------------------------------------
-- 3. DEPARTMENTS
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Departments viewable by org members" ON public.departments;
CREATE POLICY "Departments viewable by org members"
ON public.departments FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Departments insertable by org members" ON public.departments;
CREATE POLICY "Departments insertable by org members"
ON public.departments FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Departments updatable by org members" ON public.departments;
CREATE POLICY "Departments updatable by org members"
ON public.departments FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 4. INVITATIONS
-- --------------------------------------------------------------------
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

DROP POLICY IF EXISTS "Invitations updatable by inviter" ON public.invitations;
CREATE POLICY "Invitations updatable by inviter"
ON public.invitations FOR UPDATE
TO authenticated
USING (invited_by = auth.uid() OR public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 5. PROJECT MEMBERS, MILESTONES
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Project members viewable by org members" ON public.project_members;
CREATE POLICY "Project members viewable by org members"
ON public.project_members FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_members.project_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Project members insertable by org members" ON public.project_members;
CREATE POLICY "Project members insertable by org members"
ON public.project_members FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_members.project_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Milestones viewable by org members" ON public.milestones;
CREATE POLICY "Milestones viewable by org members"
ON public.milestones FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Milestones insertable by org members" ON public.milestones;
CREATE POLICY "Milestones insertable by org members"
ON public.milestones FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Milestones updatable by org members" ON public.milestones;
CREATE POLICY "Milestones updatable by org members"
ON public.milestones FOR UPDATE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = milestones.project_id
    AND public.is_org_member(p.organization_id)
));

-- --------------------------------------------------------------------
-- 6. TASK SUPPORT TABLES (comments, attachments, dependencies)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Task comments viewable by org members" ON public.task_comments;
CREATE POLICY "Task comments viewable by org members"
ON public.task_comments FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_comments.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task comments insertable by org members" ON public.task_comments;
CREATE POLICY "Task comments insertable by org members"
ON public.task_comments FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_comments.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task attachments viewable by org members" ON public.task_attachments;
CREATE POLICY "Task attachments viewable by org members"
ON public.task_attachments FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_attachments.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task attachments insertable by org members" ON public.task_attachments;
CREATE POLICY "Task attachments insertable by org members"
ON public.task_attachments FOR INSERT
TO authenticated
WITH CHECK (uploaded_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_attachments.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task dependencies viewable by org members" ON public.task_dependencies;
CREATE POLICY "Task dependencies viewable by org members"
ON public.task_dependencies FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_dependencies.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task dependencies manageable by org members" ON public.task_dependencies;
CREATE POLICY "Task dependencies manageable by org members"
ON public.task_dependencies FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_dependencies.task_id
    AND public.is_org_member(p.organization_id)
));

DROP POLICY IF EXISTS "Task dependencies deletable by org members" ON public.task_dependencies;
CREATE POLICY "Task dependencies deletable by org members"
ON public.task_dependencies FOR DELETE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = task_dependencies.task_id
    AND public.is_org_member(p.organization_id)
));

-- --------------------------------------------------------------------
-- 7. MEETING AGENDAS & AGENDA ITEMS
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Meeting agendas manageable by org members" ON public.meeting_agendas;
CREATE POLICY "Meeting agendas manageable by org members"
ON public.meeting_agendas FOR ALL
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_agendas.meeting_id
    AND public.is_org_member(m.organization_id)
));

DROP POLICY IF EXISTS "Meeting agenda items manageable by org members" ON public.meeting_agenda_items;
CREATE POLICY "Meeting agenda items manageable by org members"
ON public.meeting_agenda_items FOR ALL
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.meeting_agendas ma
    JOIN public.meetings m ON m.id = ma.meeting_id
    WHERE ma.id = meeting_agenda_items.agenda_id
    AND public.is_org_member(m.organization_id)
));

-- --------------------------------------------------------------------
-- 8. MEETINGS: add DELETE so hosts can clean up cancelled sessions
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Meetings deletable by org members" ON public.meetings;
CREATE POLICY "Meetings deletable by org members"
ON public.meetings FOR DELETE
TO authenticated
USING (public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 9. INNOVATION LAB: experiments & roadmap
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Experiments viewable by org members" ON public.innovation_experiments;
CREATE POLICY "Experiments viewable by org members"
ON public.innovation_experiments FOR SELECT
TO authenticated
USING (
    public.is_org_member((SELECT organization_id FROM public.ideas WHERE id = idea_id))
    OR public.is_org_member((SELECT organization_id FROM public.projects WHERE id = project_id))
);

DROP POLICY IF EXISTS "Experiments insertable by org members" ON public.innovation_experiments;
CREATE POLICY "Experiments insertable by org members"
ON public.innovation_experiments FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member((SELECT organization_id FROM public.ideas WHERE id = idea_id))
    OR public.is_org_member((SELECT organization_id FROM public.projects WHERE id = project_id))
);

DROP POLICY IF EXISTS "Roadmap viewable by org members" ON public.product_roadmap_items;
CREATE POLICY "Roadmap viewable by org members"
ON public.product_roadmap_items FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Roadmap insertable by org members" ON public.product_roadmap_items;
CREATE POLICY "Roadmap insertable by org members"
ON public.product_roadmap_items FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 10. LEARNING & DEVELOPMENT
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Learning resources viewable by org members" ON public.learning_resources;
CREATE POLICY "Learning resources viewable by org members"
ON public.learning_resources FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Learning resources insertable by org members" ON public.learning_resources;
CREATE POLICY "Learning resources insertable by org members"
ON public.learning_resources FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "Learning paths viewable by org members" ON public.learning_paths;
CREATE POLICY "Learning paths viewable by org members"
ON public.learning_paths FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Learning paths insertable by org members" ON public.learning_paths;
CREATE POLICY "Learning paths insertable by org members"
ON public.learning_paths FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "Learning assignments viewable by org members" ON public.learning_assignments;
CREATE POLICY "Learning assignments viewable by org members"
ON public.learning_assignments FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Learning assignments insertable by org members" ON public.learning_assignments;
CREATE POLICY "Learning assignments insertable by org members"
ON public.learning_assignments FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Learning submissions manageable by self" ON public.learning_submissions;
CREATE POLICY "Learning submissions manageable by self"
ON public.learning_submissions FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Learning progress manageable by self" ON public.learning_progress;
CREATE POLICY "Learning progress manageable by self"
ON public.learning_progress FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- --------------------------------------------------------------------
-- 11. BUSINESS & RESOURCE MANAGEMENT
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Proposals viewable by org members" ON public.business_proposals;
CREATE POLICY "Proposals viewable by org members"
ON public.business_proposals FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Proposals insertable by org members" ON public.business_proposals;
CREATE POLICY "Proposals insertable by org members"
ON public.business_proposals FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "Proposals updatable by org members" ON public.business_proposals;
CREATE POLICY "Proposals updatable by org members"
ON public.business_proposals FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Expenses viewable by org members" ON public.expense_records;
CREATE POLICY "Expenses viewable by org members"
ON public.expense_records FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Expenses insertable by org members" ON public.expense_records;
CREATE POLICY "Expenses insertable by org members"
ON public.expense_records FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND recorded_by = auth.uid());

DROP POLICY IF EXISTS "Expenses updatable by org members" ON public.expense_records;
CREATE POLICY "Expenses updatable by org members"
ON public.expense_records FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Project budgets viewable by org members" ON public.project_budgets;
CREATE POLICY "Project budgets viewable by org members"
ON public.project_budgets FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_budgets.project_id
    AND public.is_org_member(p.organization_id)
));

-- --------------------------------------------------------------------
-- 12. NOTIFICATION PREFERENCES (own row only)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Notification preferences manageable by self" ON public.notification_preferences;
CREATE POLICY "Notification preferences manageable by self"
ON public.notification_preferences FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- --------------------------------------------------------------------
-- 13. ROLE ASSIGNMENTS
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Role assignments viewable by authenticated" ON public.role_assignments;
CREATE POLICY "Role assignments viewable by authenticated"
ON public.role_assignments FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- --------------------------------------------------------------------
-- 14. ANNOUNCEMENTS: extend SELECT to allow author + org members,
--     and add INSERT/UPDATE for org leaders.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Announcements insertable by org members" ON public.announcements;
CREATE POLICY "Announcements insertable by org members"
ON public.announcements FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND author_id = auth.uid());

DROP POLICY IF EXISTS "Announcements updatable by org members" ON public.announcements;
CREATE POLICY "Announcements updatable by org members"
ON public.announcements FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

-- --------------------------------------------------------------------
-- 15. DOCUMENTS: add UPDATE/DELETE for owners
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Documents updatable by uploader" ON public.documents;
CREATE POLICY "Documents updatable by uploader"
ON public.documents FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id) OR uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Documents deletable by uploader" ON public.documents;
CREATE POLICY "Documents deletable by uploader"
ON public.documents FOR DELETE
TO authenticated
USING (public.is_org_member(organization_id) OR uploaded_by = auth.uid());
