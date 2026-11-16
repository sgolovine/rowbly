// The source of the outbox entries of one worker host, and its implementation over the host transport.

import { MAX_ATTACHMENT_BYTES } from "../attachment-files/attachment-files.js";
import { HostProtocolError } from "../host-transport/host-errors.js";
import type { HostTransport, RemoteCommand } from "../host-transport/host-transport.js";
import type { OutboxEntry } from "../outbox/outbox.js";

/** Gives the outbox entries and the attachment files of one worker host, and takes the acknowledgement. */
export interface OutboxSource {
  /** The entries with a `seq` greater than `seq`, in `seq` order. */
  entriesAfter(seq: number): Promise<readonly OutboxEntry[]>;
  /** The bytes of `blobs/<sha256>.png` of the outbox. */
  blob(sha256: string): Promise<Uint8Array>;
  /** Tells the host to remove the entries with a `seq` equal to or less than `seq`. */
  acknowledge(seq: number): Promise<void>;
}

/** The transport of the host, the path of `rowbly` on the host and the project id of the host agent. */
export interface TransportSourceInput {
  readonly transport: HostTransport;
  readonly rowbly: string;
  /**
   * The project id of the host agent. The host commands then use the outbox of that agent. Without it, the host
   * commands read the outbox folder from `ROWBLY_OUTBOX`.
   */
  readonly projectId?: string;
}

/** The tokens of one `rowbly host` command, with the project id at the end when the input has one. */
function hostCommand(input: TransportSourceInput, ...args: string[]): RemoteCommand {
  return [input.rowbly, "host", ...args, ...(input.projectId === undefined ? [] : [input.projectId])];
}

/** Makes the error of a remote command that exited with a code other than 0. */
function remoteFailure(name: string, exitCode: number, stderr: string): HostProtocolError {
  const text = stderr.trim();

  return new HostProtocolError(`The host command \`rowbly host ${name}\` failed with exit code ${exitCode}: ${text}`, {
    details: { exitCode, stderr: text },
  });
}

/** Gives the entries of the answer. Throws a HostProtocolError when the answer has no list of entries. */
function answerEntries(value: unknown): readonly OutboxEntry[] {
  const entries = (value as { entries?: unknown } | null)?.entries;

  if (!Array.isArray(entries)) {
    throw new HostProtocolError("The answer of `rowbly host outbox` has no list of entries");
  }

  return entries as OutboxEntry[];
}

async function entriesAfter(input: TransportSourceInput, seq: number): Promise<readonly OutboxEntry[]> {
  const command = hostCommand(input, "outbox");
  const result = await input.transport.request(command, { afterSeq: seq });

  if (result.exitCode !== 0) {
    throw remoteFailure("outbox", result.exitCode, result.stderr);
  }

  return answerEntries(result.value);
}

async function blob(input: TransportSourceInput, sha256: string): Promise<Uint8Array> {
  const command = hostCommand(input, "blob", sha256);
  // One byte more than the limit tells the apply that the file is too large.
  const result = await input.transport.bytes(command, null, { limit: MAX_ATTACHMENT_BYTES + 1 });

  if (result.exitCode !== 0) {
    throw remoteFailure("blob", result.exitCode, result.stderr);
  }

  return result.bytes;
}

async function acknowledge(input: TransportSourceInput, seq: number): Promise<void> {
  const command = hostCommand(input, "outbox-ack");
  const result = await input.transport.request(command, { seq });

  if (result.exitCode !== 0) {
    throw remoteFailure("outbox-ack", result.exitCode, result.stderr);
  }
}

/** An outbox source that runs the fixed `rowbly host` commands on the host through the transport. */
export function transportOutboxSource(input: TransportSourceInput): OutboxSource {
  return {
    entriesAfter: (seq) => entriesAfter(input, seq),
    blob: (sha256) => blob(input, sha256),
    acknowledge: (seq) => acknowledge(input, seq),
  };
}
