import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACES,
  MEMBER_TABS,
  allowedTabs,
  canAccessTab,
  canAccessWorkspace,
  defaultWorkspaceForRole,
  landingPath,
  parsePath,
  pathFor,
  resolveRoute,
  tabAfterWorkspaceSwitch,
  workspacesForRole,
} from './routes.ts';

test('ordinary members only ever get the Member Workspace', () => {
  assert.deepEqual(workspacesForRole('team_member'), ['workspace']);
  assert.deepEqual(workspacesForRole('guest'), ['workspace']);
  assert.equal(canAccessWorkspace('team_member', 'admin'), false);
  assert.equal(canAccessWorkspace('team_member', 'leadership'), false);
  assert.equal(canAccessWorkspace('guest', 'manager'), false);
});

test('leadership and administration access follows the role hierarchy', () => {
  assert.equal(canAccessWorkspace('super_admin', 'admin'), true);
  assert.equal(canAccessWorkspace('super_admin', 'leadership'), true);
  assert.equal(canAccessWorkspace('team_leader', 'admin'), true);
  assert.equal(canAccessWorkspace('project_manager', 'leadership'), false);
  assert.equal(canAccessWorkspace('project_manager', 'admin'), false);
  assert.equal(canAccessWorkspace(undefined, 'workspace'), false);
});

test('login routes each role to its authorised workspace', () => {
  assert.equal(defaultWorkspaceForRole('super_admin'), 'admin');
  assert.equal(defaultWorkspaceForRole('team_leader'), 'leadership');
  assert.equal(defaultWorkspaceForRole('assistant_leader'), 'leadership');
  assert.equal(defaultWorkspaceForRole('project_manager'), 'manager');
  assert.equal(defaultWorkspaceForRole('department_lead'), 'manager');
  assert.equal(defaultWorkspaceForRole('team_member'), 'workspace');
  assert.equal(defaultWorkspaceForRole('guest'), 'workspace');
  assert.equal(landingPath('team_member'), '/workspace/dashboard');
  assert.equal(landingPath('super_admin'), '/admin/dashboard');
});

test('members cannot reach administrative sections by editing the URL', () => {
  assert.equal(canAccessTab('workspace', 'admin', 'team_member'), false);
  assert.equal(canAccessTab('workspace', 'members', 'team_member'), false);
  assert.equal(canAccessTab('workspace', 'reports', 'team_member'), false);
  // The Administration entry stays hidden for non-privileged shell users too.
  assert.equal(canAccessTab('leadership', 'admin', 'assistant_leader'), false);
  assert.equal(canAccessTab('leadership', 'admin', 'team_leader'), true);
  assert.equal(canAccessTab('admin', 'admin', 'super_admin'), true);
});

test('member workspace exposes exactly the eleven required sections', () => {
  const tabs = allowedTabs('workspace', 'team_member');
  assert.deepEqual(tabs, MEMBER_TABS);
  assert.equal(tabs.length, 11);
  assert.deepEqual(
    [...tabs].sort(),
    [
      'dashboard',
      'documents',
      'help',
      'innovation',
      'learning',
      'meetings',
      'messages',
      'notifications',
      'profile',
      'projects',
      'tasks',
    ].sort()
  );
});

test('parsePath understands workspace routes and legacy deep links', () => {
  assert.deepEqual(parsePath('/'), { kind: 'root' });
  assert.deepEqual(parsePath('/workspace/tasks'), { kind: 'route', workspace: 'workspace', tab: 'tasks' });
  assert.deepEqual(parsePath('/admin/dashboard/'), { kind: 'route', workspace: 'admin', tab: 'dashboard' });
  assert.deepEqual(parsePath('/meet/standup-0900'), { kind: 'meet', slug: 'standup-0900' });
  assert.deepEqual(parsePath('/invite/abc123'), { kind: 'invite', token: 'abc123' });
  assert.deepEqual(parsePath('/nonsense'), { kind: 'root' });
  assert.deepEqual(parsePath('/workspace/not-a-tab'), { kind: 'root' });
});

test('resolveRoute redirects unauthorised URLs to the role landing page', () => {
  assert.deepEqual(resolveRoute(parsePath('/admin/dashboard'), 'team_member'), {
    workspace: 'workspace',
    tab: 'dashboard',
  });
  assert.deepEqual(resolveRoute(parsePath('/workspace/tasks'), 'team_member'), {
    workspace: 'workspace',
    tab: 'tasks',
  });
  assert.deepEqual(resolveRoute(parsePath('/workspace/help'), 'super_admin'), {
    workspace: 'workspace',
    tab: 'help',
  });
  assert.deepEqual(resolveRoute(parsePath('/'), 'project_manager'), {
    workspace: 'manager',
    tab: 'dashboard',
  });
  // Tab not offered by an allowed workspace falls back to its dashboard.
  assert.deepEqual(resolveRoute(parsePath('/manager/admin'), 'project_manager'), {
    workspace: 'manager',
    tab: 'dashboard',
  });
});

test('resolveRoute keeps meeting deep links working for every role', () => {
  assert.deepEqual(resolveRoute(parsePath('/meet/weekly-sync'), 'team_member'), {
    workspace: 'workspace',
    tab: 'meetings',
  });
  assert.deepEqual(resolveRoute(parsePath('/meet/weekly-sync'), 'super_admin'), {
    workspace: 'admin',
    tab: 'meet',
  });
});

test('workspace switcher never lands on a section the target lacks', () => {
  assert.equal(tabAfterWorkspaceSwitch('workspace', 'admin', 'super_admin'), 'dashboard');
  assert.equal(tabAfterWorkspaceSwitch('workspace', 'tasks', 'super_admin'), 'tasks');
  assert.equal(tabAfterWorkspaceSwitch('admin', 'tasks', 'super_admin'), 'dashboard');
  assert.equal(tabAfterWorkspaceSwitch('workspace', 'documents', 'team_member'), 'documents');
});

test('pathFor produces shareable URLs for every workspace', () => {
  assert.equal(pathFor('workspace', 'notifications'), '/workspace/notifications');
  assert.equal(pathFor('admin', 'members'), '/admin/members');
  for (const ws of Object.keys(WORKSPACES) as (keyof typeof WORKSPACES)[]) {
    assert.equal(pathFor(ws, WORKSPACES[ws].defaultTab), `/${ws}/dashboard`);
  }
});
