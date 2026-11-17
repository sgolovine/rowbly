import { setTimeout as sleep } from "node:timers/promises";
import { ConflictError, ValidationError } from "../errors/errors.js";
import {
  assertSteerMessage,
  type FactoryCommandType,
  publishCommand,
  readReceipt,
  validAttentionKey,
  validStoryId,
} from "../factory-control/factory-control.js";
import { type FactoryManager, getFactoryStatus as readStatus } from "../factory-manager/factory-manager.js";
import { type Owner, probeOwner, probeOwnerCached, readFactoryOwner } from "../factory-ownership/factory-ownership.js";
import { assertNoLegacyFactorySettings } from "../factory-settings/factory-settings.js";
import { readWatchdogState, type WatchdogState } from "../factory-watchdog/factory-watchdog.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { Store } from "../store/store.js";
import { getThread } from "../thread/thread.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { type DaemonOptions, type LaunchState, launchDaemon } from "./factory-launch.js";
import { getFactoryLogs } from "./factory-logs.js";
import {
  crashLimitAttention,
  type RestartFields,
  restartFields,
  stopWatchdog,
  waitForActiveWatchdogExit,
  watchdogLive,
} from "./watchdog-status.js";

export type { FactoryLaunch } from "./factory-launch.js";
export { getFactoryLogs };

export type FactoryStatus = Partial<Omit<Awaited<ReturnType<FactoryManager["snapshot"]>>, "phase" | "owner">> & {
  version: number;
  phase: "starting" | "ready" | "stopping" | "stopped" | "failed" | "unavailable";
  owner?: Owner;
  liveness?: "alive" | "dead" | "uncertain";
  responsive?: boolean;
  error?: string;
  /** Queued work with its policy reasons: at most 50 Stories, without the Stories that wait for no worker. */
  queue?: FactoryQueueEntry[];
  /** The count of daemon crashes in a row. The watchdog restarts the daemon after each crash below the limit. */
  restarts?: number;
  /** The time of the last daemon crash. */
  lastCrashAt?: string;
};

export interface FactoryQueueEntry {
  story: string;
  stage: string;
  action: "start" | "retry" | "skip";
  reason: string;
  retryAt?: string;
  /** The provider of the worker model of the Story, when one resolves. The TUI finds its pause with it. */
  provider?: string;
}

interface StartFactoryInput extends DaemonOptions {
  readonly timeoutMs?: number;
}

/** The status without a live owner. A watchdog can still start a daemon, or it stopped at the crash limit. */
async function ownerlessStatus(
  paths: ProjectPaths,
  status: FactoryStatus,
  watchdog: WatchdogState | undefined,
  restarts: RestartFields,
  phase: "stopped" | "failed",
): Promise<FactoryStatus> {
  if (await watchdogLive(paths)) {
    return { version: 1, phase: "starting", ...restarts };
  }

  if (watchdog?.phase === "failed") {
    return { ...status, ...restarts, phase: "failed", attention: [crashLimitAttention(watchdog)] };
  }

  return { ...status, ...restarts, phase };
}

/** Combines the owner lock, a liveness probe, the status file and the watchdog. A runtime problem gives `unavailable`. */
export async function getFactoryStatus(ctx: ServiceContext = {}): Promise<FactoryStatus> {
  const paths = await findProject(ctx);

  try {
    const owner = await readFactoryOwner(paths);
    const status = await readStatus(ctx);
    const watchdog = await readWatchdogState(paths);
    const restarts = restartFields(watchdog);

    if (!owner) {
      const phase = status.phase === "failed" ? "failed" : "stopped";

      return { ...(await ownerlessStatus(paths, status, watchdog, restarts, phase)), owner: undefined };
    }

    // The status is read often. The takeover and the commands below use the uncached probe.
    const liveness = await probeOwnerCached(owner);

    if (liveness === "dead") {
      return { ...(await ownerlessStatus(paths, status, watchdog, restarts, "stopped")), owner, liveness };
    }

    if (status.owner?.token !== owner.token) {
      return { version: 1, owner, phase: "starting", liveness, ...restarts };
    }

    return {
      ...status,
      ...restarts,
      owner,
      liveness,
      responsive: Date.now() - Date.parse(status.heartbeatAt) < 15_000,
    };
  } catch (error) {
    return { version: 1, phase: "unavailable", error: error instanceof Error ? error.message : "Runtime unavailable" };
  }
}

/** Polls the status until the new daemon is ready. A launch error or an early exit fails at once. */
async function waitForReady(input: StartFactoryInput, launch: Store<LaunchState>, ctx: ServiceContext) {
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);

  while (Date.now() < deadline) {
    const status = await getFactoryStatus(ctx);
    const { childError, exited } = launch.current;

    if (status.phase === "ready" && status.liveness === "alive" && status.owner) {
      return { ...status, owner: status.owner };
    }

    if (childError) {
      throw new ConflictError(`Factory launch failed: ${childError}`);
    }

    // A watchdog that exits while a different watchdog starts the daemon is not a failure: the phase is `starting`.
    if (exited && status.phase !== "starting" && (!status.owner || status.liveness === "dead")) {
      const logs = await getFactoryLogs({ tail: 10 }, ctx);

      throw new ConflictError(`Factory exited before ready. ${logs.lines.join("\n")}`);
    }

    await sleep(50);
  }

  throw new ConflictError("Factory readiness timed out; inspect factory status and logs before another start");
}

/** Starts a detached daemon when no live owner exists, and waits until it is ready. */
export async function startFactory(input: StartFactoryInput, ctx: ServiceContext = {}) {
  refuseRemoteWrite(ctx, "start the factory");

  const paths = await findProject(ctx);

  await prepareRuntime(paths);

  const existing = await readFactoryOwner(paths);

  if (existing && (await probeOwner(existing)) === "uncertain") {
    throw new ConflictError("Factory owner is uncertain; stop all factories before offline repair");
  }

  const launch = new Store<LaunchState>({ childError: undefined, exited: false });

  // A live watchdog in its back-off starts the daemon itself. A second watchdog is not necessary.
  if ((!existing || (await probeOwner(existing)) === "dead") && !(await watchdogLive(paths))) {
    await assertNoLegacyFactorySettings(paths);
    await launchDaemon(paths, input, launch);
  }

  return waitForReady(input, launch, ctx);
}

/** Publishes a command to the live daemon and waits for its receipt. A stop also waits for the owner release. */
export async function sendFactoryCommand(
  type: FactoryCommandType,
  input: { threadId?: string; attentionKey?: string; message?: string; storyId?: string; timeoutMs?: number } = {},
  ctx: ServiceContext = {},
) {
  const message = type === "steer" ? steerText(input.message) : undefined;
  const paths = await findProject(ctx);
  const owner = await readFactoryOwner(paths);

  if (!owner || (await probeOwner(owner)) !== "alive") {
    throw new ConflictError("Factory is not running", {
      hint: "Start the factory with rowbly factory start or with f then s in the TUI. Then retry the command.",
    });
  }

  const thread = input.threadId ? await getThread(input.threadId, ctx) : undefined;
  const command = await publishCommand(paths, {
    targetOwnerToken: owner.token,
    type,
    threadId: thread?.id,
    expectedRunId: thread?.runs.at(-1)?.id,
    attentionKey: input.attentionKey,
    message,
    storyId: input.storyId,
  });
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);

  while (Date.now() < deadline) {
    const receipt = await readReceipt(paths, command.id);

    if (receipt?.status === "rejected") {
      throw new ConflictError(receipt.error?.message ?? "Factory command rejected");
    }

    if (
      receipt?.status === "completed" &&
      (type !== "stop" || (await readFactoryOwner(paths))?.token !== owner.token)
    ) {
      return receipt;
    }

    await sleep(50);
  }

  throw new ConflictError(`Factory command timed out: ${command.id}`);
}

/** Gives the trimmed steering message, or throws a ValidationError when it is not valid. */
function steerText(message: string | undefined): string {
  assertSteerMessage(message);

  return message.trim();
}

/** Gives a message of a person to the running worker of the Thread, through the live daemon. */
export function steerThread(
  threadId: string,
  message: string,
  input: { timeoutMs?: number } = {},
  ctx: ServiceContext = {},
) {
  return sendFactoryCommand("steer", { ...input, threadId, message }, ctx);
}

/** Asks the live daemon to remove the attention entry `key` from its state and from the status file. */
export async function dismissFactoryAttention(
  key: string,
  input: { timeoutMs?: number } = {},
  ctx: ServiceContext = {},
) {
  if (!validAttentionKey(key)) {
    throw new ValidationError("An attention key of 1 to 128 characters is necessary");
  }

  return sendFactoryCommand("dismiss", { ...input, attentionKey: key }, ctx);
}

/**
 * Asks the live daemon to release the policy parking of a Story, so that the next pass can start a worker for it.
 * A Story that is not parked gives a success with no change.
 */
export async function releaseFactoryStory(
  storyId: string,
  input: { timeoutMs?: number } = {},
  ctx: ServiceContext = {},
) {
  if (!validStoryId(storyId)) {
    throw new ValidationError("A Story ID of 1 to 128 characters is necessary");
  }

  const receipt = await sendFactoryCommand("release-story", { ...input, storyId }, ctx);

  return { ...receipt, storyId };
}

/**
 * Stops the daemon and its watchdog. A watchdog without a live daemon, for example in its back-off, gets `SIGTERM`.
 * A factory that is already stopped gives `stopped` without a command.
 */
export async function stopFactory(input: { timeoutMs?: number } = {}, ctx: ServiceContext = {}) {
  const paths = await findProject(ctx);
  const timeoutMs = input.timeoutMs ?? 30_000;
  const owner = await readFactoryOwner(paths);

  if (owner && (await probeOwner(owner)) === "alive") {
    const receipt = await sendFactoryCommand("stop", input, ctx);

    await waitForActiveWatchdogExit(paths, timeoutMs);

    return receipt;
  }

  if (await stopWatchdog(paths, timeoutMs)) {
    return { phase: "stopped" };
  }

  const status = await getFactoryStatus(ctx);

  if (status.phase === "stopped" || (status.phase === "failed" && !status.owner)) {
    return { phase: "stopped" };
  }

  return sendFactoryCommand("stop", input, ctx);
}

/** Stops the daemon, waits for the owner release, and starts a new daemon. */
export async function restartFactory(input: Parameters<typeof startFactory>[0], ctx: ServiceContext = {}) {
  refuseRemoteWrite(ctx, "restart the factory");

  await stopFactory({ timeoutMs: input.timeoutMs }, ctx);

  return startFactory(input, ctx);
}
