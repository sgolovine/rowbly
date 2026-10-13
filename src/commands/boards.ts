import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP04 replaces this file.
export function registerBoards(program: Command): void {
  const boards = program.command('boards').description('Manage Boards in a Workspace');
  stubVerb(boards, 'list', 'List Boards', 'WP04');
  stubVerb(boards, 'create <id>', 'Create a Board', 'WP04');
  stubVerb(boards, 'show [id]', 'Show a Board', 'WP04');
  stubVerb(boards, 'edit <id>', 'Edit a Board', 'WP04');
  stubVerb(boards, 'delete <id>', 'Delete a Board', 'WP04');
}
