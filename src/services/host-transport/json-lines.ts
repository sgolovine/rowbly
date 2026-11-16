import { HostProtocolError } from "./host-errors.js";

/** The default limit of one frame line, without the newline: 1 MiB. */
export const DEFAULT_LINE_LIMIT = 1024 * 1024;

/** The text of a frame line that is not complete yet. */
export interface LineDecoderState {
  readonly pending: string;
}

/** The result of one chunk: the new decoder state and the complete lines. */
export interface DecodedChunk {
  readonly state: LineDecoderState;
  readonly lines: readonly string[];
}

export const EMPTY_DECODER: LineDecoderState = { pending: "" };

/** Encodes one value as one frame line. `JSON.stringify` escapes each newline in a string, so a frame has one line. */
export function encodeFrame(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function tooLong(limit: number): HostProtocolError {
  return new HostProtocolError(`A frame line is longer than the limit of ${limit} bytes.`, { details: { limit } });
}

function checkLength(line: string, limit: number): void {
  if (Buffer.byteLength(line, "utf8") > limit) {
    throw tooLong(limit);
  }
}

/**
 * Splits the text of a chunk into complete lines. A chunk can hold part of a line or several lines.
 * The decoder keeps the end of the chunk after the last newline for the next chunk. It refuses a line,
 * also a line that is not complete, when it is longer than `limit` bytes.
 */
export function decodeChunk(state: LineDecoderState, chunk: string, limit = DEFAULT_LINE_LIMIT): DecodedChunk {
  const parts = `${state.pending}${chunk}`.split("\n");
  const pending = parts.at(-1) ?? "";
  const lines = parts.slice(0, -1).map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

  for (const line of [...lines, pending]) {
    checkLength(line, limit);
  }

  return { state: { pending }, lines: lines.filter((line) => line.trim() !== "") };
}

/** Parses one frame line. A line that is not JSON gives `HostProtocolError`. */
export function parseFrame(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    return badFrame(line, error);
  }
}

function badFrame(line: string, cause: unknown): never {
  throw new HostProtocolError("The host sent a frame that is not JSON.", {
    details: { line: line.slice(0, 200) },
    cause,
  });
}
