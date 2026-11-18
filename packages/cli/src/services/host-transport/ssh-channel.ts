import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { RowblyError } from "../errors/errors.js";
import { Store } from "../store/store.js";
import { classifySshExit, HostUnreachableError } from "./host-errors.js";
import type { ChannelHandlers, HostChannel } from "./host-transport.js";
import {
  DEFAULT_LINE_LIMIT,
  decodeChunk,
  EMPTY_DECODER,
  encodeFrame,
  type LineDecoderState,
  parseFrame,
} from "./json-lines.js";
import { STDERR_LIMIT } from "./ssh-process.js";

/** One SSH process that stays open as a channel. */
export interface SshChannelCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly target: string;
  readonly lineLimit?: number;
}

interface ChannelState {
  readonly decoder: LineDecoderState;
  readonly stderr: string;
  readonly failure: RowblyError | undefined;
  readonly ended: boolean;
}

interface OpenChannel {
  readonly call: SshChannelCall;
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: Store<ChannelState>;
  readonly handlers: ChannelHandlers;
}

/** Records a protocol failure and stops the process. The close event gives the failure to the handlers. */
function failChannel(channel: OpenChannel, failure: unknown): void {
  if (channel.state.current.failure) {
    return;
  }

  channel.state.update(() => ({ failure: failure as RowblyError }));
  channel.child.kill("SIGKILL");
}

function parsedLine(channel: OpenChannel, line: string): { readonly frame: unknown } | undefined {
  try {
    return { frame: parseFrame(line) };
  } catch (error) {
    failChannel(channel, error);

    return undefined;
  }
}

/** Gives one line to the handlers. It gives `false` when the line is not a frame, so that the later lines stop. */
function deliverLine(channel: OpenChannel, line: string): boolean {
  const parsed = parsedLine(channel, line);

  if (!parsed) {
    return false;
  }

  channel.handlers.onFrame(parsed.frame);

  return true;
}

function decodedLines(channel: OpenChannel, chunk: string): readonly string[] {
  try {
    const decoded = decodeChunk(channel.state.current.decoder, chunk, channel.call.lineLimit ?? DEFAULT_LINE_LIMIT);

    channel.state.update(() => ({ decoder: decoded.state }));

    return decoded.lines;
  } catch (error) {
    failChannel(channel, error);

    return [];
  }
}

function takeData(channel: OpenChannel, chunk: string): void {
  if (channel.state.current.failure) {
    return;
  }

  decodedLines(channel, chunk).every((line) => deliverLine(channel, line));
}

function takeStderr(channel: OpenChannel, chunk: string): void {
  channel.state.update((state) => ({ stderr: `${state.stderr}${chunk}`.slice(0, STDERR_LIMIT) }));
}

/** Gives the end to the handlers one time. */
function endChannel(channel: OpenChannel, exitCode: number | null, error: RowblyError | undefined): void {
  if (channel.state.current.ended) {
    return;
  }

  channel.state.update(() => ({ ended: true }));
  channel.handlers.onClose(error ? { exitCode, error } : { exitCode });
}

function channelClosed(channel: OpenChannel, exitCode: number | null): void {
  const { failure, stderr } = channel.state.current;

  endChannel(channel, exitCode, failure ?? classifySshExit(exitCode, stderr, channel.call.target));
}

function spawnFailed(channel: OpenChannel, error: Error): void {
  const { executable, target } = channel.call;

  endChannel(
    channel,
    null,
    new HostUnreachableError(`Cannot start ${executable}: ${error.message}`, {
      details: { target, executable },
      hint: "Install the OpenSSH client.",
      cause: error,
    }),
  );
}

function sendFrame(channel: OpenChannel, frame: unknown): void {
  if (channel.state.current.ended || !channel.child.stdin.writable) {
    return;
  }

  channel.child.stdin.write(encodeFrame(frame));
}

function closeChannel(channel: OpenChannel): void {
  channel.child.stdin.end();
  channel.child.kill("SIGTERM");
}

/** Starts an SSH process as a channel. Frames go on stdin and come from stdout, one JSON value on each line. */
export function startSshChannel(call: SshChannelCall, handlers: ChannelHandlers): HostChannel {
  const child = spawn(call.executable, [...call.args], { stdio: "pipe" });
  const state = new Store<ChannelState>({ decoder: EMPTY_DECODER, stderr: "", failure: undefined, ended: false });
  const channel: OpenChannel = { call, child, state, handlers };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => takeData(channel, chunk));
  child.stderr.on("data", (chunk: string) => takeStderr(channel, chunk));
  // The host can close the channel before a write completes. The close event tells why.
  child.stdin.on("error", () => undefined);
  child.on("error", (error) => spawnFailed(channel, error));
  child.on("close", (exitCode) => channelClosed(channel, exitCode));

  return {
    send: (frame) => sendFrame(channel, frame),
    close: () => closeChannel(channel),
  };
}
