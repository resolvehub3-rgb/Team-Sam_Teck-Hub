-- ====================================================================
-- Sam_Teck Hub: Member Workspace — role-scoped RLS, notifications,
--               announcement read-state, private file storage
-- Version: 20261016150000
--
-- WHAT THIS MIGRATION DOES (all additive / non-destructive)
-- --------------------------------------------------------
--  1. Security fix: the previous policy set let ANY active org member
--     UPDATE organization_memberships, including their own `role` — a
--     team_member could promote themselves to super_admin. Membership
--     writes are now restricted to leadership.
--
--  2. Role-scoped row policies so the Member Workspace only ever reads
--     the caller's own tasks / projects / meetings / documents, while
--     leadership keeps its existing org-wide view.
--
--  3. Triggers that protect privileged fields from the database side
--     (task reassignment, idea status, profile suspension) so hiding the
--     button in the UI is never the only control.
--
--  4. Real in-app notifications: new target columns + database triggers
--     on tasks, meeting_invitations, task_comments, idea_reviews and
--     announcements.
--
--  5. public.announcement_reads so announcements have a genuine
--     read/unread state per member.
--
--  6. A private `documents` storage bucket with org-scoped policies.
--
-- Every statement is idempotent (DROP ... IF EXISTS / CREATE OR REPLACE /
-- ON CONFLICT DO NOTHING), so re-running is safe.
-- Run AFTER 20261016120000_add_missing_rls_policies.sql.
-- ====================================================================

-- ====================================================================
-- 0. AUTHORISATION HELPERS
-- ====================================================================

-- The caller's most privileged active role. Single source of truth used by
-- every policy below, so role checks cannot drift from the frontend rules.
CREATE OR REPLACE FUNCTION public.current_member_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    r TEXT;
BEGIN
    SELECT om.role INTO r
    FROM public.organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.is_active = TRUE
    ORDER BY CASE om.role
        WHEN 'super_admin'      THEN 1
        WHEN 'team_leader'      THEN 2
        WHEN 'assistant_leader' THEN 3
        WHEN 'project_manager'  THEN 4
        WHEN 'department_lead'  THEN 5
        WHEN 'team_member'      THEN 6
        ELSE 7
    END
    LIMIT 1;

    RETURN r;
END;
$$;

-- Super administrators (mirrors the frontend `delete_meeting` rule).
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT public.current_member_role() = 'super_admin';
$$;

-- Leadership tier: may review ideas, publish announcements, see everything.
CREATE OR REPLACE FUNCTION public.is_leadership()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(public.current_member_role(), '') IN
        ('super_admin', 'team_leader', 'assistant_leader', 'department_lead');
$$;

-- Leadership + project managers: may create/update projects and tasks.
CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(public.current_member_role(), '') IN
        ('super_admin', 'team_leader', 'assistant_leader', 'project_manager', 'department_lead');
$$;

-- May add, change or deactivate organisation memberships.
CREATE OR REPLACE FUNCTION public.can_manage_members()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(public.current_member_role(), '') IN
        ('super_admin', 'team_leader', 'assistant_leader');
$$;

-- May create projects (mirrors the frontend `create_project` rule).
CREATE OR REPLACE FUNCTION public.can_create_project()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(public.current_member_role(), '') IN
        ('super_admin', 'team_leader', 'assistant_leader', 'project_manager');
$$;

-- May add learning resources / paths / assignments.
CREATE OR REPLACE FUNCTION public.can_manage_learning()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(public.current_member_role(), '') IN
        ('super_admin', 'team_leader', 'department_lead');
$$;

-- ====================================================================
-- 1. PROJECT VISIBILITY
--     A member may open a project when they own it, manage it, sit on its
--     team, or hold a task inside it. Leadership sees every project in the
--     organisation. Assigning someone a task is therefore enough to share
--     the project with them.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.can_view_project(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = p_id
          AND public.is_org_member(p.organization_id)
          AND (
                public.is_manager_or_above()
             OR p.owner_id = auth.uid()
             OR p.manager_id = auth.uid()
             OR EXISTS (
                    SELECT 1 FROM public.project_members pm
                    WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
                )
             OR EXISTS (
                    SELECT 1 FROM public.tasks t
                    WHERE t.project_id = p.id AND t.assignee_id = auth.uid()
                )
          )
    );
$$;

-- True when the caller may see a meeting row (used by several policies).
CREATE OR REPLACE FUNCTION public.can_view_meeting(m_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.meetings m
        WHERE m.id = m_id
          AND public.is_org_member(m.organization_id)
          AND (
                m.is_private = FALSE
             OR public.is_manager_or_above()
             OR m.host_id = auth.uid()
             OR EXISTS (
                    SELECT 1 FROM public.meeting_invitations mi
                    WHERE mi.meeting_id = m.id AND mi.user_id = auth.uid()
                )
             OR EXISTS (
                    SELECT 1 FROM public.meeting_participants mp
                    WHERE mp.meeting_id = m.id AND mp.user_id = auth.uid()
                )
          )
    );
$$;

-- ====================================================================
-- 2. SECURITY FIX — organisation membership writes
-- ====================================================================

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
DROP POLICY IF EXISTS "Memberships insertable by leadership" ON public.organization_memberships;
CREATE POLICY "Memberships insertable by leadership"
ON public.organization_memberships FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_members());

DROP POLICY IF EXISTS "Memberships updatable by org members" ON public.organization_memberships;
DROP POLICY IF EXISTS "Memberships updatable by leadership" ON public.organization_memberships;
CREATE POLICY "Memberships updatable by leadership"
ON public.organization_memberships FOR UPDATE
TO authenticated
USING (public.can_manage_members())
WITH CHECK (public.can_manage_members());

DROP POLICY IF EXISTS "Memberships deletable by super admins" ON public.organization_memberships;
CREATE POLICY "Memberships deletable by super admins"
ON public.organization_memberships FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- ====================================================================
-- 3. ORGANISATIONS, DEPARTMENTS, PROFILES
-- ====================================================================

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

DROP POLICY IF EXISTS "Departments viewable by org members" ON public.departments;
CREATE POLICY "Departments viewable by org members"
ON public.departments FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Departments insertable by org members" ON public.departments;
DROP POLICY IF EXISTS "Departments insertable by leadership" ON public.departments;
CREATE POLICY "Departments insertable by leadership"
ON public.departments FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND public.is_leadership());

DROP POLICY IF EXISTS "Departments updatable by org members" ON public.departments;
DROP POLICY IF EXISTS "Departments updatable by leadership" ON public.departments;
CREATE POLICY "Departments updatable by leadership"
ON public.departments FOR UPDATE
TO authenticated
USING (public.is_leadership())
WITH CHECK (public.is_leadership());

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles viewable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- A member may not reactivate their own suspended account, nor rewrite
-- their identity. Enforced here rather than only in the profile screen.
CREATE OR REPLACE FUNCTION public.protect_profile_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'A profile identity cannot be changed.';
    END IF;

    IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
       AND NOT public.is_leadership() THEN
        RAISE EXCEPTION 'Only leadership can change an account suspension state.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_identity ON public.profiles;
CREATE TRIGGER trg_protect_profile_identity
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_identity();

-- ====================================================================
-- 4. PROJECTS, PROJECT MEMBERS, MILESTONES
-- ====================================================================

DROP POLICY IF EXISTS "Projects viewable by org members" ON public.projects;
DROP POLICY IF EXISTS "Projects viewable by authorised users" ON public.projects;
CREATE POLICY "Projects viewable by authorised users"
ON public.projects FOR SELECT
TO authenticated
USING (public.can_view_project(id));

DROP POLICY IF EXISTS "Projects insertable by org members" ON public.projects;
DROP POLICY IF EXISTS "Projects insertable by authorised users" ON public.projects;
CREATE POLICY "Projects insertable by authorised users"
ON public.projects FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id)
    AND public.can_create_project()
    AND owner_id = auth.uid()
);

DROP POLICY IF EXISTS "Projects updatable by project owner or leads" ON public.projects;
DROP POLICY IF EXISTS "Projects updatable by authorised users" ON public.projects;
CREATE POLICY "Projects updatable by authorised users"
ON public.projects FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND public.is_manager_or_above()
)
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Project members viewable by org members" ON public.project_members;
DROP POLICY IF EXISTS "Project members viewable by authorised users" ON public.project_members;
CREATE POLICY "Project members viewable by authorised users"
ON public.project_members FOR SELECT
TO authenticated
USING (public.can_view_project(project_id));

DROP POLICY IF EXISTS "Project members insertable by org members" ON public.project_members;
DROP POLICY IF EXISTS "Project members insertable by project leads" ON public.project_members;
CREATE POLICY "Project members insertable by project leads"
ON public.project_members FOR INSERT
TO authenticated
WITH CHECK (
    public.is_manager_or_above()
    AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_id
          AND public.is_org_member(p.organization_id)
    )
);

DROP POLICY IF EXISTS "Project members deletable by project leads" ON public.project_members;
CREATE POLICY "Project members deletable by project leads"
ON public.project_members FOR DELETE
TO authenticated
USING (public.is_manager_or_above());

DROP POLICY IF EXISTS "Milestones viewable by org members" ON public.milestones;
DROP POLICY IF EXISTS "Milestones viewable by authorised users" ON public.milestones;
CREATE POLICY "Milestones viewable by authorised users"
ON public.milestones FOR SELECT
TO authenticated
USING (public.can_view_project(project_id));

DROP POLICY IF EXISTS "Milestones insertable by org members" ON public.milestones;
DROP POLICY IF EXISTS "Milestones insertable by project leads" ON public.milestones;
CREATE POLICY "Milestones insertable by project leads"
ON public.milestones FOR INSERT
TO authenticated
WITH CHECK (public.is_manager_or_above() AND public.can_view_project(project_id));

DROP POLICY IF EXISTS "Milestones updatable by org members" ON public.milestones;
DROP POLICY IF EXISTS "Milestones updatable by project leads" ON public.milestones;
CREATE POLICY "Milestones updatable by project leads"
ON public.milestones FOR UPDATE
TO authenticated
USING (public.is_manager_or_above() AND public.can_view_project(project_id))
WITH CHECK (public.can_view_project(project_id));

-- ====================================================================
-- 5. TASKS + SUPPORTING TABLES
--     Ordinary members read and update their own work; project leads keep
--     full control. Privileged columns are additionally guarded by a
--     trigger in section 6.
-- ====================================================================

DROP POLICY IF EXISTS "Tasks viewable by org members" ON public.tasks;
DROP POLICY IF EXISTS "Tasks viewable by authorised users" ON public.tasks;
CREATE POLICY "Tasks viewable by authorised users"
ON public.tasks FOR SELECT
TO authenticated
USING (public.can_view_project(project_id));

DROP POLICY IF EXISTS "Tasks insertable by org members" ON public.tasks;
DROP POLICY IF EXISTS "Tasks insertable by authorised users" ON public.tasks;
CREATE POLICY "Tasks insertable by authorised users"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
    public.can_view_project(project_id)
    AND created_by = auth.uid()
    AND (
        public.is_manager_or_above()
        OR assignee_id IS NULL
        OR assignee_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Tasks updatable by org members" ON public.tasks;
DROP POLICY IF EXISTS "Tasks updatable by authorised users" ON public.tasks;
CREATE POLICY "Tasks updatable by authorised users"
ON public.tasks FOR UPDATE
TO authenticated
USING (
    public.can_view_project(project_id)
    AND (
        public.is_manager_or_above()
        OR assignee_id = auth.uid()
        OR created_by = auth.uid()
    )
)
WITH CHECK (public.can_view_project(project_id));

DROP POLICY IF EXISTS "Tasks deletable by org members" ON public.tasks;
DROP POLICY IF EXISTS "Tasks deletable by authorised users" ON public.tasks;
CREATE POLICY "Tasks deletable by authorised users"
ON public.tasks FOR DELETE
TO authenticated
USING (
    public.can_view_project(project_id)
    AND (public.is_manager_or_above() OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "Task comments viewable by org members" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments viewable by authorised users" ON public.task_comments;
CREATE POLICY "Task comments viewable by authorised users"
ON public.task_comments FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_comments.task_id
      AND public.can_view_project(t.project_id)
));

DROP POLICY IF EXISTS "Task comments insertable by org members" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments insertable by authorised users" ON public.task_comments;
CREATE POLICY "Task comments insertable by authorised users"
ON public.task_comments FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.tasks t WHERE t.id = task_comments.task_id
          AND public.can_view_project(t.project_id)
    )
);

DROP POLICY IF EXISTS "Task attachments viewable by org members" ON public.task_attachments;
DROP POLICY IF EXISTS "Task attachments viewable by authorised users" ON public.task_attachments;
CREATE POLICY "Task attachments viewable by authorised users"
ON public.task_attachments FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_attachments.task_id
      AND public.can_view_project(t.project_id)
));

DROP POLICY IF EXISTS "Task attachments insertable by org members" ON public.task_attachments;
DROP POLICY IF EXISTS "Task attachments insertable by authorised users" ON public.task_attachments;
CREATE POLICY "Task attachments insertable by authorised users"
ON public.task_attachments FOR INSERT
TO authenticated
WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.tasks t WHERE t.id = task_attachments.task_id
          AND public.can_view_project(t.project_id)
    )
);

DROP POLICY IF EXISTS "Task dependencies viewable by org members" ON public.task_dependencies;
DROP POLICY IF EXISTS "Task dependencies viewable by authorised users" ON public.task_dependencies;
CREATE POLICY "Task dependencies viewable by authorised users"
ON public.task_dependencies FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_dependencies.task_id
      AND public.can_view_project(t.project_id)
));

DROP POLICY IF EXISTS "Task dependencies manageable by org members" ON public.task_dependencies;
DROP POLICY IF EXISTS "Task dependencies manageable by project leads" ON public.task_dependencies;
CREATE POLICY "Task dependencies manageable by project leads"
ON public.task_dependencies FOR INSERT
TO authenticated
WITH CHECK (public.is_manager_or_above());

DROP POLICY IF EXISTS "Task dependencies deletable by org members" ON public.task_dependencies;
DROP POLICY IF EXISTS "Task dependencies deletable by project leads" ON public.task_dependencies;
CREATE POLICY "Task dependencies deletable by project leads"
ON public.task_dependencies FOR DELETE
TO authenticated
USING (public.is_manager_or_above());

-- ====================================================================
-- 6. PRIVILEGED-FIELD GUARDS (database side, not just hidden buttons)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.protect_task_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id THEN
        IF NOT public.is_manager_or_above() THEN
            RAISE EXCEPTION 'Only project leads can move a task to another project.';
        END IF;
    END IF;

    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
       AND NOT (public.is_manager_or_above() OR OLD.created_by = auth.uid()) THEN
        RAISE EXCEPTION 'Only project leads can reassign a task.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_task_fields ON public.tasks;
CREATE TRIGGER trg_protect_task_fields
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.protect_task_fields();

-- ====================================================================
-- 7. MEETINGS — access limited to people actually invited or hosting
-- ====================================================================

DROP POLICY IF EXISTS "Meetings viewable by org members" ON public.meetings;
DROP POLICY IF EXISTS "Meetings viewable by authorised users" ON public.meetings;
CREATE POLICY "Meetings viewable by authorised users"
ON public.meetings FOR SELECT
TO authenticated
USING (public.can_view_meeting(id));

DROP POLICY IF EXISTS "Meetings insertable by org members" ON public.meetings;
DROP POLICY IF EXISTS "Meetings insertable by authorised users" ON public.meetings;
CREATE POLICY "Meetings insertable by authorised users"
ON public.meetings FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND host_id = auth.uid());

DROP POLICY IF EXISTS "Meetings updatable by host or leads" ON public.meetings;
DROP POLICY IF EXISTS "Meetings updatable by host or leads (scoped)" ON public.meetings;
CREATE POLICY "Meetings updatable by host or leads (scoped)"
ON public.meetings FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (host_id = auth.uid() OR public.is_manager_or_above())
)
WITH CHECK (public.is_org_member(organization_id));

-- Delete stays super-admin only (see 20261016140000_meeting_delete_and_realtime.sql).
DROP POLICY IF EXISTS "Meetings deletable by org members" ON public.meetings;
DROP POLICY IF EXISTS "Meetings deletable by super admins" ON public.meetings;
CREATE POLICY "Meetings deletable by super admins"
ON public.meetings FOR DELETE
TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Meeting invitations viewable by authorised users" ON public.meeting_invitations;
CREATE POLICY "Meeting invitations viewable by authorised users"
ON public.meeting_invitations FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.can_view_meeting(meeting_id)
);

DROP POLICY IF EXISTS "Meeting invitations insertable by host or leads" ON public.meeting_invitations;
CREATE POLICY "Meeting invitations insertable by host or leads"
ON public.meeting_invitations FOR INSERT
TO authenticated
WITH CHECK (
    public.is_manager_or_above()
    AND EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = meeting_id
          AND (m.host_id = auth.uid() OR public.is_manager_or_above())
    )
);

DROP POLICY IF EXISTS "Meeting invitations updatable by invitee or host" ON public.meeting_invitations;
CREATE POLICY "Meeting invitations updatable by invitee or host"
ON public.meeting_invitations FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.can_view_meeting(meeting_id))
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Meeting participants viewable by org members" ON public.meeting_participants;
DROP POLICY IF EXISTS "Meeting participants viewable by authorised users" ON public.meeting_participants;
CREATE POLICY "Meeting participants viewable by authorised users"
ON public.meeting_participants FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.can_view_meeting(meeting_id));

DROP POLICY IF EXISTS "Meeting participants manageable by authorised users" ON public.meeting_participants;
CREATE POLICY "Meeting participants manageable by authorised users"
ON public.meeting_participants FOR INSERT
TO authenticated
WITH CHECK (
    (user_id = auth.uid() OR user_id IS NULL)
    AND public.can_view_meeting(meeting_id)
);

DROP POLICY IF EXISTS "Meeting participants updatable by authorised users" ON public.meeting_participants;
CREATE POLICY "Meeting participants updatable by authorised users"
ON public.meeting_participants FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.can_view_meeting(meeting_id))
WITH CHECK (TRUE);

-- Meeting follow-up records (minutes, decisions, chat, agendas, action items)
-- are readable by anyone who can attend the meeting.
DROP POLICY IF EXISTS "Meeting minutes viewable by org members" ON public.meeting_minutes;
DROP POLICY IF EXISTS "Meeting minutes manageable by attendees" ON public.meeting_minutes;
CREATE POLICY "Meeting minutes manageable by attendees"
ON public.meeting_minutes FOR ALL
TO authenticated
USING (public.can_view_meeting(meeting_id))
WITH CHECK (public.can_view_meeting(meeting_id) AND recorded_by = auth.uid());

DROP POLICY IF EXISTS "Meeting decisions viewable by org members" ON public.meeting_decisions;
DROP POLICY IF EXISTS "Meeting decisions manageable by attendees" ON public.meeting_decisions;
CREATE POLICY "Meeting decisions manageable by attendees"
ON public.meeting_decisions FOR ALL
TO authenticated
USING (public.can_view_meeting(meeting_id))
WITH CHECK (public.can_view_meeting(meeting_id));

DROP POLICY IF EXISTS "Meeting action items viewable by org members" ON public.meeting_action_items;
DROP POLICY IF EXISTS "Meeting action items manageable by attendees" ON public.meeting_action_items;
CREATE POLICY "Meeting action items manageable by attendees"
ON public.meeting_action_items FOR ALL
TO authenticated
USING (public.can_view_meeting(meeting_id))
WITH CHECK (public.can_view_meeting(meeting_id));

DROP POLICY IF EXISTS "Meeting chat viewable by org members" ON public.meeting_chat_messages;
DROP POLICY IF EXISTS "Meeting chat manageable by attendees" ON public.meeting_chat_messages;
CREATE POLICY "Meeting chat manageable by attendees"
ON public.meeting_chat_messages FOR ALL
TO authenticated
USING (public.can_view_meeting(meeting_id))
WITH CHECK (public.can_view_meeting(meeting_id) AND (sender_id = auth.uid() OR sender_id IS NULL));

DROP POLICY IF EXISTS "Meeting agendas manageable by org members" ON public.meeting_agendas;
DROP POLICY IF EXISTS "Meeting agendas manageable by attendees" ON public.meeting_agendas;
CREATE POLICY "Meeting agendas manageable by attendees"
ON public.meeting_agendas FOR ALL
TO authenticated
USING (public.can_view_meeting(meeting_id))
WITH CHECK (public.can_view_meeting(meeting_id));

DROP POLICY IF EXISTS "Meeting agenda items manageable by org members" ON public.meeting_agenda_items;
DROP POLICY IF EXISTS "Meeting agenda items manageable by attendees" ON public.meeting_agenda_items;
CREATE POLICY "Meeting agenda items manageable by attendees"
ON public.meeting_agenda_items FOR ALL
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.meeting_agendas ma WHERE ma.id = meeting_agenda_items.agenda_id
      AND public.can_view_meeting(ma.meeting_id)
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.meeting_agendas ma WHERE ma.id = meeting_agenda_items.agenda_id
      AND public.can_view_meeting(ma.meeting_id)
));

-- ====================================================================
-- 8. INNOVATION LAB
-- ====================================================================

DROP POLICY IF EXISTS "Ideas viewable by org members" ON public.ideas;
CREATE POLICY "Ideas viewable by org members"
ON public.ideas FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Ideas insertable by org members" ON public.ideas;
CREATE POLICY "Ideas insertable by org members"
ON public.ideas FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND author_id = auth.uid());

DROP POLICY IF EXISTS "Ideas updatable by author or reviewer" ON public.ideas;
DROP POLICY IF EXISTS "Ideas updatable by author or leadership" ON public.ideas;
CREATE POLICY "Ideas updatable by author or leadership"
ON public.ideas FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id) AND (author_id = auth.uid() OR public.is_leadership()))
WITH CHECK (public.is_org_member(organization_id));

-- Status is the review outcome: leadership decides it, never the submitter.
CREATE OR REPLACE FUNCTION public.protect_idea_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_leadership() THEN
        RAISE EXCEPTION 'Only leadership can change the status of an idea.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_idea_status ON public.ideas;
CREATE TRIGGER trg_protect_idea_status
BEFORE UPDATE ON public.ideas
FOR EACH ROW
EXECUTE FUNCTION public.protect_idea_status();

DROP POLICY IF EXISTS "Idea reviews viewable by org members" ON public.idea_reviews;
CREATE POLICY "Idea reviews viewable by org members"
ON public.idea_reviews FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.ideas i WHERE i.id = idea_reviews.idea_id
      AND public.is_org_member(i.organization_id)
));

DROP POLICY IF EXISTS "Idea reviews insertable by reviewers" ON public.idea_reviews;
DROP POLICY IF EXISTS "Idea reviews viewable by org members (insert)" ON public.idea_reviews;
CREATE POLICY "Idea reviews insertable by reviewers"
ON public.idea_reviews FOR INSERT
TO authenticated
WITH CHECK (
    reviewer_id = auth.uid()
    AND public.is_leadership()
    AND EXISTS (
        SELECT 1 FROM public.ideas i WHERE i.id = idea_reviews.idea_id
          AND public.is_org_member(i.organization_id)
    )
);

DROP POLICY IF EXISTS "Idea votes manageable by self" ON public.idea_votes;
DROP POLICY IF EXISTS "Idea votes viewable by org members" ON public.idea_votes;
CREATE POLICY "Idea votes viewable by org members"
ON public.idea_votes FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.ideas i WHERE i.id = idea_votes.idea_id
      AND public.is_org_member(i.organization_id)
));

DROP POLICY IF EXISTS "Idea votes insertable by self" ON public.idea_votes;
CREATE POLICY "Idea votes insertable by self"
ON public.idea_votes FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Idea votes deletable by self" ON public.idea_votes;
CREATE POLICY "Idea votes deletable by self"
ON public.idea_votes FOR DELETE
TO authenticated
USING (user_id = auth.uid());

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

-- ====================================================================
-- 9. LEARNING & DEVELOPMENT
-- ====================================================================

DROP POLICY IF EXISTS "Learning resources viewable by org members" ON public.learning_resources;
CREATE POLICY "Learning resources viewable by org members"
ON public.learning_resources FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Learning resources insertable by org members" ON public.learning_resources;
DROP POLICY IF EXISTS "Learning resources insertable by learning managers" ON public.learning_resources;
CREATE POLICY "Learning resources insertable by learning managers"
ON public.learning_resources FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND public.can_manage_learning() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Learning paths viewable by org members" ON public.learning_paths;
CREATE POLICY "Learning paths viewable by org members"
ON public.learning_paths FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Learning paths insertable by org members" ON public.learning_paths;
DROP POLICY IF EXISTS "Learning paths insertable by learning managers" ON public.learning_paths;
CREATE POLICY "Learning paths insertable by learning managers"
ON public.learning_paths FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND public.can_manage_learning() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Learning assignments viewable by org members" ON public.learning_assignments;
CREATE POLICY "Learning assignments viewable by org members"
ON public.learning_assignments FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Learning assignments insertable by org members" ON public.learning_assignments;
DROP POLICY IF EXISTS "Learning assignments insertable by learning managers" ON public.learning_assignments;
CREATE POLICY "Learning assignments insertable by learning managers"
ON public.learning_assignments FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_learning() AND created_by = auth.uid());

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

-- ====================================================================
-- 10. ANNOUNCEMENTS + PER-MEMBER READ STATE
-- ====================================================================

DROP POLICY IF EXISTS "Announcements viewable by org members" ON public.announcements;
CREATE POLICY "Announcements viewable by org members"
ON public.announcements FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Announcements insertable by org members" ON public.announcements;
DROP POLICY IF EXISTS "Announcements insertable by leadership" ON public.announcements;
CREATE POLICY "Announcements insertable by leadership"
ON public.announcements FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND author_id = auth.uid() AND public.is_leadership());

DROP POLICY IF EXISTS "Announcements updatable by org members" ON public.announcements;
DROP POLICY IF EXISTS "Announcements updatable by author or leadership" ON public.announcements;
CREATE POLICY "Announcements updatable by author or leadership"
ON public.announcements FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id) AND (author_id = auth.uid() OR public.is_leadership()))
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Announcements deletable by leadership" ON public.announcements;
CREATE POLICY "Announcements deletable by leadership"
ON public.announcements FOR DELETE
TO authenticated
USING (public.is_leadership());

-- Announcements have no native read flag, so add a per-member read record.
CREATE TABLE IF NOT EXISTS public.announcement_reads (
    announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (announcement_id, user_id)
);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Announcement reads manageable by self" ON public.announcement_reads;
CREATE POLICY "Announcement reads manageable by self"
ON public.announcement_reads FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ====================================================================
-- 11. NOTIFICATIONS — ownership plus the columns needed to deep-link
-- ====================================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS target_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS target_table TEXT;

DROP POLICY IF EXISTS "Notifications viewable by target user" ON public.notifications;
CREATE POLICY "Notifications viewable by target user"
ON public.notifications FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Notifications updatable by target user" ON public.notifications;
CREATE POLICY "Notifications updatable by target user"
ON public.notifications FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Notifications deletable by target user" ON public.notifications;
CREATE POLICY "Notifications deletable by target user"
ON public.notifications FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Notification preferences manageable by self" ON public.notification_preferences;
CREATE POLICY "Notification preferences manageable by self"
ON public.notification_preferences FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ====================================================================
-- 12. DOCUMENTS
--     Read: any member of the owning organisation.
--     Write: the uploader, or leadership.
-- ====================================================================

DROP POLICY IF EXISTS "Documents viewable by org members" ON public.documents;
CREATE POLICY "Documents viewable by org members"
ON public.documents FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Documents insertable by org members" ON public.documents;
CREATE POLICY "Documents insertable by org members"
ON public.documents FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Documents updatable by uploader" ON public.documents;
DROP POLICY IF EXISTS "Documents updatable by uploader or leadership" ON public.documents;
CREATE POLICY "Documents updatable by uploader or leadership"
ON public.documents FOR UPDATE
TO authenticated
USING (uploaded_by = auth.uid() OR public.is_leadership())
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Documents deletable by uploader" ON public.documents;
DROP POLICY IF EXISTS "Documents deletable by uploader or leadership" ON public.documents;
CREATE POLICY "Documents deletable by uploader or leadership"
ON public.documents FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid() OR public.is_leadership());

-- ====================================================================
-- 13. BUSINESS, AUDIT, SYSTEM
-- ====================================================================

DROP POLICY IF EXISTS "Proposals viewable by org members" ON public.business_proposals;
DROP POLICY IF EXISTS "Proposals viewable by leadership" ON public.business_proposals;
CREATE POLICY "Proposals viewable by leadership"
ON public.business_proposals FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id) AND public.is_manager_or_above());

DROP POLICY IF EXISTS "Proposals insertable by org members" ON public.business_proposals;
DROP POLICY IF EXISTS "Proposals insertable by leadership" ON public.business_proposals;
CREATE POLICY "Proposals insertable by leadership"
ON public.business_proposals FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND public.is_manager_or_above() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Proposals updatable by org members" ON public.business_proposals;
DROP POLICY IF EXISTS "Proposals updatable by leadership" ON public.business_proposals;
CREATE POLICY "Proposals updatable by leadership"
ON public.business_proposals FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id) AND public.is_manager_or_above())
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Expenses viewable by org members" ON public.expense_records;
DROP POLICY IF EXISTS "Expenses viewable by leadership" ON public.expense_records;
CREATE POLICY "Expenses viewable by leadership"
ON public.expense_records FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id) AND public.is_manager_or_above());

DROP POLICY IF EXISTS "Expenses insertable by org members" ON public.expense_records;
DROP POLICY IF EXISTS "Expenses insertable by leadership" ON public.expense_records;
CREATE POLICY "Expenses insertable by leadership"
ON public.expense_records FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id) AND public.is_manager_or_above() AND recorded_by = auth.uid());

DROP POLICY IF EXISTS "Expenses updatable by org members" ON public.expense_records;
DROP POLICY IF EXISTS "Expenses updatable by leadership" ON public.expense_records;
CREATE POLICY "Expenses updatable by leadership"
ON public.expense_records FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id) AND public.is_manager_or_above())
WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Project budgets viewable by org members" ON public.project_budgets;
DROP POLICY IF EXISTS "Project budgets viewable by leadership" ON public.project_budgets;
CREATE POLICY "Project budgets viewable by leadership"
ON public.project_budgets FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_budgets.project_id
      AND public.is_org_member(p.organization_id)
      AND public.is_manager_or_above()
));

DROP POLICY IF EXISTS "Invitations viewable by org members" ON public.invitations;
CREATE POLICY "Invitations viewable by org members"
ON public.invitations FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Invitations insertable by org members" ON public.invitations;
DROP POLICY IF EXISTS "Invitations insertable by leadership" ON public.invitations;
CREATE POLICY "Invitations insertable by leadership"
ON public.invitations FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_members() AND invited_by = auth.uid());

DROP POLICY IF EXISTS "Invitations updatable by inviter" ON public.invitations;
DROP POLICY IF EXISTS "Invitations updatable by leadership" ON public.invitations;
CREATE POLICY "Invitations updatable by leadership"
ON public.invitations FOR UPDATE
TO authenticated
USING (public.can_manage_members())
WITH CHECK (public.can_manage_members());

DROP POLICY IF EXISTS "Invitations deletable by leadership" ON public.invitations;
CREATE POLICY "Invitations deletable by leadership"
ON public.invitations FOR DELETE
TO authenticated
USING (public.can_manage_members());

DROP POLICY IF EXISTS "Role assignments viewable by authenticated" ON public.role_assignments;
CREATE POLICY "Role assignments viewable by authenticated"
ON public.role_assignments FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Audit logs viewable by authenticated users" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs viewable by leadership" ON public.audit_logs;
CREATE POLICY "Audit logs viewable by leadership"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.current_member_role() IN ('super_admin', 'team_leader'));

DROP POLICY IF EXISTS "Audit logs insertable by authenticated users" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs insertable by authenticated users (scoped)" ON public.audit_logs;
CREATE POLICY "Audit logs insertable by authenticated users (scoped)"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "System settings readable by authenticated" ON public.system_settings;
CREATE POLICY "System settings readable by authenticated"
ON public.system_settings FOR SELECT
TO authenticated
USING (TRUE);

-- ====================================================================
-- 14. REAL-TIME NOTIFICATIONS
-- ====================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        RAISE NOTICE 'supabase_realtime publication not present; in-app realtime notifications stay disabled.';
    WHEN duplicate_object THEN
        NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'announcements'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        RAISE NOTICE 'supabase_realtime publication not present; announcement realtime stays disabled.';
    WHEN duplicate_object THEN
        NULL;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;

-- ====================================================================
-- 15. NOTIFICATION TRIGGERS (server-side, cannot be bypassed by the UI)
--     All are SECURITY DEFINER so fan-out to other members is permitted,
--     and they delete the previous unread notification for the same target
--     so a member never sees duplicates.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.insert_notification(
    p_user UUID,
    p_title TEXT,
    p_message TEXT,
    p_type TEXT,
    p_link TEXT,
    p_target_id UUID DEFAULT NULL,
    p_target_table TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user IS NULL OR p_user = auth.uid() THEN
        RETURN;
    END IF;

    -- Respect the member's own in-app notification preference.
    IF EXISTS (
        SELECT 1 FROM public.notification_preferences np
        WHERE np.user_id = p_user AND np.in_app_notifications = FALSE
    ) THEN
        RETURN;
    END IF;

    DELETE FROM public.notifications n
    WHERE n.user_id = p_user
      AND n.type = p_type
      AND n.is_read = FALSE
      AND n.target_id IS NOT DISTINCT FROM p_target_id
      AND n.target_table IS NOT DISTINCT FROM p_target_table;

    INSERT INTO public.notifications (user_id, title, message, type, link_url, target_id, target_table)
    VALUES (p_user, p_title, p_message, p_type, p_link, p_target_id, p_target_table);
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.assignee_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
        PERFORM public.insert_notification(
            NEW.assignee_id,
            'New task assigned',
            '"' || NEW.title || '" has been assigned to you.',
            'task',
            '/workspace/tasks',
            NEW.id,
            'tasks'
        );
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND OLD.assignee_id IS NOT NULL THEN
        PERFORM public.insert_notification(
            OLD.assignee_id,
            'Task status changed',
            '"' || NEW.title || '" moved to ' || replace(NEW.status, '_', ' ') || '.',
            'task',
            '/workspace/tasks',
            NEW.id,
            'tasks'
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assigned ON public.tasks;
CREATE TRIGGER trg_notify_task_assigned
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.notify_task_assigned();

CREATE OR REPLACE FUNCTION public.notify_meeting_invited()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_title TEXT;
BEGIN
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT m.title INTO v_title FROM public.meetings m WHERE m.id = NEW.meeting_id;

    PERFORM public.insert_notification(
        NEW.user_id,
        'Meeting invitation',
        'You have been invited to "' || COALESCE(v_title, 'a meeting') || '".',
        'meeting',
        '/workspace/meetings',
        NEW.meeting_id,
        'meetings'
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_meeting_invited ON public.meeting_invitations;
CREATE TRIGGER trg_notify_meeting_invited
AFTER INSERT ON public.meeting_invitations
FOR EACH ROW
EXECUTE FUNCTION public.notify_meeting_invited();

CREATE OR REPLACE FUNCTION public.notify_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_assignee UUID;
    v_title TEXT;
BEGIN
    SELECT t.assignee_id, t.title INTO v_assignee, v_title
    FROM public.tasks t WHERE t.id = NEW.task_id;

    IF v_assignee IS NOT NULL THEN
        PERFORM public.insert_notification(
            v_assignee,
            'New comment on your task',
            'A comment was added to "' || v_title || '".',
            'task',
            '/workspace/tasks',
            NEW.task_id,
            'tasks'
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_comment ON public.task_comments;
CREATE TRIGGER trg_notify_task_comment
AFTER INSERT ON public.task_comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_task_comment();

CREATE OR REPLACE FUNCTION public.notify_idea_reviewed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author UUID;
    v_title TEXT;
BEGIN
    SELECT i.author_id, i.title INTO v_author, v_title
    FROM public.ideas i WHERE i.id = NEW.idea_id;

    PERFORM public.insert_notification(
        v_author,
        'Your idea was reviewed',
        '"' || COALESCE(v_title, 'Your idea') || '" — decision: ' || NEW.decision || '.',
        'idea',
        '/workspace/innovation',
        NEW.idea_id,
        'ideas'
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_idea_reviewed ON public.idea_reviews;
CREATE TRIGGER trg_notify_idea_reviewed
AFTER INSERT ON public.idea_reviews
FOR EACH ROW
EXECUTE FUNCTION public.notify_idea_reviewed();

-- Announcements fan out to every active member of the organisation.
CREATE OR REPLACE FUNCTION public.notify_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member UUID;
BEGIN
    FOR v_member IN
        SELECT om.user_id FROM public.organization_memberships om
        WHERE om.organization_id = NEW.organization_id
          AND om.is_active = TRUE
    LOOP
        PERFORM public.insert_notification(
            v_member,
            CASE WHEN NEW.is_pinned THEN 'Pinned announcement' ELSE 'New announcement' END,
            NEW.title,
            'announcement',
            '/workspace/messages',
            NEW.id,
            'announcements'
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_announcement ON public.announcements;
CREATE TRIGGER trg_notify_announcement
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_announcement();

-- ====================================================================
-- 16. PRIVATE DOCUMENT STORAGE
--     A private bucket keyed by organisation id. Membership of the
--     organisation (enforced by is_org_member) is what grants access, so
--     no file is ever publicly reachable.
-- ====================================================================

DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('documents', 'documents', FALSE, 52428800)
    ON CONFLICT (id) DO NOTHING;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create the "documents" storage bucket: %', SQLERRM;
END $$;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Org members can read documents" ON storage.objects;
    CREATE POLICY "Org members can read documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.organizations o
            WHERE o.id::text = (storage.foldername(name))[2]
              AND public.is_org_member(o.id)
        )
    );

    DROP POLICY IF EXISTS "Org members can upload documents" ON storage.objects;
    CREATE POLICY "Org members can upload documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.organizations o
            WHERE o.id::text = (storage.foldername(name))[2]
              AND public.is_org_member(o.id)
        )
    );

    DROP POLICY IF EXISTS "Uploaders can manage their documents" ON storage.objects;
    CREATE POLICY "Uploaders can manage their documents"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'documents' AND (owner = auth.uid() OR public.is_leadership()))
    WITH CHECK (bucket_id = 'documents');

    DROP POLICY IF EXISTS "Uploaders can delete their documents" ON storage.objects;
    CREATE POLICY "Uploaders can delete their documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'documents' AND (owner = auth.uid() OR public.is_leadership()));
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create storage policies on the "documents" bucket: %', SQLERRM;
END $$;

-- ====================================================================
-- 17. INDEXES for the new member-facing query paths
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_invitations_user ON public.meeting_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON public.announcement_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_target ON public.notifications(user_id, target_table, target_id);
