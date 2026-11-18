import { homedir } from "node:os";
import type { Command } from "commander";
import { MAX_ATTACHMENT_BYTES } from "../../services/attachment-files/attachment-files.js";
import { hostCacheMissing, hostCachePut } from "../../services/host-agent/host-agent-cache.js";
import { parseJsonInput, readBoundedInput } from "../../services/host-agent/host-agent-input.js";
import { hostAgentPaths, hostRunPathsAnswer } from "../../services/host-agent/host-agent-paths.js";
import { HOST_PREPARE_LIMIT, prepareHostThread } from "../../services/host-agent/host-agent-prepare.js";
import { applyHostInbound } from "../../services/host-agent/host-inbound.js";
import { hostPing } from "../../services/host-agent/host-ping.js";
import { hostRuns } from "../../services/host-agent/host-runs.js";
import { hostSessionBytes } from "../../services/host-agent/host-session-bytes.js";
import { runBytes, runWithoutContext } from "../output/output.js";

/** Registers the hidden request call that applies the inbound updates of a Thread to its copy on the host. */
function registerInboundCommand(program: Command): void {
  program
    .command("inbound <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runWithoutContext(
        command,
        async () =>
          applyHostInbound(
            hostAgentPaths(projectId),
            parseJsonInput(await readBoundedInput(process.stdin, HOST_PREPARE_LIMIT)),
          ),
        (answer) => JSON.stringify(answer),
      ),
    );
}

/** Registers the hidden calls of the attachment cache of the host. */
function registerCacheCommands(program: Command): void {
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
}

/**
 * Registers the hidden request and upload calls of a remote run: the attachment cache, the run paths, the prepare step,
 * the inbound updates, the heartbeat, the run states of the Threads and the session bytes of the session mirror.
 */
export function registerHostRunCommands(program: Command): void {
  registerCacheCommands(program);

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

  registerInboundCommand(program);

  program.command("ping <project-id>", { hidden: true }).action((projectId: string, _opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      () => hostPing(hostAgentPaths(projectId)),
      (answer) => JSON.stringify(answer),
    ),
  );

  registerRunsCommand(program);
  registerSessionBytesCommand(program);
}

/** Registers the hidden request call that gives the run states of the Threads after a restart of the daemon. */
function registerRunsCommand(program: Command): void {
  program.command("runs <project-id>", { hidden: true }).action((projectId: string, _opts: unknown, command: Command) =>
    runWithoutContext(
      command,
      async () => hostRuns(hostAgentPaths(projectId), parseJsonInput(await readBoundedInput(process.stdin, 1_048_576))),
      (answer) => JSON.stringify(answer),
    ),
  );
}

/** Registers the hidden bytes call that gives the session lines of a Thread to the session mirror. */
function registerSessionBytesCommand(program: Command): void {
  // The main machine runs this command to fill a gap of the session mirror of a remote Thread.
  program
    .command("session-bytes <project-id>", { hidden: true })
    .action((projectId: string, _opts: unknown, command: Command) =>
      runBytes(command, async () =>
        hostSessionBytes(hostAgentPaths(projectId), parseJsonInput(await readBoundedInput(process.stdin, 65_536))),
      ),
    );
}
