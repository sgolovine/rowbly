import type { Command } from "commander";
import {
  addCheck,
  type CheckItemChange,
  listChecks,
  removeCheck,
  updateCheck,
} from "../../services/factory-settings/check-items.js";
import type { CheckSpec } from "../../services/factory-settings/factory-settings.js";
import { parseInteger, run } from "../output/output.js";

interface CheckOptions {
  label?: string;
  command?: string;
  narrowCommand?: string;
  memoryMb?: number;
  timeoutMinutes?: number;
  block?: string[];
}

interface UpdateOptions extends CheckOptions {
  clearLabel?: boolean;
  clearNarrowCommand?: boolean;
  clearMemoryMb?: boolean;
  clearTimeoutMinutes?: boolean;
  clearBlock?: boolean;
}

/** Collects the values of a repeated option. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function nameText(check: CheckSpec): string {
  return check.label === check.key ? check.key : `${check.key} (${check.label})`;
}

function checkText(check: CheckSpec): string {
  const narrow = check.narrowCommand ? `\n  narrow: ${check.narrowCommand}` : "";
  const block = check.block.length ? `\n  block: ${check.block.join(", ")}` : "";

  return `${nameText(check)}: ${check.command}${narrow}\n  memory: ${check.memoryMb} MB, timeout: ${check.timeoutMinutes} min${block}`;
}

function listText(checks: readonly CheckSpec[]): string {
  return checks.length ? checks.map(checkText).join("\n") : "No checks";
}

/** Gives the change of an update. A `--clear-…` flag removes the key. */
function changeOf(opts: UpdateOptions): CheckItemChange {
  const entries: [keyof CheckItemChange, unknown][] = [
    ["label", opts.clearLabel ? null : opts.label],
    ["command", opts.command],
    ["narrowCommand", opts.clearNarrowCommand ? null : opts.narrowCommand],
    ["memoryMb", opts.clearMemoryMb ? null : opts.memoryMb],
    ["timeoutMinutes", opts.clearTimeoutMinutes ? null : opts.timeoutMinutes],
    ["block", opts.clearBlock ? null : opts.block],
  ];

  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as CheckItemChange;
}

/** Adds the options of the values of one check. */
function withValueOptions(command: Command): Command {
  return command
    .option("--label <text>", "the name that the TUI shows")
    .option("--narrow-command <command>", "the narrow form; {files} becomes the quoted files")
    .option("--memory-mb <mb>", "the first memory estimate", parseInteger)
    .option("--timeout-minutes <n>", "stop the check after this time, 1 to 240", parseInteger)
    .option("--block <text>", "text that the worker bash tool rejects (repeat for more)", collect);
}

function registerAdd(check: Command): void {
  withValueOptions(check.command("add <key>").description("Add a check"))
    .requiredOption("--command <command>", "the full check, run through the shell in the worktree")
    .action((key: string, opts: CheckOptions, cmd: Command) =>
      run(cmd, (ctx) => addCheck({ key, ...opts, command: opts.command as string }, ctx), checkText),
    );
}

function registerUpdate(check: Command): void {
  withValueOptions(check.command("update <key>").description("Change a check"))
    .option("--command <command>", "the full check")
    .option("--clear-label", "use the key as the label")
    .option("--clear-narrow-command", "remove the narrow form")
    .option("--clear-memory-mb", "use the default memory estimate")
    .option("--clear-timeout-minutes", "use the default timeout")
    .option("--clear-block", "remove the block texts")
    .action((key: string, opts: UpdateOptions, cmd: Command) =>
      run(cmd, (ctx) => updateCheck(key, changeOf(opts), ctx), checkText),
    );
}

function registerRemove(check: Command): void {
  check
    .command("remove <key>")
    .description("Remove a check")
    .action((key: string, _opts: unknown, cmd: Command) => run(cmd, (ctx) => removeCheck(key, ctx), listText));
}

function registerList(check: Command): void {
  check
    .command("list")
    .description("List the checks")
    .action((_opts: unknown, cmd: Command) => run(cmd, (ctx) => listChecks(ctx), listText));
}

/** Registers `rowbly factory check add|update|remove|list`. */
export function registerCheckCommands(program: Command): void {
  const check = program.command("check").description("Change and show the checks that the factory runs");

  registerAdd(check);
  registerUpdate(check);
  registerRemove(check);
  registerList(check);
}
