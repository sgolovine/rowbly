import type { Command } from 'commander';
import { ExitCode } from '../core';
import { colors, printResult } from '../output';
import type { DoctorFinding, DoctorReport, DoctorSeverity } from '../services';
import { withContext } from './_shared';

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

const SECTIONS: { severity: DoctorSeverity; title: string; color: (text: string) => string }[] = [
  { severity: 'error', title: 'Errors', color: colors.red },
  { severity: 'warning', title: 'Warnings', color: colors.yellow },
  { severity: 'info', title: 'Info', color: colors.dim },
];

/** Fixes, then findings grouped by severity, a summary line and a `--fix` hint. */
export function renderReport(report: DoctorReport): string {
  const lines: string[] = [];
  if (report.fixed.length > 0) {
    lines.push(colors.green(`Fixed (${report.fixed.length})`));
    for (const fix of report.fixed) lines.push(`  ${fix.code}  ${fix.path}`, `    ${fix.message}`);
    lines.push('');
  }
  if (report.findings.length === 0) {
    lines.push(colors.green('No problems found'));
    return lines.join('\n');
  }
  for (const { severity, title, color } of SECTIONS) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(color(`${title} (${group.length})`));
    for (const finding of group) lines.push(...findingLines(finding));
    lines.push('');
  }
  const { errors, warnings, info } = report.summary;
  lines.push(`${plural(errors, 'error')}, ${plural(warnings, 'warning')}, ${info} info`);
  const fixable = report.findings.filter((f) => f.fixable).length;
  if (fixable > 0) lines.push(colors.dim(`hint: run \`rowbly doctor --fix\` to fix ${plural(fixable, 'finding')}`));
  return lines.join('\n');
}

function findingLines(finding: DoctorFinding): string[] {
  const lines = [`  ${finding.code}  ${finding.path}${finding.fixable ? colors.dim(' (fixable)') : ''}`];
  lines.push(`    ${finding.message}`);
  if (typeof finding.details?.hint === 'string') lines.push(colors.dim(`    hint: ${finding.details.hint}`));
  return lines;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
