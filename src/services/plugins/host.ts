import { Option } from 'commander';
import { isSlug } from '../../core';
import { type DataRoot, formatIssues, type PluginEntry, type RowblyConfig } from '../../schemas';
import { createRepositories } from '../../storage';
import { type AnyPluginDefinition, CORE_OPERATION_NAMES, type PluginOptionCommand } from './types';

/** Names that core already uses, so a Plugin that takes one fails to load (ADR-0012). */
export interface ReservedNames {
  /** Top-level commands. */
  commands: readonly string[];
  /**
   * The option names (without `--` and `no-`) of each core command that takes Plugin options,
   * including the global options.
   */
  options: Readonly<Partial<Record<PluginOptionCommand, readonly string[]>>>;
  /** Keys that a core TUI screen uses, so an Action cannot. */
  keys: readonly string[];
}

/**
 * A Plugin is on when it is both `enabled` and `loaded`. One that is enabled but did not load
 * failed to load, and `reason` says why.
 */
export interface PluginStatus {
  id: string;
  name: string;
  description: string;
  /** `rowbly.config.json` turns it on. */
  enabled: boolean;
  /** It runs this time. */
  loaded: boolean;
  /** Whether this Rowbly version has the Plugin. */
  known: boolean;
  /** Why it failed to load. */
  reason?: string;
}

/** A Plugin that loaded, with its parsed settings and the raw entry they came from. */
export interface ActivePlugin {
  definition: AnyPluginDefinition;
  settings: unknown;
  /** Its raw Data Root settings, without `enabled`; Board settings merge over these before parsing. */
  entry: Record<string, unknown>;
}

/** The Plugins of one Data Root for this run. */
export interface PluginHost {
  readonly registry: readonly AnyPluginDefinition[];
  /** Built-in Plugins in registry order, then the other Plugins `rowbly.config.json` names. A copy. */
  status(): PluginStatus[];
  /** The Plugins that are on and loaded, in registry order: the order they run in. A copy of the list. */
  active(): readonly ActivePlugin[];
  /** The Plugins that are enabled but did not load. A copy. */
  failures(): PluginStatus[];
  /** Skips a Plugin for the rest of the run, e.g. when its TUI part throws while it loads. */
  markFailed(id: string, reason: string): void;
}

export interface LoadPluginsOptions {
  /** `null` without a Data Root: nothing is on. */
  root: DataRoot | null;
  registry: readonly AnyPluginDefinition[];
  reserved: ReservedNames;
  /**
   * Prepares the part of a Plugin that the surface in use needs (its CLI commands and options, or
   * its TUI part) while it loads, without publishing it. Throwing makes the Plugin fail to load.
   */
  stage?(plugin: ActivePlugin): void | Promise<void>;
}

/**
 * Turns on the Plugins that `rowbly.config.json` enables, in registry order (ADR-0010). A Plugin
 * whose settings are invalid, that clashes with a name in use or declares an invalid one, whose
 * surface fails to stage, whose `start` throws, or that this version does not have, fails to load
 * as a whole; the rest run without it.
 *
 * Each Plugin's names are claimed only once all of its steps succeeded, so a Plugin that fails
 * never blocks a later one (ADR-0020 §8). A Plugin rejected for a clash is not retried when the
 * Plugin it clashed with fails afterwards, through `markFailed`.
 */
export async function loadPlugins({ root, registry, reserved, stage }: LoadPluginsOptions): Promise<PluginHost> {
  const entries = (root ? await readEntries(root) : null) ?? {};
  const statuses: PluginStatus[] = [];
  const active: ActivePlugin[] = [];
  const claims = newClaims(reserved);

  for (const definition of registry) {
    const status: PluginStatus = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      enabled: false,
      loaded: false,
      known: true,
    };
    statuses.push(status);
    const entry = entries[definition.id];
    if (entry?.enabled !== true) continue;
    status.enabled = true;
    try {
      const { enabled: _enabled, ...raw } = entry;
      const settings = parseSettings(definition, raw);
      const claim = claimNames(definition, claims);
      const plugin: ActivePlugin = { definition, settings, entry: raw };
      await stage?.(plugin);
      await definition.start?.({ settings });
      claim();
      status.loaded = true;
      active.push(plugin);
    } catch (err) {
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
      enabled,
      loaded: false,
      known: false,
      ...(enabled ? { reason: 'this version of Rowbly does not have it' } : {}),
    });
  }

  return {
    registry,
    status: () => statuses.map((s) => ({ ...s })),
    active: () => [...active],
    failures: () => statuses.filter((s) => s.enabled && !s.loaded).map((s) => ({ ...s })),
    markFailed(id, reason) {
      const status = statuses.find((s) => s.id === id);
      const index = active.findIndex((p) => p.definition.id === id);
      if (!status?.loaded || index < 0) return;
      status.loaded = false;
      status.reason = reason;
      active.splice(index, 1);
    },
  };
}

/** `on`, `off`, or `failed` (enabled, but it did not load). */
export function onOff(status: PluginStatus): 'on' | 'off' | 'failed' {
  return status.loaded ? 'on' : status.enabled ? 'failed' : 'off';
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
  throw new Error(`invalid settings: ${formatIssues(result.error.issues, 'settings')}`);
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

/** A problem with a Plugin definition, found before it loads. */
export interface PluginDiagnostic {
  /** Where in the definition, e.g. `options["stories create"].options[1]` or `hooks["stories.edit"]`. */
  path: string;
  message: string;
}

/**
 * Checks a Plugin definition against the names core reserves, without loading it: its id, its
 * options, Action keys, replacements and hooks. The same checks run while it loads (DX-32).
 */
export function validatePluginDefinition(definition: AnyPluginDefinition, reserved: ReservedNames): PluginDiagnostic[] {
  return checkNames(definition, newClaims(reserved)).problems;
}

interface Claims {
  commands: Set<string>;
  /** By command: the Commander attribute names (`epic`, `addSpec`) its options use. */
  options: Map<string, Set<string>>;
  keys: Set<string>;
  replaced: Set<string>;
}

function newClaims(reserved: ReservedNames): Claims {
  return {
    commands: new Set(reserved.commands),
    options: new Map(
      Object.entries(reserved.options).map(([command, names]) => [
        command,
        new Set((names ?? []).map((name) => new Option(`--${name}`).attributeName())),
      ]),
    ),
    keys: new Set(reserved.keys),
    replaced: new Set(),
  };
}

/** One long lower-kebab-case flag with an optional value: `--epic <id>`, `--no-epic`, `--spec [slug]`. */
const FLAG_RE = /^--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?: <[^>]+>| \[[^\]]+\])?$/;

const CORE_OPERATIONS: ReadonlySet<string> = new Set(CORE_OPERATION_NAMES);
const CORE_NAMESPACES: ReadonlySet<string> = new Set(CORE_OPERATION_NAMES.map((name) => name.split('.')[0] as string));
/** Command verbs that name a different operation verb. */
const VERB_HINTS: Readonly<Record<string, string>> = { edit: 'update', delete: 'remove', rm: 'remove', new: 'create' };

/**
 * Throws when the Plugin wants a name that core or an earlier Plugin uses, or declares an invalid
 * one. Returns a function that claims the names once the Plugin has loaded.
 */
function claimNames(definition: AnyPluginDefinition, claims: Claims): () => void {
  const { problems, claim } = checkNames(definition, claims);
  if (problems[0]) throw new Error(problems[0].message);
  return claim;
}

function checkNames(
  definition: AnyPluginDefinition,
  claims: Claims,
): { problems: PluginDiagnostic[]; claim: () => void } {
  const problems: PluginDiagnostic[] = [];
  const problem = (path: string, message: string) => void problems.push({ path, message });
  const { id } = definition;
  if (!isSlug(id)) problem('id', `its id "${id}" is not a lower-kebab-case slug`);
  else if (claims.commands.has(id)) problem('id', `"rowbly ${id}" is already a command`);

  const options: [string, string[]][] = [];
  for (const [command, spec] of Object.entries(definition.options ?? {})) {
    const at = `options["${command}"]`;
    const taken = claims.options.get(command);
    if (!taken) {
      problem(at, `"rowbly ${command}" does not take Plugin options`);
      continue;
    }
    // By attribute: the positive and the negative flag that have it (`--x` and `--no-x` may pair).
    const own = new Map<string, { positive?: string; negative?: string }>();
    for (const [index, { flags }] of (spec?.options ?? []).entries()) {
      const path = `${at}.options[${index}]`;
      const name = FLAG_RE.exec(flags)?.[1];
      if (!name) {
        problem(path, `option "${flags}" on "rowbly ${command}" must be one long lower-kebab-case flag`);
        continue;
      }
      const attribute = new Option(flags).attributeName();
      const pair = own.get(attribute) ?? {};
      const polarity = name.startsWith('no-') ? 'negative' : 'positive';
      const other = pair.positive ?? pair.negative;
      if (taken.has(attribute)) problem(path, `--${name} is already an option of "rowbly ${command}"`);
      else if (pair[polarity] === name) problem(path, `--${name} is declared twice on "rowbly ${command}"`);
      else if (pair[polarity] !== undefined || (other !== undefined && positive(other) !== positive(name))) {
        problem(path, `--${other} and --${name} on "rowbly ${command}" are the same option (${attribute})`);
      } else own.set(attribute, { ...pair, [polarity]: name });
    }
    options.push([command, [...own.keys()]]);
  }

  const keys = new Set<string>();
  for (const [index, { key }] of (definition.actions ?? []).entries()) {
    const path = `actions[${index}].key`;
    if ([...key].length !== 1) problem(path, `Action key "${key}" must be one character`);
    else if (claims.keys.has(key) || keys.has(key)) problem(path, `the key "${key}" is already in use`);
    else keys.add(key);
  }

  const replaced = Object.keys(definition.replaces ?? {});
  for (const name of replaced) {
    const path = `replaces["${name}"]`;
    if (!CORE_OPERATIONS.has(name)) {
      const hint = suggestion(name) ?? 'only core operations can be replaced';
      problem(path, `it replaces "${name}", which is not a core operation; ${hint}`);
    } else if (claims.replaced.has(name)) problem(path, `another Plugin already replaces ${name}`);
  }

  // Hooks on core operations are checked; another Plugin's operations (`<id>.<name>`) are untyped.
  for (const name of Object.keys(definition.hooks ?? {})) {
    const path = `hooks["${name}"]`;
    const [namespace, verb] = name.split('.');
    if (!namespace || !verb)
      problem(path, `it hooks "${name}", which is not an operation name (\`<namespace>.<name>\`)`);
    else if (CORE_NAMESPACES.has(namespace) && !CORE_OPERATIONS.has(name)) {
      const hint = suggestion(name) ?? `the ${namespace} operations are ${coreOperationsIn(namespace).join(', ')}`;
      problem(path, `it hooks "${name}", which is not a core operation; ${hint}`);
    }
  }

  return {
    problems,
    claim: () => {
      claims.commands.add(id);
      for (const [command, attributes] of options) for (const a of attributes) claims.options.get(command)?.add(a);
      for (const key of keys) claims.keys.add(key);
      for (const name of replaced) claims.replaced.add(name);
    },
  };
}

/** `x` for `no-x`. */
function positive(name: string): string {
  return name.replace(/^no-/, '');
}

/** `did you mean "stories.update"?` for `stories.edit`, when the near name is a core operation. */
function suggestion(name: string): string | undefined {
  const [namespace, verb = ''] = name.split('.');
  const near = `${namespace}.${VERB_HINTS[verb] ?? verb}`;
  return near !== name && CORE_OPERATIONS.has(near) ? `did you mean "${near}"?` : undefined;
}

function coreOperationsIn(namespace: string): string[] {
  return CORE_OPERATION_NAMES.filter((name) => name.startsWith(`${namespace}.`));
}
