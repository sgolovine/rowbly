// The attachment frames of the `host attach` channel. The channel sends one `attachment-request` frame for each new
// fetch request, and writes the failure answer of each `attachment-failed` frame of the main machine.

import type { Readable } from "node:stream";
import {
  DEFAULT_LINE_LIMIT,
  decodeChunk,
  EMPTY_DECODER,
  encodeFrame,
  type LineDecoderState,
  parseFrame,
} from "../host-transport/json-lines.js";
import { Store } from "../store/store.js";
import type { HostAgentPaths } from "./host-agent-paths.js";
import { readFetchRequests, writeFetchFailure } from "./host-fetch.js";

/** A request of the host for an attachment file of the main machine. */
export interface AttachmentRequestFrame {
  readonly type: "attachment-request";
  readonly storyId: string;
  readonly id: string;
}

/** The answer of the main machine when it cannot send the file. */
export interface AttachmentFailedFrame {
  readonly type: "attachment-failed";
  readonly id: string;
  readonly message: string;
}

/** The fixed environment of the input of one channel, and the state of its line decoder. */
interface FrameInput {
  readonly paths: HostAgentPaths;
  readonly decoder: Store<{ readonly state: LineDecoderState }>;
}

/**
 * Sends one frame for each open request that the channel did not send. `sent` has the `requestedAt` of each sent
 * request. Gives the new value: only the open requests, so that a later request of the same id gets a new frame.
 */
export async function sendFetchRequests(
  paths: HostAgentPaths,
  sent: ReadonlyMap<string, string>,
  write: (line: string) => void,
): Promise<ReadonlyMap<string, string>> {
  const requests = await readFetchRequests(paths);

  for (const request of requests.filter((open) => sent.get(open.id) !== open.requestedAt)) {
    const frame: AttachmentRequestFrame = { type: "attachment-request", storyId: request.storyId, id: request.id };

    write(encodeFrame(frame));
  }

  return new Map(requests.map((request) => [request.id, request.requestedAt]));
}

function isFailedFrame(value: unknown): value is AttachmentFailedFrame {
  const frame = value as Partial<AttachmentFailedFrame> | null;

  return (
    typeof frame === "object" &&
    frame !== null &&
    frame.type === "attachment-failed" &&
    typeof frame.id === "string" &&
    typeof frame.message === "string"
  );
}

function parseOrUndefined(line: string): unknown {
  try {
    return parseFrame(line);
  } catch {
    return undefined;
  }
}

/** Takes one frame line of the main machine. A bad frame, or a frame of a different type, is ignored. */
function takeLine(input: FrameInput, line: string): void {
  const frame = parseOrUndefined(line);

  if (isFailedFrame(frame)) {
    writeFetchFailure(input.paths, frame.id, frame.message).catch(() => undefined);
  }
}

/** Splits the text of the input into lines. A line that is too long resets the decoder, and the channel continues. */
function takeChunk(input: FrameInput, chunk: string): void {
  try {
    const decoded = decodeChunk(input.decoder.current.state, chunk, DEFAULT_LINE_LIMIT);

    input.decoder.update(() => ({ state: decoded.state }));
    for (const line of decoded.lines) {
      takeLine(input, line);
    }
  } catch {
    input.decoder.update(() => ({ state: EMPTY_DECODER }));
  }
}

/** Reads the frames of the main machine from the input of the channel. */
export function readMainFrames(input: Readable, paths: HostAgentPaths): void {
  const frames: FrameInput = { paths, decoder: new Store({ state: EMPTY_DECODER }) };

  input.setEncoding("utf8");
  input.on("data", (chunk: string) => takeChunk(frames, chunk));
}
