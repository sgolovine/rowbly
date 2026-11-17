import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { encodeFrame } from "../host-transport/json-lines.js";
import { Store } from "../store/store.js";

/** The maximum number of bytes that one poll reads from one session file: 4 MiB. */
export const MAX_SESSION_READ_BYTES = 4 * 1024 * 1024;

const NEWLINE = 0x0a;

/**
 * The new complete lines of the session file of one Thread. `offset` is the byte offset of the first line, and `end`
 * is the byte offset after the newline of the last line. A frame with no lines marks a line that is too long for a
 * frame. The main machine reads the bytes of that gap.
 */
export interface SessionFrame {
  readonly type: "session";
  readonly threadId: string;
  /** The `session.file` value of `run.json`, relative to the runtime folder of the agent. */
  readonly file: string;
  readonly offset: number;
  readonly end: number;
  readonly lines: readonly string[];
}

/** The read position of one session file. The channel keeps it in memory, not on disk. */
export interface SessionCursor {
  readonly file: string;
  readonly ino: number;
  /** The byte offset after the last sent line or gap. */
  readonly offset: number;
  /** The byte offset after the bytes of a long line that has no newline yet. It equals `offset` at other times. */
  readonly scan: number;
}

/** The bytes that one poll read from a session file. */
export interface SessionChunk {
  readonly cursor: SessionCursor;
  readonly bytes: Buffer;
}

/** The input of one read. `cursor` is the last position, or undefined when the channel did not read the file. */
export interface SessionRead {
  readonly runtime: string;
  readonly file: string;
  readonly cursor: SessionCursor | undefined;
  /** True when the channel opens. A new file then starts at its current size, else at offset 0. */
  readonly startAtEnd: boolean;
}

/** The fixed values of the frames of one Thread. */
export interface FrameTarget {
  readonly threadId: string;
  readonly file: string;
  readonly limit: number;
}

/** The frames of one chunk and the next read position. */
export interface SessionFrames {
  readonly frames: readonly SessionFrame[];
  readonly cursor: SessionCursor;
}

/** One complete line of a chunk, with its byte range in the file. */
interface SessionLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The length of the line as a JSON string in a frame. */
  readonly size: number;
}

/** A line and the index of the frame that holds it. A gap line has a frame of its own. */
interface PlacedLine {
  readonly line: SessionLine;
  readonly frame: number;
  readonly gap: boolean;
}

/** The frame that gets the next line, and the encoded bytes that it has. 0 bytes is an empty frame. */
interface Packing {
  readonly frame: number;
  readonly used: number;
}

/**
 * Gives the absolute path of a session file below the runtime folder, or undefined. An absolute path, a `..` part or
 * a path outside the runtime folder is refused.
 */
export function sessionPath(runtime: string, file: unknown): string | undefined {
  if (typeof file !== "string" || file === "" || isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
    return undefined;
  }

  const path = resolve(runtime, file);
  const inside = relative(resolve(runtime), path);

  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside) ? path : undefined;
}

/** Gives the start position of the file: a new file, a replaced file or a shorter file. */
function startCursor(read: SessionRead, ino: number, size: number): SessionCursor {
  const { cursor } = read;
  const known = cursor !== undefined && cursor.file === read.file;

  if (known && cursor.ino === ino && cursor.scan <= size) {
    return cursor;
  }

  const offset = !known && read.startAtEnd ? size : 0;

  return { file: read.file, ino, offset, scan: offset };
}

/** Reads the new bytes of a session file, at most `MAX_SESSION_READ_BYTES`. A missing file gives undefined. */
export async function readSessionChunk(read: SessionRead): Promise<SessionChunk | undefined> {
  const path = sessionPath(read.runtime, read.file);
  const handle = path ? await open(path, "r").catch(() => undefined) : undefined;

  if (!handle) {
    return undefined;
  }

  try {
    const info = await handle.stat();
    const cursor = startCursor(read, info.ino, info.size);
    const length = Math.min(info.size - cursor.scan, MAX_SESSION_READ_BYTES);
    const buffer = Buffer.alloc(Math.max(length, 0));
    const { bytesRead } = length > 0 ? await handle.read(buffer, 0, length, cursor.scan) : { bytesRead: 0 };

    return { cursor, bytes: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

/** Splits the complete lines of the bytes. Latin-1 keeps one character for each byte, so the indexes are bytes. */
function splitLines(bytes: Buffer, offset: number): SessionLine[] {
  const matches = [...bytes.toString("latin1").matchAll(/[^\n]*\n/g)];

  return matches.map((match) => {
    const text = bytes.subarray(match.index, match.index + match[0].length - 1).toString("utf8");

    return {
      start: offset + match.index,
      end: offset + match.index + match[0].length,
      text,
      size: Buffer.byteLength(JSON.stringify(text), "utf8"),
    };
  });
}

/** Gives the frame of the line. Adds the line to the open frame while the frame stays in the limit. */
function placeLine(packing: Store<Packing>, line: SessionLine, overhead: number, limit: number): PlacedLine {
  const { frame, used } = packing.current;
  const next = used === 0 ? frame : frame + 1;

  if (overhead + line.size > limit) {
    packing.update(() => ({ frame: next + 1, used: 0 }));

    return { line, frame: next, gap: true };
  }

  if (used === 0 || used + 1 + line.size <= limit) {
    packing.update(() => ({ used: used === 0 ? overhead + line.size : used + 1 + line.size }));

    return { line, frame, gap: false };
  }

  packing.update(() => ({ frame: next, used: overhead + line.size }));

  return { line, frame: next, gap: false };
}

function sessionFrame(
  target: FrameTarget,
  range: { readonly offset: number; readonly end: number },
  lines: readonly string[],
): SessionFrame {
  return { type: "session", threadId: target.threadId, file: target.file, ...range, lines };
}

/** A frame with no lines. It marks the bytes of a line that is too long for a frame. */
function gapFrame(target: FrameTarget, offset: number, end: number): SessionFrame {
  return sessionFrame(target, { offset, end }, []);
}

function frameOf(target: FrameTarget, group: readonly PlacedLine[]): SessionFrame {
  const first = group[0] as PlacedLine;
  const last = group.at(-1) as PlacedLine;
  const lines = first.gap ? [] : group.map((placed) => placed.line.text);

  return sessionFrame(target, { offset: first.line.start, end: last.line.end }, lines);
}

/**
 * Puts the lines in frames. Each encoded frame, with its newline, is not longer than the limit. The size of the
 * fields of a frame uses the largest offset, so the sum of the sizes is never smaller than the encoded frame.
 */
function packLines(target: FrameTarget, lines: readonly SessionLine[]): SessionFrame[] {
  const largest = lines.at(-1)?.end ?? 0;
  const overhead = Buffer.byteLength(encodeFrame(gapFrame(target, largest, largest)), "utf8");
  const packing = new Store<Packing>({ frame: 0, used: 0 });

  const placed = lines.map((line) => placeLine(packing, line, overhead, target.limit));
  const starts = placed.flatMap((item, index) =>
    index === 0 || placed[index - 1]?.frame !== item.frame ? [index] : [],
  );

  return starts.map((start, index) => frameOf(target, placed.slice(start, starts[index + 1] ?? placed.length)));
}

/** The frames of the complete lines of bytes that start at `cursor.offset`. A part line waits for the next poll. */
function lineFrames(target: FrameTarget, cursor: SessionCursor, bytes: Buffer): SessionFrames {
  const last = bytes.lastIndexOf(NEWLINE);

  if (last < 0) {
    // A line without a newline in a full read is longer than any frame. Skip its bytes until its newline.
    const scan = bytes.length >= MAX_SESSION_READ_BYTES ? cursor.offset + bytes.length : cursor.offset;

    return { frames: [], cursor: { ...cursor, scan } };
  }

  const end = cursor.offset + last + 1;
  const frames = packLines(target, splitLines(bytes.subarray(0, last + 1), cursor.offset));

  return { frames, cursor: { ...cursor, offset: end, scan: end } };
}

/** The frames of a chunk that starts in a long line. The gap frame comes when the newline of the line arrives. */
function gapFrames(target: FrameTarget, cursor: SessionCursor, bytes: Buffer): SessionFrames {
  const newline = bytes.indexOf(NEWLINE);

  if (newline < 0) {
    return { frames: [], cursor: { ...cursor, scan: cursor.scan + bytes.length } };
  }

  const end = cursor.scan + newline + 1;
  const gap = gapFrame(target, cursor.offset, end);
  const rest = lineFrames(target, { ...cursor, offset: end, scan: end }, bytes.subarray(newline + 1));

  return { frames: [gap, ...rest.frames], cursor: rest.cursor };
}

/** Gives the frames of the bytes that one poll read, and the next read position. */
export function sessionFrames(target: FrameTarget, chunk: SessionChunk): SessionFrames {
  const { cursor, bytes } = chunk;

  return cursor.scan > cursor.offset ? gapFrames(target, cursor, bytes) : lineFrames(target, cursor, bytes);
}
