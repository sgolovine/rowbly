import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP03 replaces this file.
export function registerAssignees(program: Command): void {
  const assignees = program.command('assignees').description('Manage the Assignee roster of a Workspace');
  stubVerb(assignees, 'list', 'List Assignees', 'WP03');
  stubVerb(assignees, 'add <handle>', 'Add an Assignee', 'WP03');
  stubVerb(assignees, 'edit <handle>', 'Edit an Assignee', 'WP03');
  stubVerb(assignees, 'remove <handle>', 'Remove an Assignee', 'WP03');
}
