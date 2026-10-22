import { colors } from '../../output';
import type { DoctorFinding, DoctorReport, DoctorSeverity } from '../../services';

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
    for (const finding of group) lines.push(...renderFindingLines(finding));
    lines.push('');
  }
  const { errors, warnings, info } = report.summary;
  lines.push(`${renderPlural(errors, 'error')}, ${renderPlural(warnings, 'warning')}, ${info} info`);
  const fixable = report.findings.filter((f) => f.fixable).length;
  if (fixable > 0)
    lines.push(colors.dim(`hint: run \`rowbly doctor --fix\` to fix ${renderPlural(fixable, 'finding')}`));
  return lines.join('\n');
}

function renderFindingLines(finding: DoctorFinding): string[] {
  const lines = [`  ${finding.code}  ${finding.path}${finding.fixable ? colors.dim(' (fixable)') : ''}`];
  lines.push(`    ${finding.message}`);
  if (typeof finding.details?.hint === 'string') lines.push(colors.dim(`    hint: ${finding.details.hint}`));
  return lines;
}

function renderPlural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
