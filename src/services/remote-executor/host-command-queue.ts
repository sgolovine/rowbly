// The durable queue of the commands for one worker host, in `runtime/hosts/<host>/commands.json`. A command waits in
// the queue while it cannot go to the host. It leaves the queue only after the host gave its receipt.

import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../files/files.js";
import { hostDir, preparedHostDir } from "../outbox-apply/host-files.js";
import { runtimeChild } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import type { CommandType } from "./remote-calls.js";

const QUEUE_FILE = "commands.json";

/** One command in the queue. It keeps its request id, so a second send has one effect on the host. */
export interface QueuedCommand {
  readonly id: string;
  readonly type: CommandType;
  readonly threadId: string;
  readonly queuedAt: string;
}

/** The content of `commands.json`. */
interface QueueFile {
  readonly version: 1;
  readonly commands: readonly QueuedCommand[];
}

const TYPES: readonly string[] = ["launch", "resume", "stop-thread", "cancel-thread"];

function isQueuedCommand(value: unknown): value is QueuedCommand {
  const command = value as Partial<QueuedCommand> | null;

  return (
    typeof command === "object" &&
    command !== null &&
    typeof command.id === "string" &&
    typeof command.threadId === "string" &&
    typeof command.queuedAt === "string" &&
    TYPES.includes(command.type as string)
  );
}

/** Gives the commands of the file text. A text that is not a queue gives no commands. */
function parseQueue(text: string): QueuedCommand[] {
  try {
    const value = JSON.parse(text) as Partial<QueueFile> | null;

    return value?.version === 1 && Array.isArray(value.commands) ? value.commands.filter(isQueuedCommand) : [];
  } catch {
    return [];
  }
}

/** Reads the queue of the host, in the order of arrival. A missing file gives an empty queue. */
export async function readCommandQueue(paths: ProjectPaths, host: string): Promise<readonly QueuedCommand[]> {
  const file = await runtimeChild(await hostDir(paths, host), QUEUE_FILE);

  try {
    return parseQueue(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

/** Writes the queue of the host to the disk before it returns, with mode 0600 in folders with mode 0700. */
async function writeCommandQueue(paths: ProjectPaths, host: string, commands: readonly QueuedCommand[]): Promise<void> {
  const file = await runtimeChild(await preparedHostDir(paths, host), QUEUE_FILE);
  const content: QueueFile = { version: 1, commands };

  await writeFileAtomic(file, `${JSON.stringify(content)}\n`, { mode: 0o600, durable: true });
}

/** True when the command stops or cancels a Thread. */
export function isStopCommand(command: Pick<QueuedCommand, "type">): boolean {
  return command.type === "stop-thread" || command.type === "cancel-thread";
}

/**
 * Gives the queue after a new command. A command with the same id does not go in two times. A stop or a cancel of a
 * Thread removes the launch and the resume of that Thread, because the main machine no longer wants that run.
 */
export function withQueuedCommand(commands: readonly QueuedCommand[], command: QueuedCommand): QueuedCommand[] {
  if (commands.some((entry) => entry.id === command.id)) {
    return [...commands];
  }

  const kept = isStopCommand(command)
    ? commands.filter((entry) => isStopCommand(entry) || entry.threadId !== command.threadId)
    : commands;

  return [...kept, command];
}

/** Adds a command to the queue of the host. Gives the queue after the change. */
export async function queueCommand(
  paths: ProjectPaths,
  host: string,
  command: QueuedCommand,
): Promise<readonly QueuedCommand[]> {
  const commands = withQueuedCommand(await readCommandQueue(paths, host), command);

  await writeCommandQueue(paths, host, commands);

  return commands;
}

/** Removes a command from the queue of the host, after the host gave its receipt. */
export async function removeQueuedCommand(paths: ProjectPaths, host: string, id: string): Promise<void> {
  const commands = await readCommandQueue(paths, host);

  if (!commands.some((entry) => entry.id === id)) {
    return;
  }

  await writeCommandQueue(
    paths,
    host,
    commands.filter((entry) => entry.id !== id),
  );
}

/** Gives the order of the sends on reconnect: each stop and cancel in the order of arrival, then the other commands. */
export function sendOrder(commands: readonly QueuedCommand[]): QueuedCommand[] {
  return [...commands.filter(isStopCommand), ...commands.filter((command) => !isStopCommand(command))];
}
