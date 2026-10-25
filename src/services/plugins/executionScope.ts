import { AsyncLocalStorage } from 'node:async_hooks';
import { PluginError } from '../../core';

/** Where host-controlled code runs (ADR-0020 §1). */
export type Stage =
  | 'body'
  | 'replacement'
  | 'transform'
  | 'guard'
  | 'commit'
  | 'reaction'
  | 'doctor-check'
  | 'doctor-fix'
  | 'command'
  | 'screen'
  | 'field'
  | 'status'
  | 'filter'
  | 'row'
  | 'option-input';

/** The operation and stage that the running code belongs to. A detached continuation keeps its scope. */
export interface ExecutionScope {
  /** One per `ops.run`, or per doctor check. */
  readonly operationId: string;
  /** Such as `stories.create` or `epics.create`. */
  readonly operation: string;
  /** The Plugin whose callback runs; `null` for core. */
  readonly plugin: string | null;
  readonly stage: Stage;
  /** Set when the stage returns: writer handles bound to this scope stop working. */
  ended: boolean;
}

/** Stages that may start an operation; every other stage is inside one, or inside a read. */
const MAY_START: ReadonlySet<Stage> = new Set(['command', 'screen', 'field']);

/** Stages that get a writer. */
const MAY_WRITE: ReadonlySet<Stage> = new Set(['body', 'replacement', 'transform', 'doctor-fix']);

const store = new AsyncLocalStorage<ExecutionScope>();
let operations = 0;

/** The scope of the running code, if any. */
export function currentScope(): ExecutionScope | undefined {
  return store.getStore();
}

/** A new operation ID; IDs are only compared, so a counter is enough. */
export function newOperationId(): string {
  operations += 1;
  return `op-${operations}`;
}

/**
 * Runs `fn` in a new scope and ends the scope when `fn` settles, so handles bound to it stop
 * working. Code that `fn` leaves running keeps the scope, ended.
 */
export async function inScope<T>(
  scope: Omit<ExecutionScope, 'ended'>,
  fn: (scope: ExecutionScope) => T | Promise<T>,
): Promise<T> {
  const entered: ExecutionScope = { ...scope, ended: false };
  try {
    return await store.run(entered, () => fn(entered));
  } finally {
    entered.ended = true;
  }
}

/** `inScope` for a synchronous callback, such as a filter or option input. */
export function inScopeSync<T>(scope: Omit<ExecutionScope, 'ended'>, fn: (scope: ExecutionScope) => T): T {
  const entered: ExecutionScope = { ...scope, ended: false };
  try {
    return store.run(entered, () => fn(entered));
  } finally {
    entered.ended = true;
  }
}

/**
 * Runs `fn` as Plugin `plugin`'s `stage` of the running operation, such as a doctor fix inside
 * `doctor.fix`; outside an operation, as `operation` (such as `doctor.check`).
 */
export function inStage<T>(
  plugin: string,
  stage: Stage,
  fn: (scope: ExecutionScope) => T | Promise<T>,
  operation: string = stage,
): Promise<T> {
  const outer = currentScope();
  return inScope(
    {
      operationId: outer?.operationId ?? newOperationId(),
      operation: outer?.operation ?? operation,
      plugin,
      stage,
    },
    fn,
  );
}

/**
 * Rejects starting operation `nested` from a stage that cannot start one (D4), before anything is
 * read or written. Unrelated work runs in its own scope, or none, and is not affected.
 */
export function assertMayStart(nested: string): void {
  const scope = currentScope();
  if (!scope || MAY_START.has(scope.stage)) return;
  throw nestedError(scope, `start ${nested}`, { nested });
}

/**
 * Rejects a writer used outside its stage: after the stage ended, or from code running in a stage
 * that has no writer (ARCH-39).
 */
export function assertMayWrite(plugin: string, lease: ExecutionScope): void {
  if (lease.ended) {
    throw new PluginError(
      `Plugin "${plugin}" used its Change Set after its ${lease.stage} of ${lease.operation} ended`,
      {
        details: { plugin, operation: lease.operation, stage: lease.stage },
        hint: 'change data only while your hook runs; await every write before returning',
      },
    );
  }
  const scope = currentScope();
  if (scope && !MAY_WRITE.has(scope.stage)) throw nestedError(scope, 'change the Change Set', {});
}

function nestedError(scope: ExecutionScope, what: string, extra: Record<string, unknown>): PluginError {
  const who = scope.plugin === null ? `Operation ${scope.operation}` : `Plugin "${scope.plugin}"`;
  const during = scope.operation === scope.stage ? `its ${scope.stage}` : `the ${scope.stage} of ${scope.operation}`;
  return new PluginError(`${who} tried to ${what} during ${during}`, {
    details: { plugin: scope.plugin, operation: scope.operation, stage: scope.stage, ...extra },
    hint:
      scope.stage === 'reaction'
        ? 'a reaction acts only outside Rowbly data; change data in a transform instead'
        : `change data through the Change Set your ${scope.stage} receives, not through services or operations`,
  });
}
