import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP04 replaces this file.
export function registerFields(program: Command): void {
  const fields = program.command('fields').description('Manage the Custom Fields of a Board');
  stubVerb(fields, 'list', 'List Custom Fields', 'WP04');
  stubVerb(fields, 'add <key>', 'Add a Custom Field', 'WP04');
  stubVerb(fields, 'edit <key>', 'Edit a Custom Field', 'WP04');
  stubVerb(fields, 'remove <key>', 'Remove a Custom Field', 'WP04');
}
