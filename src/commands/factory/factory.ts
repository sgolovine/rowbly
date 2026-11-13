import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import { getFactoryStatus } from "../../services/factoryManager/factoryManager.js";
import { runFactoryForeground } from "../factoryRunner/factoryRunner.js";
import { parsePosition, run } from "../output/output.js";

export function registerFactoryCommands(program: Command) {
  program
    .command("status")
    .description("Show native factory status")
    .action((_opts: unknown, command: Command) =>
      run(command, getFactoryStatus, (status) => JSON.stringify(status, null, 2)),
    );
  program
    .command("start")
    .description("Run the native factory in the foreground")
    .option("--foreground", "run in this terminal")
    .option("--max-workers <n>", "worker limit", parsePosition)
    .action((opts: { foreground?: boolean; maxWorkers?: number }, command: Command) =>
      run(
        command,
        async (ctx) => {
          if (!opts.foreground)
            throw new ValidationError("Use --foreground. Background execution is not available yet.");
          return runFactoryForeground(opts, ctx);
        },
        () => "Factory stopped.",
      ),
    );
}
