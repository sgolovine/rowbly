import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP06 replaces this file.
export function registerComments(program: Command): void {
  const comments = program.command('comments').description('Manage Comments on a Story or Task');
  stubVerb(comments, 'list <target>', 'List Comments', 'WP06');
  stubVerb(comments, 'add <target>', 'Add a Comment', 'WP06');
  stubVerb(comments, 'edit <target> <comment-id>', 'Edit a Comment', 'WP06');
  stubVerb(comments, 'delete <target> <comment-id>', 'Delete a Comment', 'WP06');
}
