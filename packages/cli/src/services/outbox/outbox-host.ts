// The host side of the outbox requests of the main machine: `rowbly host outbox` and `rowbly host outbox-ack`.

import { ValidationError } from "../errors/errors.js";
import type { OutboxEntry } from "./outbox.js";
import { type AcknowledgeResult, acknowledgeOutbox, checkOutboxDir, readOutboxEntries } from "./outbox-file.js";

/** The input of a host request: the outbox folder from `ROWBLY_OUTBOX`, and the JSON text from stdin. */
export interface HostRequestInput {
  readonly dir: string | undefined;
  readonly text: string;
}

/** The answer of `rowbly host outbox`. */
export interface OutboxEntriesAnswer {
  readonly entries: readonly OutboxEntry[];
}

/** Parses the JSON text of a request. Throws a ValidationError for text that is not a JSON object. */
function parseRequest(text: string): Record<string, unknown> {
  const value = parseJson(text);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("The request must be a JSON object");
  }

  return value as Record<string, unknown>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("The request is not valid JSON");
  }
}

/** Gives the number of `key` of the request. Throws a ValidationError when it is not a number. */
function numberOf(request: Record<string, unknown>, key: string): number {
  const value = request[key];

  if (typeof value !== "number") {
    throw new ValidationError(`The request must have a number "${key}"`);
  }

  return value;
}

/** Gives the complete entries after the `afterSeq` of the request. */
export async function hostOutboxEntries(input: HostRequestInput): Promise<OutboxEntriesAnswer> {
  const dir = checkOutboxDir(input.dir);
  const afterSeq = numberOf(parseRequest(input.text), "afterSeq");

  return { entries: await readOutboxEntries(dir, afterSeq) };
}

/** Removes the entries up to the `seq` of the request, and the attachment files that no remaining entry points to. */
export async function hostOutboxAck(input: HostRequestInput): Promise<AcknowledgeResult> {
  const dir = checkOutboxDir(input.dir);
  const seq = numberOf(parseRequest(input.text), "seq");

  return acknowledgeOutbox(dir, seq);
}
