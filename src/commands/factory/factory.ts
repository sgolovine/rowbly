import { resolve } from "node:path";
import type { Command } from "commander";
import {
  getFactoryLogs,
  getFactoryStatus,
  restartFactory,
  startFactory,
  stopFactory,
} from "../../services/factory/factory.js";
import { configureFactory, type ModelChoice } from "../../services/factorySettings/factorySettings.js";
import { runFactoryForeground } from "../factoryRunner/factoryRunner.js";
import { parsePosition, run } from "../output/output.js";

export function registerFactoryCommands(program: Command) {
  program
    .command("status")
    .description("Show native factory status")
    .action((_opts: unknown, command: Command) =>
      run(command, getFactoryStatus, (status) => JSON.stringify(status, null, 2)),
    );
  const launch = {
    executable: process.execPath,
    execArgv: [...process.execArgv],
    entry: resolve(process.argv[1] as string),
  };
  program
    .command("run", { hidden: true })
    .option("--max-workers <n>", "worker limit", parsePosition)
    .option("--adopt-external", "adopt stopped external attempts")
    .action((opts, command) =>
      run(
        command,
        (ctx) => runFactoryForeground(opts, ctx),
        () => "Factory stopped.",
      ),
    );
  program
    .command("stop")
    .description("Stop the native factory")
    .action((_opts, command) =>
      run(
        command,
        (ctx) => stopFactory({}, ctx),
        () => "Factory stopped.",
      ),
    );
  program
    .command("restart")
    .description("Restart the native factory")
    .option("--adopt-external", "adopt stopped external attempts")
    .action((opts, command) =>
      run(
        command,
        (ctx) => restartFactory({ launch, ...opts }, ctx),
        (status) => JSON.stringify(status),
      ),
    );
  program
    .command("logs")
    .description("Print bounded factory logs")
    .option("--tail <n>", "number of lines", parsePosition, 20)
    .action((opts, command) =>
      run(
        command,
        (ctx) => getFactoryLogs(opts, ctx),
        (result) => result.lines.join("\n"),
      ),
    );
  program
    .command("start")
    .description("Start the native factory")
    .option("--adopt-external", "adopt stopped external attempts")
    .option("--foreground", "run in this terminal")
    .option("--max-workers <n>", "worker limit", parsePosition)
    .action((opts: { foreground?: boolean; maxWorkers?: number; adoptExternal?: boolean }, command: Command) =>
      run(
        command,
        async (ctx) => {
          return opts.foreground ? runFactoryForeground(opts, ctx) : startFactory({ ...opts, launch }, ctx);
        },
        (status) => JSON.stringify(status),
      ),
    );
  program
    .command("configure")
    .description("Set factory models and worker limit")
    .option("--max-workers <n>", "worker limit", parsePosition)
    .option("--supervisor <model>", "provider/model")
    .option("--worker <model>", "provider/model")
    .option("--supervisor-thinking <level>", "supported thinking level")
    .option("--worker-thinking <level>", "supported thinking level")
    .action(
      (
        opts: {
          maxWorkers?: number;
          supervisor?: string;
          worker?: string;
          supervisorThinking?: ModelChoice["thinkingLevel"];
          workerThinking?: ModelChoice["thinkingLevel"];
        },
        cmd: Command,
      ) =>
        run(
          cmd,
          (ctx) => configureFactory(opts, ctx),
          (settings) => JSON.stringify(settings, null, 2),
        ),
    );
}
