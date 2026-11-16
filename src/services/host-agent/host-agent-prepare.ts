import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { missingCachedAttachments, readCachedAttachment } from "../attachment-cache/attachment-cache.js";
import { validateAttachmentId } from "../attachment-files/attachment-files.js";
import { isAttachmentFileName } from "../attachment-files/attachment-type.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import type { OwnerProbe } from "../factory-ownership/ownership-lock.js";
import { type ModelChoice, validModel } from "../factory-settings/factory-settings.js";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { ThreadRecord } from "../thread/thread.js";
import { validateThread } from "../thread/thread-validate.js";
import type { CopyAttachment, CopyFile } from "../thread-copy/thread-copy.js";
import {
  ensurePrivateDir,
  type HostAgentPaths,
  prepareAgentDirs,
  threadPaths,
  validateStoryId,
  validateThreadId,
} from "./host-agent-paths.js";
import { threadHasLiveSlot, withSlotLock } from "./host-slots.js";

/** The largest input of `host prepare`: 32 MiB. */
export const HOST_PREPARE_LIMIT = 32 * 1024 * 1024;

/** The input of `host prepare`, from the main machine. */
export interface HostPrepareInput {
  readonly threadId: string;
  readonly thread: ThreadRecord;
  readonly storyId: string;
  /** The clone on the host, from the host record. A relative path is relative to the home folder. */
  readonly clone: string;
  readonly model?: ModelChoice;
  /** The full worker message. The host does not change it. */
  readonly message: string;
  readonly copy: { readonly files: readonly CopyFile[]; readonly attachments: readonly CopyAttachment[] };
}

/** The content of `threads/<thread-id>/launch.json`: the data of the next `launch` or `resume`. */
export interface HostLaunchData {
  readonly version: 1;
  readonly threadId: string;
  readonly storyId: string;
  /** The absolute path of the clone. */
  readonly clone: string;
  readonly thread: ThreadRecord;
  readonly model?: ModelChoice;
  readonly message: string;
  readonly preparedAt: string;
}

/** The answer of `host prepare`. */
export interface HostPrepareResult {
  readonly threadId: string;
  readonly copy: string;
  readonly files: number;
  readonly attachments: number;
}

/** The options of `prepareHostThread`. Tests give a temporary home folder and a fake probe. */
export interface PrepareOptions {
  readonly home: string;
  readonly probe?: OwnerProbe;
}

function invalid(message: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { details });
}

/** Checks a path of the copy. It must be below `.rowbly/`, without `..`, and not a private runtime file. */
export function validateCopyPath(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith(".rowbly/") || path.includes("\\") || path.includes("\0")) {
    throw invalid("A copy path must be below .rowbly/", { path });
  }

  const parts = path.split("/").slice(1);
  const top = parts[0] ?? "";

  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw invalid("A copy path must not have empty, . or .. parts", { path });
  }

  if (top.startsWith("state.json") || top === "runtime") {
    throw invalid("A copy must not contain state.json or runtime/", { path });
  }

  return path;
}

function validFile(file: unknown): CopyFile {
  const { path, content } = (file ?? {}) as Partial<CopyFile>;

  if (typeof content !== "string") {
    throw invalid("Each copy file needs a path and a text content", { path });
  }

  return { path: validateCopyPath(path), content };
}

function validAttachment(attachment: unknown): CopyAttachment {
  const { storyId, id, file } = (attachment ?? {}) as Partial<CopyAttachment>;

  validateAttachmentId(id as string);

  if (!isAttachmentFileName(id as string, file)) {
    throw invalid("The file of an attachment must be its id with one safe extension", { id, file });
  }

  return { storyId: validateStoryId(storyId), id: id as string, file };
}

function validCopy(copy: unknown): HostPrepareInput["copy"] {
  const { files, attachments } = (copy ?? {}) as Partial<HostPrepareInput["copy"]>;

  if (!Array.isArray(files) || !Array.isArray(attachments)) {
    throw invalid('The copy must be { "files": [...], "attachments": [...] }');
  }

  const unique = new Map(attachments.map(validAttachment).map((item) => [`${item.storyId}/${item.id}`, item]));
  const valid = { files: files.map(validFile), attachments: [...unique.values()] };

  if (new Set(valid.files.map((file) => file.path)).size !== valid.files.length) {
    throw invalid("A copy path must not repeat");
  }

  return valid;
}

function validThread(thread: unknown, threadId: string, storyId: string): ThreadRecord {
  const record = validateThread(thread);

  if (record.id !== threadId || record.role !== "worker" || record.storyId !== storyId) {
    throw invalid("The Thread record must be the worker Thread of the Story", { threadId, storyId });
  }

  return record;
}

/** Checks the full input before the prepare writes a file. */
export function parsePrepareInput(value: unknown): HostPrepareInput {
  const input = (value ?? {}) as Partial<HostPrepareInput>;
  const threadId = validateThreadId(input.threadId);
  const storyId = validateStoryId(input.storyId);

  if (typeof input.clone !== "string" || input.clone.trim() === "" || typeof input.message !== "string") {
    throw invalid("The input needs a clone path and a worker message");
  }

  if (input.model !== undefined && !validModel(input.model)) {
    throw invalid("The worker model must be a model choice");
  }

  const thread = validThread(input.thread, threadId, storyId);

  return {
    ...input,
    threadId,
    storyId,
    thread,
    clone: input.clone,
    message: input.message,
    copy: validCopy(input.copy),
  };
}

async function checkCache(paths: HostAgentPaths, attachments: readonly CopyAttachment[]): Promise<void> {
  const ids = attachments.map((attachment) => attachment.id);
  const missing = await missingCachedAttachments({ dir: paths.attachments, ids });

  if (missing.length > 0) {
    throw invalid(`The attachment cache does not have ${missing.length} attachment(s)`, { missing });
  }
}

/** Writes one file of the copy with mode 0600. Its folders get mode 0700. */
async function writeCopyFile(root: string, path: string, content: string | Uint8Array): Promise<void> {
  const target = join(root, path);

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { mode: 0o600, flag: "wx" });
  await chmod(target, 0o600);
}

async function writeAttachment(paths: HostAgentPaths, root: string, attachment: CopyAttachment): Promise<void> {
  const bytes = await readCachedAttachment({ dir: paths.attachments, id: attachment.id });

  await writeCopyFile(root, `.rowbly/attachments/${attachment.storyId}/${attachment.file}`, bytes);
}

/** Writes the copy to a new folder, then puts it in place of `copy/`. A failure leaves the old copy. */
async function writeCopy(paths: HostAgentPaths, input: HostPrepareInput): Promise<string> {
  const files = threadPaths(paths, input.threadId);
  const temporary = join(files.dir, `.copy-${randomUUID()}`);
  const old = join(files.dir, `.old-${randomUUID()}`);

  await ensurePrivateDir(files.dir);

  try {
    await mkdir(temporary, { mode: 0o700 });
    await mapInOrder(input.copy.files, (file) => writeCopyFile(temporary, file.path, file.content));
    await mapInOrder(input.copy.attachments, (attachment) => writeAttachment(paths, temporary, attachment));

    if (await pathExists(files.copy)) {
      await rename(files.copy, old);
    }

    await rename(temporary, files.copy);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(old, { recursive: true, force: true });
  }

  return files.copy;
}

function launchData(input: HostPrepareInput, home: string): HostLaunchData {
  return {
    version: 1,
    threadId: input.threadId,
    storyId: input.storyId,
    clone: resolve(home, input.clone),
    thread: input.thread,
    ...(input.model ? { model: input.model } : {}),
    message: input.message,
    preparedAt: new Date().toISOString(),
  };
}

/** Refuses a prepare while the Thread has active work. The caller holds the slot lock. */
async function checkIdle(paths: HostAgentPaths, threadId: string, options: PrepareOptions): Promise<void> {
  const key = { projectId: paths.projectId, threadId };

  if (await threadHasLiveSlot(key, { home: options.home, probe: options.probe })) {
    throw new ConflictError(`Thread ${threadId} has active work on this host`);
  }
}

async function writePrepared(paths: HostAgentPaths, input: HostPrepareInput, options: PrepareOptions) {
  await checkIdle(paths, input.threadId, options);

  const copy = await writeCopy(paths, input);

  await writeFileAtomic(
    threadPaths(paths, input.threadId).launch,
    `${JSON.stringify(launchData(input, options.home))}\n`,
    {
      mode: 0o600,
      durable: true,
    },
  );

  return copy;
}

/**
 * Writes the copy of the main machine to `threads/<thread-id>/copy/` and records the launch data. It checks the full
 * input and the attachment cache first, and it holds the slot lock, so that no work of the Thread starts during the write.
 */
export async function prepareHostThread(
  paths: HostAgentPaths,
  value: unknown,
  options: PrepareOptions,
): Promise<HostPrepareResult> {
  const input = parsePrepareInput(value);

  await prepareAgentDirs(paths);
  await checkCache(paths, input.copy.attachments);

  const copy = await withSlotLock(() => writePrepared(paths, input, options), options.home);

  return { threadId: input.threadId, copy, files: input.copy.files.length, attachments: input.copy.attachments.length };
}

/** Reads the launch data of the Thread. A Thread without a prepare gives a NotFoundError. */
export async function readLaunchData(paths: HostAgentPaths, threadId: string): Promise<HostLaunchData> {
  const files = threadPaths(paths, threadId);

  try {
    const data = JSON.parse(await readFile(files.launch, "utf8")) as HostLaunchData;

    if (data?.version !== 1 || data.threadId !== threadId || !(await pathExists(files.copy))) {
      throw new NotFoundError(`Thread ${threadId} is not prepared on this host`);
    }

    return data;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new NotFoundError(`Thread ${threadId} is not prepared on this host`);
    }

    throw error;
  }
}
