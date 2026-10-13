import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP05 replaces this file.
export function registerStories(program: Command): void {
  const stories = program.command('stories').description('Manage Stories on a Board');
  stubVerb(stories, 'list', 'List Stories', 'WP05');
  stubVerb(stories, 'create', 'Create a Story', 'WP05');
  stubVerb(stories, 'show <key>', 'Show a Story', 'WP05');
  stubVerb(stories, 'edit <key>', 'Edit a Story', 'WP05');
  stubVerb(stories, 'move <key> <stage>', 'Move a Story to another Stage', 'WP05');
  stubVerb(stories, 'rank <key>', 'Change the Rank of a Story within its Stage', 'WP05');
  stubVerb(stories, 'delete <key>', 'Delete a Story', 'WP05');
}
