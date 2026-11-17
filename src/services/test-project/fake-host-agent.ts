// A worker host for tests. It answers the `rowbly host` commands of the fake transport with the real host services
// in this process, in a temporary home folder. It never uses SSH.

import { PassThrough } from "node:stream";
import { ValidationError } from "../errors/errors.js";
import { type HostAgentResult, runHostAgent } from "../host-agent/host-agent.js";
import { hostCacheMissing, hostCachePut } from "../host-agent/host-agent-cache.js";
import { submitHostCommand } from "../host-agent/host-agent-control.js";
import { type HostAgentPaths, hostAgentPaths, hostRunPathsAnswer } from "../host-agent/host-agent-paths.js";
import { prepareHostThread } from "../host-agent/host-agent-prepare.js";
import type { HostWorkRunner } from "../host-agent/host-agent-work.js";
import { runHostAttach } from "../host-agent/host-attach.js";
import { applyHostInbound } from "../host-agent/host-inbound.js";
import { hostPing } from "../host-agent/host-ping.js";
import { hostRuns } from "../host-agent/host-runs.js";
import { hostSessionBytes } from "../host-agent/host-session-bytes.js";
import { writeSlotLimit } from "../host-agent/host-slots.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { BytesResult, RemoteCommand, RequestResult, UploadResult } from "../host-transport/host-transport.js";
import { encodeFrame } from "../host-transport/json-lines.js";
import { readOutboxBlob } from "../outbox/outbox-file.js";
import { hostOutboxAck, hostOutboxEntries } from "../outbox/outbox-host.js";
import { Store } from "../store/store.js";
import { createFakeHostTransport, type FakeHostTransport, type FakeRemoteChannel } from "./fake-host-transport.js";

export interface FakeHostAgentOptions {
  readonly projectId: string;
  /** The home folder of the host user. */
  readonly home: string;
  /** Runs the work of the agent. Tests give a runner with a faux Pi runtime. */
  readonly runner: HostWorkRunner;
  readonly pollMs?: number;
}

/** A worker host with its transport. */
export interface FakeHostAgent {
  readonly transport: FakeHostTransport;
  readonly paths: HostAgentPaths;
  /** The remote commands that the main machine ran, in order. */
  readonly calls: readonly RemoteCommand[];
  /** While it is on, each outbox call fails with the unreachable error of the transport. */
  readonly failOutbox: (fail: boolean) => void;
  /** Stops the host agent and each attach channel. */
  readonly stop: () => Promise<void>;
}

interface FakeAgentState {
  readonly agent?: Promise<HostAgentResult>;
  readonly inputs: readonly PassThrough[];
  readonly calls: readonly RemoteCommand[];
  readonly failOutbox: boolean;
}

interface FakeAgent {
  readonly options: FakeHostAgentOptions;
  readonly paths: HostAgentPaths;
  readonly stopped: AbortController;
  readonly state: Store<FakeAgentState>;
}

type RequestHandler = (fake: FakeAgent, input: unknown) => Promise<unknown>;

function record(fake: FakeAgent, command: RemoteCommand): void {
  fake.state.update((state) => ({ calls: [...state.calls, [...command]] }));
}

function checkOutbox(fake: FakeAgent): void {
  if (fake.state.current.failOutbox) {
    throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
  }
}

/** Starts the agent loop when it does not run, as `host serve --detach` does. */
async function serve(fake: FakeAgent, input: unknown): Promise<unknown> {
  const { maxWorkers } = input as { maxWorkers: number };
  const { options } = fake;

  await writeSlotLimit(maxWorkers, options.home);

  if (fake.state.current.agent) {
    return { started: false };
  }

  const agent = runHostAgent({
    projectId: options.projectId,
    home: options.home,
    runner: options.runner,
    pollMs: options.pollMs ?? 20,
    signal: fake.stopped.signal,
  }).finally(() => fake.state.update(() => ({ agent: undefined })));

  fake.state.update(() => ({ agent }));

  return { started: true };
}

async function outboxEntries(fake: FakeAgent, input: unknown): Promise<unknown> {
  checkOutbox(fake);

  return hostOutboxEntries({ dir: fake.paths.outbox, text: JSON.stringify(input) });
}

async function outboxAck(fake: FakeAgent, input: unknown): Promise<unknown> {
  checkOutbox(fake);

  return hostOutboxAck({ dir: fake.paths.outbox, text: JSON.stringify(input) });
}

const REQUESTS: Readonly<Record<string, RequestHandler>> = {
  "cache-missing": (fake, input) => hostCacheMissing(fake.paths, input),
  "run-paths": (fake, input) => Promise.resolve(hostRunPathsAnswer(fake.options.projectId, input, fake.options.home)),
  prepare: (fake, input) => prepareHostThread(fake.paths, input, { home: fake.options.home }),
  inbound: (fake, input) => applyHostInbound(fake.paths, input),
  serve,
  submit: (fake, input) => submitHostCommand(fake.paths, JSON.stringify(input)),
  ping: (fake) => hostPing(fake.paths, fake.options.home),
  runs: (fake, input) => hostRuns(fake.paths, input),
  outbox: outboxEntries,
  "outbox-ack": outboxAck,
};

/** Gives the answer of a command that failed: a transport error stays an error, other errors exit with code 1. */
function failedCall(error: unknown): { exitCode: number; stderr: string } {
  if (error instanceof HostUnreachableError) {
    throw error;
  }

  return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
}

async function request(fake: FakeAgent, command: RemoteCommand, input: unknown): Promise<RequestResult> {
  record(fake, command);

  const handler = REQUESTS[command[2] ?? ""];

  try {
    if (!handler) {
      throw new ValidationError(`Unknown host command ${command[2]}`);
    }

    return { exitCode: 0, value: await handler(fake, input), stderr: "" };
  } catch (error) {
    return { ...failedCall(error), value: undefined };
  }
}

/** Gives the output of a bytes command: the session bytes of a Thread, or an outbox blob. */
function readBytes(fake: FakeAgent, command: RemoteCommand, input: unknown): Promise<Buffer> {
  if (command[2] === "session-bytes") {
    return hostSessionBytes(fake.paths, input);
  }

  checkOutbox(fake);

  return readOutboxBlob({ dir: fake.paths.outbox, sha256: command[3] ?? "" });
}

async function bytes(fake: FakeAgent, command: RemoteCommand, input: unknown): Promise<BytesResult> {
  record(fake, command);

  try {
    return { exitCode: 0, bytes: await readBytes(fake, command, input), stderr: "" };
  } catch (error) {
    return { ...failedCall(error), bytes: Buffer.alloc(0) };
  }
}

async function upload(fake: FakeAgent, command: RemoteCommand, data: Buffer): Promise<UploadResult> {
  record(fake, command);

  try {
    await hostCachePut(fake.paths, command[4] ?? "", data);

    return { exitCode: 0, stderr: "" };
  } catch (error) {
    return failedCall(error);
  }
}

/** Writes a frame of the main machine to the input of the channel as one JSON line, as SSH does. */
function writeInput(input: PassThrough, frame: unknown): void {
  if (!input.writableEnded) {
    input.write(encodeFrame(frame));
  }
}

/**
 * Runs `host attach` for the channel. The frames of the main machine go to its input. The channel of the host stops
 * when the fake agent stops.
 */
function attach(fake: FakeAgent, command: RemoteCommand, remote: FakeRemoteChannel): (frame: unknown) => void {
  const input = new PassThrough();

  record(fake, command);
  fake.state.update((state) => ({ inputs: [...state.inputs, input] }));
  void runHostAttach({
    projectId: fake.options.projectId,
    home: fake.options.home,
    pollMs: fake.options.pollMs ?? 20,
    input,
    write: (line) => remote.send(JSON.parse(line)),
  });

  return (frame) => writeInput(input, frame);
}

async function stop(fake: FakeAgent): Promise<void> {
  fake.stopped.abort();

  for (const input of fake.state.current.inputs) {
    input.end();
  }

  await fake.state.current.agent;
}

/** Makes a fake worker host with the real host services in a temporary home folder. */
export function createFakeHostAgent(options: FakeHostAgentOptions): FakeHostAgent {
  const fake: FakeAgent = {
    options,
    paths: hostAgentPaths(options.projectId, options.home),
    stopped: new AbortController(),
    state: new Store<FakeAgentState>({ inputs: [], calls: [], failOutbox: false }),
  };
  const transport = createFakeHostTransport({
    request: (command, input) => request(fake, command, input),
    bytes: (command, input) => bytes(fake, command, input),
    upload: (command, data) => upload(fake, command, data),
    channel: (command, remote) => attach(fake, command, remote),
  });

  return {
    transport,
    paths: fake.paths,
    get calls() {
      return fake.state.current.calls;
    },
    failOutbox: (fail) => void fake.state.update(() => ({ failOutbox: fail })),
    stop: () => stop(fake),
  };
}
