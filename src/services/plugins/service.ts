import { NotFoundError, ValidationError } from '../../core';
import type { PluginsService, RowblyContext } from '../types';
import { parseSettings } from './host';
import type { OperationRunner } from './runtime';

export function createPluginsService(ctx: RowblyContext, ops: OperationRunner): PluginsService {
  const statuses = () => ctx.plugins?.status() ?? [];

  function definition(id: string) {
    const found = ctx.plugins?.registry.find((d) => d.id === id);
    if (!found) throw notFound(id);
    return found;
  }

  return {
    list: async () => statuses(),

    async get(id) {
      const status = statuses().find((s) => s.id === id);
      if (!status) throw notFound(id);
      return status;
    },

    enable: (id, opts = {}) =>
      ops.run('plugins.enable', { id, ...opts }, async (changes) => {
        const plugin = definition(id);
        await changes.updateRootConfig((config) => {
          const { enabled: _enabled, ...settings } = config.plugins?.[id] ?? {};
          try {
            parseSettings(plugin, settings);
          } catch (err) {
            throw new ValidationError(`Plugin "${id}" has ${(err as Error).message}`, {
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
          if (!entry) definition(id);
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
