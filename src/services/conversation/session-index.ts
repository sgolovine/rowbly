import { type FileHandle, open } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";

export interface EntryIndex {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  offset: number;
  length: number;
}
export interface ConversationEntry {
  id: string;
  type: string;
  timestamp?: string;
  role?: string;
  text: string;
  oversized?: boolean;
}
export interface ConversationPage {
  entries: ConversationEntry[];
  nextBefore: string | null;
  /** On a page read with `after`: the cursor for the next newer page, or `null` at the newest entry. */
  nextAfter?: string | null;
  bytes: number;
  status: "ok" | "missing" | "unsupported";
  invalidLines: number;
}
export const MAX_ENTRY_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;

/** Extracts small top-level scalars in any key order, without retaining nested values. */
class IndexFields {
  fields: Record<string, unknown> = {};
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private token = "";
  private key: string | undefined;
  private expectingKey = true;
  private capture = false;
  private overflow = false;
  private primitive = "";
  private invalid = false;
  feed(byte: number): void {
    const c = String.fromCharCode(byte);
    if (this.quoted) {
      if (this.capture && this.token.length < 2048) {
        this.token += c;
      } else if (this.capture) {
        this.overflow = true;
      }
      if (this.escaped) {
        this.escaped = false;
        return;
      }
      if (c === "\\") {
        this.escaped = true;
        return;
      }
      if (c === '"') {
        this.quoted = false;
        if (this.capture && !this.overflow) {
          try {
            const value = JSON.parse(this.token);
            if (this.expectingKey) {
              this.key = value;
              this.expectingKey = false;
            } else if (this.key) {
              this.fields[this.key] = value;
            }
          } catch {
            this.invalid = true;
          }
        }
        this.token = "";
      }
      return;
    }
    if (c === '"') {
      this.quoted = true;
      this.capture = this.depth === 1;
      this.overflow = false;
      this.token = this.capture ? '"' : "";
      return;
    }
    if (c === "{" || c === "[") {
      this.depth++;
      return;
    }
    if (c === "}" || c === "]" || c === ",") {
      if (this.depth === 1 && this.key && this.primitive.trim()) {
        try {
          this.fields[this.key] = JSON.parse(this.primitive);
        } catch {
          this.invalid = true;
        }
      }
      this.primitive = "";
      if (c !== ",") {
        this.depth--;
      }
      if (this.depth === 1 && c === ",") {
        this.expectingKey = true;
        this.key = undefined;
      }
      return;
    }
    if (this.depth === 1 && c !== ":" && !this.expectingKey && this.primitive.length < 128) {
      this.primitive += c;
    }
  }
  finish(): Record<string, unknown> | null {
    return this.invalid || this.quoted || this.depth !== 0 ? null : this.fields;
  }
}

function content(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "[unknown content]";
      }
      if (block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
      }
      if (block.type === "thinking") {
        return block.redacted ? "[redacted thinking]" : `[thinking] ${block.thinking ?? ""}`;
      }
      if (block.type === "image") {
        return `[image: ${block.mimeType ?? "attachment"}]`;
      }
      if (block.type === "toolCall") {
        return `[tool ${block.name}] ${JSON.stringify(block.arguments)}`;
      }
      return `[${block.type ?? "unknown content"}]`;
    })
    .join("\n");
}
function display(entry: Record<string, unknown>, meta: EntryIndex): ConversationEntry {
  const result: ConversationEntry = { id: meta.id, type: meta.type, timestamp: meta.timestamp, text: "" };
  if (entry.type === "message") {
    const message = entry.message as Record<string, unknown> | undefined;
    result.role = typeof message?.role === "string" ? message.role : "unknown";
    if (result.role === "bashExecution") {
      result.text = `[bash] ${message?.command ?? ""}\n${message?.output ?? ""}`;
    } else if (result.role === "toolResult") {
      result.text = `[tool result ${message?.toolName ?? ""}${message?.isError ? " error" : ""}]\n${content(message?.content)}`;
    } else {
      result.text = content(message?.content);
    }
    if (message?.errorMessage) {
      result.text += `\n[error] ${message.errorMessage}`;
    }
  } else if (entry.type === "compaction" || entry.type === "branch_summary") {
    result.text = `[${entry.type}] ${entry.summary ?? ""}`;
  } else if (entry.type === "custom_message") {
    result.text = entry.display === false ? "[hidden custom message]" : content(entry.content);
  } else {
    result.text = `[${meta.type}]`;
  }
  // Output stays bounded even if a future renderer expands the source record.
  result.text = result.text.slice(0, 32 * 1024);
  return result;
}

/** A selected-file index. It owns no SDK object, open file descriptor or global cache. */
export class SessionIndex {
  private byId = new Map<string, EntryIndex>();
  private leaf: string | null = null;
  private offset = 0;
  private lineStart = 0;
  private lineBytes = 0;
  private parts: Buffer[] = [];
  private fields = new IndexFields();
  private identity: string | null = null;
  private previous: { size: number; mtimeMs: number; ctimeMs: number } | null = null;
  private header = false;
  private status: ConversationPage["status"] = "missing";
  private invalidLines = 0;
  private closed = false;
  constructor(
    private readonly file: string,
    private readonly validatePath: () => Promise<unknown> = async () => {},
  ) {}
  private reset() {
    this.byId.clear();
    this.leaf = null;
    this.offset = 0;
    this.lineStart = 0;
    this.lineBytes = 0;
    this.parts = [];
    this.fields = new IndexFields();
    this.identity = null;
    this.previous = null;
    this.header = false;
    this.status = "missing";
    this.invalidLines = 0;
  }
  private consume() {
    let e: Record<string, unknown> | null;
    try {
      e =
        this.lineBytes <= MAX_ENTRY_BYTES
          ? JSON.parse(Buffer.concat(this.parts).toString("utf8"))
          : this.fields.finish();
    } catch {
      e = null;
    }
    if (!e || typeof e !== "object") {
      this.invalidLines++;
      return;
    }
    if (!this.header) {
      this.header = true;
      this.status = e.type === "session" && e.version === 3 ? "ok" : "unsupported";
      return;
    }
    if (this.status !== "ok") {
      return;
    }
    if (
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 128 ||
      typeof e.type !== "string" ||
      e.type.length > 128 ||
      !(e.parentId === null || (typeof e.parentId === "string" && e.parentId.length <= 128)) ||
      this.byId.has(e.id)
    ) {
      this.invalidLines++;
      return;
    }
    if (this.byId.size >= 250_000) {
      throw new ValidationError("Conversation index limit reached");
    }
    this.byId.set(e.id, {
      id: e.id,
      parentId: e.parentId,
      type: e.type,
      timestamp: typeof e.timestamp === "string" ? e.timestamp.slice(0, 128) : undefined,
      offset: this.lineStart,
      length: this.lineBytes,
    });
    this.leaf = e.id;
  }
  async refresh(): Promise<void> {
    if (this.closed) {
      throw new ValidationError("Conversation is closed");
    }
    await this.validatePath();
    let fd: FileHandle;
    try {
      fd = await open(this.file, "r");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.reset();
        return;
      }
      throw e;
    }
    try {
      const s = await fd.stat();
      const identity = `${s.dev}:${s.ino}`;
      if (
        this.identity &&
        (this.identity !== identity ||
          s.size < this.offset ||
          (s.size === this.previous?.size &&
            (s.mtimeMs !== this.previous.mtimeMs || s.ctimeMs !== this.previous.ctimeMs)))
      ) {
        this.reset();
      }
      this.identity = identity;
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (this.offset < s.size) {
        const { bytesRead } = await fd.read(buffer, 0, Math.min(buffer.length, s.size - this.offset), this.offset);
        if (!bytesRead) {
          break;
        }
        let start = 0;
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] !== 10) {
            this.fields.feed(buffer[i]);
            continue;
          }
          this.addPart(buffer.subarray(start, i));
          this.consume();
          this.lineStart = this.offset + i + 1;
          this.lineBytes = 0;
          this.parts = [];
          this.fields = new IndexFields();
          start = i + 1;
        }
        this.addPart(buffer.subarray(start, bytesRead));
        this.offset += bytesRead;
      }
      this.previous = { size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs };
    } finally {
      await fd.close();
    }
  }
  private addPart(piece: Buffer) {
    this.lineBytes += piece.length;
    if (this.lineBytes <= MAX_ENTRY_BYTES) {
      this.parts.push(Buffer.from(piece));
    } else {
      this.parts = [];
    }
  }
  /**
   * Reads one page of the active branch, oldest entry first. Without a cursor, the page ends at the leaf.
   * `before` reads the entries older than an entry. `after` reads the entries newer than an entry.
   */
  async page(
    input: { before?: string | null; after?: string | null; limit?: number; maxBytes?: number; leaf?: string } = {},
  ): Promise<ConversationPage> {
    await this.refresh();
    const limit = input.limit ?? 20,
      maxBytes = input.maxBytes ?? MAX_PAGE_BYTES;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_PAGE_BYTES
    ) {
      throw new ValidationError("Invalid conversation page bounds");
    }
    const page: ConversationPage = {
      entries: [],
      nextBefore: null,
      bytes: 0,
      status: this.status,
      invalidLines: this.invalidLines,
    };
    if (this.status !== "ok") {
      return page;
    }
    if (input.before && input.after) {
      throw new ValidationError("Use one conversation cursor");
    }
    const cursor = input.before ?? input.after;
    if (cursor && !this.byId.has(cursor)) {
      throw new ValidationError("Conversation cursor is no longer available");
    }
    const seen = new Set<string>();
    const step = (id: string) => {
      if (seen.has(id)) {
        throw new ValidationError("Conversation branch has a cycle");
      }
      seen.add(id);
      const meta = this.byId.get(id);
      if (!meta) {
        throw new ValidationError("Conversation parent is missing");
      }
      return meta;
    };
    // Newest entry first; the read below puts them in order.
    const selected: EntryIndex[] = [];
    const take = (meta: EntryIndex) => {
      if (selected.length >= limit || (page.bytes + meta.length > maxBytes && selected.length)) {
        return false;
      }
      selected.push(meta);
      page.bytes += Math.min(meta.length, maxBytes);
      return meta.length <= maxBytes;
    };
    if (input.after) {
      // The index has no child links, so walk the branch from the leaf back to the cursor. Only metadata stays.
      const newer: EntryIndex[] = [];
      let id = input.leaf ?? this.leaf;
      while (id && id !== input.after) {
        const meta = step(id);
        newer.push(meta);
        id = meta.parentId;
      }
      if (id !== input.after) {
        throw new ValidationError("Conversation cursor is no longer available");
      }
      let count = 0;
      for (const meta of newer.reverse()) {
        const more = take(meta);
        if (selected.at(-1) === meta) {
          count++;
        }
        if (!more) {
          break;
        }
      }
      selected.reverse();
      page.nextAfter = count < newer.length ? (selected[0]?.id ?? null) : null;
      page.nextBefore = selected.at(-1)?.id ?? null;
    } else {
      let id = input.before ? this.byId.get(input.before)?.parentId : (input.leaf ?? this.leaf);
      while (id && selected.length < limit) {
        const meta = step(id);
        const more = take(meta);
        if (selected.at(-1) === meta) {
          id = meta.parentId;
        }
        if (!more) {
          break;
        }
      }
      page.nextBefore = id ? (selected.at(-1)?.id ?? null) : null;
    }
    await this.validatePath();
    const fd = await open(this.file, "r");
    try {
      const s = await fd.stat();
      if (
        `${s.dev}:${s.ino}` !== this.identity ||
        s.size < this.offset ||
        (s.size === this.previous?.size && (s.mtimeMs !== this.previous.mtimeMs || s.ctimeMs !== this.previous.ctimeMs))
      ) {
        throw new ValidationError("Conversation changed; read the page again");
      }
      for (const meta of selected.reverse()) {
        if (meta.length > Math.min(maxBytes, MAX_ENTRY_BYTES)) {
          page.entries.push({
            id: meta.id,
            type: meta.type,
            timestamp: meta.timestamp,
            text: `[oversized ${meta.type}: ${meta.length} bytes]`,
            oversized: true,
          });
          continue;
        }
        const buffer = Buffer.allocUnsafe(meta.length);
        let n = 0;
        while (n < buffer.length) {
          const read = await fd.read(buffer, n, buffer.length - n, meta.offset + n);
          if (!read.bytesRead) {
            throw new ValidationError("Conversation changed during read");
          }
          n += read.bytesRead;
        }
        try {
          page.entries.push(display(JSON.parse(buffer.toString("utf8")), meta));
        } catch {
          throw new ValidationError("Conversation record is corrupt");
        }
      }
    } finally {
      await fd.close();
    }
    return page;
  }
  diagnostics() {
    return {
      entries: this.byId.size,
      pendingBytes: this.lineBytes,
      retainedBytes: this.parts.reduce((n, b) => n + b.length, 0),
      closed: this.closed,
    };
  }
  close(): void {
    this.reset();
    this.closed = true;
  }
}
