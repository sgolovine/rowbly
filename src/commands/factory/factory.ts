import { resolve } from "node:path";
import type { Command } from "commander";
import { ConflictError } from "../../services/errors/errors.js";
import {
  getFactoryLogs,
  getFactoryStatus,
  restartFactory,
  startFactory,
  stopFactory,
} from "../../services/factory/factory.js";
import { configureFactory, type ModelChoice } from "../../services/factory-settings/factory-settings.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { type LaunchDescriptor, runFactoryForeground } from "../factory-runner/factory-runner.js";
import { parseInteger, parsePosition, run } from "../output/output.js";
import { registerCheckCommands } from "./factory-check.js";

interface ConfigureOptions {
  maxWorkers?: number;
  supervisor?: string;
  worker?: string;
  supervisorThinking?: ModelChoice["thinkingLevel"];
  workerThinking?: ModelChoice["thinkingLevel"];
  stage?: string;
  story?: string;
  clearWorker?: boolean;
  commitMessage?: string;
  commitAuthor?: string;
  gitPush?: boolean;
  gitPull?: boolean;
  gitSyncInterval?: number;
  maxChecks?: number;
  checkMemoryReserve?: number;
}

interface StartOptions {
  foreground?: boolean;
  maxWorkers?: number;
  adoptExternal?: boolean;
}

/** The status of the daemon. A status that Rowbly cannot read is an error, so that the exit code is 1. */
async function availableStatus(ctx: ServiceContext): Promise<Awaited<ReturnType<typeof getFactoryStatus>>> {
  const status = await getFactoryStatus(ctx);

  if (status.phase === "unavailable") {
    throw new ConflictError(status.error ?? "Factory status is unavailable");
  }

  return status;
}

function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show native factory status")
    .action((_opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => availableStatus(ctx),
        (status) => JSON.stringify(status, null, 2),
      ),
    );
}

function registerRun(program: Command): void {
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
}

function registerStop(program: Command): void {
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
}

function registerRestart(program: Command, launch: LaunchDescriptor): void {
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
}

function registerLogs(program: Command): void {
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
}

function registerStart(program: Command, launch: LaunchDescriptor): void {
  program
    .command("start")
    .description("Start the native factory")
    .option("--adopt-external", "adopt stopped external attempts")
    .option("--foreground", "run in this terminal")
    .option("--max-workers <n>", "worker limit", parsePosition)
    .action((opts: StartOptions, command: Command) =>
      run(
        command,
        async (ctx) => (opts.foreground ? runFactoryForeground(opts, ctx) : startFactory({ ...opts, launch }, ctx)),
        (status) => JSON.stringify(status),
      ),
    );
}

function registerConfigure(program: Command): void {
  program
    .command("configure")
    .description(
      "Set factory models, worker limit, worker model overrides, Git commit settings, Git sync and check limits",
    )
    .option("--max-workers <n>", "worker limit", parsePosition)
    .option("--supervisor <model>", "provider/model")
    .option("--worker <model>", "provider/model")
    .option("--supervisor-thinking <level>", "supported thinking level")
    .option("--worker-thinking <level>", "supported thinking level")
    .option("--stage <key>", "set the worker model override of this Stage")
    .option("--story <id>", "with --stage, set the override of this Story in the Stage")
    .option("--clear-worker", "with --stage, remove the worker model override")
    .option("--commit-message <text>", 'subject of the canonical commits ("" clears it)')
    .option("--commit-author <identity>", 'Name <email> of the canonical commits ("" clears it)')
    .option("--git-push", "push the canonical branch at each sync")
    .option("--no-git-push", "do not push the canonical branch")
    .option("--git-pull", "pull the upstream at each sync")
    .option("--no-git-pull", "do not pull the upstream")
    .option("--git-sync-interval <seconds>", "seconds between syncs, 60 to 86400", parseInteger)
    .option("--max-checks <n>", "checks that run at the same time, 1 to 32", parseInteger)
    .option("--check-memory-reserve <mb>", "memory that the check queue always keeps free", parseInteger)
    .action((opts: ConfigureOptions, cmd: Command) =>
      run(
        cmd,
        (ctx) => configureFactory(opts, ctx),
        (settings) => JSON.stringify(settings, null, 2),
      ),
    );
}

/** Registers the `rowbly factory` subcommands on the `factory` command. */
export function registerFactoryCommands(program: Command): void {
  // A detached daemon starts with the same Node, loader flags and entry file as this process.
  const launch = {
    executable: process.execPath,
    execArgv: [...process.execArgv],
    entry: resolve(process.argv[1] as string),
  };

  registerStatus(program);
  registerRun(program);
  registerStop(program);
  registerRestart(program, launch);
  registerLogs(program);
  registerStart(program, launch);
  registerConfigure(program);
  registerCheckCommands(program);
}
