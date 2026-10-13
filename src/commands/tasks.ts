import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP06 replaces this file.
export function registerTasks(program: Command): void {
  const tasks = program.command('tasks').description('Manage the Tasks of a Story');
  stubVerb(tasks, 'list <key>', 'List the Tasks of a Story', 'WP06');
  stubVerb(tasks, 'create <key>', 'Create a Task', 'WP06');
  stubVerb(tasks, 'show <task-id>', 'Show a Task', 'WP06');
  stubVerb(tasks, 'edit <task-id>', 'Edit a Task', 'WP06');
  stubVerb(tasks, 'move <task-id> <stage>', 'Move a Task to another Stage', 'WP06');
  stubVerb(tasks, 'delete <task-id>', 'Delete a Task', 'WP06');
}
