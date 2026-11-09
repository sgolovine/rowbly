import type { Command } from "commander";
import { doctor } from "../../services/doctor/doctor.js";
import { run } from "../output/output.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check that stories and stage files line up with the project config")
    .option("--fix", "apply every available fix")
    .action((opts: { fix?: boolean }, command: Command) =>
      run(
        command,
        async (ctx) => {
          const report = await doctor({ fix: opts.fix }, ctx);
          if (!report.ok) process.exitCode = 1;
          return report;
        },
        (report) => {
          if (report.issues.length === 0) return "No problems found.";
          const lines = report.issues.map((issue) => {
            const status = issue.fixed ? "fixed" : issue.severity;
            const fix = issue.fix && !issue.fixed ? ` (fix: ${issue.fix})` : "";
            return `${status.padEnd(7)} ${issue.file}: ${issue.message}${fix}`;
          });
          const fixable = report.issues.filter((issue) => issue.fix && !issue.fixed).length;
          if (fixable > 0) lines.push("", `Run \`rowbly doctor --fix\` to fix ${fixable} of them.`);
          return lines.join("\n");
        },
      ),
    );
}
