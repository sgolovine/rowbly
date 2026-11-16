import { randomUUID } from "node:crypto";
import { link, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { RowblyError, ValidationError } from "../errors/errors.js";
import { syncDirectory, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type HostAgentPaths, prepareAgentDirs, validRequestId } from "./host-agent-paths.js";

/** The kinds of command that the host agent runs. `stop` stops the full agent. */
export type HostCommandType = "launch" | "resume" | "stop-thread" | "cancel-thread" | "stop";

const COMMAND_TYPES: readonly string[] = ["launch", "resume", "stop-thread", "cancel-thread", "stop"];

/** The command types that act on one Thread. Each needs a `threadId`. */
const THREAD_COMMANDS: readonly string[] = ["launch", "resume", "stop-thread", "cancel-thread"];

/** A durable command from the main machine. The main machine makes the id. */
export interface HostCommand {
  readonly version: 1;
  readonly id: string;
  readonly type: HostCommandType;
  /** The Thread of a `launch`, `resume`, `stop-thread` or `cancel-thread`. */
  readonly threadId?: string;
  /** Free data of a `launch`. The runner reads its data from the prepare step, not from the payload. */
  readonly payload?: Record<string, unknown>;
}

/** The durable result of a command. A settled receipt is `completed` or `rejected`. */
export interface HostReceipt {
  readonly version: 1;
  readonly id: string;
  readonly ownerToken: string;
  readonly status: "accepted" | "completed" | "rejected";
  readonly threadId?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/** The maximum size of a command file. */
export const HOST_COMMAND_LIMIT = 65_536;

/** A command file after the read. `failure` holds the error of a file that cannot be read or parsed. */
interface LoadedCommand {
  readonly command: Partial<HostCommand> | undefined;
  readonly failure?: { readonly error: unknown };
}

export { validRequestId } from "./host-agent-paths.js";

function receiptPath(paths: HostAgentPaths, id: string): string {
  return join(paths.receipts, `${id}.json`);
}

function commandPath(paths: HostAgentPaths, id: string): string {
  return join(paths.control, `${id}.json`);
}

/** Reads a receipt. An absent receipt gives `undefined`; a malformed receipt gives a ValidationError. */
export async function readHostReceipt(paths: HostAgentPaths, id: string): Promise<HostReceipt | undefined> {
  if (!validRequestId(id)) {
    throw new ValidationError("Invalid request ID");
  }

  try {
    const value = JSON.parse(await readFile(receiptPath(paths, id), "utf8"));

    if (value?.version !== 1 || value.id !== id || !["accepted", "completed", "rejected"].includes(value.status)) {
      throw new ValidationError("Invalid command receipt");
    }

    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function writeReceipt(paths: HostAgentPaths, receipt: HostReceipt): Promise<void> {
  await writeFileAtomic(receiptPath(paths, receipt.id), `${JSON.stringify(receipt)}\n`, {
    mode: 0o600,
    durable: true,
  });
}

/** Gives the id of the command text. A text without a valid id cannot have a file, so it gives a ValidationError. */
function commandId(text: string): string {
  if (Buffer.byteLength(text, "utf8") > HOST_COMMAND_LIMIT) {
    throw new ValidationError(`A host command must not be larger than ${HOST_COMMAND_LIMIT} bytes`);
  }

  const parsed = parseJson(text);
  const id = (parsed as { id?: unknown } | null)?.id;

  if (!validRequestId(id)) {
    throw new ValidationError("A host command must have an id of 1 to 128 characters A-Z, a-z, 0-9, _ or -");
  }

  return id;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("A host command must be JSON");
  }
}

async function writeSynced(path: string, text: string): Promise<void> {
  const file = await open(path, "wx", 0o600);

  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}

function ignoreExists(error: NodeJS.ErrnoException): void {
  if (error.code !== "EEXIST") {
    throw error;
  }
}

/** Writes the full file to a temporary name, then links it to the command path. The link fails when it exists. */
async function createExclusive(paths: HostAgentPaths, id: string, text: string): Promise<void> {
  const temp = join(paths.control, `.${randomUUID()}.tmp`);
  try {
    await writeSynced(temp, text);
    await link(temp, commandPath(paths, id)).catch(ignoreExists);
    await syncDirectory(paths.control);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

/**
 * Writes the command to `control/<id>.json` durably, and gives the current receipt of the id or `null`. A command
 * file that exists does not change, so a command that arrives two times has one effect. The agent validates the
 * type and the fields, and rejects a bad command with a receipt.
 */
export async function submitHostCommand(paths: HostAgentPaths, text: string): Promise<HostReceipt | null> {
  const id = commandId(text);

  await prepareAgentDirs(paths);
  await createExclusive(paths, id, text.endsWith("\n") ? text : `${text}\n`);

  return (await readHostReceipt(paths, id)) ?? null;
}

/** A corrupt receipt stays for inspection, and its command does not run again. A settled command does not run again. */
async function isSettled(paths: HostAgentPaths, id: string): Promise<boolean> {
  try {
    const previous = await readHostReceipt(paths, id);

    return !!previous && previous.status !== "accepted";
  } catch {
    return true;
  }
}

async function loadCommand(paths: HostAgentPaths, id: string): Promise<LoadedCommand> {
  try {
    const path = commandPath(paths, id);

    if ((await stat(path)).size > HOST_COMMAND_LIMIT) {
      throw new ValidationError("Command is too large");
    }

    return { command: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return { command: undefined, failure: { error } };
  }
}

function validPayload(payload: unknown): boolean {
  return payload === undefined || (typeof payload === "object" && payload !== null && !Array.isArray(payload));
}

/** Gives the command when it is valid. Otherwise throws the reason. */
function acceptedCommand(loaded: LoadedCommand, id: string): HostCommand {
  const { command, failure } = loaded;

  if (failure) {
    throw failure.error;
  }

  if (command?.version !== 1 || command.id !== id || !COMMAND_TYPES.includes(command.type as string)) {
    throw new ValidationError("Invalid host command");
  }

  if (THREAD_COMMANDS.includes(command.type as string) && !validRequestId(command.threadId)) {
    throw new ValidationError(`A ${command.type} command needs a valid threadId`);
  }

  if (!validPayload(command.payload)) {
    throw new ValidationError("The payload of a command must be an object");
  }

  return command as HostCommand;
}

function rejection(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof RowblyError ? error.code : "COMMAND_REJECTED",
    message: (error instanceof Error ? error.message : "Command failed").slice(0, 1000),
  };
}

async function processCommand(
  paths: HostAgentPaths,
  token: string,
  execute: (command: HostCommand) => Promise<void>,
  id: string,
): Promise<void> {
  if (await isSettled(paths, id)) {
    return;
  }

  const loaded = await loadCommand(paths, id);
  const threadId = validRequestId(loaded.command?.threadId) ? loaded.command.threadId : undefined;
  const base = { version: 1, id, ownerToken: token, threadId } as const;

  try {
    const command = acceptedCommand(loaded, id);

    await writeReceipt(paths, { ...base, status: "accepted" });
    await execute(command);
    await writeReceipt(paths, { ...base, status: "completed" });
  } catch (error) {
    await writeReceipt(paths, { ...base, status: "rejected", error: rejection(error) });
  }
}

/** The ids of the command files, in order. A file without a valid id is skipped. */
async function commandIds(paths: HostAgentPaths): Promise<string[]> {
  const files = await readdir(paths.control).catch(() => [] as string[]);

  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .filter(validRequestId)
    .toSorted();
}

/** Runs each command without a settled receipt, one at a time. One caller serializes the scans. */
export async function processHostCommands(
  paths: HostAgentPaths,
  token: string,
  execute: (command: HostCommand) => Promise<void>,
): Promise<void> {
  await mapInOrder(await commandIds(paths), (id) => processCommand(paths, token, execute, id));
}

/** The number of commands that have no settled receipt. */
export async function pendingCommandCount(paths: HostAgentPaths): Promise<number> {
  const settled = await mapInOrder(await commandIds(paths), (id) => isSettled(paths, id));

  return settled.filter((value) => !value).length;
}
