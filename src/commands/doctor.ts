import type { Command } from 'commander';

// Stub: WP10 replaces this file.
export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the Data Root for problems and optionally fix them')
    .allowUnknownOption()
    .action(() => {
      throw new Error('not implemented: WP10');
    });
}
