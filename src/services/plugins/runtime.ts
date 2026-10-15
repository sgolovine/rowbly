import type { ZodType } from 'zod';
import {
  ConflictError,
  DataIntegrityError,
  isRowblyError,
  isTaskId,
  NotFoundError,
  PluginError,
  parseTaskId,
  ValidationError,
} from '../../core';
import type { Story, Task } from '../../schemas';
import type { Repositories } from '../../storage';
import type { RowblyContext, Services } from '../types';
import { pluginReadServices, pluginServices } from './capabilities';
import { CoreChangeSet, frozenCopy, listPluginFiles, readPluginFile } from './changeSet';
import {
  assertMayStart,
  currentScope,
  type ExecutionScope,
  inScope,
  newOperationId,
  type Stage,
} from './executionScope';
import type { ActivePlugin } from './host';
import { parseSettings } from './host';
import {
  type Bagged,
  type BagInspection,
  type ChangeSet,
  CORE_OPERATION_NAMES,
  type CoreOperationName,
  type CoreOperations,
  type DeepReadonly,
  type GuardResult,
  type OperationHooks,
  type OperationInput,
  type PluginContext,
  type PluginHookContext,
  type PluginReadContext,
  type Replacement,
} from './types';

/** Runs Service Layer operations through the Plugin pipeline (ADR-0012). */
export interface OperationRunner {
  /**
   * Runs `body`, which fills a Change Set, or the replacement a Plugin declared for `name`; then
   * every transform, then every guard; saves the Change Set once; then runs the reactions.
   * `latest` gives the result as the transforms left it, e.g. the created Story with its bags.
   * A core operation's input and result are checked against `CoreOperations`.
   */
  run<K extends CoreOperationName>(
    name: K,
    input: CoreOperations[K]['input'],
    body: (changes: CoreChangeSet) => Promise<BodyResult<CoreOperations[K]['result']>>,
    latest?: (changes: ChangeSet, result: CoreOperations[K]['result']) => CoreOperations[K]['result'],
  ): Promise<CoreOperations[K]['result']>;
  /** A Plugin's own operation, named `<plugin id>.<name>`. */
  run<N extends string, I extends object, R>(
    name: N extends CoreOperationName ? never : N,
    input: I & OperationInput,
    body: (changes: CoreChangeSet) => Promise<R>,
  ): Promise<R>;
  /** The context of a Plugin that is on, for its commands, screens, fields, filters, rows and Actions. */
  context(id: string): PluginContext;
  /** The context of a Plugin that is on, for its hooks and doctor checks: read services only. */
  hookContext(id: string): PluginHookContext;
}

/** A body whose result is `undefined` may also just return. */
// biome-ignore lint/suspicious/noConfusingVoidType: an async body that only returns has the result type `void`.
type BodyResult<R> = undefined extends R ? R | void : R;

type AnyHooks = OperationHooks<OperationInput, unknown, unknown>;

/**
 * Wraps a whole operation, from before its body's first read through the save, and not its
 * reactions. The default does nothing; the Data Root lock plugs in here (ADR-0019, WP02C).
 */
export interface OperationCoordinator {
  enter(operation: { id: string; name: string }): void | Promise<void>;
  exit(operation: { id: string; name: string }): void | Promise<void>;
}

const uncoordinated: OperationCoordinator = { enter() {}, exit() {} };

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
    latest?: (changes: ChangeSet, result: R) => R,
  ): Promise<R> {
    // Before any read or write: a hook, body or doctor fix cannot start another operation (D4).
    assertMayStart(name);
    const operation = { id: newOperationId(), name };
    const owner = CORE_NAMES.has(name) ? null : (name.split('.')[0] ?? null);
    // The Plugins that are on now run this operation's hooks, whatever happens to the host meanwhile.
    const plugins = [...active()];
    const changes = new CoreChangeSet(ctx.root, repos);
    // Every hook sees the same frozen input, so no hook can change what another sees.
    const hookInput: DeepReadonly<OperationInput> = frozenCopy<OperationInput>(input);
    const hooksOf = (plugin: ActivePlugin) => plugin.definition.hooks?.[name] as AnyHooks | undefined;
    const stage = <T>(plugin: string | null, stage: Stage, fn: (scope: ExecutionScope) => T | Promise<T>) =>
      inScope({ operationId: operation.id, operation: name, plugin, stage }, fn);
    const event = (plugin: ActivePlugin) => ({
      name,
      input: hookInput,
      pluginInput: hookInput.plugins?.[plugin.definition.id],
      plugin: hookContextOf(plugin),
    });

    await coordinator.enter(operation);
    let result: R;
    try {
      const replacer = plugins.find((p) => p.definition.replaces?.[name as keyof typeof p.definition.replaces]);
      if (replacer) {
        const { id } = replacer.definition;
        const replace = replacer.definition.replaces?.[name as never] as unknown as Replacement<
          OperationInput,
          R,
          unknown
        >;
        // Errors from core itself keep their own code when a replacement calls it.
        const fromCore = new WeakSet<object>();
        // `core()` runs the core body against the same plan, inside the replacement's scope.
        const core = (): Promise<R> =>
          body(changes).catch((err: unknown) => {
            if (typeof err === 'object' && err !== null) fromCore.add(err);
            throw err;
          });
        result = await stage(id, 'replacement', (scope) =>
          inPlugin(
            replacer,
            name,
            'replacement',
            () => replace({ ...event(replacer), changes: changes.forPlugin(id, scope), core }),
            fromCore,
          ),
        );
      } else {
        result = await stage(owner, 'body', () => body(changes));
      }

      // Transforms and guards see the body's or replacement's result, before any transform (ARCH-03).
      const bodyResult = frozenCopy(result);
      for (const plugin of plugins) {
        const transform = hooksOf(plugin)?.transform;
        if (!transform) continue;
        const { id } = plugin.definition;
        await stage(id, 'transform', (scope) =>
          inPlugin(plugin, name, 'transform', () =>
            transform({ ...event(plugin), changes: changes.forPlugin(id, scope), result: bodyResult }),
          ),
        );
      }
      // Guards and the save see the plan as the transforms left it.
      changes.seal();
      for (const plugin of plugins) {
        const guard = hooksOf(plugin)?.guard;
        if (!guard) continue;
        const { id } = plugin.definition;
        const verdict: GuardResult = await stage(id, 'guard', () =>
          inPlugin(plugin, name, 'guard', () =>
            guard({ ...event(plugin), changes: changes.pluginView(id), result: bodyResult }),
          ),
        );
        if (verdict?.reject) {
          throw new ConflictError(verdict.reject, {
            details: { plugin: id },
            hint: verdict.hint ?? `Plugin "${id}" refused ${name}`,
          });
        }
      }

      if (latest) result = latest(changes, result);
      await stage(null, 'commit', () => changes.save());
    } finally {
      await coordinator.exit(operation);
    }

    const reactors = plugins.filter((plugin) => hooksOf(plugin)?.react);
    if (reactors.length === 0) return result;
    // One frozen snapshot of the saved plan and result, shared by every reaction.
    const saved = changes.frozenView();
    const finalResult = frozenCopy(result);
    const reactions = async () => {
      for (const plugin of reactors) {
        const react = hooksOf(plugin)?.react;
        if (!react) continue;
        const { id } = plugin.definition;
        try {
          await stage(id, 'reaction', () => react({ ...event(plugin), changes: saved, result: finalResult }));
        } catch (err) {
          ctx.warn(`Plugin "${id}" failed to react to ${name}: ${messageOf(err)}`);
        }
      }
    };
    if (ctx.backgroundReactions) void reactions();
    else await reactions();
    return result;
  }

  const runner: OperationRunner = { context, hookContext, run: run as OperationRunner['run'] };
  return runner;
}

/** Runs a Plugin's handler; anything it throws fails the operation as a `PluginError` (exit 1). */
async function inPlugin<T>(
  plugin: ActivePlugin,
  operation: string,
  stage: string,
  fn: () => T | Promise<T>,
  passThrough?: WeakSet<object>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (passThrough && typeof err === 'object' && err !== null && passThrough.has(err)) throw err;
    if (err instanceof PluginError) throw err;
    const { id } = plugin.definition;
    throw new PluginError(`Plugin "${id}" failed in the ${stage} of ${operation}: ${messageOf(err)}`, {
      details: { plugin: id, operation, stage, ...(isRowblyError(err) ? { cause: err.code } : {}) },
      hint: `turn it off with \`rowbly plugins disable ${id}\``,
      cause: err,
    });
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
      if (isRootConfig(record)) {
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
    files: {
      read: (scope, name) => readPluginFile(ctx.root, repos, id, scope, name),
      list: (scope) => listPluginFiles(ctx.root, repos, id, scope),
    },
    get me() {
      return ctx.me;
    },
    now: () => ctx.now(),
    newId: () => ctx.newId(),
  };
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
  const operation: PluginContext['operation'] = (name, input, body) =>
    runner.run(`${id}.${name}`, input, (changes) => body(changes.forPlugin(id, bodyScope())));
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

/**
 * The root config (`rowbly.config.json`): its Plugin entries are settings with `enabled`, not bags.
 * It has `version` and `assignees`; a Story has both too, but also its `key`.
 */
function isRootConfig(record: object): boolean {
  return 'version' in record && 'assignees' in record && !('key' in record);
}

/** How an error names the record a bag is on. */
function recordName(record: Bagged): string {
  const r = record as Record<string, unknown>;
  if (typeof r.key === 'string' && typeof r.boardId === 'string') return `Story ${r.key}`;
  if (typeof r.id === 'string' && isTaskId(r.id)) return `Task ${r.id}`;
  if (typeof r.handle === 'string') return `Assignee ${r.handle}`;
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
  return changes.story(story.key)?.after ?? story;
}

/** The version of a Task that an operation saves. */
export function latestTask(changes: ChangeSet, task: Task): Task {
  const story = changes.story(parseTaskId(task.id).storyKey)?.after;
  return story?.tasks.find((t) => t.id === task.id) ?? task;
}
