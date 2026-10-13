import { isSlug } from '../../core';
import type { DataRoot, PluginEntry, RowblyConfig } from '../../schemas';
import { createRepositories } from '../../storage';
import type { AnyPluginDefinition, PluginOptionCommand } from './types';

/** Names that core already uses, so a Plugin that takes one fails to load (ADR-0012). */
export interface ReservedNames {
  /** Top-level commands. */
  commands: readonly string[];
  /** The option names (without `--` and `no-`) of each core command that takes Plugin options. */
  options: Readonly<Partial<Record<PluginOptionCommand, readonly string[]>>>;
  /** Keys that a core TUI screen uses, so an Action cannot. */
  keys: readonly string[];
}

export type PluginState = 'on' | 'off' | 'failed';

export interface PluginStatus {
  id: string;
  name: string;
  description: string;
  /** `on`: loaded this run; `off`; `failed`: on in `rowbly.config.json` but skipped. */
  state: PluginState;
  /** Whether this Rowbly version has the Plugin. */
  known: boolean;
  /** Why it failed to load. */
  reason?: string;
}

/** A Plugin that loaded, with its parsed settings and the raw entry they came from. */
export interface ActivePlugin {
  definition: AnyPluginDefinition;
  settings: unknown;
  entry: Record<string, unknown>;
}

/** The Plugins of one Data Root for this run. */
export interface PluginHost {
  readonly registry: readonly AnyPluginDefinition[];
  /** Built-in Plugins in registry order, then the other Plugins `rowbly.config.json` names. */
  status(): PluginStatus[];
  /** The Plugins that are on and loaded, in registry order: the order they run in. */
  active(): readonly ActivePlugin[];
  failures(): PluginStatus[];
  /** Skips a Plugin for the rest of the run, e.g. when its TUI part throws while it loads. */
  markFailed(id: string, reason: string): void;
}

export interface LoadPluginsOptions {
  /** `null` without a Data Root: nothing is on. */
  root: DataRoot | null;
  registry: readonly AnyPluginDefinition[];
  reserved: ReservedNames;
}

/**
 * Turns on the Plugins that `rowbly.config.json` enables, in registry order (ADR-0010). A Plugin
 * whose settings are invalid, whose `start` throws, that clashes with a name in use, or that this
 * version does not have, fails to load; the rest run without it.
 */
export async function loadPlugins({ root, registry, reserved }: LoadPluginsOptions): Promise<PluginHost> {
  const entries = (root ? await readEntries(root) : null) ?? {};
  const statuses: PluginStatus[] = [];
  const active: ActivePlugin[] = [];
  const claims = newClaims(reserved);

  for (const definition of registry) {
    const status: PluginStatus = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      state: 'off',
      known: true,
    };
    statuses.push(status);
    const entry = entries[definition.id];
    if (entry?.enabled !== true) continue;
    try {
      const { enabled: _enabled, ...raw } = entry;
      const settings = parseSettings(definition, raw);
      const claim = claimNames(definition, claims);
      await definition.start?.({ settings });
      claim();
      status.state = 'on';
      active.push({ definition, settings, entry: raw });
    } catch (err) {
      status.state = 'failed';
      status.reason = err instanceof Error ? err.message : String(err);
    }
  }

  for (const [id, entry] of Object.entries(entries)) {
    if (registry.some((d) => d.id === id)) continue;
    const enabled = entry.enabled === true;
    statuses.push({
      id,
      name: id,
      description: '',
      state: enabled ? 'failed' : 'off',
      known: false,
      ...(enabled ? { reason: 'this version of Rowbly does not have it' } : {}),
    });
  }

  return {
    registry,
    status: () => statuses.map((s) => ({ ...s })),
    active: () => active,
    failures: () => statuses.filter((s) => s.state === 'failed'),
    markFailed(id, reason) {
      const status = statuses.find((s) => s.id === id);
      if (status?.state !== 'on') return;
      status.state = 'failed';
      status.reason = reason;
      active.splice(
        active.findIndex((p) => p.definition.id === id),
        1,
      );
    },
  };
}

/** The warning shown once per run for a Plugin that failed to load. */
export function failureWarning(status: PluginStatus): string {
  return (
    `Plugin "${status.id}" failed to load (${status.reason ?? 'unknown reason'}); Rowbly runs without it` +
    ` and keeps its data. Turn it off with \`rowbly plugins disable ${status.id}\``
  );
}

/** Checks a Plugin's settings: its Data Root entry without `enabled`, through its `settings` schema. */
export function parseSettings(definition: AnyPluginDefinition, raw: Record<string, unknown>): unknown {
  if (!definition.settings) return raw;
  const result = definition.settings.safeParse(raw);
  if (result.success) return result.data;
  const summary = result.error.issues.map((i) => `${i.path.join('.') || 'settings'}: ${i.message}`).join('; ');
  throw new Error(`invalid settings: ${summary}`);
}

/** A failure to read the config shows up in every command anyway; Plugins just stay off. */
async function readEntries(root: DataRoot): Promise<Record<string, PluginEntry> | null> {
  let config: RowblyConfig;
  try {
    config = await createRepositories(root).rootConfig.get();
  } catch {
    return null;
  }
  return config.plugins ?? null;
}

interface Claims {
  commands: Set<string>;
  options: Map<string, Set<string>>;
  keys: Set<string>;
  replaced: Set<string>;
}

function newClaims(reserved: ReservedNames): Claims {
  return {
    commands: new Set(reserved.commands),
    options: new Map(Object.entries(reserved.options).map(([command, names]) => [command, new Set(names)])),
    keys: new Set(reserved.keys),
    replaced: new Set(),
  };
}

const FLAG_RE = /^--([a-z][a-z0-9-]*)(?: <[^>]+>| \[[^\]]+\])?$/;

/**
 * Throws when the Plugin wants a name that core or an earlier Plugin uses: its id as a command, an
 * option on a core command, an Action key, or an operation to replace. Returns a function that
 * claims the names once the Plugin has started.
 */
function claimNames(definition: AnyPluginDefinition, claims: Claims): () => void {
  const { id } = definition;
  if (!isSlug(id)) throw new Error(`its id "${id}" is not a lower-kebab-case slug`);
  if (claims.commands.has(id)) throw new Error(`"rowbly ${id}" is already a command`);

  const options: [string, string[]][] = [];
  for (const [command, spec] of Object.entries(definition.options ?? {})) {
    const taken = claims.options.get(command);
    if (!taken) throw new Error(`"rowbly ${command}" does not take Plugin options`);
    const names = (spec?.options ?? []).map(({ flags }) => {
      const name = FLAG_RE.exec(flags)?.[1];
      if (!name) throw new Error(`option "${flags}" on "rowbly ${command}" must be one long flag`);
      const base = name.replace(/^no-/, '');
      if (taken.has(base)) throw new Error(`--${name} is already an option of "rowbly ${command}"`);
      return base;
    });
    options.push([command, names]);
  }

  const keys = (definition.actions ?? []).map(({ key }) => key);
  for (const key of keys) {
    if ([...key].length !== 1) throw new Error(`Action key "${key}" must be one character`);
    if (claims.keys.has(key) || keys.indexOf(key) !== keys.lastIndexOf(key)) {
      throw new Error(`the key "${key}" is already in use`);
    }
  }

  const replaced = Object.keys(definition.replaces ?? {});
  for (const name of replaced) {
    if (claims.replaced.has(name)) throw new Error(`another Plugin already replaces ${name}`);
  }

  return () => {
    claims.commands.add(id);
    for (const [command, names] of options) for (const name of names) claims.options.get(command)?.add(name);
    for (const key of keys) claims.keys.add(key);
    for (const name of replaced) claims.replaced.add(name);
  };
}
