import type { Command } from "commander";
import { getThreadLog } from "../../services/conversation/conversation.js";
import { sendFactoryCommand, steerThread } from "../../services/factory/factory.js";
import { LOCAL_HOST } from "../../services/thread/thread.js";
import {
  connectionLostText,
  getThreadWithConnection,
  listThreadsWithConnection,
} from "../../services/thread-connection/thread-connection.js";
import { parsePosition, run } from "../output/output.js";

type ThreadLog = Awaited<ReturnType<typeof getThreadLog>>;
type ThreadList = Awaited<ReturnType<typeof listThreadsWithConnection>>;

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

function threadLine(t: ThreadList["threads"][number], now: number): string {
  const model = t.model ? `${t.model.provider}/${t.model.modelId}` : "unresolved";
  const line = `${t.id}  ${t.storyId ?? "Factory"} ${t.stage ?? ""} ${t.status}  ${model}  ${t.host ?? LOCAL_HOST}`;

  return t.connection ? `${line}  ${connectionLostText(t.connection, now)}` : line;
}

function listText(result: ThreadList, now: number): string {
  return (
    [
      ...result.threads.map((t) => threadLine(t, now)),
      ...result.issues.map((i) => `Warning: ${i.file}: ${i.message}`),
    ].join("\n") || "No threads found."
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

function registerSteer(program: Command): void {
  program
    .command("steer <id>")
    .description("send a message to a running worker through the running factory")
    .requiredOption("--message <text>", "the message, from 1 to 4000 characters")
    .action((id: string, opts: { message: string }, command: Command) =>
      run(
        command,
        (ctx) => steerThread(id, opts.message, {}, ctx),
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
        (ctx) => listThreadsWithConnection(opts, ctx),
        (result) => listText(result, Date.now()),
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
        (ctx) => getThreadWithConnection(id, ctx),
        (t) => JSON.stringify(t, null, 2),
      ),
    );
}

/** Registers the `rowbly thread` subcommands on the `thread` command. */
export function registerThreadCommands(program: Command): void {
  registerControl(program, "cancel");
  registerControl(program, "resume");
  registerSteer(program);
  registerLog(program);
  registerList(program);
  registerShow(program);
}
