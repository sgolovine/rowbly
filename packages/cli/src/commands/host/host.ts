import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { text as streamText } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import type { FactoryLaunch } from "../../services/factory/factory-launch.js";
import {
  type AddedHost,
  addHost,
  type Host,
  type HostUpdate,
  listHosts,
  removeHost,
  updateHost,
} from "../../services/host/host.js";
import { runHostAgent } from "../../services/host-agent/host-agent.js";
import { submitHostCommand } from "../../services/host-agent/host-agent-control.js";
import { startHostAgent } from "../../services/host-agent/host-agent-launch.js";
import { ensurePrivateDir, hostAgentPaths } from "../../services/host-agent/host-agent-paths.js";
import { runHostAttach } from "../../services/host-agent/host-attach.js";
import { createHostRunner } from "../../services/host-agent/host-runner.js";
import { type CheckItem, checkHost, type HostCheck } from "../../services/host-check/host-check.js";
import { type HostLogin, hostLogin } from "../../services/host-check/host-login.js";
import { type UnusedHost, type UsedHost, unuseHost, useHost } from "../../services/host-project/host-project.js";
import { readOutboxBlob } from "../../services/outbox/outbox-file.js";
import { hostOutboxAck, hostOutboxEntries } from "../../services/outbox/outbox-host.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { type LaunchDescriptor, writeCliShim } from "../factory-runner/cli-shim.js";
import { run, runBytes, runQuiet, runWithoutContext, setExitCode } from "../output/output.js";
import { registerHostRunCommands } from "./host-run-commands.js";

function describe(host: Host): string {
  const state = host.enabled ? "on" : "off";

  return `${host.id}  ${host.ssh}  ${host.maxWorkers} worker(s)  ${state}`;
}

/**
 * The outbox folder of a host request. With a project id, it is the outbox of the host agent of that Project, because
 * a command over SSH has no `ROWBLY_OUTBOX`. Without it, the folder comes from `ROWBLY_OUTBOX`.
 */
function outboxDir(projectId: string | undefined): string | undefined {
  return projectId === undefined ? process.env.ROWBLY_OUTBOX : hostAgentPaths(projectId).outbox;
}

/** The outbox folder and the JSON request on stdin. */
async function hostRequest(projectId: string | undefined) {
  return { dir: outboxDir(projectId), text: await streamText(process.stdin) };
}

function needsAction(item: CheckItem): boolean {
  return item.state === "fail" || item.state === "warning";
}

/** One line for the item, and a second line with the action for a `fail` or a `warning`. */
function itemText(item: CheckItem): string {
  const line = `${item.state.padEnd(7)}  ${item.id}: ${item.detail}`;

  return needsAction(item) && item.action ? `${line}\n         Action: ${item.action}` : line;
}

function checkText(check: HostCheck): string {
  const state = check.ready ? "ready" : "not ready";

  return [`Host ${check.host} is ${state}.`, ...check.items.map(itemText)].join("\n");
}

/** The items that the user must do after `host add`. */
function todoText(check: HostCheck): string {
  const todo = check.items.filter(needsAction);

  return todo.length === 0 ? "All checks pass." : ["Do these items on the host:", ...todo.map(itemText)].join("\n");
}

function addedText(host: AddedHost): string {
  const action = host.install.installed ? "installed" : "found";

  return [
    `Added worker host ${describe(host)}`,
    `Rowbly ${host.install.buildId} ${action} at ${host.install.remoteExecutable}`,
    todoText(host.check),
  ].join("\n");
}

/** The login asks for secrets on the host, so it runs only in a terminal, and not when the output is JSON. */
function requireTerminal(command: Command, id: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY || command.optsWithGlobals().json) {
    throw new ValidationError("Login needs an interactive terminal", {
      hint: `Run rowbly host login ${id} in a terminal without --json.`,
    });
  }
}

/** Starts SSH in the terminal of the user and gives its exit code. */
function runInTerminal(login: HostLogin): Promise<number> {
  return new Promise((done, reject) => {
    const child = spawn(login.executable, [...login.args], { stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

async function loginOnHost(
  command: Command,
  id: string,
  ctx: ServiceContext,
): Promise<{ host: string; exitCode: number }> {
  requireTerminal(command, id);

  const login = await hostLogin({ id }, ctx);
  const exitCode = await runInTerminal(login);

  setExitCode(exitCode === 0 ? undefined : exitCode);

  return { host: login.host, exitCode };
}

interface UpdateOptions {
  readonly maxWorkers?: string;
  readonly enable?: boolean;
  readonly disable?: boolean;
}

/** The input of `host update`. The service checks the number, so a bad value gives a VALIDATION error. */
function updateInput(id: string, opts: UpdateOptions): HostUpdate {
  if (opts.enable && opts.disable) {
    throw new ValidationError("Use --enable or --disable, not both");
  }

  const enabled = opts.enable || opts.disable ? opts.enable === true : undefined;

  return {
    id,
    ...(opts.maxWorkers === undefined ? {} : { maxWorkers: Number(opts.maxWorkers) }),
    ...(enabled === undefined ? {} : { enabled }),
  };
}

/** Registers `host update`. */
function registerUpdateCommand(program: Command): void {
  program
    .command("update <id>")
    .description("Change the worker limit of a worker host, or turn it on or off for all Projects")
    .option("--max-workers <n>", "largest number of workers on the host at one time")
    .option("--enable", "turn the host on for all Projects")
    .option("--disable", "turn the host off for all Projects")
    .action((id: string, opts: UpdateOptions, command: Command) =>
      run(
        command,
        (ctx) => updateHost(updateInput(id, opts), ctx),
        (host) => `Updated worker host ${describe(host)}`,
      ),
    );
}

function listText(hosts: readonly Host[]): string {
  return hosts.length === 0 ? "No worker hosts." : hosts.map(describe).join("\n");
}

/** Registers `host check` and `host login`. */
function registerSetupCommands(program: Command): void {
  program
    .command("check <id>")
    .description("Show if a worker host is ready, with an action for each item that fails")
    .action((id: string, _opts: unknown, command: Command) => run(command, (ctx) => checkHost({ id }, ctx), checkText));

  program
    .command("login <id>")
    .description("Log in to Pi on a worker host; runs ssh -t <target> <remote rowbly> auth login")
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => loginOnHost(command, id, ctx),
        (result) => `Login on ${result.host} ended with exit code ${result.exitCode}`,
      ),
    );
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

/** Writes the CLI shim of the workers and makes the runner of the agent. */
async function hostRunner(projectId: string, launch: LaunchDescriptor) {
  const home = homedir();
  const paths = hostAgentPaths(projectId, home);

  await ensurePrivateDir(dirname(paths.bin));

  return createHostRunner({ paths, home, shim: await writeCliShim(launch, paths.bin) });
}

/** Runs the host agent of the Project. `SIGTERM` and `SIGINT` stop it. */
async function serveAgent(projectId: string | undefined, launch: LaunchDescriptor) {
  if (projectId === undefined) {
    throw new ValidationError("A project id is necessary without --detach");
  }

  const runner = await hostRunner(projectId, launch);
  const controller = new AbortController();
  const stop = abortOnSignal(controller);

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    return await runHostAgent({ projectId, runner, signal: controller.signal });
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

/** Registers the hidden commands that the main machine runs on a worker host over SSH. The output is JSON. */
function registerHostServeCommands(program: Command, launch: FactoryLaunch): void {
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
            () => serveAgent(projectId, launch),
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

  registerHostRunCommands(program);

  program
    .command("attach <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runQuiet(command, () =>
        runHostAttach({ projectId, input: process.stdin, write: (line) => void process.stdout.write(line) }),
      ),
    );
}

function usedText(used: UsedHost): string {
  const action = used.cloned ? "cloned to" : "uses the clone at";

  return `Worker host ${used.host} ${action} ${used.path}`;
}

function unusedText(unused: UnusedHost): string {
  return `Worker host ${unused.host} no longer uses this Project. The clone at ${unused.path} stays on the host.`;
}

/** Registers the `rowbly host` subcommands. Only `use` and `unuse` need a Project. */
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

  registerSetupCommands(program);

  program
    .command("list")
    .description("List the worker hosts")
    .action((_opts: unknown, command: Command) => run(command, (ctx) => listHosts(ctx), listText));

  registerUpdateCommand(program);

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

  program
    .command("use <id>")
    .description("Turn a worker host on for this Project, and clone the repository on the host")
    .option("--path <dir>", "use an existing clean clone on the host, not the managed folder")
    .action((id: string, opts: { path?: string }, command: Command) =>
      run(command, (ctx) => useHost(opts.path === undefined ? { id } : { id, path: opts.path }, ctx), usedText),
    );

  program
    .command("unuse <id>")
    .description("Turn a worker host off for this Project; the clone stays on the host")
    .action((id: string, _opts: unknown, command: Command) =>
      run(command, (ctx) => unuseHost({ id }, ctx), unusedText),
    );

  registerHostAgentCommands(program);
}

/** Registers the hidden subcommands that the main machine runs on a worker host over SSH. */
function registerHostAgentCommands(program: Command): void {
  // The main machine runs this command over SSH to get the file of an `attachment.add` entry.
  program
    .command("blob <sha256> [project-id]", { hidden: true })
    .action((sha256: string, projectId: string | undefined, _opts: unknown, command: Command) =>
      runBytes(command, async () => readOutboxBlob({ dir: outboxDir(projectId), sha256 })),
    );

  // The main machine runs this command over SSH to get the entries after the `afterSeq` of the request.
  program
    .command("outbox [project-id]", { hidden: true })
    .action((projectId: string | undefined, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () => hostOutboxEntries(await hostRequest(projectId)),
        (answer) => `${answer.entries.length} entries`,
      ),
    );

  // The main machine runs this command over SSH after it recorded the applied `seq` on its disk.
  program
    .command("outbox-ack [project-id]", { hidden: true })
    .action((projectId: string | undefined, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () => hostOutboxAck(await hostRequest(projectId)),
        (result) => `Removed ${result.removed} entries`,
      ),
    );

  // A detached agent starts with the same Node, loader flags and entry file as this process.
  registerHostServeCommands(program, {
    executable: process.execPath,
    execArgv: [...process.execArgv],
    entry: resolve(process.argv[1] as string),
  });
}
