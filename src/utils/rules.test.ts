import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTaskProgress,
  filterOverdueTasks,
  isTaskDueSoon,
  checkRolePermission,
  calculateAttendanceDuration,
  validateFirstTimeSetupPayload,
  calculateProjectBudgetStats,
} from './rules.ts';

test('calculateTaskProgress returns 0 for empty task array', () => {
  assert.equal(calculateTaskProgress([]), 0);
});

test('calculateTaskProgress calculates accurate percentage from real tasks', () => {
  const tasks = [
    { status: 'done' },
    { status: 'in_progress' },
    { status: 'done' },
    { status: 'todo' },
  ];
  assert.equal(calculateTaskProgress(tasks), 50);

  const allDone = [{ status: 'done' }, { status: 'done' }];
  assert.equal(calculateTaskProgress(allDone), 100);
});

test('filterOverdueTasks identifies only overdue uncompleted tasks', () => {
  const refDate = '2026-10-16T12:00:00Z';
  const tasks = [
    { id: '1', status: 'in_progress', due_date: '2026-10-10' }, // overdue
    { id: '2', status: 'done', due_date: '2026-10-10' }, // done -> not overdue
    { id: '3', status: 'todo', due_date: '2026-10-20' }, // future -> not overdue
    { id: '4', status: 'blocked' }, // no due date -> not overdue
  ];

  const overdue = filterOverdueTasks(tasks, refDate);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].id, '1');
});

test('isTaskDueSoon identifies dates within the threshold window', () => {
  const ref = '2026-10-16T10:00:00Z';
  assert.equal(isTaskDueSoon('2026-10-18', ref, 3), true);
  assert.equal(isTaskDueSoon('2026-10-25', ref, 3), false);
  assert.equal(isTaskDueSoon(undefined, ref, 3), false);
});

test('checkRolePermission grants access based on authorized role hierarchy', () => {
  assert.equal(checkRolePermission('super_admin', 'manage_system'), true);
  assert.equal(checkRolePermission('team_leader', 'manage_system'), false);
  assert.equal(checkRolePermission('team_leader', 'create_project'), true);
  assert.equal(checkRolePermission('project_manager', 'create_project'), true);
  assert.equal(checkRolePermission('team_member', 'create_project'), false);
  assert.equal(checkRolePermission('team_member', 'manage_meeting'), true);
  assert.equal(checkRolePermission('guest', 'manage_meeting'), false);
});

test('calculateAttendanceDuration computes accurate seconds', () => {
  const join = '2026-10-16T10:00:00Z';
  const leave = '2026-10-16T10:30:00Z';
  assert.equal(calculateAttendanceDuration(join, leave), 1800);
});

test('validateFirstTimeSetupPayload enforces email, password length, and secret', () => {
  const valid = validateFirstTimeSetupPayload(
    {
      email: 'admin@samteck.org',
      password: 'StrongPassword123!',
      fullName: 'Chief Administrator',
      organizationName: 'Sam_Teck Innovations',
      setupSecret: 'secret123',
    },
    'secret123'
  );
  assert.equal(valid.isValid, true);

  const weakPassword = validateFirstTimeSetupPayload({
    email: 'admin@samteck.org',
    password: 'short',
    fullName: 'Admin',
    organizationName: 'Org',
  });
  assert.equal(weakPassword.isValid, false);
  assert.match(weakPassword.error || '', /8 characters/);

  const invalidSecret = validateFirstTimeSetupPayload(
    {
      email: 'admin@samteck.org',
      password: 'StrongPassword123!',
      fullName: 'Admin',
      organizationName: 'Org',
      setupSecret: 'wrong',
    },
    'expected'
  );
  assert.equal(invalidSecret.isValid, false);
});

test('calculateProjectBudgetStats calculates expenditures accurately', () => {
  const expenses = [
    { amount: 1500, is_approved: true },
    { amount: 500, is_approved: false }, // unapproved ignored
    { amount: 2500, is_approved: true },
  ];
  const stats = calculateProjectBudgetStats(10000, expenses);
  assert.equal(stats.totalSpent, 4000);
  assert.equal(stats.remaining, 6000);
  assert.equal(stats.percentUsed, 40);
});
