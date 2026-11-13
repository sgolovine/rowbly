import type { Stats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { Store } from "../store/store.js";
import { type BranchPage, newerPage, olderPage, type PageBounds } from "./session-branch.js";
import { displayEntry, oversizedEntry } from "./session-display.js";
import { type ScanView, SessionScanner } from "./session-scanner.js";
import { type ConversationEntry, type ConversationPage, type EntryIndex, MAX_ENTRY_BYTES } from "./session-types.js";

export type { ConversationEntry, ConversationPage } from "./session-types.js";
export { MAX_ENTRY_BYTES } from "./session-types.js";

interface PageInput {
  readonly before?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
  readonly maxBytes?: number;
  readonly leaf?: string;
}

interface FileTimes {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

/** The state of one index. A reset replaces the scanner and forgets the file. */
interface IndexState {
  readonly scanner: SessionScanner;
  readonly identity: string | null;
  readonly previous: FileTimes | null;
  readonly closed: boolean;
}

interface IndexDiagnostics {
  readonly entries: number;
  readonly pendingBytes: number;
  readonly retainedBytes: number;
  readonly closed: boolean;
}

/** The fixed environment of one index, and the store of its state. */
interface IndexEnv {
  readonly file: string;
  readonly validatePath: () => Promise<unknown>;
  readonly store: Store<IndexState>;
}

const MAX_PAGE_BYTES = 512 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

async function skipValidation(): Promise<void> {}

function emptyState(): Omit<IndexState, "closed"> {
  return { scanner: new SessionScanner(), identity: null, previous: null };
}

function resetIndex(index: IndexEnv): void {
  index.store.update(() => emptyState());
}

function fileIdentity(stats: Stats): string {
  return `${stats.dev}:${stats.ino}`;
}

/** Tells if the file is not the file that the index read, or if a writer replaced its bytes. */
function isReplaced(state: IndexState, stats: Stats): boolean {
  const { previous } = state;
  const touched =
    stats.size === previous?.size && (stats.mtimeMs !== previous.mtimeMs || stats.ctimeMs !== previous.ctimeMs);

  return fileIdentity(stats) !== state.identity || stats.size < state.scanner.offset || touched;
}

function openIfPresent(file: string): Promise<FileHandle | null> {
  return open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });
}

/** Reads the file from the scanner offset to `size`. A file that became shorter ends the scan early. */
async function scanChunks(fd: FileHandle, scanner: SessionScanner, size: number): Promise<void> {
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);

  while (scanner.offset < size) {
    const { bytesRead } = await fd.read(buffer, 0, Math.min(buffer.length, size - scanner.offset), scanner.offset);

    if (!bytesRead) {
      return;
    }

    scanner.scan(buffer, bytesRead);
  }
}

/** Indexes the bytes that the file has after the last scan. A replaced file starts a new scan. */
async function scanFile(index: IndexEnv, fd: FileHandle): Promise<void> {
  const stats = await fd.stat();
  const current = index.store.current;

  if (current.identity && isReplaced(current, stats)) {
    resetIndex(index);
  }

  const { scanner } = index.store.update(() => ({ identity: fileIdentity(stats) }));

  await scanChunks(fd, scanner, stats.size);
  index.store.update(() => ({ previous: { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs } }));
}

async function refreshIndex(index: IndexEnv): Promise<void> {
  if (index.store.current.closed) {
    throw new ValidationError("Conversation is closed");
  }

  await index.validatePath();

  const fd = await openIfPresent(index.file);

  if (!fd) {
    resetIndex(index);

    return;
  }

  try {
    await scanFile(index, fd);
  } finally {
    await fd.close();
  }
}

function pageBounds(input: PageInput): PageBounds {
  const limit = input.limit ?? 20;
  const maxBytes = input.maxBytes ?? MAX_PAGE_BYTES;
  const validLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 100;
  const validBytes = Number.isSafeInteger(maxBytes) && maxBytes >= 1 && maxBytes <= MAX_PAGE_BYTES;

  if (!validLimit || !validBytes) {
    throw new ValidationError("Invalid conversation page bounds");
  }

  return { limit, maxBytes };
}

function selectBranch(scan: ScanView, input: PageInput, bounds: PageBounds): BranchPage {
  const cursor = input.before ?? input.after;
  const leaf = input.leaf ?? scan.leaf;

  if (input.before && input.after) {
    throw new ValidationError("Use one conversation cursor");
  }

  if (cursor && !scan.byId.has(cursor)) {
    throw new ValidationError("Conversation cursor is no longer available");
  }

  if (input.after) {
    return newerPage(scan.byId, leaf, input.after, bounds);
  }

  return olderPage(scan.byId, input.before ? scan.byId.get(input.before)?.parentId : leaf, bounds);
}

/** Fills `buffer` from `position`. One read can give fewer bytes than asked. */
async function readFully(fd: FileHandle, buffer: Buffer, position: number, filled: number): Promise<void> {
  if (filled >= buffer.length) {
    return;
  }

  const { bytesRead } = await fd.read(buffer, filled, buffer.length - filled, position + filled);

  if (!bytesRead) {
    throw new ValidationError("Conversation changed during read");
  }

  await readFully(fd, buffer, position, filled + bytesRead);
}

async function readEntry(fd: FileHandle, meta: EntryIndex, maxBytes: number): Promise<ConversationEntry> {
  if (meta.length > Math.min(maxBytes, MAX_ENTRY_BYTES)) {
    return oversizedEntry(meta);
  }

  const buffer = Buffer.allocUnsafe(meta.length);

  await readFully(fd, buffer, meta.offset, 0);

  try {
    return displayEntry(JSON.parse(buffer.toString("utf8")), meta);
  } catch {
    throw new ValidationError("Conversation record is corrupt");
  }
}

/** Reads the entries one at a time, in order. A page has at most 100 entries. */
async function readEntries(
  fd: FileHandle,
  metas: readonly EntryIndex[],
  maxBytes: number,
): Promise<ConversationEntry[]> {
  const [first, ...rest] = metas;

  if (!first) {
    return [];
  }

  const entry = await readEntry(fd, first, maxBytes);

  return [entry, ...(await readEntries(fd, rest, maxBytes))];
}

async function readSelected(
  index: IndexEnv,
  metas: readonly EntryIndex[],
  maxBytes: number,
): Promise<ConversationEntry[]> {
  await index.validatePath();

  const fd = await open(index.file, "r");

  try {
    if (isReplaced(index.store.current, await fd.stat())) {
      throw new ValidationError("Conversation changed; read the page again");
    }

    return await readEntries(fd, metas, maxBytes);
  } finally {
    await fd.close();
  }
}

async function readPage(index: IndexEnv, input: PageInput): Promise<ConversationPage> {
  await refreshIndex(index);

  const bounds = pageBounds(input);
  const scan = index.store.current.scanner.view();
  const { status, invalidLines } = scan;

  if (status !== "ok") {
    return { entries: [], nextBefore: null, bytes: 0, status, invalidLines };
  }

  const branch = selectBranch(scan, input, bounds);
  const entries = await readSelected(index, branch.selected, bounds.maxBytes);
  const page = { entries, nextBefore: branch.nextBefore, bytes: branch.bytes, status, invalidLines };

  return input.after ? { ...page, nextAfter: branch.nextAfter ?? null } : page;
}

function indexDiagnostics(index: IndexEnv): IndexDiagnostics {
  const { scanner, closed } = index.store.current;

  return { ...scanner.diagnostics(), closed };
}

function closeIndex(index: IndexEnv): void {
  index.store.update(() => ({ ...emptyState(), closed: true }));
}

/** A selected-file index. It owns no SDK object, open file descriptor or global cache. */
export class SessionIndex {
  private readonly index: IndexEnv;

  constructor(file: string, validatePath: () => Promise<unknown> = skipValidation) {
    this.index = { file, validatePath, store: new Store<IndexState>({ ...emptyState(), closed: false }) };
  }

  /** Indexes the lines that the file has after the last refresh. */
  refresh(): Promise<void> {
    return refreshIndex(this.index);
  }

  /**
   * Reads one page of the active branch, oldest entry first. Without a cursor, the page ends at the leaf.
   * `before` reads the entries older than an entry. `after` reads the entries newer than an entry.
   */
  page(input: PageInput = {}): Promise<ConversationPage> {
    return readPage(this.index, input);
  }

  /** Gives the counters that show how much memory the index holds. */
  diagnostics(): IndexDiagnostics {
    return indexDiagnostics(this.index);
  }

  /** Releases the index. A later read fails. */
  close(): void {
    closeIndex(this.index);
  }
}
