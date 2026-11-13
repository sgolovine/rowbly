import type { Command } from "commander";
import { authRuntime, listAvailableModels } from "../../services/agent-auth/agent-auth.js";
import { run } from "../output/output.js";

export function registerModelCommands(program: Command) {
  program
    .command("list")
    .option("--provider <id>", "provider ID")
    .description("List configured models; availability is not a health check")
    .action((opts: { provider?: string }, cmd: Command) =>
      run(
        cmd,
        async () => listAvailableModels(await authRuntime(), opts.provider),
        (rows) => rows.map((m) => `${m.provider}/${m.modelId} (${m.thinkingLevels.join(", ")})`).join("\n"),
      ),
    );
}
