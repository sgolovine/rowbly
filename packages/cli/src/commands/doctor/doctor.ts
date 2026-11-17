import type { Command } from "commander";
import { type DoctorIssue, type DoctorReport, doctor } from "../../services/doctor/doctor.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { run, setExitCode } from "../output/output.js";

/** Runs the checks. A report with problems sets exit code 1, also with `--json`. */
async function runDoctor(fix: boolean | undefined, ctx: ServiceContext): Promise<DoctorReport> {
  const report = await doctor({ fix }, ctx);

  if (!report.ok) {
    setExitCode(1);
  }

  return report;
}

function issueLine(issue: DoctorIssue): string {
  const status = issue.fixed ? "fixed" : issue.severity;
  const fix = issue.fix && !issue.fixed ? ` (fix: ${issue.fix})` : "";

  return `${status.padEnd(7)} ${issue.file}: ${issue.message}${fix}`;
}

function reportText(report: DoctorReport): string {
  if (report.issues.length === 0) {
    return "No problems found.";
  }

  const fixable = report.issues.filter((issue) => issue.fix && !issue.fixed).length;
  const footer = fixable > 0 ? ["", `Run \`rowbly doctor --fix\` to fix ${fixable} of them.`] : [];

  return [...report.issues.map((issue) => issueLine(issue)), ...footer].join("\n");
}

/** Registers `rowbly doctor`. */
export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check that stories and stage files line up with the project config")
    .option("--fix", "apply every available fix")
    .action((opts: { fix?: boolean }, command: Command) =>
      run(
        command,
        (ctx) => runDoctor(opts.fix, ctx),
        (report) => reportText(report),
      ),
    );
}
