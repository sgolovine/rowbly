// The durable queue of the inbound updates of one remote Thread, in `runtime/hosts/<host>/threads/<thread-id>/
// inbound.json`. An update waits in the queue until the host gives a last applied `seq` equal to or more than its `seq`.

import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../files/files.js";
import { INBOUND_TYPES, type InboundBody, type InboundUpdate } from "../inbound/inbound-types.js";
import { hostThreadFile, preparedHostThreadFile } from "../outbox-apply/host-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

const QUEUE_FILE = "inbound.json";

/** The content of `inbound.json`. `nextSeq` is the `seq` of the next update. It never decreases. */
export interface InboundQueue {
  readonly version: 1;
  readonly nextSeq: number;
  readonly updates: readonly InboundUpdate[];
}

const EMPTY: InboundQueue = { version: 1, nextSeq: 1, updates: [] };

function isUpdate(value: unknown): value is InboundUpdate {
  const update = value as Partial<InboundUpdate> | null;

  return (
    typeof update === "object" &&
    update !== null &&
    Number.isSafeInteger(update.seq) &&
    INBOUND_TYPES.includes(update.type as InboundBody["type"])
  );
}

/** Gives the queue of the file text. A text that is not a queue gives an empty queue. */
function parseQueue(text: string): InboundQueue {
  try {
    const value = JSON.parse(text) as Partial<InboundQueue> | null;

    if (value?.version !== 1 || !Number.isSafeInteger(value.nextSeq) || !Array.isArray(value.updates)) {
      return EMPTY;
    }

    return { version: 1, nextSeq: Math.max(1, value.nextSeq as number), updates: value.updates.filter(isUpdate) };
  } catch {
    return EMPTY;
  }
}

/** Reads the inbound queue of the Thread. A missing file gives an empty queue that starts at `seq` 1. */
export async function readInboundQueue(paths: ProjectPaths, host: string, threadId: string): Promise<InboundQueue> {
  const file = await hostThreadFile(paths, host, threadId, QUEUE_FILE);

  try {
    return parseQueue(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY;
    }

    throw error;
  }
}

/** Writes the queue to the disk before it returns, with mode 0600 in folders with mode 0700. */
async function writeInboundQueue(paths: ProjectPaths, host: string, threadId: string, queue: InboundQueue) {
  const file = await preparedHostThreadFile(paths, host, threadId, QUEUE_FILE);

  await writeFileAtomic(file, `${JSON.stringify(queue)}\n`, { mode: 0o600, durable: true });
}

/** Gives the queue with the bodies at its end. Each body gets the next `seq`. */
export function withInboundUpdates(queue: InboundQueue, bodies: readonly InboundBody[]): InboundQueue {
  const added = bodies.map((body, index): InboundUpdate => ({ ...body, seq: queue.nextSeq + index }));

  return { version: 1, nextSeq: queue.nextSeq + bodies.length, updates: [...queue.updates, ...added] };
}

/** Adds the bodies to the queue of the Thread. Gives the queue after the change. */
export async function queueInboundUpdates(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  bodies: readonly InboundBody[],
): Promise<InboundQueue> {
  const queue = withInboundUpdates(await readInboundQueue(paths, host, threadId), bodies);

  if (bodies.length > 0) {
    await writeInboundQueue(paths, host, threadId, queue);
  }

  return queue;
}

/** Removes the updates with a `seq` equal to or less than `seq`, after the acknowledgement of the host. */
export async function acknowledgeInbound(paths: ProjectPaths, host: string, threadId: string, seq: number) {
  const queue = await readInboundQueue(paths, host, threadId);
  const updates = queue.updates.filter((update) => update.seq > seq);

  if (updates.length !== queue.updates.length) {
    await writeInboundQueue(paths, host, threadId, { ...queue, updates });
  }
}

/** Removes all waiting updates of the Thread. `nextSeq` stays, so that the `seq` values on the host only increase. */
export async function clearInbound(paths: ProjectPaths, host: string, threadId: string): Promise<void> {
  await acknowledgeInbound(paths, host, threadId, Number.MAX_SAFE_INTEGER);
}
