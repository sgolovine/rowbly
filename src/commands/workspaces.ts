import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP03 replaces this file.
export function registerWorkspaces(program: Command): void {
  const workspaces = program.command('workspaces').description('Manage Workspaces');
  stubVerb(workspaces, 'list', 'List Workspaces', 'WP03');
  stubVerb(workspaces, 'create <id>', 'Create a Workspace', 'WP03');
  stubVerb(workspaces, 'show [id]', 'Show a Workspace', 'WP03');
  stubVerb(workspaces, 'edit <id>', 'Edit a Workspace', 'WP03');
  stubVerb(workspaces, 'delete <id>', 'Delete a Workspace', 'WP03');
}
