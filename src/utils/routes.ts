import type { UserRole } from '../types/database.ts';

/**
 * Sam_Teck Hub: role-aware workspace + route model.
 *
 * The app deliberately does not pull in a router dependency — it already
 * sniffs `window.location.pathname` for /meet/:slug and /invite/:token.
 * This module extends that convention with real, shareable URLs of the form
 * `/{workspace}/{tab}` and centralises every access decision in one pure,
 * unit-testable place.
 *
 * Security note: this gates *navigation* only. Data access is enforced by
 * Postgres RLS, so editing the URL can never reveal another user's records.
 */

export type WorkspaceId = 'workspace' | 'manager' | 'leadership' | 'admin';

/** Every navigable section in the application (legacy shell + member workspace). */
export type NavigationTab =
  | 'dashboard'
  | 'projects'
  | 'meet'
  | 'members'
  | 'innovation'
  | 'learning'
  | 'business'
  | 'reports'
  | 'documents'
  | 'admin'
  // Member Workspace ("My Workspace") sections
  | 'tasks'
  | 'meetings'
  | 'messages'
  | 'notifications'
  | 'profile'
  | 'help';

export interface WorkspaceMeta {
  id: WorkspaceId;
  label: string;
  shortLabel: string;
  /** Where the user lands on `/` — used for the post-login redirect. */
  defaultTab: NavigationTab;
  /** Sections rendered in the member sidebar/chrome. */
  isMemberWorkspace: boolean;
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceMeta> = {
  workspace: {
    id: 'workspace',
    label: 'My Workspace',
    shortLabel: 'Workspace',
    defaultTab: 'dashboard',
    isMemberWorkspace: true,
  },
  manager: {
    id: 'manager',
    label: 'Project Manager Workspace',
    shortLabel: 'Manager',
    defaultTab: 'dashboard',
    isMemberWorkspace: false,
  },
  leadership: {
    id: 'leadership',
    label: 'Leadership Workspace',
    shortLabel: 'Leadership',
    defaultTab: 'dashboard',
    isMemberWorkspace: false,
  },
  admin: {
    id: 'admin',
    label: 'Administration Portal',
    shortLabel: 'Admin',
    defaultTab: 'dashboard',
    isMemberWorkspace: false,
  },
};

/** Member Workspace navigation, in display order. */
export const MEMBER_TABS: NavigationTab[] = [
  'dashboard',
  'tasks',
  'projects',
  'meetings',
  'messages',
  'innovation',
  'learning',
  'documents',
  'notifications',
  'profile',
  'help',
];

/** The legacy management shell — Admin Portal / Leadership / Manager. */
const SHELL_TABS: NavigationTab[] = [
  'dashboard',
  'projects',
  'meet',
  'members',
  'innovation',
  'learning',
  'business',
  'reports',
  'documents',
];

const MANAGER_TABS: NavigationTab[] = [
  'dashboard',
  'projects',
  'meet',
  'innovation',
  'learning',
  'documents',
  'messages',
  'notifications',
];

const LEADERSHIP_TABS: NavigationTab[] = [...SHELL_TABS, 'admin', 'messages', 'notifications'];

const ADMIN_TABS: NavigationTab[] = [...SHELL_TABS, 'admin', 'messages', 'notifications'];

/** Tab label + icon-free metadata used by both sidebars. */
export const TAB_LABELS: Record<NavigationTab, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  meet: 'Sam_Teck Meet',
  members: 'Team & Members',
  innovation: 'Innovation Lab',
  learning: 'Learning Centre',
  business: 'Business & Ops',
  reports: 'Reports & Audit',
  documents: 'Documents',
  admin: 'Administration',
  tasks: 'My Tasks',
  meetings: 'Meetings',
  messages: 'Messages & Announcements',
  notifications: 'Notifications',
  profile: 'My Profile',
  help: 'Help & Support',
};

const ADMIN_ROLES: UserRole[] = ['super_admin', 'team_leader'];

/**
 * Which workspaces the signed-in role may enter.
 * Derived from the trusted role loaded from organization_memberships —
 * never from localStorage, query strings, or editable client state.
 */
export function workspacesForRole(role: UserRole | null | undefined): WorkspaceId[] {
  switch (role) {
    case 'super_admin':
      return ['admin', 'leadership', 'manager', 'workspace'];
    case 'team_leader':
      return ['leadership', 'admin', 'manager', 'workspace'];
    case 'assistant_leader':
      return ['leadership', 'manager', 'workspace'];
    case 'project_manager':
      return ['manager', 'workspace'];
    case 'department_lead':
      return ['manager', 'workspace'];
    case 'team_member':
    case 'guest':
      return ['workspace'];
    default:
      return [];
  }
}

/** Workspace a role lands in after login (Section 15 route behaviour). */
export function defaultWorkspaceForRole(role: UserRole | null | undefined): WorkspaceId {
  switch (role) {
    case 'super_admin':
      return 'admin';
    case 'team_leader':
    case 'assistant_leader':
      return 'leadership';
    case 'project_manager':
    case 'department_lead':
      return 'manager';
    case 'team_member':
    case 'guest':
      return 'workspace';
    default:
      return 'workspace';
  }
}

export function canAccessWorkspace(role: UserRole | null | undefined, workspace: WorkspaceId): boolean {
  return workspacesForRole(role).includes(workspace);
}

/**
 * Sections a workspace exposes. The Administration entry is additionally
 * gated by role so a leadership user without admin rights never sees it.
 */
export function allowedTabs(workspace: WorkspaceId, role: UserRole | null | undefined): NavigationTab[] {
  let tabs: NavigationTab[];
  switch (workspace) {
    case 'workspace':
      tabs = [...MEMBER_TABS];
      break;
    case 'manager':
      tabs = [...MANAGER_TABS];
      break;
    case 'leadership':
      tabs = [...LEADERSHIP_TABS];
      break;
    case 'admin':
      tabs = [...ADMIN_TABS];
      break;
    default:
      tabs = [];
  }

  // The Administration entry is offered only to roles that hold the
  // `access_admin_portal` permission, so a leadership user without it never
  // sees a link it cannot follow.
  return tabs.filter((tab) => tab !== 'admin' || ADMIN_ROLES.includes(role as UserRole));
}

export function canAccessTab(
  workspace: WorkspaceId,
  tab: NavigationTab,
  role: UserRole | null | undefined
): boolean {
  if (tab === 'admin' && !ADMIN_ROLES.includes(role as UserRole)) return false;
  if (workspace === 'workspace' && !MEMBER_TABS.includes(tab)) return false;
  return allowedTabs(workspace, role).includes(tab);
}

export function pathFor(workspace: WorkspaceId, tab: NavigationTab): string {
  return `/${workspace}/${tab}`;
}

export function landingPath(role: UserRole | null | undefined): string {
  const ws = defaultWorkspaceForRole(role);
  return pathFor(ws, WORKSPACES[ws].defaultTab);
}

export type ParsedLocation =
  | { kind: 'root' }
  | { kind: 'invite'; token: string }
  | { kind: 'meet'; slug: string }
  | { kind: 'route'; workspace: WorkspaceId; tab: NavigationTab };

const WORKSPACE_IDS = Object.keys(WORKSPACES) as WorkspaceId[];
const ALL_TABS = Object.keys(TAB_LABELS) as NavigationTab[];

/**
 * Turns a raw pathname into a navigation intent.
 * Unknown paths resolve to `root` so callers can redirect rather than crash.
 */
export function parsePath(pathname: string): ParsedLocation {
  const clean = (pathname || '/').split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);

  if (parts.length === 0) return { kind: 'root' };

  // Legacy deep links must keep working: /meet/:slug and /invite/:token
  if (parts[0] === 'meet' && parts[1]) return { kind: 'meet', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'invite' && parts[1]) return { kind: 'invite', token: decodeURIComponent(parts[1]) };

  if (parts.length >= 2) {
    const [ws, tab] = parts;
    if ((WORKSPACE_IDS as string[]).includes(ws) && (ALL_TABS as string[]).includes(tab)) {
      return { kind: 'route', workspace: ws as WorkspaceId, tab: tab as NavigationTab };
    }
  }

  return { kind: 'root' };
}

/**
 * Resolves a parsed location into a workspace/tab pair the role may actually
 * use, falling back to that role's landing page when it may not.
 */
export function resolveRoute(
  parsed: ParsedLocation,
  role: UserRole | null | undefined
): { workspace: WorkspaceId; tab: NavigationTab } {
  const fallbackWs = defaultWorkspaceForRole(role);
  const fallbackTab = WORKSPACES[fallbackWs].defaultTab;

  if (parsed.kind === 'meet') {
    // Deep link into a meeting: land in the role's own shell on the meetings tab.
    const member = fallbackWs === 'workspace';
    const tab: NavigationTab = member ? 'meetings' : 'meet';
    return canAccessTab(fallbackWs, tab, role) ? { workspace: fallbackWs, tab } : { workspace: fallbackWs, tab: fallbackTab };
  }

  if (parsed.kind !== 'route') {
    return { workspace: fallbackWs, tab: fallbackTab };
  }

  if (!canAccessWorkspace(role, parsed.workspace)) {
    return { workspace: fallbackWs, tab: fallbackTab };
  }
  if (!canAccessTab(parsed.workspace, parsed.tab, role)) {
    return { workspace: parsed.workspace, tab: fallbackTab };
  }
  return { workspace: parsed.workspace, tab: parsed.tab };
}

/**
 * Keeps a tab valid when the user switches workspaces, so the switcher never
 * navigates to a section the target workspace does not expose.
 */
export function tabAfterWorkspaceSwitch(
  target: WorkspaceId,
  currentTab: NavigationTab,
  role: UserRole | null | undefined
): NavigationTab {
  if (canAccessTab(target, currentTab, role)) return currentTab;
  return WORKSPACES[target].defaultTab;
}
