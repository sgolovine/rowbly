import { RowblyError } from "../errors/errors.js";

/** The worker host has no `node` on the `PATH` of a non-interactive SSH session. */
export class HostNodeMissingError extends RowblyError {
  readonly code = "HOST_NODE_MISSING";
}

/** The `node` of the worker host is older than the version that Rowbly needs. */
export class HostNodeTooOldError extends RowblyError {
  readonly code = "HOST_NODE_TOO_OLD";
}

/** Rowbly could not install its exact version on the worker host. */
export class HostInstallFailedError extends RowblyError {
  readonly code = "HOST_INSTALL_FAILED";
}
