import { Command, Option } from 'commander';
import { errorMessage as messageOf } from '../core';
import { colors, printResult, renderTable } from '../output';
import {
  type ActivePlugin,
  type AnyPluginDefinition,
  invokePlugin,
  onOff,
  type PluginCli,
  type PluginCommandOptions,
  type PluginHost,
  type PluginStatus,
  pluginServices,
} from '../services';
import { editTextInEditor } from '../storage';
import {
  type AttachedPluginOptions,
  boardFlag,
  collect,
  confirmDestructive,
  type ProgramPlugins,
  parseRepeatable,
  promptIfMissing,
  readLongText,
  setProgramPlugins,
  withContext,
} from './_shared';

export function registerPlugins(program: Command): void {
  const plugins = program
    .command('plugins')
    .description('List the Plugins and turn them on or off for this Data Root')
    .addHelpText('after', '\nA change takes effect the next time Rowbly runs.');

  plugins
    .command('list')
    .description('List every Built-in Plugin, whether it is on, and any that failed to load')
    .action((_opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        printResult(await services.plugins.list(), { json: globals.json, human: renderPlugins });
      }),
    );

  plugins
    .command('show <id>')
    .description('Show a Plugin and its settings')
    .action((id: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        printResult(await services.plugins.get(id), { json: globals.json, human: renderPlugin });
      }),
    );

  plugins
    .command('enable <id>')
    .description('Turn a Plugin on for everyone who uses this Data Root')
    .action((id: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const result = await services.plugins.enable(id);
        printResult(result, { json: globals.json, human: () => `Turned on Plugin ${id}` });
      }),
    );

  plugins
    .command('disable <id>')
    .description('Turn a Plugin off; its settings and data are kept')
    .action((id: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const result = await services.plugins.disable(id);
        printResult(result, { json: globals.json, human: () => `Turned off Plugin ${id}; its data is kept` });
      }),
    );
}

/** Stages each Plugin's CLI part while it loads, and attaches the complete part of each that loaded. */
export interface PluginCliStager {
  /** For `LoadPluginsOptions.stage`: builds the Plugin's command group and options off the program. */
  stage(plugin: ActivePlugin): void;
  /** Attaches, in registry order, what was staged for each Plugin that is on in `host`. */
  attach(host: PluginHost): void;
}

/** One Plugin's commands and core command options, built off the program and attached in one step. */
interface StagedCli {
  group?: Command;
  options: { path: string; command: Command; options: Option[]; attached: AttachedPluginOptions }[];
}

/**
 * Stages the CLI part of each Plugin as it loads, so that a Plugin whose `commands` throws, or whose
 * options cannot be attached, fails to load with nothing attached and no names kept (ARCH-24,
 * RES-14, RES-22).
 */
export function pluginCliStager(program: Command): PluginCliStager {
  const staged = new Map<string, StagedCli>();
  return {
    stage: ({ definition }) => void staged.set(definition.id, stageCli(program, definition)),
    attach(host) {
      const attached: ProgramPlugins = { host, options: new Map() };
      setProgramPlugins(program, attached);
      for (const { definition } of host.active()) {
        let cli = staged.get(definition.id);
        if (!cli) {
          // A host loaded without this stager: stage now, and skip the Plugin as a whole if that fails.
          try {
            cli = stageCli(program, definition);
          } catch (err) {
            host.markFailed(definition.id, messageOf(err));
            continue;
          }
        }
        publish(program, attached, cli);
      }
    },
  };
}

/** Adds the commands and core command options of each Plugin that is on in a host loaded without staging. */
export function attachPlugins(program: Command, host: PluginHost): void {
  pluginCliStager(program).attach(host);
}

function stageCli(program: Command, definition: AnyPluginDefinition): StagedCli {
  const { id } = definition;
  let group: Command | undefined;
  if (definition.commands) {
    group = new Command(id).description(definition.description).copyInheritedSettings(program);
    try {
      definition.commands(group, pluginCli(id));
    } catch (err) {
      throw new Error(`its commands failed: ${messageOf(err)}`);
    }
  }
  const options: StagedCli['options'] = [];
  try {
    for (const [path, spec] of Object.entries(definition.options ?? {})) {
      if (!spec) continue;
      const command = findCommand(program, path);
      if (!command) throw new Error(`"rowbly ${path}" is not a command of this program`);
      const built = spec.options.map(({ flags, description, repeatable }) => {
        const option = new Option(flags, description);
        if (repeatable) option.argParser(collect);
        if (command.options.some((o) => o.long === option.long)) {
          throw new Error(`${option.long} is already an option of "rowbly ${path}"`);
        }
        return option;
      });
      const attributes = [...new Set(built.map((o) => o.attributeName()))];
      options.push({ path, command, options: built, attached: { id, attributes, convert: converterOf(path, spec) } });
    }
  } catch (err) {
    throw new Error(`its options failed: ${messageOf(err)}`);
  }
  return { group, options };
}

/** `filter` on `stories list` (criteria), `input` on commands that run an operation (DX-12). */
function converterOf(path: string, spec: PluginCommandOptions): AttachedPluginOptions['convert'] {
  const wanted = path === 'stories list' ? 'filter' : 'input';
  const convert: unknown = (spec as unknown as Record<string, unknown>)[wanted];
  if (typeof convert !== 'function') throw new Error(`its options on "rowbly ${path}" need ${wanted}(values)`);
  return (values) => convert.call(spec, values);
}

function publish(program: Command, attached: ProgramPlugins, { group, options }: StagedCli): void {
  if (group) program.addCommand(group);
  for (const { path, command, options: list, attached: entry } of options) {
    for (const option of list) command.addOption(option);
    attached.options.set(path, [...(attached.options.get(path) ?? []), entry]);
  }
}

/** The command at `path` below `program`, which is always the root program, so no parent check is needed. */
function findCommand(program: Command, path: string): Command | undefined {
  let at: Command | undefined = program;
  for (const name of path.split(' ')) at = at?.commands.find((c) => c.name() === name);
  return at;
}

/** What a Plugin's command actions use to run like core commands. */
function pluginCli(id: string): PluginCli<unknown> {
  return {
    run: (cmd, action) =>
      withContext(cmd, ({ services, globals }) =>
        // The action is Plugin code: attributed, with expected errors keeping their codes (D7).
        invokePlugin({ plugin: id, stage: 'command' }, () =>
          action({
            plugin: services.plugins.context(id),
            services: pluginServices(services),
            json: globals.json,
            print: (data, human) => printResult(data, { json: globals.json, human }),
            confirm: (message) => confirmDestructive(message, globals),
            prompt: (value, spec) => promptIfMissing(value, globals, spec),
            readText: (flags, opts) => readLongText(flags, opts),
            editText: (initial) => editTextInEditor(initial),
            resolveBoard: (flag) => services.context.resolveBoard(boardFlag({ board: flag })),
          }),
        ),
      ),
    collect,
    parseRepeatable,
  };
}

const ON_OFF_COLORS = { on: colors.green, off: colors.dim, failed: colors.red } as const;

function onOffText(plugin: PluginStatus): string {
  const word = onOff(plugin);
  return ON_OFF_COLORS[word](word);
}

function renderPlugins(plugins: PluginStatus[]): string {
  if (plugins.length === 0) return colors.dim('This version of Rowbly has no Built-in Plugins.');
  const table = renderTable(
    ['ID', 'ON', 'NAME', 'DESCRIPTION'],
    plugins.map((p) => [p.id, onOffText(p), p.name, p.known ? p.description : '(not in this version)']),
  );
  const failed = plugins.filter((p) => p.enabled && !p.loaded);
  return [table, ...failed.map((p) => colors.red(`${p.id} failed to load: ${p.reason}`))].join('\n');
}

function renderPlugin(plugin: PluginStatus & { settings: Record<string, unknown> }): string {
  const lines = [
    `${colors.bold(plugin.name)} ${colors.dim(plugin.id)}`,
    `On: ${onOffText(plugin)}${plugin.known ? '' : ' (not in this version of Rowbly)'}`,
  ];
  if (plugin.reason) lines.push(colors.red(`Failed to load: ${plugin.reason}`));
  if (plugin.description) lines.push(plugin.description);
  const settings = Object.entries(plugin.settings);
  lines.push('', colors.bold('Settings'));
  lines.push(
    ...(settings.length === 0 ? [colors.dim('none')] : settings.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)),
  );
  return lines.join('\n');
}
