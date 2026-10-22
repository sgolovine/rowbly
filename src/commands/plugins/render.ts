import { colors, renderTable } from '../../output';
import { onOff, type PluginStatus } from '../../services';

const ON_OFF_COLORS = { on: colors.green, off: colors.dim, failed: colors.red } as const;

function renderOnOff(plugin: PluginStatus): string {
  const word = onOff(plugin);
  return ON_OFF_COLORS[word](word);
}

export function renderPlugins(plugins: PluginStatus[]): string {
  if (plugins.length === 0) return colors.dim('This version of Rowbly has no Built-in Plugins.');
  const table = renderTable(
    ['ID', 'ON', 'NAME', 'DESCRIPTION'],
    plugins.map((p) => [p.id, renderOnOff(p), p.name, p.known ? p.description : '(not in this version)']),
  );
  const failed = plugins.filter((p) => p.enabled && !p.loaded);
  return [table, ...failed.map((p) => colors.red(`${p.id} failed to load: ${p.reason}`))].join('\n');
}

export function renderPlugin(plugin: PluginStatus & { settings: Record<string, unknown> }): string {
  const lines = [
    `${colors.bold(plugin.name)} ${colors.dim(plugin.id)}`,
    `On: ${renderOnOff(plugin)}${plugin.known ? '' : ' (not in this version of Rowbly)'}`,
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

export function renderPluginEnabled(id: string): string {
  return `Turned on Plugin ${id}`;
}

export function renderPluginDisabled(id: string): string {
  return `Turned off Plugin ${id}; its data is kept`;
}
