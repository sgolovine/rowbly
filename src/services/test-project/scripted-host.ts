// A worker host for tests with scripted answers. The test sends the `run` frames. It runs no host service and no Pi.

import type { HostRunState } from "../host-agent/host-run-state.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import {
  type BytesResult,
  type HostVersions,
  helloFrame,
  localVersions,
  type RemoteCommand,
  type RequestResult,
} from "../host-transport/host-transport.js";
import { Store } from "../store/store.js";
import { createFakeHostTransport, type FakeHostTransport, type FakeRemoteChannel } from "./fake-host-transport.js";

/** One request call that the host got. */
export interface ScriptedRequest {
  readonly command: RemoteCommand;
  readonly input: unknown;
}

/** One command of `host submit`. */
export interface ScriptedCommand {
  readonly id: string;
  readonly type: string;
  readonly threadId: string;
}

export interface ScriptedHostOptions {
  /** The attachment ids that `cache-missing` gives. The default is each id of the request. */
  readonly missing?: readonly string[];
  /** The versions of the hello frame. The default is the versions of this Rowbly. */
  readonly versions?: HostVersions;
  /** Answers each submitted command, for example with frames. */
  readonly onSubmit?: (command: ScriptedCommand, host: ScriptedHost) => void;
  /** The receipt that `host submit` gives. The default is null. */
  readonly receipt?: (command: ScriptedCommand) => unknown;
  /**
   * Called after the host wrote a submitted command. When it gives true, the answer is lost: the call fails with the
   * unreachable error of the transport.
   */
  readonly loseAnswer?: (command: ScriptedCommand, host: ScriptedHost) => boolean;
  /** Answers each bytes call, for example `session-bytes`. The default is no bytes. */
  readonly bytes?: (command: RemoteCommand, input: unknown) => BytesResult | Promise<BytesResult>;
}

export interface ScriptedHost {
  readonly transport: FakeHostTransport;
  readonly requests: readonly ScriptedRequest[];
  /** The commands of `host submit`, in order. */
  readonly commands: readonly ScriptedCommand[];
  /** Each request and each new channel, in order: the name of the request, `submit:<type>` or `attach`. */
  readonly events: readonly string[];
  /** Sends a frame on each open channel. */
  readonly send: (frame: unknown) => void;
  /** Sends a `run` frame of the last `launch` or `resume` command of the Thread, with the fields of `patch`. */
  readonly sendRun: (threadId: string, patch: Partial<HostRunState>) => void;
  /** Closes each open channel from the host side. */
  readonly closeChannels: () => void;
  /** While it is on, each outbox call fails with the unreachable error of the transport. */
  readonly failOutbox: (fail: boolean) => void;
}

interface ScriptedState {
  readonly requests: readonly ScriptedRequest[];
  readonly events: readonly string[];
  readonly channels: readonly FakeRemoteChannel[];
  readonly failOutbox: boolean;
}

interface Scripted {
  readonly options: ScriptedHostOptions;
  readonly state: Store<ScriptedState>;
  readonly host: Store<{ readonly value?: ScriptedHost }>;
}

function ok(value: unknown): RequestResult {
  return { exitCode: 0, value, stderr: "" };
}

function commandsOf(scripted: Scripted): ScriptedCommand[] {
  return scripted.state.current.requests
    .filter((request) => request.command[2] === "submit")
    .map((request) => request.input as ScriptedCommand);
}

function runPaths(input: unknown) {
  const { threadId, storyId } = input as { threadId: string; storyId: string };
  const agent = "/host/agent";

  return {
    clone: "/host/repo",
    copy: `${agent}/threads/${threadId}/copy`,
    worktree: `/host/repo-worktrees/${storyId}`,
    lock: `${agent}/threads/${threadId}/write.lock`,
    shim: `${agent}/bin/rowbly`,
    outbox: `${agent}/outbox`,
  };
}

function checkOutbox(scripted: Scripted): void {
  if (scripted.state.current.failOutbox) {
    throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
  }
}

function submitted(scripted: Scripted, input: unknown): RequestResult {
  const command = input as ScriptedCommand;
  const host = scripted.host.current.value;

  if (host) {
    queueMicrotask(() => scripted.options.onSubmit?.(command, host));
  }

  if (host && scripted.options.loseAnswer?.(command, host)) {
    throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
  }

  return ok(scripted.options.receipt?.(command) ?? null);
}

function answer(scripted: Scripted, command: RemoteCommand, input: unknown): RequestResult {
  const name = command[2] ?? "";
  const event = name === "submit" ? `submit:${(input as ScriptedCommand).type}` : name;

  scripted.state.update((state) => ({
    requests: [...state.requests, { command: [...command], input }],
    events: [...state.events, event],
  }));

  if (name === "outbox" || name === "outbox-ack") {
    checkOutbox(scripted);

    return ok(name === "outbox" ? { entries: [] } : { removed: 0, blobs: [] });
  }

  if (name === "cache-missing") {
    return ok({ missing: scripted.options.missing ?? (input as { ids: string[] }).ids });
  }

  if (name === "run-paths") {
    return ok(runPaths(input));
  }

  if (name === "ping") {
    return ok({
      ...(scripted.options.versions ?? localVersions()),
      agent: "running",
      slots: { used: 0, max: 2 },
      pending: 0,
    });
  }

  return name === "submit" ? submitted(scripted, input) : ok({});
}

function openChannel(scripted: Scripted, remote: FakeRemoteChannel): undefined {
  scripted.state.update((state) => ({ channels: [...state.channels, remote], events: [...state.events, "attach"] }));
  remote.send(helloFrame(scripted.options.versions));

  return undefined;
}

function sendRun(scripted: Scripted, threadId: string, patch: Partial<HostRunState>): void {
  const command = commandsOf(scripted).findLast(
    (candidate) => candidate.threadId === threadId && ["launch", "resume"].includes(candidate.type),
  );
  const now = new Date().toISOString();
  const run: HostRunState = {
    version: 1,
    threadId,
    requestId: command?.id ?? "none",
    kind: command?.type === "resume" ? "resume" : "launch",
    phase: "running",
    startedAt: now,
    updatedAt: now,
    ...patch,
  };

  sendAll(scripted, { type: "run", run });
}

function sendAll(scripted: Scripted, frame: unknown): void {
  for (const channel of scripted.state.current.channels) {
    channel.send(frame);
  }
}

function closeAll(scripted: Scripted): void {
  for (const channel of scripted.state.current.channels) {
    channel.close(255);
  }

  scripted.state.update(() => ({ channels: [] }));
}

/** Makes a scripted worker host. */
export function createScriptedHost(options: ScriptedHostOptions = {}): ScriptedHost {
  const scripted: Scripted = {
    options,
    state: new Store<ScriptedState>({ requests: [], events: [], channels: [], failOutbox: false }),
    host: new Store<{ readonly value?: ScriptedHost }>({}),
  };
  const transport = createFakeHostTransport({
    request: (command, input) => answer(scripted, command, input),
    ...(options.bytes ? { bytes: options.bytes } : {}),
    channel: (_command, remote) => openChannel(scripted, remote),
  });
  const host: ScriptedHost = {
    transport,
    get requests() {
      return scripted.state.current.requests;
    },
    get commands() {
      return commandsOf(scripted);
    },
    get events() {
      return scripted.state.current.events;
    },
    send: (frame) => sendAll(scripted, frame),
    sendRun: (threadId, patch) => sendRun(scripted, threadId, patch),
    closeChannels: () => closeAll(scripted),
    failOutbox: (fail) => void scripted.state.update(() => ({ failOutbox: fail })),
  };

  scripted.host.update(() => ({ value: host }));

  return host;
}
