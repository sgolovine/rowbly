import { ConflictError, isRowblyError, NotFoundError, PluginError, parseTaskId, ValidationError } from '../../core';
import type { Story, Task } from '../../schemas';
import { editTextInEditor, type Repositories } from '../../storage';
import type { RowblyContext, Services } from '../types';
import { CoreChangeSet, listPluginFiles, readPluginFile } from './changeSet';
import type { ActivePlugin } from './host';
import { parseSettings } from './host';
import type {
  Bagged,
  ChangeSetView,
  GuardResult,
  OperationEvent,
  OperationHooks,
  OperationInput,
  PluginChangeSet,
  PluginContext,
  Replacement,
} from './types';

/** Runs Service Layer operations through the Plugin pipeline (ADR-0012). */
export interface OperationRunner {
  /**
   * Runs `body`, which fills a Change Set, or the replacement a Plugin declared for `name`; then
   * every transform, then every guard; saves the Change Set once; then runs the reactions.
   * `latest` gives the result as the transforms left it, e.g. the created Story with its bags.
   */
  run<I extends object, R>(
    name: string,
    input: I & OperationInput,
    body: (changes: CoreChangeSet) => Promise<R>,
    latest?: (changes: ChangeSetView, result: R) => R,
  ): Promise<R>;
  /** The context of a Plugin that is on. */
  context(id: string): PluginContext;
}

type AnyHooks = OperationHooks<OperationInput, unknown, unknown>;

export function createOperationRunner(
  ctx: RowblyContext,
  repos: Repositories,
  services: () => Services,
): OperationRunner {
  const contexts = new Map<string, PluginContext>();
  const active = () => ctx.plugins?.active() ?? [];

  function context(id: string): PluginContext {
    const plugin = active().find((p) => p.definition.id === id);
    if (!plugin) throw new NotFoundError(`Plugin "${id}" is not on`, { hint: `run \`rowbly plugins enable ${id}\`` });
    let found = contexts.get(id);
    if (!found) {
      found = pluginContext(ctx, repos, plugin, services, runner);
      contexts.set(id, found);
    }
    return found;
  }

  const runner: OperationRunner = {
    context,
    async run<I extends object, R>(
      name: string,
      input: I & OperationInput,
      body: (changes: CoreChangeSet) => Promise<R>,
      latest?: (changes: ChangeSetView, result: R) => R,
    ): Promise<R> {
      const changes = new CoreChangeSet(ctx.root, repos);
      const plugins = active();
      const event = (plugin: ActivePlugin): OperationEvent<typeof input, unknown> => ({
        name,
        input,
        pluginInput: input.plugins?.[plugin.definition.id],
        changes: changes.forPlugin(plugin.definition.id),
        plugin: context(plugin.definition.id),
      });
      const hooksOf = (plugin: ActivePlugin) => plugin.definition.hooks?.[name] as AnyHooks | undefined;

      const replacer = plugins.find((p) => p.definition.replaces?.[name as keyof typeof p.definition.replaces]);
      let result: R;
      if (replacer) {
        const replace = replacer.definition.replaces?.[name as never] as unknown as Replacement<
          typeof input,
          R,
          unknown
        >;
        // Errors from core itself keep their own code when a replacement calls it.
        const fromCore = new WeakSet<object>();
        const core = (): Promise<R> =>
          body(changes).catch((err: unknown) => {
            if (typeof err === 'object' && err !== null) fromCore.add(err);
            throw err;
          });
        result = await inPlugin(replacer, name, 'replacement', () => replace({ ...event(replacer), core }), fromCore);
      } else {
        result = await body(changes);
      }

      for (const plugin of plugins) {
        const transform = hooksOf(plugin)?.transform;
        if (transform) await inPlugin(plugin, name, 'transform', () => transform(event(plugin)));
      }
      for (const plugin of plugins) {
        const guard = hooksOf(plugin)?.guard;
        if (!guard) continue;
        const verdict: GuardResult | undefined = await inPlugin(plugin, name, 'guard', () => guard(event(plugin)));
        if (verdict?.reject) {
          throw new ConflictError(verdict.reject, {
            details: { plugin: plugin.definition.id },
            hint: verdict.hint ?? `Plugin "${plugin.definition.id}" refused ${name}`,
          });
        }
      }

      if (latest) result = latest(changes.view(), result);
      await changes.save();

      const reactions = async () => {
        for (const plugin of plugins) {
          const react = hooksOf(plugin)?.react;
          if (!react) continue;
          try {
            await react({ ...event(plugin), changes: changes.view(), result });
          } catch (err) {
            ctx.warn(`Plugin "${plugin.definition.id}" failed to react to ${name}: ${messageOf(err)}`);
          }
        }
      };
      if (ctx.backgroundReactions) void reactions();
      else await reactions();
      return result;
    },
  };
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

function pluginContext(
  ctx: RowblyContext,
  repos: Repositories,
  plugin: ActivePlugin,
  services: () => Services,
  runner: OperationRunner,
): PluginContext {
  const { definition } = plugin;
  const { id } = definition;
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
    readBag(record, schema) {
      const bag = record.plugins?.[id];
      if (bag === undefined) return undefined;
      const result = schema.safeParse(bag);
      return result.success ? result.data : undefined;
    },
    writeBag<R extends Bagged>(record: R, bag: object | undefined): R {
      const { [id]: _old, ...others } = record.plugins ?? {};
      const plugins = bag === undefined ? others : { ...others, [id]: bag as Record<string, unknown> };
      if (Object.keys(plugins).length > 0) return { ...record, plugins };
      const { plugins: _none, ...rest } = record;
      return rest as R;
    },
    files: {
      read: (scope, name) => readPluginFile(ctx.root, repos, id, scope, name),
      list: (scope) => listPluginFiles(ctx.root, repos, id, scope),
    },
    get services() {
      return services();
    },
    operation: (name, input, body) =>
      runner.run(`${id}.${name}`, input, (changes) => body(changes.forPlugin(id) as PluginChangeSet)),
    editText: (initial) => editTextInEditor(initial),
    warn: (message) => ctx.warn(message),
    get me() {
      return ctx.me;
    },
    now: () => ctx.now(),
  };
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
export function latestStory(changes: ChangeSetView, story: Story): Story {
  return changes.story(story.key)?.after ?? story;
}

/** The version of a Task that an operation saves. */
export function latestTask(changes: ChangeSetView, task: Task): Task {
  const story = changes.story(parseTaskId(task.id).storyKey)?.after;
  return story?.tasks.find((t) => t.id === task.id) ?? task;
}
