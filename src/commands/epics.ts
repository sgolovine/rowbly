import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP07 replaces this file.
export function registerEpics(program: Command): void {
  const epics = program.command('epics').description('Manage Epics in a Workspace');
  stubVerb(epics, 'list', 'List Epics', 'WP07');
  stubVerb(epics, 'create <id>', 'Create an Epic', 'WP07');
  stubVerb(epics, 'show <id>', 'Show an Epic', 'WP07');
  stubVerb(epics, 'edit <id>', 'Edit an Epic', 'WP07');
  stubVerb(epics, 'close <id>', 'Close an Epic', 'WP07');
  stubVerb(epics, 'reopen <id>', 'Reopen an Epic', 'WP07');
  stubVerb(epics, 'delete <id>', 'Delete an Epic', 'WP07');
}
