/**
 * Sam_Teck Hub: Unified TypeScript Database Model
 * Fully aligned with Supabase PostgreSQL Schema
 */

export type UserRole =
  | 'super_admin'
  | 'team_leader'
  | 'assistant_leader'
  | 'project_manager'
  | 'department_lead'
  | 'team_member'
  | 'guest';

export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'in_review'
  | 'completed'
  | 'archived';

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type MeetingStatus = 'scheduled' | 'live' | 'completed' | 'cancelled';

export type IdeaStatus =
  | 'submitted'
  | 'under_review'
  | 'needs_revision'
  | 'approved'
  | 'in_development'
  | 'testing'
  | 'launched'
  | 'deferred'
  | 'rejected';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  job_title?: string;
  department_id?: string;
  skills?: string[];
  bio?: string;
  is_suspended?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  lead_id?: string;
  lead?: Profile;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string;
  objectives?: string;
  scope?: string;
  owner_id: string;
  manager_id?: string;
  department_id?: string;
  status: ProjectStatus;
  priority: TaskPriority;
  target_start_date?: string;
  target_end_date?: string;
  budget?: number;
  is_archived?: boolean;
  created_at: string;
  updated_at: string;
  owner?: Profile;
  manager?: Profile;
  tasks_count?: number;
  completed_tasks_count?: number;
}

export interface Task {
  id: string;
  project_id: string;
  milestone_id?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id?: string;
  created_by: string;
  due_date?: string;
  acceptance_criteria?: string;
  origin_meeting_id?: string;
  origin_action_item_id?: string;
  created_at: string;
  updated_at: string;
  assignee?: Profile;
  creator?: Profile;
  project?: Project;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  due_date?: string;
  is_completed: boolean;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  organization_id: string;
  title: string;
  slug: string;
  description?: string;
  project_id?: string;
  department_id?: string;
  host_id: string;
  start_time: string;
  duration_minutes: number;
  timezone: string;
  status: MeetingStatus;
  livekit_room_name: string;
  is_private: boolean;
  meeting_url?: string;
  actual_start_time?: string;
  actual_end_time?: string;
  created_at: string;
  updated_at: string;
  host?: Profile;
  project?: Project;
}

export interface MeetingAgendaItem {
  id: string;
  agenda_id: string;
  title: string;
  description?: string;
  duration_minutes: number;
  presenter_id?: string;
  order_index: number;
  is_completed: boolean;
  created_at: string;
}

export interface MeetingMinutes {
  id: string;
  meeting_id: string;
  recorded_by: string;
  summary?: string;
  discussion_notes?: string;
  is_finalized: boolean;
  finalized_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingDecision {
  id: string;
  meeting_id: string;
  decision: string;
  context?: string;
  decided_by?: string;
  created_at: string;
}

export interface MeetingActionItem {
  id: string;
  meeting_id: string;
  title: string;
  description?: string;
  assignee_id?: string;
  project_id?: string;
  due_date?: string;
  is_converted_to_task: boolean;
  task_id?: string;
  created_at: string;
  updated_at: string;
  assignee?: Profile;
  project?: Project;
}

export interface MeetingChatMessage {
  id: string;
  meeting_id: string;
  sender_id?: string;
  sender_name: string;
  message: string;
  created_at: string;
}

export interface Idea {
  id: string;
  organization_id: string;
  author_id: string;
  title: string;
  problem_statement: string;
  target_users: string;
  proposed_solution: string;
  expected_value?: string;
  estimated_effort?: string;
  estimated_cost?: number;
  required_skills?: string[];
  status: IdeaStatus;
  converted_project_id?: string;
  created_at: string;
  updated_at: string;
  author?: Profile;
  reviews?: IdeaReview[];
  votes_count?: number;
}

export interface IdeaReview {
  id: string;
  idea_id: string;
  reviewer_id: string;
  feedback: string;
  decision: 'approved' | 'needs_revision' | 'rejected' | 'deferred';
  created_at: string;
  reviewer?: Profile;
}

export interface LearningResource {
  id: string;
  organization_id: string;
  title: string;
  description?: string;
  category: 'Technology' | 'Business' | 'Research' | 'Innovation';
  content_type: 'article' | 'video' | 'document' | 'course';
  url?: string;
  created_by: string;
  created_at: string;
  creator?: Profile;
}

export interface LearningAssignment {
  id: string;
  path_id?: string;
  title: string;
  description: string;
  due_date?: string;
  created_by: string;
  created_at: string;
}

/** A member's own progress against a resource or learning path. */
export interface LearningProgress {
  id: string;
  user_id: string;
  resource_id?: string | null;
  path_id?: string | null;
  progress_percent: number;
  is_completed: boolean;
  completed_at?: string | null;
  updated_at?: string;
}

export interface Announcement {
  id: string;
  organization_id: string;
  author_id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  author?: Profile;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'task' | 'meeting' | 'announcement' | 'idea' | 'system';
  link_url?: string;
  is_read: boolean;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  organization_id: string;
  project_id?: string;
  meeting_id?: string;
  title: string;
  description?: string;
  category: string;
  file_path: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by: string;
  created_at: string;
  uploader?: Profile;
}

export interface BusinessProposal {
  id: string;
  organization_id: string;
  title: string;
  client_partner_name?: string;
  scope_description: string;
  proposed_budget: number;
  status: 'draft' | 'submitted' | 'negotiating' | 'accepted' | 'rejected';
  submitted_date?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseRecord {
  id: string;
  project_id?: string;
  organization_id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  receipt_document_id?: string;
  recorded_by: string;
  is_approved: boolean;
  approved_by?: string;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  user_id?: string;
  user_email?: string;
  action: string;
  target_entity: string;
  target_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface SystemHealthStatus {
  database_connected: boolean;
  database_version?: string;
  livekit_configured: boolean;
  initial_admin_provisioned: boolean;
  timestamp: string;
}
