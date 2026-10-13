import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP04 replaces this file.
export function registerStages(program: Command): void {
  const stages = program.command('stages').description('Manage the Stages of a Board');
  stubVerb(stages, 'list', 'List Stages', 'WP04');
  stubVerb(stages, 'add <key>', 'Add a Stage', 'WP04');
  stubVerb(stages, 'edit <key>', 'Edit a Stage', 'WP04');
  stubVerb(stages, 'move <key>', 'Move a Stage', 'WP04');
  stubVerb(stages, 'remove <key>', 'Remove a Stage', 'WP04');
}
