import { HostUnreachableError } from "../host-transport/host-errors.js";
import type {
  BytesResult,
  ChannelEnd,
  ChannelHandlers,
  HostChannel,
  HostTransport,
  RemoteCommand,
  RequestResult,
  UploadResult,
} from "../host-transport/host-transport.js";
import { validateCommand } from "../host-transport/ssh-transport.js";
import { Store, withMember, withoutMember } from "../store/store.js";

/** The host side of a fake channel. */
export interface FakeRemoteChannel {
  /** Sends a frame from the host to the main machine. */
  send(frame: unknown): void;
  /** Closes the channel from the host side. */
  close(exitCode?: number): void;
  /** The frames that the main machine sent, in order. */
  readonly received: readonly unknown[];
}

/** The behaviour of the fake host. Each handler gets the remote command and a copy of the input. */
export interface FakeHostHandlers {
  readonly request?: (command: RemoteCommand, input: unknown) => RequestResult | Promise<RequestResult>;
  readonly bytes?: (command: RemoteCommand, input: unknown) => BytesResult | Promise<BytesResult>;
  /** Receives the remote command and a copy of the uploaded bytes. */
  readonly upload?: (command: RemoteCommand, data: Buffer) => UploadResult | Promise<UploadResult>;
  /** Starts the host side of a channel. It can return a listener for the frames of the main machine. */
  readonly channel?: (command: RemoteCommand, remote: FakeRemoteChannel) => ((frame: unknown) => void) | undefined;
}

/** An in-process transport for tests. It never uses SSH. */
export interface FakeHostTransport extends HostTransport {
  /** Cuts the connection: open channels close with the unreachable error, and new calls fail with it. */
  disconnect(): void;
  /** Restores the connection. */
  reconnect(): void;
  readonly connected: boolean;
  readonly openChannels: number;
  /** Each upload, in order, with a copy of its exact bytes. */
  readonly uploads: readonly FakeUpload[];
}

/** One upload that the fake host received. */
export interface FakeUpload {
  readonly command: RemoteCommand;
  readonly data: Buffer;
}

interface FakeChannelState {
  readonly received: readonly unknown[];
  readonly listener: ((frame: unknown) => void) | undefined;
  readonly ended: boolean;
}

interface FakeChannel {
  readonly handlers: ChannelHandlers;
  readonly state: Store<FakeChannelState>;
}

interface FakeState {
  readonly connected: boolean;
  readonly uploads: readonly FakeUpload[];
  readonly channels: ReadonlySet<FakeChannel>;
}

interface Fake {
  readonly handlers: FakeHostHandlers;
  readonly state: Store<FakeState>;
}

const TARGET = "fake-host";

/** Copies a value through JSON, as the real transport does. */
function throughJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unreachable(): HostUnreachableError {
  return new HostUnreachableError(`Cannot reach ${TARGET}: Connection closed.`, { details: { target: TARGET } });
}

function checkConnected(fake: Fake, command: RemoteCommand): void {
  validateCommand(command);

  if (!fake.state.current.connected) {
    throw unreachable();
  }
}

async function fakeRequest(fake: Fake, command: RemoteCommand, input: unknown): Promise<RequestResult> {
  checkConnected(fake, command);

  const result = await (fake.handlers.request?.(command, throughJson(input)) ?? {
    exitCode: 0,
    value: null,
    stderr: "",
  });

  return { ...result, value: throughJson(result.value) };
}

async function fakeBytes(fake: Fake, command: RemoteCommand, input: unknown): Promise<BytesResult> {
  checkConnected(fake, command);

  const result = await (fake.handlers.bytes?.(command, throughJson(input)) ?? {
    exitCode: 0,
    bytes: Buffer.alloc(0),
    stderr: "",
  });

  return { ...result, bytes: Buffer.from(result.bytes) };
}

async function fakeUpload(fake: Fake, command: RemoteCommand, data: Buffer): Promise<UploadResult> {
  checkConnected(fake, command);

  const upload: FakeUpload = { command: [...command], data: Buffer.from(data) };

  fake.state.update((state) => ({ uploads: [...state.uploads, upload] }));

  return (await fake.handlers.upload?.(command, Buffer.from(data))) ?? { exitCode: 0, stderr: "" };
}

function endFakeChannel(fake: Fake, channel: FakeChannel, end: ChannelEnd): void {
  if (channel.state.current.ended) {
    return;
  }

  channel.state.update(() => ({ ended: true }));
  fake.state.update((state) => ({ channels: withoutMember(state.channels, channel) }));
  channel.handlers.onClose(end);
}

function deliverToMain(channel: FakeChannel, frame: unknown): void {
  if (!channel.state.current.ended) {
    channel.handlers.onFrame(frame);
  }
}

function deliverToHost(channel: FakeChannel, frame: unknown): void {
  if (channel.state.current.ended) {
    return;
  }

  const copy = throughJson(frame);

  channel.state.update((state) => ({ received: [...state.received, copy] }));
  channel.state.current.listener?.(copy);
}

/** Gives the host side of a channel. Frames to the main machine arrive later, in order, as on a real connection. */
function remoteSide(fake: Fake, channel: FakeChannel): FakeRemoteChannel {
  return {
    send: (frame) => queueMicrotask(() => deliverToMain(channel, throughJson(frame))),
    close: (exitCode = 0) => queueMicrotask(() => endFakeChannel(fake, channel, { exitCode })),
    get received() {
      return channel.state.current.received;
    },
  };
}

async function fakeChannel(fake: Fake, command: RemoteCommand, handlers: ChannelHandlers): Promise<HostChannel> {
  checkConnected(fake, command);

  const channel: FakeChannel = {
    handlers,
    state: new Store<FakeChannelState>({ received: [], listener: undefined, ended: false }),
  };

  fake.state.update((state) => ({ channels: withMember(state.channels, channel) }));

  const listener = fake.handlers.channel?.(command, remoteSide(fake, channel));

  channel.state.update(() => ({ listener }));

  return {
    send: (frame) => deliverToHost(channel, frame),
    close: () => endFakeChannel(fake, channel, { exitCode: null }),
  };
}

function disconnect(fake: Fake): void {
  const { channels } = fake.state.update(() => ({ connected: false }));

  for (const channel of channels) {
    endFakeChannel(fake, channel, { exitCode: 255, error: unreachable() });
  }
}

/** Makes a fake transport. A handler that is not given answers with an empty result. */
export function createFakeHostTransport(handlers: FakeHostHandlers = {}): FakeHostTransport {
  const fake: Fake = { handlers, state: new Store<FakeState>({ connected: true, uploads: [], channels: new Set() }) };

  return {
    request: (command, input) => fakeRequest(fake, command, input),
    bytes: (command, input) => fakeBytes(fake, command, input),
    upload: (command, data) => fakeUpload(fake, command, data),
    channel: (command, channelHandlers) => fakeChannel(fake, command, channelHandlers),
    disconnect: () => disconnect(fake),
    reconnect: () => fake.state.update(() => ({ connected: true })),
    get connected() {
      return fake.state.current.connected;
    },
    get openChannels() {
      return fake.state.current.channels.size;
    },
    get uploads() {
      return fake.state.current.uploads;
    },
  };
}
