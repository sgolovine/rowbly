// The commands of the executor for the host agent: the target of a host, the submit of a stop, and the durable queue
// of the commands that cannot go to the host now.

import { mapInOrder } from "../in-order/in-order.js";
import {
  type QueuedCommand,
  queueCommand,
  readCommandQueue,
  removeQueuedCommand,
  sendOrder,
} from "./host-command-queue.js";
import { type CallTarget, type CommandType, isTransportError, newCommandId, submit } from "./remote-calls.js";
import { failRun, type RunHooks, takeReceipt } from "./remote-run.js";
import type { RemoteEnv, RemoteRun } from "./remote-types.js";
import { catchUpRun } from "./session-mirror.js";

/** Gives the target of the calls to a host. */
export async function targetOf(env: RemoteEnv, host: string): Promise<CallTarget> {
  return { connection: await env.input.connect(host), projectId: env.input.projectId };
}

/** Submits `stop-thread` or `cancel-thread` for the run. */
export async function stopOnHost(env: RemoteEnv, run: RemoteRun, type: "stop-thread" | "cancel-thread"): Promise<void> {
  await submit(await targetOf(env, run.host), type, run.threadId);
}

/** The actions of the executor that a run uses. */
export function hooksOf(env: RemoteEnv): RunHooks {
  return {
    sync: env.input.sync,
    stopHost: (run) => stopOnHost(env, run, "stop-thread"),
    catchUp: (run) => catchUpRun(env, run),
  };
}

/** Runs a change of a queue file after the earlier changes, so that two changes do not lose a command. */
function withQueueLock<T>(env: RemoteEnv, action: () => Promise<T>): Promise<T> {
  const next = env.state.current.queueChain.then(action);

  env.state.update(() => ({
    queueChain: next.then(
      () => undefined,
      () => undefined,
    ),
  }));

  return next;
}

/** Puts a command in the durable queue of the host. The id stays, so that a second send has one effect. */
export async function enqueueCommand(
  env: RemoteEnv,
  host: string,
  command: { readonly type: CommandType; readonly threadId: string; readonly id?: string },
): Promise<void> {
  const queued: QueuedCommand = {
    id: command.id ?? newCommandId(),
    type: command.type,
    threadId: command.threadId,
    queuedAt: new Date().toISOString(),
  };

  await withQueueLock(env, () => queueCommand(env.input.paths, host, queued));
}

/** Gives the commands in the queue of the host. */
export function queuedCommands(env: RemoteEnv, host: string): Promise<readonly QueuedCommand[]> {
  return withQueueLock(env, () => readCommandQueue(env.input.paths, host));
}

/** Gives the receipt to the run whose `launch` or `resume` the command is. */
function settleLaunch(env: RemoteEnv, command: QueuedCommand, receipt: Awaited<ReturnType<typeof submit>>): void {
  const run = env.state.current.runs.get(command.threadId);

  if (!run || run.store.current.commandId !== command.id) {
    return;
  }

  run.store.update(() => ({ launchQueued: false }));

  if (receipt) {
    takeReceipt(run, receipt);
  }
}

/** Fails the run whose queued `launch` or `resume` the host refused. */
async function refuseLaunch(env: RemoteEnv, command: QueuedCommand, error: unknown): Promise<void> {
  const run = env.state.current.runs.get(command.threadId);

  if (run?.store.current.commandId === command.id) {
    await failRun(run, { error, sessionOpened: run.store.current.sessionOpened });
  }
}

/**
 * Sends one queued command. It leaves the queue after the host gave its receipt, or after the host refused it. A
 * transport error throws, and the command stays in the queue.
 */
async function sendQueuedCommand(env: RemoteEnv, target: CallTarget, host: string, command: QueuedCommand) {
  try {
    const receipt = await submit(target, command.type, command.threadId, command.id);

    await withQueueLock(env, () => removeQueuedCommand(env.input.paths, host, command.id));
    settleLaunch(env, command, receipt);
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }

    await withQueueLock(env, () => removeQueuedCommand(env.input.paths, host, command.id));
    await refuseLaunch(env, command, error);
  }
}

/** Sends the queue of the host: each stop and cancel in the order of arrival first, then the other commands. */
export async function sendQueued(env: RemoteEnv, target: CallTarget, host: string): Promise<void> {
  const commands = sendOrder(await queuedCommands(env, host));

  await mapInOrder(commands, (command) => sendQueuedCommand(env, target, host, command));
}
