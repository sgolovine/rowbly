import type { ZodType } from 'zod';
import {
  ConflictError,
  DataIntegrityError,
  errorMessage,
  isSlug,
  NotFoundError,
  PluginError,
  ValidationError,
} from '../../core';
import { formatIssues, type LocalState, type Story } from '../../schemas';
import type { Repositories } from '../../storage';
import { coordinated, outsideCoordination } from '../coordination';
import { effectiveMe } from '../identity';
import type { PluginInput, RowblyContext, Services } from '../types';
import { pluginReadServices, pluginServices } from './capabilities';
import {
  CoreChangeSet,
  frozenCopy,
  isRootConfigCopy,
  listPluginFiles,
  readPluginBinaryFile,
  readPluginFile,
} from './changeSet';
import { assertMayStart, currentScope, type ExecutionScope, inScope, newOperationId } from './executionScope';
import { createPluginGit, drainGitQueue } from './git';
import type { ActivePlugin } from './host';
import { parseSettings } from './host';
import { attributed, type Invocation, invokePlugin, pluginError } from './invoke';
import { countChanges, failure, type TraceEvent, trace, traceClock, tracing } from './trace';
import {
  type Bagged,
  type BagInspection,
  type ChangeSet,
  CORE_OPERATION_NAMES,
  type CoreOperationName,
  type CoreOperations,
  type DeepReadonly,
  type GuardResult,
  type LocalStateChange,
  type OperationHooks,
  type OperationInput,
  type PluginChangeSet,
  type PluginContext,
  type PluginHookContext,
  type PluginInputSchemas,
  type PluginOperationOptions,
  type PluginReadContext,
  type Replacement,
  type ReplacementMap,
} from './types';

/** Runs Service Layer operations through the Plugin pipeline (ADR-0012). */
export interface OperationRunner {
  /**
   * Runs `body`, which fills a Change Set, or the replacement a Plugin declared for `name`; then
   * every transform, then every guard; saves the Change Set once; then runs the reactions.
   * `latest` gives the final result as the transforms left it, e.g. the created Story with its
   * bags; callers and reactions get that value. It may throw `resultRemoved` (W11). A core
   * operation's input and result are checked against `CoreOperations`.
   */
  run<K extends CoreOperationName>(
    name: K,
    input: CoreOperations[K]['input'],
    body: (changes: CoreChangeSet) => Promise<BodyResult<CoreOperations[K]['result']>>,
    latest?: Finalizer<CoreOperations[K]['result']>,
  ): Promise<CoreOperations[K]['result']>;
  /** A Plugin's own operation, named `<plugin id>.<name>`. */
  run<N extends string, I extends object, R>(
    name: N extends CoreOperationName ? never : N,
    input: I & OperationInput,
    body: (changes: CoreChangeSet) => Promise<R>,
    latest?: Finalizer<R>,
  ): Promise<R>;
  /** The context of a Plugin that is on, for its commands, screens, fields, filters, rows and Actions. */
  context(id: string): PluginContext;
  /** The context of a Plugin that is on, for its hooks and doctor checks: read services only. */
  hookContext(id: string): PluginHookContext;
}

/** A body whose result is `undefined` may also just return. */
// biome-ignore lint/suspicious/noConfusingVoidType: an async body that only returns has the result type `void`.
type BodyResult<R> = undefined extends R ? R | void : R;

/** Reads an operation's final result from its sealed Change Set: a pure read, never a write. */
export type Finalizer<R> = (changes: CoreChangeSet, result: R) => R | Promise<R>;

/** Thrown by a finalizer when a transform removed the entity the operation returns (W11). */
class ResultRemoved extends Error {
  constructor(readonly entity: string) {
    super(`${entity} was removed`);
  }
}

/** For finalizers: the operation's returned `entity` (e.g. `Story WEB-1`) is gone from the Change Set. */
export function resultRemoved(entity: string): never {
  throw new ResultRemoved(entity);
}

/** The default reaction deadline (W7). */
const REACTION_TIMEOUT_MS = 5_000;

// Hooks are erased to these types: the registry holds Plugins of every settings type.
type AnyHooks = OperationHooks<OperationInput, unknown, unknown>;

/**
 * Runs a whole operation, from before its body's first read through the save, and not its
 * reactions. Services hold the Data Root lock here (ADR-0019 §1, `withMutation`); the default does
 * nothing.
 */
export interface OperationCoordinator {
  hold<T>(operation: { id: string; name: string }, fn: () => Promise<T>): Promise<T>;
}

const uncoordinated: OperationCoordinator = { hold: (_operation, fn) => fn() };

const CORE_NAMES: ReadonlySet<string> = new Set(CORE_OPERATION_NAMES);

export function createOperationRunner(
  ctx: RowblyContext,
  repos: Repositories,
  services: () => Services,
  coordinator: OperationCoordinator = uncoordinated,
): OperationRunner {
  const contexts = new Map<string, PluginContext>();
  const hookContexts = new WeakMap<ActivePlugin, PluginHookContext>();
  const active = () => ctx.plugins?.active() ?? [];
  // Background reactions run one operation after another, in the order of the operations (W7).
  let background: Promise<void> = Promise.resolve();

  // Validate membership even for a cached context: a Plugin that failed since is not on.
  function activePlugin(id: string): ActivePlugin {
    const plugin = active().find((p) => p.definition.id === id);
    if (!plugin) throw new NotFoundError(`Plugin "${id}" is not on`, { hint: `run \`rowbly plugins enable ${id}\`` });
    return plugin;
  }

  function context(id: string): PluginContext {
    const plugin = activePlugin(id);
    let found = contexts.get(id);
    if (!found) {
      found = pluginContext(ctx, repos, plugin, services, runner);
      contexts.set(id, found);
    }
    return found;
  }

  function hookContext(id: string): PluginHookContext {
    return hookContextOf(activePlugin(id));
  }

  /** The hook context of a pinned Plugin, even if it has failed since the operation started. */
  function hookContextOf(plugin: ActivePlugin): PluginHookContext {
    let found = hookContexts.get(plugin);
    if (!found) {
      found = pluginHookContext(ctx, repos, plugin, services);
      hookContexts.set(plugin, found);
    }
    return found;
  }

  async function run<I extends object, R>(
    name: string,
    input: I & OperationInput,
    body: (changes: CoreChangeSet) => Promise<R>,
    latest?: Finalizer<R>,
  ): Promise<R> {
    // Before any read or write: a hook, body or doctor fix cannot start another operation (D4).
    assertMayStart(name);
    const operation = { id: newOperationId(), name };
    const owner = CORE_NAMES.has(name) ? null : (name.split('.')[0] ?? null);
    // The Plugins that are on now run this operation's hooks, whatever happens to the host meanwhile.
    const plugins = [...active()];
    const changes = new CoreChangeSet(ctx.root, repos);
    // Every hook sees the same frozen input, so no hook can change what another sees. Each Plugin's
    // input is already parsed by its schema, before anything is read or saved (DX-07).
    const hookInput: DeepReadonly<OperationInput> = frozenCopy<OperationInput>(parsePluginInputs(plugins, name, input));
    const hooksOf = (plugin: ActivePlugin) => plugin.definition.hooks?.[name] as AnyHooks | undefined;
    const at = (plugin: string, stage: Invocation['stage']): Invocation => ({
      plugin,
      stage,
      operation: name,
      operationId: operation.id,
    });
    const event = (plugin: ActivePlugin) => ({
      name,
      input: hookInput,
      pluginInput: hookInput.plugins?.[plugin.definition.id],
      plugin: hookContextOf(plugin),
    });

    // The operation as a whole, in the trace (OBS-01); nothing is measured when the trace is off.
    const started = tracing() ? traceClock() : undefined;
    const traceOperation = (outcome: Pick<TraceEvent, 'outcome' | 'code' | 'failedAt'>) => {
      if (started === undefined) return;
      const ms = traceClock() - started;
      trace({ operationId: operation.id, operation: name, plugin: null, stage: 'operation', ms, ...outcome });
    };

    const held = coordinator.hold(operation, async (): Promise<R> => {
      let result: R;
      const replacement = replacementFor<R>(plugins, name);
      if (replacement) {
        const { id } = replacement.plugin.definition;
        const where = at(id, 'replacement');
        // Errors from core itself keep their own code when a replacement calls it.
        const coreErrors = new WeakSet<object>();
        // `core()` runs the core body against the same plan, inside the replacement's scope, once (W6).
        let calls = 0;
        const twice = () =>
          pluginError(where, `Plugin "${id}" called core() twice in its replacement of ${name}`, {
            hint: "call core() at most once; its result is the core operation's result",
          });
        const core = (): Promise<R> => {
          calls += 1;
          if (calls > 1) return Promise.reject(twice());
          return body(changes).catch((err: unknown) => {
            if (typeof err === 'object' && err !== null) coreErrors.add(err);
            throw err;
          });
        };
        result = await invokePlugin({ ...where, coreErrors }, (scope) =>
          replacement.replace({ ...event(replacement.plugin), changes: changes.forPlugin(id, scope), core }),
        );
        // A second call fails the operation even if the replacement caught its error.
        if (calls > 1) throw twice();
      } else if (owner === null) {
        result = await inScope({ operationId: operation.id, operation: name, plugin: null, stage: 'body' }, () =>
          body(changes),
        );
      } else {
        result = await invokePlugin(at(owner, 'body'), () => body(changes));
      }

      // Transforms and guards see the body's or replacement's result, before any transform (ARCH-03).
      const bodyResult = frozenCopy(result);
      // A core result that is not in the Change Set before the transforms (a replacement that did not
      // call `core()`) is returned as the replacement gave it.
      const finalizable = latest !== undefined && (owner !== null || (await present(latest, changes, result)));
      for (const plugin of plugins) {
        const transform = hooksOf(plugin)?.transform;
        if (!transform) continue;
        const { id } = plugin.definition;
        await invokePlugin(at(id, 'transform'), (scope) =>
          transform({ ...event(plugin), changes: changes.forPlugin(id, scope), result: bodyResult }),
        );
        // A core result a transform removed fails the operation now, naming that transform (W11).
        if (latest && finalizable && owner === null) await finalize(latest, changes, result, name, id);
      }
      // Guards and the save see the plan as the transforms left it.
      changes.seal();
      for (const plugin of plugins) {
        const guard = hooksOf(plugin)?.guard;
        if (!guard) continue;
        const { id } = plugin.definition;
        const verdict: GuardResult = await invokePlugin(at(id, 'guard'), () =>
          guard({ ...event(plugin), changes: changes.pluginView(id), result: bodyResult }),
        );
        if (verdict?.reject) {
          throw attributed(
            new ConflictError(verdict.reject, {
              details: { plugin: id, operation: name, stage: 'guard', ...(verdict.canForce ? { canForce: true } : {}) },
              hint: verdict.hint ?? `Plugin "${id}" refused ${name}`,
            }),
          );
        }
      }

      if (latest && finalizable) result = await finalize(latest, changes, result, name, owner);
      const saving = tracing() ? traceClock() : undefined;
      try {
        await inScope({ operationId: operation.id, operation: name, plugin: null, stage: 'commit' }, () =>
          changes.save(),
        );
      } catch (err) {
        if (saving !== undefined) traceCommit(operation.id, name, saving, changes, failure(err));
        throw err;
      }
      if (saving !== undefined) traceCommit(operation.id, name, saving, changes, { outcome: 'ok' });
      return result;
    });
    let result: R;
    try {
      result = await held;
    } catch (err) {
      traceOperation(failure(err));
      throw err;
    }
    traceOperation({ outcome: 'ok' });
    syncContext(changes);

    const reactors = plugins.filter((plugin) => hooksOf(plugin)?.react || plugin.definition.react);
    if (reactors.length === 0) return result;
    // One frozen snapshot of the saved plan and result, shared by every reaction.
    const saved = changes.frozenView();
    const finalResult = frozenCopy(result);
    const reactions = () =>
      outsideCoordination(async () => {
        for (const plugin of reactors) {
          const react = hooksOf(plugin)?.react;
          if (plugin.definition.react) {
            await reaction(plugin, at(plugin.definition.id, 'reaction'), () =>
              plugin.definition.react?.({ ...event(plugin), changes: saved, result: finalResult }),
            );
          }
          if (react) {
            await reaction(plugin, at(plugin.definition.id, 'reaction'), () =>
              react({ ...event(plugin), changes: saved, result: finalResult }),
            );
          }
        }
      });
    if (ctx.backgroundReactions) background = background.then(reactions);
    else {
      await reactions();
      await drainGitQueue(ctx.root);
    }
    return result;
  }

  /**
   * After a save, before reactions: the saved Local State becomes the context's (ADR-0019 §8). Me
   * follows it only when the stored Me changed; a cleared local Me falls back to global Me
   * (ADR-0032). A rejected or failed operation never gets here.
   */
  function syncContext(changes: CoreChangeSet): void {
    const local = changes.changes.find((c): c is LocalStateChange => c.type === 'localState');
    if (!local) return;
    ctx.local = structuredClone(local.after);
    if (local.before.me !== local.after.me) ctx.me = effectiveMe(local.after, ctx.globalMe);
  }

  /**
   * Runs one reaction with its deadline (W7). A failure, a timeout or a late failure only warns;
   * the data is saved, so nothing is undone. The timer is cleared as soon as the reaction settles.
   */
  async function reaction(
    plugin: ActivePlugin,
    at: Invocation,
    fn: (scope: ExecutionScope) => void | Promise<void>,
  ): Promise<void> {
    const { id } = plugin.definition;
    const ms = ctx.reactionTimeoutMs ?? REACTION_TIMEOUT_MS;
    let scope: ExecutionScope | undefined;
    let timedOut = false;
    const failed = (err: unknown) => ctx.warn(`Plugin "${id}" failed to react to ${at.operation}: ${messageOf(err)}`);
    const running = invokePlugin(at, (entered) => {
      scope = entered;
      return fn(entered);
    }).then(
      () => undefined,
      (err: unknown) => failed(errorCause(err)),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, ms);
    });
    await Promise.race([running, deadline]);
    clearTimeout(timer);
    if (timedOut) {
      // Handles bound to the reaction stop working; its detached work keeps running (D8).
      if (scope) scope.ended = true;
      if (tracing()) {
        trace({
          operationId: at.operationId ?? '',
          operation: at.operation ?? '',
          plugin: id,
          stage: 'reaction',
          ms,
          outcome: 'timeout',
        });
      }
      ctx.warn(`Plugin "${id}" did not finish reacting to ${at.operation} within ${duration(ms)}`);
    }
  }

  const runner: OperationRunner = { context, hookContext, run: run as OperationRunner['run'] };
  return runner;
}

/** Records a commit in the trace: its outcome and how many changes of each type it saved. */
function traceCommit(
  operationId: string,
  operation: string,
  started: number,
  changes: CoreChangeSet,
  outcome: Pick<TraceEvent, 'outcome' | 'code'>,
): void {
  const ms = traceClock() - started;
  const counts = countChanges(changes.changes);
  trace({ operationId, operation, plugin: null, stage: 'commit', ms, ...outcome, changes: counts });
}

/** The replacement a pinned Plugin declares for `name`, with that Plugin (CQ-33). */
function replacementFor<R>(
  plugins: readonly ActivePlugin[],
  name: string,
): { plugin: ActivePlugin; replace: Replacement<OperationInput, R, unknown> } | undefined {
  if (!CORE_NAMES.has(name)) return undefined;
  for (const plugin of plugins) {
    const replaces: ReplacementMap<unknown> | undefined = plugin.definition.replaces;
    const replace = replaces?.[name as CoreOperationName];
    // The one widening cast: the registry erases each Plugin's input, result and settings types.
    if (replace) return { plugin, replace: replace as unknown as Replacement<OperationInput, R, unknown> };
  }
  return undefined;
}

/** Runs a finalizer; a removed result fails the operation before the save, naming `plugin` (W11). */
async function finalize<R>(
  latest: Finalizer<R>,
  changes: CoreChangeSet,
  result: R,
  operation: string,
  plugin: string | null,
): Promise<R> {
  try {
    return await latest(changes, result);
  } catch (err) {
    if (!(err instanceof ResultRemoved)) throw err;
    const who = plugin === null ? 'A Plugin' : `Plugin "${plugin}"`;
    throw attributed(
      new ConflictError(`${who} removed ${err.entity} that ${operation} returns`, {
        details: { plugin, operation, stage: 'transform' },
        hint: 'a transform may change the record an operation returns, but not delete it',
      }),
    );
  }
}

/** Whether `latest` finds the operation's result in the Change Set. */
async function present<R>(latest: Finalizer<R>, changes: CoreChangeSet, result: R): Promise<boolean> {
  try {
    await latest(changes, result);
    return true;
  } catch (err) {
    if (err instanceof ResultRemoved) return false;
    throw err;
  }
}

/** A reaction's own message: what it threw, not the attribution the adapter wrapped around it. */
function errorCause(err: unknown): unknown {
  return err instanceof PluginError && err.cause !== undefined ? err.cause : err;
}

function duration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

const messageOf = errorMessage;

/** The scope of the running operation body, which its writer lives as long as. */
function bodyScope(): ExecutionScope {
  const scope = currentScope();
  if (!scope) throw new PluginError('an operation body ran outside its scope');
  return scope;
}

/** The members every stage's context shares (`PluginReadContext`). */
function readContext(ctx: RowblyContext, repos: Repositories, plugin: ActivePlugin): PluginReadContext {
  const { definition } = plugin;
  const { id } = definition;
  function inspectBag<T>(record: Bagged, schema: ZodType<T>): BagInspection<T> {
    const raw = record.plugins?.[id];
    if (raw === undefined) return { kind: 'absent' };
    const result = schema.safeParse(raw);
    return result.success
      ? { kind: 'valid', value: result.data }
      : { kind: 'invalid', raw, issues: result.error.issues };
  }
  return {
    id,
    settings: plugin.settings,
    async boardSettings(boardId) {
      const { enabled: _enabled, ...bag } = (await repos.boards.get(boardId)).plugins?.[id] ?? {};
      if (Object.keys(bag).length === 0) return plugin.settings;
      try {
        return parseSettings(definition, deepMerge(plugin.entry, bag));
      } catch (err) {
        throw new ValidationError(`Board "${boardId}" has ${messageOf(err)} for Plugin "${id}"`, {
          details: { plugin: id, path: `boards/${boardId}/board.config.json` },
          hint: 'run `rowbly doctor`',
        });
      }
    },
    inspectBag,
    readBag(record, schema) {
      const bag = inspectBag(record, schema);
      return bag.kind === 'valid' ? bag.value : undefined;
    },
    requireBag(record, schema) {
      const bag = inspectBag(record, schema);
      if (bag.kind === 'valid') return bag.value;
      if (bag.kind === 'absent') return undefined;
      throw new DataIntegrityError(`Plugin "${id}" data on ${recordName(record)} is not valid`, {
        details: { plugin: id, path: `plugins.${id}`, record: recordName(record), issues: bag.issues },
        hint: 'run `rowbly doctor`; fix or reset the value before changing it',
      });
    },
    writeBag(record, bag) {
      // Root settings are entries with `enabled`, not bags (ADR-0010).
      if (isRootConfigCopy(record)) {
        throw new PluginError(`Plugin "${id}" cannot use writeBag on rowbly.config.json`, {
          details: { plugin: id },
          hint: 'change settings with changes.updateRootConfig and keep "enabled"',
        });
      }
      const { plugins: current, ...rest } = record;
      const { [id]: _old, ...others } = current ?? {};
      const plugins = bag === undefined ? others : { ...others, [id]: bag };
      return Object.keys(plugins).length > 0 ? { ...rest, plugins } : rest;
    },
    git: createPluginGit(ctx.root, id, ctx.warn, ctx.plugins?.registry, ctx.plugins?.gitOwner?.(id)),
    localData: async () => (await repos.localState.get()).plugins?.[id],
    files: {
      // Each read is one participating read, under the Data Root lock (ADR-0019 §5).
      read: (scope, name) =>
        coordinated(ctx.root, `${id}.files.read`, () => readPluginFile(ctx.root, repos, id, scope, name)),
      readBinary: (scope, name) =>
        coordinated(ctx.root, `${id}.files.readBinary`, () => readPluginBinaryFile(ctx.root, repos, id, scope, name)),
      list: (scope) => coordinated(ctx.root, `${id}.files.list`, () => listPluginFiles(ctx.root, repos, id, scope)),
    },
    get me() {
      return ctx.me;
    },
    now: () => ctx.now(),
    newId: () => ctx.newId(),
  };
}

/**
 * `input` with each Plugin's input of operation `name` parsed by that Plugin's `inputs` schema (DX-07).
 * Only input that was given is parsed. A failure is a `ValidationError` naming the Plugin, with the
 * issues relative to its input, so the TUI can show them on the Plugin's fields.
 */
function parsePluginInputs(plugins: readonly ActivePlugin[], name: string, input: OperationInput): OperationInput {
  const given = input.plugins;
  if (!given) return input;
  let parsed: PluginInput | undefined;
  for (const plugin of plugins) {
    const { id } = plugin.definition;
    const inputs: PluginInputSchemas | undefined = plugin.definition.inputs;
    const schema = inputs?.[name as CoreOperationName];
    const value = given[id];
    if (!schema || value === undefined) continue;
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        `Plugin "${id}" input of ${name} is not valid: ${formatIssues(result.error.issues, 'input')}`,
        { details: { plugin: id, operation: name, issues: result.error.issues } },
      );
    }
    parsed = { ...(parsed ?? given), [id]: result.data };
  }
  return parsed ? { ...input, plugins: parsed } : input;
}

/** The context of commands, screens and Actions: core services without `plugins`, `setup` or doctor fixes. */
function pluginContext(
  ctx: RowblyContext,
  repos: Repositories,
  plugin: ActivePlugin,
  services: () => Services,
  runner: OperationRunner,
): PluginContext {
  const { id } = plugin.definition;
  let projected: PluginContext['services'] | undefined;
  function operation<I extends object, R>(
    name: string,
    input: I & OperationInput,
    body: (changes: PluginChangeSet) => Promise<R>,
    { result }: PluginOperationOptions<R> = {},
  ): Promise<R> {
    // A local name is one segment, so `epics.epics.delete` cannot happen by accident (ARCH-02).
    if (!isSlug(name)) {
      return Promise.reject(
        new PluginError(`Plugin "${id}" named an operation "${name}"; use one lower-kebab-case word`, {
          details: { plugin: id, operation: name },
          hint: `name its operations like "create", so they run as "${id}.create"`,
        }),
      );
    }
    const full = `${id}.${name}`;
    // The finalizer is Plugin code too: it runs through the adapter, as the body does.
    const latest: Finalizer<R> | undefined = result
      ? (changes, bodyResult) =>
          invokePlugin({ plugin: id, operation: full, stage: 'body' }, () => result(changes.pluginView(id), bodyResult))
      : undefined;
    return runner.run(full, input, (changes) => body(changes.forPlugin(id, bodyScope())), latest);
  }
  return withGetters(readContext(ctx, repos, plugin), {
    get services() {
      projected ??= pluginServices(services());
      return projected;
    },
    operation,
    warn: (message: string) => ctx.warn(message),
  });
}

/** The context of hooks and doctor checks: read services only, no `operation` and no `editText`. */
function pluginHookContext(
  ctx: RowblyContext,
  repos: Repositories,
  plugin: ActivePlugin,
  services: () => Services,
): PluginHookContext {
  let projected: PluginHookContext['services'] | undefined;
  return withGetters(readContext(ctx, repos, plugin), {
    get services() {
      projected ??= pluginReadServices(services());
      return projected;
    },
    warn: (message: string) => ctx.warn(message),
  });
}

/** `base` with the members of `extra`, keeping getters (such as `me`) live rather than copying their values. */
function withGetters<A extends object, B extends object>(base: A, extra: B): A & B {
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(extra)) as A & B;
}

/** How an error names the record a bag is on. */
function recordName(record: Bagged): string {
  const r = record as Record<string, unknown>;
  if (typeof r.key === 'string' && typeof r.boardId === 'string') return `Story ${r.key}`;
  if (typeof r.id === 'string' && typeof r.keyPrefix === 'string') return `Board ${r.id}`;
  if ('version' in r) return 'Local State';
  return 'a record';
}

/** Objects merge key by key; lists and other values replace (ADR-0005). */
export function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The version of a Story that an operation saves: its Change Set's, after every transform. */
export function latestStory(changes: ChangeSet, story: Story): Story {
  // The body put the Story, so its change is there unless a transform deleted it: a Story created
  // and then deleted in one Change Set has neither key left.
  return changes.story(story.key)?.after ?? resultRemoved(`Story ${story.key}`);
}

/** The Local State an operation saves. */
export function latestLocalState(changes: ChangeSet, state: LocalState): LocalState {
  return changes.changes.find((c): c is LocalStateChange => c.type === 'localState')?.after ?? state;
}
