import { errorMessage, NotFoundError, PluginError, ValidationError } from '../../core';
import type { Story, Task } from '../../schemas';
import type { Repositories } from '../../storage';
import type { PluginsService, RowblyContext, Services } from '../types';
import { parseSettings } from './host';
import { invokePlugin } from './invoke';
import type { OperationRunner } from './runtime';
import type { AnyPluginDefinition, PluginContext, PluginRow } from './types';

export function createPluginsService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): PluginsService {
  const statuses = () => ctx.plugins?.status() ?? [];

  /** The definition of a Plugin this version has; throws `NotFoundError` otherwise. */
  function requireDefinition(id: string): AnyPluginDefinition {
    const found = ctx.plugins?.registry.find((d) => d.id === id);
    if (!found) throw notFound(id);
    return found;
  }

  return {
    list: async () => statuses(),

    async get(id) {
      const status = statuses().find((s) => s.id === id);
      if (!status) throw notFound(id);
      const { enabled: _enabled, ...settings } = (await repos.rootConfig.get()).plugins?.[id] ?? {};
      return { ...status, settings };
    },

    enable: (id, opts = {}) =>
      ops.run('plugins.enable', { id, ...opts }, async (changes) => {
        const plugin = requireDefinition(id);
        await changes.updateRootConfig((config) => {
          const { enabled: _enabled, ...settings } = config.plugins?.[id] ?? {};
          try {
            parseSettings(plugin, settings);
          } catch (err) {
            const message = errorMessage(err);
            throw new ValidationError(`Plugin "${id}" has ${message}`, {
              details: { plugin: id },
              hint: `fix "plugins.${id}" in rowbly.config.json`,
            });
          }
          return { ...config, plugins: { ...config.plugins, [id]: { ...config.plugins?.[id], enabled: true } } };
        });
        return { id, enabled: true };
      }),

    disable: (id, opts = {}) =>
      ops.run('plugins.disable', { id, ...opts }, async (changes) => {
        await changes.updateRootConfig((config) => {
          const entry = config.plugins?.[id];
          // A configured Plugin can be turned off even if this version does not have it; otherwise
          // the id must be one this version has.
          if (!entry) requireDefinition(id);
          // Turning a Plugin off keeps its settings and all its data (ADR-0010).
          return { ...config, plugins: { ...config.plugins, [id]: { ...entry, enabled: false } } };
        });
        return { id, enabled: false };
      }),

    context: (id) => ops.context(id),
  };
}

function notFound(id: string): NotFoundError {
  return new NotFoundError(`Plugin "${id}" not found`, { hint: 'see `rowbly plugins list`' });
}

/**
 * The rows each Plugin that is on adds about a Story (`stories show`, the TUI Story screen), in
 * registry order. Rows only show something, so a Plugin that fails to give them only warns.
 */
export function pluginStoryRows(ctx: RowblyContext, services: Services, story: Story): Promise<PluginRow[]> {
  return pluginRows(ctx, services, (definition, plugin) => definition.storyRows?.(story, plugin));
}

/** The rows each Plugin that is on adds about a Task (`tasks show`, the TUI Task screen). */
export function pluginTaskRows(ctx: RowblyContext, services: Services, task: Task, story: Story): Promise<PluginRow[]> {
  return pluginRows(ctx, services, (definition, plugin) => definition.taskRows?.(task, story, plugin));
}

async function pluginRows(
  ctx: RowblyContext,
  services: Services,
  rowsOf: (definition: AnyPluginDefinition, plugin: PluginContext) => Promise<PluginRow[]> | undefined,
): Promise<PluginRow[]> {
  const rows: PluginRow[] = [];
  for (const { definition } of ctx.plugins?.active() ?? []) {
    const { id } = definition;
    try {
      rows.push(
        ...((await invokePlugin({ plugin: id, stage: 'row' }, () =>
          rowsOf(definition, services.plugins.context(id)),
        )) ?? []),
      );
    } catch (err) {
      // Rows only show something, so a failure only warns; the warning keeps the Plugin's own message.
      const cause = err instanceof PluginError && err.cause !== undefined ? err.cause : err;
      ctx.warn(`Plugin "${id}" failed to show its rows: ${errorMessage(cause)}`);
    }
  }
  return rows;
}
