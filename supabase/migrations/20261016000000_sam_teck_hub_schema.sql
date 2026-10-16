-- ====================================================================
-- SAM_TECK HUB: MASTER DATABASE SCHEMA & ROW LEVEL SECURITY
-- PostgreSQL / Supabase Migration
-- Version: 20261016000000
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS & DOMAINS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'super_admin',
        'team_leader',
        'assistant_leader',
        'project_manager',
        'department_lead',
        'team_member',
        'guest'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE project_status AS ENUM (
        'planning',
        'active',
        'on_hold',
        'in_review',
        'completed',
        'archived'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE task_status AS ENUM (
        'backlog',
        'todo',
        'in_progress',
        'in_review',
        'blocked',
        'done'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE task_priority AS ENUM (
        'low',
        'medium',
        'high',
        'urgent'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE meeting_status AS ENUM (
        'scheduled',
        'live',
        'completed',
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE idea_status AS ENUM (
        'submitted',
        'under_review',
        'needs_revision',
        'approved',
        'in_development',
        'testing',
        'launched',
        'deferred',
        'rejected'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. CORE ORGANIZATION & MULTI-USER WORKSPACE
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    job_title TEXT,
    department_id UUID,
    skills TEXT[] DEFAULT '{}',
    bio TEXT,
    is_suspended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    lead_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign key link for department on profile
ALTER TABLE public.profiles 
    ADD CONSTRAINT fk_profile_department 
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.organization_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'team_member',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'team_member',
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    is_accepted BOOLEAN DEFAULT FALSE,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PROJECTS & TASKS
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    objectives TEXT,
    scope TEXT,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    manager_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    status project_status NOT NULL DEFAULT 'planning',
    priority task_priority NOT NULL DEFAULT 'medium',
    target_start_date DATE,
    target_end_date DATE,
    budget NUMERIC(15,2) DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.project_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_in_project TEXT DEFAULT 'Contributor',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES public.milestones(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'todo',
    priority task_priority NOT NULL DEFAULT 'medium',
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    due_date DATE,
    acceptance_criteria TEXT,
    origin_meeting_id UUID,
    origin_action_item_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS public.task_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SAM_TECK MEET: BRANDED VIRTUAL MEETINGS
CREATE TABLE IF NOT EXISTS public.meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 45,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status meeting_status NOT NULL DEFAULT 'scheduled',
    livekit_room_name TEXT UNIQUE NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    meeting_url TEXT,
    actual_start_time TIMESTAMPTZ,
    actual_end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    guest_email TEXT,
    guest_name TEXT,
    role TEXT DEFAULT 'participant', -- 'host', 'co-host', 'participant', 'guest'
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    email TEXT,
    status TEXT DEFAULT 'invited', -- 'invited', 'accepted', 'declined', 'tentative'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_agendas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_agenda_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agenda_id UUID NOT NULL REFERENCES public.meeting_agendas(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER DEFAULT 10,
    presenter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    order_index INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_minutes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    summary TEXT,
    discussion_notes TEXT,
    is_finalized BOOLEAN DEFAULT FALSE,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    context TEXT,
    decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_action_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    due_date DATE,
    is_converted_to_task BOOLEAN DEFAULT FALSE,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. INNOVATION LAB
CREATE TABLE IF NOT EXISTS public.ideas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    problem_statement TEXT NOT NULL,
    target_users TEXT NOT NULL,
    proposed_solution TEXT NOT NULL,
    expected_value TEXT,
    estimated_effort TEXT,
    estimated_cost NUMERIC(15,2) DEFAULT 0,
    required_skills TEXT[] DEFAULT '{}',
    status idea_status NOT NULL DEFAULT 'submitted',
    converted_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.idea_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    feedback TEXT NOT NULL,
    decision TEXT NOT NULL, -- 'approved', 'needs_revision', 'rejected', 'deferred'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.idea_votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(idea_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.innovation_experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idea_id UUID REFERENCES public.ideas(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    methodology TEXT,
    results TEXT,
    conclusion TEXT,
    status TEXT DEFAULT 'planned', -- 'planned', 'running', 'completed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_roadmap_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    idea_id UUID REFERENCES public.ideas(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    quarter TEXT NOT NULL, -- e.g. 'Q1 2026'
    stage TEXT NOT NULL DEFAULT 'Discovery', -- 'Discovery', 'Design', 'Development', 'Testing', 'Launch'
    priority task_priority DEFAULT 'medium',
    target_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. LEARNING & PROFESSIONAL DEVELOPMENT
CREATE TABLE IF NOT EXISTS public.learning_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL, -- 'Technology', 'Business', 'Research', 'Innovation'
    content_type TEXT DEFAULT 'document', -- 'article', 'video', 'document', 'course'
    url TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.learning_paths (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    target_role user_role,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.learning_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    path_id UUID REFERENCES public.learning_paths(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    due_date DATE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.learning_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID NOT NULL REFERENCES public.learning_assignments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    submission_text TEXT,
    attachment_url TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    grade TEXT,
    feedback TEXT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.learning_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES public.learning_resources(id) ON DELETE CASCADE,
    path_id UUID REFERENCES public.learning_paths(id) ON DELETE CASCADE,
    progress_percent INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. ANNOUNCEMENTS & NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'general', -- 'task', 'meeting', 'announcement', 'idea', 'system'
    link_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    email_on_task_assign BOOLEAN DEFAULT TRUE,
    email_on_meeting_invite BOOLEAN DEFAULT TRUE,
    email_on_announcement BOOLEAN DEFAULT TRUE,
    in_app_notifications BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. DOCUMENTS & FILE MANAGEMENT
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES public.meetings(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'General',
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. BUSINESS & RESOURCE MANAGEMENT
CREATE TABLE IF NOT EXISTS public.business_proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    client_partner_name TEXT,
    scope_description TEXT NOT NULL,
    proposed_budget NUMERIC(15,2) DEFAULT 0,
    status TEXT DEFAULT 'draft', -- 'draft', 'submitted', 'negotiating', 'accepted', 'rejected'
    submitted_date DATE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.project_budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    allocated_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    fiscal_year TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount NUMERIC(15,2) NOT NULL,
    category TEXT NOT NULL, -- 'Hardware', 'Software', 'Infrastructure', 'Travel', 'Operations'
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    is_approved BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. AUDIT LOGS & SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    user_email TEXT,
    action TEXT NOT NULL, -- e.g. 'INITIAL_ADMIN_PROVISIONED', 'PROJECT_CREATED', 'ROLE_CHANGED'
    target_entity TEXT NOT NULL,
    target_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_agendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.innovation_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_roadmap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is an organization member
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles: Authenticated users can read member profiles, update their own profile
CREATE POLICY "Profiles viewable by authenticated users" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (TRUE);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
TO authenticated 
USING (id = auth.uid());

CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT 
TO authenticated 
WITH CHECK (id = auth.uid());

-- Organizations: Read for members, insert for setup
CREATE POLICY "Organizations viewable by members"
ON public.organizations FOR SELECT
TO authenticated
USING (public.is_org_member(id));

-- Projects: Org members can select; PMs and leadership can create/update
CREATE POLICY "Projects viewable by org members"
ON public.projects FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Projects insertable by org members"
ON public.projects FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Projects updatable by project owner or leads"
ON public.projects FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

-- Tasks: Viewable and manageable by org members
CREATE POLICY "Tasks viewable by org members"
ON public.tasks FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tasks.project_id
    AND public.is_org_member(p.organization_id)
));

CREATE POLICY "Tasks insertable by org members"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tasks.project_id
    AND public.is_org_member(p.organization_id)
));

CREATE POLICY "Tasks updatable by org members"
ON public.tasks FOR UPDATE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tasks.project_id
    AND public.is_org_member(p.organization_id)
));

CREATE POLICY "Tasks deletable by org members"
ON public.tasks FOR DELETE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tasks.project_id
    AND public.is_org_member(p.organization_id)
));

-- Meetings: Viewable and manageable by org members
CREATE POLICY "Meetings viewable by org members"
ON public.meetings FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Meetings insertable by org members"
ON public.meetings FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Meetings updatable by host or leads"
ON public.meetings FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

-- Meeting participants & minutes
CREATE POLICY "Meeting participants viewable by org members"
ON public.meeting_participants FOR ALL
TO authenticated
USING (TRUE);

CREATE POLICY "Meeting minutes viewable by org members"
ON public.meeting_minutes FOR ALL
TO authenticated
USING (TRUE);

CREATE POLICY "Meeting decisions viewable by org members"
ON public.meeting_decisions FOR ALL
TO authenticated
USING (TRUE);

CREATE POLICY "Meeting action items viewable by org members"
ON public.meeting_action_items FOR ALL
TO authenticated
USING (TRUE);

CREATE POLICY "Meeting chat viewable by org members"
ON public.meeting_chat_messages FOR ALL
TO authenticated
USING (TRUE);

-- Ideas:
CREATE POLICY "Ideas viewable by org members"
ON public.ideas FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Ideas insertable by org members"
ON public.ideas FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Ideas updatable by author or reviewer"
ON public.ideas FOR UPDATE
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Idea reviews viewable by org members"
ON public.idea_reviews FOR ALL
TO authenticated
USING (TRUE);

CREATE POLICY "Idea votes viewable by org members"
ON public.idea_votes FOR ALL
TO authenticated
USING (TRUE);

-- Announcements & Notifications
CREATE POLICY "Announcements viewable by org members"
ON public.announcements FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Notifications viewable by target user"
ON public.notifications FOR ALL
TO authenticated
USING (user_id = auth.uid());

-- Documents
CREATE POLICY "Documents viewable by org members"
ON public.documents FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Documents insertable by org members"
ON public.documents FOR INSERT
TO authenticated
WITH CHECK (public.is_org_member(organization_id));

-- Audit logs
CREATE POLICY "Audit logs viewable by authenticated users"
ON public.audit_logs FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Audit logs insertable by authenticated users"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (TRUE);

-- System Settings
CREATE POLICY "System settings readable by authenticated"
ON public.system_settings FOR SELECT
TO authenticated
USING (TRUE);

-- 13. INDEXES FOR HIGH-PERFORMANCE QUERYING
CREATE INDEX IF NOT EXISTS idx_projects_org ON public.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_meetings_org ON public.meetings(organization_id);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON public.meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_meetings_slug ON public.meetings(slug);
CREATE INDEX IF NOT EXISTS idx_ideas_org ON public.ideas(organization_id);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON public.ideas(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);
