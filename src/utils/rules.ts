import type { UserRole } from '../types/database.ts';

/**
 * Pure Business Logic & Calculation Utilities for Sam_Teck Hub
 * Decoupled from UI to ensure fast, deterministic unit testing
 */

/**
 * Calculates project or milestone task completion percentage.
 * Strict rule: If tasks array is empty, returns 0.
 */
export function calculateTaskProgress(tasks: { status: string }[]): number {
  if (!tasks || tasks.length === 0) {
    return 0;
  }
  const completedCount = tasks.filter((t) => t.status === 'done').length;
  return Math.round((completedCount / tasks.length) * 100);
}

/**
 * Identifies overdue tasks from real records.
 */
export function filterOverdueTasks<T extends { status: string; due_date?: string }>(
  tasks: T[],
  referenceDateStr?: string
): T[] {
  if (!tasks || tasks.length === 0) return [];
  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  refDate.setHours(23, 59, 59, 999);

  return tasks.filter((task) => {
    if (task.status === 'done' || !task.due_date) return false;
    const dueDate = new Date(task.due_date);
    return dueDate.getTime() < refDate.getTime();
  });
}

/**
 * Determines whether a task is due within a given window (default 3 days).
 */
export function isTaskDueSoon(
  dueDateStr?: string,
  referenceDateStr?: string,
  daysWindow: number = 3
): boolean {
  if (!dueDateStr) return false;
  const now = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const dueDate = new Date(dueDateStr);

  const diffTime = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= daysWindow;
}

/**
 * Role-Based Access Control evaluator
 */
export type SystemAction =
  | 'manage_system'
  | 'invite_members'
  | 'create_project'
  | 'manage_meeting'
  | 'delete_meeting'
  | 'review_idea'
  | 'access_finance'
  | 'view_audit_logs'
  | 'access_admin_portal'
  | 'publish_announcement'
  | 'manage_learning';

/** Roles that carry leadership / administrative authority. */
const LEADERSHIP_ROLES: UserRole[] = [
  'super_admin',
  'team_leader',
  'assistant_leader',
  'department_lead',
];

export function checkRolePermission(role: UserRole | undefined, action: SystemAction): boolean {
  if (!role) return false;

  switch (action) {
    case 'manage_system':
    case 'view_audit_logs':
    case 'delete_meeting':
      return role === 'super_admin';

    case 'access_admin_portal':
      return role === 'super_admin' || role === 'team_leader';

    case 'invite_members':
      return ['super_admin', 'team_leader', 'assistant_leader'].includes(role);

    case 'create_project':
      return ['super_admin', 'team_leader', 'assistant_leader', 'project_manager'].includes(role);

    case 'manage_meeting':
      return ['super_admin', 'team_leader', 'assistant_leader', 'project_manager', 'department_lead', 'team_member'].includes(role);

    case 'review_idea':
    case 'publish_announcement':
      return ['super_admin', 'team_leader', 'assistant_leader', 'department_lead'].includes(role);

    case 'manage_learning':
      return ['super_admin', 'team_leader', 'department_lead'].includes(role);

    case 'access_finance':
      return ['super_admin', 'team_leader'].includes(role);

    default:
      return false;
  }
}

/** True when the role sits above ordinary membership in the hierarchy. */
export function isLeadershipRole(role: UserRole | undefined): boolean {
  return Boolean(role) && LEADERSHIP_ROLES.includes(role as UserRole);
}

/**
 * Calculates attendance duration in seconds between timestamps
 */
export function calculateAttendanceDuration(
  joinedAtStr: string,
  leftAtStr?: string,
  fallbackSec: number = 0
): number {
  if (!joinedAtStr) return 0;
  const joinTime = new Date(joinedAtStr).getTime();
  if (isNaN(joinTime)) return 0;

  const leaveTime = leftAtStr ? new Date(leftAtStr).getTime() : Date.now();
  if (isNaN(leaveTime)) return fallbackSec;

  const seconds = Math.floor((leaveTime - joinTime) / 1000);
  return seconds > 0 ? seconds : 0;
}

/**
 * Validates first-time administrator provisioning request
 */
export function validateFirstTimeSetupPayload(
  payload: {
    email?: string;
    password?: string;
    fullName?: string;
    organizationName?: string;
    setupSecret?: string;
  },
  expectedSecret?: string
): { isValid: boolean; error?: string } {
  if (!payload.email || !payload.email.includes('@')) {
    return { isValid: false, error: 'A valid email address is required' };
  }
  if (!payload.password || payload.password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!payload.fullName || payload.fullName.trim().length < 2) {
    return { isValid: false, error: 'Full name is required' };
  }
  if (!payload.organizationName || payload.organizationName.trim().length < 2) {
    return { isValid: false, error: 'Workspace organization name is required' };
  }
  if (expectedSecret && payload.setupSecret !== expectedSecret) {
    return { isValid: false, error: 'Invalid first-time setup provisioning secret' };
  }
  return { isValid: true };
}

/**
 * Calculates project budget utilization from real financial records
 */
export function calculateProjectBudgetStats(
  allocated: number,
  expenses: { amount: number; is_approved: boolean }[]
): { totalSpent: number; remaining: number; percentUsed: number } {
  const safeAllocated = Number(allocated) || 0;
  if (!expenses || expenses.length === 0) {
    return { totalSpent: 0, remaining: safeAllocated, percentUsed: 0 };
  }

  const totalSpent = expenses
    .filter((e) => e.is_approved)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const remaining = safeAllocated - totalSpent;
  const percentUsed = safeAllocated > 0 ? Math.min(100, Math.round((totalSpent / safeAllocated) * 100)) : 0;

  return { totalSpent, remaining, percentUsed };
}
