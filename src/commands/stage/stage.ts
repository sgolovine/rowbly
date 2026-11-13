import type { Command } from "commander";
import { createStage, deleteStage, getStage, type Stage, updateStage } from "../../services/stage/stage.js";
import { parsePosition, run } from "../output/output.js";

interface StageOptions {
  label?: string;
  prompt?: string;
  position?: number;
  enable?: boolean;
  disable?: boolean;
}

/** `--enable` / `--disable` as one optional boolean. */
function enabledFlag(opts: StageOptions): boolean | undefined {
  if (opts.enable && opts.disable) {
    return undefined;
  }
  return opts.enable ? true : opts.disable ? false : undefined;
}

function formatStage(stage: Stage): string {
  const lines = [
    `${stage.key}  ${stage.label}`,
    `Position: ${stage.position}`,
    `Enabled: ${stage.enabled ? "yes" : "no"}`,
  ];
  lines.push("", stage.prompt || "(no prompt)");
  return lines.join("\n");
}

export function registerStageCommands(program: Command): void {
  program
    .command("create")
    .description("Create a stage")
    .requiredOption("--label <label>", "stage name, e.g. In Progress")
    .option("--key <key>", "stage key and file name (default: the label in UPPER_SNAKE_CASE)")
    .option("--prompt <markdown>", "how agents should handle a story in this stage")
    .option("--position <n>", "place in board order, from 1 (default: last)", parsePosition)
    .option("--disable", "create the stage disabled")
    .action((opts: StageOptions & { label: string; key?: string }, command: Command) =>
      run(
        command,
        (ctx) =>
          createStage(
            {
              label: opts.label,
              key: opts.key,
              prompt: opts.prompt,
              position: opts.position,
              enabled: !opts.disable,
            },
            ctx,
          ),
        (stage) => `Created stage ${stage.key} at position ${stage.position}`,
      ),
    );

  program
    .command("update <key>")
    .description("Update a stage")
    .option("--rename <key>", "new key; renames the stage file and moves its stories")
    .option("--label <label>", "new name")
    .option("--prompt <markdown>", "replace the prompt")
    .option("--position <n>", "move to this place in board order, from 1", parsePosition)
    .option("--enable", "enable the stage")
    .option("--disable", "disable the stage")
    .action((key: string, opts: StageOptions & { rename?: string }, command: Command) =>
      run(
        command,
        (ctx) =>
          updateStage(
            {
              key,
              newKey: opts.rename,
              label: opts.label,
              prompt: opts.prompt,
              position: opts.position,
              enabled: enabledFlag(opts),
            },
            ctx,
          ),
        (stage) => `Updated stage ${stage.key}`,
      ),
    );

  program
    .command("delete <key>")
    .description("Delete a stage")
    .option("--move-to <stage>", "move the stage's stories to this stage first")
    .action((key: string, opts: { moveTo?: string }, command: Command) =>
      run(
        command,
        (ctx) => deleteStage({ key, moveStoriesTo: opts.moveTo }, ctx),
        (result) =>
          `Deleted stage ${result.key}${result.movedStories > 0 ? `; moved ${result.movedStories} stories` : ""}`,
      ),
    );

  program
    .command("get <key>")
    .description("Show a stage and its prompt")
    .action((key: string, _opts: unknown, command: Command) =>
      run(command, (ctx) => getStage({ key }, ctx), formatStage),
    );
}
