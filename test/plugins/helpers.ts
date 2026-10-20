import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reservedNames } from '../../src/main';
import type { RowblyConfig } from '../../src/schemas';
import {
  type AnyPluginDefinition,
  createServices,
  loadPlugins,
  type PluginHost,
  type RowblyContext,
  type Services,
} from '../../src/services';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, type TempRoot, tempRoot } from '../helpers';
import { fixturePlugins } from './fixtures';

/** Plugin entries for `rowbly.config.json`: `true` turns a Plugin on, an object adds settings. */
export type Entries = Record<string, true | Record<string, unknown>>;

export function entries(on: Entries): NonNullable<RowblyConfig['plugins']> {
  return Object.fromEntries(
    Object.entries(on).map(([id, value]) => [id, value === true ? { enabled: true } : { enabled: true, ...value }]),
  );
}

/** A Data Root with Board `web` (`WEB`) and the given Plugins on. */
export async function pluginRoot(on: Entries = {}, config: Partial<RowblyConfig> = {}): Promise<TempRoot> {
  const t = await tempRoot();
  await makeRootConfig(t.path, { plugins: entries(on), ...config });
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB' });
  return t;
}

export interface PluginSetup {
  host: PluginHost;
  ctx: RowblyContext;
  services: Services;
  warnings: string[];
}

/** Loads the Plugins of `t` from `registry` and builds services over them, as the entry point does. */
export async function withPlugins(
  t: TempRoot,
  registry: readonly AnyPluginDefinition[] = fixturePlugins,
  ctxOverrides: Partial<RowblyContext> = {},
): Promise<PluginSetup> {
  const host = await loadPlugins({ root: t.root, registry, reserved: reservedNames() });
  const warnings: string[] = [];
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => warnings.push(message),
    plugins: host,
    ...ctxOverrides,
  };
  return { host, ctx, services: createServices(ctx), warnings };
}

/** A file in the Data Root, parsed as JSON. */
export async function readJsonFile(t: TempRoot, path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(t.path, path), 'utf8'));
}

export const storyFile = (key: string, board = 'web') => `boards/${board}/stories/${key}/story.json`;
