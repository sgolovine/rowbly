import type { Command } from "commander";
import {
  getProjectStatus,
  type ProjectStatus,
  type StageSummary,
} from "../../services/project-status/project-status.js";
import { contactText, type LostConnection } from "../../services/thread-connection/thread-connection.js";
import { run } from "../output/output.js";

function stageName(stage: StageSummary): string {
  const disabled = stage.enabled ? "" : " (disabled)";

  return `${stage.label} (${stage.key})${disabled}`;
}

/** One indented line for each Stage. The counts line up in one column. */
function stageLines(stages: readonly StageSummary[]): string[] {
  const names = stages.map((stage) => stageName(stage));
  const width = Math.max(0, ...names.map((name) => name.length));

  return stages.map((stage, index) => `  ${(names[index] ?? "").padEnd(width)}   ${stage.stories}`);
}

/** One indented line for each remote Thread whose host lost its connection. */
function lostLines(lost: readonly LostConnection[]): string[] {
  return lost.map(
    (entry) =>
      `  ${entry.threadId}  ${entry.storyId ?? "Factory"}  ${entry.host}  connection lost (${contactText(entry.lastContactMs)})`,
  );
}

function statusText(status: ProjectStatus): string {
  const { running, pending } = status.threads;

  return [
    `Factory: ${status.factory.phase}`,
    `Threads: ${running} running, ${pending} pending`,
    ...lostLines(status.connectionLost ?? []),
    "",
    `Stories: ${status.stories}`,
    ...stageLines(status.stages),
  ].join("\n");
}

/** Registers `rowbly status`. */
export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show a short summary of the project: the factory, the threads and the stories in each stage")
    .action((_opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => getProjectStatus(ctx),
        (status) => statusText(status),
      ),
    );
}
