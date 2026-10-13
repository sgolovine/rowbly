import type { Command } from 'commander';
import { stubVerb } from './_stub';

// Stub: WP08 replaces this file.
export function registerSetup(program: Command): void {
  stubVerb(program, 'init', 'Create a Data Root, optionally with a first Workspace and Board', 'WP08');
  stubVerb(program, 'use [target]', 'Show or set the current Workspace and Board', 'WP08');
  stubVerb(program, 'whoami [handle]', 'Show or set Me', 'WP08');
  const config = program.command('config').description('Show configuration');
  stubVerb(config, 'show', 'Show the effective Stages and Custom Fields of a Board', 'WP08');
}
