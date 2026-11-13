import type { Command } from "commander";
import { getThread, listThreads } from "../../services/thread/thread.js";
import { run } from "../output/output.js";

export function registerThreadCommands(program: Command): void {
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
