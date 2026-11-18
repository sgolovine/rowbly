export interface RowblyErrorOptions {
  details?: Record<string, unknown>;
  /** One-line suggestion shown with the error: under it in the CLI, after it in a TUI toast. */
  hint?: string;
  cause?: unknown;
}

/**
 * Base class for every expected failure a service throws. Front ends present it (the CLI prints it
 * and sets an exit code, the TUI shows a toast); anything else is a bug.
 */
export abstract class RowblyError extends Error {
  abstract readonly code: string;
  readonly details: Record<string, unknown>;
  readonly hint: string | undefined;

  constructor(message: string, options: RowblyErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.details = options.details ?? {};
    this.hint = options.hint;
  }
}

/**
 * Input broke a rule. Put per-field issues in `details.issues` as `{ path: [field, ...], message }`
 * (zod's issue shape): a TUI `Form` shows each one under the field its path starts with.
 */
export class ValidationError extends RowblyError {
  readonly code = "VALIDATION";
}

/** A record the input names does not exist. */
export class NotFoundError extends RowblyError {
  readonly code = "NOT_FOUND";
}

/** The input would clash with a record that already exists, or with records that depend on it. */
export class ConflictError extends RowblyError {
  readonly code = "CONFLICT";
}
