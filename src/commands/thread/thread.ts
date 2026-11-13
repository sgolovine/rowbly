import type { Command } from "commander";
import { getThreadLog } from "../../services/conversation/conversation.js";
import { getThread, listThreads } from "../../services/thread/thread.js";
import { parsePosition, run } from "../output/output.js";

export function registerThreadCommands(program: Command): void {
  program
    .command("log <id>")
    .description("Print a bounded conversation tail (at most 100 entries)")
    .option("--tail <n>", "number of entries, from 1 to 100", parsePosition, 20)
    .action((id: string, opts: { tail: number }, command: Command) =>
      run(
        command,
        (ctx) => getThreadLog(id, opts, ctx),
        (page) =>
          page.status === "unsupported"
            ? "Session format not supported."
            : page.status === "missing"
              ? "No persisted conversation yet."
              : page.entries.map((e) => `${e.timestamp ?? ""} ${e.role ?? e.type}\n${e.text}`).join("\n\n") ||
                "No conversation entries.",
      ),
    );
  program
    .command("list")
    .description("List historical and active threads")
    .option("--story <id>", "only threads for this Story")
    .action((opts: { story?: string }, command: Command) =>
      run(
        command,
        (ctx) => listThreads(opts, ctx),
        (result) =>
          [
            ...result.threads.map(
              (t) =>
                `${t.id}  ${t.storyId ?? "Factory"} ${t.stage ?? ""} ${t.status}  ${t.model ? `${t.model.provider}/${t.model.modelId}` : "unresolved"}`,
            ),
            ...result.issues.map((i) => `Warning: ${i.file}: ${i.message}`),
          ].join("\n") || "No threads found.",
      ),
    );
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
