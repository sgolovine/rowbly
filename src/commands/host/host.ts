import { resolve } from "node:path";
import { text as streamText } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import type { FactoryLaunch } from "../../services/factory/factory-launch.js";
import { type AddedHost, addHost, type Host, listHosts, removeHost } from "../../services/host/host.js";
import { runHostAgent } from "../../services/host-agent/host-agent.js";
import { submitHostCommand } from "../../services/host-agent/host-agent-control.js";
import { startHostAgent } from "../../services/host-agent/host-agent-launch.js";
import { hostAgentPaths } from "../../services/host-agent/host-agent-paths.js";
import { runHostAttach } from "../../services/host-agent/host-attach.js";
import { readOutboxBlob } from "../../services/outbox/outbox-file.js";
import { run, runBytes, runQuiet } from "../output/output.js";

function describe(host: Host): string {
  const state = host.enabled ? "on" : "off";

  return `${host.id}  ${host.ssh}  ${host.maxWorkers} worker(s)  ${state}`;
}

function addedText(host: AddedHost): string {
  const action = host.install.installed ? "installed" : "found";

  return `Added worker host ${describe(host)}\nRowbly ${host.install.buildId} ${action} at ${host.install.remoteExecutable}`;
}

function listText(hosts: readonly Host[]): string {
  return hosts.length === 0 ? "No worker hosts." : hosts.map(describe).join("\n");
}

/** Reads one JSON value from stdin. Text that is not JSON gives a ValidationError. */
async function readJsonInput(): Promise<unknown> {
  const input = await streamText(process.stdin);

  try {
    return JSON.parse(input);
  } catch {
    throw new ValidationError("The input on stdin must be one JSON value");
  }
}

/** A signal handler that requests a stop. The same function must go to `process.on` and `process.off`. */
function abortOnSignal(controller: AbortController): () => void {
  return () => controller.abort();
}

/** Runs the host agent of the Project. `SIGTERM` and `SIGINT` stop it. */
async function serveAgent(projectId: string | undefined) {
  if (projectId === undefined) {
    throw new ValidationError("A project id is necessary without --detach");
  }

  const controller = new AbortController();
  const stop = abortOnSignal(controller);

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    return await runHostAgent({ projectId, signal: controller.signal });
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

/** Registers the hidden commands that the main machine runs on a worker host over SSH. The output is JSON. */
function registerHostAgentCommands(program: Command, launch: FactoryLaunch): void {
  program
    .command("serve [project-id]", { hidden: true })
    .option("--detach", "start a detached host agent with the JSON input on stdin")
    .action((projectId: string | undefined, opts: { detach?: boolean }, command: Command) =>
      opts.detach
        ? run(
            command,
            async () => startHostAgent(await readJsonInput(), { launch }),
            (result) => JSON.stringify(result),
          )
        : run(
            command,
            () => serveAgent(projectId),
            (result) => JSON.stringify(result),
          ),
    );

  program
    .command("submit <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      run(
        command,
        async () => submitHostCommand(hostAgentPaths(projectId), await streamText(process.stdin)),
        (receipt) => JSON.stringify(receipt),
      ),
    );

  program
    .command("attach <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runQuiet(command, () =>
        runHostAttach({ projectId, input: process.stdin, write: (line) => void process.stdout.write(line) }),
      ),
    );
}

/** Registers the `rowbly host` subcommands on the `host` command. The commands do not need a Project. */
export function registerHostCommands(program: Command): void {
  program
    .command("add <id>")
    .description("Check Node, install this Rowbly version on a worker host, and record it in ~/.rowblyrc.json")
    .requiredOption("--ssh <target>", "SSH target of the host, e.g. user@mini.lan")
    .requiredOption("--max-workers <n>", "largest number of workers on the host at one time")
    .action((id: string, opts: { ssh: string; maxWorkers: string }, command: Command) =>
      run(
        command,
        // The service checks the number, so a bad value gives a VALIDATION error.
        (ctx) => addHost({ id, ssh: opts.ssh, maxWorkers: Number(opts.maxWorkers) }, ctx),
        addedText,
      ),
    );

  program
    .command("list")
    .description("List the worker hosts")
    .action((_opts: unknown, command: Command) => run(command, (ctx) => listHosts(ctx), listText));

  program
    .command("remove <id>")
    .description("Remove a worker host; refused while a Thread is active on it")
    .option("--purge", "also remove the clone and the worktrees on the host")
    .action((id: string, opts: { purge?: boolean }, command: Command) =>
      run(
        command,
        (ctx) => removeHost({ id, purge: opts.purge === true }, ctx),
        (host) => `Removed worker host ${host.id}`,
      ),
    );

  // The main machine runs this command over SSH to get the PNG of an `attachment.add` entry.
  program
    .command("blob <sha256>", { hidden: true })
    .action((sha256: string, _opts: unknown, command: Command) =>
      runBytes(command, () => readOutboxBlob({ dir: process.env.ROWBLY_OUTBOX, sha256 })),
    );

  // A detached agent starts with the same Node, loader flags and entry file as this process.
  registerHostAgentCommands(program, {
    executable: process.execPath,
    execArgv: [...process.execArgv],
    entry: resolve(process.argv[1] as string),
  });
}
