import { Command, Option } from 'commander';
import { colors, printResult, renderTable } from '../output';
import { onOff, type PluginCli, type PluginHost, type PluginOptionCommand, type PluginStatus } from '../services';
import {
  boardFlag,
  collect,
  commandPath,
  confirmDestructive,
  type ProgramPlugins,
  parseRepeatable,
  promptIfMissing,
  readLongText,
  setProgramPlugins,
  withContext,
} from './_shared';

/** The core commands that take Plugin options; each passes them on as `plugins` (ADR-0012). */
export const PLUGIN_OPTION_COMMANDS: readonly PluginOptionCommand[] = [
  'assignees add',
  'assignees edit',
  'assignees remove',
  'boards create',
  'boards edit',
  'boards delete',
  'stories list',
  'stories create',
  'stories edit',
  'stories move',
  'stories rank',
  'stories delete',
  'tasks create',
  'tasks edit',
  'tasks move',
  'tasks delete',
];

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

/**
 * Adds the commands and core command options of each Plugin that is on, in registry order. A
 * Plugin whose `commands` throws fails to load.
 */
export function attachPlugins(program: Command, host: PluginHost): void {
  const attached: ProgramPlugins = { host, options: new Map() };
  setProgramPlugins(program, attached);
  for (const { definition } of [...host.active()]) {
    const { id } = definition;
    if (definition.commands) {
      const group = new Command(id).description(definition.description).copyInheritedSettings(program);
      try {
        definition.commands(group, pluginCli(id));
      } catch (err) {
        host.markFailed(id, `its commands failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      program.addCommand(group);
    }
    for (const [path, spec] of Object.entries(definition.options ?? {})) {
      const command = findCommand(program, path);
      if (!command || !spec) continue;
      const attributes = spec.options.map(({ flags, description, repeatable }) => {
        const option = new Option(flags, description);
        if (repeatable) option.argParser(collect);
        command.addOption(option);
        return option.attributeName();
      });
      attached.options.set(path, [...(attached.options.get(path) ?? []), { id, attributes, input: spec.input }]);
    }
  }
}

function findCommand(program: Command, path: string): Command | undefined {
  let at: Command | undefined = program;
  for (const name of path.split(' ')) at = at?.commands.find((c) => c.name() === name);
  return at && commandPath(at) === path ? at : undefined;
}

/** What a Plugin's command actions use to run like core commands. */
function pluginCli(id: string): PluginCli<unknown> {
  return {
    run: (cmd, action) =>
      withContext(cmd, ({ services, globals }) =>
        action({
          plugin: services.plugins.context(id),
          services,
          json: globals.json,
          print: (data, human) => printResult(data, { json: globals.json, human }),
          confirm: (message) => confirmDestructive(message, globals),
          prompt: (value, spec) => promptIfMissing(value, globals, spec),
          readText: (flags, opts) => readLongText(flags, opts),
          resolveBoard: (flag) => services.context.resolveBoard(boardFlag({ board: flag })),
        }),
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

function renderPlugin(plugin: PluginStatus & { settings?: Record<string, unknown> }): string {
  const lines = [
    `${colors.bold(plugin.name)} ${colors.dim(plugin.id)}`,
    `On: ${onOffText(plugin)}${plugin.known ? '' : ' (not in this version of Rowbly)'}`,
  ];
  if (plugin.reason) lines.push(colors.red(`Failed to load: ${plugin.reason}`));
  if (plugin.description) lines.push(plugin.description);
  const settings = Object.entries(plugin.settings ?? {});
  lines.push('', colors.bold('Settings'));
  lines.push(
    ...(settings.length === 0 ? [colors.dim('none')] : settings.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)),
  );
  return lines.join('\n');
}
