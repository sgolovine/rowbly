import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** A durable request to the native daemon. Only the daemon of the target owner runs it. */
export interface FactoryCommand {
  version: 1;
  id: string;
  targetOwnerToken: string;
  type: FactoryCommandType;
  threadId?: string;
  expectedRunId?: string;
  /** The key of the attention entry that a `dismiss` removes. */
  attentionKey?: string;
  createdAt: string;
}

/** The kinds of request that the daemon runs. */
export type FactoryCommandType = "stop" | "cancel" | "resume" | "dismiss";

const COMMAND_TYPES: readonly string[] = ["stop", "cancel", "resume", "dismiss"];

export interface CommandReceipt {
  version: 1;
  id: string;
  ownerToken: string;
  status: "accepted" | "completed" | "rejected";
  threadId?: string;
  error?: { code: string; message: string };
}
/** A command file after the read. `failure` holds the error of a file that cannot be read or parsed. */
interface LoadedCommand {
  readonly command: FactoryCommand | undefined;
  readonly failure?: { readonly error: unknown };
}

type Unlink = typeof import("node:fs/promises").unlink;

function validId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/** True for an attention key of 1 to 128 characters. */
export function validAttentionKey(key: unknown): key is string {
  return typeof key === "string" && key.length >= 1 && key.length <= 128;
}

/** Reads a command receipt. An absent receipt gives `undefined`; a malformed receipt gives a ValidationError. */
export async function readReceipt(paths: ProjectPaths, id: string): Promise<CommandReceipt | undefined> {
  if (!validId(id)) {
    throw new ValidationError("Invalid request ID");
  }

  try {
    const value = JSON.parse(await readFile(await runtimePath(paths, `receipts/${id}.json`), "utf8"));

    if (value.version !== 1 || value.id !== id || !["accepted", "completed", "rejected"].includes(value.status)) {
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

async function writeReceipt(paths: ProjectPaths, receipt: CommandReceipt) {
  await writeFileAtomic(await runtimePath(paths, `receipts/${receipt.id}.json`), `${JSON.stringify(receipt)}\n`, {
    mode: 0o600,
    durable: true,
  });
}

/** Writes a durable command for the daemon of the target owner. */
export async function publishCommand(paths: ProjectPaths, input: Omit<FactoryCommand, "id" | "version" | "createdAt">) {
  const command: FactoryCommand = { ...input, version: 1, id: randomUUID(), createdAt: new Date().toISOString() };

  await writeFileAtomic(await runtimePath(paths, `control/${command.id}.json`), `${JSON.stringify(command)}\n`, {
    mode: 0o600,
    durable: true,
  });

  return command;
}

/** A corrupt receipt stays for inspection, and its command does not run again. A settled command does not run again. */
async function isSettled(paths: ProjectPaths, id: string): Promise<boolean> {
  try {
    const previous = await readReceipt(paths, id);

    return !!previous && previous.status !== "accepted";
  } catch {
    return true;
  }
}

async function loadCommand(paths: ProjectPaths, file: string): Promise<LoadedCommand> {
  try {
    const path = await runtimePath(paths, `control/${file}`);

    if ((await stat(path)).size > 4096) {
      throw new ValidationError("Command is too large");
    }

    return { command: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return { command: undefined, failure: { error } };
  }
}

/** Gives the command when it is valid and targets the current owner. Otherwise throws the reason. */
function acceptedCommand(loaded: LoadedCommand, id: string, token: string): FactoryCommand {
  const { command, failure } = loaded;

  if (failure) {
    throw failure.error;
  }

  if (
    command?.version !== 1 ||
    command.id !== id ||
    !COMMAND_TYPES.includes(command.type) ||
    !Number.isFinite(Date.parse(command.createdAt))
  ) {
    throw new ValidationError("Invalid factory command");
  }

  if (command.type === "dismiss" && !validAttentionKey(command.attentionKey)) {
    throw new ValidationError("An attention key of 1 to 128 characters is necessary");
  }

  if (command.targetOwnerToken !== token) {
    throw new ConflictError("Factory owner changed");
  }

  return command;
}

async function processCommand(
  paths: ProjectPaths,
  token: string,
  execute: (command: FactoryCommand) => Promise<void>,
  file: string,
): Promise<void> {
  const id = file.slice(0, -5);

  if (!validId(id) || (await isSettled(paths, id))) {
    return;
  }

  const loaded = await loadCommand(paths, file);

  try {
    const command = acceptedCommand(loaded, id, token);

    await writeReceipt(paths, { version: 1, id, ownerToken: token, status: "accepted", threadId: command.threadId });
    await execute(command);
    await writeReceipt(paths, { version: 1, id, ownerToken: token, status: "completed", threadId: command.threadId });
  } catch (error) {
    await writeReceipt(paths, {
      version: 1,
      id,
      ownerToken: token,
      status: "rejected",
      threadId: loaded.command?.threadId,
      error: {
        code: "COMMAND_REJECTED",
        message: (error instanceof Error ? error.message : "Command failed").slice(0, 1000),
      },
    });
  }
}

/** One caller serializes scans. Receipts retain command results across daemon restarts. */
export async function processCommands(
  paths: ProjectPaths,
  token: string,
  execute: (command: FactoryCommand) => Promise<void>,
) {
  const files = (await readdir(await runtimePath(paths, "control"))).filter((f) => f.endsWith(".json")).toSorted();

  await mapInOrder(files, (file) => processCommand(paths, token, execute, file));
}

/** Gives a well-formed command of at most 4096 bytes. Any other file gives `undefined`. */
async function readPrunable(path: string, file: string): Promise<FactoryCommand | undefined> {
  try {
    if ((await stat(path)).size > 4096) {
      return undefined;
    }

    const command: FactoryCommand = JSON.parse(await readFile(path, "utf8"));

    if (command?.version !== 1 || command.id !== file.slice(0, -5) || typeof command.targetOwnerToken !== "string") {
      return undefined;
    }

    return command;
  } catch {
    return undefined;
  }
}

async function pruneCommand(paths: ProjectPaths, tokens: string[], file: string, unlink: Unlink): Promise<void> {
  const path = await runtimePath(paths, `control/${file}`);
  const command = await readPrunable(path, file);

  if (!command || tokens.includes(command.targetOwnerToken)) {
    return;
  }

  const receiptPath = await runtimePath(paths, `receipts/${file}`);
  // Preserve malformed receipts for offline inspection.
  const readable = await readReceipt(paths, command.id).then(
    () => true,
    () => false,
  );

  if (!readable) {
    return;
  }

  await unlink(receiptPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  await unlink(path);
}

/** Keeps commands from only the current and previous owner generations. */
export async function pruneFactoryCommands(paths: ProjectPaths, tokens: string[]) {
  const { unlink } = await import("node:fs/promises");
  const files = (await readdir(await runtimePath(paths, "control"))).filter((f) => /^[\w-]+\.json$/.test(f));

  await mapInOrder(files, (file) => pruneCommand(paths, tokens, file, unlink));
}
