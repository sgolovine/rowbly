import { ValidationError } from "../errors/errors.js";
import { type ConversationPage, type EntryIndex, type JsonObject, MAX_ENTRY_BYTES } from "./session-types.js";

/** The state of a scan that the session index reads between chunks. */
export interface ScanView {
  readonly byId: ReadonlyMap<string, EntryIndex>;
  readonly leaf: string | null;
  readonly offset: number;
  readonly status: ConversationPage["status"];
  readonly invalidLines: number;
}

const MAX_INDEX_ENTRIES = 250_000;
const MAX_FIELD_LENGTH = 128;
const MAX_TOKEN_LENGTH = 2048;
const MAX_PRIMITIVE_LENGTH = 128;
const NEWLINE = 10;

/** Parses one complete line. A line over the entry limit gives only its small top-level fields. */
function parseLine(parts: readonly Buffer[], lineBytes: number, fields: IndexFields): unknown {
  try {
    return lineBytes <= MAX_ENTRY_BYTES ? JSON.parse(Buffer.concat(parts).toString("utf8")) : fields.finish();
  } catch {
    return null;
  }
}

/** Gives the status of a file from its first line. Rowbly reads only version 3 of the Pi session format. */
function headerStatus(record: JsonObject): ConversationPage["status"] {
  return record.type === "session" && record.version === 3 ? "ok" : "unsupported";
}

function validParent(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_FIELD_LENGTH);
}

/** Gives the index of an entry line, or `null` when the line is not a valid entry. */
function entryIndex(record: JsonObject, offset: number, length: number): EntryIndex | null {
  const { id, parentId, type, timestamp } = record;

  if (
    typeof id !== "string" ||
    !id ||
    id.length > MAX_FIELD_LENGTH ||
    typeof type !== "string" ||
    type.length > MAX_FIELD_LENGTH ||
    !validParent(parentId)
  ) {
    return null;
  }

  return {
    id,
    parentId,
    type,
    timestamp: typeof timestamp === "string" ? timestamp.slice(0, MAX_FIELD_LENGTH) : undefined,
    offset,
    length,
  };
}

// The scanner reads each byte of a session file that can be many megabytes. A new value for each byte
// would make the scan too slow, so the two classes below change their own state in place.
// biome-ignore-start lint/plugin: the per-byte scan of a large session file changes its own state in place.

/** Extracts small top-level scalars in any key order, without retaining nested values. */
class IndexFields {
  private readonly fields: JsonObject = {};
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
      this.feedQuoted(c);

      return;
    }

    this.feedStructure(c);
  }

  finish(): JsonObject | null {
    return this.invalid || this.quoted || this.depth !== 0 ? null : this.fields;
  }

  private feedQuoted(c: string): void {
    if (this.capture && this.token.length < MAX_TOKEN_LENGTH) {
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
      this.closeString();
    }
  }

  private closeString(): void {
    this.quoted = false;

    if (this.capture && !this.overflow) {
      this.storeString();
    }

    this.token = "";
  }

  private storeString(): void {
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

  private feedStructure(c: string): void {
    if (c === '"') {
      this.quoted = true;
      this.capture = this.depth === 1;
      this.overflow = false;
      this.token = this.capture ? '"' : "";

      return;
    }

    if (c === "{" || c === "[") {
      this.depth += 1;

      return;
    }

    if (c === "}" || c === "]" || c === ",") {
      this.endValue(c);

      return;
    }

    if (this.depth === 1 && c !== ":" && !this.expectingKey && this.primitive.length < MAX_PRIMITIVE_LENGTH) {
      this.primitive += c;
    }
  }

  private endValue(c: string): void {
    if (this.depth === 1 && this.key && this.primitive.trim()) {
      try {
        this.fields[this.key] = JSON.parse(this.primitive);
      } catch {
        this.invalid = true;
      }
    }

    this.primitive = "";

    if (c !== ",") {
      this.depth -= 1;
    }

    if (this.depth === 1 && c === ",") {
      this.expectingKey = true;
      this.key = undefined;
    }
  }
}

/** Splits the chunks of a session file into lines, and indexes each complete entry line. */
export class SessionScanner {
  private readonly byId = new Map<string, EntryIndex>();
  private leaf: string | null = null;
  private position = 0;
  private lineStart = 0;
  private lineBytes = 0;
  private parts: Buffer[] = [];
  private fields = new IndexFields();
  private header = false;
  private status: ConversationPage["status"] = "missing";
  private invalidLines = 0;

  /** Indexes the first `bytesRead` bytes of `buffer`. The bytes start at the current offset. */
  scan(buffer: Buffer, bytesRead: number): void {
    let start = 0;

    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] !== NEWLINE) {
        this.fields.feed(buffer[i]);
        continue;
      }

      this.addPart(buffer.subarray(start, i));
      this.endLine();
      this.lineStart = this.position + i + 1;
      this.lineBytes = 0;
      this.parts = [];
      this.fields = new IndexFields();
      start = i + 1;
    }

    this.addPart(buffer.subarray(start, bytesRead));
    this.position += bytesRead;
  }

  /** The number of bytes that the scanner has read. */
  get offset(): number {
    return this.position;
  }

  /** Gives the index as it is now. The map stays live: a later scan adds to it. */
  view(): ScanView {
    return {
      byId: this.byId,
      leaf: this.leaf,
      offset: this.position,
      status: this.status,
      invalidLines: this.invalidLines,
    };
  }

  /** Gives the counters that show how much memory the scan holds. */
  diagnostics(): { entries: number; pendingBytes: number; retainedBytes: number } {
    return {
      entries: this.byId.size,
      pendingBytes: this.lineBytes,
      retainedBytes: this.parts.reduce((n, b) => n + b.length, 0),
    };
  }

  private addPart(piece: Buffer): void {
    this.lineBytes += piece.length;

    if (this.lineBytes <= MAX_ENTRY_BYTES) {
      this.parts.push(Buffer.from(piece));
    } else {
      this.parts = [];
    }
  }

  private endLine(): void {
    const record = parseLine(this.parts, this.lineBytes, this.fields);

    if (!record || typeof record !== "object") {
      this.invalidLines += 1;

      return;
    }

    if (!this.header) {
      this.header = true;
      this.status = headerStatus(record as JsonObject);

      return;
    }

    if (this.status === "ok") {
      this.addEntry(entryIndex(record as JsonObject, this.lineStart, this.lineBytes));
    }
  }

  private addEntry(entry: EntryIndex | null): void {
    if (!entry || this.byId.has(entry.id)) {
      this.invalidLines += 1;

      return;
    }

    if (this.byId.size >= MAX_INDEX_ENTRIES) {
      throw new ValidationError("Conversation index limit reached");
    }

    this.byId.set(entry.id, entry);
    this.leaf = entry.id;
  }
}

// biome-ignore-end lint/plugin: the per-byte scan ends here.
