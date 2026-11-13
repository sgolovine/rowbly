import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

export interface FactoryCommand {
  version: 1;
  id: string;
  targetOwnerToken: string;
  type: "stop" | "cancel" | "resume";
  threadId?: string;
  expectedRunId?: string;
  createdAt: string;
}
export interface CommandReceipt {
  version: 1;
  id: string;
  ownerToken: string;
  status: "accepted" | "completed" | "rejected";
  threadId?: string;
  error?: { code: string; message: string };
}
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
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
export async function writeReceipt(paths: ProjectPaths, receipt: CommandReceipt) {
  await writeFileAtomic(await runtimePath(paths, `receipts/${receipt.id}.json`), `${JSON.stringify(receipt)}\n`, {
    mode: 0o600,
    durable: true,
  });
}
export async function publishCommand(paths: ProjectPaths, input: Omit<FactoryCommand, "id" | "version" | "createdAt">) {
  const command: FactoryCommand = { ...input, version: 1, id: randomUUID(), createdAt: new Date().toISOString() };
  await writeFileAtomic(await runtimePath(paths, `control/${command.id}.json`), `${JSON.stringify(command)}\n`, {
    mode: 0o600,
    durable: true,
  });
  return command;
}
/** One caller serializes scans. Receipts retain command results across daemon restarts. */
export async function processCommands(
  paths: ProjectPaths,
  token: string,
  execute: (command: FactoryCommand) => Promise<void>,
) {
  for (const file of (await readdir(await runtimePath(paths, "control"))).filter((f) => f.endsWith(".json")).sort()) {
    const id = file.slice(0, -5);
    if (!validId(id)) {
      continue;
    }
    let previous: CommandReceipt | undefined;
    try {
      previous = await readReceipt(paths, id);
    } catch {
      continue;
    } // Preserve a corrupt receipt and continue other commands.
    if (previous && previous.status !== "accepted") {
      continue;
    }
    let command: FactoryCommand | undefined;
    try {
      const path = await runtimePath(paths, `control/${file}`);
      if ((await stat(path)).size > 4096) {
        throw new ValidationError("Command is too large");
      }
      command = JSON.parse(await readFile(path, "utf8"));
      if (
        command?.version !== 1 ||
        command.id !== id ||
        !["stop", "cancel", "resume"].includes(command.type) ||
        !Number.isFinite(Date.parse(command.createdAt))
      ) {
        throw new ValidationError("Invalid factory command");
      }
      if (command.targetOwnerToken !== token) {
        throw new ConflictError("Factory owner changed");
      }
      await writeReceipt(paths, { version: 1, id, ownerToken: token, status: "accepted", threadId: command.threadId });
      await execute(command);
      await writeReceipt(paths, { version: 1, id, ownerToken: token, status: "completed", threadId: command.threadId });
    } catch (error) {
      await writeReceipt(paths, {
        version: 1,
        id,
        ownerToken: token,
        status: "rejected",
        threadId: command?.threadId,
        error: {
          code: "COMMAND_REJECTED",
          message: (error instanceof Error ? error.message : "Command failed").slice(0, 1000),
        },
      });
    }
  }
}

/** Keeps commands from only the current and previous owner generations. */
export async function pruneFactoryCommands(paths: ProjectPaths, tokens: string[]) {
  const { unlink } = await import("node:fs/promises");
  for (const file of (await readdir(await runtimePath(paths, "control"))).filter((f) => /^[\w-]+\.json$/.test(f))) {
    const path = await runtimePath(paths, `control/${file}`);
    let command: FactoryCommand;
    try {
      if ((await stat(path)).size > 4096) {
        continue;
      }
      command = JSON.parse(await readFile(path, "utf8"));
      if (command?.version !== 1 || command.id !== file.slice(0, -5) || typeof command.targetOwnerToken !== "string") {
        continue;
      }
    } catch {
      continue;
    }
    if (tokens.includes(command.targetOwnerToken)) {
      continue;
    }
    const receiptPath = await runtimePath(paths, `receipts/${file}`);
    // Preserve malformed receipts for offline inspection.
    try {
      await readReceipt(paths, command.id);
    } catch {
      continue;
    }
    await unlink(receiptPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
    await unlink(path);
  }
}
