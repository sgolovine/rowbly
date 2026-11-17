import { homedir } from "node:os";
import type { Command } from "commander";
import { MAX_ATTACHMENT_BYTES } from "../../services/attachment-files/attachment-files.js";
import { hostCacheMissing, hostCachePut } from "../../services/host-agent/host-agent-cache.js";
import { parseJsonInput, readBoundedInput } from "../../services/host-agent/host-agent-input.js";
import { hostAgentPaths, hostRunPathsAnswer } from "../../services/host-agent/host-agent-paths.js";
import { HOST_PREPARE_LIMIT, prepareHostThread } from "../../services/host-agent/host-agent-prepare.js";
import { hostPing } from "../../services/host-agent/host-ping.js";
import { hostRuns } from "../../services/host-agent/host-runs.js";
import { runWithoutContext } from "../output/output.js";

/**
 * Registers the hidden request and upload calls of a remote run: the attachment cache, the run paths, the prepare step
 * the heartbeat and the run states of the Threads.
 */
export function registerHostRunCommands(program: Command): void {
  program
    .command("cache-missing <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () =>
          hostCacheMissing(hostAgentPaths(projectId), parseJsonInput(await readBoundedInput(process.stdin, 1_048_576))),
        (answer) => JSON.stringify(answer),
      ),
    );

  program
    .command("cache-put <project-id> <attachment-id>", { hidden: true })
    .action((projectId: string, id: string, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () =>
          hostCachePut(
            hostAgentPaths(projectId),
            id,
            await readBoundedInput(process.stdin, MAX_ATTACHMENT_BYTES, "An attachment"),
          ),
        (answer) => JSON.stringify(answer),
      ),
    );

  program
    .command("run-paths <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () => hostRunPathsAnswer(projectId, parseJsonInput(await readBoundedInput(process.stdin, 65_536))),
        (answer) => JSON.stringify(answer),
      ),
    );

  program
    .command("prepare <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () =>
          prepareHostThread(
            hostAgentPaths(projectId),
            parseJsonInput(await readBoundedInput(process.stdin, HOST_PREPARE_LIMIT)),
            { home: homedir() },
          ),
        (answer) => JSON.stringify(answer),
      ),
    );

  registerHostQueryCommands(program);
}

/** Registers the hidden calls that read the state of the host: the heartbeat and the run states of the Threads. */
function registerHostQueryCommands(program: Command): void {
  program.command("ping <project-id>", { hidden: true }).action((projectId: string, _opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      () => hostPing(hostAgentPaths(projectId)),
      (answer) => JSON.stringify(answer),
    ),
  );

  program.command("runs <project-id>", { hidden: true }).action((projectId: string, _opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      async () => hostRuns(hostAgentPaths(projectId), parseJsonInput(await readBoundedInput(process.stdin, 1_048_576))),
      (answer) => JSON.stringify(answer),
    ),
  );
}
