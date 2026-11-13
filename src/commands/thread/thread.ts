import type { Command } from "commander";
import { getThreadLog } from "../../services/conversation/conversation.js";
import { sendFactoryCommand } from "../../services/factory/factory.js";
import { getThread, listThreads } from "../../services/thread/thread.js";
import { parsePosition, run } from "../output/output.js";

type ThreadLog = Awaited<ReturnType<typeof getThreadLog>>;
type ThreadList = Awaited<ReturnType<typeof listThreads>>;

function logText(page: ThreadLog): string {
  if (page.status === "unsupported") {
    return "Session format not supported.";
  }

  if (page.status === "missing") {
    return "No persisted conversation yet.";
  }

  return (
    page.entries.map((e) => `${e.timestamp ?? ""} ${e.role ?? e.type}\n${e.text}`).join("\n\n") ||
    "No conversation entries."
  );
}

function threadLine(t: ThreadList["threads"][number]): string {
  const model = t.model ? `${t.model.provider}/${t.model.modelId}` : "unresolved";

  return `${t.id}  ${t.storyId ?? "Factory"} ${t.stage ?? ""} ${t.status}  ${model}`;
}

function listText(result: ThreadList): string {
  return (
    [...result.threads.map((t) => threadLine(t)), ...result.issues.map((i) => `Warning: ${i.file}: ${i.message}`)].join(
      "\n",
    ) || "No threads found."
  );
}

function registerControl(program: Command, action: "cancel" | "resume"): void {
  program
    .command(`${action} <id>`)
    .description(`${action} a worker through the running factory`)
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => sendFactoryCommand(action, { threadId: id }, ctx),
        (receipt) => JSON.stringify(receipt),
      ),
    );
}

function registerLog(program: Command): void {
  program
    .command("log <id>")
    .description("Print a bounded conversation tail (at most 100 entries)")
    .option("--tail <n>", "number of entries, from 1 to 100", parsePosition, 20)
    .action((id: string, opts: { tail: number }, command: Command) =>
      run(
        command,
        (ctx) => getThreadLog(id, opts, ctx),
        (page) => logText(page),
      ),
    );
}

function registerList(program: Command): void {
  program
    .command("list")
    .description("List historical and active threads")
    .option("--story <id>", "only threads for this Story")
    .action((opts: { story?: string }, command: Command) =>
      run(
        command,
        (ctx) => listThreads(opts, ctx),
        (result) => listText(result),
      ),
    );
}

function registerShow(program: Command): void {
  program
    .command("show <id>")
    .description("Show thread metadata")
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => getThread(id, ctx),
        (t) => JSON.stringify(t, null, 2),
      ),
    );
}

/** Registers the `rowbly thread` subcommands on the `thread` command. */
export function registerThreadCommands(program: Command): void {
  registerControl(program, "cancel");
  registerControl(program, "resume");
  registerLog(program);
  registerList(program);
  registerShow(program);
}
