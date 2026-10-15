/** Process exit codes (contracts §6). */
export const ExitCode = {
  ok: 0,
  internal: 1,
  usage: 2,
  validation: 2,
  notFound: 3,
  conflict: 4,
  noDataRoot: 5,
  dataIntegrity: 6,
} as const;

export type ErrorCode =
  | 'INTERNAL'
  | 'USAGE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NO_DATA_ROOT'
  | 'DATA_INTEGRITY';

export interface RowblyErrorOptions {
  details?: Record<string, unknown>;
  /** One-line suggestion shown under the error in human mode. */
  hint?: string;
  cause?: unknown;
}

/** Base class for every expected failure. Anything else is treated as `INTERNAL`. */
export abstract class RowblyError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly exitCode: number;
  readonly details: Record<string, unknown>;
  readonly hint: string | undefined;

  constructor(message: string, options: RowblyErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.details = options.details ?? {};
    this.hint = options.hint;
  }
}

/** Bad flags, missing args, context not resolvable, non-interactive without `--yes`. */
export class UsageError extends RowblyError {
  readonly code = 'USAGE';
  readonly exitCode = ExitCode.usage;
}

/** Schema or referential rule violated on input; put zod issues in `details.issues`. */
export class ValidationError extends RowblyError {
  readonly code = 'VALIDATION';
  readonly exitCode = ExitCode.validation;
}

/** Unknown board, story, task, stage, field or assignee. */
export class NotFoundError extends RowblyError {
  readonly code = 'NOT_FOUND';
  readonly exitCode = ExitCode.notFound;
}

/** Id or prefix already exists, deletion refused, or key collision. */
export class ConflictError extends RowblyError {
  readonly code = 'CONFLICT';
  readonly exitCode = ExitCode.conflict;
}

/** No Data Root found. */
export class DataRootNotFoundError extends RowblyError {
  readonly code = 'NO_DATA_ROOT';
  readonly exitCode = ExitCode.noDataRoot;

  constructor(message = 'no Data Root found', options: RowblyErrorOptions = {}) {
    super(message, { hint: 'run `rowbly init` to create one', ...options });
  }
}

/** A file on disk fails its schema or its id does not match its path; set `details.path`. */
export class DataIntegrityError extends RowblyError {
  readonly code = 'DATA_INTEGRITY';
  readonly exitCode = ExitCode.dataIntegrity;
}

/**
 * A Plugin callback failed unexpectedly, or broke a framework rule (ADR-0020 §5). `details.plugin`
 * names the Plugin, and `details.stage` the callback.
 */
export class PluginError extends RowblyError {
  readonly code = 'INTERNAL';
  readonly exitCode = ExitCode.internal;
}

/** A readable message for any thrown value: an `Error`'s message, otherwise the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRowblyError(err: unknown): err is RowblyError {
  return err instanceof RowblyError;
}

/** The exit code for any thrown value: a `RowblyError`'s own code, otherwise `INTERNAL` (1). */
export function exitCodeFor(err: unknown): number {
  return isRowblyError(err) ? err.exitCode : ExitCode.internal;
}
