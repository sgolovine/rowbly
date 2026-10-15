import {
  ConflictError,
  DataIntegrityError,
  errorMessage,
  isRowblyError,
  NotFoundError,
  PluginError,
  type RowblyError,
  type RowblyErrorOptions,
  UsageError,
  ValidationError,
} from '../../core';
import { currentScope, type ExecutionScope, inScope, inScopeSync, newOperationId, type Stage } from './executionScope';

/** Which Plugin callback runs: its Plugin, its stage and, inside an operation, the operation. */
export interface Invocation {
  plugin: string;
  stage: Stage;
  /** The operation the callback belongs to, such as `stories.create`; none for a command or filter. */
  operation?: string;
  /** The ID of that operation's scope; a callback outside an operation gets a new one. */
  operationId?: string;
  /** Errors that pass through as they are, such as those of a replacement's `core()`. */
  coreErrors?: WeakSet<object>;
}

/** The expected errors that keep their class and code when a Plugin throws them (D7). */
const EXPECTED = [UsageError, ValidationError, NotFoundError, ConflictError, DataIntegrityError] as const;

/** Errors this adapter or the runner already attributed: they pass through every outer callback. */
const attributedErrors = new WeakSet<object>();

/**
 * Runs a host-controlled Plugin callback in its execution scope and applies the error policy of
 * ADR-0020 §5 to whatever it throws or rejects with. It catches only what `fn` throws or returns;
 * work `fn` leaves running (an unawaited promise, a timer) is outside it (D8).
 */
export async function invokePlugin<T>(at: Invocation, fn: (scope: ExecutionScope) => T | Promise<T>): Promise<T> {
  try {
    return await inScope(scopeOf(at), fn);
  } catch (err) {
    throw attribute(at, err);
  }
}

/** `invokePlugin` for a synchronous callback (stages `filter` and `option-input`). */
export function invokePluginSync<T>(at: Invocation, fn: (scope: ExecutionScope) => T): T {
  try {
    return inScopeSync(scopeOf(at), fn);
  } catch (err) {
    throw attribute(at, err);
  }
}

/**
 * The error a failed callback fails with:
 * - an error already attributed, a `PluginError` naming a Plugin, or a `core()` error: unchanged;
 * - an expected Rowbly error: the same class, code, message, hint and issues, with
 *   `details.plugin`, `details.operation` and `details.stage` (the framework's win);
 * - anything else: an INTERNAL `PluginError` with a hint to turn the Plugin off.
 */
export function attribute(at: Invocation, err: unknown): unknown {
  if (typeof err === 'object' && err !== null) {
    if (attributedErrors.has(err) || at.coreErrors?.has(err)) return err;
    if (err instanceof PluginError && typeof err.details.plugin === 'string') return err;
  }
  const where = { plugin: at.plugin, ...(at.operation ? { operation: at.operation } : {}), stage: at.stage };
  const Expected = EXPECTED.find((type) => err instanceof type);
  if (Expected) {
    const expected = err as RowblyError;
    return attributed(
      new Expected(expected.message, { details: { ...expected.details, ...where }, hint: expected.hint, cause: err }),
    );
  }
  const during = at.operation ? `the ${at.stage} of ${at.operation}` : `its ${at.stage}`;
  return attributed(
    new PluginError(`Plugin "${at.plugin}" failed in ${during}: ${errorMessage(err)}`, {
      details: { ...where, ...(isRowblyError(err) ? { cause: err.code } : {}) },
      hint: `turn it off with \`rowbly plugins disable ${at.plugin}\``,
      cause: err,
    }),
  );
}

/** Marks an error the framework built with its own attribution, so no outer callback re-attributes it. */
export function attributed<E extends RowblyError>(err: E): E {
  attributedErrors.add(err);
  return err;
}

/** A framework error about Plugin `plugin`'s callback, attributed. */
export function pluginError(at: Invocation, message: string, options: RowblyErrorOptions = {}): PluginError {
  const details = { plugin: at.plugin, ...(at.operation ? { operation: at.operation } : {}), stage: at.stage };
  return attributed(new PluginError(message, { ...options, details: { ...options.details, ...details } }));
}

function scopeOf(at: Invocation): Omit<ExecutionScope, 'ended'> {
  const outer = currentScope();
  return {
    operationId: at.operationId ?? outer?.operationId ?? newOperationId(),
    operation: at.operation ?? outer?.operation ?? at.stage,
    plugin: at.plugin,
    stage: at.stage,
  };
}
