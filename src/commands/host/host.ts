import type { Command } from "commander";
import { addHost, type Host, listHosts, removeHost } from "../../services/host/host.js";
import { run } from "../output/output.js";

function describe(host: Host): string {
  const state = host.enabled ? "on" : "off";

  return `${host.id}  ${host.ssh}  ${host.maxWorkers} worker(s)  ${state}`;
}

function listText(hosts: readonly Host[]): string {
  return hosts.length === 0 ? "No worker hosts." : hosts.map(describe).join("\n");
}

/** Registers the `rowbly host` subcommands on the `host` command. The commands do not need a Project. */
export function registerHostCommands(program: Command): void {
  program
    .command("add <id>")
    .description("Record a worker host in ~/.rowblyrc.json")
    .requiredOption("--ssh <target>", "SSH target of the host, e.g. user@mini.lan")
    .requiredOption("--max-workers <n>", "largest number of workers on the host at one time")
    .action((id: string, opts: { ssh: string; maxWorkers: string }, command: Command) =>
      run(
        command,
        // The service checks the number, so a bad value gives a VALIDATION error.
        (ctx) => addHost({ id, ssh: opts.ssh, maxWorkers: Number(opts.maxWorkers) }, ctx),
        (host) => `Added worker host ${describe(host)}`,
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
}
