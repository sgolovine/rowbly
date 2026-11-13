import { ValidationError } from "../../services/errors/errors.js";
import { type FactoryCommand, processCommands } from "../../services/factory-control/factory-control.js";
import type { FactoryManager } from "../../services/factory-manager/factory-manager.js";
import { Store } from "../../services/store/store.js";
import type { ProjectPaths } from "../../services/workspace/workspace.js";

/** The parts of the manager that the control commands use. */
export type ControlTarget = Pick<FactoryManager, "shutdown" | "cancelWorker" | "resumeWorker">;

interface PollState {
  /** The scans run one after the other on this chain. */
  readonly queue: Promise<void>;
  /** A scan waits or runs. A new poll then does nothing, so that at most one scan waits. */
  readonly polling: boolean;
}

/** Reads the control commands of one daemon owner and gives them to the manager. */
export interface ControlPoller {
  readonly paths: ProjectPaths;
  readonly token: string;
  readonly manager: ControlTarget;
  readonly state: Store<PollState>;
}

/** Makes a poller with no scan in progress. */
export function createControlPoller(paths: ProjectPaths, token: string, manager: ControlTarget): ControlPoller {
  return { paths, token, manager, state: new Store<PollState>({ queue: Promise.resolve(), polling: false }) };
}

async function executeCommand(manager: ControlTarget, command: FactoryCommand): Promise<void> {
  if (command.type === "stop") {
    await manager.shutdown();

    return;
  }

  if (!command.threadId || !command.expectedRunId) {
    throw new ValidationError("Thread and run IDs are necessary");
  }

  if (command.type === "cancel") {
    await manager.cancelWorker(command.threadId, command.expectedRunId);

    return;
  }

  await manager.resumeWorker(command.threadId, command.expectedRunId, command.id);
}

function scanCommands(poller: ControlPoller): Promise<void> {
  return processCommands(poller.paths, poller.token, (command) => executeCommand(poller.manager, command));
}

function reportScanError(error: unknown): void {
  console.error(error instanceof Error ? error.message : "Control scan failed");
}

/** Adds one scan to the queue, unless a scan waits or runs already. */
export function pollControl(poller: ControlPoller): void {
  if (poller.state.current.polling) {
    return;
  }

  poller.state.update((state) => ({
    polling: true,
    queue: state.queue
      .then(() => scanCommands(poller))
      .catch((error) => reportScanError(error))
      .finally(() => poller.state.update(() => ({ polling: false }))),
  }));
}

/** Resolves after the scan that waits or runs now. */
export function settledControl(poller: ControlPoller): Promise<void> {
  return poller.state.current.queue;
}
