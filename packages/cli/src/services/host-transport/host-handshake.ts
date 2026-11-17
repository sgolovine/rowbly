import { Store } from "../store/store.js";
import { HostProtocolError, HostTimeoutError, HostVersionMismatchError } from "./host-errors.js";
import {
  type ChannelEnd,
  type ChannelHandlers,
  type ChannelOptions,
  DEFAULT_HELLO_TIMEOUT_MS,
  type HostChannel,
  type HostHello,
  type HostTransport,
  type HostVersions,
  localVersions,
  type RemoteCommand,
} from "./host-transport.js";

export interface HostChannelOptions extends ChannelOptions {
  /** The versions of the main machine. The default is the versions of this Rowbly. */
  readonly local?: HostVersions;
  readonly helloTimeoutMs?: number;
}

function isHello(frame: unknown): frame is HostHello {
  const hello = frame as Partial<HostHello> | null;

  return (
    typeof hello === "object" &&
    hello !== null &&
    hello.type === "hello" &&
    typeof hello.protocol === "number" &&
    typeof hello.rowbly === "string"
  );
}

/** Compares the hello frame of the host with the local versions. It throws when they are not equal. */
export function checkHello(frame: unknown, local: HostVersions = localVersions()): HostHello {
  if (!isHello(frame)) {
    throw new HostProtocolError("The host did not start the channel with a hello frame.", {
      details: { frame },
    });
  }

  if (frame.protocol !== local.protocol || frame.rowbly !== local.rowbly) {
    throw new HostVersionMismatchError(
      `The host uses protocol ${frame.protocol} and Rowbly ${frame.rowbly}, but this machine uses protocol ${local.protocol} and Rowbly ${local.rowbly}.`,
      {
        details: {
          localProtocol: local.protocol,
          remoteProtocol: frame.protocol,
          localRowbly: local.rowbly,
          remoteRowbly: frame.rowbly,
        },
        hint: "Install the same Rowbly version on the host and on this machine.",
      },
    );
  }

  return frame;
}

type HandshakePhase = "hello" | "open" | "done";

interface HandshakeState {
  readonly phase: HandshakePhase;
  readonly channel: HostChannel | undefined;
  readonly timer: NodeJS.Timeout | undefined;
}

interface Handshake {
  readonly state: Store<HandshakeState>;
  readonly handlers: ChannelHandlers;
  readonly local: HostVersions;
  readonly resolve: (channel: HostChannel) => void;
  readonly reject: (error: unknown) => void;
}

/** Ends the handshake with an error. The channel closes when it is open, or when it opens later. */
function failHandshake(handshake: Handshake, error: unknown): void {
  const { channel, timer } = handshake.state.current;

  clearTimeout(timer);
  handshake.state.update(() => ({ phase: "done" }));
  channel?.close();
  handshake.reject(error);
}

function acceptHello(handshake: Handshake, frame: unknown): void {
  try {
    checkHello(frame, handshake.local);
  } catch (error) {
    failHandshake(handshake, error);

    return;
  }

  const { channel, timer } = handshake.state.update(() => ({ phase: "open" }));

  clearTimeout(timer);

  if (channel) {
    handshake.resolve(channel);
  }
}

function handshakeFrame(handshake: Handshake, frame: unknown): void {
  const { phase } = handshake.state.current;

  if (phase === "hello") {
    acceptHello(handshake, frame);

    return;
  }

  if (phase === "open") {
    handshake.handlers.onFrame(frame);
  }
}

function handshakeClose(handshake: Handshake, end: ChannelEnd): void {
  const { phase } = handshake.state.current;

  if (phase === "hello") {
    failHandshake(handshake, end.error ?? new HostProtocolError("The channel closed before the hello frame."));

    return;
  }

  if (phase === "open") {
    handshake.handlers.onClose(end);
  }
}

function helloTimeout(handshake: Handshake, timeoutMs: number): void {
  if (handshake.state.current.phase === "hello") {
    failHandshake(handshake, new HostTimeoutError(`The host did not send a hello frame in ${timeoutMs} ms.`));
  }
}

/** Records the open channel. A hello that arrived before the channel promise resolved completes the handshake now. */
function channelOpened(handshake: Handshake, channel: HostChannel): void {
  const { phase } = handshake.state.update(() => ({ channel }));

  if (phase === "done") {
    channel.close();

    return;
  }

  if (phase === "open") {
    handshake.resolve(channel);
  }
}

function startHandshake(
  transport: HostTransport,
  command: RemoteCommand,
  options: HostChannelOptions,
  handshake: Handshake,
): void {
  const timeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const timer = setTimeout(() => helloTimeout(handshake, timeoutMs), timeoutMs);
  const handlers: ChannelHandlers = {
    onFrame: (frame) => handshakeFrame(handshake, frame),
    onClose: (end) => handshakeClose(handshake, end),
  };

  handshake.state.update(() => ({ timer }));
  transport.channel(command, handlers, options).then(
    (channel) => channelOpened(handshake, channel),
    (error: unknown) => failHandshake(handshake, error),
  );
}

/**
 * Opens a channel and does the handshake. The host must send a hello frame first. The promise resolves when the
 * versions are equal. It rejects with `HostVersionMismatchError` when they are different, and closes the channel.
 */
export function openHostChannel(
  transport: HostTransport,
  command: RemoteCommand,
  handlers: ChannelHandlers,
  options: HostChannelOptions = {},
): Promise<HostChannel> {
  const state = new Store<HandshakeState>({ phase: "hello", channel: undefined, timer: undefined });
  const local = options.local ?? localVersions();

  return new Promise((resolve, reject) =>
    startHandshake(transport, command, options, { state, handlers, local, resolve, reject }),
  );
}
