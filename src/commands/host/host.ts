import { text as streamText } from "node:stream/consumers";
import type { Command } from "commander";
import { type AddedHost, addHost, type Host, listHosts, removeHost } from "../../services/host/host.js";
import { readOutboxBlob } from "../../services/outbox/outbox-file.js";
import { hostOutboxAck, hostOutboxEntries } from "../../services/outbox/outbox-host.js";
import { run, runBytes, runWithoutContext } from "../output/output.js";

function describe(host: Host): string {
  const state = host.enabled ? "on" : "off";

  return `${host.id}  ${host.ssh}  ${host.maxWorkers} worker(s)  ${state}`;
}

/** The outbox folder from `ROWBLY_OUTBOX` and the JSON request on stdin. */
async function hostRequest() {
  return { dir: process.env.ROWBLY_OUTBOX, text: await streamText(process.stdin) };
}

function addedText(host: AddedHost): string {
  const action = host.install.installed ? "installed" : "found";

  return `Added worker host ${describe(host)}\nRowbly ${host.install.buildId} ${action} at ${host.install.remoteExecutable}`;
}

function listText(hosts: readonly Host[]): string {
  return hosts.length === 0 ? "No worker hosts." : hosts.map(describe).join("\n");
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
