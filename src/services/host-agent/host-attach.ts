import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { newOwner, type Owner, type OwnerProbe } from "../factory-ownership/ownership-lock.js";
import { helloFrame } from "../host-transport/host-transport.js";
import { DEFAULT_LINE_LIMIT, encodeFrame } from "../host-transport/json-lines.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store, withEntry } from "../store/store.js";
import { agentStatus, type HostAgentPhase } from "./host-agent-claim.js";
import { type HostReceipt, pendingCommandCount, readHostReceipt, validRequestId } from "./host-agent-control.js";
import { type HostAgentPaths, hostAgentPaths, threadPaths } from "./host-agent-paths.js";
import { readMainFrames, sendFetchRequests } from "./host-attach-fetch.js";
import { removeChannelMark, writeChannelMark } from "./host-channel-mark.js";
import { type HostRunState, hostThreadIds, readHostRun } from "./host-run-state.js";
import { readSessionChunk, type SessionCursor, type SessionFrame, sessionFrames } from "./host-session-lines.js";
import { type SlotUsage, slotUsage } from "./host-slots.js";

/** The default time between two reads of the runtime folder. */
export const DEFAULT_ATTACH_POLL_MS = 250;

/** The state of the host agent that the channel sends. */
export interface StatusFrame {
  readonly type: "status";
  readonly agent: HostAgentPhase;
  readonly owner: Owner | null;
  readonly slots: SlotUsage;
  readonly pending: number;
}

/** A new or changed receipt. */
export interface ReceiptFrame {
  readonly type: "receipt";
  readonly receipt: HostReceipt;
}

/** The run state of one Thread, from `threads/<thread-id>/run.json`. */
export interface RunFrame {
  readonly type: "run";
  readonly run: HostRunState;
}

export interface AttachOptions {
  readonly projectId: string;
  /** The frames of the main machine. The channel stops at the end of this stream. */
  readonly input: Readable;
  /** Writes one frame line. */
  readonly write: (line: string) => void;
  readonly home?: string;
  readonly pollMs?: number;
  readonly probe?: OwnerProbe;
  /** The maximum bytes of one encoded frame. The default is `DEFAULT_LINE_LIMIT`. Tests make it smaller. */
  readonly frameLimit?: number;
}

/** The fixed environment and the last sent values of one channel. */
interface Channel {
  readonly paths: HostAgentPaths;
  readonly options: AttachOptions;
  readonly ended: AbortController;
  readonly sent: Store<SentValues>;
}

/** The last sent values: the status frame, the file stamp of each receipt and each run state, and the session lines. */
interface SentValues {
  readonly status: string;
  readonly receipts: ReadonlyMap<string, string>;
  readonly runs: ReadonlyMap<string, string>;
  /** The `session.file` of the last read `run.json` of each Thread. */
  readonly sessionFiles: ReadonlyMap<string, string>;
  /** The read position of the session file of each Thread. */
  readonly sessions: ReadonlyMap<string, SessionCursor>;
  /** The `requestedAt` of each open fetch request that the channel sent. */
  readonly requests: ReadonlyMap<string, string>;
  /** True after the first poll. A session file that the channel first sees after this time starts at offset 0. */
  readonly opened: boolean;
}

async function statusFrame(channel: Channel): Promise<StatusFrame> {
  const { paths, options } = channel;
  const status = await agentStatus(paths, options.probe);
  const slots = await slotUsage(options.home);
  const pending = await pendingCommandCount(paths);

  return { type: "status", agent: status.agent, owner: status.owner, slots, pending };
}

/** Sends a status frame when a value changed. */
async function sendStatus(channel: Channel): Promise<void> {
  const frame = await statusFrame(channel);
  const key = JSON.stringify(frame);

  if (key === channel.sent.current.status) {
    return;
  }

  channel.options.write(encodeFrame(frame));
  channel.sent.update(() => ({ status: key }));
}

/** The stamp of a file. A file is read again only when its stamp changed. */
async function fileStamp(path: string): Promise<string> {
  const info = await stat(path).catch(() => undefined);

  return info ? `${info.mtimeMs}:${info.size}:${info.ino}` : "";
}

function receiptStamp(paths: HostAgentPaths, id: string): Promise<string> {
  return fileStamp(join(paths.receipts, `${id}.json`));
}

/** Sends the run state of the Thread when it is new or changed. A bad file is not sent. */
async function sendRun(channel: Channel, threadId: string): Promise<void> {
  const stamp = await fileStamp(threadPaths(channel.paths, threadId).run);

  if (stamp === "" || channel.sent.current.runs.get(threadId) === stamp) {
    return;
  }

  const run = await readHostRun(channel.paths, threadId).catch(() => undefined);

  channel.sent.update((sent) => ({ runs: withEntry(sent.runs, threadId, stamp) }));

  if (run?.session?.file) {
    const file = run.session.file;

    channel.sent.update((sent) => ({ sessionFiles: withEntry(sent.sessionFiles, threadId, file) }));
  }

  if (run) {
    channel.options.write(encodeFrame({ type: "run", run } satisfies RunFrame));
  }
}

async function sendRuns(channel: Channel): Promise<void> {
  await mapInOrder(await hostThreadIds(channel.paths), (threadId) => sendRun(channel, threadId));
}

/** Sends the receipt when it is new or changed. A corrupt receipt is not sent. */
async function sendReceipt(channel: Channel, id: string): Promise<void> {
  const stamp = await receiptStamp(channel.paths, id);

  if (stamp === "" || channel.sent.current.receipts.get(id) === stamp) {
    return;
  }

  const receipt = await readHostReceipt(channel.paths, id).catch(() => undefined);

  channel.sent.update((sent) => ({ receipts: withEntry(sent.receipts, id, stamp) }));

  if (receipt) {
    channel.options.write(encodeFrame({ type: "receipt", receipt } satisfies ReceiptFrame));
  }
}

async function sendReceipts(channel: Channel): Promise<void> {
  const files = await readdir(channel.paths.receipts).catch(() => [] as string[]);
  const ids = files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .filter(validRequestId)
    .toSorted();

  await mapInOrder(ids, (id) => sendReceipt(channel, id));
}

/** Sends the new complete lines of the session file of the Thread. A missing or unreadable file gives no frame. */
async function sendSession(channel: Channel, threadId: string, file: string): Promise<void> {
  const { sent } = channel;
  const read = {
    runtime: channel.paths.runtime,
    file,
    cursor: sent.current.sessions.get(threadId),
    startAtEnd: !sent.current.opened,
  };
  const chunk = await readSessionChunk(read).catch(() => undefined);

  if (!chunk) {
    return;
  }

  const limit = channel.options.frameLimit ?? DEFAULT_LINE_LIMIT;
  const { frames, cursor } = sessionFrames({ threadId, file, limit }, chunk);

  for (const frame of frames) {
    channel.options.write(encodeFrame(frame satisfies SessionFrame));
  }

  sent.update((current) => ({ sessions: withEntry(current.sessions, threadId, cursor) }));
}

async function sendSessions(channel: Channel): Promise<void> {
  const files = [...channel.sent.current.sessionFiles].toSorted(([a], [b]) => a.localeCompare(b));

  await mapInOrder(files, ([threadId, file]) => sendSession(channel, threadId, file));
}

async function sendRequests(channel: Channel): Promise<void> {
  const { paths, options, sent } = channel;
  const requests = await sendFetchRequests(paths, sent.current.requests, options.write);

  sent.update(() => ({ requests }));
}

/**
 * Sends the changes in this order: status, receipts, runs, session lines, then fetch requests. A run frame comes
 * before its lines.
 */
async function sendChanges(channel: Channel): Promise<void> {
  await sendStatus(channel);
  await sendReceipts(channel);
  await sendRuns(channel);
  await sendSessions(channel);
  await sendRequests(channel);
  channel.sent.update(() => ({ opened: true }));
}

/** Reads the frames of the main machine. Aborts at the end of the input. */
function watchInput(input: Readable, paths: HostAgentPaths, ended: AbortController): void {
  readMainFrames(input, paths);
  input.on("end", () => ended.abort());
  input.on("close", () => ended.abort());
  input.on("error", () => ended.abort());
  input.resume();

  if (input.readableEnded || input.destroyed) {
    ended.abort();
  }
}

/**
 * Runs the `host attach` channel. It sends the hello frame, then a status frame, the receipts and the run state of
 * each Thread, then each change and the new lines of each session file.
 * It reads only the files of the runtime folder. It does not start or stop the agent. It ends at the end of input.
 * While it runs, `channel.json` marks the channel as live, and each `attachment-failed` frame writes a failure answer.
 */
export async function runHostAttach(options: AttachOptions): Promise<void> {
  const paths = hostAgentPaths(options.projectId, options.home);
  const channel: Channel = {
    paths,
    options,
    ended: new AbortController(),
    sent: new Store<SentValues>({
      status: "",
      receipts: new Map(),
      runs: new Map(),
      sessionFiles: new Map(),
      sessions: new Map(),
      requests: new Map(),
      opened: false,
    }),
  };
  const owner = await newOwner();

  watchInput(options.input, paths, channel.ended);
  options.write(encodeFrame(helloFrame()));
  await writeChannelMark(paths, owner);

  try {
    await pollChanges(channel);
  } finally {
    await removeChannelMark(paths, owner.token);
  }
}

async function pollChanges(channel: Channel): Promise<void> {
  const pollMs = channel.options.pollMs ?? DEFAULT_ATTACH_POLL_MS;

  while (!channel.ended.signal.aborted) {
    await sendChanges(channel);
    await sleep(pollMs, undefined, { signal: channel.ended.signal }).catch(() => undefined);
  }
}
