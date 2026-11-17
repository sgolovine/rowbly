import { RowblyError } from "../errors/errors.js";

/** The worker host cannot read the repository: it has no key, no credential or no access. */
export class HostGitAccessError extends RowblyError {
  readonly code = "HOST_GIT_ACCESS";
}

/** `git clone` failed on the worker host for a reason other than the Git access. */
export class HostCloneFailedError extends RowblyError {
  readonly code = "HOST_CLONE_FAILED";
}
