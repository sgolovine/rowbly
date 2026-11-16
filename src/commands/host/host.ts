import { spawn } from "node:child_process";
import { text as streamText } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import { type AddedHost, addHost, type Host, listHosts, removeHost } from "../../services/host/host.js";
import { type CheckItem, checkHost, type HostCheck } from "../../services/host-check/host-check.js";
import { type HostLogin, hostLogin } from "../../services/host-check/host-login.js";
import { type UnusedHost, type UsedHost, unuseHost, useHost } from "../../services/host-project/host-project.js";
import { readOutboxBlob } from "../../services/outbox/outbox-file.js";
import { hostOutboxAck, hostOutboxEntries } from "../../services/outbox/outbox-host.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { run, runBytes, runWithoutContext, setExitCode } from "../output/output.js";

function describe(host: Host): string {
  const state = host.enabled ? "on" : "off";

  return `${host.id}  ${host.ssh}  ${host.maxWorkers} worker(s)  ${state}`;
}

/** The outbox folder from `ROWBLY_OUTBOX` and the JSON request on stdin. */
async function hostRequest() {
  return { dir: process.env.ROWBLY_OUTBOX, text: await streamText(process.stdin) };
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
  return new Promise((resolve, reject) => {
    const child = spawn(login.executable, [...login.args], { stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
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
  // The main machine runs this command over SSH to get the PNG of an `attachment.add` entry.
  program
    .command("blob <sha256>", { hidden: true })
    .action((sha256: string, _opts: unknown, command: Command) =>
      runBytes(command, () => readOutboxBlob({ dir: process.env.ROWBLY_OUTBOX, sha256 })),
    );

  // The main machine runs this command over SSH to get the entries after the `afterSeq` of the request.
  program.command("outbox", { hidden: true }).action((_opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      async () => hostOutboxEntries(await hostRequest()),
      (answer) => `${answer.entries.length} entries`,
    ),
  );

  // The main machine runs this command over SSH after it recorded the applied `seq` on its disk.
  program.command("outbox-ack", { hidden: true }).action((_opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      async () => hostOutboxAck(await hostRequest()),
      (result) => `Removed ${result.removed} entries`,
    ),
  );
}
