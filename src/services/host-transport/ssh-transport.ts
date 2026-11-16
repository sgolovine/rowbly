import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { HostProtocolError } from "./host-errors.js";
import {
  type BytesResult,
  type CallOptions,
  type ChannelHandlers,
  type ChannelOptions,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_OUTPUT_LIMIT,
  type HostChannel,
  type HostTransport,
  type RemoteCommand,
  type RequestResult,
  type UploadResult,
} from "./host-transport.js";
import { encodeFrame, parseFrame } from "./json-lines.js";
import { startSshChannel } from "./ssh-channel.js";
import { runSshCall, type SshOutput } from "./ssh-process.js";

/** The default interval of the SSH keepalive messages, in seconds. SSH stops after 3 messages without an answer. */
export const DEFAULT_SERVER_ALIVE_INTERVAL = 15;

/** The default time that the shared SSH connection stays open after the last call, in seconds. */
export const DEFAULT_CONTROL_PERSIST = 60;

export interface SshTransportOptions {
  /** The SSH target, for example `user@host` or a `Host` alias of `~/.ssh/config`. */
  readonly target: string;
  /** The SSH executable. Tests give a stub. */
  readonly sshExecutable?: string;
  /** The private folder of the ControlMaster sockets. */
  readonly controlDir?: string;
  readonly serverAliveInterval?: number;
  readonly controlPersist?: number;
}

/** The settings of the SSH connection, with the defaults applied. */
export interface SshSettings {
  readonly target: string;
  readonly sshExecutable: string;
  readonly controlDir: string;
  readonly serverAliveInterval: number;
  readonly controlPersist: number;
}

/**
 * The characters that a remote command token can have. The remote shell does not change these characters.
 * `@` is safe in `sh`, `bash`, `zsh` and `fish`, and npm needs it in a package spec such as `rowbly@1.0.0`.
 */
const SAFE_TOKEN = /^[A-Za-z0-9._/=:@-]+$/;

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);

    return code < 0x20 || code === 0x7f;
  });
}

/** Refuses an SSH target that SSH can read as an option, or that has whitespace or a control character. */
export function validateTarget(target: string): void {
  if (target === "" || target.startsWith("-") || /\s/.test(target) || hasControlCharacter(target)) {
    throw new ValidationError(`The SSH target ${JSON.stringify(target)} is not valid.`, {
      details: {
        issues: [{ path: ["target"], message: "Use a target without whitespace that does not start with -." }],
      },
    });
  }
}

/** `true` when the remote shell cannot change the token. */
export function isSafeToken(token: string): boolean {
  return SAFE_TOKEN.test(token);
}

/** Refuses a remote command with a token that the remote shell can change. SSH joins the tokens into a shell string. */
export function validateCommand(command: RemoteCommand): void {
  const bad = command.find((token) => !isSafeToken(token));

  if (command.length === 0 || bad !== undefined) {
    throw new ValidationError("The remote command has a token that is not safe.", {
      details: {
        token: bad,
        issues: [{ path: ["command"], message: "Each token can have only A-Z, a-z, 0-9 and . _ / = : @ -." }],
      },
    });
  }
}

/** The default ControlMaster folder. The path is short, because a Unix socket path has a limit of about 108 bytes. */
export function defaultControlDir(): string {
  return join(tmpdir(), `rowbly-ssh-${process.getuid?.() ?? "user"}`);
}

/** Applies the defaults to the options. */
export function sshSettings(options: SshTransportOptions): SshSettings {
  return {
    target: options.target,
    sshExecutable: options.sshExecutable ?? "ssh",
    controlDir: options.controlDir ?? defaultControlDir(),
    serverAliveInterval: options.serverAliveInterval ?? DEFAULT_SERVER_ALIVE_INTERVAL,
    controlPersist: options.controlPersist ?? DEFAULT_CONTROL_PERSIST,
  };
}

/**
 * Gives the arguments of the SSH executable. `--` comes before the target, so that the target cannot be an option.
 * The data of a call never goes in the arguments. It goes on stdin.
 */
export function sshArguments(settings: SshSettings, command: RemoteCommand): string[] {
  validateTarget(settings.target);
  validateCommand(command);

  return [...sshOptions(settings), "--", settings.target, ...command];
}

/** The `-o` options of each SSH call: no password prompt, keepalive and a shared connection. */
export function sshOptions(settings: SshSettings): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    `ServerAliveInterval=${settings.serverAliveInterval}`,
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${join(settings.controlDir, "%C")}`,
    "-o",
    `ControlPersist=${settings.controlPersist}`,
  ];
}

/** Makes the ControlMaster folder, and makes it private to the user. */
export async function ensureControlDir(settings: SshSettings): Promise<void> {
  await mkdir(settings.controlDir, { recursive: true, mode: 0o700 });
  await chmod(settings.controlDir, 0o700);
}

async function call(settings: SshSettings, command: RemoteCommand, stdin: string | Buffer, options: CallOptions) {
  const args = sshArguments(settings, command);

  await ensureControlDir(settings);

  return runSshCall({
    executable: settings.sshExecutable,
    args,
    target: settings.target,
    stdin,
    timeoutMs: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    limit: options.limit ?? DEFAULT_OUTPUT_LIMIT,
  });
}

/** Reads the one JSON value of a successful request. An exit code other than 0 has no value. */
function requestResult(output: SshOutput): RequestResult {
  if (output.exitCode !== 0) {
    return { exitCode: output.exitCode, value: undefined, stderr: output.stderr };
  }

  const text = output.stdout.toString("utf8").trim();

  if (text === "") {
    throw new HostProtocolError("The host did not send a JSON value.", {
      details: { output: text.slice(0, 200) },
    });
  }

  return { exitCode: 0, value: parseFrame(text), stderr: output.stderr };
}

async function request(
  settings: SshSettings,
  command: RemoteCommand,
  input: unknown,
  options: CallOptions = {},
): Promise<RequestResult> {
  return requestResult(await call(settings, command, encodeFrame(input), options));
}

async function bytes(
  settings: SshSettings,
  command: RemoteCommand,
  input: unknown,
  options: CallOptions = {},
): Promise<BytesResult> {
  const output = await call(settings, command, encodeFrame(input), options);

  return { exitCode: output.exitCode, bytes: output.stdout, stderr: output.stderr };
}

async function upload(
  settings: SshSettings,
  command: RemoteCommand,
  data: Buffer,
  options: CallOptions = {},
): Promise<UploadResult> {
  const output = await call(settings, command, data, options);

  return { exitCode: output.exitCode, stderr: output.stderr };
}

async function channel(
  settings: SshSettings,
  command: RemoteCommand,
  handlers: ChannelHandlers,
  options: ChannelOptions = {},
): Promise<HostChannel> {
  const args = sshArguments(settings, command);

  await ensureControlDir(settings);

  return startSshChannel(
    { executable: settings.sshExecutable, args, target: settings.target, lineLimit: options.lineLimit },
    handlers,
  );
}

/** Makes the SSH transport for one worker host. It refuses a target that is not valid before SSH starts. */
export function createSshTransport(options: SshTransportOptions): HostTransport {
  const settings = sshSettings(options);

  validateTarget(settings.target);

  return {
    request: (command, input, callOptions) => request(settings, command, input, callOptions),
    bytes: (command, input, callOptions) => bytes(settings, command, input, callOptions),
    upload: (command, data, callOptions) => upload(settings, command, data, callOptions),
    channel: (command, handlers, channelOptions) => channel(settings, command, handlers, channelOptions),
  };
}
