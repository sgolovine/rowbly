import type { Command } from 'commander';
import { ExitCode } from '../../core';
import { printResult } from '../../output';
import { withContext } from '../shared';
import { renderReport } from './render';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the Data Root for problems and optionally fix them')
    .option('--fix', 'repair the problems that can be fixed safely (merge damage, stale references)')
    .addHelpText(
      'after',
      '\nExits 0 when no errors remain and 6 when errors remain (after fixes, with --fix).\n' +
        'Run it after merging a branch that changed the Data Root.',
    )
    .action(async (opts: { fix?: boolean }, cmd: Command) => {
      await withContext(cmd, async ({ services, globals }) => {
        const report = opts.fix ? await services.doctor.fix() : await services.doctor.check();
        printResult(report, { json: globals.json, human: renderReport });
        if (report.summary.errors > 0) process.exitCode = ExitCode.dataIntegrity;
      });
    });
}
