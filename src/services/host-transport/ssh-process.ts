import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { RowblyError } from "../errors/errors.js";
import { Store } from "../store/store.js";
import { classifySshExit, HostProtocolError, HostTimeoutError, HostUnreachableError } from "./host-errors.js";

/** The maximum number of bytes of stderr that a call keeps. SSH and Rowbly write short errors. */
export const STDERR_LIMIT = 64 * 1024;

/** One SSH process with the bytes of `stdin`: one JSON line, or the exact bytes of an upload. */
export interface SshCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly target: string;
  readonly stdin: string | Buffer;
  readonly timeoutMs: number;
  readonly limit: number;
}

/** The output of a remote command that SSH ran. A transport failure is an error, not an output. */
export interface SshOutput {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

interface CallState {
  readonly stdout: readonly Buffer[];
  readonly stdoutBytes: number;
  readonly stderr: readonly Buffer[];
  readonly stderrBytes: number;
  readonly failure: RowblyError | undefined;
  readonly timer: NodeJS.Timeout | undefined;
}

interface RunningCall {
  readonly call: SshCall;
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: Store<CallState>;
  readonly resolve: (output: SshOutput) => void;
  readonly reject: (error: unknown) => void;
}

/** Records the first failure and stops the process. A later failure does not replace the first one. */
function failCall(running: RunningCall, failure: RowblyError): void {
  if (running.state.current.failure) {
    return;
  }

  running.state.update(() => ({ failure }));
  running.child.kill("SIGKILL");
}

function takeStdout(running: RunningCall, chunk: Buffer): void {
  const { limit } = running.call;
  const { stdoutBytes, failure } = running.state.current;

  if (failure) {
    return;
  }

  if (stdoutBytes + chunk.length > limit) {
    failCall(
      running,
      new HostProtocolError(`The output of the host is larger than the limit of ${limit} bytes.`, {
        details: { limit, target: running.call.target },
      }),
    );

    return;
  }

  running.state.update((state) => ({
    stdout: [...state.stdout, chunk],
    stdoutBytes: state.stdoutBytes + chunk.length,
  }));
}

/** Keeps the start of stderr, up to `STDERR_LIMIT` bytes. The rest is not kept. */
function takeStderr(running: RunningCall, chunk: Buffer): void {
  const room = STDERR_LIMIT - running.state.current.stderrBytes;

  if (room <= 0) {
    return;
  }

  const kept = chunk.subarray(0, room);

  running.state.update((state) => ({ stderr: [...state.stderr, kept], stderrBytes: state.stderrBytes + kept.length }));
}

function timeOut(running: RunningCall): void {
  const { timeoutMs, target } = running.call;

  failCall(
    running,
    new HostTimeoutError(`The call to ${target} did not complete in ${timeoutMs} ms.`, {
      details: { target, timeoutMs },
    }),
  );
}

/** The SSH executable could not start, for example because it is not installed. */
function spawnFailed(running: RunningCall, error: Error): void {
  clearTimeout(running.state.current.timer);
  running.reject(
    new HostUnreachableError(`Cannot start ${running.call.executable}: ${error.message}`, {
      details: { target: running.call.target, executable: running.call.executable },
      hint: "Install the OpenSSH client.",
      cause: error,
    }),
  );
}

function finishCall(running: RunningCall, exitCode: number | null): void {
  const { failure, stdout, stderr, timer } = running.state.current;
  const text = Buffer.concat(stderr).toString("utf8");
  const transportError = failure ?? classifySshExit(exitCode, text, running.call.target);

  clearTimeout(timer);

  if (transportError) {
    running.reject(transportError);

    return;
  }

  running.resolve({ exitCode: exitCode ?? -1, stdout: Buffer.concat(stdout), stderr: text });
}

function startCall(call: SshCall, resolve: (output: SshOutput) => void, reject: (error: unknown) => void): void {
  const child = spawn(call.executable, [...call.args], { stdio: "pipe" });
  const state = new Store<CallState>({
    stdout: [],
    stdoutBytes: 0,
    stderr: [],
    stderrBytes: 0,
    failure: undefined,
    timer: undefined,
  });
  const running: RunningCall = { call, child, state, resolve, reject };

  state.update(() => ({ timer: setTimeout(() => timeOut(running), call.timeoutMs) }));

  child.stdout.on("data", (chunk: Buffer) => takeStdout(running, chunk));
  child.stderr.on("data", (chunk: Buffer) => takeStderr(running, chunk));
  // The remote command can exit before it reads stdin. Then the write fails with EPIPE, and the exit code tells why.
  child.stdin.on("error", () => undefined);
  child.on("error", (error) => spawnFailed(running, error));
  child.on("close", (exitCode) => finishCall(running, exitCode));
  child.stdin.end(call.stdin);
}

/**
 * Runs one SSH process. It writes the bytes of `stdin`, and collects stdout up to the limit.
 * It never uses a shell. It rejects with a transport error, and resolves with the output of the remote command.
 */
export function runSshCall(call: SshCall): Promise<SshOutput> {
  return new Promise((resolve, reject) => startCall(call, resolve, reject));
}
