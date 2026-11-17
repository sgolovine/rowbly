import { RowblyError } from "../errors/errors.js";

/** SSH cannot connect to the worker host: the name does not resolve, or the connection fails or closes. */
export class HostUnreachableError extends RowblyError {
  readonly code = "HOST_UNREACHABLE";
}

/** SSH connects to the worker host, but the host refuses the key or the host key does not match. */
export class HostAuthFailedError extends RowblyError {
  readonly code = "HOST_AUTH_FAILED";
}

/** The worker host uses a different host protocol version or Rowbly version. */
export class HostVersionMismatchError extends RowblyError {
  readonly code = "HOST_VERSION_MISMATCH";
}

/** A call to the worker host did not complete in its time limit. */
export class HostTimeoutError extends RowblyError {
  readonly code = "HOST_TIMEOUT";
}

/** The worker host sent data that does not agree with the host protocol, for example a bad frame. */
export class HostProtocolError extends RowblyError {
  readonly code = "HOST_PROTOCOL";
}

/** True when the error is an error of the connection to a worker host, or of the host protocol. */
export function isHostTransportError(error: unknown): error is RowblyError {
  return [
    HostUnreachableError,
    HostAuthFailedError,
    HostVersionMismatchError,
    HostTimeoutError,
    HostProtocolError,
  ].some((type) => error instanceof type);
}

const AUTH_FAILURES = ["Permission denied", "Host key verification failed"];
const UNREACHABLE_FAILURES = [
  "Could not resolve hostname",
  "Connection refused",
  "No route to host",
  "Connection timed out",
  "Connection closed",
];

/**
 * Gives the transport error for an SSH exit, or `undefined` when the exit is the result of the remote command.
 * SSH uses exit code 255 for its own failures. An exit code 255 with an unknown text is an unreachable host,
 * because the remote Rowbly command does not use that code.
 */
export function classifySshExit(exitCode: number | null, stderr: string, target: string): RowblyError | undefined {
  if (exitCode !== 255) {
    return undefined;
  }

  const details = { target, stderr: stderr.trim() };

  if (AUTH_FAILURES.some((text) => stderr.includes(text))) {
    return new HostAuthFailedError(`SSH authentication to ${target} failed.`, {
      details,
      hint: "Add your SSH key to the host, and make sure that the host key is in known_hosts.",
    });
  }

  const reason = UNREACHABLE_FAILURES.find((text) => stderr.includes(text)) ?? "SSH failed";

  return new HostUnreachableError(`Cannot reach ${target}: ${reason}.`, {
    details,
    hint: "Make sure that the host is on and that `ssh <target>` works.",
  });
}

/** A worker host has no free worker slot, because the machine limit of all Projects on the host is reached. */
export class HostNoFreeSlotError extends RowblyError {
  readonly code = "HOST_NO_FREE_SLOT";
}

/** The host agent cannot run a worker, because it has no worker runner. */
export class HostWorkerUnavailableError extends RowblyError {
  readonly code = "HOST_WORKER_UNAVAILABLE";
}
