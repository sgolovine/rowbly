import type { Readable } from "node:stream";
import { ValidationError } from "../errors/errors.js";
import { Store } from "../store/store.js";

/** The chunks of a bounded read and their total size. */
interface BoundedRead {
  readonly chunks: readonly Buffer[];
  readonly size: number;
}

/** Adds a chunk. A total larger than the limit gives a ValidationError, so that a large input does not fill memory. */
function addChunk(read: Store<BoundedRead>, chunk: Buffer | string, limit: number, label: string): void {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  const size = read.current.size + bytes.length;

  if (size > limit) {
    throw new ValidationError(`${label} must not be larger than ${limit} bytes`, { details: { limit } });
  }

  read.update((current) => ({ chunks: [...current.chunks, bytes], size }));
}

/** Reads the full stream, but refuses an input that is larger than the limit. */
export async function readBoundedInput(input: Readable, limit: number, label = "The input"): Promise<Buffer> {
  const read = new Store<BoundedRead>({ chunks: [], size: 0 });

  for await (const chunk of input) {
    addChunk(read, chunk as Buffer | string, limit, label);
  }

  return Buffer.concat(read.current.chunks);
}

/** Parses JSON text, or throws a ValidationError. */
export function parseJsonInput(bytes: Buffer | string): unknown {
  try {
    return JSON.parse(bytes.toString());
  } catch {
    throw new ValidationError("The input on stdin must be one JSON value");
  }
}
