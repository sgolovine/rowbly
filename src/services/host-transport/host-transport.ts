import pkg from "../../../package.json" with { type: "json" };
import type { RowblyError } from "../errors/errors.js";

/** The version of the protocol between the main machine and a worker host. Increase it for each change of a frame. */
export const HOST_PROTOCOL_VERSION = 2;

/** The default time limit of a request call or a bytes call: 30 seconds. */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** The default limit of the output of a request call or a bytes call: 10 MiB. */
export const DEFAULT_OUTPUT_LIMIT = 10 * 1024 * 1024;

/** The default time that a channel waits for the hello frame: 15 seconds. */
export const DEFAULT_HELLO_TIMEOUT_MS = 15_000;

/** The fixed tokens of a remote command, for example `[<remote rowbly>, "host", "attach"]`. */
export type RemoteCommand = readonly string[];

export interface CallOptions {
  /** The time limit of the call. */
  readonly timeoutMs?: number;
  /** The maximum number of bytes of the output. */
  readonly limit?: number;
}

/**
 * The result of a request call. An exit code other than 0 is the result of the remote command, not a transport
 * failure. Then `value` is `undefined`, and `stderr` has the text of the remote command.
 */
export interface RequestResult {
  readonly exitCode: number;
  readonly value: unknown;
  readonly stderr: string;
}

/** The result of a bytes call. `bytes` holds the exact output of the remote command. */
export interface BytesResult {
  readonly exitCode: number;
  readonly bytes: Buffer;
  readonly stderr: string;
}

/** The result of an upload call. The remote command reads the bytes on stdin. */
export interface UploadResult {
  readonly exitCode: number;
  readonly stderr: string;
}

/** How a channel ended. `error` is set when the transport failed, for example when the host became unreachable. */
export interface ChannelEnd {
  readonly exitCode: number | null;
  readonly error?: RowblyError;
}

export interface ChannelHandlers {
  /** Receives each frame from the host, in order. */
  readonly onFrame: (frame: unknown) => void;
  /** Receives the end of the channel, one time. */
  readonly onClose: (end: ChannelEnd) => void;
}

export interface ChannelOptions {
  /** The maximum number of bytes of one frame line. */
  readonly lineLimit?: number;
}

/** A long-lived connection to the host with framed JSON lines in both directions. */
export interface HostChannel {
  send(frame: unknown): void;
  close(): void;
}

/** The connection of the main machine to one worker host. */
export interface HostTransport {
  /** Sends one JSON value on stdin, and gives the one JSON value of stdout. */
  request(command: RemoteCommand, input: unknown, options?: CallOptions): Promise<RequestResult>;
  /** Sends one JSON value on stdin, and gives the bytes of stdout, for example an attachment file. */
  bytes(command: RemoteCommand, input: unknown, options?: CallOptions): Promise<BytesResult>;
  /** Sends the exact bytes of `data` on stdin, for example a package file. The remote command writes them to a file. */
  upload(command: RemoteCommand, data: Buffer, options?: CallOptions): Promise<UploadResult>;
  /** Opens a channel. The data of the main machine goes on stdin as frames. */
  channel(command: RemoteCommand, handlers: ChannelHandlers, options?: ChannelOptions): Promise<HostChannel>;
}

/** The versions that the two sides of a connection compare. */
export interface HostVersions {
  readonly protocol: number;
  readonly rowbly: string;
}

/** The first frame that the host sends on a channel. */
export interface HostHello extends HostVersions {
  readonly type: "hello";
}

/** Gives the protocol version and the Rowbly version of this process. */
export function localVersions(): HostVersions {
  return { protocol: HOST_PROTOCOL_VERSION, rowbly: pkg.version };
}

/** Makes the hello frame for a side with these versions. */
export function helloFrame(versions: HostVersions = localVersions()): HostHello {
  return { type: "hello", protocol: versions.protocol, rowbly: versions.rowbly };
}
